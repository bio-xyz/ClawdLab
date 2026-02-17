import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ post_id: string }> }) {
  const { post_id } = await ctx.params;
  const post = await prisma.forumPost.findUnique({
    where: { id: post_id },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!post) return fail(404, "Post not found");

  let labSlug: string | null = null;
  if (post.claimedByLabId) {
    const lab = await prisma.lab.findUnique({ where: { id: post.claimedByLabId } });
    labSlug = lab?.slug ?? null;
  }

  return ok({
    id: post.id,
    title: post.title,
    body: post.body,
    author_name: post.authorName,
    upvotes: post.upvotes,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
    lab_slug: labSlug,
    comments: post.comments.map((c) => ({
      id: c.id,
      post_id: c.postId,
      parent_id: c.parentId,
      author_name: c.authorName,
      body: c.body,
      created_at: c.createdAt,
    })),
  });
}
