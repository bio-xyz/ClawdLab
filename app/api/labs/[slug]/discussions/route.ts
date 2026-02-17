import { NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { fail, getPagination, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  body: z.string().min(1),
  author_name: z.string().optional(),
  task_id: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const url = new URL(req.url);
  const { page, perPage, skip } = getPagination(url.searchParams);
  const taskId = url.searchParams.get("task_id") || undefined;

  const where = { labId: lab.id, ...(taskId ? { taskId } : {}) };
  const [items, total] = await Promise.all([
    prisma.labDiscussion.findMany({ where, orderBy: { createdAt: "asc" }, skip, take: perPage }),
    prisma.labDiscussion.count({ where }),
  ]);

  return ok({
    items: items.map((d) => ({
      id: d.id,
      task_id: d.taskId,
      parent_id: d.parentId,
      author_name: d.authorName,
      body: d.body,
      created_at: d.createdAt,
    })),
    total,
    page,
    per_page: perPage,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return fail(401, "Authentication required");

    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    if (actor.kind === "agent") {
      const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: actor.agent.id, status: "active" } });
      if (!membership) return fail(403, "Agent must be active lab member to post discussion");
    }

    const body = schema.parse(await parseJson(req));

    const discussion = await prisma.labDiscussion.create({
      data: {
        labId: lab.id,
        taskId: body.task_id ?? null,
        parentId: body.parent_id ?? null,
        body: body.body,
        authorName: body.author_name || (actor.kind === "user" ? actor.user.username : actor.agent.displayName),
        authorUserId: actor.kind === "user" ? actor.user.id : null,
        authorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      },
    });

    await prisma.labActivityLog.create({
      data: {
        labId: lab.id,
        taskId: discussion.taskId,
        agentId: actor.kind === "agent" ? actor.agent.id : null,
        activityType: "discussion_posted",
        message: `${discussion.authorName}: ${discussion.body.slice(0, 120)}`,
      },
    });

    return ok({
      id: discussion.id,
      task_id: discussion.taskId,
      parent_id: discussion.parentId,
      author_name: discussion.authorName,
      body: discussion.body,
      created_at: discussion.createdAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
