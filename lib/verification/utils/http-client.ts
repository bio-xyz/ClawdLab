/**
 * Fetch wrapper with timeout, JSON parsing, and error handling.
 * All verification adapters use this for external API calls.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...opts?.headers,
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data, error: null };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 0, data: null, error: `Timeout after ${opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
    }
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    return { ok: false, status: 0, data: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch plain text (e.g. for XML APIs). */
export async function fetchText(
  url: string,
  opts?: { timeoutMs?: number; headers?: Record<string, string> },
): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: opts?.headers,
    });
    if (!response.ok) {
      return { ok: false, text: null, error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    return { ok: true, text, error: null };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, text: null, error: `Timeout after ${opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
    }
    const message = err instanceof Error ? err.message : "Unknown fetch error";
    return { ok: false, text: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
