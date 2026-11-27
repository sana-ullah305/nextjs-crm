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

export type Product = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  sku: string | null;
  unitPrice: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PriceList = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  items?: PriceListItem[];
  _count?: { items: number };
};

export type PriceListItem = {
  id: string;
  priceListId: string;
  productId: string;
  price: number;
  currency: string;
  createdAt: string;
  product?: Product;
};

export type DealLineItem = {
  id: string;
  dealId: string;
  productId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
  product?: Product | null;
};

export type QuotationLineItem = {
  id: string;
  quotationId: string;
  productId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
  product?: Product | null;
};

export type Quotation = {
  id: string;
  organizationId: string;
  quotationNumber: string;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  status: string; // DRAFT | SENT | ACCEPTED | REJECTED | EXPIRED
  validUntil: string | null;
  subtotal: number;
  tax: number;
  total: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lineItems?: QuotationLineItem[];
  contact?: { id: string; firstName: string; lastName: string; email: string } | null;
  company?: { id: string; name: string } | null;
  deal?: { id: string; name: string } | null;
};

export type SalesOrderLineItem = {
  id: string;
  salesOrderId: string;
  productId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  createdAt: string;
  product?: Product | null;
};

export type SalesOrder = {
  id: string;
  organizationId: string;
  orderNumber: string;
  quotationId: string | null;
  dealId: string | null;
  contactId: string | null;
  companyId: string | null;
  status: string; // PENDING | CONFIRMED | COMPLETED | CANCELLED
  orderDate: string;
  subtotal: number;
  tax: number;
  total: number;
  shippingAddress: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lineItems?: SalesOrderLineItem[];
  contact?: { id: string; firstName: string; lastName: string; email: string } | null;
  company?: { id: string; name: string } | null;
  deal?: { id: string; name: string } | null;
  quotation?: { id: string; quotationNumber: string } | null;
};

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
  lineItems?: DealLineItem[];
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

export const productApi = {
  list: (params?: { q?: string; isActive?: boolean; sort?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set("q", params.q);
    if (params?.isActive !== undefined) searchParams.set("isActive", String(params.isActive));
    if (params?.sort) searchParams.set("sort", params.sort);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    return api.get<{ products: Product[]; total: number; page: number; pageSize: number }>(
      `/api/products?${searchParams.toString()}`
    );
  },
  get: (id: string) => api.get<Product>(`/api/products/${id}`),
  create: (body: unknown) => api.post<Product>("/api/products", body),
  update: (id: string, body: unknown) => api.patch<Product>(`/api/products/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/products/${id}`),
};

export const priceListApi = {
  list: (params?: { q?: string; isDefault?: boolean; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set("q", params.q);
    if (params?.isDefault !== undefined) searchParams.set("isDefault", String(params.isDefault));
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    return api.get<{ priceLists: PriceList[]; total: number; page: number; pageSize: number }>(
      `/api/pricelists?${searchParams.toString()}`
    );
  },
  get: (id: string, withItems = false) =>
    api.get<PriceList>(`/api/pricelists/${id}${withItems ? "?items=true" : ""}`),
  create: (body: unknown) => api.post<PriceList>("/api/pricelists", body),
  update: (id: string, body: unknown) => api.patch<PriceList>(`/api/pricelists/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/pricelists/${id}`),
  replaceItems: (id: string, items: unknown) =>
    api.patch<PriceList>(`/api/pricelists/${id}?action=items`, items),
};

export const dealLineItemApi = {
  list: (dealId: string) => api.get<{ lineItems: DealLineItem[] }>(`/api/deals/${dealId}/line-items`),
  create: (dealId: string, body: unknown) =>
    api.post<DealLineItem>(`/api/deals/${dealId}/line-items`, body),
  replace: (dealId: string, items: unknown) =>
    api.patch<{ lineItems: DealLineItem[] }>(`/api/deals/${dealId}/line-items?action=replace`, items),
  update: (dealId: string, lineItemId: string, body: unknown) =>
    api.patch<DealLineItem>(`/api/deals/${dealId}/line-items/${lineItemId}`, body),
  remove: (dealId: string, lineItemId: string) =>
    api.delete<{ deleted: boolean }>(`/api/deals/${dealId}/line-items/${lineItemId}`),
};

export const quotationApi = {
  list: (params?: { status?: string; dealId?: string; contactId?: string; q?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.dealId) searchParams.set("dealId", params.dealId);
    if (params?.contactId) searchParams.set("contactId", params.contactId);
    if (params?.q) searchParams.set("q", params.q);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    return api.get<{ quotations: Quotation[]; total: number; page: number; pageSize: number }>(
      `/api/quotations?${searchParams.toString()}`
    );
  },
  get: (id: string) => api.get<Quotation>(`/api/quotations/${id}`),
  create: (body: unknown) => api.post<Quotation>("/api/quotations", body),
  update: (id: string, body: unknown) => api.patch<Quotation>(`/api/quotations/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/quotations/${id}`),
  pdf: (id: string) => fetch(`/api/quotations/${id}/pdf`, { credentials: "same-origin" }),
};

export const salesOrderApi = {
  list: (params?: { status?: string; quotationId?: string; dealId?: string; contactId?: string; q?: string; page?: number; pageSize?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    if (params?.quotationId) searchParams.set("quotationId", params.quotationId);
    if (params?.dealId) searchParams.set("dealId", params.dealId);
    if (params?.contactId) searchParams.set("contactId", params.contactId);
    if (params?.q) searchParams.set("q", params.q);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    return api.get<{ salesOrders: SalesOrder[]; total: number; page: number; pageSize: number }>(
      `/api/sales-orders?${searchParams.toString()}`
    );
  },
  get: (id: string) => api.get<SalesOrder>(`/api/sales-orders/${id}`),
  create: (body: unknown) => api.post<SalesOrder>("/api/sales-orders", body),
  update: (id: string, body: unknown) => api.patch<SalesOrder>(`/api/sales-orders/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/sales-orders/${id}`),
};
