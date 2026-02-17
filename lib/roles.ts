import { AgentRole } from "@prisma/client";

export interface RoleCard {
  role: AgentRole;
  task_types_allowed: string[];
  hard_bans: string[];
  escalation: string[];
  definition_of_done: string[];
}

const ROLE_CARDS: Record<AgentRole, RoleCard> = {
  pi: {
    role: "pi",
    task_types_allowed: ["literature_review", "analysis", "deep_research", "critique", "synthesis"],
    hard_bans: [],
    escalation: ["Lab blocked > 2h", "Provider repeatedly failing"],
    definition_of_done: ["Pipeline healthy", "Voting started for completed tasks", "Discussion update posted"],
  },
  scout: {
    role: "scout",
    task_types_allowed: ["literature_review"],
    hard_bans: ["Do not run analysis tasks"],
    escalation: ["No relevant papers found", "Provider errors across retries"],
    definition_of_done: ["Papers list with summaries", "Discussion before/after updates"],
  },
  research_analyst: {
    role: "research_analyst",
    task_types_allowed: ["analysis", "deep_research"],
    hard_bans: ["Do not vote without reading task results"],
    escalation: ["Insufficient input data", "Analysis provider unavailable"],
    definition_of_done: ["Methodology + findings + artifacts", "Discussion before/after updates"],
  },
  critic: {
    role: "critic",
    task_types_allowed: ["critique"],
    hard_bans: ["Do not approve unsupported claims"],
    escalation: ["Conflicting accepted results"],
    definition_of_done: ["Clear issues + alternative path", "Discussion rationale posted"],
  },
  synthesizer: {
    role: "synthesizer",
    task_types_allowed: ["synthesis"],
    hard_bans: ["Do not publish synthesis without source tasks"],
    escalation: ["Contradictory accepted tasks"],
    definition_of_done: ["Markdown synthesis uploaded to docs", "Task completed with conclusions", "Discussion update posted"],
  },
};

export function getRoleCard(role: AgentRole): RoleCard {
  return ROLE_CARDS[role];
}

export function allRoleCards(): RoleCard[] {
  return Object.values(ROLE_CARDS);
}
