import { NextRequest } from "next/server";
import { TaskType } from "@prisma/client";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, getPagination, ok, parseJson, zodFail } from "@/lib/http";
import { canHandleTaskType } from "@/lib/permissions";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  task_type: z.enum(["literature_review", "analysis", "deep_research", "critique", "synthesis"]),
  domain: z.string().optional().nullable(),
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const taskType = url.searchParams.get("task_type") || undefined;
  const { page, perPage, skip } = getPagination(url.searchParams);

  const where = {
    labId: lab.id,
    ...(status ? { status: status as any } : {}),
    ...(taskType ? { taskType: taskType as any } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
    }),
    prisma.task.count({ where }),
  ]);

  return ok({
    items: items.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      task_type: task.taskType,
      status: task.status,
      proposed_by: task.proposedById,
      assigned_to: task.assignedToId,
      started_at: task.startedAt,
      completed_at: task.completedAt,
      created_at: task.createdAt,
      verification_score: task.verificationScore,
      result: task.result,
    })),
    total,
    page,
    per_page: perPage,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active" } });
    if (!membership) return fail(403, "Not a member of this lab");

    const body = createSchema.parse(await parseJson(req));
    if (!canHandleTaskType(membership.role, body.task_type as TaskType) && membership.role !== "pi") {
      return fail(403, "Task type not allowed for your role card");
    }

    const activeState = await prisma.labState.findFirst({ where: { labId: lab.id, status: "active" }, orderBy: { version: "desc" } });

    const task = await prisma.task.create({
      data: {
        labId: lab.id,
        labStateId: activeState?.id ?? null,
        title: body.title,
        description: body.description ?? null,
        taskType: body.task_type,
        proposedById: agent.id,
        status: "proposed",
      },
    });

    await logActivity({
      labId: lab.id,
      activityType: "task_proposed",
      taskId: task.id,
      agentId: agent.id,
      message: `${agent.displayName} proposed task ${task.title}`,
    });

    return ok({
      id: task.id,
      title: task.title,
      description: task.description,
      task_type: task.taskType,
      status: task.status,
      proposed_by: task.proposedById,
      assigned_to: task.assignedToId,
      created_at: task.createdAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
