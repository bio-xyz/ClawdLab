# Analysis Provider: S3 Bucket Mismatch

## The Problem

When an OpenClaw agent wants to run a data analysis task with datasets, it currently has to **supply its own S3 credentials** in the request body:

```json
POST /api/labs/{slug}/provider/analysis/start
{
  "task_id": "...",
  "task_description": "...",
  "datasets": [{ "s3_key": "lab/my-lab/datasets/..." }],
  "s3_endpoint": "https://fra1.digitaloceanspaces.com",
  "s3_region": "fra1",
  "s3_bucket": "bioagent-platform-staging",
  "s3_access_key_id": "...",
  "s3_secret_access_key": "..."
}
```

This is because the **external bio-data-analysis service** (`DATA_ANALYSIS_API_URL`) operates on a different S3 bucket than the one ClawdLabNextJS uses for its own storage. The analysis service needs to download dataset files from S3, so it needs credentials for wherever those files live.

## Why This Is a Problem

1. **Agents handle secrets they shouldn't.** ClawdLab's design principle is that agents never receive provider API keys or storage credentials. Requiring agents to pass S3 credentials violates this.

2. **Credential leakage risk.** Every agent request containing `s3_secret_access_key` is a vector for accidental logging, interception, or misuse. The route does redact the secret before persisting `requestPayload`, but the secret still travels over the wire from agent to ClawdLab to the analysis provider.

3. **Operational friction.** Agents need to be pre-configured with the correct S3 credentials for the bucket that matches the analysis provider, which is a deployment detail they shouldn't need to know about.

## Current Workaround

The analysis start route and dataset presign-upload route both accept optional S3 override fields. If omitted, they fall back to the server's `S3_*` env vars. This works when ClawdLab's bucket and the analysis provider's bucket are the same — but they currently aren't.

## Ideal Solution

The backend should own the S3 integration end-to-end:

- **Option A: Shared bucket.** ClawdLabNextJS and the bio-data-analysis service use the same S3 bucket. The backend passes its own credentials to the analysis provider. Agents never see S3 secrets.

- **Option B: Backend-mediated transfer.** ClawdLabNextJS downloads the dataset from its bucket and re-uploads (or streams) it to the analysis provider's expected location, using server-side credentials for both.

- **Option C: Presigned read URLs.** Instead of passing S3 credentials to the analysis provider, ClawdLabNextJS generates presigned download URLs for each dataset and sends those to the analysis service. The analysis service fetches files via HTTPS — no S3 credentials needed.

Until one of these is implemented, agents must include S3 credentials in analysis requests when the buckets don't match.
