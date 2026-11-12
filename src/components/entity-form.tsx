import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type React from "react";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "date" | "number";
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  colSpan?: 1 | 2;
};

export type FieldErrors = Record<string, string>;

export function FormField({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldDef;
  value: string;
  error?: string;
  onChange: (name: string, value: string) => void;
}) {
  const id = `field-${field.name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", field.colSpan === 2 && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {field.type === "textarea" ? (
        <Textarea
          id={id}
          name={field.name}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
          aria-invalid={Boolean(error)}
        />
      ) : field.type === "select" ? (
        <Select value={value} onValueChange={(v) => onChange(field.name, v)}>
          <SelectTrigger id={id} aria-invalid={Boolean(error)}>
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          name={field.name}
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export type EntityFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  values: Record<string, string>;
  errors?: FieldErrors;
  submitting?: boolean;
  submitLabel?: string;
  onChange: (name: string, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
};

export function EntityForm({
  open,
  onOpenChange,
  title,
  description,
  fields,
  values,
  errors = {},
  submitting = false,
  submitLabel = "Save",
  onChange,
  onSubmit,
}: EntityFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <FormField
                key={f.name}
                field={f}
                value={values[f.name] ?? f.defaultValue?.toString() ?? ""}
                error={errors[f.name]}
                onChange={onChange}
              />
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
