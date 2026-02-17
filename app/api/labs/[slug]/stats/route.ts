import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const tasks = await prisma.task.groupBy({ by: ["status"], where: { labId: lab.id }, _count: { _all: true } });
  const by = Object.fromEntries(tasks.map((item) => [item.status, item._count._all]));

  return ok({
    proposed: by.proposed || 0,
    in_progress: by.in_progress || 0,
    completed: by.completed || 0,
    critique_period: by.critique_period || 0,
    voting: by.voting || 0,
    accepted: by.accepted || 0,
    rejected: by.rejected || 0,
    superseded: by.superseded || 0,
  });
}
