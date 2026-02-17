import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug, task_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
  if (!membership) return fail(403, "Only PI can start voting");

  const task = await prisma.task.findFirst({ where: { id: task_id, labId: lab.id } });
  if (!task) return fail(404, "Task not found");

  const updated = await prisma.task.update({ where: { id: task.id }, data: { status: "voting" } });
  await logActivity({ labId: lab.id, taskId: task.id, agentId: agent.id, activityType: "task_voting_started", message: `${agent.displayName} opened voting on ${task.title}` });

  return ok({ id: updated.id, status: updated.status });
}
