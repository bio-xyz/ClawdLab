/**
 * Physics domain adapter.
 *
 * Verifies numerical simulations, analytical derivations, and dimensional
 * analysis claims. Gracefully degrades for checks that need sympy/pint.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";

export const physicsAdapter: DomainAdapter = {
  domain: "physics",

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = String(taskResult.claim_type ?? "numerical_simulation");

    switch (claimType) {
      case "numerical_simulation":
        return verifyNumericalSimulation(taskResult, start);
      case "analytical_derivation":
        return verifyAnalyticalDerivation(taskResult, start);
      case "dimensional_analysis":
        return verifyDimensionalAnalysis(taskResult, start);
      default:
        return failResult("physics", [`Unknown claim_type: ${claimType}`]);
    }
  },
};

// ── numerical_simulation ──────────────────────────────────────────────────

function verifyNumericalSimulation(
  result: Record<string, unknown>,
  start: number,
): VerificationResult {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "numerical_simulation" };

  // Component 1: conservation_laws (0.30)
  const conserv = checkConservation(result);
  componentScores.conservation_laws = conserv.score;
  details.conservation_laws = conserv;

  // Component 2: stability (0.25)
  const stab = checkStability(result);
  componentScores.stability = stab.score;
  details.stability = stab;

  // Component 3: convergence (0.25)
  const conv = checkConvergence(result);
  componentScores.convergence = conv.score;
  details.convergence = conv;

  // Component 4: boundary_conditions (0.20)
  const bc = checkBoundaryConditions(result);
  componentScores.boundary_conditions = bc.score;
  details.boundary_conditions = bc;

  const weights: Record<string, number> = {
    conservation_laws: 0.30,
    stability: 0.25,
    convergence: 0.25,
    boundary_conditions: 0.20,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("physics", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

function checkConservation(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const conservedQuantities = result.conserved_quantities as Record<string, unknown>[] | undefined;
  if (!conservedQuantities || !Array.isArray(conservedQuantities) || conservedQuantities.length === 0) {
    return { score: 0.5, note: "No conserved quantities declared" };
  }

  let passed = 0;
  const checks: Record<string, unknown>[] = [];

  for (const q of conservedQuantities) {
    const initial = q.initial as number | undefined;
    const final_ = q.final as number | undefined;
    const name = String(q.name ?? "unnamed");

    if (initial == null || final_ == null) {
      checks.push({ name, note: "Missing initial/final" });
      continue;
    }

    const tolerance = Math.max(Math.abs(initial) * 0.01, 1e-10);
    const conserved = Math.abs(initial - final_) <= tolerance;
    checks.push({
      name,
      initial,
      final: final_,
      deviation: round4(Math.abs(initial - final_)),
      conserved,
    });
    if (conserved) passed++;
  }

  const score = checks.length > 0 ? passed / checks.length : 0.5;
  return { score: round4(score), checks };
}

function checkStability(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const timeSeries = result.time_series as number[] | undefined;
  if (!Array.isArray(timeSeries) || timeSeries.length < 3) {
    return { score: 0.5, note: "No time series data" };
  }

  // Check for NaN/Inf
  const hasNaN = timeSeries.some((v) => !Number.isFinite(v));
  if (hasNaN) return { score: 0.0, error: "NaN or Inf detected in time series" };

  // Check for blow-up (values growing exponentially)
  const lastFive = timeSeries.slice(-5);
  const firstFive = timeSeries.slice(0, 5);
  const maxLast = Math.max(...lastFive.map(Math.abs));
  const maxFirst = Math.max(...firstFive.map(Math.abs));

  if (maxFirst > 0 && maxLast / maxFirst > 1000) {
    return { score: 0.2, note: "Possible numerical blow-up", growth_ratio: round4(maxLast / maxFirst) };
  }

  return { score: 1.0, stable: true, n_points: timeSeries.length };
}

function checkConvergence(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const errors = result.convergence_errors as number[] | undefined;
  if (!Array.isArray(errors) || errors.length < 2) {
    return { score: 0.5, note: "No convergence data" };
  }

  // Check if errors are decreasing
  let decreasing = 0;
  for (let i = 1; i < errors.length; i++) {
    if (errors[i] < errors[i - 1]) decreasing++;
  }

  const fracDecreasing = decreasing / (errors.length - 1);
  let score: number;
  if (fracDecreasing > 0.8) score = 1.0;
  else if (fracDecreasing > 0.5) score = 0.7;
  else if (fracDecreasing > 0.3) score = 0.4;
  else score = 0.1;

  return {
    score: round4(score),
    fraction_decreasing: round4(fracDecreasing),
    final_error: errors[errors.length - 1],
    initial_error: errors[0],
  };
}

function checkBoundaryConditions(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const bcs = result.boundary_conditions as Record<string, unknown>[] | undefined;
  if (!Array.isArray(bcs) || bcs.length === 0) {
    return { score: 0.5, note: "No boundary conditions declared" };
  }

  let satisfied = 0;
  for (const bc of bcs) {
    const expected = bc.expected as number | undefined;
    const actual = bc.actual as number | undefined;
    if (expected != null && actual != null) {
      const tol = Math.max(Math.abs(expected) * 0.05, 1e-10);
      if (Math.abs(expected - actual) <= tol) satisfied++;
    }
  }

  const score = bcs.length > 0 ? satisfied / bcs.length : 0.5;
  return { score: round4(score), satisfied, total: bcs.length };
}

// ── analytical_derivation ─────────────────────────────────────────────────

function verifyAnalyticalDerivation(
  result: Record<string, unknown>,
  start: number,
): VerificationResult {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "analytical_derivation" };

  // Component 1: dimensional_consistency (0.35) — degraded without pint
  componentScores.dimensional_consistency = 0.5;
  details.dimensional_consistency = {
    score: 0.5,
    note: "pint/sympy unavailable in TS runtime — neutral score",
  };

  // Component 2: symbolic_validity (0.30) — degraded without sympy
  componentScores.symbolic_validity = 0.5;
  details.symbolic_validity = {
    score: 0.5,
    note: "sympy unavailable in TS runtime — neutral score",
  };

  // Component 3: unit_consistency (0.35)
  const units = checkUnitConsistency(result);
  componentScores.unit_consistency = units.score;
  details.unit_consistency = units;

  const weights: Record<string, number> = {
    dimensional_consistency: 0.35,
    symbolic_validity: 0.30,
    unit_consistency: 0.35,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("physics", round4(score), details, {
    warnings: ["Dimensional & symbolic checks degraded — no pint/sympy in TS"],
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

function checkUnitConsistency(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const variables = result.variables as Record<string, unknown>[] | undefined;
  if (!Array.isArray(variables) || variables.length === 0) {
    return { score: 0.5, note: "No variables declared" };
  }

  // Check that all variables have units declared
  const withUnits = variables.filter((v) => v.unit || v.units);
  if (withUnits.length === 0) {
    return { score: 0.3, note: "No units declared on any variable" };
  }

  const coverage = withUnits.length / variables.length;
  return {
    score: round4(Math.min(1.0, coverage * 1.2)),
    variables_with_units: withUnits.length,
    total_variables: variables.length,
    coverage: round4(coverage),
  };
}

// ── dimensional_analysis ──────────────────────────────────────────────────

function verifyDimensionalAnalysis(
  result: Record<string, unknown>,
  start: number,
): VerificationResult {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "dimensional_analysis" };

  // Same checks as analytical_derivation but with different weights
  componentScores.dimensional_consistency = 0.5;
  details.dimensional_consistency = {
    score: 0.5,
    note: "pint unavailable in TS runtime — neutral score",
  };

  const units = checkUnitConsistency(result);
  componentScores.unit_consistency = units.score;
  details.unit_consistency = units;

  // Check claimed dimensionless groups
  const groups = result.dimensionless_groups as string[] | undefined;
  if (Array.isArray(groups) && groups.length > 0) {
    componentScores.groups_declared = 1.0;
    details.groups_declared = { score: 1.0, n_groups: groups.length };
  } else {
    componentScores.groups_declared = 0.5;
    details.groups_declared = { score: 0.5, note: "No dimensionless groups declared" };
  }

  const weights: Record<string, number> = {
    dimensional_consistency: 0.40,
    unit_consistency: 0.30,
    groups_declared: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("physics", round4(score), details, {
    warnings: ["Dimensional checks degraded — no pint in TS"],
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
