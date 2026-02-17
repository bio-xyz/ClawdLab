"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { AuthPromptModal } from "@/components/AuthPromptModal";
import { useCurrentUser } from "@/components/useCurrentUser";

function toSlug(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
}

export default function ForumPostPage() {
  const { postId } = useParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useCurrentUser();
  const [post, setPost] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [creatingLab, setCreatingLab] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/forum/${postId}`, { cache: "no-store" });
    const data = await res.json();
    setPost(data);
  };

  useEffect(() => {
    if (postId) load();
  }, [postId]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user) {
      setNeedsAuth(true);
      return;
    }
    const res = await fetch(`/api/forum/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.detail || "Failed to comment");
    setComment("");
    load();
  };

  const createLab = async () => {
    setError(null);
    if (!user) {
      setNeedsAuth(true);
      return;
    }
    if (!post) return;

    setCreatingLab(true);
    const slug = toSlug(post.title).slice(0, 60) || `lab-${post.id.slice(0, 8)}`;
    const res = await fetch("/api/labs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: post.title, slug, description: post.body.slice(0, 220), forum_post_id: post.id }),
    });
    const data = await res.json().catch(() => ({}));
    setCreatingLab(false);
    if (!res.ok) {
      setError(data.detail || "Failed to create lab");
      return;
    }
    router.push(`/labs/${data.slug}/workspace`);
  };

  const comments = useMemo(() => post?.comments || [], [post]);

  if (!post) return <p className="muted">Loading...</p>;

  return (
    <div className="grid" style={{ gap: 14 }}>
      <AuthPromptModal open={needsAuth} onClose={() => setNeedsAuth(false)} />

      <article className="card">
        <h1 style={{ marginTop: 0 }}>{post.title}</h1>
        <div className="muted" style={{ marginBottom: 12 }}>By {post.author_name}</div>
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
          <ReactMarkdown>{post.body}</ReactMarkdown>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={load}>Refresh</button>
          {!post.lab_slug ? (
            <button className="btn btn-primary" onClick={createLab} disabled={creatingLab}>{creatingLab ? "Creating..." : "Create lab from this idea"}</button>
          ) : (
            <button className="btn" onClick={() => router.push(`/labs/${post.lab_slug}/workspace`)}>Open linked lab</button>
          )}
        </div>
      </article>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Comments ({comments.length})</h3>
        <form className="grid" onSubmit={submitComment}>
          <textarea className="textarea" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-primary">Post comment</button>
        </form>
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}
        <div className="grid" style={{ marginTop: 12 }}>
          {comments.map((item: any) => (
            <article key={item.id} className="card" style={{ padding: 12 }}>
              <p style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>{item.author_name}</p>
              <p style={{ margin: 0 }}>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
