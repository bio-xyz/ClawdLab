/**
 * Computational Biology domain adapter.
 *
 * Verifies structure predictions, protein design, binder design, RNA
 * structure, and structure comparison claims. API-based only — no
 * Docker/Biopython execution in v2.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { fetchJson } from "../utils/http-client";

const PDB_API = "https://data.rcsb.org/rest/v1/core/entry";
const RFAM_API = "https://rfam.org/family";

export const computationalBiologyAdapter: DomainAdapter = {
  domain: "computational_biology",

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = String(taskResult.claim_type ?? "structure_prediction");

    switch (claimType) {
      case "structure_prediction":
        return verifyStructurePrediction(taskResult, start);
      case "protein_design":
        return verifyProteinDesign(taskResult, start);
      case "binder_design":
        return verifyBinderDesign(taskResult, start);
      case "rna_structure":
        return verifyRnaStructure(taskResult, start);
      case "structure_comparison":
        return verifyStructureComparison(taskResult, start);
      default:
        return failResult("computational_biology", [`Unknown claim_type: ${claimType}`]);
    }
  },
};

// ── structure_prediction ──────────────────────────────────────────────────

async function verifyStructurePrediction(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "structure_prediction" };
  const warnings = ["PDB/Biopython checks degraded — no Docker in v2"];

  // Component 1: metrics_plausibility (0.30)
  const metrics = checkMetricsPlausibility(result);
  componentScores.metrics_plausibility = metrics.score;
  details.metrics_plausibility = metrics;

  // Component 2: sequence_valid (0.25)
  const seqCheck = checkSequenceValid(String(result.sequence ?? ""));
  componentScores.sequence_valid = seqCheck.score;
  details.sequence_valid = seqCheck;

  // Component 3: method_valid (0.20)
  const method = String(result.method ?? "").toLowerCase();
  const knownMethods = ["alphafold", "colabfold", "esmfold", "rosettafold", "omegafold", "openfold"];
  const methodValid = knownMethods.some((m) => method.includes(m));
  componentScores.method_valid = methodValid ? 1.0 : method ? 0.5 : 0.3;
  details.method_valid = { score: componentScores.method_valid, method, known: methodValid };

  // Component 4: structure_checks (0.25) — degraded
  componentScores.structure_checks = 0.5;
  details.structure_checks = { score: 0.5, note: "Biopython/DSSP not available — neutral score" };

  const weights: Record<string, number> = {
    metrics_plausibility: 0.30,
    sequence_valid: 0.25,
    method_valid: 0.20,
    structure_checks: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("computational_biology", round4(score), details, {
    warnings,
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── protein_design ────────────────────────────────────────────────────────

async function verifyProteinDesign(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "protein_design" };

  const seqCheck = checkSequenceValid(String(result.sequence ?? ""));
  componentScores.sequence_valid = seqCheck.score;
  details.sequence_valid = seqCheck;

  const metrics = checkMetricsPlausibility(result);
  componentScores.metrics_plausibility = metrics.score;
  details.metrics_plausibility = metrics;

  componentScores.backbone_quality = 0.5;
  details.backbone_quality = { score: 0.5, note: "Biopython unavailable — neutral score" };

  const weights: Record<string, number> = {
    sequence_valid: 0.35,
    metrics_plausibility: 0.35,
    backbone_quality: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("computational_biology", round4(score), details, {
    warnings: ["Structural checks degraded — no Docker in v2"],
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── binder_design ─────────────────────────────────────────────────────────

async function verifyBinderDesign(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "binder_design" };

  const seqCheck = checkSequenceValid(String(result.sequence ?? ""));
  componentScores.sequence_valid = seqCheck.score;
  details.sequence_valid = seqCheck;

  const metrics = checkMetricsPlausibility(result);
  componentScores.metrics_plausibility = metrics.score;
  details.metrics_plausibility = metrics;

  // Target protein check
  const targetProtein = String(result.target_protein ?? "");
  if (targetProtein) {
    const res = await fetchJson<Record<string, unknown>>(
      `https://rest.uniprot.org/uniprotkb/${targetProtein}`,
      { headers: { Accept: "application/json" } },
    );
    componentScores.target_valid = res.ok ? 1.0 : 0.3;
    details.target_valid = { score: componentScores.target_valid, found: res.ok };
  } else {
    componentScores.target_valid = 0.5;
    details.target_valid = { score: 0.5, note: "No target protein specified" };
  }

  componentScores.interface_quality = 0.5;
  details.interface_quality = { score: 0.5, note: "Interface analysis unavailable — neutral score" };

  const weights: Record<string, number> = {
    sequence_valid: 0.25,
    metrics_plausibility: 0.25,
    target_valid: 0.25,
    interface_quality: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("computational_biology", round4(score), details, {
    warnings: ["Interface/structural checks degraded — no Docker in v2"],
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── rna_structure ─────────────────────────────────────────────────────────

async function verifyRnaStructure(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "rna_structure" };

  // Component 1: dot_bracket_valid (0.30)
  const dotBracket = String(result.dot_bracket ?? "");
  const sequence = String(result.sequence ?? "");
  const dbCheck = checkDotBracket(dotBracket, sequence);
  componentScores.dot_bracket_valid = dbCheck.score;
  details.dot_bracket_valid = dbCheck;

  // Component 2: energy_plausible (0.25)
  const mfe = result.mfe as number | undefined;
  if (mfe != null) {
    const plausible = mfe <= 0;
    componentScores.energy_plausible = plausible ? 1.0 : 0.2;
    details.energy_plausible = { score: componentScores.energy_plausible, mfe, plausible };
  } else {
    componentScores.energy_plausible = 0.5;
    details.energy_plausible = { score: 0.5, note: "No MFE claimed" };
  }

  // Component 3: rfam_check (0.25)
  const rfamId = String(result.rfam_id ?? "");
  if (rfamId) {
    const res = await fetchJson<Record<string, unknown>>(`${RFAM_API}/${rfamId}`);
    componentScores.rfam_check = res.ok ? 1.0 : 0.0;
    details.rfam_check = { score: componentScores.rfam_check, found: res.ok };
  } else {
    componentScores.rfam_check = 0.5;
    details.rfam_check = { score: 0.5, note: "No Rfam ID" };
  }

  // Component 4: base_pairs_valid (0.20)
  const bpCheck = checkBasePairs(dotBracket, sequence);
  componentScores.base_pairs_valid = bpCheck.score;
  details.base_pairs_valid = bpCheck;

  const weights: Record<string, number> = {
    dot_bracket_valid: 0.30,
    energy_plausible: 0.25,
    rfam_check: 0.25,
    base_pairs_valid: 0.20,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("computational_biology", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── structure_comparison ──────────────────────────────────────────────────

async function verifyStructureComparison(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "structure_comparison" };

  // Component 1: pdb_ids_valid (0.30)
  const pdbId1 = String(result.pdb_id_1 ?? "").toUpperCase();
  const pdbId2 = String(result.pdb_id_2 ?? "").toUpperCase();
  let pdbValid = 0;
  for (const pdbId of [pdbId1, pdbId2]) {
    if (pdbId && /^[A-Z0-9]{4}$/.test(pdbId)) {
      const res = await fetchJson<Record<string, unknown>>(`${PDB_API}/${pdbId}`);
      if (res.ok) pdbValid++;
    }
  }
  componentScores.pdb_ids_valid = pdbValid / 2;
  details.pdb_ids_valid = { score: componentScores.pdb_ids_valid, valid: pdbValid, checked: 2 };

  // Component 2: rmsd_plausible (0.30)
  const rmsd = result.rmsd as number | undefined;
  if (rmsd != null) {
    let rmsdScore: number;
    if (rmsd >= 0 && rmsd <= 50) rmsdScore = 1.0;
    else if (rmsd < 0) rmsdScore = 0.0;
    else rmsdScore = 0.3;
    componentScores.rmsd_plausible = rmsdScore;
    details.rmsd_plausible = { score: rmsdScore, rmsd };
  } else {
    componentScores.rmsd_plausible = 0.5;
    details.rmsd_plausible = { score: 0.5, note: "No RMSD claimed" };
  }

  // Component 3: tm_score_consistent (0.20)
  const tmScore = result.tm_score as number | undefined;
  if (tmScore != null) {
    const valid = tmScore >= 0 && tmScore <= 1;
    componentScores.tm_score_consistent = valid ? 1.0 : 0.0;
    details.tm_score_consistent = { score: componentScores.tm_score_consistent, tm_score: tmScore };
  } else {
    componentScores.tm_score_consistent = 0.5;
    details.tm_score_consistent = { score: 0.5, note: "No TM-score claimed" };
  }

  // Component 4: alignment_plausible (0.20)
  const alignLength = result.alignment_length as number | undefined;
  if (alignLength != null && alignLength > 0) {
    componentScores.alignment_plausible = 1.0;
    details.alignment_plausible = { score: 1.0, alignment_length: alignLength };
  } else {
    componentScores.alignment_plausible = 0.5;
    details.alignment_plausible = { score: 0.5, note: "No alignment length" };
  }

  const weights: Record<string, number> = {
    pdb_ids_valid: 0.30,
    rmsd_plausible: 0.30,
    tm_score_consistent: 0.20,
    alignment_plausible: 0.20,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("computational_biology", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────

const VALID_AA = new Set("ACDEFGHIKLMNPQRSTVWY".split(""));

function checkSequenceValid(seq: string): { score: number; [k: string]: unknown } {
  if (!seq) return { score: 0.0, error: "No sequence" };
  const upper = seq.toUpperCase();
  const invalid = [...upper].filter((aa) => !VALID_AA.has(aa)).length;
  const fracValid = (upper.length - invalid) / upper.length;
  return {
    score: fracValid === 1.0 ? 1.0 : round4(fracValid * 0.5),
    length: upper.length,
    invalid_residues: invalid,
    fraction_valid: round4(fracValid),
  };
}

function checkMetricsPlausibility(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const plddt = result.plddt as number | undefined;
  const ptm = result.ptm as number | undefined;
  const issues: string[] = [];
  let score = 1.0;

  if (plddt != null) {
    if (plddt < 0 || plddt > 100) { issues.push(`pLDDT ${plddt} outside [0,100]`); score -= 0.5; }
    else if (plddt > 95) { issues.push(`pLDDT ${plddt} suspiciously high`); score -= 0.2; }
  }
  if (ptm != null) {
    if (ptm < 0 || ptm > 1) { issues.push(`pTM ${ptm} outside [0,1]`); score -= 0.5; }
    else if (ptm > 0.95) { issues.push(`pTM ${ptm} suspiciously high`); score -= 0.2; }
  }

  score = Math.max(0, score);
  if (plddt == null && ptm == null) return { score: 0.5, note: "No metrics to check" };
  return { score: round4(score), issues };
}

function checkDotBracket(db: string, seq: string): { score: number; [k: string]: unknown } {
  if (!db) return { score: 0.0, error: "No dot-bracket notation" };

  // Length match
  if (seq && db.length !== seq.length) {
    return { score: 0.2, error: "Length mismatch between sequence and structure" };
  }

  // Balanced brackets
  let depth = 0;
  for (const ch of db) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return { score: 0.0, error: "Unbalanced brackets" };
  }
  if (depth !== 0) return { score: 0.0, error: "Unbalanced brackets" };

  return { score: 1.0, length: db.length, n_pairs: db.split("(").length - 1 };
}

function checkBasePairs(db: string, seq: string): { score: number; [k: string]: unknown } {
  if (!db || !seq || db.length !== seq.length) {
    return { score: 0.5, note: "Cannot check base pairs" };
  }

  const canonical = new Set(["AU", "UA", "GC", "CG", "GU", "UG"]);
  const stack: number[] = [];
  let validPairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < db.length; i++) {
    if (db[i] === "(") {
      stack.push(i);
    } else if (db[i] === ")") {
      if (stack.length === 0) continue;
      const j = stack.pop()!;
      totalPairs++;
      const pair = seq[j].toUpperCase() + seq[i].toUpperCase();
      if (canonical.has(pair.replace("T", "U"))) validPairs++;
    }
  }

  if (totalPairs === 0) return { score: 0.5, note: "No base pairs" };
  return {
    score: round4(validPairs / totalPairs),
    valid_pairs: validPairs,
    total_pairs: totalPairs,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
