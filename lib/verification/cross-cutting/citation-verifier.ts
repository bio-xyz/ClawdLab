/**
 * Cross-cutting verifier: Citation & Reference Verification.
 *
 * Validates citations by checking DOI resolution (CrossRef),
 * metadata matching (OpenAlex + Semantic Scholar), claim-text
 * support via abstract similarity, and reference freshness.
 */
import type { CrossCuttingResult, CrossCuttingVerifier } from "../types";
import { ccResult } from "../types";
import { fetchJson } from "../utils/http-client";
import { jaccardSimilarity } from "../utils/jaccard";

const CROSSREF_API = "https://api.crossref.org/works";
const OPENALEX_API = "https://api.openalex.org/works";
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper";
const MAX_CITATIONS = 10;
const FAST_MOVING_DOMAINS = new Set(["ml_ai", "bioinformatics", "computational_biology"]);
const FRESHNESS_THRESHOLD_FAST = 5;
const FRESHNESS_THRESHOLD_SLOW = 15;

export const citationVerifier: CrossCuttingVerifier = {
  name: "citation_reference",
  weight: 0.15,

  isApplicable(taskResult) {
    const keys = ["citations", "references", "papers", "bibliography"];
    return keys.some((k) => {
      const v = taskResult[k];
      return v && (Array.isArray(v) ? v.length > 0 : true);
    });
  },

  async verify(taskResult, taskMetadata): Promise<CrossCuttingResult> {
    const start = performance.now();
    const domain = (taskMetadata.domain as string) ?? "general";

    const citations = extractCitations(taskResult).slice(0, MAX_CITATIONS);
    if (citations.length === 0) {
      return ccResult(this.name, this.weight, 0, {}, {
        errors: ["No parseable citations found"],
        compute_time_seconds: (performance.now() - start) / 1000,
      });
    }

    const results = await Promise.allSettled(
      citations.map((c) => checkCitation(c, domain)),
    );

    const citationDetails: Record<string, unknown>[] = [];
    let totalScore = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        citationDetails.push(r.value as Record<string, unknown>);
        totalScore += (r.value as { score: number }).score;
      } else {
        citationDetails.push({
          citation: citations[i].title ?? `citation_${i}`,
          error: String(r.reason),
          score: 0,
        });
      }
    }

    const avgScore = totalScore / citations.length;
    return ccResult(this.name, this.weight, round4(avgScore), {
      citations_checked: citations.length,
      citation_results: citationDetails,
    }, { compute_time_seconds: (performance.now() - start) / 1000 });
  },
};

// ── Internals ──────────────────────────────────────────────────────────────

interface Citation {
  title?: string;
  doi?: string;
  authors?: unknown[];
  year?: number;
  claim_text?: string;
  url?: string;
  abstract?: string;
}

function extractCitations(taskResult: Record<string, unknown>): Citation[] {
  for (const key of ["citations", "references", "papers", "bibliography"]) {
    const raw = taskResult[key];
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map(normalizeCitation);
    }
  }
  return [];
}

function normalizeCitation(c: unknown): Citation {
  if (typeof c === "string") return { title: c };
  if (typeof c === "object" && c !== null) {
    const obj = c as Record<string, unknown>;
    return {
      title: String(obj.title ?? ""),
      doi: String(obj.doi ?? ""),
      authors: Array.isArray(obj.authors) ? obj.authors : [],
      year: typeof obj.year === "number" ? obj.year : undefined,
      claim_text: String(obj.claim_text ?? obj.relevance ?? ""),
      url: String(obj.url ?? ""),
      abstract: String(obj.abstract ?? ""),
    };
  }
  return { title: String(c) };
}

async function checkCitation(
  citation: Citation,
  domain: string,
): Promise<Record<string, unknown>> {
  const componentScores: Record<string, number> = {};
  const details: Record<string, unknown> = { title: citation.title };

  let doi = citation.doi ?? "";
  if (!doi) doi = extractDoiFromUrl(citation.url ?? "");

  // Component 1: DOI resolution (0.30)
  if (doi) {
    const doiResult = await resolveDoi(doi);
    componentScores.doi_resolution = doiResult.score;
    details.doi = doiResult;
  } else {
    componentScores.doi_resolution = 0;
    details.doi = { note: "No DOI provided" };
  }

  // Component 2: Metadata match (0.30)
  const metaResult = await checkMetadataMatch(citation);
  componentScores.metadata_match = metaResult.score;
  details.metadata = metaResult;

  // Component 3: Claim support (0.25)
  const claimScore = checkClaimSupport(
    citation,
    (metaResult as { abstract?: string }).abstract ?? "",
  );
  componentScores.claim_support = claimScore;
  details.claim_support_score = claimScore;

  // Component 4: Freshness (0.15)
  const freshnessScore = checkFreshness(citation, domain);
  componentScores.freshness = freshnessScore;
  details.freshness_score = freshnessScore;

  const weights: Record<string, number> = {
    doi_resolution: 0.30,
    metadata_match: 0.30,
    claim_support: 0.25,
    freshness: 0.15,
  };

  const score = Object.keys(weights).reduce(
    (s, k) => s + weights[k] * componentScores[k],
    0,
  );

  details.component_scores = componentScores;
  details.score = round4(score);
  return details;
}

