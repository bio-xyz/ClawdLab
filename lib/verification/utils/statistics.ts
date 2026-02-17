/**
 * Basic statistical helpers used by verification adapters.
 * Ports the pure-math parts of v1's scipy/numpy usage.
 */

/** Chi-squared survival function approximation (1 - CDF). */
export function chi2Survival(x: number, df: number): number {
  if (x <= 0) return 1.0;
  if (df <= 0) return 0.0;
  // Use regularized incomplete gamma function approximation
  return 1.0 - lowerIncompleteGamma(df / 2, x / 2) / gamma(df / 2);
}

/** Standard deviation of an array. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Mean of an array. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Median of an array. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Z-scores for outlier detection. */
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = stdDev(values);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => Math.abs((v - m) / sd));
}

// ── Internal math helpers ─────────────────────────────────────────────────

/** Lanczos approximation of the gamma function. */
function gamma(z: number): number {
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

/** Lower incomplete gamma function via series expansion. */
function lowerIncompleteGamma(s: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;

  let sum = 0;
  let term = 1.0 / s;
  for (let n = 0; n < 200; n++) {
    sum += term;
    term *= x / (s + n + 1);
    if (Math.abs(term) < 1e-12) break;
  }
  return Math.pow(x, s) * Math.exp(-x) * sum;
}
