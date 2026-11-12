"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KanbanSquare, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api, ApiError, validationDetails } from "@/lib/api-client";
import { formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";

type Deal = {
  id: string;
  name: string;
  value: number;
  status: string;
  probability: number;
  expectedCloseDate: string | null;
  nextStep: string;
  contact: { id: string; firstName: string; lastName: string; avatarColor: string } | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  stage: { id: string; name: string; position: number; type: string; probability: number };
};

type Pipeline = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: { id: string; name: string; position: number; type: string; probability: number }[];
};

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const movedRef = useRef(false);

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? pipelines[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pipes = await api.get<{ pipelines: Pipeline[] }>("/api/settings/pipelines");
      setPipelines(pipes.pipelines);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load pipelines");
    }
  }, []);

  const loadDeals = useCallback(async () => {
    if (!activePipeline) return;
    try {
      const data = await api.get<{ deals: Deal[] }>(`/api/deals?pipelineId=${activePipeline.id}&status=OPEN&pageSize=200`);
      setDeals(data.deals);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load deals");
    } finally {
      setLoading(false);
    }
  }, [activePipeline]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pipelines.length > 0 && !activePipelineId) {
      setActivePipelineId(pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]!.id);
    }
  }, [pipelines, activePipelineId]);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  async function moveDeal(dealId: string, stageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage.id === stageId) return;
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? {
              ...d,
              stage:
                activePipeline?.stages.find((s) => s.id === stageId) ?? d.stage,
            }
          : d
      )
    );
    try {
      await api.patch(`/api/deals/${dealId}?action=move`, { stageId });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Move failed");
      await loadDeals();
    }
  }

  useEffect(() => {
    function onDropGlobal() {
      setDraggingId(null);
      setDragOverStage(null);
    }
    window.addEventListener("dragend", onDropGlobal);
    return () => window.removeEventListener("dragend", onDropGlobal);
  }, []);

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await api.post("/api/deals", {
        name: formValues.name,
        value: Number(formValues.value || 0),
        stageId: formValues.stageId || activePipeline?.stages[0]?.id,
        contactId: formValues.contactId,
        expectedCloseDate: formValues.expectedCloseDate || undefined,
        nextStep: formValues.nextStep,
      });
      setFormOpen(false);
      setFormValues({});
      await loadDeals();
    } catch (e) {
      setFormErrors(validationDetails(e));
    } finally {
      setSubmitting(false);
    }
  }

  const fields: FieldDef[] = [
    { name: "name", label: "Deal name", required: true, colSpan: 2, placeholder: "Acme — platform rollout" },
    { name: "value", label: "Value (USD)", type: "number", placeholder: "25000" },
    {
      name: "stageId",
      label: "Stage",
      type: "select",
      options: (activePipeline?.stages ?? [])
        .filter((s) => s.type === "OPEN")
        .map((s) => ({ label: s.name, value: s.id })),
    },
    { name: "expectedCloseDate", label: "Expected close date", type: "date" },
    { name: "nextStep", label: "Next step", placeholder: "Send proposal" },
  ];

  if (loading) {
    return <div className="h-96 animate-pulse rounded-lg bg-muted" />;
  }

  if (!activePipeline) {
    return (
      <EmptyState
        icon={Settings2}
        title="No pipelines configured"
        description="An admin needs to create a pipeline with stages in Settings."
      />
    );
  }

  const openStages = activePipeline.stages
    .slice()
    .sort((a, b) => a.position - b.position)
    .filter((s) => s.type === "OPEN");
  const wonCount = deals.filter((d) => d.status === "WON").length;

  const totalByStage = (stageId: string) =>
    deals.filter((d) => d.stage.id === stageId).reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Drag deals between stages. {deals.length} open deals ·{" "}
            {formatCompactCurrency(deals.reduce((s, d) => s + d.value, 0))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            value={activePipelineId}
            onChange={(e) => setActivePipelineId(e.target.value)}
            aria-label="Select pipeline"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> New deal
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-1 gap-4 overflow-x-auto scroll-thin pb-4">
        {openStages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage.id === stage.id);
          return (
            <div
              key={stage.id}
              data-stage-id={stage.id}
              data-drag-over={dragOverStage === stage.id}
              className="kanban-column flex w-72 min-w-72 flex-col rounded-lg border border-border bg-muted/40"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverStage(stage.id);
              }}
              onDragLeave={() => setDragOverStage((s) => (s === stage.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                const dealId = e.dataTransfer.getData("text/deal-id") || draggingId;
                setDragOverStage(null);
                setDraggingId(null);
                if (dealId) void moveDeal(dealId, stage.id);
              }}
            >
              <div className="flex items-center justify-between border-b border-border p-3">
                <div>
                  <p className="text-sm font-semibold">{stage.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {stageDeals.length} · {formatCompactCurrency(totalByStage(stage.id))}
                  </p>
                </div>
                <Badge variant="outline">{stage.probability}%</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto scroll-thin p-2">
                {stageDeals.map((deal) => (
                  <Card
                    key={deal.id}
                    data-deal-id={deal.id}
                    data-dragging={draggingId === deal.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggingId(deal.id);
                      e.dataTransfer.setData("text/deal-id", deal.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="kanban-card cursor-grab gap-1 p-3 active:cursor-grabbing"
                  >
                    <p className="text-sm font-medium">{deal.name}</p>
                    <p className="text-sm font-semibold text-primary">{formatCompactCurrency(deal.value)}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{deal.company?.name ?? "—"}</span>
                      {deal.owner && <Avatar name={deal.owner.name} color={deal.owner.avatarColor} size="sm" />}
                    </div>
                    {deal.nextStep && <p className="line-clamp-1 text-xs text-muted-foreground">Next: {deal.nextStep}</p>}
                  </Card>
                ))}
                {stageDeals.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">Drop deals here</p>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex w-72 min-w-72 flex-col items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
          <KanbanSquare className="mb-2 h-6 w-6" />
          <p className="text-xs">Closed-won and closed-lost stages live in reports</p>
        </div>
      </div>

      <EntityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title="New deal"
        description={`Adding to ${activePipeline.name}`}
        fields={fields}
        values={formValues}
        errors={formErrors}
        submitting={submitting}
        onChange={(name, value) => setFormValues((v) => ({ ...v, [name]: value }))}
        onSubmit={createDeal}
      />
    </div>
  );
}
