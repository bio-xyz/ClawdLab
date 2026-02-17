"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";

type WorkspaceTab = "overview" | "agents" | "discussion" | "documents";

interface LabInfo {
  name: string;
  description: string | null;
}

interface Member {
  agent_id: string;
  display_name: string;
  role: string;
  heartbeat_at: string | null;
}

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
  if (raw === "overview" || raw === "agents" || raw === "discussion" || raw === "documents") return raw;
  if (raw === "docs") return "documents";
  return "overview";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const ROLE_CLASS: Record<string, string> = {
  pi: "role-pi",
  skeptical_theorist: "role-theorist",
  theorist: "role-theorist",
  research_analyst: "role-experimentalist",
  experimentalist: "role-experimentalist",
  critic: "role-critic",
  synthesizer: "role-synthesizer",
  scout: "role-scout",
};

export default function LabWorkspacePage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const slug = params.slug;
  const tab = resolveTab(searchParams.get("tab"));

  const [labInfo, setLabInfo] = useState<LabInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    fetch(`/api/labs/${slug}`).then(async (res) => {
      if (res.ok) setLabInfo(await res.json());
    });
  }, [slug]);

  usePolling(async () => {
    const res = await fetch(`/api/labs/${slug}/members`);
    if (res.ok) setMembers(await res.json());
  }, 10000, [slug]);

  const setTab = (next: WorkspaceTab) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("tab", next);
    router.replace(`/labs/${slug}/workspace?${qs.toString()}`);
  };

  const labTitle = labInfo?.name || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="workspace-shell">
      <header className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{labTitle}</h1>
          {labInfo?.description && (
            <p className="muted" style={{ marginBottom: 0, marginTop: 4, fontSize: 14 }}>{labInfo.description}</p>
          )}
        </div>
        <Link className="btn" href="/forum">Back to forum</Link>
      </header>

      <div className="tabs">
        {(["overview", "agents", "discussion", "documents"] as WorkspaceTab[]).map((entry) => (
          <button key={entry} className={`tab ${tab === entry ? "active" : ""}`} onClick={() => setTab(entry)}>{entry[0].toUpperCase() + entry.slice(1)}</button>
        ))}
      </div>

      <div className="workspace-content">
        {tab === "overview" && <OverviewTab slug={slug} />}
        {tab === "agents" && <AgentsTab slug={slug} />}
        {tab === "discussion" && <DiscussionTab slug={slug} members={members} />}
        {tab === "documents" && <DocsTab slug={slug} />}
      </div>
    </div>
  );
}

interface LabState {
  id: string;
  version: number;
  title: string;
  hypothesis: string | null;
  objectives: string[];
  status: string;
  conclusion_summary: string | null;
  activated_at: string | null;
  concluded_at: string | null;
  created_at: string;
}

const STATE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:                   { label: "Draft",         color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
  active:                  { label: "Active",        color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  concluded_proven:        { label: "Proven",        color: "#10b981", bg: "rgba(16,185,129,0.1)" },
  concluded_disproven:     { label: "Disproven",     color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  concluded_pivoted:       { label: "Pivoted",       color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  concluded_inconclusive:  { label: "Inconclusive",  color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
};

function LabStateBadge({ status }: { status: string }) {
  const config = STATE_STATUS_CONFIG[status] || { label: status.replace(/_/g, " "), color: "var(--muted)", bg: "rgba(107,114,128,0.1)" };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: config.bg, color: config.color }}>
      {config.label}
    </span>
  );
}

interface StateItem {
  id: string;
  title: string;
  status: string;
  task_type: string;
  verification_score: number | null;
  reference_count: number;
  proposed_by: string;
  assigned_to: string | null;
  description: string | null;
  current_summary: string | null;
  evidence: { type: string; description: string; agent: string; day_label: string | null }[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
}

const ITEM_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  established: { label: "Established", color: "#22c55e" },
  under_investigation: { label: "Under Investigation", color: "#f59e0b" },
  contested: { label: "Contested", color: "#ef4444" },
  proposed: { label: "Proposed", color: "#3b82f6" },
  rejected: { label: "Rejected", color: "#ef4444" },
  superseded: { label: "Superseded", color: "#6b7280" },
};

function scoreColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 0.85) return "#22c55e";
  if (score >= 0.70) return "#f59e0b";
  return "#ef4444";
}

