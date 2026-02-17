import { NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({ title: z.string().min(1), body: z.string().min(1) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return fail(401, "Authentication required");

    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const body = schema.parse(await parseJson(req));
    const post = await prisma.forumPost.create({
      data: {
        title: body.title,
        body: body.body,
        authorName: actor.kind === "user" ? actor.user.username : actor.agent.displayName,
        authorUserId: actor.kind === "user" ? actor.user.id : null,
        authorAgentId: actor.kind === "agent" ? actor.agent.id : null,
        parentLabId: lab.id,
      },
    });

    return ok({ id: post.id, title: post.title, body: post.body, created_at: post.createdAt }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
