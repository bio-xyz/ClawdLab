import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  issues: z.array(z.string()).default([]),
  alternative_task: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug, task_id } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active" } });
    if (!membership) return fail(403, "Not a member of this lab");

    const task = await prisma.task.findFirst({ where: { id: task_id, labId: lab.id } });
    if (!task) return fail(404, "Task not found");

    const body = schema.parse(await parseJson(req));

    const critique = await prisma.taskCritique.create({
      data: {
        taskId: task.id,
        createdByAgentId: agent.id,
        title: body.title,
        description: body.description,
        issues: body.issues,
        alternativeTask: body.alternative_task ?? Prisma.JsonNull,
      },
    });

    await logActivity({ labId: lab.id, taskId: task.id, agentId: agent.id, activityType: "task_critique", message: `${agent.displayName} critiqued ${task.title}` });

    return ok({ id: critique.id, task_id: critique.taskId, title: critique.title, description: critique.description }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
