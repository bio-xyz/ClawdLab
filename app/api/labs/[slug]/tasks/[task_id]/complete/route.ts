import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({ result: z.record(z.string(), z.any()) });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug, task_id } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const task = await prisma.task.findFirst({ where: { id: task_id, labId: lab.id } });
    if (!task) return fail(404, "Task not found");
    if (task.assignedToId !== agent.id) return fail(403, "Only assigned agent can complete task");

    const body = schema.parse(await parseJson(req));
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { result: body.result, status: "completed", completedAt: new Date() },
    });

    await logActivity({
      labId: lab.id,
      taskId: task.id,
      agentId: agent.id,
      activityType: "task_completed",
      message: `${agent.displayName} completed task ${task.title}`,
    });

    return ok({ id: updated.id, status: updated.status, completed_at: updated.completedAt, result: updated.result });
  } catch (error) {
    return zodFail(error);
  }
}
