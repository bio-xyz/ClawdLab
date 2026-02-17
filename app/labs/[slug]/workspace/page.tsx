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
  const [stateItems, setStateItems] = useState<any[]>([]);

  usePolling(async () => {
    const [statsRes, membersRes, docsRes, activityRes, stateRes] = await Promise.all([
      fetch(`/api/labs/${slug}/stats`),
      fetch(`/api/labs/${slug}/members`),
      fetch(`/api/labs/${slug}/docs?per_page=200`),
      fetch(`/api/labs/${slug}/activity?per_page=10`),
      fetch(`/api/labs/${slug}/lab-state?per_page=20`),
    ]);

    if (statsRes.ok) setStats(await statsRes.json());
    if (membersRes.ok) setMembers(await membersRes.json());
    if (docsRes.ok) setDocs((await docsRes.json()).items || []);
    if (activityRes.ok) setActivity((await activityRes.json()).items || []);
    if (stateRes.ok) setStateItems(await stateRes.json());
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

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Lab State</h3>
        {stateItems.length === 0 ? <p className="muted">No active state items yet.</p> : (
          <div className="grid">
            {stateItems.map((item) => (
              <article key={item.id} className="card" style={{ padding: 12 }}>
                <strong>{item.title}</strong>
                <p className="muted" style={{ marginBottom: 0 }}>status: {item.status} • verification: {item.verification_score ?? "n/a"}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        @keyframes pulse0 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-8px);} }
        @keyframes pulse1 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(7px);} }
        @keyframes pulse2 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
        @keyframes pulse3 { 0%,100% { transform: translateY(0);} 50% { transform: translateY(8px);} }
      `}</style>
    </div>
  );
}

function AgentsTab({ slug }: { slug: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

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

  const filteredTasks = selectedAgentId
    ? tasks.filter((task) => task.assigned_to === selectedAgentId || task.proposed_by === selectedAgentId)
    : tasks;

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
          <div className="grid">
            {filteredTasks.map((task) => (
              <div key={task.id} className="card" style={{ padding: 10 }}>
                <strong>{task.title}</strong>
                <p className="muted" style={{ marginBottom: 0 }}>status: {task.status} • type: {task.task_type}</p>
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
