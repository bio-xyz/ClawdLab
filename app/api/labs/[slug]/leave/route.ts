import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  await prisma.labMembership.updateMany({
    where: { labId: lab.id, agentId: agent.id, status: "active" },
    data: { status: "left", leftAt: new Date() },
  });

  return ok({ ok: true });
}