function extractDoiFromUrl(url: string): string {
  const match = url.match(/10\.\d{4,}\/[^\s]+/);
  return match ? match[0].replace(/[.,;)]+$/, "") : "";
}

async function resolveDoi(doi: string): Promise<{ score: number; [k: string]: unknown }> {
  const res = await fetchJson<{ message?: Record<string, unknown> }>(
    `${CROSSREF_API}/${encodeURIComponent(doi)}`,
  );

  if (!res.ok || !res.data?.message) {
    return { score: 0, resolved: false, error: res.error };
  }

  const data = res.data.message;
  const retraction = checkRetractionStatus(data);

  let score = 1.0;
  if (retraction.retracted) score = 0.1;
  else if (retraction.has_correction) score = 0.7;

  const result: Record<string, unknown> = {
    score,
    resolved: true,
    doi,
    title: Array.isArray(data.title) ? data.title[0] : "",
  };
  if (retraction.retracted || retraction.has_correction) {
    result.retraction_status = retraction;
  }
  return result as { score: number };
}

function checkRetractionStatus(crossrefData: Record<string, unknown>) {
  const updateTo = crossrefData["update-to"];
  if (!Array.isArray(updateTo) || updateTo.length === 0) {
    return { retracted: false, has_correction: false };
  }

  let retracted = false;
  let has_correction = false;
  const notices: string[] = [];

  for (const update of updateTo) {
    const updateType = String(update?.type ?? "").toLowerCase();
    const label = String(update?.label ?? updateType);
    if (["retraction", "withdrawal"].some((kw) => updateType.includes(kw))) {
      retracted = true;
      notices.push(label);
    } else if (["correction", "erratum"].some((kw) => updateType.includes(kw))) {
      has_correction = true;
      notices.push(label);
    }
  }

  return { retracted, has_correction, notices };
}

async function checkMetadataMatch(
  citation: Citation,
): Promise<{ score: number; abstract?: string; [k: string]: unknown }> {
  const title = citation.title ?? "";
  if (!title) return { score: 0, note: "No title to match" };

  const oaResult = await queryOpenAlex(title);
  if (oaResult.score >= 0.7) return oaResult;

  const ssResult = await querySemanticScholar(title);
  return oaResult.score >= ssResult.score ? oaResult : ssResult;
}

async function queryOpenAlex(
  title: string,
): Promise<{ score: number; abstract?: string; [k: string]: unknown }> {
  const res = await fetchJson<{ results?: Array<Record<string, unknown>> }>(
    `${OPENALEX_API}?filter=title.search:${encodeURIComponent(title.slice(0, 200))}&per_page=1`,
  );

  if (!res.ok || !res.data?.results?.length) {
    return { score: 0, source: "openalex", error: res.error ?? "No results" };
  }

  const top = res.data.results[0];
  const oaTitle = String(top.title ?? "");
  const similarity = jaccardSimilarity(title.toLowerCase(), oaTitle.toLowerCase());

  return {
    score: round4(Math.min(1.0, similarity * 1.25)),
    source: "openalex",
    matched_title: oaTitle,
    similarity: round4(similarity),
    abstract: String(top.abstract ?? ""),
    year: top.publication_year as number | undefined,
  };
}

async function querySemanticScholar(
  title: string,
): Promise<{ score: number; abstract?: string; [k: string]: unknown }> {
  const res = await fetchJson<{ data?: Array<Record<string, unknown>> }>(
    `${SEMANTIC_SCHOLAR_API}/search?query=${encodeURIComponent(title.slice(0, 200))}&limit=1&fields=title,abstract,year,authors`,
  );

  if (!res.ok || !res.data?.data?.length) {
    return { score: 0, source: "semantic_scholar", error: res.error ?? "No results" };
  }

  const top = res.data.data[0];
  const ssTitle = String(top.title ?? "");
  const similarity = jaccardSimilarity(title.toLowerCase(), ssTitle.toLowerCase());

  return {
    score: round4(Math.min(1.0, similarity * 1.25)),
    source: "semantic_scholar",
    matched_title: ssTitle,
    similarity: round4(similarity),
    abstract: String(top.abstract ?? ""),
    year: top.year as number | undefined,
  };
}

function checkClaimSupport(citation: Citation, fetchedAbstract: string): number {
  const claimText = citation.claim_text ?? "";
  const abstract = fetchedAbstract || citation.abstract || "";
  if (!claimText || !abstract) return 0.5;
  return round4(Math.min(1.0, jaccardSimilarity(claimText.toLowerCase(), abstract.toLowerCase()) * 2.0));
}

function checkFreshness(citation: Citation, domain: string): number {
  const year = citation.year;
  if (!year || typeof year !== "number") return 0.5;

  const currentYear = new Date().getUTCFullYear();
  const age = currentYear - year;
  if (age < 0) return 0.8;

  const threshold = FAST_MOVING_DOMAINS.has(domain)
    ? FRESHNESS_THRESHOLD_FAST
    : FRESHNESS_THRESHOLD_SLOW;

  if (age <= threshold) return 1.0;
  if (age <= threshold * 2) return round4(Math.max(0.3, 1.0 - (age - threshold) / threshold));
  return 0.3;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
