/**
 * Systems Biology Domain Adapter
 *
 * Verifies claims about pathway enrichment, network topology,
 * and flux balance analysis using Reactome, KEGG, STRING, and Ensembl APIs.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { inferClaimType } from "../infer";
import { fetchJson } from "../utils/http-client";

const DOMAIN = "systems_biology";
const VALID_CLAIM_TYPES = ["pathway_enrichment", "network_topology", "flux_balance"] as const;

const ENSEMBL_API = "https://rest.ensembl.org";
const REACTOME_API = "https://reactome.org/ContentService/data";
const KEGG_API = "https://rest.kegg.jp";
const STRING_API = "https://string-db.org/api/json";

// ── Helpers ──────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(/[,;\s]+/).filter(Boolean);
  return [];
}

// ── Pathway Enrichment ───────────────────────────────────────────────────

async function verifyPathwayEnrichment(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // Component 1: gene_set_valid (0.20)
  const genes = asStringArray(taskResult.genes || taskResult.gene_set || taskResult.gene_list);
  if (genes.length > 0) {
    const sample = genes.slice(0, 10);
    const checks = await Promise.allSettled(
      sample.map((g) =>
        fetchJson<Record<string, unknown>>(
          `${ENSEMBL_API}/lookup/symbol/homo_sapiens/${encodeURIComponent(g)}?content-type=application/json`,
        ),
      ),
    );
    const found = checks.filter(
      (r) => r.status === "fulfilled" && r.value.ok,
    ).length;
    componentScores.gene_set_valid = round4(found / sample.length);
    details.gene_set = { total: genes.length, sampled: sample.length, valid: found };
  } else {
    componentScores.gene_set_valid = 0.5;
    details.gene_set = { note: "No gene set provided" };
  }

  // Component 2: pathway_exists (0.20)
  const pathwayId = str(taskResult.pathway_id || taskResult.pathway);
  if (pathwayId) {
    if (pathwayId.startsWith("R-")) {
      const res = await fetchJson<Record<string, unknown>>(
        `${REACTOME_API}/pathway/${encodeURIComponent(pathwayId)}`,
      );
      componentScores.pathway_exists = res.ok ? 1.0 : 0.0;
      details.pathway = { id: pathwayId, source: "Reactome", found: res.ok };
    } else {
      const res = await fetchJson<Record<string, unknown>>(
        `${KEGG_API}/get/${encodeURIComponent(pathwayId)}`,
      );
      componentScores.pathway_exists = res.ok ? 1.0 : 0.0;
      details.pathway = { id: pathwayId, source: "KEGG", found: res.ok };
    }
  } else {
    componentScores.pathway_exists = 0.5;
    details.pathway = { note: "No pathway ID provided" };
  }

  // Component 3: enrichment_recomputed (0.30)
  // scipy is unavailable in TypeScript -- return neutral score
  componentScores.enrichment_recomputed = 0.5;
  details.enrichment_recomputed = { note: "scipy unavailable in TS, neutral score" };
  warnings.push("Cannot recompute enrichment without scipy; returning neutral");

  // Component 4: fdr_correction (0.30)
  const rawPvalue = taskResult.p_value ?? taskResult.pvalue;
  const fdrValue = taskResult.fdr ?? taskResult.adjusted_pvalue ?? taskResult.q_value;
  const nTests = taskResult.n_tests ?? taskResult.num_tests;

  if (rawPvalue != null && fdrValue != null) {
    const rawP = num(rawPvalue, -1);
    const fdr = num(fdrValue, -1);
    if (rawP < 0 || rawP > 1 || fdr < 0 || fdr > 1) {
      componentScores.fdr_correction = 0.0;
      errors.push("p-value or FDR out of [0, 1] range");
      details.fdr = { raw_p: rawPvalue, fdr: fdrValue, valid: false };
    } else if (fdr >= rawP) {
      // FDR should be >= raw p-value (Bonferroni/BH correction makes values larger)
      let fdrScore = 1.0;
      if (nTests != null) {
        const upperBound = rawP * num(nTests);
        if (fdr > upperBound * 1.1) {
          fdrScore = 0.5;
          warnings.push("FDR exceeds Bonferroni upper bound");
        }
      }
      componentScores.fdr_correction = fdrScore;
      details.fdr = { raw_p: rawP, fdr, valid: true, score: fdrScore };
    } else {
      componentScores.fdr_correction = 0.2;
      details.fdr = { raw_p: rawP, fdr, valid: false, note: "FDR < raw p-value is suspicious" };
      warnings.push("FDR is smaller than raw p-value, which is unexpected");
    }
  } else {
    componentScores.fdr_correction = 0.5;
    details.fdr = { note: "Insufficient data for FDR check" };
  }

  const weights: Record<string, number> = {
    gene_set_valid: 0.20,
    pathway_exists: 0.20,
    enrichment_recomputed: 0.30,
    fdr_correction: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Network Topology ─────────────────────────────────────────────────────

async function verifyNetworkTopology(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const proteins = asStringArray(taskResult.proteins || taskResult.nodes || taskResult.identifiers);

  // Component 1: proteins_exist (0.20)
  if (proteins.length > 0) {
    const resolveRes = await fetchJson<Array<Record<string, unknown>>>(
      `${STRING_API}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: undefined,
      },
    );
    // STRING resolve uses form-encoded POST; use GET fallback with identifiers param
    const identStr = proteins.slice(0, 20).join("%0d");
    const resolveGet = await fetchJson<Array<Record<string, unknown>>>(
      `${STRING_API}/resolve?identifiers=${identStr}&species=9606`,
    );
    if (resolveGet.ok && Array.isArray(resolveGet.data)) {
      const resolved = resolveGet.data.length;
      componentScores.proteins_exist = round4(Math.min(1.0, resolved / Math.min(proteins.length, 20)));
      details.proteins = { total: proteins.length, resolved };
    } else {
      componentScores.proteins_exist = 0.5;
      details.proteins = { note: "STRING resolve query failed", error: resolveGet.error };
      warnings.push("Could not verify proteins via STRING");
    }
  } else {
    componentScores.proteins_exist = 0.5;
    details.proteins = { note: "No protein identifiers provided" };
  }

  // Component 2: interactions_verified (0.25)
  if (proteins.length >= 2) {
    const identStr = proteins.slice(0, 20).join("%0d");
    const netRes = await fetchJson<Array<Record<string, unknown>>>(
      `${STRING_API}/network?identifiers=${identStr}&species=9606&required_score=400`,
    );
    if (netRes.ok && Array.isArray(netRes.data)) {
      const edgeCount = netRes.data.length;
      const maxEdges = (proteins.length * (proteins.length - 1)) / 2;
      componentScores.interactions_verified = edgeCount > 0 ? round4(Math.min(1.0, edgeCount / Math.max(maxEdges * 0.1, 1))) : 0.2;
      details.interactions = { edges_found: edgeCount, proteins_queried: Math.min(proteins.length, 20) };
    } else {
      componentScores.interactions_verified = 0.5;
      details.interactions = { note: "STRING network query failed" };
      warnings.push("Could not verify interactions via STRING");
    }
  } else {
    componentScores.interactions_verified = 0.5;
    details.interactions = { note: "Fewer than 2 proteins, cannot check interactions" };
  }

  // Component 3: metrics_recomputed (0.30)
  // No networkx available in TS -- compute basic metrics from claimed edges
  const claimedEdges = taskResult.edges || taskResult.interactions;
  const claimedNodes = num(taskResult.n_nodes || taskResult.node_count, 0);
  const claimedEdgeCount = num(taskResult.n_edges || taskResult.edge_count, 0);

  if (Array.isArray(claimedEdges) && claimedEdges.length > 0) {
    const nodeSet = new Set<string>();
    for (const edge of claimedEdges) {
      if (Array.isArray(edge) && edge.length >= 2) {
        nodeSet.add(String(edge[0]));
        nodeSet.add(String(edge[1]));
      } else if (typeof edge === "object" && edge !== null) {
        const e = edge as Record<string, unknown>;
        if (e.source) nodeSet.add(String(e.source));
        if (e.target) nodeSet.add(String(e.target));
      }
    }
    const computedNodes = nodeSet.size;
    const computedEdges = claimedEdges.length;

    let metricsScore = 1.0;
    if (claimedNodes > 0 && computedNodes !== claimedNodes) {
      metricsScore -= 0.3;
      warnings.push(`Claimed ${claimedNodes} nodes but edges imply ${computedNodes}`);
    }
    if (claimedEdgeCount > 0 && computedEdges !== claimedEdgeCount) {
      metricsScore -= 0.3;
      warnings.push(`Claimed ${claimedEdgeCount} edges but found ${computedEdges}`);
    }
    componentScores.metrics_recomputed = round4(Math.max(0, metricsScore));
    details.metrics = { computed_nodes: computedNodes, computed_edges: computedEdges, claimed_nodes: claimedNodes, claimed_edges: claimedEdgeCount };
  } else {
    componentScores.metrics_recomputed = 0.5;
    details.metrics = { note: "No edge list provided for recomputation" };
  }

  // Component 4: hub_identification (0.25)
  const claimedHubs = asStringArray(taskResult.hubs || taskResult.hub_genes || taskResult.hub_proteins);
  if (claimedHubs.length > 0 && Array.isArray(claimedEdges) && claimedEdges.length > 0) {
    // Simple degree count from edges
    const degree: Record<string, number> = {};
    for (const edge of claimedEdges) {
      let src: string | undefined;
      let tgt: string | undefined;
      if (Array.isArray(edge) && edge.length >= 2) {
        src = String(edge[0]);
        tgt = String(edge[1]);
      } else if (typeof edge === "object" && edge !== null) {
        const e = edge as Record<string, unknown>;
        src = e.source ? String(e.source) : undefined;
        tgt = e.target ? String(e.target) : undefined;
      }
      if (src) degree[src] = (degree[src] ?? 0) + 1;
      if (tgt) degree[tgt] = (degree[tgt] ?? 0) + 1;
    }

    const sortedByDegree = Object.entries(degree).sort((a, b) => b[1] - a[1]);
    const topN = Math.max(claimedHubs.length, 5);
    const topNodes = new Set(sortedByDegree.slice(0, topN).map(([name]) => name.toLowerCase()));

    const matchedHubs = claimedHubs.filter((h) => topNodes.has(h.toLowerCase()));
    componentScores.hub_identification = round4(matchedHubs.length / claimedHubs.length);
    details.hubs = { claimed: claimedHubs, matched: matchedHubs, top_degree_nodes: sortedByDegree.slice(0, 5).map(([n, d]) => ({ node: n, degree: d })) };
  } else {
    componentScores.hub_identification = 0.5;
    details.hubs = { note: "No hubs or edges provided for hub verification" };
  }

  const weights: Record<string, number> = {
    proteins_exist: 0.20,
    interactions_verified: 0.25,
    metrics_recomputed: 0.30,
    hub_identification: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Flux Balance ─────────────────────────────────────────────────────────

async function verifyFluxBalance(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // Component 1: model_valid (0.20)
  const matrix = taskResult.stoichiometry_matrix || taskResult.S;
  if (Array.isArray(matrix) && matrix.length > 0) {
    const rows = matrix as unknown[][];
    const firstLen = Array.isArray(rows[0]) ? rows[0].length : 0;
    const allSameLength = rows.every((r) => Array.isArray(r) && r.length === firstLen);

    const bounds = taskResult.bounds || taskResult.flux_bounds;
    let boundsMatch = true;
    if (Array.isArray(bounds)) {
      boundsMatch = bounds.length === firstLen;
    }

    if (allSameLength && firstLen > 0 && boundsMatch) {
      componentScores.model_valid = 1.0;
      details.model = { rows: rows.length, cols: firstLen, bounds_match: boundsMatch };
    } else {
      componentScores.model_valid = 0.3;
      details.model = { rows: rows.length, col_lengths_consistent: allSameLength, bounds_match: boundsMatch };
      if (!allSameLength) errors.push("Stoichiometry matrix rows have inconsistent lengths");
      if (!boundsMatch) errors.push("Bounds dimension does not match matrix columns");
    }
  } else {
    componentScores.model_valid = 0.5;
    details.model = { note: "No stoichiometry matrix provided" };
  }

  // Component 2: stoichiometry_consistent (0.25)
  // No numpy available -- basic non-emptiness check
  if (Array.isArray(matrix) && matrix.length > 0) {
    const hasNumericEntries = (matrix as unknown[][]).some((row) =>
      Array.isArray(row) && row.some((v) => typeof v === "number" && v !== 0),
    );
    componentScores.stoichiometry_consistent = hasNumericEntries ? 0.7 : 0.3;
    details.stoichiometry = { has_nonzero: hasNumericEntries, note: "numpy unavailable, basic check only" };
  } else {
    componentScores.stoichiometry_consistent = 0.5;
    details.stoichiometry = { note: "No matrix for consistency check" };
  }

  // Component 3: objective_feasible (0.25)
  // No scipy linprog in TS -- return neutral
  componentScores.objective_feasible = 0.5;
  details.objective = { note: "scipy linprog unavailable in TS, neutral score" };
  warnings.push("Cannot verify objective feasibility without linear programming solver");

  // Component 4: flux_bounds_respected (0.30)
  const fluxes = taskResult.fluxes || taskResult.flux_values;
  const bounds = taskResult.bounds || taskResult.flux_bounds;
  if (Array.isArray(fluxes) && Array.isArray(bounds) && fluxes.length === bounds.length) {
    let violations = 0;
    const tolerance = 1e-6;
    for (let i = 0; i < fluxes.length; i++) {
      const flux = num(fluxes[i]);
      const bound = bounds[i];
      if (Array.isArray(bound) && bound.length >= 2) {
        const lb = num(bound[0]);
        const ub = num(bound[1]);
        if (flux < lb - tolerance || flux > ub + tolerance) {
          violations++;
        }
      }
    }
    const violationRate = violations / fluxes.length;
    componentScores.flux_bounds_respected = round4(Math.max(0, 1.0 - violationRate * 5));
    details.flux_bounds = { total_fluxes: fluxes.length, violations, violation_rate: round4(violationRate) };
    if (violations > 0) {
      warnings.push(`${violations} of ${fluxes.length} fluxes violate bounds`);
    }
  } else {
    componentScores.flux_bounds_respected = 0.5;
    details.flux_bounds = { note: "Insufficient flux/bounds data" };
  }

  const weights: Record<string, number> = {
    model_valid: 0.20,
    stoichiometry_consistent: 0.25,
    objective_feasible: 0.25,
    flux_bounds_respected: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Adapter Export ────────────────────────────────────────────────────────

export const systemsBiologyAdapter: DomainAdapter = {
  domain: DOMAIN,

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    let claimType = typeof taskResult.claim_type === "string"
      ? taskResult.claim_type
      : typeof taskMetadata.claim_type === "string"
        ? taskMetadata.claim_type
        : "";
    const inferWarnings: string[] = [];

    if (!claimType) {
      const inferred = inferClaimType(DOMAIN, taskResult);
      if (inferred) {
        claimType = inferred;
        inferWarnings.push(`claim_type not provided — inferred as '${inferred}' from result fields`);
      } else {
        return failResult(DOMAIN, [
          `Missing claim_type and could not infer from result fields. Valid claim types: ${VALID_CLAIM_TYPES.join(", ")}`,
        ]);
      }
    }

    try {
      let result: { score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] };

      switch (claimType) {
        case "pathway_enrichment":
          result = await verifyPathwayEnrichment(taskResult);
          break;
        case "network_topology":
          result = await verifyNetworkTopology(taskResult);
          break;
        case "flux_balance":
          result = await verifyFluxBalance(taskResult);
          break;
        default:
          return failResult(DOMAIN, [
            `Unsupported systems biology claim type: '${claimType}'. Valid types: ${VALID_CLAIM_TYPES.join(", ")}`,
          ]);
      }

      const elapsed = (performance.now() - start) / 1000;
      return successResult(DOMAIN, result.score, { claim_type: claimType, ...result.details }, {
        warnings: [...inferWarnings, ...result.warnings],
        errors: result.errors,
        compute_time_seconds: elapsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return failResult(DOMAIN, [`Systems biology verification failed: ${message}`]);
    }
  },
};
