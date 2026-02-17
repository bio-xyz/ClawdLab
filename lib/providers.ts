interface NormalizedProviderResult {
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
  papers?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  raw?: unknown;
  error_code?: string | null;
  error_message?: string | null;
}

function withKey(headers: Record<string, string>, key: string | undefined) {
  if (key) headers["X-API-Key"] = key;
  return headers;
}

export async function startLiteratureProvider(input: {
  question: string;
  max_results?: number;
  per_source_limit?: number;
  sources?: string[];
  mode?: string;
}) {
  const base = process.env.BIO_LIT_AGENT_API_URL;
  const key = process.env.BIO_LIT_API_KEY;
  if (!base || !key) {
    return { ok: false as const, error_code: "provider_not_configured", error_message: "Literature provider is not configured" };
  }

  const response = await fetch(`${base}/query`, {
    method: "POST",
    headers: withKey({ "Content-Type": "application/json" }, key),
    body: JSON.stringify({
      question: input.question,
      max_results: input.max_results ?? 20,
      per_source_limit: input.per_source_limit ?? 5,
      sources: input.sources ?? ["arxiv", "pubmed", "clinical-trials"],
      mode: input.mode ?? "deep",
    }),
  });

  if (!response.ok) {
    return { ok: false as const, error_code: `upstream_${response.status}`, error_message: `Literature provider returned ${response.status}` };
  }

  const payload = await response.json();
  return { ok: true as const, external_job_id: String(payload.job_id), raw: payload };
}

export async function pollLiteratureProvider(externalJobId: string): Promise<NormalizedProviderResult> {
  const base = process.env.BIO_LIT_AGENT_API_URL;
  const key = process.env.BIO_LIT_API_KEY;
  if (!base || !key) {
    return { status: "failed", summary: null, error_code: "provider_not_configured", error_message: "Literature provider is not configured" };
  }

  const response = await fetch(`${base}/query/jobs/${externalJobId}`, {
    method: "GET",
    headers: withKey({}, key),
  });
  if (!response.ok) {
    return { status: "failed", summary: null, error_code: `upstream_${response.status}`, error_message: `Literature status returned ${response.status}` };
  }

  const payload = await response.json();
  const status = payload.status;
  if (status === "pending") return { status: "pending", summary: null, raw: payload };
  if (status === "processing") return { status: "running", summary: null, raw: payload };
  if (status !== "completed") {
    return { status: "failed", summary: null, error_code: "upstream_failed", error_message: "Literature provider reported failure", raw: payload };
  }

  return {
    status: "completed",
    summary: payload.result?.answer ?? null,
    papers: payload.result?.papers ?? [],
    raw: payload,
  };
}

export async function startAnalysisProvider(input: { task_description: string }) {
  const base = process.env.DATA_ANALYSIS_API_URL;
  const key = process.env.DATA_ANALYSIS_API_KEY;
  if (!base || !key) {
    return { ok: false as const, error_code: "provider_not_configured", error_message: "Analysis provider is not configured" };
  }

  const formData = new FormData();
  formData.append("task_description", input.task_description);

  const response = await fetch(`${base}/api/task/run/async`, {
    method: "POST",
    headers: withKey({}, key),
    body: formData,
  });

  if (!response.ok) {
    return { ok: false as const, error_code: `upstream_${response.status}`, error_message: `Analysis provider returned ${response.status}` };
  }

  const payload = await response.json();
  return { ok: true as const, external_job_id: String(payload.task_id), raw: payload };
}

export async function pollAnalysisProvider(externalJobId: string): Promise<NormalizedProviderResult> {
  const base = process.env.DATA_ANALYSIS_API_URL;
  const key = process.env.DATA_ANALYSIS_API_KEY;
  if (!base || !key) {
    return { status: "failed", summary: null, error_code: "provider_not_configured", error_message: "Analysis provider is not configured" };
  }

  const response = await fetch(`${base}/api/task/${externalJobId}`, {
    method: "GET",
    headers: withKey({}, key),
  });

  if (!response.ok) {
    return { status: "failed", summary: null, error_code: `upstream_${response.status}`, error_message: `Analysis status returned ${response.status}` };
  }

  const payload = await response.json();
  const status = payload.status;
  if (status === "pending") return { status: "pending", summary: null, raw: payload };
  if (status === "processing") return { status: "running", summary: null, raw: payload };
  if (status !== "completed" || payload.success === false) {
    return { status: "failed", summary: null, error_code: "upstream_failed", error_message: "Analysis provider reported failure", raw: payload };
  }

  return {
    status: "completed",
    summary: payload.answer ?? payload.direct_answer ?? null,
    artifacts: payload.artifacts ?? [],
    raw: payload,
  };
}
