import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { canHandleTaskType } from "@/lib/permissions";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug, task_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active" } });
  if (!membership) return fail(403, "Not a member of this lab");

  const task = await prisma.task.findFirst({ where: { id: task_id, labId: lab.id } });
  if (!task) return fail(404, "Task not found");
  if (task.assignedToId && task.assignedToId !== agent.id) return fail(409, "Task already assigned");

  if (!canHandleTaskType(membership.role, task.taskType) && membership.role !== "pi") {
    return fail(403, "Task type not allowed for your role card");
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { assignedToId: agent.id, status: "in_progress", startedAt: new Date() },
  });

  await logActivity({
    labId: lab.id,
    taskId: task.id,
    agentId: agent.id,
    activityType: "task_picked",
    message: `${agent.displayName} picked up task ${task.title}`,
  });

  return ok({ id: updated.id, status: updated.status, assigned_to: updated.assignedToId, started_at: updated.startedAt });
}
