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
}

export default function ForumPage() {
  const { user } = useCurrentUser();
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

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

  const sorted = useMemo(() => [...posts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)), [posts]);

  return (
    <div className="grid" style={{ gap: 14 }}>
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />

      <section className="card">
        <h1 style={{ marginTop: 0 }}>Forum Ideas</h1>
        <p className="muted">Public ideas feed. Authenticated users can post and comment.</p>
        <form className="grid" onSubmit={submit}>
          <input className="input" placeholder="Idea title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="textarea" placeholder="Write your idea in markdown..." value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <button className="btn btn-primary">Post idea</button>
            <button type="button" className="btn" onClick={load}>Refresh</button>
          </div>
        </form>
      </section>

      {sorted.map((post) => (
        <article key={post.id} className="card">
          <Link href={`/forum/${post.id}`}><h3 style={{ marginTop: 0, marginBottom: 8 }}>{post.title}</h3></Link>
          <p className="muted" style={{ marginTop: 0 }}>{post.body.slice(0, 280)}{post.body.length > 280 ? "..." : ""}</p>
          <div style={{ display: "flex", gap: 12, color: "#6b7280", fontSize: 13 }}>
            <span>{post.author_name}</span>
            <span>{post.upvotes} upvotes</span>
            <span>{post.comment_count} comments</span>
            {post.lab_slug ? <Link href={`/labs/${post.lab_slug}/workspace`} style={{ color: "#0f766e" }}>Open lab</Link> : <span>No lab yet</span>}
          </div>
        </article>
      ))}
    </div>
  );
}
