import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const tasks = await prisma.task.findMany({
    where: { labId: lab.id, status: { in: ["accepted", "rejected"] } },
    include: { votes: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return ok(tasks.map((task) => ({
    task_id: task.id,
    title: task.title,
    status: task.status,
    votes: task.votes.map((vote) => ({ vote: vote.vote, reasoning: vote.reasoning, agent_id: vote.agentId })),
  })));
}
