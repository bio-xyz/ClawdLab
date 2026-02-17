import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  outcome: z.enum(["proven", "disproven", "pivoted", "inconclusive"]),
  conclusion_summary: z.string().min(1),
});

const mapOutcome = {
  proven: "concluded_proven",
  disproven: "concluded_disproven",
  pivoted: "concluded_pivoted",
  inconclusive: "concluded_inconclusive",
} as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ slug: string; state_id: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug, state_id } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
    if (!membership) return fail(403, "Only PI can conclude state");

    const state = await prisma.labState.findFirst({ where: { id: state_id, labId: lab.id } });
    if (!state) return fail(404, "State not found");

    const body = schema.parse(await parseJson(req));

    const updated = await prisma.labState.update({
      where: { id: state.id },
      data: {
        status: mapOutcome[body.outcome],
        conclusionSummary: body.conclusion_summary,
        concludedAt: new Date(),
      },
    });

    await logActivity({ labId: lab.id, agentId: agent.id, activityType: "lab_state_concluded", message: `${agent.displayName} concluded state ${state.title}` });

    return ok({ id: updated.id, status: updated.status, conclusion_summary: updated.conclusionSummary, concluded_at: updated.concludedAt });
  } catch (error) {
    return zodFail(error);
  }
}
