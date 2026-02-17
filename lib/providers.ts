interface NormalizedProviderResult {
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
  papers?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  raw?: unknown;
  error_code?: string | null;
  error_message?: string | null;
}

export interface AnalysisDatasetReference {
  id?: string;
  filename?: string;
  s3_path?: string;
  s3_key?: string;
  description?: string;
}

export interface AnalysisS3Override {
  s3_endpoint?: string;
  s3_region?: string;
  s3_bucket?: string;
  s3_access_key_id?: string;
  s3_secret_access_key?: string;
}

function withKey(headers: Record<string, string>, key: string | undefined) {
  if (key) headers["X-API-Key"] = key;
  return headers;
}

function normalizeAnalysisStatus(value: unknown): NormalizedProviderResult["status"] {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "pending" || normalized === "queued") return "pending";
  if (normalized === "processing" || normalized === "running" || normalized === "in_progress") return "running";
  if (normalized === "completed" || normalized === "success" || normalized === "succeeded") return "completed";
  return "failed";
}

function resolveAnalysisS3(input: AnalysisS3Override) {
  return {
    endpoint: input.s3_endpoint || process.env.S3_ENDPOINT,
    region: input.s3_region || process.env.S3_REGION,
    bucket: input.s3_bucket || process.env.S3_BUCKET,
    accessKeyId: input.s3_access_key_id || process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: input.s3_secret_access_key || process.env.S3_SECRET_ACCESS_KEY,
  };
}

function parseS3Uri(raw: string) {
  const match = raw.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
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

export async function startAnalysisProvider(input: {
  task_description: string;
  datasets?: AnalysisDatasetReference[];
  s3_endpoint?: string;
  s3_region?: string;
  s3_bucket?: string;
  s3_access_key_id?: string;
  s3_secret_access_key?: string;
}) {
  const base = process.env.DATA_ANALYSIS_API_URL;
  const key = process.env.DATA_ANALYSIS_API_KEY;
  if (!base || !key) {
    return { ok: false as const, error_code: "provider_not_configured", error_message: "Analysis provider is not configured" };
  }

  const formData = new FormData();
  formData.append("task_description", input.task_description);
  const hasS3Override = Boolean(
    input.s3_endpoint ||
    input.s3_region ||
    input.s3_bucket ||
    input.s3_access_key_id ||
    input.s3_secret_access_key
  );
  const s3 = resolveAnalysisS3(input);

  if (hasS3Override) {
    if (s3.endpoint) {
      formData.append("s3_endpoint", s3.endpoint);
      formData.append("S3_ENDPOINT", s3.endpoint);
    }
    if (s3.region) {
      formData.append("s3_region", s3.region);
      formData.append("S3_REGION", s3.region);
    }
    if (s3.bucket) {
      formData.append("s3_bucket", s3.bucket);
      formData.append("S3_BUCKET", s3.bucket);
    }
    if (s3.accessKeyId) {
      formData.append("s3_access_key_id", s3.accessKeyId);
      formData.append("S3_ACCESS_KEY_ID", s3.accessKeyId);
    }
    if (s3.secretAccessKey) {
      formData.append("s3_secret_access_key", s3.secretAccessKey);
      formData.append("S3_SECRET_ACCESS_KEY", s3.secretAccessKey);
    }
  }

  if (input.datasets && input.datasets.length > 0) {
    const filePaths: string[] = [];
    for (const dataset of input.datasets) {
      // Upstream analysis service expects S3 object keys in file_paths.
      if (dataset.s3_key) {
        filePaths.push(dataset.s3_key);
        continue;
      }

      if (dataset.s3_path) {
        const parsed = parseS3Uri(dataset.s3_path);
        if (parsed) {
          filePaths.push(parsed.key);
        } else {
          // Fallback for non-S3 path styles. Upstream may still reject these.
          filePaths.push(dataset.s3_path);
        }
      }
    }

    for (const filePath of filePaths) {
      formData.append("file_paths", filePath);
    }
    formData.append("data_files_description", JSON.stringify(input.datasets));
  }

  const response = await fetch(`${base}/api/task/run/async`, {
    method: "POST",
    headers: withKey({}, key),
    body: formData,
  });

  if (!response.ok) {
    return { ok: false as const, error_code: `upstream_${response.status}`, error_message: `Analysis provider returned ${response.status}` };
  }

  const payload = await response.json();
  const externalJobId = payload?.task_id ?? payload?.id ?? payload?.job_id;
  if (!externalJobId) {
    return { ok: false as const, error_code: "upstream_bad_payload", error_message: "Analysis provider did not return a task identifier" };
  }

  return { ok: true as const, external_job_id: String(externalJobId), raw: payload };
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
  const status = normalizeAnalysisStatus(payload.status);
  if (status === "pending") return { status: "pending", summary: null, raw: payload };
  if (status === "running") return { status: "running", summary: null, raw: payload };
  if (status !== "completed" || payload.success === false) {
    return { status: "failed", summary: null, error_code: "upstream_failed", error_message: "Analysis provider reported failure", raw: payload };
  }

  return {
    status: "completed",
    summary: payload.answer ?? payload.direct_answer ?? payload.result?.answer ?? null,
    artifacts: payload.artifacts ?? payload.result?.artifacts ?? [],
    raw: payload,
  };
}
