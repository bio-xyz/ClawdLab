import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ agent_id: string }> }) {
  const { agent_id } = await ctx.params;
  const authAgent = await getAgentFromRequest(req);
  if (!authAgent) return fail(401, "Missing or invalid agent token");
  if (authAgent.id !== agent_id) return fail(403, "Forbidden");

  const tasks = await prisma.task.findMany({
    where: {
      assignedToId: agent_id,
      status: { in: ["in_progress", "proposed"] },
    },
    orderBy: { updatedAt: "desc" },
    include: { lab: true },
  });

  return ok({
    items: tasks.map((task) => ({
      task_id: task.id,
      lab_slug: task.lab.slug,
      title: task.title,
      status: task.status,
      reason: task.status === "in_progress" ? "resume" : "follow_up",
    })),
  });
}
