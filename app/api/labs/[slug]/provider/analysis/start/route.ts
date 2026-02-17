import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgentMembership } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { startAnalysisProvider } from "@/lib/providers";

const datasetSchema = z.object({
  id: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  s3_path: z.string().min(1).optional(),
  s3_key: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
}).refine((dataset) => Boolean(dataset.s3_path || dataset.s3_key), {
  message: "Each dataset must include s3_path or s3_key",
});

const schema = z.object({
  task_id: z.string().min(1),
  task_description: z.string().min(1),
  datasets: z.array(datasetSchema).optional(),
  s3_endpoint: z.string().min(1).optional(),
  s3_region: z.string().min(1).optional(),
  s3_bucket: z.string().min(1).optional(),
  s3_access_key_id: z.string().min(1).optional(),
  s3_secret_access_key: z.string().min(1).optional(),
});

type Dataset = z.infer<typeof datasetSchema>;
type AnalysisStartBody = z.infer<typeof schema>;

function parseS3Path(raw: string) {
  const match = raw.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

function resolveS3Bucket(body: AnalysisStartBody) {
  return body.s3_bucket?.trim() || process.env.S3_BUCKET || "";
}

function normalizeDatasets(input: Dataset[] | undefined, slug: string, bucket: string): { datasets: Dataset[]; error: string | null } {
  if (!input || input.length === 0) return { datasets: [], error: null };
  if (!bucket) return { datasets: [], error: "S3 bucket is not configured for dataset references" };
  const keyPrefix = `lab/${slug}/datasets/`;

  const normalized: Dataset[] = [];
  for (const dataset of input) {
    let s3Path = dataset.s3_path?.trim();
    let s3Key = dataset.s3_key?.trim();

    if (s3Path) {
      const parsed = parseS3Path(s3Path);
      if (!parsed) {
        return { datasets: [], error: "Each dataset s3_path must be formatted as s3://<bucket>/<key>" };
      }
      if (parsed.bucket !== bucket) {
        return { datasets: [], error: `Each dataset s3_path bucket must be ${bucket}` };
      }
      if (!parsed.key.startsWith(keyPrefix)) {
        return { datasets: [], error: `Each dataset s3_path must be under s3://${parsed.bucket}/${keyPrefix}` };
      }
      if (!s3Key) s3Key = parsed.key;
    }

    if (s3Key && !s3Key.startsWith(keyPrefix)) {
      return { datasets: [], error: `Each dataset s3_key must be under ${keyPrefix}` };
    }

    if (!s3Path && s3Key) {
      s3Path = `s3://${bucket}/${s3Key}`;
    }

    normalized.push({
      ...dataset,
      s3_path: s3Path,
      s3_key: s3Key,
    });
  }

  return { datasets: normalized, error: null };
}

function redactS3Secret(body: AnalysisStartBody) {
  if (!body.s3_secret_access_key) return body;
  return {
    ...body,
    s3_secret_access_key: "***redacted***",
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const auth = await requireAgentMembership({ req, labId: lab.id });
    if (!auth.ok) return fail(auth.reason === "unauthorized" ? 401 : 403, "Agent membership required");

    const body = schema.parse(await parseJson(req));
    const task = await prisma.task.findFirst({ where: { id: body.task_id, labId: lab.id } });
    if (!task) return fail(404, "Task not found in lab");
    const bucket = resolveS3Bucket(body);
    const normalizedDatasets = normalizeDatasets(body.datasets, slug, bucket);
    if (normalizedDatasets.error) return fail(422, normalizedDatasets.error);

    const job = await prisma.providerJob.create({
      data: {
        labId: lab.id,
        taskId: task.id,
        requestedById: auth.agent.id,
        kind: "analysis",
        status: "running",
        requestPayload: redactS3Secret(body),
      },
    });

    const started = await startAnalysisProvider({
      task_description: body.task_description,
      datasets: normalizedDatasets.datasets,
      s3_endpoint: body.s3_endpoint,
      s3_region: body.s3_region,
      s3_bucket: body.s3_bucket,
      s3_access_key_id: body.s3_access_key_id,
      s3_secret_access_key: body.s3_secret_access_key,
    });
    if (!started.ok) {
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorCode: started.error_code,
          errorMessage: started.error_message,
        },
      });
      return fail(502, started.error_message || "Provider start failed");
    }

    const updated = await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        externalJobId: started.external_job_id,
        rawResult: started.raw,
      },
    });

    return ok({
      job_id: updated.id,
      status: updated.status,
      provider: "analysis",
      external_job_id: updated.externalJobId,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
