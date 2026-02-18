/**
 * Cross-cutting verifier: Reproducibility Checks.
 *
 * Checks repo existence, commit validity, and presence of
 * reproducibility files via GitHub API. No Docker execution
 * in v2 — gracefully degraded.
 */
import type { CrossCuttingResult, CrossCuttingVerifier } from "../types";
import { ccResult } from "../types";
import { fetchJson } from "../utils/http-client";

const GITHUB_API = "https://api.github.com";

export const reproducibilityVerifier: CrossCuttingVerifier = {
  name: "reproducibility",
  weight: 0.15,

  isApplicable(taskResult) {
    return Boolean(taskResult.code_repo && taskResult.code_commit);
  },

  async verify(taskResult, taskMetadata): Promise<CrossCuttingResult> {
    const start = performance.now();

    const codeRepo = String(taskResult.code_repo);
    const codeCommit = String(taskResult.code_commit);

    const componentScores: Record<string, number> = {};
    const details: Record<string, unknown> = { repo: codeRepo, commit: codeCommit };
    const warnings: string[] = [];

    // Extract GitHub owner/repo from URL
    const ghMatch = codeRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!ghMatch) {
      return ccResult(this.name, this.weight, 0.3, {
        ...details,
        error: "Could not parse GitHub repo URL",
      }, {
        warnings: ["Only GitHub repos supported for API checks"],
        compute_time_seconds: (performance.now() - start) / 1000,
      });
    }

    const owner = ghMatch[1];
    const repo = ghMatch[2];

    // Component 1: Repo exists and is accessible (0.25)
    const repoResult = await checkRepoExists(owner, repo);
    componentScores.repo_accessible = repoResult.score;
    details.repo_check = repoResult;

    if (repoResult.score === 0) {
      // If repo doesn't exist, all other checks fail
      return ccResult(this.name, this.weight, 0, details, {
        errors: ["Repository not accessible"],
        compute_time_seconds: (performance.now() - start) / 1000,
      });
    }

    // Component 2: Commit exists (0.25)
    const commitResult = await checkCommitExists(owner, repo, codeCommit);
    componentScores.commit_exists = commitResult.score;
    details.commit_check = commitResult;

    // Component 3: Has dependency files (0.25)
    const depsResult = await checkDependencyFiles(owner, repo, codeCommit);
    componentScores.has_deps = depsResult.score;
    details.deps_check = depsResult;

    // Component 4: Has entry point (0.25) — degraded from Docker execution
    const entryResult = await checkEntryPoint(owner, repo, codeCommit);
    componentScores.has_entry_point = entryResult.score;
    details.entry_point_check = entryResult;
    warnings.push("Docker execution skipped in v2 — score based on static checks only");

    const weights: Record<string, number> = {
      repo_accessible: 0.25,
      commit_exists: 0.25,
      has_deps: 0.25,
      has_entry_point: 0.25,
    };

    const score = Object.keys(weights).reduce(
      (s, k) => s + weights[k] * (componentScores[k] ?? 0),
      0,
    );

    details.component_scores = componentScores;

    return ccResult(this.name, this.weight, round4(score), details, {
      warnings,
      compute_time_seconds: (performance.now() - start) / 1000,
    });
  },
};

// ── GitHub API helpers ────────────────────────────────────────────────────

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ClawdLab-Verification/2.0",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function checkRepoExists(
  owner: string,
  repo: string,
): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<Record<string, unknown>>(
    `${GITHUB_API}/repos/${owner}/${repo}`,
    { headers: ghHeaders() },
  );

  if (!res.ok) {
    return { score: 0, accessible: false, error: res.error };
  }

  return {
    score: 1.0,
    accessible: true,
    full_name: res.data?.full_name,
    default_branch: res.data?.default_branch,
  };
}

async function checkCommitExists(
  owner: string,
  repo: string,
  commit: string,
): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<Record<string, unknown>>(
    `${GITHUB_API}/repos/${owner}/${repo}/commits/${commit}`,
    { headers: ghHeaders() },
  );

  if (!res.ok) {
    return { score: 0, found: false, error: res.error };
  }

  return {
    score: 1.0,
    found: true,
    sha: (res.data?.sha as string)?.slice(0, 12),
    message: (res.data?.commit as Record<string, unknown>)?.message,
  };
}

async function checkDependencyFiles(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ score: number; [k: string]: unknown }> {
  const depFiles = ["requirements.txt", "pyproject.toml", "setup.py", "package.json"];
  const found: string[] = [];

  // Check root tree for dependency files
  const res = await fetchJson<{ tree?: Array<{ path: string }> }>(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${ref}`,
    { headers: ghHeaders() },
  );

  if (res.ok && res.data?.tree) {
    const paths = new Set(res.data.tree.map((t) => t.path));
    for (const f of depFiles) {
      if (paths.has(f)) found.push(f);
    }
  }

  if (found.length === 0) {
    return { score: 0.3, found: [], note: "No dependency files found" };
  }

  const hasPrimary = found.includes("requirements.txt") || found.includes("pyproject.toml") || found.includes("package.json");
  return {
    score: hasPrimary ? 1.0 : 0.7,
    found,
  };
}

async function checkEntryPoint(
  owner: string,
  repo: string,
  ref: string,
): Promise<{ score: number; [k: string]: unknown }> {
  const candidates = ["reproduce.py", "run.sh", "main.py", "Makefile"];
  const found: string[] = [];

  const res = await fetchJson<{ tree?: Array<{ path: string }> }>(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${ref}`,
    { headers: ghHeaders() },
  );

  if (res.ok && res.data?.tree) {
    const paths = new Set(res.data.tree.map((t) => t.path));
    for (const c of candidates) {
      if (paths.has(c)) found.push(c);
    }
  }

  if (found.length === 0) {
    return {
      score: 0.3,
      found: [],
      note: "No entry point found (reproduce.py, run.sh, main.py, Makefile)",
    };
  }

  return { score: 1.0, found };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
