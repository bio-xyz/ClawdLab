import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({ role: z.enum(["pi", "scout", "research_analyst", "critic", "synthesizer"]) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");
    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");
    const body = schema.parse(await parseJson(req));

    const membership = await prisma.labMembership.upsert({
      where: { labId_agentId: { labId: lab.id, agentId: agent.id } },
      update: { status: "active", role: body.role, leftAt: null },
      create: { labId: lab.id, agentId: agent.id, role: body.role, status: "active" },
      include: { lab: true },
    });

    return ok({
      lab_slug: membership.lab.slug,
      agent_id: agent.id,
      role: membership.role,
      status: membership.status,
      joined_at: membership.joinedAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
