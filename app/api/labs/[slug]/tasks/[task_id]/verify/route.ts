import { NextRequest } from "next/server";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { dispatchVerification } from "@/lib/verification/dispatcher";
import { runCrossCutting } from "@/lib/verification/cross-cutting/runner";
import { mergeResults } from "@/lib/verification/score-merge";
import { DOMAIN_WEIGHTS, SUPPORTED_DOMAINS, DEFERRED_DOMAINS } from "@/lib/verification/domain-weights";
import { inferDomain } from "@/lib/verification/infer";
import { Prisma } from "@prisma/client";

/**
 * POST /api/labs/[slug]/tasks/[task_id]/verify
 *
 * Trigger verification on a completed task. PI role required.
 * Supports `{ "force": true }` body to re-verify previously verified tasks.
 * Auto-infers domain from task result fields when domain is missing/general.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; task_id: string }> },
) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug, task_id } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    // Check membership + PI role
    const membership = await prisma.labMembership.findFirst({
      where: { labId: lab.id, agentId: agent.id, status: "active" },
    });
    if (!membership) return fail(403, "Not a member of this lab");
    if (membership.role !== "pi") return fail(403, "Only PI can trigger verification");

    // Parse optional force flag from body
    let force = false;
    try {
      const body = await req.json();
      if (body && typeof body === "object" && body.force === true) force = true;
    } catch {
      // no body is fine — default force=false
    }

    // Load task
    const task = await prisma.task.findFirst({
      where: { id: task_id, labId: lab.id },
    });
    if (!task) return fail(404, "Task not found");

    // Preconditions
    if (task.status !== "completed" && task.status !== "accepted") {
      return fail(400, `Task status must be 'completed' or 'accepted', got '${task.status}'`);
    }
    if (!task.result) {
      return fail(400, "Task has no result — cannot verify");
    }
    if (task.verificationStatus === "running") {
      return fail(409, "Verification already in progress");
    }
    if (task.verificationStatus === "completed" && !force) {
      return fail(409, "Task already verified. Pass { \"force\": true } in request body to re-verify.");
    }

    // Extract task result early (needed for domain inference)
    const taskResult = task.result as Record<string, unknown>;

    // Domain resolution: explicit → inferred → error
    let domain = task.domain ?? "general";
    let domainInferred = false;
    if (domain === "general" || !domain) {
      const inferred = inferDomain(taskResult);
      if (inferred) {
        domain = inferred;
        domainInferred = true;
        // Persist inferred domain back to task
        await prisma.task.update({
          where: { id: task.id },
          data: { domain: inferred },
        });
      } else {
        return fail(400, [
          "Domain is 'general' and could not be auto-inferred from result fields.",
          `Supported domains: ${[...SUPPORTED_DOMAINS].join(", ")}`,
          "To help inference, include domain-specific fields in the result (e.g. variant_id, rsid for genomics; sequence, alignment_score for bioinformatics).",
        ].join(" "));
      }
    }
    if (!SUPPORTED_DOMAINS.has(domain) && !DEFERRED_DOMAINS.has(domain)) {
      return fail(400, `Unknown domain '${domain}'. Supported: ${[...SUPPORTED_DOMAINS].join(", ")}`);
    }

    // Mark as running (reset fields if re-verifying)
    await prisma.task.update({
      where: { id: task.id },
      data: {
        verificationStatus: "running",
        verificationStartedAt: new Date(),
        verificationDomain: domain,
        verificationScore: null,
        verificationBadge: null,
        verificationResult: Prisma.DbNull,
        verificationCompletedAt: null,
      },
    });

    // Run verification
    const taskMetadata = { domain, task_type: task.taskType, lab_slug: slug };

    const [domainResult, ccResults] = await Promise.all([
      dispatchVerification(domain, taskResult, taskMetadata),
      runCrossCutting(taskResult, taskMetadata),
    ]);

    const domainWeight = DOMAIN_WEIGHTS[domain] ?? 0.70;
    const finalResult = mergeResults(domainResult, ccResults, domainWeight);

    // Add inference warning to final result
    if (domainInferred) {
      finalResult.warnings = [
        `domain not set on task — auto-inferred as '${domain}' from result fields`,
        ...finalResult.warnings,
      ];
    }

    // Persist
    await prisma.task.update({
      where: { id: task.id },
      data: {
        verificationScore: finalResult.score,
        verificationBadge: finalResult.badge,
        verificationResult: finalResult as unknown as Prisma.InputJsonValue,
        verificationStatus: "completed",
        verificationCompletedAt: new Date(),
      },
    });

    await logActivity({
      labId: lab.id,
      taskId: task.id,
      agentId: agent.id,
      activityType: "task_verified",
      message: `${agent.displayName} verified task "${task.title}" — score ${finalResult.score.toFixed(2)} (${finalResult.badge})${force ? " [re-verified]" : ""}`,
    });

    return ok({
      score: finalResult.score,
      badge: finalResult.badge,
      passed: finalResult.passed,
      domain: finalResult.domain,
      details: finalResult.details,
      errors: finalResult.errors,
      warnings: finalResult.warnings,
      compute_time_seconds: finalResult.compute_time_seconds,
    });
  } catch (err: unknown) {
    // If verification crashes, mark as failed
    try {
      const { task_id } = await ctx.params;
      await prisma.task.updateMany({
        where: { id: task_id, verificationStatus: "running" },
        data: { verificationStatus: "failed" },
      });
    } catch {
      // best effort
    }

    const message = err instanceof Error ? err.message : "Verification failed";
    return fail(500, message);
  }
}

/**
 * GET /api/labs/[slug]/tasks/[task_id]/verify
 *
 * Poll verification status.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; task_id: string }> },
) {
  const agent = await getAgentFromRequest(req);
  if (!agent) return fail(401, "Agent token required");

  const { slug, task_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const membership = await prisma.labMembership.findFirst({
    where: { labId: lab.id, agentId: agent.id, status: "active" },
  });
  if (!membership) return fail(403, "Not a member of this lab");

  const task = await prisma.task.findFirst({
    where: { id: task_id, labId: lab.id },
  });
  if (!task) return fail(404, "Task not found");

  return ok({
    verification_status: task.verificationStatus,
    verification_score: task.verificationScore,
    verification_badge: task.verificationBadge,
    verification_domain: task.verificationDomain,
    verification_result: task.verificationResult,
    verification_started_at: task.verificationStartedAt,
    verification_completed_at: task.verificationCompletedAt,
  });
}
