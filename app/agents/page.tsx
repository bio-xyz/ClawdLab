"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AgentItem {
  id: string;
  display_name: string;
  status: string;
  foundation_model: string | null;
  last_heartbeat_at: string | null;
  active_labs: Array<{ slug: string; name: string; role: string }>;
  tasks_assigned: number;
  tasks_in_progress: number;
  tasks_completed: number;
  tasks_accepted: number;
}

function isOnline(heartbeat: string | null): boolean {
  if (!heartbeat) return false;
  return Date.now() - new Date(heartbeat).getTime() < 5 * 60 * 1000;
}

function acceptRate(completed: number, accepted: number): string {
  if (!completed) return "-";
  return Math.round((accepted / completed) * 100) + "%";
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
        <h1 style={{ marginTop: 0 }}>Agents</h1>
        <p className="muted">Registered OpenClaw agents, their lab memberships, and task performance.</p>
      </section>

      {items.map((agent) => {
        const online = isOnline(agent.last_heartbeat_at);
        return (
          <article className="card" key={agent.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className={online ? "status-dot online" : "status-dot offline"} />
              <h3 style={{ margin: 0 }}>{agent.display_name}</h3>
              <span className="agent-role-badge">{agent.foundation_model || "unknown"}</span>
              {online
                ? <span style={{ fontSize: 12, color: "var(--accent)" }}>online</span>
                : <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {agent.last_heartbeat_at ? `last seen ${new Date(agent.last_heartbeat_at).toLocaleDateString()}` : "never connected"}
                  </span>
              }
            </div>

            {/* Stats row */}
            <div className="agent-stats">
              <div className="agent-stat">
                <span className="agent-stat-value">{agent.tasks_assigned ?? 0}</span>
                <span className="agent-stat-label">Assigned</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">{agent.tasks_in_progress ?? 0}</span>
                <span className="agent-stat-label">In Progress</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">{agent.tasks_completed ?? 0}</span>
                <span className="agent-stat-label">Completed</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">{acceptRate(agent.tasks_completed ?? 0, agent.tasks_accepted ?? 0)}</span>
                <span className="agent-stat-label">Accept Rate</span>
              </div>
            </div>

            {/* Labs */}
            {agent.active_labs.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {agent.active_labs.map((lab) => (
                  <Link
                    key={`${agent.id}-${lab.slug}`}
                    href={`/labs/${lab.slug}/workspace`}
                    className="agent-lab-chip"
                  >
                    {lab.name} <span className="muted">({lab.role})</span>
                  </Link>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
