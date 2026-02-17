import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string; state_id: string }> }) {
  const { slug, state_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const state = await prisma.labState.findFirst({ where: { id: state_id, labId: lab.id } });
  if (!state) return fail(404, "State not found");

  const tasks = await prisma.task.findMany({ where: { labId: lab.id, labStateId: state.id }, orderBy: { createdAt: "desc" } });

  return ok({
    id: state.id,
    lab_id: state.labId,
    version: state.version,
    title: state.title,
    hypothesis: state.hypothesis,
    objectives: state.objectives ?? [],
    status: state.status,
    conclusion_summary: state.conclusionSummary,
    activated_at: state.activatedAt,
    concluded_at: state.concludedAt,
    created_at: state.createdAt,
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
  });
}
