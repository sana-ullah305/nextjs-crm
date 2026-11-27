import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, ok, parseQuery, clientIp } from "@/server/api";
import { requireApiUserWith } from "@/server/rbac";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";

const exportQuerySchema = z.object({
  pipelineId: z.string().trim().max(64).optional(),
  status: z.string().trim().max(20).optional(),
  ownerId: z.string().trim().max(64).optional(),
  q: z.string().trim().max(120).optional(),
});

function csvEscape(v: string): string {
  const cell = /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
}

export const GET = apiHandler<{}>(async (req: NextRequest) => {
  const user = await requireApiUserWith("deals:export");
  const q = parseQuery(req, exportQuerySchema);
  const where = {
    organizationId: user.organizationId,
    deletedAt: null,
    ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    ...(q.q ? { name: { contains: q.q } } : {}),
  };
  const deals = await db.deal.findMany({
    where,
    include: {
      stage: { select: { name: true, probability: true, type: true } },
      contact: { select: { firstName: true, lastName: true, email: true } },
      company: { select: { name: true } },
      owner: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });
  const header =
    "Name,Stage,Status,Value,Currency,Probability,Contact,Email,Company,Owner,Expected Close,Actual Close,Next Step";
  const rows = deals.map((d) =>
    [
      d.name,
      d.stage?.name ?? "",
      d.status,
      String(d.value),
      d.currency,
      String(d.probability),
      d.contact ? `${d.contact.firstName} ${d.contact.lastName}`.trim() : "",
      d.contact?.email ?? "",
      d.company?.name ?? "",
      d.owner?.name ?? "",
      d.expectedCloseDate ? d.expectedCloseDate.toISOString().slice(0, 10) : "",
      d.actualCloseDate ? d.actualCloseDate.toISOString().slice(0, 10) : "",
      d.nextStep ?? "",
    ]
      .map((x) => csvEscape(String(x ?? "")))
      .join(",")
  );
  await writeAudit({
    organizationId: user.organizationId,
    userId: user.id,
    action: "DEAL_EXPORT",
    ipAddress: clientIp(req),
    metadata: { count: deals.length },
  });
  return new NextResponse([header, ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deals-${Date.now()}.csv"`,
    },
  });
});
