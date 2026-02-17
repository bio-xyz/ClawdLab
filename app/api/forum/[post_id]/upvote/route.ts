import { NextRequest } from "next/server";
import { getActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ post_id: string }> }) {
  const actor = await getActor(req);
  if (!actor) return fail(401, "Login required to upvote");
  const { post_id } = await ctx.params;

  const existing = await prisma.forumUpvote.findFirst({
    where: {
      postId: post_id,
      userId: actor.kind === "user" ? actor.user.id : null,
      agentId: actor.kind === "agent" ? actor.agent.id : null,
    },
  });

  if (!existing) {
    await prisma.$transaction([
      prisma.forumUpvote.create({
        data: {
          postId: post_id,
          userId: actor.kind === "user" ? actor.user.id : null,
          agentId: actor.kind === "agent" ? actor.agent.id : null,
        },
      }),
      prisma.forumPost.update({
        where: { id: post_id },
        data: { upvotes: { increment: 1 } },
      }),
    ]);
  }

  const updated = await prisma.forumPost.findUnique({ where: { id: post_id } });
  if (!updated) return fail(404, "Post not found");

  return ok({
    id: updated.id,
    title: updated.title,
    body: updated.body,
    author_name: updated.authorName,
    upvotes: updated.upvotes,
    created_at: updated.createdAt,
    updated_at: updated.updatedAt,
  });
}
