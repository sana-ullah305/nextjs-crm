"use client";

import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
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
import { api, ApiError } from "@/lib/api-client";
import { renderTemplateClient } from "@/lib/email-template";

export type ComposeEmailProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo: { email: string; name?: string };
  contactId?: string;
  leadId?: string;
  dealId?: string;
  templateVars?: Record<string, string>;
  onSent?: () => void;
};

type Template = { id: string; name: string; subject: string; body: string };

/**
 * Email compose dialog. Pulls org email templates so users can start from a
 * canned message and merge {{tokens}} with the record's context. Sends via
 * POST /api/emails which records history + activity.
 */
export function ComposeEmail({
  open,
  onOpenChange,
  defaultTo,
  contactId,
  leadId,
  dealId,
  templateVars = {},
  onSent,
}: ComposeEmailProps) {
  const [to, setTo] = useState(defaultTo.email);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo.email);
    setSubject("");
    setBody("");
    setError("");
    api
      .get<{ templates: Template[] }>("/api/settings/email-templates")
      .then((d) => setTemplates(d.templates))
      .catch(() => setTemplates([]));
  }, [open, defaultTo.email]);

  function applyTemplate(templateId: string) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setSubject(renderTemplateClient(t.subject, templateVars));
    setBody(renderTemplateClient(t.body, templateVars));
  }

  async function send() {
    setSubmitting(true);
    setError("");
    try {
      await api.post("/api/emails", {
        to,
        toName: defaultTo.name,
        subject,
        body,
        contactId: contactId ?? undefined,
        leadId: leadId ?? undefined,
        dealId: dealId ?? undefined,
      });
      onOpenChange(false);
      onSent?.();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_NOT_CONFIGURED") {
          setError(err.message);
        } else if (err.code === "EMAIL_SEND_FAILED") {
          setError(`Delivery failed: ${err.message}`);
        } else {
          setError(err.message);
        }
      } else {
        setError("Failed to send email");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSend = useMemo(
    () => to.includes("@") && subject.trim() && body.trim() && !submitting,
    [to, subject, body, submitting]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose email</DialogTitle>
          <DialogDescription>
            Sent through your organization&#39;s SMTP settings. Every send is
            recorded on the record&#39;s activity timeline.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-to">To</Label>
            <Input
              id="compose-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {templates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-template">Start from template</Label>
              <Select onValueChange={applyTemplate}>
                <SelectTrigger id="compose-template">
                  <SelectValue placeholder="Pick a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick follow-up"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-body">Message</Label>
            <Textarea
              id="compose-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Write your message…"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={!canSend}>
            <Send className="mr-1 h-4 w-4" />
            {submitting ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
