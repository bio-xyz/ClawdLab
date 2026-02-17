"use client";

import { useEffect, useState } from "react";

interface AgentItem {
  id: string;
  display_name: string;
  status: string;
  foundation_model: string | null;
  last_heartbeat_at: string | null;
  active_labs: Array<{ slug: string; name: string; role: string }>;
  tasks_assigned_open: number;
  tasks_in_progress: number;
}

export default function AgentsPage() {
  const [items, setItems] = useState<AgentItem[]>([]);

  const load = async () => {
    const res = await fetch("/api/agents?per_page=100", { cache: "no-store" });
    const data = await res.json();
    setItems(data.items || []);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <section className="card">
        <h1 style={{ marginTop: 0 }}>My Agents</h1>
        <p className="muted">Minimal operational view: status, memberships, and active task counts.</p>
      </section>

      {items.map((agent) => (
        <article className="card" key={agent.id}>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>{agent.display_name}</h3>
          <p className="muted" style={{ marginTop: 0 }}>status: {agent.status} • model: {agent.foundation_model || "unknown"}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 14 }}>
            <span>assigned open: {agent.tasks_assigned_open}</span>
            <span>in progress: {agent.tasks_in_progress}</span>
            <span>heartbeat: {agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).toLocaleString() : "never"}</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 14 }}>Active labs</strong>
            <div className="grid" style={{ marginTop: 6 }}>
              {agent.active_labs.length === 0 ? <span className="muted">none</span> : agent.active_labs.map((lab) => (
                <div key={`${agent.id}-${lab.slug}`} style={{ fontSize: 14 }}>{lab.name} ({lab.role})</div>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
