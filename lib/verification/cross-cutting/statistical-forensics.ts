/**
 * Cross-cutting verifier: Statistical Forensics.
 *
 * Detects fabricated or implausible statistics via:
 * - GRIM test (granularity-related inconsistency of means)
 * - SPRITE test (sample parameter reconstruction via iteration)
 * - Benford's law (first-digit distribution)
 * - P-curve analysis (p-value distribution shape)
 */
import type { CrossCuttingResult, CrossCuttingVerifier } from "../types";
import { ccResult } from "../types";
import { chi2Survival } from "../utils/statistics";

export const statisticalForensicsVerifier: CrossCuttingVerifier = {
  name: "statistical_forensics",
  weight: 0.10,

  isApplicable(taskResult) {
    const keys = ["statistical_claims", "means", "p_values", "metrics", "results_summary"];
    return keys.some((k) => taskResult[k]);
  },

  async verify(taskResult, taskMetadata): Promise<CrossCuttingResult> {
    const start = performance.now();

    const componentScores: Record<string, number> = {};
    const details: Record<string, unknown> = {};
    const warnings: string[] = [];

    const meansData = extractMeans(taskResult);
    const pValues = extractPValues(taskResult);
    const allNumbers = extractAllNumbers(taskResult);

    const grimResult = meansData.length > 0
      ? runGrim(meansData)
      : { score: 0.5, applicable: false, note: "No means data" };

    const spriteResult = meansData.length > 0
      ? runSprite(meansData)
      : { score: 0.5, applicable: false, note: "No means data" };

    const benfordResult = allNumbers.length >= 10
      ? runBenford(allNumbers)
      : { score: 0.5, applicable: false, note: "Insufficient numbers (<10)" };

    const pcurveResult = pValues.length >= 3
      ? runPCurve(pValues)
      : { score: 0.5, applicable: false, note: "Insufficient p-values (<3)" };

    for (const [name, result] of [
      ["grim", grimResult],
      ["sprite", spriteResult],
      ["benford", benfordResult],
      ["pcurve", pcurveResult],
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

    return ccResult(this.name, this.weight, round4(score), details, {
      warnings,
      compute_time_seconds: (performance.now() - start) / 1000,
    });
  },
};

// ── Data extraction ───────────────────────────────────────────────────────

interface MeansEntry {
  mean: number;
  n?: number;
  sd?: number;
  scale_min?: number;
  scale_max?: number;
  sample_size?: number;
  std?: number;
  [key: string]: unknown;
}

function extractMeans(taskResult: Record<string, unknown>): MeansEntry[] {
  const means = taskResult.means;
  if (Array.isArray(means)) {
    return means.filter(
      (m): m is MeansEntry =>
        typeof m === "object" && m !== null && "mean" in m,
    );
  }
  const claims = taskResult.statistical_claims;
  if (Array.isArray(claims)) {
    return claims.filter(
      (c): c is MeansEntry =>
        typeof c === "object" && c !== null && "mean" in c,
    );
  }
  return [];
}

function extractPValues(taskResult: Record<string, unknown>): number[] {
  const direct = taskResult.p_values;
  if (Array.isArray(direct) && direct.length > 0) {
    return direct.filter(
      (p): p is number => typeof p === "number" && p > 0 && p < 1,
    );
  }
  const pVals: number[] = [];
  const claims = taskResult.statistical_claims;
  if (Array.isArray(claims)) {
    for (const c of claims) {
      if (typeof c === "object" && c !== null) {
        const p = (c as Record<string, unknown>).p_value;
        if (typeof p === "number" && p > 0 && p < 1) pVals.push(p);
      }
    }
  }
  return pVals;
}

function extractAllNumbers(taskResult: Record<string, unknown>): number[] {
  const numbers: number[] = [];
  function walk(obj: unknown): void {
    if (typeof obj === "number" && !Number.isNaN(obj) && Number.isFinite(obj) && obj !== 0) {
      numbers.push(Math.abs(obj));
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (typeof obj === "object" && obj !== null) {
      for (const v of Object.values(obj)) walk(v);
    }
  }
  for (const key of ["metrics", "results_summary", "statistical_claims", "means", "p_values"]) {
    if (taskResult[key]) walk(taskResult[key]);
  }
  return numbers;
}

// ── GRIM test ─────────────────────────────────────────────────────────────

function runGrim(meansData: MeansEntry[]): Record<string, unknown> {
  let passed = 0;
  let failed = 0;
  const results: Record<string, unknown>[] = [];

  for (const entry of meansData) {
    const m = entry.mean;
    const n = entry.n ?? entry.sample_size;
    if (m == null || n == null || typeof n !== "number" || n <= 0) continue;

    const intN = Math.floor(n);
    const product = intN * m;
    const remainder = Math.abs(product - Math.round(product));
    const tolerance = intN * 0.005 + 0.01;
    const consistent = remainder <= tolerance;

    results.push({
      mean: m, n: intN,
      product: round4(product),
      remainder: round4(remainder),
      consistent,
    });
    if (consistent) passed++;
    else failed++;
  }

  if (results.length === 0) {
    return { score: 0.5, applicable: false, note: "No mean+n pairs" };
  }

  return {
    score: round4(passed / results.length),
    applicable: true,
    passed,
    failed,
    total: results.length,
    results: results.slice(0, 10),
    warnings: failed > 0 ? [`GRIM: ${failed} inconsistent mean(s)`] : [],
  };
}

// ── SPRITE test ───────────────────────────────────────────────────────────

function runSprite(meansData: MeansEntry[]): Record<string, unknown> {
  let passed = 0;
  let failed = 0;
  const results: Record<string, unknown>[] = [];

  for (const entry of meansData) {
    const m = entry.mean;
    const sd = entry.sd ?? entry.std;
    const n = entry.n ?? entry.sample_size;
    if (m == null || sd == null || n == null) continue;

    const intN = Math.floor(n as number);
    if (intN <= 0 || intN > 200) continue;

    const achievable = spriteCheck(
      m, sd as number, intN,
      entry.scale_min ?? 1, entry.scale_max ?? 7,
    );

    results.push({ mean: m, sd, n: intN, achievable });
    if (achievable) passed++;
    else failed++;
  }

  if (results.length === 0) {
    return { score: 0.5, applicable: false, note: "No mean+sd+n triples" };
  }

  return {
    score: round4(passed / results.length),
    applicable: true,
    passed,
    failed,
    total: results.length,
    results: results.slice(0, 10),
    warnings: failed > 0 ? [`SPRITE: ${failed} implausible mean/SD combination(s)`] : [],
  };
}

function spriteCheck(
  targetMean: number,
  targetSd: number,
  n: number,
  scaleMin: number,
  scaleMax: number,
  maxIter = 5000,
): boolean {
  // Seeded pseudo-random (simple LCG)
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const randInt = (min: number, max: number) =>
    min + Math.floor(rand() * (max - min + 1));

  const data: number[] = [];
  for (let i = 0; i < n; i++) data.push(randInt(scaleMin, scaleMax));

  for (let iter = 0; iter < maxIter; iter++) {
    const currentMean = data.reduce((s, v) => s + v, 0) / n;
    let currentVar = 0;
    if (n > 1) {
      for (const x of data) currentVar += (x - currentMean) ** 2;
      currentVar /= n - 1;
    }
    const currentSd = Math.sqrt(currentVar);

    if (Math.abs(currentMean - targetMean) < 0.005 && Math.abs(currentSd - targetSd) < 0.05) {
      return true;
    }

    const idx = randInt(0, n - 1);
    if (currentMean < targetMean) {
      data[idx] = Math.min(data[idx] + 1, scaleMax);
    } else if (currentMean > targetMean) {
      data[idx] = Math.max(data[idx] - 1, scaleMin);
    } else {
      data[idx] = randInt(scaleMin, scaleMax);
    }
  }
  return false;
}

// ── Benford's law ─────────────────────────────────────────────────────────

function runBenford(numbers: number[]): Record<string, unknown> {
  const digitCounts = new Array(10).fill(0);
  for (const num of numbers) {
    const s = Math.abs(num).toExponential().replace(/^0+/, "").replace(/^\./, "");
    if (s.length > 0 && s[0] >= "1" && s[0] <= "9") {
      digitCounts[parseInt(s[0])]++;
    }
  }

  const total = digitCounts.slice(1).reduce((s, v) => s + v, 0);
  if (total < 10) {
    return { score: 0.5, applicable: false, note: "Too few leading digits" };
  }

  const expected = [0, ...Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)))];
  const observedFreq = [0, ...digitCounts.slice(1).map((c) => c / total)];

  let chi2 = 0;
  for (let d = 1; d <= 9; d++) {
    chi2 += ((observedFreq[d] - expected[d]) ** 2) / expected[d];
  }
  chi2 *= total;

  const pApprox = chi2Survival(chi2, 8);

  let score: number;
  if (pApprox > 0.10) score = 1.0;
  else if (pApprox > 0.05) score = 0.7;
  else if (pApprox > 0.01) score = 0.4;
  else score = 0.1;

  const digitCountsObj: Record<string, number> = {};
  for (let d = 1; d <= 9; d++) digitCountsObj[String(d)] = digitCounts[d];

  return {
    score: round4(score),
    applicable: true,
    chi2: round4(chi2),
    p_value_approx: Math.round(pApprox * 1000000) / 1000000,
    digit_counts: digitCountsObj,
    total_numbers: total,
    warnings: pApprox < 0.05 ? [`Benford's law: chi2=${chi2.toFixed(2)}, p=${pApprox.toFixed(4)}`] : [],
  };
}

