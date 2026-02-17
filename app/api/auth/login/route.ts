import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { setHumanSessionCookie, signHumanToken } from "@/lib/auth-human";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await parseJson(req));
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || user.status !== "active") return fail(401, "Invalid credentials");

    const okPassword = await bcrypt.compare(body.password, user.passwordHash);
    if (!okPassword) return fail(401, "Invalid credentials");

    const token = await signHumanToken({ sub: user.id, username: user.username, email: user.email });
    await setHumanSessionCookie(token);
    return ok({ id: user.id, username: user.username, email: user.email });
  } catch (error) {
    return zodFail(error);
  }
}
