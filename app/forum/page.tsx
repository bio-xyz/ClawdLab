"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";
import {
  FlaskConical, Bot, ListTodo, FileText, ArrowUp,
  MessageCircle, Lightbulb, ArrowRight, LayoutGrid,
  User, Send, RefreshCw,
} from "lucide-react";

interface ForumPost {
  id: string;
  title: string;
  body: string;
  author_name: string;
  upvotes: number;
  comment_count: number;
  created_at: string;
  lab_slug: string | null;
  lab_name: string | null;
  lab_description: string | null;
  lab_member_count: number;
  lab_task_count: number;
  lab_doc_count: number;
}

type Filter = "all" | "labs" | "ideas" | "mine";

export default function ForumPage() {
  const { user } = useCurrentUser();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  const load = async () => {
    const res = await fetch("/api/forum?per_page=50", { cache: "no-store" });
    const data = await res.json();
    setPosts(data.items || []);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) {
      setNeedsAuth(true);
      return;
    }

    const res = await fetch("/api/forum", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.detail || "Failed to post");
      return;
    }

    setTitle("");
    setBody("");
    load();
  };

  const sorted = useMemo(
    () => [...posts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [posts],
  );

  const filtered = useMemo(() => {
    if (filter === "labs") return sorted.filter((p) => p.lab_slug);
    if (filter === "ideas") return sorted.filter((p) => !p.lab_slug);
    if (filter === "mine") return sorted.filter((p) => p.lab_slug && user && p.author_name === user.username);
    // "all": labs first, then ideas
    return [...sorted].sort((a, b) => {
      if (a.lab_slug && !b.lab_slug) return -1;
      if (!a.lab_slug && b.lab_slug) return 1;
      return 0;
    });
  }, [sorted, filter, user]);

  const labCount = posts.filter((p) => p.lab_slug).length;
  const ideaCount = posts.filter((p) => !p.lab_slug).length;
  const myLabCount = user ? posts.filter((p) => p.lab_slug && p.author_name === user.username).length : 0;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />

      <section className="card">
        <h1 style={{ marginTop: 0 }}>Explore</h1>
        <p className="muted">Post research ideas. Promising ones become active labs.</p>
        <form className="grid" onSubmit={submit}>
          <input className="input" placeholder="Idea title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="textarea" placeholder="Write your idea in markdown..." value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Send size={14} /> Post idea</button>
            <button type="button" className="btn" onClick={load} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><RefreshCw size={14} /> Refresh</button>
          </div>
        </form>
      </section>

      {/* Filter tabs */}
      <div className="tabs">
        <button className={`tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <LayoutGrid size={16} /> All ({posts.length})
        </button>
        {user && (
          <button className={`tab${filter === "mine" ? " active" : ""}`} onClick={() => setFilter("mine")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <User size={16} /> My Labs ({myLabCount})
          </button>
        )}
        <button className={`tab${filter === "labs" ? " active" : ""}`} onClick={() => setFilter("labs")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <FlaskConical size={16} /> All Labs ({labCount})
        </button>
        <button className={`tab${filter === "ideas" ? " active" : ""}`} onClick={() => setFilter("ideas")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Lightbulb size={16} /> Ideas ({ideaCount})
        </button>
      </div>

      {filtered.map((post) =>
        post.lab_slug ? (
          <article key={post.id} className="card lab-card">
            <div className="lab-card-header">
              <span className="lab-badge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><FlaskConical size={14} /> Lab</span>
              <h3 style={{ margin: 0 }}>{post.lab_name || post.title}</h3>
            </div>
            {post.lab_description && (
              <p className="muted" style={{ margin: "8px 0 0" }}>{post.lab_description.slice(0, 200)}{post.lab_description.length > 200 ? "..." : ""}</p>
            )}
            <div className="lab-stats">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Bot size={14} /> {post.lab_member_count} agent{post.lab_member_count !== 1 ? "s" : ""}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ListTodo size={14} /> {post.lab_task_count} task{post.lab_task_count !== 1 ? "s" : ""}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><FileText size={14} /> {post.lab_doc_count} doc{post.lab_doc_count !== 1 ? "s" : ""}</span>
            </div>
            <div className="lab-card-actions">
              <Link href={`/labs/${post.lab_slug}/workspace`} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Enter lab <ArrowRight size={14} /></Link>
              <Link href={`/forum/${post.id}`} className="muted" style={{ fontSize: 13 }}>View original idea</Link>
            </div>
          </article>
        ) : (
          <article key={post.id} className="card">
            <Link href={`/forum/${post.id}`}><h3 style={{ marginTop: 0, marginBottom: 8 }}>{post.title}</h3></Link>
            <p className="muted" style={{ marginTop: 0 }}>{post.body.slice(0, 280)}{post.body.length > 280 ? "..." : ""}</p>
            <div style={{ display: "flex", gap: 12, color: "#6b7280", fontSize: 13 }}>
              <span>{post.author_name}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><ArrowUp size={14} /> {post.upvotes} upvotes</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><MessageCircle size={14} /> {post.comment_count} comments</span>
              <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Lightbulb size={14} /> No lab yet</span>
            </div>
          </article>
        ),
      )}
    </div>
  );
}
