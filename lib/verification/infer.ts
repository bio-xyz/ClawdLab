/**
 * Domain and claim_type inference from task result field patterns.
 *
 * Pure functions, no async, no side effects.
 * Used by the verify route and individual adapters to auto-detect
 * domain/claim_type when agents omit them.
 */

// ── Domain Signature Fields ──────────────────────────────────────────────
// Ordered from most specific to most general.
// inferDomain scores each domain by counting non-null signature field matches.

const DOMAIN_SIGNATURES: [string, string[]][] = [
  ["immunoinformatics", ["epitope", "hla_allele", "mhc_class", "ic50", "binding_affinity", "allele"]],
  ["metabolomics", ["hmdb_id", "inchikey", "precursor_mz", "adduct", "peaks", "fragments"]],
  ["genomics", ["variant_id", "rsid", "hgvs", "allele_frequency", "clinical_significance"]],
  ["epidemiology", ["contingency_table", "odds_ratio", "hazard_ratio", "survival_times", "incidence"]],
  ["systems_biology", ["pathway_id", "kegg_pathway", "stoichiometry_matrix", "flux", "edges", "interactions"]],
  ["computational_biology", ["pdb_id", "plddt", "ptm", "dot_bracket", "rmsd", "tm_score"]],
  ["bioinformatics", ["sequence", "fasta", "alignment_score", "e_value", "identity", "query_coverage"]],
  ["physics", ["conserved_quantities", "time_series", "convergence_errors", "boundary_conditions", "dimensionless_groups"]],
  ["ml_ai", ["model_id", "benchmark", "metrics", "layers", "param_count"]],
];

// ── Claim Type Signature Fields ──────────────────────────────────────────
// Per-domain claim type detection, derived from what each adapter actually reads.

const CLAIM_TYPE_SIGNATURES: Record<string, [string, string[]][]> = {
  genomics: [
    ["variant_annotation", ["variant_id", "rsid", "hgvs", "consequence"]],
    ["gene_expression", ["fold_change", "log2_fold_change", "dataset_id", "accession"]],
    ["gwas_association", ["odds_ratio", "gwas", "effect_size"]],
  ],
  bioinformatics: [
    ["alignment", ["alignment_score", "query", "subject", "gap_percentage"]],
    ["pipeline_validation", ["tools", "pipeline_steps", "software", "steps"]],
    ["sequence_analysis", ["sequence", "fasta", "sequence_id", "e_value"]],
  ],
  systems_biology: [
    ["flux_balance", ["stoichiometry_matrix", "flux", "flux_values", "bounds"]],
    ["network_topology", ["edges", "interactions", "hubs", "proteins", "nodes"]],
    ["pathway_enrichment", ["pathway_id", "genes", "gene_set", "fdr"]],
  ],
  immunoinformatics: [
    ["mhc_binding", ["mhc_class", "ic50", "binding_affinity", "classification"]],
    ["bcell_epitope", ["bcell", "bepipred", "surface_accessibility"]],
    ["epitope_prediction", ["epitope", "peptide", "allele", "hla_allele"]],
  ],
  metabolomics: [
    ["spectral_match", ["precursor_mz", "peaks", "fragments", "peak_list"]],
    ["pathway_mapping", ["pathway_id", "kegg_pathway", "compound_id"]],
    ["compound_identification", ["hmdb_id", "inchikey", "compound_name"]],
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────

function hasField(result: Record<string, unknown>, field: string): boolean {
  return result[field] != null;
}

function countMatches(result: Record<string, unknown>, fields: string[]): number {
  return fields.filter((f) => hasField(result, f)).length;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Infer the scientific domain from task result field patterns.
 *
 * Scores each domain by counting how many of its "signature fields"
 * appear (non-null) in the result. Requires minimum 2 field matches
 * to avoid false positives. Tie-breaks by array ordering (more-specific
 * domains listed first).
 *
 * @returns domain string or null if no confident match
 */
export function inferDomain(taskResult: Record<string, unknown>): string | null {
  let bestDomain: string | null = null;
  let bestCount = 0;

  for (const [domain, fields] of DOMAIN_SIGNATURES) {
    const count = countMatches(taskResult, fields);
    if (count >= 2 && count > bestCount) {
      bestCount = count;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Infer the claim type within a known domain from task result field patterns.
 *
 * Per-domain claim type signatures are derived from what each adapter actually
 * reads. Minimum 1 field match (already scoped to a known domain).
 *
 * Claim types are ordered specific → general within each domain so fallback
 * types (sequence_analysis, pathway_enrichment, etc.) only match when more
 * specific types don't.
 *
 * @returns claim type string or null if no match
 */
export function inferClaimType(
  domain: string,
  taskResult: Record<string, unknown>,
): string | null {
  const signatures = CLAIM_TYPE_SIGNATURES[domain];
  if (!signatures) return null;

  let bestType: string | null = null;
  let bestCount = 0;

  for (const [claimType, fields] of signatures) {
    const count = countMatches(taskResult, fields);
    if (count >= 1 && count > bestCount) {
      bestCount = count;
      bestType = claimType;
    }
  }

  return bestType;
}
