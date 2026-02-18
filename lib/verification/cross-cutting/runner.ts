/**
 * Cross-cutting verifier runner.
 *
 * Collects all registered verifiers, filters to applicable ones,
 * runs them concurrently, and returns results.
 */
import type { CrossCuttingResult, CrossCuttingVerifier } from "../types";
import { ccResult } from "../types";
import { citationVerifier } from "./citation-verifier";
import { statisticalForensicsVerifier } from "./statistical-forensics";
import { dataIntegrityVerifier } from "./data-integrity";
import { reproducibilityVerifier } from "./reproducibility";

const CC_VERIFIERS: CrossCuttingVerifier[] = [
  citationVerifier,
  statisticalForensicsVerifier,
  dataIntegrityVerifier,
  reproducibilityVerifier,
];

const CC_TIMEOUT_MS = 120_000;

/**
 * Run all applicable cross-cutting verifiers concurrently.
 */
export async function runCrossCutting(
  taskResult: Record<string, unknown>,
  taskMetadata: Record<string, unknown>,
): Promise<CrossCuttingResult[]> {
  const applicable = CC_VERIFIERS.filter((v) => {
    try {
      return v.isApplicable(taskResult);
    } catch {
      return false;
    }
  });

  if (applicable.length === 0) return [];

  const runSingle = async (v: CrossCuttingVerifier): Promise<CrossCuttingResult> => {
    const start = performance.now();
    try {
      const result = await v.verify(taskResult, taskMetadata);
      result.compute_time_seconds = (performance.now() - start) / 1000;
      return result;
    } catch (err: unknown) {
      return ccResult(v.name, v.weight, 0, {}, {
        errors: [`Verifier crashed: ${err instanceof Error ? err.message : String(err)}`],
        compute_time_seconds: (performance.now() - start) / 1000,
      });
    }
  };

  // Race all verifiers against a global timeout
  const results = await Promise.race([
    Promise.allSettled(applicable.map(runSingle)),
    new Promise<PromiseSettledResult<CrossCuttingResult>[]>((resolve) =>
      setTimeout(() => resolve([]), CC_TIMEOUT_MS),
    ),
  ]);

  return results
    .filter((r): r is PromiseFulfilledResult<CrossCuttingResult> => r.status === "fulfilled")
    .map((r) => r.value);
}
