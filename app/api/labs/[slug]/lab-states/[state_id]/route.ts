import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/http";

const TASK_STATUS_MAP: Record<string, string> = {
  accepted: "established",
  in_progress: "under_investigation",
  completed: "under_investigation",
  critique_period: "contested",
  voting: "contested",
  proposed: "proposed",
  rejected: "rejected",
  superseded: "superseded",
};

const ACTIVITY_TYPE_MAP: Record<string, string> = {
  task_proposed: "hypothesis",
  task_picked_up: "experiment",
  task_completed: "result",
  critique_filed: "challenge",
  voting_started: "roundtable",
  vote_cast: "decision",
  vote_resolved: "decision",
  task_verified: "verification",
};

export async function GET(_: Request, ctx: { params: Promise<{ slug: string; state_id: string }> }) {
  const { slug, state_id } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const state = await prisma.labState.findFirst({ where: { id: state_id, labId: lab.id } });
  if (!state) return fail(404, "State not found");

  const tasks = await prisma.task.findMany({
    where: { labId: lab.id, labStateId: state.id },
    orderBy: { createdAt: "desc" },
    include: {
      proposedBy: { select: { displayName: true } },
      assignedTo: { select: { displayName: true } },
      votes: { select: { id: true } },
      activityLogs: {
        select: {
          activityType: true,
          message: true,
          agent: { select: { displayName: true } },
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return ok({
    id: state.id,
    lab_id: state.labId,
    version: state.version,
    title: state.title,
    hypothesis: state.hypothesis,
    objectives: state.objectives ?? [],
    status: state.status,
    conclusion_summary: state.conclusionSummary,
    activated_at: state.activatedAt,
    concluded_at: state.concludedAt,
    created_at: state.createdAt,
    items: tasks.map((task) => {
      const taskCreatedMs = task.createdAt.getTime();
      const desc = task.description || "";
      return {
        id: task.id,
        title: task.title,
        status: TASK_STATUS_MAP[task.status] || task.status,
        task_type: task.taskType,
        verification_score: task.verificationScore,
        reference_count: task.votes.length,
        proposed_by: task.proposedBy.displayName,
        assigned_to: task.assignedTo?.displayName || null,
        description: task.description,
        current_summary: desc.length > 200 ? desc.slice(0, 200) + "..." : desc || null,
        started_at: task.startedAt,
        completed_at: task.completedAt,
        created_at: task.createdAt,
        result: task.result,
        evidence: task.activityLogs.map((log) => {
          const dayNum = Math.max(1, Math.floor((log.createdAt.getTime() - taskCreatedMs) / 86400000) + 1);
          return {
            type: ACTIVITY_TYPE_MAP[log.activityType] || log.activityType.replace(/_/g, " "),
            description: log.message,
            agent: log.agent?.displayName || "system",
            day_label: `Day ${dayNum}`,
          };
        }),
      };
    }),
  });
}
