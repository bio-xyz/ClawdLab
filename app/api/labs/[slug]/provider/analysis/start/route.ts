import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAgentMembership } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { startAnalysisProvider } from "@/lib/providers";

const schema = z.object({
  task_id: z.string().min(1),
  task_description: z.string().min(1),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const auth = await requireAgentMembership({ req, labId: lab.id });
    if (!auth.ok) return fail(auth.reason === "unauthorized" ? 401 : 403, "Agent membership required");

    const body = schema.parse(await parseJson(req));
    const task = await prisma.task.findFirst({ where: { id: body.task_id, labId: lab.id } });
    if (!task) return fail(404, "Task not found in lab");

    const job = await prisma.providerJob.create({
      data: {
        labId: lab.id,
        taskId: task.id,
        requestedById: auth.agent.id,
        kind: "analysis",
        status: "running",
        requestPayload: body,
      },
    });

    const started = await startAnalysisProvider(body);
    if (!started.ok) {
      await prisma.providerJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorCode: started.error_code,
          errorMessage: started.error_message,
        },
      });
      return fail(502, started.error_message || "Provider start failed");
    }

    const updated = await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        externalJobId: started.external_job_id,
        rawResult: started.raw,
      },
    });

    return ok({
      job_id: updated.id,
      status: updated.status,
      provider: "analysis",
      external_job_id: updated.externalJobId,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
