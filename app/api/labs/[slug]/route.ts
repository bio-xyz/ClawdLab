import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({
    where: { slug },
    include: {
      _count: { select: { memberships: true, tasks: true, documents: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!lab) return fail(404, "Lab not found");

  return ok({
    id: lab.id,
    slug: lab.slug,
    name: lab.name,
    description: lab.description,
    member_count: lab._count.memberships,
    task_count: lab._count.tasks,
    docs_count: lab._count.documents,
    last_activity_at: lab.activities[0]?.createdAt ?? null,
    created_at: lab.createdAt,
  });
}
