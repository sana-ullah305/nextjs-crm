"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  Handshake,
  Search,
  StickyNote,
  Target,
  User,
} from "lucide-react";
import { cn } from "@/lib/cn";

type Result = { id: string; label: string; sub: string; href: string };

type SearchResponse = {
  query: string;
  results: {
    contacts: Result[];
    companies: Result[];
    leads: Result[];
    deals: Result[];
    tasks: Result[];
  };
};

type SectionKey = keyof SearchResponse["results"];

const SECTION_META: Record<SectionKey, { label: string; icon: typeof User }> = {
  contacts: { label: "Contacts", icon: User },
  companies: { label: "Companies", icon: Building2 },
  leads: { label: "Leads", icon: Target },
  deals: { label: "Deals", icon: Handshake },
  tasks: { label: "Tasks", icon: StickyNote },
};

const ORDER: SectionKey[] = ["contacts", "companies", "leads", "deals", "tasks"];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse["results"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ⌘K / Ctrl+K toggles the palette; Escape closes it.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) {
      // Dialog mount happens in the same tick; wait a frame for focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
      setResults(null);
      setActive(0);
      setError("");
      abortRef.current?.abort();
    }
  }, [open]);

  // Debounced search — wait 250ms after the last keystroke.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // api-client has no signal support; fetch directly with abort.
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const payload = (await res.json()) as { data: SearchResponse };
        setResults(payload.data.results);
        setActive(0);
        setError("");
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("Search failed. Try again.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, open]);

  const flat = results
    ? ORDER.flatMap((section) =>
        results[section].map((r) => ({ ...r, section }))
      )
    : [];

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  // Keyboard navigation across the flattened result list.
  function onInputKeydown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) go(item.href);
    }
  }

  let runningIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open global search"
        className="hidden items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="rounded-md p-1.5 hover:bg-muted md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Global search"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKeydown}
                placeholder="Search contacts, companies, leads, deals, tasks…"
                aria-label="Search term"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="command-palette-results"
                aria-activedescendant={flat[active] ? `cmd-${flat[active].id}` : undefined}
              />
              {loading && (
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  …
                </span>
              )}
              <kbd className="hidden shrink-0 select-none rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
                ESC
              </kbd>
            </div>

            <div
              id="command-palette-results"
              className="max-h-[55vh] overflow-y-auto scroll-thin"
            >
              {q.trim().length < 2 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search across the CRM.
                </p>
              )}
              {error && (
                <p className="px-4 py-8 text-center text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              {!error && q.trim().length >= 2 && !loading && !results && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No matches. Check the spelling or try a shorter term.
                </p>
              )}
              {!error && results && flat.length === 0 && !loading && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No results for “{q.trim()}”.
                </p>
              )}
              {results &&
                flat.length > 0 &&
                ORDER.map((section) => {
                  const items = results[section];
                  if (items.length === 0) return null;
                  const Icon = SECTION_META[section].icon;
                  return (
                    <div key={section}>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {SECTION_META[section].label}
                      </p>
                      {items.map((item) => {
                        runningIndex++;
                        const idx = runningIndex;
                        const isActive = idx === active;
                        return (
                          <button
                            key={item.id}
                            id={`cmd-${item.id}`}
                            type="button"
                            onClick={() => go(item.href)}
                            onMouseEnter={() => setActive(idx)}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                              isActive ? "bg-accent" : "hover:bg-accent/50"
                            )}
                            aria-selected={isActive}
                            role="option"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{item.label}</span>
                              {item.sub && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {item.sub}
                                </span>
                              )}
                            </span>
                            {isActive && (
                              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
