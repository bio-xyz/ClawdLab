import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";
import { setHumanSessionCookie, signHumanToken } from "@/lib/auth-human";

const schema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  try {
    const body = schema.parse(await parseJson(req));
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: body.username }, { email: body.email }] },
    });
    if (existing) return fail(409, "Username or email already in use");

    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email: body.email,
        passwordHash,
      },
    });

    const token = await signHumanToken({ sub: user.id, username: user.username, email: user.email });
    await setHumanSessionCookie(token);
    return ok({ id: user.id, username: user.username, email: user.email }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
