import { prisma } from "@/lib/db";
import { fail, getPagination, ok } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const { page, perPage, skip } = getPagination(new URL(req.url).searchParams);
  const [items, total] = await Promise.all([
    prisma.labDocument.findMany({ where: { labId: lab.id }, orderBy: { updatedAt: "desc" }, skip, take: perPage }),
    prisma.labDocument.count({ where: { labId: lab.id } }),
  ]);

  return ok({
    items: items.map((doc) => ({
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
    })),
    total,
    page,
    per_page: perPage,
  });
}
