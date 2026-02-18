/**
 * Cross-cutting verifier: Data Integrity Checks.
 *
 * Validates data quality via schema validation, duplicate detection,
 * outlier flagging, and hash verification.
 */
import type { CrossCuttingResult, CrossCuttingVerifier } from "../types";
import { ccResult } from "../types";

export const dataIntegrityVerifier: CrossCuttingVerifier = {
  name: "data_integrity",
  weight: 0.10,

  isApplicable(taskResult) {
    const keys = ["data", "dataset", "raw_data", "results_summary", "output_checksums"];
    return keys.some((k) => taskResult[k]);
  },

  async verify(taskResult, taskMetadata): Promise<CrossCuttingResult> {
    const start = performance.now();

    const componentScores: Record<string, number> = {};
    const details: Record<string, unknown> = {};
    const warnings: string[] = [];

    const data = extractData(taskResult);
    const checksums = taskResult.output_checksums as Record<string, string> | undefined;
    const schemaDef = (taskResult.schema ?? taskResult.expected_schema) as Record<string, unknown> | undefined;

    const schemaResult = data ? checkSchema(data, schemaDef) : neutral("No data for schema check");
    const dupResult = data ? checkDuplicates(data) : neutral("No data for duplicate check");
    const outlierResult = data ? checkOutliers(data) : neutral("No data for outlier check");
    const hashResult = checksums ? checkHashes(taskResult, checksums) : neutral("No checksums");

    for (const [name, result] of [
      ["schema_valid", schemaResult],
      ["no_duplicates", dupResult],
      ["no_outliers", outlierResult],
      ["hash_match", hashResult],
    ] as const) {
      componentScores[name] = (result as { score: number }).score;
      details[name] = result;
      const w = (result as { warnings?: string[] }).warnings;
      if (w) warnings.push(...w);
    }

    const applicable = Object.keys(componentScores).filter(
      (k) => (details[k] as { applicable?: boolean }).applicable !== false,
    );
    const score = applicable.length > 0
      ? applicable.reduce((s, k) => s + componentScores[k], 0) / applicable.length
      : 0.5;

    details.component_scores = componentScores;

    return ccResult(this.name, this.weight, round4(score), details, {
      warnings,
      compute_time_seconds: (performance.now() - start) / 1000,
    });
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function neutral(note: string): Record<string, unknown> {
  return { score: 0.5, applicable: false, note };
}

function extractData(taskResult: Record<string, unknown>): Record<string, unknown>[] | null {
  for (const key of ["data", "dataset", "raw_data"]) {
    const raw = taskResult[key];
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && raw[0] !== null) {
      return raw as Record<string, unknown>[];
    }
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.rows)) return obj.rows as Record<string, unknown>[];
      if (Array.isArray(obj.records)) return obj.records as Record<string, unknown>[];
    }
  }

  const summary = taskResult.results_summary;
  if (typeof summary === "object" && summary !== null) {
    const numericVals: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(summary as Record<string, unknown>)) {
      if (typeof v === "number") numericVals[k] = v;
    }
    if (Object.keys(numericVals).length > 0) return [numericVals];
  }

  return null;
}

function checkSchema(
  data: Record<string, unknown>[],
  schemaDef?: Record<string, unknown>,
): Record<string, unknown> {
  if (data.length === 0) return { score: 0.5, applicable: false, note: "No data" };

  if (schemaDef) {
    const fields = (schemaDef.fields ?? schemaDef.columns) as string[] | undefined;
    if (Array.isArray(fields) && fields.length > 0) {
      const expected = new Set(fields);
      const actual = new Set(Object.keys(data[0]));
      const missing = [...expected].filter((f) => !actual.has(f));
      const extra = [...actual].filter((f) => !expected.has(f));
      const coverage = (expected.size - missing.length) / expected.size;
      return {
        score: round4(coverage),
        applicable: true,
        expected_fields: [...expected].sort(),
        missing_fields: missing.sort(),
        extra_fields: extra.sort(),
      };
    }
  }

  if (data.length < 2) {
    return { score: 1.0, applicable: true, note: "Single row, schema consistent" };
  }

  const refKeys = new Set(Object.keys(data[0]));
  let inconsistent = 0;
  for (let i = 1; i < data.length; i++) {
    const keys = new Set(Object.keys(data[i]));
    if (keys.size !== refKeys.size || [...keys].some((k) => !refKeys.has(k))) {
      inconsistent++;
      if (inconsistent >= 5) break;
    }
  }

  const score = 1.0 - inconsistent / Math.min(data.length - 1, 100);
  return {
    score: round4(Math.max(0, score)),
    applicable: true,
    total_rows: data.length,
    inconsistent_rows: inconsistent,
    columns: [...refKeys].sort(),
  };
}

