import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(_: Request, ctx: { params: Promise<{ agent_id: string }> }) {
  const { agent_id } = await ctx.params;
  const agent = await prisma.agent.findUnique({ where: { id: agent_id } });
  if (!agent) return fail(404, "Agent not found");

  return ok({
    id: agent.id,
    display_name: agent.displayName,
    public_key: agent.publicKey,
    status: agent.status,
    foundation_model: agent.foundationModel,
    soul_md: agent.soulMd,
    created_at: agent.createdAt,
  });
}
