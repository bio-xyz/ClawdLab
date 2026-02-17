/**
 * ML/AI domain adapter.
 *
 * Verifies benchmark results, ML experiments, and architecture claims
 * via HuggingFace Hub API, GitHub, and plausibility checks.
 */
import type { DomainAdapter, VerificationResult } from "../types";
import { failResult, successResult } from "../types";
import { fetchJson } from "../utils/http-client";

const HF_API = "https://huggingface.co/api";

export const mlAiAdapter: DomainAdapter = {
  domain: "ml_ai",

  async verify(taskResult, taskMetadata): Promise<VerificationResult> {
    const start = performance.now();
    const claimType = String(taskResult.claim_type ?? "benchmark_result");

    switch (claimType) {
      case "benchmark_result":
        return verifyBenchmarkResult(taskResult, start);
      case "ml_experiment":
        return verifyMlExperiment(taskResult, start);
      case "architecture":
        return verifyArchitecture(taskResult, start);
      default:
        return failResult("ml_ai", [`Unknown claim_type: ${claimType}`]);
    }
  },
};

// ── benchmark_result ──────────────────────────────────────────────────────

async function verifyBenchmarkResult(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const modelId = String(result.model_id ?? "");
  if (!modelId) return failResult("ml_ai", ["model_id required"]);

  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "benchmark_result" };

  // Component 1: model_exists (0.15)
  const modelResult = await checkModelExists(modelId);
  componentScores.model_exists = modelResult.score;
  details.model_exists = modelResult;

  // Component 2: leaderboard (0.40) — neutral without parquet support
  componentScores.leaderboard = 0.5;
  details.leaderboard = {
    score: 0.5,
    note: "Leaderboard parquet lookup not available in TS — neutral score",
  };

  // Component 3: model_card (0.25)
  const cardResult = await checkModelCard(modelId, result);
  componentScores.model_card = cardResult.score;
  details.model_card = cardResult;

  // Component 4: plausibility (0.10)
  const plausResult = checkMetricPlausibility(result);
  componentScores.plausibility = plausResult.score;
  details.plausibility = plausResult;

  // Component 5: metadata (0.10)
  const metaResult = await checkMetadata(modelId, result);
  componentScores.metadata = metaResult.score;
  details.metadata = metaResult;

  const weights: Record<string, number> = {
    model_exists: 0.15,
    leaderboard: 0.40,
    model_card: 0.25,
    plausibility: 0.10,
    metadata: 0.10,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("ml_ai", round4(score), details, {
    warnings: ["Leaderboard check degraded — parquet not available in TS runtime"],
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

async function checkModelExists(modelId: string): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<Record<string, unknown>>(
    `${HF_API}/models/${modelId}`,
  );
  if (!res.ok) return { score: 0, found: false, error: res.error };

  return {
    score: 1.0,
    found: true,
    model_id: modelId,
    pipeline_tag: res.data?.pipeline_tag,
    downloads: res.data?.downloads,
  };
}

async function checkModelCard(
  modelId: string,
  result: Record<string, unknown>,
): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<Record<string, unknown>>(
    `${HF_API}/models/${modelId}`,
  );
  if (!res.ok) return { score: 0.3, note: "Could not fetch model info" };

  const data = res.data!;
  const cardData = data.cardData as Record<string, unknown> | undefined;
  const hasModelCard = Boolean(cardData);

  if (!hasModelCard) return { score: 0.3, note: "No model card found" };

  // Check if eval results exist in model card
  const evalResults = cardData?.eval_results ?? cardData?.model_index;
  if (!evalResults) return { score: 0.5, note: "Model card exists but no eval results" };

  return { score: 0.8, has_card: true, has_eval_results: true };
}

function checkMetricPlausibility(result: Record<string, unknown>): { score: number; [k: string]: unknown } {
  const metrics = result.metrics as Record<string, number> | undefined;
  if (!metrics || typeof metrics !== "object") {
    return { score: 0.5, note: "No metrics provided" };
  }

  const issues: string[] = [];
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value !== "number") continue;
    // Accuracy/F1 metrics should be in [0, 1] or [0, 100]
    if (/accuracy|f1|precision|recall|bleu/i.test(name)) {
      if (value < 0 || value > 100) {
        issues.push(`${name}=${value} out of plausible range`);
      }
    }
    // Perplexity should be > 1
    if (/perplexity/i.test(name) && value < 1) {
      issues.push(`${name}=${value} should be >= 1`);
    }
  }

  const score = issues.length === 0 ? 1.0 : Math.max(0.2, 1.0 - issues.length * 0.3);
  return { score: round4(score), issues };
}

