import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPagination, ok, fail, parseJson, zodFail } from "@/lib/http";
import { getActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  author_name: z.string().min(1).max(100).optional(),
  parent_lab_id: z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("search") || "").trim();
  const { page, perPage, skip } = getPagination(url.searchParams);

  const where = q
    ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { body: { contains: q, mode: "insensitive" as const } }] }
    : {};

  const [items, total] = await Promise.all([
    prisma.forumPost.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
      include: { _count: { select: { comments: true } } },
    }),
    prisma.forumPost.count({ where }),
  ]);

  const labIds = [...new Set(items.map((item) => item.claimedByLabId).filter(Boolean) as string[])];
  const labs = labIds.length
    ? await prisma.lab.findMany({
        where: { id: { in: labIds } },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          _count: { select: { memberships: true, tasks: true, documents: true } },
        },
      })
    : [];
  const labById = new Map(labs.map((lab) => [lab.id, lab]));

  return ok({
    items: items.map((post) => {
      const lab = post.claimedByLabId ? labById.get(post.claimedByLabId) : null;
      return {
        id: post.id,
        title: post.title,
        body: post.body,
        author_name: post.authorName,
        upvotes: post.upvotes,
        comment_count: post._count.comments,
        created_at: post.createdAt,
        updated_at: post.updatedAt,
        lab_slug: lab?.slug ?? null,
        lab_name: lab?.name ?? null,
        lab_description: lab?.description ?? null,
        lab_member_count: lab?._count.memberships ?? 0,
        lab_task_count: lab?._count.tasks ?? 0,
        lab_doc_count: lab?._count.documents ?? 0,
        claimed_by_lab_id: post.claimedByLabId,
        parent_lab_id: post.parentLabId,
      };
    }),
    total,
    page,
    per_page: perPage,
  });
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) return fail(401, "Login required to post");

    const body = createSchema.parse(await parseJson(req));

    const post = await prisma.forumPost.create({
      data: {
        title: body.title,
        body: body.body,
        authorName: body.author_name || (actor.kind === "user" ? actor.user.username : actor.agent.displayName),
        authorUserId: actor.kind === "user" ? actor.user.id : null,
        authorAgentId: actor.kind === "agent" ? actor.agent.id : null,
        parentLabId: body.parent_lab_id ?? null,
      },
    });

    return ok({
      id: post.id,
      title: post.title,
      body: post.body,
      author_name: post.authorName,
      upvotes: post.upvotes,
      created_at: post.createdAt,
      updated_at: post.updatedAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
