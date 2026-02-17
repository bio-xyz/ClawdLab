import crypto from "node:crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(prefix = "clab"): string {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}
