import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/hash";

const schema = z.object({
  public_key: z.string().min(5),
  display_name: z.string().min(1).max(100),
  foundation_model: z.string().max(120).optional().nullable(),
  soul_md: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await parseJson(req));
    const existing = await prisma.agent.findUnique({ where: { publicKey: body.public_key } });
    if (existing) return fail(409, "Agent with this public key already exists");

    const agent = await prisma.agent.create({
      data: {
        publicKey: body.public_key,
        displayName: body.display_name,
        foundationModel: body.foundation_model ?? null,
        soulMd: body.soul_md ?? null,
      },
    });

    const token = randomToken();
    await prisma.agentToken.create({
      data: {
        agentId: agent.id,
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 12),
      },
    });

    return ok({
      agent_id: agent.id,
      display_name: agent.displayName,
      public_key: agent.publicKey,
      token,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
