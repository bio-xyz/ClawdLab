import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgentMembership } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { presignUploadWithConfig } from "@/lib/s3";

const schema = z.object({
  filename: z.string().min(1),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
  task_id: z.string().optional().nullable(),
  s3_endpoint: z.string().min(1).optional(),
  s3_region: z.string().min(1).optional(),
  s3_bucket: z.string().min(1).optional(),
  s3_access_key_id: z.string().min(1).optional(),
  s3_secret_access_key: z.string().min(1).optional(),
});

function sanitizeFilename(filename: string) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

function resolveS3Config(body: z.infer<typeof schema>) {
  const endpoint = body.s3_endpoint || process.env.S3_ENDPOINT;
  const region = body.s3_region || process.env.S3_REGION;
  const bucket = body.s3_bucket || process.env.S3_BUCKET;
  const accessKeyId = body.s3_access_key_id || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = body.s3_secret_access_key || process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return { config: null, error: "S3 configuration is incomplete (endpoint, region, bucket, access key, secret key)" };
  }

  return {
    config: {
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
    },
    error: null,
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

    const maxSize = Number(process.env.S3_DATASET_MAX_SIZE_BYTES || "209715200");
    if (!Number.isFinite(maxSize) || maxSize <= 0) {
      return fail(500, "S3_DATASET_MAX_SIZE_BYTES must be a positive number");
    }
    if (body.size_bytes > maxSize) {
      return fail(422, `Dataset exceeds maximum allowed size (${maxSize} bytes)`);
    }

    if (body.task_id) {
      const task = await prisma.task.findFirst({ where: { id: body.task_id, labId: lab.id } });
      if (!task) return fail(404, "Task not found in lab");
    }

    const safeFilename = sanitizeFilename(body.filename);
    if (!safeFilename) {
      return fail(422, "Filename is invalid after sanitization");
    }

    const scope = body.task_id ? `task-${body.task_id}` : "unscoped";
    const key = `lab/${slug}/datasets/${scope}/${Date.now()}-${safeFilename}`;
    const expiresIn = Number(process.env.S3_PRESIGN_UPLOAD_EXPIRES_SECONDS || "3600");
    const s3 = resolveS3Config(body);
    if (s3.error || !s3.config) return fail(500, s3.error || "S3 configuration is invalid");
    const { uploadUrl, bucket } = await presignUploadWithConfig({
      key,
      contentType: body.content_type,
      expiresIn,
      config: s3.config,
    });

    return ok({
      upload_url: uploadUrl,
      s3_key: key,
      s3_path: `s3://${bucket}/${key}`,
      filename: body.filename,
      content_type: body.content_type,
      size_bytes: body.size_bytes,
      expires_in: expiresIn,
    });
  } catch (error) {
    return zodFail(error);
  }
}
