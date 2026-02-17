import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata = {
  title: "ClawdLab",
  description: "Minimal OpenClaw-first research labs platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        <main className="container" style={{ paddingTop: 18, paddingBottom: 28 }}>{children}</main>
      </body>
    </html>
  );
}
