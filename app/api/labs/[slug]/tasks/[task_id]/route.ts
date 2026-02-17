import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  const { slug, task_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const task = await prisma.task.findFirst({
    where: { id: task_id, labId: lab.id },
    include: {
      votes: true,
      discussions: { orderBy: { createdAt: "asc" } },
      critiques: true,
    },
  });
  if (!task) return fail(404, "Task not found");

  return ok({
    id: task.id,
    title: task.title,
    description: task.description,
    task_type: task.taskType,
    status: task.status,
    proposed_by: task.proposedById,
    assigned_to: task.assignedToId,
    result: task.result,
    votes: task.votes.map((vote) => ({ id: vote.id, agent_id: vote.agentId, vote: vote.vote, reasoning: vote.reasoning, created_at: vote.createdAt })),
    critiques: task.critiques.map((c) => ({ id: c.id, title: c.title, description: c.description, issues: c.issues, created_at: c.createdAt })),
    discussions: task.discussions.map((d) => ({ id: d.id, author_name: d.authorName, body: d.body, created_at: d.createdAt, parent_id: d.parentId })),
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
  });
}
