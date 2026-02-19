import { NextRequest } from "next/server";
import { TaskStatus, TaskType } from "@prisma/client";
import { getAgentFromRequest } from "@/lib/auth-agent";
import { getHumanSession } from "@/lib/auth-human";
import { prisma } from "@/lib/db";
import { fail, getPagination, ok } from "@/lib/http";

const ANALYSIS_TASK_TYPES: TaskType[] = ["analysis", "deep_research"];
const TASK_STATUSES: TaskStatus[] = [
  "proposed",
  "in_progress",
  "completed",
  "voting",
  "accepted",
  "rejected",
  "superseded",
];

type ArtifactSource = "task_result" | "provider_job";

type NormalizedArtifact = {
  artifact_id: string;
  task_id: string;
  task_title: string;
  task_type: TaskType;
  task_status: TaskStatus;
  source: ArtifactSource;
  provider_job_id: string | null;
  name: string;
  type: string;
  path_or_url: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function readArtifactsFromContainer(container: unknown): Record<string, unknown>[] {
  const record = asRecord(container);
  if (!record) return [];
  const artifacts = record.artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
}

function normalizeArtifact(input: {
  artifact: Record<string, unknown>;
  index: number;
  source: ArtifactSource;
  task: { id: string; title: string; taskType: TaskType; status: TaskStatus; createdAt: Date; updatedAt: Date; completedAt: Date | null };
  providerJobId?: string;
  providerUpdatedAt?: Date;
  providerCreatedAt?: Date;
}): NormalizedArtifact {
  const { artifact, index, source, task, providerJobId, providerCreatedAt, providerUpdatedAt } = input;
  const name = pickString(artifact.name, artifact.filename, artifact.title, artifact.label) || `artifact-${index + 1}`;
  const type = pickString(artifact.type, artifact.kind, artifact.format, artifact.mime_type) || "UNKNOWN";
  const pathOrUrl = pickString(
    artifact.path,
    artifact.url,
    artifact.s3_path,
    artifact.s3_key,
    artifact.location,
    artifact.file,
    artifact.href,
  ) || "";
  const description = pickString(artifact.description, artifact.summary, artifact.caption);
  const requestedId = pickString(artifact.artifact_id, artifact.id);
  const artifactId = requestedId || `${source}:${task.id}:${providerJobId || "none"}:${index + 1}`;
  const createdAt = source === "provider_job" ? (providerCreatedAt || task.createdAt) : task.createdAt;
  const updatedAt = source === "provider_job" ? (providerUpdatedAt || task.updatedAt) : (task.completedAt || task.updatedAt);

  return {
    artifact_id: artifactId,
    task_id: task.id,
    task_title: task.title,
    task_type: task.taskType,
    task_status: task.status,
    source,
    provider_job_id: source === "provider_job" ? providerJobId || null : null,
    name,
    type,
    path_or_url: pathOrUrl,
    description: description || null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function dedupeKey(item: NormalizedArtifact) {
  return [
    item.task_id,
    item.name.toLowerCase(),
    item.type.toLowerCase(),
    item.path_or_url.toLowerCase(),
  ].join("|");
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const lab = await prisma.lab.findUnique({ where: { slug } });
  if (!lab) return fail(404, "Lab not found");

  const human = await getHumanSession();
  if (!human) {
    const agent = await getAgentFromRequest(req);
    if (!agent) return fail(401, "Authentication required");

    const membership = await prisma.labMembership.findFirst({
      where: { labId: lab.id, agentId: agent.id, status: "active" },
      select: { id: true },
    });
    if (!membership) return fail(403, "Agent membership required");
  }

  const searchParams = new URL(req.url).searchParams;
  const { page, perPage, skip } = getPagination(searchParams);
  const rawTaskType = searchParams.get("task_type");
  const rawTaskStatus = searchParams.get("task_status");

  if (rawTaskType && !ANALYSIS_TASK_TYPES.includes(rawTaskType as TaskType)) {
    return fail(422, "task_type must be analysis or deep_research");
  }
  if (rawTaskStatus && !TASK_STATUSES.includes(rawTaskStatus as TaskStatus)) {
    return fail(422, "Invalid task_status");
  }

  const tasks = await prisma.task.findMany({
    where: {
      labId: lab.id,
      taskType: rawTaskType ? (rawTaskType as TaskType) : { in: ANALYSIS_TASK_TYPES },
      ...(rawTaskStatus ? { status: rawTaskStatus as TaskStatus } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      providerJobs: {
        where: { kind: "analysis" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          normalizedResult: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  const merged: NormalizedArtifact[] = [];
  for (const task of tasks) {
    const taskArtifacts = readArtifactsFromContainer(task.result);
    for (const [index, artifact] of taskArtifacts.entries()) {
      merged.push(normalizeArtifact({ artifact, index, source: "task_result", task }));
    }

    const latestJob = task.providerJobs[0];
    if (!latestJob) continue;
    const providerArtifacts = readArtifactsFromContainer(latestJob.normalizedResult);
    for (const [index, artifact] of providerArtifacts.entries()) {
      merged.push(normalizeArtifact({
        artifact,
        index,
        source: "provider_job",
        task,
        providerJobId: latestJob.id,
        providerCreatedAt: latestJob.createdAt,
        providerUpdatedAt: latestJob.updatedAt,
      }));
    }
  }

  const deduped = new Map<string, NormalizedArtifact>();
  for (const item of merged) {
    const key = dedupeKey(item);
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, item);
      continue;
    }

    if (current.source === "provider_job" && item.source === "task_result") {
      deduped.set(key, item);
      continue;
    }

    if (item.updated_at > current.updated_at) {
      deduped.set(key, item);
    }
  }

  const all = Array.from(deduped.values()).sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
  const paged = all.slice(skip, skip + perPage);

  return ok({
    items: paged,
    total: all.length,
    page,
    per_page: perPage,
  });
}
