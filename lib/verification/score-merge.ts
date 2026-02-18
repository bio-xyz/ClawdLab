/**
 * Score merge algorithm.
 *
 * Combines domain adapter result with cross-cutting verifier results
 * using a weighted formula:
 *
 *   final = domainWeight × domainScore + (1 − domainWeight) × ccWeightedAvg
 *
 * Where ccWeightedAvg normalizes cross-cutting weights to sum to 1.0.
 */
import type { VerificationResult, CrossCuttingResult } from "./types";
import { scoreToBadge } from "./types";

export function mergeResults(
  domainResult: VerificationResult,
  ccResults: CrossCuttingResult[],
  domainWeight: number = 0.70,
): VerificationResult {
  if (ccResults.length === 0) return domainResult;

  const totalCcWeight = ccResults.reduce((s, r) => s + r.weight, 0);
  if (totalCcWeight <= 0) return domainResult;

  const ccWeightShare = 1.0 - domainWeight;
  const ccScore = ccResults.reduce(
    (s, r) => s + (r.weight / totalCcWeight) * r.score,
    0,
  );

  const finalScore = Math.min(1.0, round4(
    domainWeight * domainResult.score + ccWeightShare * ccScore,
  ));

  // Merge warnings, errors, and details
  const allWarnings = [...domainResult.warnings];
  const allErrors = [...domainResult.errors];
  const ccDetails: Record<string, unknown>[] = [];

  for (const r of ccResults) {
    allWarnings.push(...r.warnings);
    allErrors.push(...r.errors);
    ccDetails.push({
      verifier: r.verifier_name,
      score: r.score,
      weight: r.weight,
      details: r.details,
      errors: r.errors,
      warnings: r.warnings,
      compute_time_seconds: r.compute_time_seconds,
    });
  }

  const mergedDetails: Record<string, unknown> = { ...domainResult.details };
  mergedDetails.cross_cutting = ccDetails;
  mergedDetails.scoring = {
    domain_score: domainResult.score,
    domain_weight: domainWeight,
    cc_aggregate_score: round4(ccScore),
    cc_weight_share: ccWeightShare,
    final_score: finalScore,
  };

  return {
    passed: finalScore >= 0.5,
    score: finalScore,
    badge: scoreToBadge(finalScore),
    domain: domainResult.domain,
    details: mergedDetails,
    errors: allErrors,
    warnings: allWarnings,
    compute_time_seconds: domainResult.compute_time_seconds +
      ccResults.reduce((s, r) => s + r.compute_time_seconds, 0),
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
