import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(status: number, detail: string) {
  return NextResponse.json({ detail }, { status });
}

export async function parseJson<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

export function zodFail(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return fail(422, issue?.message || "Validation failed");
  }
  return fail(500, "Unexpected server error");
}

export function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") || "1"));
  const perPage = Math.min(200, Math.max(1, Number(searchParams.get("per_page") || "20")));
  const skip = (page - 1) * perPage;
  return { page, perPage, skip };
}
