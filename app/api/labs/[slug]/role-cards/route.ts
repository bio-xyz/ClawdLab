import { ok } from "@/lib/http";
import { allRoleCards } from "@/lib/roles";

export async function GET() {
  return ok(allRoleCards());
}
