import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgentMembership } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  filename: z.string().min(1),
  logical_path: z.string().min(1),
  s3_key: z.string().min(1),
  content_type: z.string(),
  task_id: z.string().optional().nullable(),
  size_bytes: z.number().int().optional().nullable(),
  checksum_sha256: z.string().optional().nullable(),
});

function isMarkdownFile(filename: string, contentType: string) {
  return filename.toLowerCase().endsWith(".md") && contentType.toLowerCase() === "text/markdown";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const auth = await requireAgentMembership({ req, labId: lab.id });
    if (!auth.ok) return fail(auth.reason === "unauthorized" ? 401 : 403, "Agent membership required");

    const body = schema.parse(await parseJson(req));
    if (!isMarkdownFile(body.filename, body.content_type)) {
      return fail(422, "Only markdown uploads are allowed (.md, text/markdown)");
    }

    if (body.task_id) {
      const task = await prisma.task.findFirst({ where: { id: body.task_id, labId: lab.id } });
      if (!task) return fail(404, "Task not found in lab");
    }

    const doc = await prisma.labDocument.upsert({
      where: { labId_logicalPath: { labId: lab.id, logicalPath: body.logical_path } },
      update: {
        filename: body.filename,
        s3Key: body.s3_key,
        contentType: body.content_type,
        taskId: body.task_id ?? null,
        sizeBytes: body.size_bytes ?? null,
        checksumSha256: body.checksum_sha256 ?? null,
      },
      create: {
        labId: lab.id,
        uploadedById: auth.agent.id,
        filename: body.filename,
        logicalPath: body.logical_path,
        s3Key: body.s3_key,
        contentType: body.content_type,
        taskId: body.task_id ?? null,
        sizeBytes: body.size_bytes ?? null,
        checksumSha256: body.checksum_sha256 ?? null,
      },
    });

    await logActivity({
      labId: lab.id,
      taskId: body.task_id ?? null,
      agentId: auth.agent.id,
      activityType: "doc_uploaded",
      message: `${auth.agent.displayName} uploaded ${body.logical_path}`,
    });

    return ok({
      id: doc.id,
      lab_id: doc.labId,
      task_id: doc.taskId,
      uploaded_by: doc.uploadedById,
      filename: doc.filename,
      logical_path: doc.logicalPath,
      s3_key: doc.s3Key,
      content_type: doc.contentType,
      size_bytes: doc.sizeBytes,
      checksum_sha256: doc.checksumSha256,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    });
  } catch (error) {
    return zodFail(error);
  }
}
