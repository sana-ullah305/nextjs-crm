"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api-client";
import {
  findDuplicateCandidatesClient,
  type DuplicateCandidate,
} from "@/lib/duplicate-search";
import { normalizeCompany } from "@/lib/dedupe-normalize";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type EntityType = "contact" | "lead" | "company";

type MergePreview = {
  source: PreviewRecord;
  target: PreviewRecord;
  fields: { field: string; source: string; target: string; differs: boolean }[];
  relations: Record<string, number>;
  recommendedSurvivor: "source" | "target";
  tags?: { source: string[]; target: string[]; combined: string[] };
};

type PreviewRecord = {
  type: string;
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  domain?: string;
  title?: string;
  status?: string;
  owner: string | null;
  createdAt: string;
};

type MergeResult = {
  type?: string;
  sourceId: string;
  targetId: string;
  moved: Record<string, number>;
  tagsMerged?: number;
};

const PERSON_CHOICE_FIELDS = ["email", "firstName", "lastName", "phone", "title", "status"] as const;
const COMPANY_CHOICE_FIELDS = [
  "name",
  "domain",
  "industry",
  "size",
  "phone",
  "website",
  "address",
  "city",
  "state",
  "country",
] as const;

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  title: "Job title",
  status: "Status",
  company: "Company",
  name: "Company name",
  domain: "Domain",
  industry: "Industry",
  size: "Size",
  website: "Website",
  address: "Address",
  city: "City",
  state: "State / Region",
  country: "Country",
  owner: "Owner",
  createdAt: "Created",
};

/**
 * Display name for a preview/candidate record. Falls back through the
 * natural fields so malformed rows never render an empty label.
 */
function recordName(r: {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
}): string {
  const person = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
  return person || r.name || r.email || "Unnamed record";
}

type CompanyCandidate = {
  id: string;
  name: string;
  domain: string;
  industry: string;
  createdAt: string;
  score: number;
  matchReasons: string[];
};

/**
 * Client-side duplicate company finder: pulls the org's companies and scores
 * them against the source by normalized name (exact = 100) and shared domain
 * (>= 60). Mirrors the threshold semantics of the person duplicate finder.
 */
