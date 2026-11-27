"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "idle" | "loading" | "done" | "error";

function UnsubscribeInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onUnsubscribe() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "GET",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "We couldn’t process your request.");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You’re unsubscribed</CardTitle>
          <CardDescription>
            You won’t receive any more emails from this sequence.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unsubscribe</CardTitle>
        <CardDescription>
          Click below to stop receiving emails from this sender.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <p className="text-sm text-destructive" role="alert">
            This link is missing its unsubscribe token. Please use the link from
            the email you received.
          </p>
        ) : (
          <div className="grid gap-4">
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="button" onClick={onUnsubscribe} disabled={status === "loading"}>
              {status === "loading" ? "Unsubscribing…" : "Unsubscribe"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UnsubscribeForm() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <UnsubscribeInner />
    </Suspense>
  );
}
