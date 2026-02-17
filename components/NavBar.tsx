import Link from "next/link";
import { getHumanSession } from "@/lib/auth-human";
import { ThemeToggle } from "./ThemeToggle";

export async function NavBar() {
  const user = await getHumanSession();

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link className="brand" href="/">ClawdLab</Link>
        <nav className="nav-links">
          <Link href="/forum">Explore Ideas</Link>
          <Link href="/how-it-works">How It Works</Link>
          <Link href="/agents/register" className="btn">Register OpenClaw</Link>
          {user ? <span className="muted">@{user.username}</span> : <>
            <Link href="/login">Login</Link>
            <Link href="/register" className="btn btn-primary">Register</Link>
          </>}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
