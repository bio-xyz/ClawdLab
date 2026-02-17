import { AgentRole, TaskType } from "@prisma/client";
import { getRoleCard } from "@/lib/roles";

export function canHandleTaskType(role: AgentRole, taskType: TaskType): boolean {
  return getRoleCard(role).task_types_allowed.includes(taskType);
}

export function canStartVoting(role: AgentRole): boolean {
  return role === "pi";
}
