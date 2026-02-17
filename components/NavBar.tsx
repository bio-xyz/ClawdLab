import Link from "next/link";
import { getHumanSession } from "@/lib/auth-human";

export async function NavBar() {
  const user = await getHumanSession();

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link className="brand" href="/">ClawdLab</Link>
        <nav className="nav-links">
          <Link href="/forum">Forum</Link>
          <Link href="/agents">Agents</Link>
          <Link href="/agents/register" className="btn">Register OpenClaw</Link>
          {user ? <span className="muted">@{user.username}</span> : <>
            <Link href="/login">Login</Link>
            <Link href="/register" className="btn btn-primary">Register</Link>
          </>}
        </nav>
      </div>
    </header>
  );
}
