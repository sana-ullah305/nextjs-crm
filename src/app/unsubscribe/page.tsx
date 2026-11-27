import { Suspense } from "react";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata = {
  title: "Unsubscribe — Acme CRM",
  robots: { index: false, follow: false },
};

/**
 * Public one-click unsubscribe landing page.
 *
 * Reached from the link in sequence emails (`/unsubscribe?token=...`, built by
 * buildUnsubscribeUrl in src/server/sequences.ts). The page itself performs no
 * data access — the token is POSTed to /api/unsubscribe (the public,
 * token-authenticated endpoint) by the client form. This split keeps the page
 * statically renderable and the unsubscribe action idempotent + auditable.
 *
 * Registered as a public prefix in src/proxy.ts so the cookie-presence
 * middleware redirect never bounces an unauthenticated recipient to /login.
 */
export default function UnsubscribePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Suspense
          fallback={
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          }
        >
          <UnsubscribeForm />
        </Suspense>
      </div>
    </main>
  );
}
