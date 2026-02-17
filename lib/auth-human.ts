import { cookies } from "next/headers";
import { JWTPayload, SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "clawdlab_session";
const JWT_SECRET = process.env.JWT_SECRET_KEY || "dev-secret-change-me";
const secret = new TextEncoder().encode(JWT_SECRET);

interface HumanTokenPayload extends JWTPayload {
  sub: string;
  username: string;
  email: string;
}

export async function signHumanToken(payload: HumanTokenPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function setHumanSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearHumanSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getHumanSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const verified = await jwtVerify(token, secret);
    const payload = verified.payload as HumanTokenPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "active") return null;
    return user;
  } catch {
    return null;
  }
}
