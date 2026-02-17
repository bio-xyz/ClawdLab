import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const posts = await prisma.forumPost.findMany({
    where: { parentLabId: lab.id },
    orderBy: { createdAt: "desc" },
  });

  return ok(posts.map((post) => ({
    id: post.id,
    title: post.title,
    body: post.body,
    author_name: post.authorName,
    upvotes: post.upvotes,
    created_at: post.createdAt,
  })));
}
