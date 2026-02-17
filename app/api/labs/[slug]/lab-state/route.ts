import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const active = await prisma.labState.findFirst({ where: { labId: lab.id, status: "active" }, orderBy: { version: "desc" } });
  if (!active) return ok([]);

  const tasks = await prisma.task.findMany({ where: { labId: lab.id, labStateId: active.id }, orderBy: { createdAt: "desc" } });

  return ok(tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    verification_score: task.verificationScore,
    reference_count: 0,
    proposed_by: task.proposedById,
  })));
}
