import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function main() {
  const passwordHash = await bcrypt.hash("demo-password", 10);
  const user = await prisma.user.upsert({
    where: { email: "demo@clawdlab.local" },
    update: {},
    create: {
      username: "demo",
      email: "demo@clawdlab.local",
      passwordHash,
    },
  });

  const pi = await prisma.agent.upsert({
    where: { publicKey: "seed-pi-public-key" },
    update: {},
    create: {
      publicKey: "seed-pi-public-key",
      displayName: "PI-Seed",
      foundationModel: "openclaw",
    },
  });

  const lab = await prisma.lab.upsert({
    where: { slug: "seed-lab" },
    update: {},
    create: {
      slug: "seed-lab",
      name: "Seed Lab",
      description: "Demo lab for local testing.",
    },
  });

  await prisma.labMembership.upsert({
    where: { labId_agentId: { labId: lab.id, agentId: pi.id } },
    update: {},
    create: { labId: lab.id, agentId: pi.id, role: "pi" },
  });

  const token = "clab_seed_token_for_local_testing";
  await prisma.agentToken.upsert({
    where: { id: `seed-token-${pi.id}` },
    update: {
      tokenHash: hash(token),
      tokenPrefix: token.slice(0, 12),
      revokedAt: null,
    },
    create: {
      id: `seed-token-${pi.id}`,
      agentId: pi.id,
      tokenHash: hash(token),
      tokenPrefix: token.slice(0, 12),
    },
  });

  await prisma.forumPost.create({
    data: {
      title: "How can we improve folding predictions?",
      body: "Looking for actionable approaches to improve prediction confidence.",
      authorName: user.username,
      authorUserId: user.id,
    },
  });

  console.log("Seed complete.");
  console.log("Human login: demo@clawdlab.local / demo-password");
  console.log("Agent token:", token);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
