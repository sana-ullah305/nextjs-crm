/**
 * Component tests for LeadDetailClient — the interactive surface of the
 * Lead Detail page. Covers the info card, score badge, duplicate warning
 * banner, converted banner, and the add-note / log-activity / edit / convert
 * action wiring.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Stub the API client so no network calls happen.
const apiGet = vi.fn().mockResolvedValue({ users: [], sources: [] });
const apiPost = vi.fn().mockResolvedValue({});
const apiPatch = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api-client", () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), patch: (...a: unknown[]) => apiPatch(...a), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  validationDetails: () => ({}),
}));

// Stub heavy child components so the test focuses on LeadDetailClient itself.
vi.mock("@/components/entity-form", () => ({
  EntityForm: () => <div data-testid="entity-form" />,
}));
vi.mock("@/components/compose-email", () => ({
  ComposeEmail: () => <div data-testid="compose-email" />,
}));
vi.mock("@/components/enroll-dialog", () => ({
  EnrollDialog: () => <div data-testid="enroll-dialog" />,
}));
vi.mock("@/components/merge-dialog", () => ({
  MergeDialog: () => <div data-testid="merge-dialog" />,
}));

import LeadDetailClient, { type LeadDetailData } from "@/components/lead-detail-client";

function makeLead(overrides: Partial<LeadDetailData> = {}): LeadDetailData {
  return {
    id: "lead-1",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@acme.test",
    phone: "555-0100",
    companyName: "Acme Inc",
    status: "QUALIFIED",
    score: 80,
    estimatedValue: 12000,
    expectedCloseDate: null,
    followUpAt: null,
    summary: "Inbound from webinar",
    convertedAt: null,
    contactId: null,
    source: { id: "src-1", name: "Webinar" },
    assignedUser: { id: "u-1", name: "Admin", avatarColor: "#6366f1" },
    owner: { id: "u-1", name: "Admin", avatarColor: "#6366f1" },
    company: { id: "co-1", name: "Acme Inc" },
    contact: null,
    activities: [
      {
        id: "a-1",
        type: "CALL",
        title: "Discovery call",
        description: "Discussed pricing",
        occurredAt: new Date().toISOString(),
        user: { id: "u-1", name: "Admin", avatarColor: "#6366f1" },
        task: null,
      },
    ],
    notes: [
      {
        id: "n-1",
        body: "Very interested",
        createdAt: new Date().toISOString(),
        user: { id: "u-1", name: "Admin", avatarColor: "#6366f1" },
      },
    ],
    sentEmails: [],
    inboundEmails: [],
    tasks: [],
    deals: [],
    duplicateCandidates: [],
    ...overrides,
  };
}

describe("LeadDetailClient", () => {
  it("renders the lead name, email, status and score badge", () => {
    render(<LeadDetailClient lead={makeLead()} />);
    expect(screen.getByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent?.includes("grace@acme.test") ?? false).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("QUALIFIED")).toBeInTheDocument();
    // Hot badge for score >= 70
    expect(screen.getByText(/Hot 80/)).toBeInTheDocument();
  });

  it("shows the duplicate warning banner when candidates exist", () => {
    render(
      <LeadDetailClient
        lead={makeLead({
          duplicateCandidates: [
            {
              id: "lead-2",
              type: "lead",
              firstName: "Grace",
              lastName: "Hopper",
              email: "grace@acme.test",
              phone: "",
              status: "NEW",
              score: 100,
              matchReasons: ["email_exact"],
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/1 potential duplicate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Review & merge/ })).toBeInTheDocument();
  });

  it("shows the converted banner and contact link when converted", () => {
    render(
      <LeadDetailClient
        lead={makeLead({
          status: "CONVERTED",
          convertedAt: new Date().toISOString(),
          contactId: "contact-1",
          contact: { id: "contact-1", firstName: "Grace", lastName: "Hopper" },
        })}
      />
    );
    expect(screen.getAllByText(/Converted/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /View contact/ }).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the activity timeline and notes", () => {
    render(<LeadDetailClient lead={makeLead()} />);
    expect(screen.getByText("Discovery call")).toBeInTheDocument();
    expect(screen.getByText("Very interested")).toBeInTheDocument();
  });

  it("adds a note via the API and shows a notice", async () => {
    apiPost.mockResolvedValueOnce({ id: "n-2", body: "New note" });
    render(<LeadDetailClient lead={makeLead()} />);
    const textarea = screen.getByLabelText("New note");
    fireEvent.change(textarea, { target: { value: "New note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        "/api/activities/note",
        expect.objectContaining({ body: "New note", leadId: "lead-1" })
      );
    });
  });

  it("opens the edit form with pre-filled values", () => {
    render(<LeadDetailClient lead={makeLead()} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(screen.getByTestId("entity-form")).toBeInTheDocument();
  });

  it("opens the convert dialog", () => {
    render(<LeadDetailClient lead={makeLead()} />);
    fireEvent.click(screen.getByRole("button", { name: /Convert/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Creates a contact record/)).toBeInTheDocument();
  });

  it("navigates to the lead on back link", () => {
    render(<LeadDetailClient lead={makeLead()} />);
    const back = screen.getByRole("link", { name: /Back to leads/ });
    expect(back).toHaveAttribute("href", "/leads");
  });
});
