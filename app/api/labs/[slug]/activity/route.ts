import { prisma } from "@/lib/db";
import { fail, getPagination, ok } from "@/lib/http";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const url = new URL(req.url);
  const { page, perPage, skip } = getPagination(url.searchParams);

  const [items, total] = await Promise.all([
    prisma.labActivityLog.findMany({ where: { labId: lab.id }, orderBy: { createdAt: "desc" }, skip, take: perPage }),
    prisma.labActivityLog.count({ where: { labId: lab.id } }),
  ]);

  return ok({
    items: items.map((entry) => ({
      id: entry.id,
      activity_type: entry.activityType,
      message: entry.message,
      task_id: entry.taskId,
      agent_id: entry.agentId,
      created_at: entry.createdAt,
    })),
    total,
    page,
    per_page: perPage,
  });
}
