import { presignDownload } from "@/lib/s3";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string; doc_id: string }> }) {
  const { slug, doc_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const doc = await prisma.labDocument.findFirst({ where: { id: doc_id, labId: lab.id } });
  if (!doc) return fail(404, "Document not found");

  const url = new URL(req.url);
  const disposition = (url.searchParams.get("disposition") || "inline") as "inline" | "attachment";
  const expiresIn = Number(process.env.S3_PRESIGN_DOWNLOAD_EXPIRES_SECONDS || "604800");

  const signed = await presignDownload({ key: doc.s3Key, filename: doc.filename, disposition, expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return ok({ url: signed.url, expires_at: expiresAt });
}
