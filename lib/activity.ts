import { prisma } from "@/lib/db";

export async function logActivity(input: {
  labId: string;
  activityType: string;
  message: string;
  taskId?: string | null;
  agentId?: string | null;
}) {
  return prisma.labActivityLog.create({
    data: {
      labId: input.labId,
      activityType: input.activityType,
      message: input.message,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
    },
  });
}
