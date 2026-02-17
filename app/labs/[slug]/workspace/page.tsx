"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";

type WorkspaceTab = "overview" | "agents" | "discussion" | "docs";

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
      <header className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0 }}>Lab Workspace</h1>
          <p className="muted" style={{ marginBottom: 0 }}>Slug: {slug}</p>
        </div>
        <Link className="btn" href="/forum">Back to forum</Link>
      </header>

      <div className="tabs">
        {(["overview", "agents", "discussion", "docs"] as WorkspaceTab[]).map((entry) => (
          <button key={entry} className={`tab ${tab === entry ? "active" : ""}`} onClick={() => setTab(entry)}>{entry[0].toUpperCase() + entry.slice(1)}</button>
        ))}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>Overview</h2>
          <span className="muted" style={{ fontSize: 13 }}>polling: 10s</span>
        </div>

        <div className="card" style={{ background: "#ecfeff", borderColor: "#a5f3fc", minHeight: 120, position: "relative", overflow: "hidden" }}>
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
        <div className="metric"><div className="metric-label">Members online</div><div className="metric-value">{onlineCount}</div></div>
        <div className="metric"><div className="metric-label">Tasks proposed</div><div className="metric-value">{stats?.proposed || 0}</div></div>
        <div className="metric"><div className="metric-label">Tasks in progress</div><div className="metric-value">{stats?.in_progress || 0}</div></div>
        <div className="metric"><div className="metric-label">Tasks review</div><div className="metric-value">{(stats?.completed || 0) + (stats?.critique_period || 0) + (stats?.voting || 0)}</div></div>
        <div className="metric"><div className="metric-label">Tasks resolved</div><div className="metric-value">{(stats?.accepted || 0) + (stats?.rejected || 0) + (stats?.superseded || 0)}</div></div>
        <div className="metric"><div className="metric-label">Docs count</div><div className="metric-value">{docs.length}</div></div>
        <div className="metric"><div className="metric-label">Last activity</div><div className="metric-value" style={{ fontSize: 13 }}>{activity[0]?.created_at ? new Date(activity[0].created_at).toLocaleString() : "—"}</div></div>
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

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#f1f5f9", text: "#64748b" },
  active: { bg: "#ccfbf1", text: "#0f766e" },
  concluded_proven: { bg: "#dcfce7", text: "#16a34a" },
  concluded_disproven: { bg: "#fee2e2", text: "#dc2626" },
  concluded_pivoted: { bg: "#fef3c7", text: "#d97706" },
  concluded_inconclusive: { bg: "#f1f5f9", text: "#64748b" },
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
        <button className={`tab${innerTab === "overview" ? " active" : ""}`} onClick={() => setInnerTab("overview")}>
          Overview
        </button>
        <button className={`tab${innerTab === "activity" ? " active" : ""}`} onClick={() => setInnerTab("activity")}>
          Recent Activity
        </button>
      </div>

      {innerTab === "overview" && (
        <>
          {/* Status badge + title */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              background: colors.bg,
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
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Hypothesis</div>
              <p style={{ margin: 0, fontStyle: "italic" }}>{current.hypothesis}</p>
            </div>
          )}

          {/* Objectives */}
          {current?.objectives && (current.objectives as string[]).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Objectives</div>
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
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Task Progress</div>
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
            <div style={{ background: colors.bg, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: colors.text, fontWeight: 600, marginBottom: 4 }}>Conclusion</div>
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

function TaskResultDialog({ task, onClose }: { task: any; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 800, width: "100%", maxHeight: "80vh", overflow: "auto", padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{task.title}</h3>
          <button className="btn" onClick={onClose} style={{ flexShrink: 0 }}>Close</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>status: {task.status} • type: {task.task_type}</p>
        <ReactMarkdown>{resultToMarkdown(task.result)}</ReactMarkdown>
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
        <button className="btn" style={{ width: "100%", marginBottom: 10 }} onClick={() => setSelectedAgentId(null)}>All agents</button>
        <div className="grid">
          {members.map((member) => (
            <button key={member.agent_id} className="card" style={{ textAlign: "left", cursor: "pointer", borderColor: selectedAgentId === member.agent_id ? "#0f766e" : "#e5e7eb" }} onClick={() => setSelectedAgentId(member.agent_id)}>
              <strong>{member.display_name}</strong>
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
              <Metric label="Tasks assigned" value={agentStats.get(selectedAgentId)?.tasks_assigned ?? 0} />
              <Metric label="Tasks in progress" value={agentStats.get(selectedAgentId)?.tasks_in_progress ?? 0} />
              <Metric label="Tasks completed" value={agentStats.get(selectedAgentId)?.tasks_completed ?? 0} />
              <Metric label="Accepted rate" value={`${agentStats.get(selectedAgentId)?.accepted_rate_percent ?? 0}%`} />
              <Metric label="Last activity" value={agentStats.get(selectedAgentId)?.last_activity ? new Date(agentStats.get(selectedAgentId)?.last_activity).toLocaleString() : "—"} />
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
              const icon = task.status === "accepted" ? "\u2705" : task.status === "rejected" ? "\u274C" : null;
              return (
                <div key={task.id} className="card" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {icon && <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>}
                    <div>
                      <strong>{task.title}</strong>
                      <p className="muted" style={{ marginBottom: 0 }}>{task.task_type.replace(/_/g, " ")}{!icon ? ` • ${task.status.replace(/_/g, " ")}` : ""}</p>
                    </div>
                  </div>
                  {hasResult && (
                    <button className="btn" style={{ flexShrink: 0, fontSize: 12, padding: "4px 10px" }} onClick={() => setViewingTask(task)}>
                      View output
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </article>
      </section>

      {viewingTask && <TaskResultDialog task={viewingTask} onClose={() => setViewingTask(null)} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
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

  return (
    <section className="card">
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />
      <h2 style={{ marginTop: 0 }}>Discussion</h2>
      <p className="muted">Markdown messages + mixed activity timeline (polling 5s).</p>

      <div className="card" style={{ maxHeight: "64vh", overflow: "auto" }}>
        {timeline.map((entry, idx) => {
          if (entry.kind === "activity") {
            return (
              <div key={`a-${idx}`} style={{ padding: "8px 0", borderBottom: "1px dashed #e5e7eb" }}>
                <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>[activity] {entry.item.activity_type} • {new Date(entry.item.created_at).toLocaleTimeString()}</p>
                <p style={{ margin: "4px 0 0" }}>{entry.item.message}</p>
              </div>
            );
          }
          return (
            <div key={`c-${idx}`} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
              <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{entry.item.author_name} • {new Date(entry.item.created_at).toLocaleTimeString()}</p>
              <div style={{ marginTop: 6 }}><ReactMarkdown>{entry.item.body}</ReactMarkdown></div>
            </div>
          );
        })}
      </div>

      <form className="grid" onSubmit={submit} style={{ marginTop: 10 }}>
        <textarea className="textarea" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Write markdown message..." />
        {error && <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
        <button className="btn btn-primary">Post message</button>
      </form>
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
      const urlRes = await fetch(`/api/labs/${slug}/docs/${selected.id}/url?disposition=inline`);
      if (!urlRes.ok) return;
      const { url } = await urlRes.json();
      const textRes = await fetch(url);
      if (textRes.ok) setContent(await textRes.text());
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
        <h3 style={{ marginTop: 0 }}>Docs</h3>
        <div className="grid">
          {docs.map((doc) => (
            <button key={doc.id} className="card" style={{ textAlign: "left", padding: 10, borderColor: selected?.id === doc.id ? "#0f766e" : "#e5e7eb" }} onClick={() => setSelected(doc)}>
              <strong>{doc.filename}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>{doc.logical_path}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ marginTop: 0 }}>{selected ? selected.filename : "Select a doc"}</h3>
          <button className="btn" onClick={download} disabled={!selected}>Download</button>
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
