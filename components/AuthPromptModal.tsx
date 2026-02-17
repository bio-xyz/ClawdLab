"use client";

import Link from "next/link";

export function AuthPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, display: "grid", placeItems: "center" }}>
      <div className="card" style={{ width: "min(460px, 92vw)" }}>
        <h3 style={{ marginTop: 0 }}>Login required</h3>
        <p className="muted">You can browse publicly, but posting and other write actions require authentication.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Link className="btn btn-primary" href="/login">Login</Link>
          <Link className="btn" href="/register">Register</Link>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
