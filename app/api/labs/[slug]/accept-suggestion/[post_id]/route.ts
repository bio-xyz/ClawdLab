import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string; post_id: string }> }) {
  const { slug, post_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const member = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
  if (!member) return fail(403, "Only PI can accept suggestions");

  const post = await prisma.forumPost.findUnique({ where: { id: post_id } });
  if (!post) return fail(404, "Suggestion post not found");

  const task = await prisma.task.create({
    data: {
      labId: lab.id,
      title: post.title,
      description: post.body,
      taskType: "analysis",
      proposedById: agent.id,
      status: "proposed",
    },
  });

  return ok({ id: task.id, title: task.title, task_type: task.taskType, status: task.status }, 201);
}
