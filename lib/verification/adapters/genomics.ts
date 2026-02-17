/**
 * Genomics Domain Adapter
 *
 * Verifies genomics claims: variant annotations, gene expression results,
 * and GWAS associations using MyVariant.info, Ensembl, NCBI, and EBI APIs.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { fetchJson } from "../utils/http-client";

const DOMAIN = "genomics";

const MYVARIANT_API = "https://myvariant.info/v1";
const ENSEMBL_API = "https://rest.ensembl.org";
const NCBI_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const GWAS_API = "https://www.ebi.ac.uk/gwas/rest/api";

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

function extractNested(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "").trim();
}

// ── Variant Annotation ───────────────────────────────────────────────────

async function verifyVariantAnnotation(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const variantId = str(taskResult.variant_id || taskResult.rsid || taskResult.hgvs);
  if (!variantId) {
    return { score: 0, details: { error: "No variant ID provided" }, warnings, errors: ["Missing variant_id"] };
  }

  // Component 1: variant_exists (0.25)
  const mvFields = "dbsnp.rsid,clinvar.rcv.clinical_significance,dbsnp.gene.symbol,cadd.gene.genename,gnomad_genome.af.af";
  const mvRes = await fetchJson<Record<string, unknown>>(
    `${MYVARIANT_API}/variant/${encodeURIComponent(variantId)}?fields=${mvFields}`,
  );

  let mvData: Record<string, unknown> | null = null;
  if (mvRes.ok && mvRes.data && !mvRes.data.notfound) {
    componentScores.variant_exists = 1.0;
    mvData = mvRes.data;
    details.variant_source = "myvariant";
  } else {
    // Fallback to NCBI dbSNP
    const rsid = variantId.startsWith("rs") ? variantId : "";
    if (rsid) {
      const ncbiRes = await fetchJson<Record<string, unknown>>(
        `${NCBI_ESEARCH}?db=snp&term=${encodeURIComponent(rsid)}&retmode=json`,
      );
      const count = num(extractNested(ncbiRes.data, "esearchresult.count"));
      componentScores.variant_exists = count > 0 ? 0.8 : 0.0;
      details.variant_source = count > 0 ? "ncbi_dbsnp" : "not_found";
    } else {
      componentScores.variant_exists = 0.0;
      details.variant_source = "not_found";
      errors.push(`Variant ${variantId} not found in MyVariant.info or NCBI`);
    }
  }

  // Component 2: consequence_match (0.25)
  const claimedConsequence = str(taskResult.consequence || taskResult.variant_consequence);
  if (claimedConsequence) {
    const rsid = variantId.startsWith("rs") ? variantId : "";
    const hgvs = variantId.includes(":") ? variantId : "";
    let vepUrl = "";
    if (rsid) {
      vepUrl = `${ENSEMBL_API}/vep/human/id/${encodeURIComponent(rsid)}?content-type=application/json`;
    } else if (hgvs) {
      vepUrl = `${ENSEMBL_API}/vep/human/hgvs/${encodeURIComponent(hgvs)}?content-type=application/json`;
    }

    if (vepUrl) {
      const vepRes = await fetchJson<Array<Record<string, unknown>>>(vepUrl, {
        headers: { "Content-Type": "application/json" },
      });
      if (vepRes.ok && Array.isArray(vepRes.data) && vepRes.data.length > 0) {
        const allConsequences: string[] = [];
        for (const entry of vepRes.data) {
          const transcripts = entry.transcript_consequences;
          if (Array.isArray(transcripts)) {
            for (const tc of transcripts) {
              const terms = (tc as Record<string, unknown>).consequence_terms;
              if (Array.isArray(terms)) {
                allConsequences.push(...terms.map(String));
              }
            }
          }
        }
        const normClaimed = normalise(claimedConsequence);
        const match = allConsequences.some((c) => normalise(c) === normClaimed);
        componentScores.consequence_match = match ? 1.0 : 0.2;
        details.consequence_match = { claimed: claimedConsequence, found: [...new Set(allConsequences)], match };
      } else {
        componentScores.consequence_match = 0.5;
        details.consequence_match = { note: "VEP query failed or no data" };
        warnings.push("Could not verify consequence via Ensembl VEP");
      }
    } else {
      componentScores.consequence_match = 0.5;
      details.consequence_match = { note: "No rsID or HGVS to query VEP" };
    }
  } else {
    componentScores.consequence_match = 0.5;
    details.consequence_match = { note: "No claimed consequence to verify" };
  }

  // Component 3: gene_match (0.20)
  const claimedGene = str(taskResult.gene || taskResult.gene_symbol);
  if (claimedGene && mvData) {
    const geneSymbol = str(extractNested(mvData, "dbsnp.gene.symbol") ?? extractNested(mvData, "cadd.gene.genename"));
    const geneList = Array.isArray(geneSymbol) ? geneSymbol.map(String) : [geneSymbol];
    const match = geneList.some((g) => normalise(g) === normalise(claimedGene));
    componentScores.gene_match = match ? 1.0 : 0.2;
    details.gene_match = { claimed: claimedGene, found: geneList, match };
  } else if (claimedGene) {
    componentScores.gene_match = 0.5;
    details.gene_match = { note: "No MyVariant data to check gene" };
  } else {
    componentScores.gene_match = 0.5;
    details.gene_match = { note: "No claimed gene to verify" };
  }

  // Component 4: clinical_significance (0.15)
  const claimedSignificance = str(taskResult.clinical_significance);
  if (claimedSignificance && mvData) {
    const clinvar = extractNested(mvData, "clinvar.rcv.clinical_significance");
    const sigList = Array.isArray(clinvar) ? clinvar.map(String) : clinvar ? [String(clinvar)] : [];
    const match = sigList.some((s) => normalise(s) === normalise(claimedSignificance));
    componentScores.clinical_significance = match ? 1.0 : sigList.length > 0 ? 0.3 : 0.5;
    details.clinical_significance = { claimed: claimedSignificance, found: sigList, match };
  } else {
    componentScores.clinical_significance = 0.5;
    details.clinical_significance = { note: "No clinical significance to verify" };
  }

  // Component 5: population_frequency (0.15)
  const claimedMaf = taskResult.maf ?? taskResult.allele_frequency ?? taskResult.population_frequency;
  if (claimedMaf != null && mvData) {
    const gnomadAf = num(extractNested(mvData, "gnomad_genome.af.af"), -1);
    if (gnomadAf >= 0) {
      const claimed = num(claimedMaf);
      const tolerance = Math.max(gnomadAf * 0.2, 0.001);
      const diff = Math.abs(claimed - gnomadAf);
      componentScores.population_frequency = diff <= tolerance ? 1.0 : diff <= tolerance * 3 ? 0.5 : 0.2;
      details.population_frequency = { claimed, gnomad: gnomadAf, diff: round4(diff), tolerance: round4(tolerance) };
    } else {
      componentScores.population_frequency = 0.5;
      details.population_frequency = { note: "No gnomAD frequency data available" };
    }
  } else {
    componentScores.population_frequency = 0.5;
    details.population_frequency = { note: "No MAF claimed or no data" };
  }

  const weights: Record<string, number> = {
    variant_exists: 0.25,
    consequence_match: 0.25,
    gene_match: 0.20,
    clinical_significance: 0.15,
    population_frequency: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Gene Expression ──────────────────────────────────────────────────────

async function verifyGeneExpression(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // Component 1: gene_exists (0.20)
  const gene = str(taskResult.gene || taskResult.gene_symbol);
  if (gene) {
    const res = await fetchJson<Record<string, unknown>>(
      `${ENSEMBL_API}/lookup/symbol/homo_sapiens/${encodeURIComponent(gene)}?content-type=application/json`,
    );
    if (res.ok && res.data) {
      componentScores.gene_exists = 1.0;
      details.gene = { symbol: gene, ensembl_id: res.data.id };
    } else {
      componentScores.gene_exists = 0.0;
      details.gene = { symbol: gene, found: false };
      errors.push(`Gene ${gene} not found in Ensembl`);
    }
  } else {
    componentScores.gene_exists = 0.5;
    details.gene = { note: "No gene provided" };
  }

  // Component 2: dataset_exists (0.25)
  const datasetId = str(taskResult.dataset_id || taskResult.accession);
  if (datasetId) {
    if (datasetId.startsWith("GSE") || datasetId.startsWith("GPL") || datasetId.startsWith("GSM")) {
      const res = await fetchJson<Record<string, unknown>>(
        `${NCBI_ESEARCH}?db=gds&term=${encodeURIComponent(datasetId)}&retmode=json`,
      );
      const count = num(extractNested(res.data, "esearchresult.count"));
      componentScores.dataset_exists = count > 0 ? 1.0 : 0.0;
      details.dataset = { id: datasetId, source: "GEO", found: count > 0 };
    } else if (datasetId.startsWith("E-")) {
      const res = await fetchJson<Record<string, unknown>>(
        `https://www.ebi.ac.uk/biostudies/api/v1/studies/${encodeURIComponent(datasetId)}`,
      );
      componentScores.dataset_exists = res.ok ? 1.0 : 0.0;
      details.dataset = { id: datasetId, source: "BioStudies", found: res.ok };
    } else {
      componentScores.dataset_exists = 0.5;
      details.dataset = { id: datasetId, note: "Unknown dataset prefix" };
      warnings.push(`Unknown dataset prefix for ${datasetId}`);
    }
  } else {
    componentScores.dataset_exists = 0.5;
    details.dataset = { note: "No dataset ID provided" };
  }

  // Component 3: expression_range (0.25)
  const foldChange = num(taskResult.fold_change ?? taskResult.log2_fold_change, NaN);
  if (Number.isFinite(foldChange)) {
    const absFc = Math.abs(foldChange);
    if (absFc >= 0.1 && absFc <= 100) {
      componentScores.expression_range = 1.0;
    } else if (absFc >= 0.01 && absFc <= 1000) {
      componentScores.expression_range = 0.5;
    } else {
      componentScores.expression_range = 0.1;
      warnings.push(`Fold change ${foldChange} seems implausible`);
    }
    details.expression_range = { fold_change: foldChange, plausible: componentScores.expression_range >= 0.5 };
  } else {
    componentScores.expression_range = 0.5;
    details.expression_range = { note: "No fold change provided" };
  }

  // Component 4: statistics_valid (0.30)
  const pValue = taskResult.p_value ?? taskResult.pvalue;
  if (pValue != null) {
    const p = num(pValue, -1);
    if (p >= 0 && p <= 1) {
      componentScores.statistics_valid = 1.0;
      details.statistics = { p_value: p, valid: true };
    } else {
      componentScores.statistics_valid = 0.0;
      details.statistics = { p_value: pValue, valid: false };
      errors.push(`p-value ${pValue} out of [0, 1] range`);
    }
  } else {
    componentScores.statistics_valid = 0.5;
    details.statistics = { note: "No p-value provided, returning neutral" };
  }

  const weights: Record<string, number> = {
    gene_exists: 0.20,
    dataset_exists: 0.25,
    expression_range: 0.25,
    statistics_valid: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── GWAS Association ─────────────────────────────────────────────────────

async function verifyGwasAssociation(
  taskResult: Record<string, unknown>,
): Promise<{ score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] }> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];

  const rsid = str(taskResult.rsid || taskResult.variant_id);

  // Component 1: variant_exists (0.20)
  if (rsid) {
    const mvRes = await fetchJson<Record<string, unknown>>(
      `${MYVARIANT_API}/variant/${encodeURIComponent(rsid)}?fields=dbsnp.rsid`,
    );
    if (mvRes.ok && mvRes.data && !mvRes.data.notfound) {
      componentScores.variant_exists = 1.0;
      details.variant = { rsid, found: true };
    } else {
      componentScores.variant_exists = 0.0;
      details.variant = { rsid, found: false };
      errors.push(`Variant ${rsid} not found`);
    }
  } else {
    componentScores.variant_exists = 0.5;
    details.variant = { note: "No rsID provided" };
  }

  // Component 2: gwas_catalog_match (0.30)
  if (rsid && rsid.startsWith("rs")) {
    const gwasRes = await fetchJson<Record<string, unknown>>(
      `${GWAS_API}/singleNucleotidePolymorphisms/${encodeURIComponent(rsid)}/associations`,
    );
    if (gwasRes.ok && gwasRes.data) {
      const embedded = gwasRes.data._embedded as Record<string, unknown> | undefined;
      const associations = embedded?.associations;
      const assocCount = Array.isArray(associations) ? associations.length : 0;
      componentScores.gwas_catalog_match = assocCount > 0 ? 1.0 : 0.3;
      details.gwas_catalog = { rsid, associations_found: assocCount };
    } else {
      componentScores.gwas_catalog_match = 0.3;
      details.gwas_catalog = { rsid, note: "GWAS catalog query failed", error: gwasRes.error };
      warnings.push("GWAS Catalog API query unsuccessful");
    }
  } else {
    componentScores.gwas_catalog_match = 0.5;
    details.gwas_catalog = { note: "No rsID for GWAS catalog lookup" };
  }

  // Component 3: pvalue_plausible (0.25)
  const pVal = taskResult.p_value ?? taskResult.pvalue;
  if (pVal != null) {
    const p = num(pVal, -1);
    if (p < 0 || p > 1) {
      componentScores.pvalue_plausible = 0.0;
      errors.push(`p-value ${pVal} out of valid range`);
    } else if (p <= 5e-8) {
      componentScores.pvalue_plausible = 1.0;
    } else if (p <= 1e-5) {
      componentScores.pvalue_plausible = 0.7;
    } else if (p <= 0.05) {
      componentScores.pvalue_plausible = 0.4;
    } else {
      componentScores.pvalue_plausible = 0.2;
    }
    details.pvalue = { value: p, score: componentScores.pvalue_plausible };
  } else {
    componentScores.pvalue_plausible = 0.5;
    details.pvalue = { note: "No p-value provided" };
  }

  // Component 4: effect_size_plausible (0.25)
  const oddsRatio = taskResult.odds_ratio ?? taskResult.or ?? taskResult.effect_size;
  if (oddsRatio != null) {
    const or = num(oddsRatio, -1);
    if (or > 0) {
      if (or >= 0.5 && or <= 5.0) {
        componentScores.effect_size_plausible = 1.0;
      } else if (or >= 0.1 && or <= 20) {
        componentScores.effect_size_plausible = 0.5;
      } else {
        componentScores.effect_size_plausible = 0.1;
        warnings.push(`Odds ratio ${or} seems extreme`);
      }
      details.effect_size = { odds_ratio: or, score: componentScores.effect_size_plausible };
    } else {
      componentScores.effect_size_plausible = 0.2;
      details.effect_size = { value: oddsRatio, note: "Invalid odds ratio" };
    }
  } else {
    componentScores.effect_size_plausible = 0.5;
    details.effect_size = { note: "No effect size provided" };
  }

  const weights: Record<string, number> = {
    variant_exists: 0.20,
    gwas_catalog_match: 0.30,
    pvalue_plausible: 0.25,
    effect_size_plausible: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * (componentScores[k] ?? 0.5),
    0,
  );

  details.component_scores = componentScores;
  return { score: round4(score), details, warnings, errors };
}

// ── Adapter Export ────────────────────────────────────────────────────────

export const genomicsAdapter: DomainAdapter = {
  domain: DOMAIN,

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = str(taskResult.claim_type || taskMetadata.claim_type);

    try {
      let result: { score: number; details: Record<string, unknown>; warnings: string[]; errors: string[] };

      switch (claimType) {
        case "variant_annotation":
          result = await verifyVariantAnnotation(taskResult);
          break;
        case "gene_expression":
          result = await verifyGeneExpression(taskResult);
          break;
        case "gwas_association":
          result = await verifyGwasAssociation(taskResult);
          break;
        default:
          return failResult(DOMAIN, [`Unsupported genomics claim type: ${claimType}`]);
      }

      const elapsed = (performance.now() - start) / 1000;
      return successResult(DOMAIN, result.score, { claim_type: claimType, ...result.details }, {
        warnings: result.warnings,
        errors: result.errors,
        compute_time_seconds: elapsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return failResult(DOMAIN, [`Genomics verification failed: ${message}`]);
    }
  },
};
