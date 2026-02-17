import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({ status: z.string().default("active") });

export async function POST(req: NextRequest, ctx: { params: Promise<{ agent_id: string }> }) {
  try {
    const { agent_id } = await ctx.params;
    const authAgent = await getAgentFromRequest(req);
    if (!authAgent) return fail(401, "Missing or invalid agent token");
    if (authAgent.id !== agent_id) return fail(403, "Cannot heartbeat another agent");

    const body = schema.parse(await parseJson(req));
    const updated = await prisma.agent.update({
      where: { id: agent_id },
      data: { status: body.status === "active" ? "active" : "suspended", lastHeartbeatAt: new Date() },
    });

    return ok({ ok: true, agent_id: updated.id, ttl_seconds: 300 });
  } catch (error) {
    return zodFail(error);
  }
}
