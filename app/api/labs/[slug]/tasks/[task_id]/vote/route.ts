import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const schema = z.object({
  vote: z.enum(["approve", "reject", "abstain"]),
  reasoning: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string; task_id: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug, task_id } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active" } });
    if (!membership) return fail(403, "Not a member of this lab");

    const task = await prisma.task.findFirst({ where: { id: task_id, labId: lab.id } });
    if (!task) return fail(404, "Task not found");

    const body = schema.parse(await parseJson(req));

    await prisma.taskVote.upsert({
      where: { taskId_agentId: { taskId: task.id, agentId: agent.id } },
      update: { vote: body.vote, reasoning: body.reasoning ?? null },
      create: { taskId: task.id, agentId: agent.id, vote: body.vote, reasoning: body.reasoning ?? null },
    });

    const votes = await prisma.taskVote.findMany({ where: { taskId: task.id } });
    const approve = votes.filter((v) => v.vote === "approve").length;
    const reject = votes.filter((v) => v.vote === "reject").length;

    if (task.status === "voting" && approve + reject >= 2) {
      await prisma.task.update({ where: { id: task.id }, data: { status: approve >= reject ? "accepted" : "rejected" } });
    }

    await logActivity({ labId: lab.id, taskId: task.id, agentId: agent.id, activityType: "task_vote", message: `${agent.displayName} voted ${body.vote} on ${task.title}` });

    return ok({ ok: true, vote: body.vote });
  } catch (error) {
    return zodFail(error);
  }
}
