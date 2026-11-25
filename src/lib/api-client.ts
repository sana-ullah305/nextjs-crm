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

export type Deal = {
  id: string;
  name: string;
  value: number;
  currency: string;
  status: string; // OPEN | WON | LOST
  probability: number;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string;
  lostReasonId: string | null;
  nextStep: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  stage: { id: string; name: string; position: number; type: string; probability: number };
  pipeline: {
    id: string;
    name: string;
    stages: { id: string; name: string; position: number; type: string; probability: number }[];
  };
  contact: { id: string; firstName: string; lastName: string; email: string; avatarColor: string } | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  stageHistory: Array<{
    id: string;
    fromStage: { id: string; name: string } | null;
    toStage: { id: string; name: string; type: string };
    user: { id: string; name: string; avatarColor: string };
    at: string;
    wonAtSnapshot: string | null;
    lostAtSnapshot: string | null;
    actualCloseDateSnapshot: string | null;
  }>;
};

export type LostReason = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
};

export type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description: string;
  occurredAt: string;
  user: { id: string; name: string; avatarColor: string };
};

export type EmailItem = {
  id: string;
  subject: string;
  recipientEmail: string;
  recipientName: string;
  status: string;
  createdAt: string;
  user: { name: string };
};

export type TaskItem = {
  id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assignedUser: { id: string; name: string; avatarColor: string } | null;
};

export const dealApi = {
  get: (id: string) => api.get<Deal>(`/api/deals/${id}`),
  update: (id: string, body: unknown) => api.patch<Deal>(`/api/deals/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/deals/${id}`),
  move: (id: string, body: { stageId: string; lostReasonId?: string }) =>
    api.patch<Deal>(`/api/deals/${id}?action=move`, body),
};

export const lostReasonApi = {
  list: () => api.get<{ lostReasons: LostReason[] }>("/api/settings/lost-reasons"),
};