async function checkMetadata(
  modelId: string,
  result: Record<string, unknown>,
): Promise<{ score: number; [k: string]: unknown }> {
  const claimedParams = result.param_count as number | undefined;
  if (claimedParams == null) return { score: 0.5, note: "No param_count claimed" };

  const res = await fetchJson<Record<string, unknown>>(
    `${HF_API}/models/${modelId}`,
  );
  if (!res.ok) return { score: 0.3, note: "Could not fetch model metadata" };

  const safetensors = res.data?.safetensors as Record<string, unknown> | undefined;
  const totalParams = safetensors?.total as number | undefined;

  if (totalParams == null) return { score: 0.5, note: "No param count in HF metadata" };

  const tolerance = totalParams * 0.05;
  const match = Math.abs(claimedParams - totalParams) <= tolerance;
  return {
    score: match ? 1.0 : 0.3,
    match,
    claimed: claimedParams,
    hf_total: totalParams,
  };
}

// ── ml_experiment ─────────────────────────────────────────────────────────

async function verifyMlExperiment(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "ml_experiment" };

  // Component 1: repo_exists (0.30)
  const repoUrl = String(result.code_repo ?? "");
  const ghMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (ghMatch) {
    const res = await fetchJson<Record<string, unknown>>(
      `https://api.github.com/repos/${ghMatch[1]}/${ghMatch[2]}`,
      { headers: ghHeaders() },
    );
    componentScores.repo_exists = res.ok ? 1.0 : 0.0;
    details.repo_exists = { score: componentScores.repo_exists, found: res.ok };
  } else {
    componentScores.repo_exists = repoUrl ? 0.3 : 0.0;
    details.repo_exists = { score: componentScores.repo_exists, note: "Not a GitHub URL" };
  }

  // Component 2: commit_exists (0.20)
  const commit = String(result.code_commit ?? "");
  if (ghMatch && commit) {
    const res = await fetchJson<Record<string, unknown>>(
      `https://api.github.com/repos/${ghMatch[1]}/${ghMatch[2]}/commits/${commit}`,
      { headers: ghHeaders() },
    );
    componentScores.commit_exists = res.ok ? 1.0 : 0.0;
    details.commit_exists = { score: componentScores.commit_exists, found: res.ok };
  } else {
    componentScores.commit_exists = 0.5;
    details.commit_exists = { score: 0.5, note: "No commit to verify" };
  }

  // Component 3: reproducibility_files (0.25)
  componentScores.reproducibility_files = 0.5;
  details.reproducibility_files = { score: 0.5, note: "Checked via reproducibility verifier" };

  // Component 4: metric_plausibility (0.25)
  const plaus = checkMetricPlausibility(result);
  componentScores.metric_plausibility = plaus.score;
  details.metric_plausibility = plaus;

  const weights: Record<string, number> = {
    repo_exists: 0.30,
    commit_exists: 0.20,
    reproducibility_files: 0.25,
    metric_plausibility: 0.25,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("ml_ai", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

// ── architecture ──────────────────────────────────────────────────────────

async function verifyArchitecture(
  result: Record<string, unknown>,
  start: number,
): Promise<VerificationResult> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { claim_type: "architecture" };

  const code = result.code as string | undefined;
  const layers = result.layers as unknown[] | undefined;
  const claimedParams = result.param_count as number | undefined;

  // Component 1: code_parseable (0.40) — basic syntax check
  if (code && typeof code === "string") {
    const hasDef = /def |class |import |from /.test(code);
    componentScores.code_parseable = hasDef ? 1.0 : 0.3;
    details.code_parseable = { score: componentScores.code_parseable, has_python_constructs: hasDef };
  } else {
    componentScores.code_parseable = 0.5;
    details.code_parseable = { score: 0.5, note: "No code provided" };
  }

  // Component 2: layers_declared (0.30)
  if (Array.isArray(layers) && layers.length > 0) {
    componentScores.layers_declared = 1.0;
    details.layers_declared = { score: 1.0, n_layers: layers.length };
  } else {
    componentScores.layers_declared = 0.5;
    details.layers_declared = { score: 0.5, note: "No layers declared" };
  }

  // Component 3: param_plausible (0.30)
  if (claimedParams != null) {
    const plausible = claimedParams > 0 && claimedParams < 1e13;
    componentScores.param_plausible = plausible ? 1.0 : 0.2;
    details.param_plausible = { score: componentScores.param_plausible, param_count: claimedParams };
  } else {
    componentScores.param_plausible = 0.5;
    details.param_plausible = { score: 0.5, note: "No param_count" };
  }

  const weights: Record<string, number> = {
    code_parseable: 0.40,
    layers_declared: 0.30,
    param_plausible: 0.30,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k], 0,
  );
  details.component_scores = componentScores;

  return successResult("ml_ai", round4(score), details, {
    compute_time_seconds: (performance.now() - start) / 1000,
  });
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ClawdLab-Verification/2.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
