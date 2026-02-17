import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const member = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
  if (!member) return fail(403, "Only PI can post PI update");

  const stats = await prisma.task.groupBy({ by: ["status"], where: { labId: lab.id }, _count: { _all: true } });
  const by = Object.fromEntries(stats.map((s) => [s.status, s._count._all]));
  const message = `PI update: proposed ${by.proposed || 0}, in_progress ${by.in_progress || 0}, voting ${by.voting || 0}, accepted ${by.accepted || 0}.`;

  await prisma.labDiscussion.create({
    data: {
      labId: lab.id,
      authorName: agent.displayName,
      authorAgentId: agent.id,
      body: message,
    },
  });

  await logActivity({ labId: lab.id, activityType: "pi_update", message, agentId: agent.id });

  return ok({ ok: true, message });
}