// ── P-curve analysis ──────────────────────────────────────────────────────

function runPCurve(pValues: number[]): Record<string, unknown> {
  const sigPs = pValues.filter((p) => p > 0 && p < 0.05);
  if (sigPs.length < 3) {
    return { score: 0.5, applicable: false, note: "Too few significant p-values" };
  }

  const belowMidpoint = sigPs.filter((p) => p < 0.025).length;
  const propBelow = belowMidpoint / sigPs.length;

  // KS test against uniform on [0, 0.05]
  const normalised = sigPs.map((p) => p / 0.05).sort((a, b) => a - b);
  const n = normalised.length;
  let ksStat = 0;
  for (let i = 0; i < n; i++) {
    ksStat = Math.max(ksStat, Math.abs((i + 1) / n - normalised[i]));
    ksStat = Math.max(ksStat, Math.abs(normalised[i] - i / n));
  }
  const ksCritical = 1.36 / Math.sqrt(n);
  const uniformRejected = ksStat > ksCritical;

  let score: number;
  if (propBelow > 0.6) score = 1.0;
  else if (propBelow > 0.4) score = uniformRejected ? 0.5 : 0.7;
  else score = 0.3;

  return {
    score: round4(score),
    applicable: true,
    significant_p_count: sigPs.length,
    total_p_count: pValues.length,
    proportion_below_025: round4(propBelow),
    ks_statistic: round4(ksStat),
    ks_critical_005: round4(ksCritical),
    uniform_rejected: uniformRejected,
    warnings: score < 0.5 ? ["P-curve suggests possible p-hacking"] : [],
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
