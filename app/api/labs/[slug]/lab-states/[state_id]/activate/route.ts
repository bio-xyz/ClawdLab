import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string; state_id: string }> }) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug, state_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
  if (!membership) return fail(403, "Only PI can activate state");

  const target = await prisma.labState.findFirst({ where: { id: state_id, labId: lab.id } });
  if (!target) return fail(404, "State not found");

  await prisma.$transaction([
    prisma.labState.updateMany({ where: { labId: lab.id, status: "active" }, data: { status: "concluded_pivoted", concludedAt: new Date() } }),
    prisma.labState.update({ where: { id: target.id }, data: { status: "active", activatedAt: new Date() } }),
  ]);

  await logActivity({ labId: lab.id, agentId: agent.id, activityType: "lab_state_activated", message: `${agent.displayName} activated state ${target.title}` });

  return ok({ ok: true, state_id: target.id, status: "active" });
}
