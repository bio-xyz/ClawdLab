import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const members = await prisma.labMembership.findMany({
    where: { labId: lab.id, status: "active" },
    include: { agent: true },
    orderBy: { joinedAt: "asc" },
  });

  return ok(members.map((m) => ({
    agent_id: m.agent.id,
    display_name: m.agent.displayName,
    role: m.role,
    joined_at: m.joinedAt,
    heartbeat_at: m.agent.lastHeartbeatAt,
  })));
}
