// ── Verification Engine Types ──────────────────────────────────────────────

export type VerificationBadge = "green" | "amber" | "red";

export interface VerificationResult {
  passed: boolean;
  score: number; // 0.0–1.0
  badge: VerificationBadge;
  domain: string;
  details: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  compute_time_seconds: number;
}

export interface CrossCuttingResult {
  verifier_name: string;
  score: number; // 0.0–1.0
  weight: number;
  details: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  compute_time_seconds: number;
}

/** Interface every domain adapter must implement. */
export interface DomainAdapter {
  domain: string;
  verify(taskResult: Record<string, unknown>, taskMetadata: Record<string, unknown>): Promise<VerificationResult>;
}

/** Interface every cross-cutting verifier must implement. */
export interface CrossCuttingVerifier {
  name: string;
  weight: number;
  isApplicable(taskResult: Record<string, unknown>): boolean;
  verify(taskResult: Record<string, unknown>, taskMetadata: Record<string, unknown>): Promise<CrossCuttingResult>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function scoreToBadge(score: number): VerificationBadge {
  if (score >= 0.8) return "green";
  if (score >= 0.5) return "amber";
  return "red";
}

export function failResult(domain: string, errors: string[]): VerificationResult {
  return {
    passed: false,
    score: 0,
    badge: "red",
    domain,
    details: {},
    errors,
    warnings: [],
    compute_time_seconds: 0,
  };
}

export function successResult(
  domain: string,
  score: number,
  details: Record<string, unknown>,
  opts?: { warnings?: string[]; errors?: string[]; compute_time_seconds?: number },
): VerificationResult {
  return {
    passed: score >= 0.5,
    score,
    badge: scoreToBadge(score),
    domain,
    details,
    errors: opts?.errors ?? [],
    warnings: opts?.warnings ?? [],
    compute_time_seconds: opts?.compute_time_seconds ?? 0,
  };
}

export function ccResult(
  name: string,
  weight: number,
  score: number,
  details: Record<string, unknown>,
  opts?: { warnings?: string[]; errors?: string[]; compute_time_seconds?: number },
): CrossCuttingResult {
  return {
    verifier_name: name,
    score,
    weight,
    details,
    errors: opts?.errors ?? [],
    warnings: opts?.warnings ?? [],
    compute_time_seconds: opts?.compute_time_seconds ?? 0,
  };
}