async function findCompanyCandidatesClient(
  sourceId: string,
  name: string,
  domain: string
): Promise<CompanyCandidate[]> {
  const target = normalizeCompany(name);
  const targetDomain = domain.trim().toLowerCase();
  const res = await api.get<{ companies: CompanyCandidate[] }>(
    "/api/companies?pageSize=100&sort=name"
  );
  const out: CompanyCandidate[] = [];
  for (const c of res.companies) {
    if (c.id === sourceId) continue;
    let score = 0;
    const reasons: string[] = [];
    if (target && normalizeCompany(c.name) === target) {
      score += 100;
      reasons.push("name_exact");
    }
    const cd = (c.domain ?? "").trim().toLowerCase();
    if (targetDomain && cd && cd === targetDomain) {
      score += 60;
      reasons.push("domain_exact");
    }
    if (score >= 60) {
      out.push({ ...c, score: Math.min(score, 100), matchReasons: reasons });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

type MergeDirection = {
  loserId: string;
  winnerId: string;
  winnerType: EntityType;
  kind?: "lead-into-contact" | "contact-into-contact" | "lead-into-lead";
};

/**
 * Direction of the actual POST call. The merge endpoints always archive their
 * source and keep their target, but the preview may recommend either record
 * as survivor — so the recommended survivor becomes the target and the other
 * record becomes the source.
 */
function mergeDirection(
  sourceType: EntityType,
  sourceId: string,
  target: { id: string; type?: string },
  preview: MergePreview
): MergeDirection {
  const keepsSource = preview.recommendedSurvivor === "source";
  const loserType = keepsSource ? target.type ?? sourceType : sourceType;
  const winnerType = keepsSource ? sourceType : target.type ?? sourceType;
  const base: MergeDirection = {
    loserId: keepsSource ? target.id : sourceId,
    winnerId: keepsSource ? sourceId : target.id,
    winnerType: winnerType as EntityType,
  };
  if (sourceType !== "company") {
    const kind =
      loserType === "lead" && winnerType === "contact"
        ? "lead-into-contact"
        : loserType === "lead" && winnerType === "lead"
          ? "lead-into-lead"
          : "contact-into-contact";
    base.kind = kind;
  }
  return base;
}

export function MergeDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: EntityType;
  sourceId: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"candidates" | "preview" | "confirm">("candidates");
  const [candidates, setCandidates] = useState<
    (DuplicateCandidate | CompanyCandidate)[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<DuplicateCandidate | CompanyCandidate | null>(
    null
  );
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const choiceFields: readonly string[] =
    sourceType === "company" ? COMPANY_CHOICE_FIELDS : PERSON_CHOICE_FIELDS;

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (sourceType === "company") {
        const c = await api.get<{ id: string; name: string; domain: string }>(
          `/api/companies/${sourceId}`
        );
        setCandidates(
          await findCompanyCandidatesClient(sourceId, c.name, c.domain)
        );
      } else if (sourceType === "contact") {
        const c = await api.get<{
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          company: { name: string } | null;
        }>(`/api/contacts/${sourceId}`);
        setCandidates(
          await findDuplicateCandidatesClient({
            id: sourceId,
            type: "contact",
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            companyName: c.company?.name ?? "",
          })
        );
      } else {
        const l = await api.get<{
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          companyName: string;
        }>(`/api/leads/${sourceId}`);
        setCandidates(
          await findDuplicateCandidatesClient({
            id: sourceId,
            type: "lead",
            firstName: l.firstName,
            lastName: l.lastName,
            email: l.email,
            companyName: l.companyName,
          })
        );
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load duplicates");
    } finally {
      setLoading(false);
    }
  }, [sourceId, sourceType]);

  useEffect(() => {
    if (!open) return;
    setStep("candidates");
    setTarget(null);
    setPreview(null);
    setChoices({});
    setError("");
    setNotice("");
    void loadCandidates();
  }, [open, loadCandidates]);

  async function openPreview(candidate: DuplicateCandidate | CompanyCandidate) {
    setTarget(candidate);
    setError("");
    setLoading(true);
    try {
      let data: MergePreview;
      if (sourceType === "company") {
        const params = new URLSearchParams({ id: sourceId, intoId: candidate.id });
        data = await api.get<MergePreview>(
          `/api/merge/companies/preview?${params.toString()}`
        );
      } else {
        const params = new URLSearchParams({
          type: sourceType,
          id: sourceId,
          intoId: candidate.id,
          targetType: (candidate as DuplicateCandidate).type,
        });
        data = await api.get<MergePreview>(`/api/merge/preview?${params.toString()}`);
      }
      setPreview(data);
      // Default every conflicting choice to the recommended survivor's value.
      const next: Record<string, string> = {};
      for (const f of data.fields) {
        if (f.differs && choiceFields.includes(f.field)) {
          next[f.field] = data.recommendedSurvivor === "source" ? f.source : f.target;
        }
      }
      setChoices(next);
      setStep("preview");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load merge preview");
    } finally {
      setLoading(false);
    }
  }

  async function confirmMerge() {
    if (!target || !preview) return;
    const dir = mergeDirection(sourceType, sourceId, target, preview);
    setSubmitting(true);
    setError("");
    try {
      let result: MergeResult;
      if (sourceType === "company") {
        result = await api.post<MergeResult>("/api/merge/companies", {
          sourceId: dir.loserId,
          targetId: dir.winnerId,
          fieldChoices: Object.keys(choices).length > 0 ? choices : undefined,
        });
      } else {
        result = await api.post<MergeResult>("/api/merge", {
          type: dir.kind,
          sourceId: dir.loserId,
          targetId: dir.winnerId,
          fieldChoices: Object.keys(choices).length > 0 ? choices : undefined,
        });
      }
      const moved = Object.values(result.moved).reduce((a, b) => a + b, 0);
      const noun = dir.winnerType === "company" ? "company" : dir.winnerType;
      setNotice(
        `Merged. ${moved} related record${moved === 1 ? "" : "s"} moved to the surviving ${noun}.`
      );
      setTimeout(() => {
        onOpenChange(false);
        router.refresh();
      }, 1400);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Merge failed");
    } finally {
      setSubmitting(false);
    }
  }

  const conflictFields = preview
    ? preview.fields.filter((f) => f.differs && choiceFields.includes(f.field))
    : [];
  const totalRelations = preview
    ? Object.values(preview.relations).reduce((a, b) => a + b, 0)
    : 0;
  const direction =
    preview && target ? mergeDirection(sourceType, sourceId, target, preview) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" /> Find and merge duplicates
          </DialogTitle>
          <DialogDescription>
            {step === "candidates" &&
              "Likely duplicates are scored against this record. Pick one to review a full merge preview."}
            {step === "preview" &&
              target &&
              `Comparing this ${sourceType} with ${recordName(target)}. Nothing changes until you confirm.`}
            {step === "confirm" &&
              "Choose which value survives for each conflicting field, then merge."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
            role="status"
          >
            {notice}
          </p>
        )}

        {step === "candidates" &&
          (loading ? (
            <div className="h-40 animate-pulse rounded-md bg-muted" />
          ) : candidates.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No duplicate candidates found for this record.
            </p>
          ) : (
            <div className="grid gap-2" role="list" aria-label="Duplicate candidates">
              {candidates.map((c) => {
                const type = ((c as DuplicateCandidate).type ?? "company") as EntityType;
                const email = (c as DuplicateCandidate).email;
                const created = (c as DuplicateCandidate).createdAt;
                return (
                  <button
                    key={`${type}:${c.id}`}
                    type="button"
                    role="listitem"
                    onClick={() => void openPreview(c)}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-left hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {recordName(c)}{" "}
                        <span className="font-normal text-muted-foreground">({type})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {type === "company"
                          ? (c as CompanyCandidate).domain || "no domain"
                          : email || "no email"}
                        {created ? ` · created ${formatDateTime(created)}` : ""}
                      </p>
                    </div>
                    <Badge
                      variant={
                        c.score === 100 ? "destructive" : c.score >= 55 ? "warning" : "secondary"
                      }
                    >
                      {c.score}% match
                    </Badge>
                  </button>
                );
              })}
            </div>
          ))}

        {step === "preview" && preview && target && (
          <div className="space-y-4">
            <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <strong className="text-foreground">
                {preview.recommendedSurvivor === "target"
                  ? recordName(preview.target)
                  : recordName(preview.source)}
              </strong>{" "}
              is recommended as the survivor (older record keeps its history).
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>This {sourceType}</TableHead>
                  <TableHead className="w-6" />
                  <TableHead>Other {sourceType}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.fields.map((f) => (
                  <TableRow key={f.field}>
                    <TableCell className="text-xs font-medium text-muted-foreground">
                      {FIELD_LABELS[f.field] ?? f.field}
                    </TableCell>
                    <TableCell className={cn("text-sm", f.differs && "font-medium")}>
                      {f.source || "—"}
                    </TableCell>
                    <TableCell>
                      {f.differs ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label="Differs" />
                      ) : (
                        <span className="text-muted-foreground">=</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-sm", f.differs && "font-medium")}>
                      {f.target || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {preview.tags && (
              <p className="text-xs text-muted-foreground">
                Tags after merge:{" "}
                <strong className="text-foreground">
                  {preview.tags.combined.length > 0
                    ? preview.tags.combined.join(", ")
                    : "(none)"}
                </strong>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {totalRelations} related record{totalRelations === 1 ? "" : "s"} will move to
              the surviving record.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("candidates")}>
                Back
              </Button>
              <Button onClick={() => setStep("confirm")}>Continue to merge</Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && preview && target && direction && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                The other record is archived after merging. This cannot be undone.
              </span>
            </div>
            {conflictFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No conflicting fields — the survivor keeps its current values.
              </p>
            ) : (
              <div className="grid gap-3" role="group" aria-label="Field survivor choices">
                {conflictFields.map((f) => (
                  <div key={f.field} className="rounded-md border border-border p-3">
                    <p className="text-xs font-semibold text-foreground">
                      {FIELD_LABELS[f.field] ?? f.field}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary">
                        <input
                          type="radio"
                          className="h-4 w-4"
                          name={`choice-${f.field}`}
                          value={f.source}
                          checked={choices[f.field] === f.source}
                          onChange={() => setChoices((c) => ({ ...c, [f.field]: f.source }))}
                          aria-label={`Keep ${f.source || "empty"} for ${FIELD_LABELS[f.field]}`}
                        />
                        <span className="truncate">{f.source || "— (empty)"}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary">
                        <input
                          type="radio"
                          className="h-4 w-4"
                          name={`choice-${f.field}`}
                          value={f.target}
                          checked={choices[f.field] === f.target}
                          onChange={() => setChoices((c) => ({ ...c, [f.field]: f.target }))}
                          aria-label={`Keep ${f.target || "empty"} for ${FIELD_LABELS[f.field]}`}
                        />
                        <span className="truncate">{f.target || "— (empty)"}</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                <strong className="text-foreground">
                  {recordName(direction.loserId === sourceId ? preview.source : preview.target)}
                </strong>{" "}
                is archived and everything moves to{" "}
                <strong className="text-foreground">
                  {recordName(direction.winnerId === sourceId ? preview.source : preview.target)}
                </strong>
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("preview")} disabled={submitting}>
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void confirmMerge()}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Merging…
                  </>
                ) : (
                  "Merge records"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