function checkDuplicates(data: Record<string, unknown>[]): Record<string, unknown> {
  if (data.length < 2) return { score: 1.0, applicable: true, duplicates: 0 };

  const seen = new Set<string>();
  let exactDupes = 0;

  for (const row of data) {
    const key = JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
    if (seen.has(key)) exactDupes++;
    else seen.add(key);
  }

  const dupRatio = exactDupes / data.length;
  let score: number;
  if (dupRatio > 0.5) score = 0.1;
  else if (dupRatio > 0.2) score = 0.4;
  else if (dupRatio > 0.05) score = 0.7;
  else score = 1.0;

  return {
    score: round4(score),
    applicable: true,
    total_rows: data.length,
    exact_duplicates: exactDupes,
    duplicate_ratio: round4(dupRatio),
    warnings: exactDupes > 0 ? [`${exactDupes} exact duplicate rows detected`] : [],
  };
}

function checkOutliers(data: Record<string, unknown>[]): Record<string, unknown> {
  if (data.length === 0) return { score: 0.5, applicable: false, note: "No data" };

  const numericCols: Record<string, number[]> = {};
  for (const row of data) {
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        (numericCols[k] ??= []).push(v);
      }
    }
  }

  if (Object.keys(numericCols).length === 0) {
    return { score: 0.5, applicable: false, note: "No numeric columns" };
  }

  const outlierCounts: Record<string, number> = {};
  let totalValues = 0;
  let totalOutliers = 0;

  for (const [col, values] of Object.entries(numericCols)) {
    if (values.length < 5) continue;
    totalValues += values.length;

    const m = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;

    const nOutliers = values.filter((x) => Math.abs((x - m) / std) > 3.0).length;
    if (nOutliers > 0) {
      outlierCounts[col] = nOutliers;
      totalOutliers += nOutliers;
    }
  }

  if (totalValues === 0) {
    return { score: 0.5, applicable: false, note: "Insufficient numeric data" };
  }

  const outlierRatio = totalOutliers / totalValues;
  let score: number;
  if (outlierRatio > 0.10) score = 0.2;
  else if (outlierRatio > 0.05) score = 0.5;
  else if (outlierRatio > 0.01) score = 0.8;
  else score = 1.0;

  return {
    score: round4(score),
    applicable: true,
    columns_checked: Object.keys(numericCols).length,
    total_values: totalValues,
    total_outliers: totalOutliers,
    outlier_ratio: Math.round(outlierRatio * 1000000) / 1000000,
    outlier_columns: outlierCounts,
    warnings: outlierRatio > 0.05
      ? [`High outlier ratio (${(outlierRatio * 100).toFixed(1)}%) in columns: ${Object.keys(outlierCounts).join(", ")}`]
      : [],
  };
}

function checkHashes(
  taskResult: Record<string, unknown>,
  checksums: Record<string, string>,
): Record<string, unknown> {
  const checks: Record<string, unknown>[] = [];
  let matches = 0;
  let mismatches = 0;

  for (const [key, expectedHash] of Object.entries(checksums)) {
    let dataBlob = taskResult[key];
    if (dataBlob == null) {
      for (const containerKey of ["data", "raw_data", "dataset"]) {
        const container = taskResult[containerKey];
        if (typeof container === "object" && container !== null && key in container) {
          dataBlob = (container as Record<string, unknown>)[key];
          break;
        }
      }
    }

    if (dataBlob == null) {
      checks.push({ key, match: false, note: "Data not found" });
      mismatches++;
      continue;
    }

    const serialized = typeof dataBlob === "object"
      ? JSON.stringify(dataBlob, Object.keys(dataBlob as object).sort(), "")
      : String(dataBlob);

    // Use Web Crypto (sync SHA-256 not available in all runtimes)
    // Fall back to simple hash comparison format
    const actualHash = simpleHash(serialized);
    const match = actualHash === expectedHash;

    checks.push({
      key,
      match,
      expected: expectedHash.slice(0, 16) + "...",
      actual: actualHash.slice(0, 16) + "...",
    });
    if (match) matches++;
    else mismatches++;
  }

  const total = matches + mismatches;
  const score = total > 0 ? matches / total : 0.5;

  return {
    score: round4(score),
    applicable: true,
    matches,
    mismatches,
    checks,
    warnings: mismatches > 0 ? [`${mismatches} hash mismatch(es)`] : [],
  };
}

/** Simple deterministic hash for comparison (not cryptographic). */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
