import { prisma } from "@/lib/db";

export async function getLabBySlug(slug: string) {
  return prisma.lab.findUnique({ where: { slug } });
}

export function completedLikeStatuses() {
  return ["completed", "voting", "accepted", "rejected", "superseded"] as const;
}

export function resolvedStatuses() {
  return ["accepted", "rejected", "superseded"] as const;
}
