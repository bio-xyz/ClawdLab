import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgentMembership } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { presignUpload } from "@/lib/s3";

const schema = z.object({
  filename: z.string().min(1),
  logical_path: z.string().min(1),
  content_type: z.string(),
  task_id: z.string().optional().nullable(),
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

    const key = `lab/${slug}/docs/${body.logical_path}`;
    const expiresIn = Number(process.env.S3_PRESIGN_UPLOAD_EXPIRES_SECONDS || "3600");
    const { uploadUrl } = await presignUpload({ key, contentType: body.content_type, expiresIn });

    return ok({
      upload_url: uploadUrl,
      s3_key: key,
      logical_path: body.logical_path,
      expires_in: expiresIn,
    });
  } catch (error) {
    return zodFail(error);
  }
}
