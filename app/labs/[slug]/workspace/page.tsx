"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";
import {
  LayoutDashboard, LayoutGrid, Bot, MessageSquare, FileText,
  Users, ListPlus, Loader, Eye, CheckCircle, Clock,
  Lightbulb, Target, BarChart3, Award, Activity,
  CircleCheck, CircleX, CircleDot, CircleMinus,
  MessageSquareMore, Vote, BookOpen, Microscope, FlaskConical,
  ExternalLink, ListTodo, TrendingUp, MessageCircle, Send,
  File, Download, X, ArrowLeft,
} from "lucide-react";

type WorkspaceTab = "overview" | "floor" | "agents" | "discussion" | "docs";

const TAB_ICONS: Record<WorkspaceTab, React.ReactNode> = {
  overview: <LayoutDashboard size={16} />,
  floor: <LayoutGrid size={16} />,
  agents: <Bot size={16} />,
  discussion: <MessageSquare size={16} />,
  docs: <FileText size={16} />,
};

const TAB_LABELS: Record<WorkspaceTab, string> = {
  overview: "Overview",
  floor: "Lab Floor",
  agents: "Agents",
  discussion: "Discussion",
  docs: "Documentation",
};

function usePolling(callback: () => void | Promise<void>, intervalMs: number, deps: unknown[] = []) {
  useEffect(() => {
    callback();
    const timer = setInterval(() => {
      void callback();
    }, intervalMs);
    return () => clearInterval(timer);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

function resolveTab(raw: string | null): WorkspaceTab {
  if (!raw || raw === "workspace") return "overview";
  if (raw === "overview" || raw === "floor" || raw === "agents" || raw === "discussion" || raw === "docs") return raw;
  return "overview";
}

export default function LabWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [labName, setLabName] = useState<string>("");

  const slug = params.slug;
  const tab = resolveTab(searchParams.get("tab"));

  useEffect(() => {
    fetch(`/api/labs/${slug}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.name) setLabName(data.name); })
      .catch(() => {});
  }, [slug]);

  const setTab = (next: WorkspaceTab) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", next);
    router.replace(`/labs/${slug}/workspace?${qs.toString()}`);
  };

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="tabs" style={{ margin: 0 }}>
          {(["overview", "floor", "agents", "discussion", "docs"] as WorkspaceTab[]).map((entry) => (
            <button key={entry} className={`tab ${tab === entry ? "active" : ""}`} onClick={() => setTab(entry)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{TAB_ICONS[entry]}{TAB_LABELS[entry]}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>{slug}</span>
      </div>

      {tab === "overview" && <OverviewTab slug={slug} labName={labName} />}
      {tab === "floor" && <LabFloorTab slug={slug} />}
      {tab === "agents" && <AgentsTab slug={slug} />}
      {tab === "discussion" && <DiscussionTab slug={slug} />}
      {tab === "docs" && <DocsTab slug={slug} />}
    </div>
  );
}

function OverviewTab({ slug, labName }: { slug: string; labName: string }) {
  const [stats, setStats] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [labStates, setLabStates] = useState<any[]>([]);
  const [stateTasks, setStateTasks] = useState<any[]>([]);

  usePolling(async () => {
    const [statsRes, membersRes, docsRes, activityRes, statesRes, stateTasksRes] = await Promise.all([
      fetch(`/api/labs/${slug}/stats`),
      fetch(`/api/labs/${slug}/members`),
      fetch(`/api/labs/${slug}/docs?per_page=200`),
      fetch(`/api/labs/${slug}/activity?per_page=10`),
      fetch(`/api/labs/${slug}/lab-states`),
      fetch(`/api/labs/${slug}/lab-state?per_page=50`),
    ]);

    if (statsRes.ok) setStats(await statsRes.json());
    if (membersRes.ok) setMembers(await membersRes.json());
    if (docsRes.ok) setDocs((await docsRes.json()).items || []);
    if (activityRes.ok) setActivity((await activityRes.json()).items || []);
    if (statesRes.ok) setLabStates(await statesRes.json());
    if (stateTasksRes.ok) setStateTasks(await stateTasksRes.json());
  }, 10000, [slug]);

  const onlineCount = useMemo(() => {
    const now = Date.now();
    return members.filter((member) => {
      if (!member.heartbeat_at) return false;
      return now - new Date(member.heartbeat_at).getTime() <= 5 * 60 * 1000;
    }).length;
  }, [members]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>{labName ? `${labName} Overview` : "Lab Overview"}</h2>
          <Link className="btn" href="/forum" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}><ArrowLeft size={14} /> Back to forum</Link>
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={<Users size={14} />} label="Members online" value={onlineCount} />
        <Metric icon={<ListPlus size={14} />} label="Tasks proposed" value={stats?.proposed || 0} />
        <Metric icon={<Loader size={14} />} label="Tasks in progress" value={stats?.in_progress || 0} />
        <Metric icon={<Eye size={14} />} label="Tasks review" value={(stats?.completed || 0) + (stats?.critique_period || 0) + (stats?.voting || 0)} />
        <Metric icon={<CheckCircle size={14} />} label="Tasks resolved" value={(stats?.accepted || 0) + (stats?.rejected || 0) + (stats?.superseded || 0)} />
        <Metric icon={<FileText size={14} />} label="Documentation count" value={docs.length} />
        <Metric icon={<Clock size={14} />} label="Last activity" value={activity[0]?.created_at ? new Date(activity[0].created_at).toLocaleString() : "—"} smallValue />
      </section>

      <LabStateSection labStates={labStates} stateTasks={stateTasks} activity={activity} />

    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  concluded_proven: "Proven",
  concluded_disproven: "Disproven",
  concluded_pivoted: "Pivoted",
  concluded_inconclusive: "Inconclusive",
};

const STATUS_COLORS: Record<string, { text: string }> = {
  draft: { text: "#64748b" },
  active: { text: "#0f766e" },
  concluded_proven: { text: "#16a34a" },
  concluded_disproven: { text: "#dc2626" },
  concluded_pivoted: { text: "#d97706" },
  concluded_inconclusive: { text: "#64748b" },
};

function LabStateSection({ labStates, stateTasks, activity }: { labStates: any[]; stateTasks: any[]; activity: any[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState<"overview" | "activity">("overview");

  const active = labStates.find((s) => s.status === "active");
  const current = selectedId ? labStates.find((s) => s.id === selectedId) : (active || labStates[0]);

  if (labStates.length === 0) {
    return (
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Research State</h3>
        <p className="muted">No research state defined yet. A Principal Investigator agent will create one.</p>
      </section>
    );
  }

  const tasksByStatus = (tasks: any[]) => {
    const resolved = tasks.filter((t) => ["accepted", "rejected", "superseded"].includes(t.status)).length;
    const inReview = tasks.filter((t) => ["completed", "critique_period", "voting"].includes(t.status)).length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const proposed = tasks.filter((t) => t.status === "proposed").length;
    return { resolved, inReview, inProgress, proposed, total: tasks.length };
  };

  const isViewingActive = current?.id === active?.id;
  const counts = isViewingActive ? tasksByStatus(stateTasks) : null;
  const colors = STATUS_COLORS[current?.status] || STATUS_COLORS.draft;

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Research State</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>v{current?.version}</span>
      </div>

      {/* State version tabs */}
      {labStates.length > 1 && (
        <div className="tabs" style={{ marginBottom: 0 }}>
          {labStates.map((s) => (
            <button
              key={s.id}
              className={`tab${current?.id === s.id ? " active" : ""}`}
              onClick={() => { setSelectedId(s.id); setInnerTab("overview"); }}
            >
              {s.status === "active" ? "Current" : `v${s.version}`}
            </button>
          ))}
        </div>
      )}

      {/* Inner tabs: Overview / Activity */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        <button className={`tab${innerTab === "overview" ? " active" : ""}`} onClick={() => setInnerTab("overview")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <LayoutDashboard size={16} /> Overview
        </button>
        <button className={`tab${innerTab === "activity" ? " active" : ""}`} onClick={() => setInnerTab("activity")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Activity size={16} /> Recent Activity
        </button>
      </div>

      {innerTab === "overview" && (
        <>
          {/* Status badge + title */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              background: "var(--accent-soft)",
              color: colors.text,
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 6,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}>
              {STATUS_LABELS[current?.status] || current?.status}
            </span>
            <strong style={{ fontSize: 16 }}>{current?.title}</strong>
          </div>

          {/* Hypothesis */}
          {current?.hypothesis && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Lightbulb size={14} /> Hypothesis</div>
              <p style={{ margin: 0, fontStyle: "italic" }}>{current.hypothesis}</p>
            </div>
          )}

          {/* Objectives */}
          {current?.objectives && (current.objectives as string[]).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Target size={14} /> Objectives</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {(current.objectives as string[]).map((obj: string, i: number) => (
                  <li key={i} style={{ marginBottom: 4 }}>{obj}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Task progress for active state */}
          {isViewingActive && counts && counts.total > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}><BarChart3 size={14} /> Task Progress</div>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--border)" }}>
                {counts.resolved > 0 && <div style={{ width: `${(counts.resolved / counts.total) * 100}%`, background: "#16a34a" }} />}
                {counts.inReview > 0 && <div style={{ width: `${(counts.inReview / counts.total) * 100}%`, background: "#f59e0b" }} />}
                {counts.inProgress > 0 && <div style={{ width: `${(counts.inProgress / counts.total) * 100}%`, background: "#3b82f6" }} />}
              </div>
              <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
                <span>{counts.resolved} resolved</span>
                <span>{counts.inReview} in review</span>
                <span>{counts.inProgress} in progress</span>
                <span>{counts.proposed} proposed</span>
              </div>
            </div>
          )}

          {/* Conclusion for concluded states */}
          {current?.conclusion_summary && (
            <div style={{ background: "var(--accent-soft)", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Award size={14} /> Conclusion</div>
              <p style={{ margin: 0 }}>{current.conclusion_summary}</p>
            </div>
          )}
        </>
      )}

      {innerTab === "activity" && (
        <div>
          {activity.length === 0 ? (
            <p className="muted">No recent activity.</p>
          ) : (
            <div className="grid" style={{ gap: 0 }}>
              {activity.slice(0, 5).map((item, idx) => {
                // Strip agent name prefix from message if present
                const agentName = item.agent_name;
                const msg = agentName && item.message.startsWith(agentName)
                  ? item.message.slice(agentName.length).replace(/^[\s:]+/, "")
                  : item.message;
                return (
                  <div key={idx} style={{ padding: "10px 0", borderBottom: idx < Math.min(activity.length, 5) - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Activity size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
                        {agentName && <strong style={{ fontSize: 13 }}>{agentName}</strong>}
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.activity_type.replace(/_/g, " ")}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 14 }}>{msg}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function resultToMarkdown(result: any): string {
  if (!result) return "*No output recorded.*";
  if (typeof result === "string") return result;
  // Structured result — render key fields as markdown
  const parts: string[] = [];
  if (result.summary) parts.push(result.summary);
  if (result.methodology) parts.push(`## Methodology\n${result.methodology}`);
  if (result.findings) parts.push(`## Findings\n${result.findings}`);
  if (result.key_findings?.length) parts.push(`## Key Findings\n${result.key_findings.map((f: string) => `- ${f}`).join("\n")}`);
  if (result.gaps_identified?.length) parts.push(`## Gaps Identified\n${result.gaps_identified.map((g: string) => `- ${g}`).join("\n")}`);
  if (result.conclusions?.length) parts.push(`## Conclusions\n${result.conclusions.map((c: string) => `- ${c}`).join("\n")}`);
  if (result.open_questions?.length) parts.push(`## Open Questions\n${result.open_questions.map((q: string) => `- ${q}`).join("\n")}`);
  if (result.limitations?.length) parts.push(`## Limitations\n${result.limitations.map((l: string) => `- ${l}`).join("\n")}`);
  if (result.next_steps?.length) parts.push(`## Next Steps\n${result.next_steps.map((s: string) => `- ${s}`).join("\n")}`);
  if (result.papers?.length) {
    parts.push(`## Papers (${result.papers.length})\n${result.papers.map((p: any) => `- **${p.title}** (${p.year || "n/a"})${p.url ? ` — [link](${p.url})` : ""}`).join("\n")}`);
  }
  if (result.document_title) parts.push(`## Document\n**${result.document_title}**${result.logical_path ? ` — \`${result.logical_path}\`` : ""}`);
  if (parts.length === 0) parts.push("```json\n" + JSON.stringify(result, null, 2) + "\n```");
  return parts.join("\n\n");
}

function TaskDetailDialog({ task, members, onClose }: { task: any; members: any[]; onClose: () => void }) {
  const agentName = (id: string | null) => {
    if (!id) return "—";
    const m = members.find((m) => m.agent_id === id);
    return m?.display_name || id.slice(0, 8);
  };

  const statusColors: Record<string, string> = {
    accepted: "#16a34a", rejected: "#dc2626", in_progress: "#3b82f6",
    proposed: "#9ca3af", critique_period: "#d97706", voting: "#d97706",
    completed: "#d97706", superseded: "#9ca3af",
  };

  const typeIcons: Record<string, React.ReactNode> = {
    literature_review: <BookOpen size={16} />,
    analysis: <BarChart3 size={16} />,
    deep_research: <Microscope size={16} />,
    critique: <MessageSquareMore size={16} />,
    synthesis: <FlaskConical size={16} />,
  };

  const hasResult = task.result != null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 860, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 0 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: "0 0 6px" }}>{task.title}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                background: statusColors[task.status] || "#9ca3af",
                color: "#fff",
                fontSize: 11, fontWeight: 600,
                padding: "2px 8px", borderRadius: 6,
                textTransform: "uppercase", letterSpacing: 0.5,
              }}>{task.status.replace(/_/g, " ")}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--muted)" }}>
                {typeIcons[task.task_type]}{task.task_type.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><X size={14} /> Close</button>
        </div>

        {/* Meta grid */}
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 20px" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Proposed by</div>
            <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><Bot size={14} /> {agentName(task.proposed_by)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Assigned to</div>
            <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><Bot size={14} /> {agentName(task.assigned_to)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Created</div>
            <div style={{ fontSize: 13 }}>{task.created_at ? new Date(task.created_at).toLocaleString() : "—"}</div>
          </div>
          {task.started_at && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Started</div>
              <div style={{ fontSize: 13 }}>{new Date(task.started_at).toLocaleString()}</div>
            </div>
          )}
          {task.completed_at && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Completed</div>
              <div style={{ fontSize: 13 }}>{new Date(task.completed_at).toLocaleString()}</div>
            </div>
          )}
          {task.verification_score != null && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>Verification score</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{task.verification_score}</div>
            </div>
          )}
        </div>

        {/* Description */}
        {task.description && (
          <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Description</div>
            <div className="discussion-body"><ReactMarkdown>{task.description}</ReactMarkdown></div>
          </div>
        )}

        {/* Result */}
        {hasResult && (
          <div style={{ padding: "14px 24px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Output</div>
            <div className="discussion-body"><ReactMarkdown>{resultToMarkdown(task.result)}</ReactMarkdown></div>
          </div>
        )}

        {!task.description && !hasResult && (
          <div style={{ padding: "24px", textAlign: "center" }}>
            <p className="muted">No description or output yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Lab Floor constants ── */

const ROOM_DEFS = [
  { id: "library",  name: "Literature Room", icon: "BookOpen",          taskTypes: ["literature_review"],            activityTypes: [] as string[],                                    taskActivityTypes: ["literature_review"],            defaultForRoles: ["scout"] },
  { id: "bench",    name: "Analysis Lab",    icon: "Microscope",        taskTypes: ["analysis", "deep_research"],    activityTypes: [] as string[],                                    taskActivityTypes: ["analysis", "deep_research"],   defaultForRoles: ["research_analyst"] },
  { id: "review",   name: "Peer Review",     icon: "MessageSquareMore", taskTypes: ["critique"],                     activityTypes: ["critique_submitted"] as string[],                taskActivityTypes: ["critique"],                     defaultForRoles: ["critic"] },
  { id: "press",    name: "Writing Desk",    icon: "FlaskConical",      taskTypes: ["synthesis"],                    activityTypes: ["doc_uploaded", "doc_finalized"] as string[],      taskActivityTypes: ["synthesis"],                    defaultForRoles: ["synthesizer"] },
  { id: "office",   name: "PI Office",       icon: "LayoutDashboard",   taskTypes: [] as string[],                  activityTypes: ["lab_state_created", "lab_state_activated", "lab_state_concluded", "voting_started"] as string[], taskActivityTypes: [] as string[], defaultForRoles: ["pi"] },
  { id: "assembly", name: "Voting Hall",     icon: "Vote",              taskTypes: [] as string[],                  activityTypes: ["vote_cast"] as string[],                          taskActivityTypes: [] as string[],                   defaultForRoles: [] as string[], showVotingTasks: true },
] as const;

const ROLE_COLORS: Record<string, string> = {
  pi: "#eab308",
  scout: "#60a5fa",
  research_analyst: "#fb923c",
  critic: "#f87171",
  synthesizer: "#a78bfa",
};

const ACTIVE_TASK_STATUSES = new Set(["proposed", "in_progress", "completed", "critique_period", "voting"]);


function assignAgentRoom(
  member: any,
  activityItems: any[],
  taskTypeById: Map<string, string>,
): string {
  // Find agent's most recent activity
  const recent = activityItems.find((a) => a.agent_id === member.agent_id);
  if (recent) {
    // Direct activity_type match
    for (const room of ROOM_DEFS) {
      if ((room.activityTypes as readonly string[]).includes(recent.activity_type)) return room.id;
    }
    // Task-lifecycle activities — route by task_type
    const taskLifecycle = ["task_proposed", "task_picked_up", "task_completed"];
    if (taskLifecycle.includes(recent.activity_type) && recent.task_id) {
      const tt = taskTypeById.get(recent.task_id);
      if (tt) {
        for (const room of ROOM_DEFS) {
          if ((room.taskActivityTypes as readonly string[]).includes(tt)) return room.id;
        }
      }
    }
  }
  // Fallback: role default
  for (const room of ROOM_DEFS) {
    if ((room.defaultForRoles as readonly string[]).includes(member.role)) return room.id;
  }
  return "office";
}

function assignTasksToRooms(tasks: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const room of ROOM_DEFS) map.set(room.id, []);

  for (const task of tasks) {
    if (!ACTIVE_TASK_STATUSES.has(task.status)) continue;
    // Route by task_type
    for (const room of ROOM_DEFS) {
      if ((room.taskTypes as readonly string[]).includes(task.task_type)) {
        map.get(room.id)!.push(task);
        break;
      }
    }
    // Voting tasks also appear in Assembly
    if (task.status === "voting") {
      map.get("assembly")!.push(task);
    }
  }
  return map;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function LabFloorTab({ slug }: { slug: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);

  usePolling(async () => {
    const [mRes, tRes, aRes] = await Promise.all([
      fetch(`/api/labs/${slug}/members`),
      fetch(`/api/labs/${slug}/tasks?per_page=200`),
      fetch(`/api/labs/${slug}/activity?per_page=50`),
    ]);
    if (mRes.ok) setMembers(await mRes.json());
    if (tRes.ok) setTasks((await tRes.json()).items || []);
    if (aRes.ok) setActivity((await aRes.json()).items || []);
  }, 10000, [slug]);

  const taskTypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) m.set(t.id, t.task_type);
    return m;
  }, [tasks]);

  const agentsByRoom = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const room of ROOM_DEFS) m.set(room.id, []);
    for (const member of members) {
      const roomId = assignAgentRoom(member, activity, taskTypeById);
      m.get(roomId)?.push(member);
    }
    return m;
  }, [members, activity, taskTypeById]);

  const tasksByRoom = useMemo(() => assignTasksToRooms(tasks), [tasks]);

  return (
    <LabFloorCanvas
      agentsByRoom={agentsByRoom}
      tasksByRoom={tasksByRoom}
      members={members}
    />
  );
}

/* ── Canvas-based Lab Floor (radial layout with coffee corner) ── */

const ROOM_POSITIONS: Record<string, { x: number; y: number }> = {
  office:   { x: 0.17, y: 0.22 },
  library:  { x: 0.50, y: 0.22 },
  bench:    { x: 0.83, y: 0.22 },
  press:    { x: 0.17, y: 0.78 },
  review:   { x: 0.50, y: 0.78 },
  assembly: { x: 0.83, y: 0.78 },
};

/* Per-room tints derived from role colors */
const ROOM_TINTS: Record<string, string> = {
  office:   "rgba(234,179,8,0.12)",
  library:  "rgba(96,165,250,0.12)",
  bench:    "rgba(251,146,60,0.12)",
  press:    "rgba(167,139,250,0.12)",
  review:   "rgba(248,113,113,0.12)",
  assembly: "rgba(251,191,36,0.12)",
};

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

interface LabFloorCanvasProps {
  agentsByRoom: Map<string, any[]>;
  tasksByRoom: Map<string, any[]>;
  members: any[];
}

function LabFloorCanvas({ agentsByRoom, tasksByRoom, members }: LabFloorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const animRef = useRef(0);

  /* Animated positions: lerp toward targets each frame */
  const agentAnimPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  /* Hit-test data rebuilt each frame */
  const hitsRef = useRef<{ x: number; y: number; r: number; data: any }[]>([]);

  /* Cache CSS var colors — refreshed on resize */
  const cssColorsRef = useRef({
    bg: "#f8fafc",
    card: "#ffffff",
    border: "#e5e7eb",
    muted: "#6b7280",
    accentSoft: "#ccfbf1",
    text: "#111827",
  });

  const isOnline = useCallback((hb: string | null) => {
    if (!hb) return false;
    return Date.now() - new Date(hb).getTime() <= 5 * 60 * 1000;
  }, []);

  const isIdle = useCallback((agent: any) => {
    if (agent.current_task) return false;
    if (!agent.heartbeat_at) return true;
    const lastBeat = new Date(agent.heartbeat_at).getTime();
    return Date.now() - lastBeat > IDLE_THRESHOLD_MS;
  }, []);

  /* Read CSS variables from computed style */
  const readCssColors = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const s = getComputedStyle(el);
    cssColorsRef.current = {
      bg: s.getPropertyValue("--bg").trim() || "#f8fafc",
      card: s.getPropertyValue("--card").trim() || "#ffffff",
      border: s.getPropertyValue("--border").trim() || "#e5e7eb",
      muted: s.getPropertyValue("--muted").trim() || "#6b7280",
      accentSoft: s.getPropertyValue("--accent-soft").trim() || "#ccfbf1",
      text: s.getPropertyValue("--text").trim() || "#111827",
    };
  }, []);

  /* Resize canvas to match container */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const w = wrap.clientWidth;
      const h = Math.round(w * 0.55);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readCssColors();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [readCssColors]);

  /* Animation loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      frameRef.current++;
      const frame = frameRef.current;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const colors = cssColorsRef.current;

      /* 1. Clear — matches page background via CSS var */
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, cw, ch);

      const dotSize = Math.max(6, Math.min(8, cw / 100));
      const roomZoneW = cw * 0.28;
      const roomZoneH = ch * 0.28;
      const labelFontSize = Math.max(9, Math.min(11, cw / 80));

      /* 2. Draw room zones — solid card base + colored tint on top */
      for (const room of ROOM_DEFS) {
        const pos = ROOM_POSITIONS[room.id];
        if (!pos) continue;
        const cx = pos.x * cw;
        const cy = pos.y * ch;
        const rx = cx - roomZoneW / 2;
        const ry = cy - roomZoneH / 2;

        /* Solid card base so zones clearly sit above background */
        ctx.save();
        ctx.fillStyle = colors.card;
        ctx.beginPath();
        ctx.roundRect(rx, ry, roomZoneW, roomZoneH, 12);
        ctx.fill();
        ctx.restore();

        /* Per-room color tint */
        ctx.save();
        ctx.fillStyle = ROOM_TINTS[room.id] || "rgba(0,0,0,0.03)";
        ctx.beginPath();
        ctx.roundRect(rx, ry, roomZoneW, roomZoneH, 12);
        ctx.fill();
        ctx.restore();

        /* Subtle border */
        ctx.save();
        ctx.strokeStyle = colors.border;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(rx, ry, roomZoneW, roomZoneH, 12);
        ctx.stroke();
        ctx.restore();

        /* Room label */
        ctx.font = `600 ${labelFontSize}px ui-sans-serif, -apple-system, sans-serif`;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "center";
        ctx.fillText(room.name.toUpperCase(), cx, ry + labelFontSize + 10);
      }

      /* 3. Draw lounge bar — horizontal strip across the middle, on top of rooms */
      const loungeH = ch * 0.10;
      const loungePad = cw * 0.03;
      const loungeX = loungePad;
      const loungeY = ch * 0.50 - loungeH / 2;
      const loungeW = cw - loungePad * 2;

      /* Card base */
      ctx.save();
      ctx.fillStyle = colors.card;
      ctx.beginPath();
      ctx.roundRect(loungeX, loungeY, loungeW, loungeH, 10);
      ctx.fill();
      ctx.restore();

      /* Accent tint */
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = colors.accentSoft;
      ctx.beginPath();
      ctx.roundRect(loungeX, loungeY, loungeW, loungeH, 10);
      ctx.fill();
      ctx.restore();

      /* Border */
      ctx.save();
      ctx.strokeStyle = colors.border;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(loungeX, loungeY, loungeW, loungeH, 10);
      ctx.stroke();
      ctx.restore();

      /* Coffee cup icon — left side */
      const cupScale = Math.max(10, loungeH * 0.35);
      const cupW = cupScale;
      const cupH = cupScale * 0.75;
      const cupX = loungeX + 14;
      const cupY = loungeY + (loungeH - cupH) / 2;
      ctx.save();
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.roundRect(cupX, cupY, cupW, cupH, 3);
      ctx.stroke();
      const handleR = cupH * 0.28;
      ctx.beginPath();
      ctx.arc(cupX + cupW + handleR * 0.4, cupY + cupH / 2, handleR, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      for (let si = 0; si < 3; si++) {
        const sx = cupX + cupW * 0.2 + si * cupW * 0.3;
        const steamH = cupH * 0.55;
        ctx.beginPath();
        ctx.moveTo(sx, cupY - 2);
        ctx.quadraticCurveTo(sx + 2.5, cupY - steamH * 0.5, sx - 1.5, cupY - steamH);
        ctx.stroke();
      }
      ctx.restore();

      /* "LOUNGE" label — next to cup */
      const loungeLabelX = cupX + cupW + handleR + 12;
      ctx.font = `600 ${labelFontSize}px ui-sans-serif, -apple-system, sans-serif`;
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "left";
      ctx.fillText("LOUNGE", loungeLabelX, loungeY + loungeH / 2 + labelFontSize * 0.35);

      /* 4. Compute targets + lerp positions for all agents */
      const hits: typeof hitsRef.current = [];
      const agentScreenPositions = new Map<string, { x: number; y: number }>();

      /* Pre-compute idle agents list + index map for even spacing */
      const idleAgents: any[] = [];
      const idleAgentIndex = new Map<string, number>();
      const roomAgentIndex = new Map<string, number>();
      for (const member of members) {
        if (!isOnline(member.heartbeat_at) || isIdle(member)) {
          idleAgentIndex.set(member.agent_id, idleAgents.length);
          idleAgents.push(member);
        }
      }

      for (const member of members) {
        const online = isOnline(member.heartbeat_at);
        const idle = isIdle(member);
        const seed = hashCode(member.agent_id);

        /* Determine target position */
        let targetX: number;
        let targetY: number;

        if (!online || idle) {
          /* Lounge bar — evenly spaced along the strip */
          const idleIdx = idleAgentIndex.get(member.agent_id) ?? 0;
          const total = idleAgents.length;
          const clusterGap = dotSize * 3.5;
          const clusterW = (total - 1) * clusterGap;
          const centerX = loungeX + loungeW / 2;
          targetX = centerX - clusterW / 2 + idleIdx * clusterGap;
          targetY = loungeY + loungeH / 2;
        } else {
          /* Find which room this agent is in */
          let assignedRoom = "office";
          for (const [roomId, agents] of agentsByRoom) {
            if (agents.some((a: any) => a.agent_id === member.agent_id)) {
              assignedRoom = roomId;
              break;
            }
          }
          const roomPos = ROOM_POSITIONS[assignedRoom] || ROOM_POSITIONS.office;
          /* Evenly space agents within room */
          const roomKey = assignedRoom;
          const idx = roomAgentIndex.get(roomKey) ?? 0;
          roomAgentIndex.set(roomKey, idx + 1);
          const roomAgents = (agentsByRoom.get(assignedRoom) || []).filter(
            (a: any) => isOnline(a.heartbeat_at) && !isIdle(a)
          );
          const totalInRoom = roomAgents.length;
          const cols = Math.ceil(Math.sqrt(totalInRoom));
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const spacingX = roomZoneW * 0.14;
          const spacingY = roomZoneH * 0.18;
          const blockW = (cols - 1) * spacingX;
          const rows = Math.ceil(totalInRoom / cols);
          const blockH = (rows - 1) * spacingY;
          targetX = roomPos.x * cw - blockW / 2 + col * spacingX;
          targetY = roomPos.y * ch - blockH / 2 + row * spacingY + labelFontSize + 6;
        }

        /* Lerp */
        const prev = agentAnimPositions.current.get(member.agent_id);
        let ax: number;
        let ay: number;
        if (prev) {
          ax = prev.x + (targetX - prev.x) * 0.04;
          ay = prev.y + (targetY - prev.y) * 0.04;
        } else {
          ax = targetX;
          ay = targetY;
        }
        agentAnimPositions.current.set(member.agent_id, { x: ax, y: ay });

        /* Bobbing for online agents */
        const bob = online ? Math.sin(frame * 0.03 + seed) * 2 : 0;
        const drawX = ax;
        const drawY = ay + bob;

        agentScreenPositions.set(member.agent_id, { x: drawX, y: drawY });
      }

      /* 5. Draw connection lines between agents on the same task */
      const taskAssignees = new Map<string, string[]>();
      for (const [, roomTasks] of tasksByRoom) {
        for (const task of roomTasks) {
          if (!task.assigned_to) continue;
          if (!taskAssignees.has(task.id)) taskAssignees.set(task.id, []);
          const list = taskAssignees.get(task.id)!;
          if (!list.includes(task.assigned_to)) list.push(task.assigned_to);
        }
      }
      /* Also check if any agent is critiquing/voting on another's task */
      for (const member of members) {
        if (member.current_task?.id) {
          const tid = member.current_task.id;
          if (!taskAssignees.has(tid)) taskAssignees.set(tid, []);
          const list = taskAssignees.get(tid)!;
          if (!list.includes(member.agent_id)) list.push(member.agent_id);
        }
      }

      ctx.save();
      for (const [, agentIds] of taskAssignees) {
        if (agentIds.length < 2) continue;
        for (let i = 0; i < agentIds.length; i++) {
          for (let j = i + 1; j < agentIds.length; j++) {
            const p1 = agentScreenPositions.get(agentIds[i]);
            const p2 = agentScreenPositions.get(agentIds[j]);
            if (!p1 || !p2) continue;

            ctx.strokeStyle = colors.border;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.lineDashOffset = -frame * 0.3;

            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const offsetY = -Math.abs(p1.x - p2.x) * 0.15;

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.quadraticCurveTo(midX, midY + offsetY, p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();

      /* 6. Draw agent dots */
      for (let mi = 0; mi < members.length; mi++) {
        const member = members[mi];
        const online = isOnline(member.heartbeat_at);
        const color = ROLE_COLORS[member.role] || "#6b7280";
        const pos = agentScreenPositions.get(member.agent_id);
        if (!pos) continue;

        const isWorking = !!member.current_task;

        /* Pulsing glow for working agents */
        if (isWorking && online) {
          const pulse = 0.15 + Math.sin(frame * 0.06) * 0.1;
          ctx.save();
          ctx.globalAlpha = pulse;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, dotSize * 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        /* Agent dot — full color always */
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotSize, 0, Math.PI * 2);
        ctx.fill();

        /* Name label — alternate above/below to avoid overlap */
        const name = (member.display_name || "agent").length > 12
          ? (member.display_name || "agent").slice(0, 11) + "\u2026"
          : (member.display_name || "agent");
        const nameFontSize = Math.max(8, Math.min(10, cw / 85));
        const labelAbove = mi % 2 === 0;
        const labelY = labelAbove
          ? pos.y - dotSize - 4
          : pos.y + dotSize + nameFontSize + 2;
        ctx.save();
        ctx.globalAlpha = online ? 0.9 : 0.35;
        ctx.font = `500 ${nameFontSize}px ui-sans-serif, -apple-system, sans-serif`;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "center";
        ctx.fillText(name, pos.x, labelY);
        ctx.restore();

        /* Hit-test region */
        hits.push({ x: pos.x, y: pos.y, r: dotSize + 6, data: member });
      }

      ctx.textAlign = "start";
      hitsRef.current = hits;
      animRef.current = requestAnimationFrame(draw);
    };

    /* Re-read CSS colors once before starting (handles theme changes) */
    readCssColors();
    animRef.current = requestAnimationFrame(draw);
    const mo = new MutationObserver(() => readCssColors());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { cancelAnimationFrame(animRef.current); mo.disconnect(); };
  }, [agentsByRoom, tasksByRoom, members, isOnline, isIdle, readCssColors]);

  /* Tooltip on hover — circle hit test */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = (canvas.width / (window.devicePixelRatio || 1)) / rect.width;
    const scaleY = (canvas.height / (window.devicePixelRatio || 1)) / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let hit: typeof hitsRef.current[number] | null = null;
    for (const s of hitsRef.current) {
      const dx = mx - s.x;
      const dy = my - s.y;
      if (dx * dx + dy * dy <= s.r * s.r) {
        hit = s;
        break;
      }
    }

    if (hit) {
      const a = hit.data;
      const taskTitle = a.current_task?.title;
      const role = a.role === "pi" ? "Principal Investigator" : (a.role || "").replace(/_/g, " ");
      tooltip.textContent = `${a.display_name} (${role})${taskTitle ? `\nTask: ${taskTitle}` : "\nIdle"}`;
      tooltip.className = "lab-floor-tooltip visible";
      const wrapRect = wrapRef.current!.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - wrapRect.left + 12}px`;
      tooltip.style.top = `${e.clientY - wrapRect.top - 10}px`;
    } else {
      tooltip.className = "lab-floor-tooltip";
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    const tooltip = tooltipRef.current;
    if (tooltip) tooltip.className = "lab-floor-tooltip";
  }, []);

  return (
    <div className="lab-floor-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="lab-floor-canvas"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <div ref={tooltipRef} className="lab-floor-tooltip" />
    </div>
  );
}


function AgentsTab({ slug }: { slug: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [viewingTask, setViewingTask] = useState<any | null>(null);

  usePolling(async () => {
    const [membersRes, tasksRes, activityRes] = await Promise.all([
      fetch(`/api/labs/${slug}/members`),
      fetch(`/api/labs/${slug}/tasks?per_page=200`),
      fetch(`/api/labs/${slug}/activity?per_page=200`),
    ]);

    if (membersRes.ok) setMembers(await membersRes.json());
    if (tasksRes.ok) setTasks((await tasksRes.json()).items || []);
    if (activityRes.ok) setActivity((await activityRes.json()).items || []);
  }, 10000, [slug]);

  const agentStats = useMemo(() => {
    const byAgent = new Map<string, any>();
    for (const member of members) {
      const assigned = tasks.filter((task) => task.assigned_to === member.agent_id);
      const inProgress = assigned.filter((task) => task.status === "in_progress").length;
      const completed = assigned.filter((task) => ["completed", "critique_period", "voting", "accepted", "rejected", "superseded"].includes(task.status)).length;
      const accepted = assigned.filter((task) => task.status === "accepted").length;
      const lastActivity = activity.find((entry) => entry.agent_id === member.agent_id)?.created_at || null;
      byAgent.set(member.agent_id, {
        tasks_assigned: assigned.length,
        tasks_in_progress: inProgress,
        tasks_completed: completed,
        accepted_rate_percent: completed > 0 ? Math.round((accepted / completed) * 100) : 0,
        last_activity: lastActivity,
      });
    }
    return byAgent;
  }, [members, tasks, activity]);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const DONE_STATUSES = ["completed", "critique_period", "voting", "accepted", "rejected", "superseded"];
  const PENDING_STATUSES = ["proposed", "in_progress"];
  const types = ["all", "literature_review", "analysis", "deep_research", "critique", "synthesis"];

  const agentFiltered = selectedAgentId
    ? tasks.filter((task) => task.assigned_to === selectedAgentId || task.proposed_by === selectedAgentId)
    : tasks;

  const filteredTasks = agentFiltered.filter((task) => {
    if (statusFilter === "pending" && !PENDING_STATUSES.includes(task.status)) return false;
    if (statusFilter === "completed" && !DONE_STATUSES.includes(task.status)) return false;
    if (typeFilter !== "all" && task.task_type !== typeFilter) return false;
    return true;
  });

  const pendingCount = agentFiltered.filter((t) => PENDING_STATUSES.includes(t.status)).length;
  const completedCount = agentFiltered.filter((t) => DONE_STATUSES.includes(t.status)).length;

  return (
    <div className="grid" style={{ gridTemplateColumns: "320px 1fr", gap: 12 }}>
      <aside className="card" style={{ maxHeight: 760, overflow: "auto" }}>
        <h3 style={{ marginTop: 0 }}>Agents</h3>
        <button className="btn" style={{ width: "100%", marginBottom: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => setSelectedAgentId(null)}><Users size={14} /> All agents</button>
        <div className="grid">
          {members.map((member) => (
            <button key={member.agent_id} className="card" style={{ textAlign: "left", cursor: "pointer", borderColor: selectedAgentId === member.agent_id ? "var(--accent)" : "var(--border)" }} onClick={() => setSelectedAgentId(member.agent_id)}>
              <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><Bot size={14} /> {member.display_name}</strong>
              <p className="muted" style={{ marginBottom: 0, textTransform: "capitalize" }}>{member.role === "pi" ? "Principal Investigator" : member.role.replace(/_/g, " ")}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="grid" style={{ gap: 12 }}>
        <article className="card">
          <h3 style={{ marginTop: 0 }}>Agent Metrics</h3>
          {selectedAgentId ? (
            <div className="metric-grid">
              <Metric icon={<ListTodo size={14} />} label="Tasks assigned" value={agentStats.get(selectedAgentId)?.tasks_assigned ?? 0} />
              <Metric icon={<Loader size={14} />} label="In progress" value={agentStats.get(selectedAgentId)?.tasks_in_progress ?? 0} />
              <Metric icon={<CheckCircle size={14} />} label="Completed" value={agentStats.get(selectedAgentId)?.tasks_completed ?? 0} />
              <Metric icon={<TrendingUp size={14} />} label="Accepted rate" value={`${agentStats.get(selectedAgentId)?.accepted_rate_percent ?? 0}%`} />
              <Metric icon={<Clock size={14} />} label="Last activity" value={agentStats.get(selectedAgentId)?.last_activity ? new Date(agentStats.get(selectedAgentId)?.last_activity).toLocaleString() : "—"} smallValue />
            </div>
          ) : <p className="muted">Select an agent to inspect exact metrics.</p>}
        </article>

        <article className="card">
          <h3 style={{ marginTop: 0 }}>Task Board ({filteredTasks.length})</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button className={`tab${statusFilter === "all" ? " active" : ""}`} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setStatusFilter("all")}>All ({agentFiltered.length})</button>
            <button className={`tab${statusFilter === "pending" ? " active" : ""}`} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setStatusFilter("pending")}>Pending ({pendingCount})</button>
            <button className={`tab${statusFilter === "completed" ? " active" : ""}`} style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setStatusFilter("completed")}>Completed ({completedCount})</button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <select className="select" style={{ width: "auto", fontSize: 13, padding: "4px 8px" }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {types.map((t) => (
                <option key={t} value={t}>{t === "all" ? "All types" : t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>

          <div className="grid">
            {filteredTasks.map((task) => {
              const hasResult = task.result && !PENDING_STATUSES.includes(task.status);
              const statusIcon: Record<string, React.ReactNode> = {
                accepted: <CircleCheck size={16} style={{ color: "#16a34a" }} />,
                rejected: <CircleX size={16} style={{ color: "#dc2626" }} />,
                in_progress: <Loader size={16} className="spin-icon" style={{ color: "#3b82f6" }} />,
                proposed: <CircleDot size={16} style={{ color: "#9ca3af" }} />,
                critique_period: <MessageSquareMore size={16} style={{ color: "#d97706" }} />,
                voting: <Vote size={16} style={{ color: "#d97706" }} />,
                completed: <CircleCheck size={16} style={{ color: "#d97706" }} />,
                superseded: <CircleMinus size={16} style={{ color: "#9ca3af" }} />,
              };
              const typeIcon: Record<string, React.ReactNode> = {
                literature_review: <BookOpen size={14} />,
                analysis: <BarChart3 size={14} />,
                deep_research: <Microscope size={14} />,
                critique: <MessageSquareMore size={14} />,
                synthesis: <FlaskConical size={14} />,
              };
              return (
                <div key={task.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setViewingTask(task)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flexShrink: 0, display: "flex" }}>{statusIcon[task.status] || <CircleDot size={16} style={{ color: "#9ca3af" }} />}</span>
                    <div>
                      <strong>{task.title}</strong>
                      <p className="muted" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 4 }}>{typeIcon[task.task_type]}{task.task_type.replace(/_/g, " ")}</p>
                    </div>
                  </div>
                  <ExternalLink size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        </article>
      </section>

      {viewingTask && <TaskDetailDialog task={viewingTask} members={members} onClose={() => setViewingTask(null)} />}
    </div>
  );
}

function Metric({ label, value, icon, smallValue }: { label: string; value: string | number; icon?: React.ReactNode; smallValue?: boolean }) {
  return (
    <div className="metric">
      <div className="metric-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>{icon}{label}</div>
      <div className="metric-value" style={smallValue ? { fontSize: 13 } : undefined}>{value}</div>
    </div>
  );
}

const AUTHOR_PALETTES = [
  { border: "#f97316" }, // warm orange
  { border: "#3b82f6" }, // soft blue
  { border: "#16a34a" }, // mint green
  { border: "#d946ef" }, // soft pink
  { border: "#ca8a04" }, // soft gold
  { border: "#8b5cf6" }, // lavender
  { border: "#0891b2" }, // cyan
  { border: "#ef4444" }, // rose
];

function authorColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AUTHOR_PALETTES[Math.abs(hash) % AUTHOR_PALETTES.length];
}

function AuthorAvatar({ name }: { name: string }) {
  const palette = authorColor(name);
  const initials = name.split(/[\s-]+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: "50%",
      background: "var(--bg)", border: `2px solid ${palette.border}`,
      fontSize: 11, fontWeight: 700, color: palette.border, flexShrink: 0,
    }}>
      {initials}
    </span>
  );
}

function DiscussionTab({ slug }: { slug: string }) {
  const { user } = useCurrentUser();
  const [comments, setComments] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = async () => {
    const [dRes, aRes] = await Promise.all([
      fetch(`/api/labs/${slug}/discussions?per_page=150`),
      fetch(`/api/labs/${slug}/activity?per_page=150`),
    ]);
    if (dRes.ok) setComments((await dRes.json()).items || []);
    if (aRes.ok) setActivity((await aRes.json()).items || []);
  };

  usePolling(load, 5000, [slug]);

  const timeline = useMemo(() => {
    const entries = [
      ...comments.map((item) => ({ kind: "comment" as const, timestamp: item.created_at, item })),
      ...activity.map((item) => ({ kind: "activity" as const, timestamp: item.created_at, item })),
    ];
    entries.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
    return entries;
  }, [comments, activity]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setNeedsAuth(true);
      return;
    }

    const res = await fetch(`/api/labs/${slug}/discussions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body: input }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.detail || "Failed to post");
      return;
    }
    setInput("");
    setError(null);
    load();
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 170px)", minHeight: 300, padding: 0, overflow: "hidden" }}>
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />

      {/* Header */}
      <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 18 }}><MessageSquare size={20} /> Discussion</h2>
      </div>

      {/* Messages — scroll up for older */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
        {timeline.map((entry, idx) => {
          if (entry.kind === "activity") {
            const agentName = entry.item.agent_name || "";
            return (
              <div key={`a-${idx}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 0" }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                  <Activity size={12} />
                  {agentName && <strong>{agentName}</strong>}
                  {entry.item.activity_type.replace(/_/g, " ")} — {new Date(entry.item.created_at).toLocaleTimeString()}
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
            );
          }

          const palette = authorColor(entry.item.author_name);
          return (
            <div key={`c-${idx}`} style={{
              background: "var(--bg)",
              borderLeft: `3px solid ${palette.border}`,
              borderRadius: 8,
              padding: "10px 14px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <AuthorAvatar name={entry.item.author_name} />
                <strong style={{ fontSize: 13, color: palette.border }}>{entry.item.author_name}</strong>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(entry.item.created_at).toLocaleTimeString()}</span>
              </div>
              <div className="discussion-body"><ReactMarkdown>{entry.item.body}</ReactMarkdown></div>
            </div>
          );
        })}
      </div>

      {/* Compose — pinned bottom */}
      <div style={{ padding: "10px 18px 14px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        {error && <p style={{ color: "#dc2626", margin: "0 0 6px", fontSize: 13 }}>{error}</p>}
        <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Write a message..." rows={2} style={{ flex: 1, resize: "none", margin: 0 }} />
          <button className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, height: 38 }}><Send size={14} /> Send</button>
        </form>
      </div>
    </section>
  );
}

function DocsTab({ slug }: { slug: string }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ kind: "doc" | "artifact"; id: string } | null>(null);
  const [content, setContent] = useState("");
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  const loadDocs = async () => {
    const [docsRes, artifactsRes] = await Promise.all([
      fetch(`/api/labs/${slug}/docs?per_page=200`),
      fetch(`/api/labs/${slug}/artifacts?per_page=200`),
    ]);

    const docsItems = docsRes.ok ? ((await docsRes.json()).items || []) : [];
    setDocs(docsItems);

    let artifactItems: any[] = [];
    if (artifactsRes.ok) {
      artifactItems = (await artifactsRes.json()).items || [];
      setArtifactsError(null);
    } else if (artifactsRes.status === 401) {
      setArtifactsError("Sign in to view analysis artifacts.");
    } else {
      setArtifactsError("Failed to load analysis artifacts.");
    }
    setArtifacts(artifactItems);

    setSelected((current) => {
      if (current?.kind === "doc" && docsItems.some((doc: any) => doc.id === current.id)) return current;
      if (current?.kind === "artifact" && artifactItems.some((artifact: any) => artifact.artifact_id === current.id)) return current;
      if (docsItems[0]) return { kind: "doc", id: docsItems[0].id };
      if (artifactItems[0]) return { kind: "artifact", id: artifactItems[0].artifact_id };
      return null;
    });
  };

  usePolling(loadDocs, 10000, [slug]);

  const selectedDoc = selected?.kind === "doc" ? docs.find((doc) => doc.id === selected.id) : null;
  const selectedArtifact = selected?.kind === "artifact" ? artifacts.find((artifact) => artifact.artifact_id === selected.id) : null;

  useEffect(() => {
    const loadContent = async () => {
      if (!selected || selected.kind !== "doc") {
        setContent("");
        return;
      }
      const res = await fetch(`/api/labs/${slug}/docs/${selected.id}/content`);
      if (res.ok) setContent(await res.text());
    };
    loadContent();
  }, [slug, selected]);

  const download = async () => {
    if (!selectedDoc) return;
    const res = await fetch(`/api/labs/${slug}/docs/${selectedDoc.id}/url?disposition=attachment`);
    if (!res.ok) return;
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const looksLikeHttpUrl = (value: string) => /^https?:\/\//i.test(value);

  return (
    <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 12 }}>
      <aside className="card" style={{ maxHeight: "70vh", overflow: "auto" }}>
        <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}><FileText size={18} /> Documentation</h3>
        <h4 style={{ margin: "8px 0 6px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}>Markdown Documentation</h4>
        <div className="grid">
          {docs.map((doc) => (
            <button key={doc.id} className="card" style={{ textAlign: "left", padding: 10, borderColor: selected?.kind === "doc" && selected.id === doc.id ? "#0f766e" : "#e5e7eb" }} onClick={() => setSelected({ kind: "doc", id: doc.id })}>
              <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><File size={14} /> {doc.filename}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>{doc.logical_path}</p>
            </button>
          ))}
        </div>
        {docs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No markdown documentation yet.</p>}

        <h4 style={{ margin: "14px 0 6px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted)" }}>Analysis Artifacts</h4>
        {artifactsError && <p className="muted" style={{ fontSize: 13 }}>{artifactsError}</p>}
        <div className="grid">
          {artifacts.map((artifact) => (
            <button
              key={artifact.artifact_id}
              className="card"
              style={{ textAlign: "left", padding: 10, borderColor: selected?.kind === "artifact" && selected.id === artifact.artifact_id ? "#0f766e" : "#e5e7eb" }}
              onClick={() => setSelected({ kind: "artifact", id: artifact.artifact_id })}
            >
              <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><BarChart3 size={14} /> {artifact.name}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>{artifact.task_title}</p>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>{artifact.type} · {artifact.source.replace(/_/g, " ")}</p>
            </button>
          ))}
        </div>
        {!artifactsError && artifacts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No analysis artifacts yet.</p>}
      </aside>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {selectedDoc ? <FileText size={18} /> : <BarChart3 size={18} />}
            {selectedDoc ? selectedDoc.filename : selectedArtifact ? selectedArtifact.name : "Select a doc or artifact"}
          </h3>
          <button className="btn" onClick={download} disabled={!selectedDoc} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Download size={14} /> Download</button>
        </div>
        {selectedDoc ? (
          <article className="card" style={{ maxHeight: "68vh", overflow: "auto" }}>
            <ReactMarkdown>{content || "*No content loaded*"}</ReactMarkdown>
          </article>
        ) : selectedArtifact ? (
          <article className="card" style={{ maxHeight: "68vh", overflow: "auto" }}>
            <p style={{ marginTop: 0 }}><strong>Artifact ID:</strong> <code>{selectedArtifact.artifact_id}</code></p>
            <p><strong>Task:</strong> {selectedArtifact.task_title} (<code>{selectedArtifact.task_id}</code>)</p>
            <p><strong>Task Status:</strong> {String(selectedArtifact.task_status).replace(/_/g, " ")}</p>
            <p><strong>Task Type:</strong> {String(selectedArtifact.task_type).replace(/_/g, " ")}</p>
            <p><strong>Type:</strong> {selectedArtifact.type}</p>
            <p><strong>Source:</strong> {String(selectedArtifact.source).replace(/_/g, " ")}</p>
            {selectedArtifact.provider_job_id && <p><strong>Provider Job:</strong> <code>{selectedArtifact.provider_job_id}</code></p>}
            {selectedArtifact.description && <p><strong>Description:</strong> {selectedArtifact.description}</p>}
            {selectedArtifact.path_or_url && (
              <p>
                <strong>Path / URL:</strong>{" "}
                {looksLikeHttpUrl(selectedArtifact.path_or_url)
                  ? <a href={selectedArtifact.path_or_url} target="_blank" rel="noreferrer">{selectedArtifact.path_or_url}</a>
                  : <code>{selectedArtifact.path_or_url}</code>}
              </p>
            )}
            <p><strong>Updated:</strong> {new Date(selectedArtifact.updated_at).toLocaleString()}</p>
          </article>
        ) : <p className="muted">No documentation or artifacts yet.</p>}
      </section>
    </div>
  );
}
