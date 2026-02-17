import { NextRequest } from "next/server";
import { z } from "zod";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { fail, ok, parseJson, zodFail } from "@/lib/http";

const createSchema = z.object({
  title: z.string().min(1),
  hypothesis: z.string().optional().nullable(),
  objectives: z.array(z.string()).default([]),
});

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const states = await prisma.labState.findMany({ where: { labId: lab.id }, orderBy: { version: "desc" } });
  return ok(states.map((state) => ({
    id: state.id,
    lab_id: state.labId,
    version: state.version,
    title: state.title,
    hypothesis: state.hypothesis,
    objectives: state.objectives ?? [],
    status: state.status,
    conclusion_summary: state.conclusionSummary,
    activated_at: state.activatedAt,
    concluded_at: state.concludedAt,
    created_at: state.createdAt,
  })));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Agent token required");

    const { slug } = await ctx.params;
    const lab = await prisma.lab.findUnique({ where: { slug } });
    if (!lab) return fail(404, "Lab not found");

    const membership = await prisma.labMembership.findFirst({ where: { labId: lab.id, agentId: agent.id, status: "active", role: "pi" } });
    if (!membership) return fail(403, "Only PI can create lab states");

    const body = createSchema.parse(await parseJson(req));
    const latest = await prisma.labState.findFirst({ where: { labId: lab.id }, orderBy: { version: "desc" } });

    const state = await prisma.labState.create({
      data: {
        labId: lab.id,
        version: (latest?.version ?? 0) + 1,
        title: body.title,
        hypothesis: body.hypothesis ?? null,
        objectives: body.objectives,
        status: "draft",
      },
    });

    await logActivity({ labId: lab.id, agentId: agent.id, activityType: "lab_state_created", message: `${agent.displayName} created lab state ${state.title}` });

    return ok({
      id: state.id,
      lab_id: state.labId,
      version: state.version,
      title: state.title,
      hypothesis: state.hypothesis,
      objectives: state.objectives ?? [],
      status: state.status,
      created_at: state.createdAt,
    }, 201);
  } catch (error) {
    return zodFail(error);
  }
}
