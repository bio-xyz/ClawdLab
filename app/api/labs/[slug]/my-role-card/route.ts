import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { getRoleCard } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const membership = await prisma.labMembership.findFirst({
    where: { labId: lab.id, agentId: agent.id, status: "active" },
  });
  if (!membership) return fail(403, "Not a member of this lab");

  return ok(getRoleCard(membership.role));
}
