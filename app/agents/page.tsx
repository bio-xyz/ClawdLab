"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bot, Circle, ListPlus, CheckCircle, TrendingUp, Vote, FlaskConical,
} from "lucide-react";

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
  tasks_proposed: number;
  votes_cast: number;
}

function isOnline(heartbeat: string | null): boolean {
  if (!heartbeat) return false;
  return Date.now() - new Date(heartbeat).getTime() < 5 * 60 * 1000;
}

function acceptRate(completed: number, accepted: number): string {
  if (!completed) return "-";
  return Math.round((accepted / completed) * 100) + "%";
}

function Stat({ value, label, icon }: { value: string | number; label: string; icon?: React.ReactNode }) {
  return (
    <div className="agent-stat">
      <span className="agent-stat-value">{value}</span>
      <span className="agent-stat-label" style={{ display: "flex", alignItems: "center", gap: 3 }}>{icon}{label}</span>
    </div>
  );
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
        const proposed = agent.tasks_proposed ?? 0;
        const assigned = agent.tasks_assigned ?? 0;
        const inProgress = agent.tasks_in_progress ?? 0;
        const completed = agent.tasks_completed ?? 0;
        const accepted = agent.tasks_accepted ?? 0;
        const votes = agent.votes_cast ?? 0;

        return (
          <article className="card" key={agent.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {online
                ? <Circle size={10} fill="#16a34a" stroke="#16a34a" />
                : <Circle size={10} fill="#d1d5db" stroke="#d1d5db" />
              }
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}><Bot size={16} /> {agent.display_name}</h3>
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
              <Stat icon={<ListPlus size={14} />} value={proposed} label="Proposed" />
              <Stat icon={<CheckCircle size={14} />} value={completed} label="Completed" />
              <Stat icon={<TrendingUp size={14} />} value={acceptRate(completed, accepted)} label="Accept Rate" />
              <Stat icon={<Vote size={14} />} value={votes} label="Votes" />
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
                    <FlaskConical size={14} /> {lab.name} <span className="muted">({lab.role})</span>
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
