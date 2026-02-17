import { getHumanSession } from "@/lib/auth-human";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const user = await getHumanSession();
  if (!user) return fail(401, "Not authenticated");
  return ok({ id: user.id, username: user.username, email: user.email });
}
