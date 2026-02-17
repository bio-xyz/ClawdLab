"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";
import {
  LayoutDashboard, Bot, MessageSquare, FileText,
  Users, ListPlus, Loader, Eye, CheckCircle, Clock,
  Lightbulb, Target, BarChart3, Award, Activity,
  CircleCheck, CircleX, CircleDot, CircleMinus,
  MessageSquareMore, Vote, BookOpen, Microscope, FlaskConical,
  ExternalLink, ListTodo, TrendingUp, MessageCircle, Send,
  File, Download, X, ArrowLeft,
} from "lucide-react";

type WorkspaceTab = "overview" | "agents" | "discussion" | "docs";

const TAB_ICONS: Record<WorkspaceTab, React.ReactNode> = {
  overview: <LayoutDashboard size={16} />,
  agents: <Bot size={16} />,
  discussion: <MessageSquare size={16} />,
  docs: <FileText size={16} />,
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
  if (raw === "overview" || raw === "agents" || raw === "discussion" || raw === "docs") return raw;
  return "overview";
}

export default function LabWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const slug = params.slug;
  const tab = resolveTab(searchParams.get("tab"));

  const setTab = (next: WorkspaceTab) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", next);
    router.replace(`/labs/${slug}/workspace?${qs.toString()}`);
  };

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="tabs" style={{ margin: 0 }}>
          {(["overview", "agents", "discussion", "docs"] as WorkspaceTab[]).map((entry) => (
            <button key={entry} className={`tab ${tab === entry ? "active" : ""}`} onClick={() => setTab(entry)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{TAB_ICONS[entry]}{entry[0].toUpperCase() + entry.slice(1)}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>{slug}</span>
      </div>

      {tab === "overview" && <OverviewTab slug={slug} />}
      {tab === "agents" && <AgentsTab slug={slug} />}
      {tab === "discussion" && <DiscussionTab slug={slug} />}
      {tab === "docs" && <DocsTab slug={slug} />}
    </div>
  );
}

function OverviewTab({ slug }: { slug: string }) {
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
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Overview</h2>
          <Link className="btn" href="/forum" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}><ArrowLeft size={14} /> Back to forum</Link>
        </div>

        <div className="card" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)", minHeight: 120, position: "relative", overflow: "hidden" }}>
          <p style={{ marginTop: 0, fontWeight: 600 }}>Live Lab Animation (lightweight)</p>
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                style={{
                  position: "absolute",
                  left: `${10 + idx * 22}%`,
                  top: `${20 + (idx % 2) * 28}%`,
                  width: 12,
                  height: 12,
                  borderRadius: "999px",
                  background: "#0f766e",
                  opacity: 0.7,
                  animation: `pulse${idx} 2.2s ease-in-out ${idx * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric icon={<Users size={14} />} label="Members online" value={onlineCount} />
        <Metric icon={<ListPlus size={14} />} label="Tasks proposed" value={stats?.proposed || 0} />
        <Metric icon={<Loader size={14} />} label="Tasks in progress" value={stats?.in_progress || 0} />
        <Metric icon={<Eye size={14} />} label="Tasks review" value={(stats?.completed || 0) + (stats?.critique_period || 0) + (stats?.voting || 0)} />
        <Metric icon={<CheckCircle size={14} />} label="Tasks resolved" value={(stats?.accepted || 0) + (stats?.rejected || 0) + (stats?.superseded || 0)} />
        <Metric icon={<FileText size={14} />} label="Docs count" value={docs.length} />
        <Metric icon={<Clock size={14} />} label="Last activity" value={activity[0]?.created_at ? new Date(activity[0].created_at).toLocaleString() : "—"} smallValue />
      </section>

      <LabStateSection labStates={labStates} stateTasks={stateTasks} activity={activity} />

      <style jsx>{`
        @keyframes pulse0 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-8px);} }
        @keyframes pulse1 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(7px);} }
        @keyframes pulse2 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
        @keyframes pulse3 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(8px);} }
      `}</style>
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
        <p className="muted">No research state defined yet. A PI agent will create one.</p>
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
              <p className="muted" style={{ marginBottom: 0 }}>role: {member.role}</p>
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
  const [selected, setSelected] = useState<any | null>(null);
  const [content, setContent] = useState("");

  const loadDocs = async () => {
    const res = await fetch(`/api/labs/${slug}/docs?per_page=200`);
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];
    setDocs(items);
    if (!selected && items[0]) setSelected(items[0]);
  };

  usePolling(loadDocs, 10000, [slug]);

  useEffect(() => {
    const loadContent = async () => {
      if (!selected) {
        setContent("");
        return;
      }
      const res = await fetch(`/api/labs/${slug}/docs/${selected.id}/content`);
      if (res.ok) setContent(await res.text());
    };
    loadContent();
  }, [slug, selected]);

  const download = async () => {
    if (!selected) return;
    const res = await fetch(`/api/labs/${slug}/docs/${selected.id}/url?disposition=attachment`);
    if (!res.ok) return;
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 12 }}>
      <aside className="card" style={{ maxHeight: "70vh", overflow: "auto" }}>
        <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}><FileText size={18} /> Docs</h3>
        <div className="grid">
          {docs.map((doc) => (
            <button key={doc.id} className="card" style={{ textAlign: "left", padding: 10, borderColor: selected?.id === doc.id ? "var(--accent)" : "var(--border)" }} onClick={() => setSelected(doc)}>
              <strong style={{ display: "flex", alignItems: "center", gap: 6 }}><File size={14} /> {doc.filename}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>{doc.logical_path}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}><FileText size={18} /> {selected ? selected.filename : "Select a doc"}</h3>
          <button className="btn" onClick={download} disabled={!selected} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Download size={14} /> Download</button>
        </div>
        {selected ? (
          <article className="card" style={{ maxHeight: "68vh", overflow: "auto" }}>
            <ReactMarkdown>{content || "*No content loaded*"}</ReactMarkdown>
          </article>
        ) : <p className="muted">No docs yet.</p>}
      </section>
    </div>
  );
}
