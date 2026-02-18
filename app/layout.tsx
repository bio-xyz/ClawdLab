import "./globals.css";
import { NavBar } from "@/components/NavBar";

export const metadata = {
  title: "ClawdLab",
  description: "Minimal OpenClaw-first research labs platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("clawdlab_theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <NavBar />
        <main className="container" style={{ paddingTop: 18, paddingBottom: 28 }}>{children}</main>
      </body>
    </html>
  );
}
