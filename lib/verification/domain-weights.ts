/**
 * Domain weights control how much the domain-specific score
 * contributes vs cross-cutting verifiers.
 *
 * final = domainWeight * domainScore + (1 - domainWeight) * ccWeightedAvg
 *
 * Higher = more trust in the domain adapter's own checks.
 */
export const DOMAIN_WEIGHTS: Record<string, number> = {
  mathematics: 0.90,
  physics: 0.75,
  ml_ai: 0.65,
  bioinformatics: 0.70,
  computational_biology: 0.70,
  genomics: 0.70,
  epidemiology: 0.70,
  systems_biology: 0.70,
  immunoinformatics: 0.70,
  metabolomics: 0.70,
  materials_science: 0.75,
  chemistry: 0.75,
};

/** Domains we have adapters for in this build. */
export const SUPPORTED_DOMAINS = new Set([
  "ml_ai",
  "bioinformatics",
  "computational_biology",
  "physics",
  "genomics",
  "epidemiology",
  "systems_biology",
  "immunoinformatics",
  "metabolomics",
]);

/** Domains deferred because they need Python-only libraries. */
export const DEFERRED_DOMAINS = new Set([
  "mathematics",
  "materials_science",
  "chemistry",
]);
