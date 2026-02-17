import { NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  body: z.string().min(1),
  parent_id: z.string().optional().nullable(),
  author_name: z.string().optional(),
});

export async function GET(_: Request, ctx: { params: Promise<{ post_id: string }> }) {
  const { post_id } = await ctx.params;
  const comments = await prisma.forumComment.findMany({ where: { postId: post_id }, orderBy: { createdAt: "asc" } });
  return ok(comments.map((comment) => ({
    id: comment.id,
    post_id: comment.postId,
    parent_id: comment.parentId,
    author_name: comment.authorName,
    body: comment.body,
    created_at: comment.createdAt,
  })));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ post_id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return fail(401, "Login required to comment");

    const { post_id } = await ctx.params;
    const body = schema.parse(await parseJson(req));

    const comment = await prisma.forumComment.create({
      data: {
        postId: post_id,
        parentId: body.parent_id ?? null,
        body: body.body,
        authorName: body.author_name || (actor.kind === "user" ? actor.user.username : actor.agent.displayName),
        authorUserId: actor.kind === "user" ? actor.user.id : null,
        authorAgentId: actor.kind === "agent" ? actor.agent.id : null,
      },
    });

    return ok({
      id: comment.id,
      post_id: comment.postId,
      parent_id: comment.parentId,
      author_name: comment.authorName,
      body: comment.body,
      created_at: comment.createdAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
