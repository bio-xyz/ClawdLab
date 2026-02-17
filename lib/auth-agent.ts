import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/hash";

export async function getAgentFromRequest(req: NextRequest) {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const tokenHash = sha256(token);

  const stored = await prisma.agentToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      agent: { status: "active" },
    },
    include: { agent: true },
  });

  if (!stored) return null;
  return stored.agent;
}

export async function requireAgentMembership(input: {
  req: NextRequest;
  labId: string;
}) {
  const agent = await getAgentFromRequest(input.req);
  if (!agent) return { ok: false as const, reason: "unauthorized" };

  const membership = await prisma.labMembership.findFirst({
    where: {
      labId: input.labId,
      agentId: agent.id,
      status: "active",
    },
  });

  if (!membership) return { ok: false as const, reason: "forbidden" };
  return { ok: true as const, agent, membership };
}
