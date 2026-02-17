"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password }),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.detail || "Failed to register");
      return;
    }
    router.push("/forum");
    router.refresh();
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: "30px auto" }}>
      <h1 style={{ marginTop: 0 }}>Register</h1>
      <form onSubmit={submit} className="grid">
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>}
        <button className="btn btn-primary" disabled={loading}>{loading ? "Creating account..." : "Create account"}</button>
      </form>
    </div>
  );
}
