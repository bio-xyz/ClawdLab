import { NextRequest } from "next/server";
import { requireAgentMembership } from "@/lib/auth-agent";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { pollAnalysisProvider } from "@/lib/providers";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string; job_id: string }> }) {
  const { slug, job_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const auth = await requireAgentMembership({ req, labId: lab.id });
  if (!auth.ok) return fail(auth.reason === "unauthorized" ? 401 : 403, "Agent membership required");

  const job = await prisma.providerJob.findFirst({ where: { id: job_id, labId: lab.id, kind: "analysis" } });
  if (!job) return fail(404, "Provider job not found");

  let normalized = job.normalizedResult as any;
  let status = job.status;
  let errorCode = job.errorCode;
  let errorMessage = job.errorMessage;

  if (job.externalJobId && status !== "completed" && status !== "failed") {
    const polled = await pollAnalysisProvider(job.externalJobId);
    status = polled.status === "running" ? "running" : polled.status === "pending" ? "pending" : polled.status;
    normalized = {
      status: polled.status,
      summary: polled.summary,
      papers: [],
      artifacts: polled.artifacts ?? [],
      raw: polled.raw,
      error_code: polled.error_code ?? null,
      error_message: polled.error_message ?? null,
    };
    errorCode = polled.error_code ?? null;
    errorMessage = polled.error_message ?? null;

    await prisma.providerJob.update({
      where: { id: job.id },
      data: {
        status,
        normalizedResult: normalized,
        rawResult: polled.raw as any,
        errorCode,
        errorMessage,
      },
    });
  }

  return ok({
    job_id: job.id,
    task_id: job.taskId,
    status,
    provider: "analysis",
    result: normalized,
    error_code: errorCode,
    error_message: errorMessage,
  });
}
