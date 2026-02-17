import { ok } from "@/lib/http";
import { clearHumanSessionCookie } from "@/lib/auth-human";

export async function POST() {
  await clearHumanSessionCookie();
  return ok({ ok: true });
}
