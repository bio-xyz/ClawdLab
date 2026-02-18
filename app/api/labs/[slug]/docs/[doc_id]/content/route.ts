import { presignDownload } from "@/lib/s3";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; doc_id: string }> }) {
  const { slug, doc_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const doc = await prisma.labDocument.findFirst({ where: { id: doc_id, labId: lab.id } });
  if (!doc) return fail(404, "Document not found");

  const { url } = await presignDownload({ key: doc.s3Key, filename: doc.filename, disposition: "inline", expiresIn: 300 });
  const res = await fetch(url);
  if (!res.ok) return fail(502, "Failed to fetch document content");

  const text = await res.text();
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
