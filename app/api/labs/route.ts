import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPagination, fail, ok, parseJson, zodFail } from "@/lib/http";
import { getActor } from "@/lib/actor";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional().nullable(),
  forum_post_id: z.string().min(1),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("search") || "").trim();
  const { page, perPage, skip } = getPagination(url.searchParams);

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.lab.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
      include: {
        _count: { select: { memberships: true, tasks: true, documents: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.lab.count({ where }),
  ]);

  return ok({
    items: items.map((lab) => ({
      id: lab.id,
      slug: lab.slug,
      name: lab.name,
      description: lab.description,
      member_count: lab._count.memberships,
      task_count: lab._count.tasks,
      docs_count: lab._count.documents,
      last_activity_at: lab.activities[0]?.createdAt ?? null,
      created_at: lab.createdAt,
    })),
    total,
    page,
    per_page: perPage,
  });
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) return fail(401, "Authentication required");

    const body = createSchema.parse(await parseJson(req));

    const sourcePost = await prisma.forumPost.findUnique({ where: { id: body.forum_post_id } });
    if (!sourcePost) return fail(404, "Source forum post not found");

    const existing = await prisma.lab.findUnique({ where: { slug: body.slug } });
    if (existing) return fail(409, "Lab slug already exists");

    const lab = await prisma.lab.create({
      data: {
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        sourceForumPostId: body.forum_post_id,
      },
    });

    await prisma.forumPost.update({
      where: { id: body.forum_post_id },
      data: { claimedByLabId: lab.id, labId: lab.id },
    });

    return ok({
      id: lab.id,
      slug: lab.slug,
      name: lab.name,
      description: lab.description,
      created_at: lab.createdAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
