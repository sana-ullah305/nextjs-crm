"use client";

import { useCallback, useEffect, useState } from "react";
import { EntityForm, type FieldDef, type FieldErrors } from "@/components/entity-form";
import { api } from "@/lib/api-client";
import type { Deal } from "@/lib/api-client";

type Owner = { id: string; name: string; avatarColor: string };
type ContactOption = { id: string; label: string };
type CompanyOption = { id: string; name: string };

type DealFormValues = {
  name: string;
  value: string;
  currency: string;
  probability: string;
  stageId: string;
  expectedCloseDate: string;
  nextStep: string;
  ownerId: string;
  contactId: string;
  companyId: string;
  tags: string;
};

export type DealFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  deal?: Deal;
  stages: Array<{ id: string; name: string }>;
  onSave: (values: DealFormValues) => void | Promise<void>;
};

const CURRENCIES = [
  { label: "USD — US Dollar", value: "USD" },
  { label: "EUR — Euro", value: "EUR" },
  { label: "GBP — British Pound", value: "GBP" },
  { label: "CAD — Canadian Dollar", value: "CAD" },
  { label: "AUD — Australian Dollar", value: "AUD" },
] as const;

export function DealForm({ open, onOpenChange, mode, deal, stages, onSave }: DealFormProps) {
  const [owners, setOwners] = useState<Owner[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [users, contacts, companies] = await Promise.all([
        api.get<{ users: Owner[] }>("/api/users"),
        api.get<{ contacts: Array<{ id: string; firstName: string; lastName: string; email?: string }> }>(
          "/api/contacts?pageSize=200"
        ),
        api.get<{ companies: CompanyOption[] }>("/api/companies?pageSize=200"),
      ]);
      setOwners(users.users);
      setContacts(
        contacts.contacts.map((c) => ({
          id: c.id,
          label: `${c.firstName} ${c.lastName}` + (c.email ? ` (${c.email})` : ""),
        }))
      );
      setCompanies(companies.companies);
    } catch {
      // Options are convenience only; the form still works with manual IDs.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadOptions();
  }, [open, loadOptions]);

  const initialValues = useCallback(() => {
    const values: Record<string, string> = {
      name: deal?.name ?? "",
      value: deal?.value != null ? String(deal.value) : "",
      currency: deal?.currency ?? "USD",
      probability: deal?.probability != null ? String(deal.probability) : "",
      stageId: deal?.stage.id ?? "",
      expectedCloseDate: deal?.expectedCloseDate ? String(deal.expectedCloseDate).slice(0, 10) : "",
      nextStep: deal?.nextStep ?? "",
      ownerId: deal?.owner?.id ?? "",
      contactId: deal?.contact?.id ?? "",
      companyId: deal?.company?.id ?? "",
      tags: "",
    };
    return values;
  }, [deal]);

  // Reset values when the deal we are editing changes.
  useEffect(() => {
    setFormValues(initialValues());
  }, [initialValues]);

  const fields: FieldDef[] = [
    { name: "name", label: "Deal name", required: true, colSpan: 2, placeholder: "Acme — platform rollout" },
    { name: "value", label: "Value", type: "number", placeholder: "25000" },
    {
      name: "currency",
      label: "Currency",
      type: "select",
      options: CURRENCIES.map((c) => ({ label: c.label, value: c.value })),
    },
    { name: "probability", label: "Win probability (%)", type: "number", placeholder: "0" },
    {
      name: "stageId",
      label: "Stage",
      type: "select",
      options: stages.map((s) => ({ label: s.name, value: s.id })),
    },
    { name: "expectedCloseDate", label: "Expected close date", type: "date" },
    { name: "nextStep", label: "Next step", placeholder: "Send proposal" },
    {
      name: "ownerId",
      label: "Owner",
      type: "select",
      options: owners.map((o) => ({ label: o.name, value: o.id })),
    },
    {
      name: "contactId",
      label: "Contact",
      type: "select",
      options: contacts.map((c) => ({ label: c.label, value: c.id })),
    },
    {
      name: "companyId",
      label: "Company",
      type: "select",
      options: companies.map((c) => ({ label: c.name, value: c.id })),
    },
    { name: "tags", label: "Tags", placeholder: "enterprise, Q3" },
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors({});
    try {
      await onSave(formValues as DealFormValues);
    } catch (e) {
      setFormErrors(e instanceof Error ? { form: e.message } : {});
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "edit" ? "Edit deal" : "New deal";

  return (
    <EntityForm
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={mode === "create" ? deal?.pipeline.name ?? "" : undefined}
      fields={fields}
      values={formValues}
      errors={formErrors}
      submitting={submitting || loading}
      onChange={(name, value) => setFormValues((v) => ({ ...v, [name]: value }))}
      onSubmit={handleSubmit}
    />
  );
}