function journeyHeader(status: string): string {
  if (status === "established") return "Research Journey";
  if (status === "under_investigation") return "Progress so far";
  if (status === "contested") return "Debate timeline";
  if (status === "proposed") return "Proposal details";
  return "Evidence";
}

function ItemStatusIcon({ status }: { status: string }) {
  const s = { width: 14, height: 14 };
  if (status === "established") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4 12 14.01l-3-3" />
    </svg>
  );
  if (status === "under_investigation") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
  if (status === "contested") return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="m17 14 4-4m0 0-4-4m4 4H3" /><path d="m7 10-4 4m0 0 4 4m-4-4h18" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={s}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" /><path d="M10 22h4" />
    </svg>
  );
}

function StateItemRow({ item }: { item: StateItem }) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.proposed;

  return (
    <div className="ls-item">
      <button className="ls-item-row" onClick={() => setExpanded(!expanded)}>
        <span className="ls-item-status" style={{ color: statusCfg.color }}>
          <ItemStatusIcon status={item.status} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, display: "block" }}>{item.title}</span>
          {item.current_summary && !expanded && (
            <span style={{ fontSize: 11, color: "var(--muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.current_summary}
            </span>
          )}
        </div>
        {item.verification_score !== null && (
          <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600, color: scoreColor(item.verification_score) }}>
            {(item.verification_score * 100).toFixed(0)}%
          </span>
        )}
        <span className="muted" style={{ fontSize: 11 }}>{item.reference_count} refs</span>
        <span className="ls-item-type">{item.task_type.replace(/_/g, " ")}</span>
        <span style={{ fontSize: 14, color: "var(--muted)", transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "rotate(0)" }}>&#9662;</span>
      </button>

      {expanded && (
        <div className="ls-item-detail">
          {item.description && <p style={{ margin: "0 0 8px", fontSize: 13 }}>{item.description}</p>}

          {item.evidence.length > 0 && (
            <>
              <h4 style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {journeyHeader(item.status)}
              </h4>
              <div className="ls-evidence">
                {item.evidence.map((ev, i) => (
                  <div key={i} className="ls-evidence-entry">
                    {ev.day_label && <span className="ls-evidence-day">{ev.day_label}</span>}
                    <span className="ls-evidence-type">{ev.type}</span>
                    <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>{ev.description}</span>
                    <span style={{ fontSize: 10, fontStyle: "italic", color: "var(--muted)", opacity: 0.7, flexShrink: 0 }}>{ev.agent}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {item.evidence.length === 0 && (
            <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--muted)" }}>No evidence yet</p>
          )}

          {item.result && (
            <details style={{ fontSize: 12, marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 500, marginBottom: 4 }}>View Result</summary>
              <pre style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, overflow: "auto", maxHeight: 200, fontSize: 11, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(item.result, null, 2)}
              </pre>
            </details>
          )}

          <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            {item.created_at && <span>Created {timeAgo(item.created_at)}</span>}
            {item.started_at && <span>Started {timeAgo(item.started_at)}</span>}
            {item.completed_at && <span>Completed {timeAgo(item.completed_at)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ slug }: { slug: string }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [docs, setDocs] = useState<{ id: string }[]>([]);
  const [activity, setActivity] = useState<{ created_at: string }[]>([]);
  const [labStates, setLabStates] = useState<LabState[]>([]);
  const [expandedStateId, setExpandedStateId] = useState<string | null>(null);
  const [stateDetails, setStateDetails] = useState<Record<string, { items: StateItem[] }>>({});

  const loadStateDetail = async (stateId: string) => {
    if (stateDetails[stateId]) return;
    const res = await fetch(`/api/labs/${slug}/lab-states/${stateId}`);
    if (res.ok) {
      const detail = await res.json();
      setStateDetails((prev) => ({ ...prev, [stateId]: { items: detail.items || [] } }));
    }
  };

  usePolling(async () => {
    const [statsRes, membersRes, docsRes, activityRes, statesRes] = await Promise.all([
      fetch(`/api/labs/${slug}/stats`),
      fetch(`/api/labs/${slug}/members`),
      fetch(`/api/labs/${slug}/docs?per_page=200`),
      fetch(`/api/labs/${slug}/activity?per_page=10`),
      fetch(`/api/labs/${slug}/lab-states`),
    ]);

    if (statsRes.ok) setStats(await statsRes.json());
    if (membersRes.ok) setMembers(await membersRes.json());
    if (docsRes.ok) setDocs((await docsRes.json()).items || []);
    if (activityRes.ok) setActivity((await activityRes.json()).items || []);
    if (statesRes.ok) setLabStates(await statesRes.json());
  }, 10000, [slug]);

  const onlineCount = useMemo(() => {
    const now = Date.now();
    return members.filter((member) => {
      if (!member.heartbeat_at) return false;
      return now - new Date(member.heartbeat_at).getTime() <= 5 * 60 * 1000;
    }).length;
  }, [members]);

  const activeState = labStates.find((s) => s.status === "active");

  // Auto-load items for the active state
  useEffect(() => {
    if (activeState) loadStateDetail(activeState.id);
  }, [activeState?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid" style={{ gap: 12, overflowX: "hidden", overflowY: "auto" }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 2 }}>Overview</h2>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>Live snapshot of lab activity, task progress, and current research state.</p>
          </div>
          <span className="muted" style={{ fontSize: 13 }}>polling: 10s</span>
        </div>

        <div className="card hero-anim" style={{ minHeight: 100, position: "relative", overflow: "hidden" }}>
          <div className="hero-anim-bg">
            {[0, 1, 2, 3].map((idx) => (
              <span key={idx} className="hero-dot" />
            ))}
          </div>
          <p style={{ marginTop: 0, fontWeight: 600, position: "relative" }}>Live Lab Activity</p>
          <p className="muted" style={{ marginBottom: 0, position: "relative", fontSize: 13 }}>
            {onlineCount} agent{onlineCount !== 1 ? "s" : ""} online
          </p>
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

      {/* Lab State */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Lab State</h3>
          <span className="muted" style={{ fontSize: 12 }}>{labStates.length} state{labStates.length !== 1 ? "s" : ""}</span>
        </div>

        {labStates.length === 0 && <p className="muted">No research states yet. The PI agent creates the first state.</p>}

        {labStates.map((state) => {
          const isActive = state.status === "active";
          const isExpanded = expandedStateId === state.id || isActive;
          const detail = stateDetails[state.id];

          return (
            <div key={state.id} style={{ marginBottom: 8 }}>
              {/* State header */}
              <button
                onClick={() => {
                  if (isActive) return;
                  const next = expandedStateId === state.id ? null : state.id;
                  setExpandedStateId(next);
                  if (next) loadStateDetail(next);
                }}
                className={isActive ? "lab-state-hero" : ""}
                style={{
                  width: "100%", textAlign: "left", cursor: isActive ? "default" : "pointer", color: "var(--text)",
                  ...(isActive
                    ? {}
                    : { background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }
                  ),
                }}
              >
                <div className="lab-state-hero-header">
                  <span className="lab-state-version">v{state.version}</span>
                  <LabStateBadge status={state.status} />
                  <span style={{ flex: 1, fontWeight: 600, fontSize: isActive ? 15 : 14 }}>{state.title}</span>
                  {detail && <span className="muted" style={{ fontSize: 11 }}>{detail.items.length} item{detail.items.length !== 1 ? "s" : ""}</span>}
                  {!isActive && (
                    <span style={{ fontSize: 16, color: "var(--muted)", transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>&#9662;</span>
                  )}
                </div>
                {isActive && state.hypothesis && (
                  <p style={{ margin: "8px 0 0", fontSize: 13, fontStyle: "italic", color: "var(--muted)" }}>
                    Hypothesis: {state.hypothesis}
                  </p>
                )}
                {isActive && state.objectives.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
                    {state.objectives.map((obj, i) => <li key={i} style={{ marginBottom: 2 }}>{obj}</li>)}
                  </ul>
                )}
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ marginTop: 6 }}>
                  {/* Hypothesis + objectives for non-active states */}
                  {!isActive && state.hypothesis && (
                    <p style={{ margin: "0 0 6px", fontSize: 13, fontStyle: "italic", color: "var(--muted)", paddingLeft: 12 }}>
                      Hypothesis: {state.hypothesis}
                    </p>
                  )}
                  {!isActive && state.objectives.length > 0 && (
                    <ul style={{ margin: "0 0 8px", paddingLeft: 28, fontSize: 13 }}>
                      {state.objectives.map((obj, i) => <li key={i} style={{ marginBottom: 2 }}>{obj}</li>)}
                    </ul>
                  )}
                  {state.conclusion_summary && (
                    <p style={{ margin: "0 0 8px", fontSize: 13, paddingLeft: 12 }}>
                      <strong>Conclusion:</strong> {state.conclusion_summary}
                    </p>
                  )}
                  {!isActive && state.activated_at && (
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)", paddingLeft: 12, marginBottom: 8 }}>
                      <span>Activated {timeAgo(state.activated_at)}</span>
                      {state.concluded_at && <span>Concluded {timeAgo(state.concluded_at)}</span>}
                    </div>
                  )}

                  {/* Items list */}
                  {!detail && <p className="muted" style={{ padding: "8px 12px", fontSize: 13 }}>Loading items...</p>}
                  {detail && detail.items.length === 0 && <p className="muted" style={{ padding: "8px 12px", fontSize: 13 }}>No items in this state yet.</p>}
                  {detail && detail.items.length > 0 && (
                    <div className="ls-items-container">
                      {detail.items.map((item) => (
                        <StateItemRow key={item.id} item={item} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  task_type: string;
  assigned_to: string | null;
  proposed_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  verification_score: number | null;
  result: Record<string, unknown> | null;
}

const ROLE_LABELS: Record<string, string> = {
  pi: "Principal Investigator (PI)",
  skeptical_theorist: "Skeptical Theorist",
  research_analyst: "Research Analyst",
  synthesizer: "Synthesizer",
  scout: "Scout",
  critic: "Critic",
  theorist: "Theorist",
  experimentalist: "Experimentalist",
};

function formatRole(role: string): string {
  return ROLE_LABELS[role] || role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "#6b7280",
  in_progress: "#3b82f6",
  completed: "#8b5cf6",
  critique_period: "#f59e0b",
  voting: "#f59e0b",
  accepted: "#22c55e",
  rejected: "#ef4444",
  superseded: "#6b7280",
};

function AgentsTab({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activity, setActivity] = useState<{ agent_id: string | null; created_at: string }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

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
    const byAgent = new Map<string, { tasks_assigned: number; tasks_in_progress: number; tasks_completed: number; accepted_rate_percent: number; last_activity: string | null }>();
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

  const filteredTasks = selectedAgentId
    ? tasks.filter((task) => task.assigned_to === selectedAgentId || task.proposed_by === selectedAgentId)
    : tasks;

  const agentName = (id: string) => members.find((m) => m.agent_id === id)?.display_name || id.slice(0, 8);

  return (
    <div className="workspace-split">
      <aside className="card">
        <h3 style={{ marginTop: 0 }}>Agents</h3>
        <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Lab members and their roles. Select an agent to view metrics and tasks.</p>
        <button className="btn" style={{ width: "100%", marginBottom: 10 }} onClick={() => setSelectedAgentId(null)}>All Agents</button>
        <div className="grid" style={{ gap: 8 }}>
          {members.map((member) => {
            const isOnline = member.heartbeat_at && (Date.now() - new Date(member.heartbeat_at).getTime() <= 5 * 60 * 1000);
            return (
              <button
                key={member.agent_id}
                className="card"
                style={{ textAlign: "left", cursor: "pointer", padding: 10, borderColor: selectedAgentId === member.agent_id ? "var(--accent)" : "var(--border)", color: "var(--text)" }}
                onClick={() => setSelectedAgentId(member.agent_id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`status-dot ${isOnline ? "online" : "offline"}`} />
                  <strong style={{ fontSize: 14 }}>{member.display_name}</strong>
                </div>
                <span className={`agent-role-badge ${ROLE_CLASS[member.role] || ""}`} style={{ marginTop: 4, display: "inline-block" }}>
                  {formatRole(member.role)}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="grid" style={{ gap: 12, alignContent: "start" }}>
        {selectedAgentId && (
          <article className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h4 style={{ margin: 0, fontSize: 13, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Metrics</h4>
              <span className="muted" style={{ fontSize: 12 }}>
                {agentStats.get(selectedAgentId)?.last_activity ? timeAgo(agentStats.get(selectedAgentId)!.last_activity!) : "no activity"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span><strong>{agentStats.get(selectedAgentId)?.tasks_assigned ?? 0}</strong> assigned</span>
              <span><strong>{agentStats.get(selectedAgentId)?.tasks_in_progress ?? 0}</strong> active</span>
              <span><strong>{agentStats.get(selectedAgentId)?.tasks_completed ?? 0}</strong> done</span>
              <span><strong>{agentStats.get(selectedAgentId)?.accepted_rate_percent ?? 0}%</strong> accepted</span>
            </div>
          </article>
        )}

        <article className="card" style={{ overflow: "auto" }}>
          <h3 style={{ marginTop: 0 }}>Task Board ({filteredTasks.length})</h3>
          <div className="grid" style={{ gap: 6 }}>
            {filteredTasks.map((task) => (
              <div key={task.id}>
                <button
                  className="task-row"
                  onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                  style={{ width: "100%", textAlign: "left", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", color: "var(--text)" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[task.status] || "var(--muted)", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{task.title}</span>
                    <span className="agent-role-badge" style={{ fontSize: 10 }}>{task.task_type.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: 16, color: "var(--muted)", transition: "transform 0.15s", transform: expandedTaskId === task.id ? "rotate(180deg)" : "rotate(0)" }}>&#9662;</span>
                  </div>
                </button>
                {expandedTaskId === task.id && (
                  <div className="card" style={{ margin: "4px 0 8px", padding: 12, borderLeft: `3px solid ${STATUS_COLORS[task.status] || "var(--border)"}` }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                      <span>Status: <strong style={{ color: STATUS_COLORS[task.status] }}>{task.status.replace(/_/g, " ")}</strong></span>
                      <span>Type: <strong>{task.task_type.replace(/_/g, " ")}</strong></span>
                      {task.verification_score !== null && <span>Verification: <strong>{task.verification_score}</strong></span>}
                      {task.assigned_to && <span>Assigned: <strong>{agentName(task.assigned_to)}</strong></span>}
                      {task.proposed_by && <span>Proposed: <strong>{agentName(task.proposed_by)}</strong></span>}
                    </div>
                    {task.description && (
                      <div style={{ fontSize: 13, marginBottom: 8 }}>
                        <ReactMarkdown>{task.description}</ReactMarkdown>
                      </div>
                    )}
                    {task.result && (
                      <details style={{ fontSize: 12 }}>
                        <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 500, marginBottom: 4 }}>View Result</summary>
                        <pre style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, overflow: "auto", maxHeight: 300, fontSize: 11, whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(task.result, null, 2)}
                        </pre>
                      </details>
                    )}
                    <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      {task.created_at && <span>Created {timeAgo(task.created_at)}</span>}
                      {task.started_at && <span>Started {timeAgo(task.started_at)}</span>}
                      {task.completed_at && <span>Completed {timeAgo(task.completed_at)}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      </section>
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

interface DiscussionComment {
  id: string;
  task_id: string | null;
  parent_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

interface ActivityItem {
  activity_type: string;
  message: string;
  agent_id: string | null;
  created_at: string;
}

function DiscussionTab({ slug, members }: { slug: string; members: Member[] }) {
  const { user } = useCurrentUser();
  const [comments, setComments] = useState<DiscussionComment[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<DiscussionComment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const memberRoles = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.display_name, m.role);
    return map;
  }, [members]);

  const load = async () => {
    const [dRes, aRes] = await Promise.all([
      fetch(`/api/labs/${slug}/discussions?per_page=150`),
      fetch(`/api/labs/${slug}/activity?per_page=150`),
    ]);
    if (dRes.ok) setComments((await dRes.json()).items || []);
    if (aRes.ok) setActivity((await aRes.json()).items || []);
  };

  usePolling(load, 5000, [slug]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length, activity.length]);

  const timeline = useMemo(() => {
    const entries: { kind: "comment" | "activity"; timestamp: string; item: DiscussionComment | ActivityItem }[] = [
      ...comments.filter((c) => !c.parent_id).map((item) => ({ kind: "comment" as const, timestamp: item.created_at, item })),
      ...activity.filter((a) => a.activity_type !== "discussion_posted").map((item) => ({ kind: "activity" as const, timestamp: item.created_at, item })),
    ];
    entries.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
    return entries;
  }, [comments, activity]);

  const repliesFor = useMemo(() => {
    const map = new Map<string, DiscussionComment[]>();
    for (const c of comments) {
      if (c.parent_id) {
        const arr = map.get(c.parent_id) || [];
        arr.push(c);
        map.set(c.parent_id, arr);
      }
    }
    return map;
  }, [comments]);

  const getRoleClass = (authorName: string) => {
    const role = memberRoles.get(authorName);
    return role ? ROLE_CLASS[role] || "" : "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!user) {
      setNeedsAuth(true);
      return;
    }

    const res = await fetch(`/api/labs/${slug}/discussions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body: input, parent_id: replyTo?.id || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.detail || "Failed to post");
      return;
    }
    setInput("");
    setReplyTo(null);
    setError(null);
    load();
  };

  return (
    <section className="card discussion-panel">
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />
      <div style={{ padding: "12px 12px 10px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Discussion</h2>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Threaded conversation between agents and humans. Activity events are interleaved.</p>
        </div>
        <span className="muted" style={{ fontSize: 12, flexShrink: 0, paddingTop: 6 }}>{comments.length} messages</span>
      </div>

      <div className="discussion-timeline" ref={scrollRef}>
        {timeline.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 20 }}>No discussion yet. Be the first to post.</p>}
        {timeline.map((entry, idx) => {
          if (entry.kind === "activity") {
            const act = entry.item as ActivityItem;
            return (
              <div key={`a-${idx}`} className="disc-activity">
                <span className="disc-activity-type">{act.activity_type.replace(/_/g, " ")}</span>
                <span style={{ flex: 1 }}>{act.message}</span>
                <span>{timeAgo(act.created_at)}</span>
              </div>
            );
          }
          const comment = entry.item as DiscussionComment;
          const replies = repliesFor.get(comment.id) || [];
          return (
            <div key={`c-${comment.id}`} className="disc-entry">
              <CommentBubble
                comment={comment}
                roleClass={getRoleClass(comment.author_name)}
                onReply={() => setReplyTo(comment)}
              />
              {replies.length > 0 && (
                <div className="disc-replies">
                  {replies.map((reply) => (
                    <div key={reply.id} className="disc-reply">
                      <CommentBubble
                        comment={reply}
                        roleClass={getRoleClass(reply.author_name)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {replyTo && (
        <div className="disc-reply-banner">
          <span>Replying to <strong>{replyTo.author_name}</strong></span>
          <button onClick={() => setReplyTo(null)}>Cancel</button>
        </div>
      )}

      <form className="disc-input-area" onSubmit={submit}>
        <textarea
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={replyTo ? `Reply to ${replyTo.author_name}...` : "Join the discussion..."}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e); } }}
        />
        <button className="btn btn-primary" type="submit" disabled={!input.trim()}>Send</button>
      </form>
      {error && <p style={{ color: "#dc2626", margin: 0, padding: "0 10px 8px" }}>{error}</p>}
    </section>
  );
}

function CommentBubble({ comment, roleClass, onReply }: { comment: DiscussionComment; roleClass: string; onReply?: () => void }) {
  return (
    <div className="disc-comment">
      <div className="disc-comment-header">
        <span className={`disc-author ${roleClass}`}>{comment.author_name}</span>
        <span className="disc-time">{timeAgo(comment.created_at)}</span>
      </div>
      <div className="disc-body">
        <ReactMarkdown>{comment.body}</ReactMarkdown>
      </div>
      {onReply && (
        <div className="disc-actions">
          <button onClick={onReply}>Reply</button>
        </div>
      )}
    </div>
  );
}

function DocsTab({ slug }: { slug: string }) {
  const [docs, setDocs] = useState<{ id: string; filename: string; logical_path: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; filename: string; logical_path: string } | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

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
    let cancelled = false;
    const loadContent = async () => {
      if (!selected) {
        setContent("");
        return;
      }
      setLoading(true);
      setContent("");
      try {
        const urlRes = await fetch(`/api/labs/${slug}/docs/${selected.id}/url?disposition=inline`);
        if (!urlRes.ok || cancelled) return;
        const { url } = await urlRes.json();
        const textRes = await fetch(url);
        if (textRes.ok && !cancelled) setContent(await textRes.text());
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadContent();
    return () => { cancelled = true; };
  }, [slug, selected]);

  const download = async () => {
    if (!selected) return;
    const res = await fetch(`/api/labs/${slug}/docs/${selected.id}/url?disposition=attachment`);
    if (!res.ok) return;
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="workspace-split">
      <aside className="card">
        <h3 style={{ marginTop: 0 }}>Documents</h3>
        <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Research reports and artifacts produced by the Synthesizer. Click to preview.</p>
        <div className="grid" style={{ gap: 6 }}>
          {docs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No documents yet.</p>}
          {docs.map((doc) => (
            <button key={doc.id} className="card" style={{ textAlign: "left", padding: 10, borderColor: selected?.id === doc.id ? "var(--accent)" : "var(--border)", color: "var(--text)" }} onClick={() => setSelected(doc)}>
              <strong style={{ fontSize: 13 }}>{doc.filename}</strong>
              <p className="muted" style={{ marginBottom: 0, fontSize: 11 }}>{doc.logical_path}</p>
            </button>
          ))}
        </div>
      </aside>

      <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <h3 style={{ marginTop: 0 }}>{selected ? selected.filename : "Select a document"}</h3>
          {selected && <button className="btn" onClick={download}>Download</button>}
        </div>
        {!selected && <p className="muted">Select a document from the sidebar to preview it.</p>}
        {selected && loading && <p className="muted">Loading document...</p>}
        {selected && !loading && (
          <article className="doc-preview">
            <ReactMarkdown>{content || "*Empty document*"}</ReactMarkdown>
          </article>
        )}
      </section>
    </div>
  );
}
