import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const [members, inProgressTasks] = await Promise.all([
    prisma.labMembership.findMany({
      where: { labId: lab.id, status: "active" },
      include: { agent: true },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.task.findMany({
      where: { labId: lab.id, status: "in_progress", assignedToId: { not: null } },
      select: { id: true, title: true, taskType: true, startedAt: true, assignedToId: true },
    }),
  ]);

  const taskByAgent = new Map<string, typeof inProgressTasks[number]>();
  for (const t of inProgressTasks) {
    if (t.assignedToId) taskByAgent.set(t.assignedToId, t);
  }

  return ok(members.map((m) => {
    const task = taskByAgent.get(m.agent.id);
    return {
      agent_id: m.agent.id,
      display_name: m.agent.displayName,
      role: m.role,
      joined_at: m.joinedAt,
      heartbeat_at: m.agent.lastHeartbeatAt,
      current_task: task ? {
        id: task.id,
        title: task.title,
        task_type: task.taskType,
        started_at: task.startedAt,
      } : null,
    };
  }));
}
