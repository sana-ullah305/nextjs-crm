import { db } from "@/server/db";
import { notFound } from "next/navigation";
import { DealDetailClient } from "@/components/deal-detail-client";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deal: any = await db.deal.findFirst({
    where: { id, deletedAt: null },
    include: {
      stage: true,
      pipeline: { include: { stages: { orderBy: { position: "asc" } } } },
      contact: true,
      company: true,
      owner: { select: { id: true, name: true, avatarColor: true } },
    },
  });
  if (!deal) notFound();

  // Serialize dates to strings for client component
  const serializedDeal = {
    ...deal,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
    expectedCloseDate: deal.expectedCloseDate?.toISOString() ?? null,
    actualCloseDate: deal.actualCloseDate?.toISOString() ?? null,
    wonAt: deal.wonAt?.toISOString() ?? null,
    lostAt: deal.lostAt?.toISOString() ?? null,
    stage: deal.stage ? { ...deal.stage } : null,
    pipeline: deal.pipeline ? {
      ...deal.pipeline,
      stages: deal.pipeline.stages.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => ({ ...s })
      ),
    } : null,
    contact: deal.contact ? { ...deal.contact, createdAt: deal.contact.createdAt.toISOString(), updatedAt: deal.contact.updatedAt.toISOString(), lastContactedAt: deal.contact.lastContactedAt?.toISOString() ?? null, deletedAt: deal.contact.deletedAt?.toISOString() ?? null } : null,
    company: deal.company ? { ...deal.company, createdAt: deal.company.createdAt.toISOString(), updatedAt: deal.company.updatedAt.toISOString(), deletedAt: deal.company.deletedAt?.toISOString() ?? null } : null,
    lineItems: deal.lineItems?.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (li: any) => ({
      ...li,
      createdAt: li.createdAt.toISOString(),
      product: li.product ? { ...li.product, createdAt: li.product.createdAt.toISOString(), updatedAt: li.product.updatedAt.toISOString() } : null,
    })),
    stageHistory: [],
  };

  return <DealDetailClient initialDeal={serializedDeal} />;
}
