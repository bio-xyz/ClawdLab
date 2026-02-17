/**
 * Epidemiology domain adapter.
 *
 * Verifies incidence rates, odds ratios, and survival analysis claims
 * via WHO GHO API and pure-math recomputation.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { fetchJson } from "../utils/http-client";

const WHO_GHO_API = "https://ghoapi.azureedge.net/api";

export const epidemiologyAdapter: DomainAdapter = {
  domain: "epidemiology",

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = String(taskResult.claim_type ?? "incidence_rate");

    switch (claimType) {
      case "incidence_rate":
        return verifyIncidenceRate(taskResult, start);
      case "odds_ratio":
        return verifyOddsRatio(taskResult, start);
      case "survival_analysis":
        return verifySurvivalAnalysis(taskResult, start);
      default:
        return failResult("epidemiology", [`Unknown claim_type: ${claimType}`]);
    }
  },
};

// ── incidence_rate ────────────────────────────────────────────────────────

async function verifyIncidenceRate(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "incidence_rate" };

  const indicatorCode = String(result.indicator_code ?? "");
  const country = String(result.country ?? "");
  const claimedRate = result.rate as number | undefined;
  const denominator = result.denominator as number | undefined;
  const cases = result.cases as number | undefined;

  // Component 1: who_data_match (0.30)
  if (indicatorCode && country) {
    const whoResult = await checkWhoData(indicatorCode, country, claimedRate);
    componentScores.who_data_match = whoResult.score;
    details.who_data_match = whoResult;
  } else {
    componentScores.who_data_match = 0.5;
    details.who_data_match = { score: 0.5, note: "No indicator/country for WHO lookup" };
  }

  // Component 2: denominator_valid (0.20)
  if (denominator != null) {
    const valid = typeof denominator === "number" && denominator > 0;
    componentScores.denominator_valid = valid ? 1.0 : 0.0;
    details.denominator_valid = { score: componentScores.denominator_valid, denominator };
  } else {
    componentScores.denominator_valid = 0.5;
    details.denominator_valid = { score: 0.5, note: "No denominator" };
  }

  // Component 3: rate_recomputed (0.25)
  if (cases != null && denominator != null && denominator > 0) {
    const computed = cases / denominator;
    const scaledComputed = computed * (result.rate_per as number ?? 100000);
    if (claimedRate != null) {
      const tol = Math.max(Math.abs(claimedRate) * 0.05, 0.01);
      const match = Math.abs(claimedRate - scaledComputed) <= tol;
      componentScores.rate_recomputed = match ? 1.0 : 0.3;
      details.rate_recomputed = {
        score: componentScores.rate_recomputed,
        claimed: claimedRate,
        computed: round4(scaledComputed),
        match,
      };
    } else {
      componentScores.rate_recomputed = 0.5;
      details.rate_recomputed = { score: 0.5, computed: round4(scaledComputed) };
    }
  } else {
    componentScores.rate_recomputed = 0.5;
    details.rate_recomputed = { score: 0.5, note: "Cannot recompute rate" };
  }

  // Component 4: ci_valid (0.25)
  const ciResult = checkConfidenceInterval(result);
  componentScores.ci_valid = ciResult.score;
  details.ci_valid = ciResult;

  const weights: Record<string, number> = {
    who_data_match: 0.30,
    denominator_valid: 0.20,
    rate_recomputed: 0.25,
    ci_valid: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("epidemiology", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── odds_ratio ────────────────────────────────────────────────────────────

async function verifyOddsRatio(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "odds_ratio" };

  const table = result.contingency_table as number[][] | undefined;
  const claimedOr = result.odds_ratio as number | undefined;
  const claimedCi = result.confidence_interval as [number, number] | undefined;
  const claimedPvalue = result.p_value as number | undefined;

  // Component 1: table_valid (0.20)
  if (Array.isArray(table) && table.length === 2 && table[0]?.length === 2 && table[1]?.length === 2) {
    const allPositive = table.flat().every((v) => typeof v === "number" && v >= 0);
    componentScores.table_valid = allPositive ? 1.0 : 0.0;
    details.table_valid = { score: componentScores.table_valid, table };
  } else {
    componentScores.table_valid = table ? 0.0 : 0.5;
    details.table_valid = { score: componentScores.table_valid, note: table ? "Invalid 2x2 table" : "No table" };
  }

  // Component 2: or_recomputed (0.30)
  if (Array.isArray(table) && table.length === 2) {
    const a = table[0][0], b = table[0][1], c = table[1][0], d = table[1][1];
    if (b > 0 && c > 0) {
      const computedOr = (a * d) / (b * c);
      if (claimedOr != null) {
        const tol = Math.max(Math.abs(computedOr) * 0.05, 0.01);
        const match = Math.abs(claimedOr - computedOr) <= tol;
        componentScores.or_recomputed = match ? 1.0 : 0.3;
        details.or_recomputed = {
          score: componentScores.or_recomputed,
          claimed: claimedOr,
          computed: round4(computedOr),
          match,
        };
      } else {
        componentScores.or_recomputed = 0.5;
        details.or_recomputed = { score: 0.5, computed: round4(computedOr) };
      }
    } else {
      componentScores.or_recomputed = 0.3;
      details.or_recomputed = { score: 0.3, error: "Zero cell in denominator" };
    }
  } else {
    componentScores.or_recomputed = 0.5;
    details.or_recomputed = { score: 0.5, note: "No contingency table" };
  }

  // Component 3: ci_recomputed (0.25) — Woolf method
  if (Array.isArray(table) && table.length === 2) {
    const [a, b] = table[0];
    const [c, d] = table[1];
    if (a > 0 && b > 0 && c > 0 && d > 0) {
      const lnOr = Math.log((a * d) / (b * c));
      const se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
      const lower = Math.exp(lnOr - 1.96 * se);
      const upper = Math.exp(lnOr + 1.96 * se);

      if (claimedCi) {
        const lowerMatch = Math.abs(claimedCi[0] - lower) / Math.max(lower, 0.01) < 0.1;
        const upperMatch = Math.abs(claimedCi[1] - upper) / Math.max(upper, 0.01) < 0.1;
        componentScores.ci_recomputed = lowerMatch && upperMatch ? 1.0 : 0.3;
        details.ci_recomputed = {
          score: componentScores.ci_recomputed,
          claimed: claimedCi,
          computed: [round4(lower), round4(upper)],
        };
      } else {
        componentScores.ci_recomputed = 0.5;
        details.ci_recomputed = { score: 0.5, computed: [round4(lower), round4(upper)] };
      }
    } else {
      componentScores.ci_recomputed = 0.3;
      details.ci_recomputed = { score: 0.3, error: "Zero cell prevents CI computation" };
    }
  } else {
    componentScores.ci_recomputed = 0.5;
    details.ci_recomputed = { score: 0.5, note: "No table for CI" };
  }

  // Component 4: pvalue_plausible (0.25)
  if (claimedPvalue != null) {
    if (claimedPvalue >= 0 && claimedPvalue <= 1) {
      componentScores.pvalue_plausible = 1.0;
      details.pvalue_plausible = { score: 1.0, p_value: claimedPvalue };
    } else {
      componentScores.pvalue_plausible = 0.0;
      details.pvalue_plausible = { score: 0.0, error: "p-value out of [0,1]" };
    }
  } else {
    componentScores.pvalue_plausible = 0.5;
    details.pvalue_plausible = { score: 0.5, note: "No p-value claimed" };
  }

  const weights: Record<string, number> = {
    table_valid: 0.20,
    or_recomputed: 0.30,
    ci_recomputed: 0.25,
    pvalue_plausible: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("epidemiology", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── survival_analysis ─────────────────────────────────────────────────────

async function verifySurvivalAnalysis(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "survival_analysis" };
  const warnings = ["lifelines unavailable in TS — KM/log-rank recomputation skipped"];

  // Component 1: data_valid (0.25)
  const times = result.survival_times as number[] | undefined;
  const events = result.events as (0 | 1)[] | undefined;
  if (Array.isArray(times) && Array.isArray(events)) {
    const valid = times.length === events.length && times.length > 0;
    const allPositive = times.every((t) => typeof t === "number" && t >= 0);
    componentScores.data_valid = valid && allPositive ? 1.0 : 0.3;
    details.data_valid = {
      score: componentScores.data_valid,
      n_subjects: times.length,
      n_events: events.filter((e) => e === 1).length,
    };
  } else {
    componentScores.data_valid = 0.5;
    details.data_valid = { score: 0.5, note: "No survival data" };
  }

  // Component 2: hazard_ratio_plausible (0.25)
  const hr = result.hazard_ratio as number | undefined;
  if (hr != null) {
    let hrScore: number;
    if (hr > 0 && hr <= 20) hrScore = 1.0;
    else if (hr > 0 && hr <= 100) hrScore = 0.5;
    else hrScore = 0.1;
    componentScores.hr_plausible = hrScore;
    details.hr_plausible = { score: hrScore, hazard_ratio: hr };
  } else {
    componentScores.hr_plausible = 0.5;
    details.hr_plausible = { score: 0.5, note: "No HR claimed" };
  }

  // Component 3: km_recomputed (0.25) — degraded
  componentScores.km_recomputed = 0.5;
  details.km_recomputed = { score: 0.5, note: "lifelines unavailable — neutral score" };

  // Component 4: logrank_valid (0.25) — degraded
  componentScores.logrank_valid = 0.5;
  details.logrank_valid = { score: 0.5, note: "lifelines unavailable — neutral score" };

  const weights: Record<string, number> = {
    data_valid: 0.25,
    hr_plausible: 0.25,
    km_recomputed: 0.25,
    logrank_valid: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("epidemiology", round4(score), details, {
    warnings,
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────

async function checkWhoData(
  indicatorCode: string,
  country: string,
  claimedRate: number | undefined,
): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<{ value?: Array<Record<string, unknown>> }>(
    `${WHO_GHO_API}/${indicatorCode}?$filter=SpatialDim eq '${country}'&$orderby=TimeDim desc&$top=5`,
  );

  if (!res.ok || !res.data?.value?.length) {
    return { score: 0.3, note: "WHO GHO lookup failed or no data", error: res.error };
  }

  const latest = res.data.value[0];
  const whoValue = latest.NumericValue as number | undefined;

  if (whoValue == null) return { score: 0.5, note: "No numeric value in WHO data" };

  if (claimedRate == null) return { score: 0.5, who_value: whoValue };

  const tol = Math.max(Math.abs(whoValue) * 0.20, 1);
  const match = Math.abs(claimedRate - whoValue) <= tol;
  return {
    score: match ? 1.0 : 0.3,
    match,
    claimed: claimedRate,
    who_value: whoValue,
    year: latest.TimeDim,
    tolerance: round4(tol),
  };
}

function checkConfidenceInterval(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const ci = result.confidence_interval as [number, number] | undefined;
  const rate = result.rate as number | undefined;

  if (!Array.isArray(ci) || ci.length !== 2) {
    return { score: 0.5, note: "No confidence interval" };
  }

  const [lower, upper] = ci;
  const issues: string[] = [];

  if (lower >= upper) issues.push("CI lower >= upper");
  if (rate != null && (rate < lower || rate > upper)) issues.push("Point estimate outside CI");
  if (lower < 0) issues.push("CI lower bound negative (may be OK for some measures)");

  const score = issues.length === 0 ? 1.0 : Math.max(0.2, 1.0 - issues.length * 0.3);
  return { score: round4(score), ci, issues };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
