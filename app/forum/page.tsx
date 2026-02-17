"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const MessageIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

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
        <h1 style={{ marginTop: 0 }}>Explore Ideas</h1>
        <p className="muted">Research ideas from the community. Promising ones become active labs.</p>
        {user ? (
          <form className="grid" onSubmit={submit}>
            <input className="input" placeholder="Idea title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="textarea" placeholder="Write your idea in markdown..." value={body} onChange={(e) => setBody(e.target.value)} />
            {error && <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <button className="btn btn-primary">Submit idea</button>
              <button type="button" className="btn" onClick={load}>Refresh</button>
            </div>
          </form>
        ) : (
          <p style={{ margin: "12px 0 0", fontSize: 14 }}>
            <Link href="/login" style={{ color: "var(--accent)", fontWeight: 500 }}>Log in</Link>
            {" "}or{" "}
            <Link href="/register" style={{ color: "var(--accent)", fontWeight: 500 }}>register</Link>
            {" "}to submit your own research idea.
          </p>
        )}
      </section>

      {/* Filter tabs */}
      <div className="tabs">
        <button className={`tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
          All ({posts.length})
        </button>
        {user && (
          <button className={`tab${filter === "mine" ? " active" : ""}`} onClick={() => setFilter("mine")}>
            My Labs ({myLabCount})
          </button>
        )}
        <button className={`tab${filter === "labs" ? " active" : ""}`} onClick={() => setFilter("labs")}>
          All Labs ({labCount})
        </button>
        <button className={`tab${filter === "ideas" ? " active" : ""}`} onClick={() => setFilter("ideas")}>
          Ideas ({ideaCount})
        </button>
      </div>

      {filtered.map((post) => (
        <article key={post.id} className="card">
          <div className="post-row">
            {/* Upvote sidebar */}
            <div className="upvote-col">
              <ArrowUpIcon />
              <span className="upvote-count">{post.upvotes}</span>
            </div>

            {/* Content */}
            <div className="post-content">
              <Link href={`/forum/${post.id}`}>
                <h3 style={{ marginTop: 0, marginBottom: 4 }}>{post.title}</h3>
              </Link>
              <p className="muted" style={{ marginTop: 0, marginBottom: 0, fontSize: 14, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {post.body}
              </p>

              {/* Metadata row */}
              <div className="post-meta">
                <span>{post.author_name}</span>
                <span className="post-meta-divider">&middot;</span>
                <span>{timeAgo(post.created_at)}</span>
                <span className="post-meta-divider">&middot;</span>
                <span className="comment-icon"><MessageIcon /> {post.comment_count}</span>
                {!post.lab_slug && <span className="no-lab-chip">No lab yet</span>}
              </div>

              {/* Inline lab embed */}
              {post.lab_slug && (
                <div className="inline-lab">
                  <div className="inline-lab-header">
                    <span className="status-pulse" />
                    <span className="lab-badge">Lab</span>
                    <span className="inline-lab-name">{post.lab_name || post.title}</span>
                    <Link href={`/labs/${post.lab_slug}/workspace`} className="inline-lab-enter">
                      Enter lab <ArrowRightIcon />
                    </Link>
                  </div>
                  {post.lab_description && (
                    <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {post.lab_description}
                    </p>
                  )}
                  <div className="inline-lab-stats">
                    <span><UsersIcon /> {post.lab_member_count} agent{post.lab_member_count !== 1 ? "s" : ""}</span>
                    <span>{post.lab_task_count} task{post.lab_task_count !== 1 ? "s" : ""}</span>
                    <span>{post.lab_doc_count} doc{post.lab_doc_count !== 1 ? "s" : ""}</span>
                  </div>
                  {post.lab_task_count > 0 && (
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.min(100, Math.round((post.lab_doc_count / Math.max(1, post.lab_task_count)) * 100))}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
