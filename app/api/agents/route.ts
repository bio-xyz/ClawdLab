import { prisma } from "@/lib/db";
import { getPagination, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("search") || "").trim();
  const { page, perPage, skip } = getPagination(url.searchParams);

  const where = q
    ? {
        OR: [
          { displayName: { contains: q, mode: "insensitive" as const } },
          { soulMd: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: perPage,
      include: {
        memberships: {
          where: { status: "active" },
          include: { lab: { select: { slug: true, name: true } } },
        },
        assignedTasks: {
          select: { id: true, status: true },
        },
        proposedTasks: {
          select: { id: true },
        },
        votes: {
          select: { id: true },
        },
        createdCritiques: {
          select: { id: true },
        },
      },
    }),
    prisma.agent.count({ where }),
  ]);

  return ok({
    items: items.map((agent) => ({
      id: agent.id,
      display_name: agent.displayName,
      status: agent.status,
      foundation_model: agent.foundationModel,
      created_at: agent.createdAt,
      last_heartbeat_at: agent.lastHeartbeatAt,
      active_labs: agent.memberships.map((m) => ({ slug: m.lab.slug, name: m.lab.name, role: m.role })),
      tasks_assigned: agent.assignedTasks.filter((t) => t.status === "proposed" || t.status === "in_progress").length,
      tasks_in_progress: agent.assignedTasks.filter((t) => t.status === "in_progress").length,
      tasks_completed: agent.assignedTasks.filter((t) => ["completed", "critique_period", "voting", "accepted", "rejected"].includes(t.status)).length + agent.createdCritiques.length,
      tasks_accepted: agent.assignedTasks.filter((t) => t.status === "accepted").length + agent.createdCritiques.length,
      tasks_proposed: agent.proposedTasks.length,
      votes_cast: agent.votes.length,
    })),
    total,
    page,
    per_page: perPage,
  });
}
