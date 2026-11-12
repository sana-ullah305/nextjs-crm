export type ApiEnvelope<T> = { data: T } | { error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
    public details?: unknown
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // Non-JSON response (proxy error etc.)
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }
  if (!res.ok || payload && "error" in payload) {
    const err = payload && "error" in payload ? payload.error : null;
    throw new ApiError(
      res.status,
      err?.message ?? `Request failed (${res.status})`,
      err?.code,
      err?.details
    );
  }
  return (payload as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export function validationDetails(err: unknown): Record<string, string> {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    const out: Record<string, string> = {};
    for (const issue of err.details as Array<{ path: (string | number)[]; message: string }>) {
      const key = issue.path.join(".") || "form";
      if (!out[key]) out[key] = issue.message;
    }
    return out;
  }
  return {};
}
