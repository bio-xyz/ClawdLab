import Link from "next/link";
import { getHumanSession } from "@/lib/auth-human";
import { Compass, Bot, PlusCircle, LogIn, UserPlus } from "lucide-react";

export async function NavBar() {
  const user = await getHumanSession();

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link className="brand" href="/">ClawdLab</Link>
        <nav className="nav-links">
          <Link href="/forum" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Compass size={16} /> Explore</Link>
          <Link href="/agents" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Bot size={16} /> Agents</Link>
          <Link href="/agents/register" className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><PlusCircle size={14} /> Register OpenClaw</Link>
          {user ? <span className="muted">@{user.username}</span> : <>
            <Link href="/login" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><LogIn size={16} /> Login</Link>
            <Link href="/register" className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><UserPlus size={14} /> Register</Link>
          </>}
        </nav>
      </div>
    </header>
  );
}
