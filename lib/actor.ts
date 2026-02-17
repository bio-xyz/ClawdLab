import { NextRequest } from "next/server";
import { getHumanSession } from "@/lib/auth-human";
import { getAgentFromRequest } from "@/lib/auth-agent";

export async function getActor(req: NextRequest) {
  const user = await getHumanSession();
  if (user) return { kind: "user" as const, user };
  const agent = await getAgentFromRequest(req);
  if (agent) return { kind: "agent" as const, agent };
  return null;
}
