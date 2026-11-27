import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EnrollDialog, loadActiveSequences } from "@/components/enroll-dialog";

// Mock the api client
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class extends Error {
    code: string;
    status: number;
    constructor(message: string, code: string, status: number = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  validationDetails: vi.fn((e: any) => ({ field: e.message })),
}));

import { api } from "@/lib/api-client";

const mockSequences = [
  {
    id: "seq-1",
    name: "Welcome Sequence",
    isActive: true,
    steps: [
      { id: "step-1", position: 1, delayHours: 0, subjectTemplate: "Welcome!" },
      { id: "step-2", position: 2, delayHours: 24, subjectTemplate: "Day 2 check-in" },
    ],
  },
  {
    id: "seq-2",
    name: "Follow-up Sequence",
    isActive: true,
    steps: [
      { id: "step-3", position: 1, delayHours: 1, subjectTemplate: "Quick question" },
    ],
  },
];

describe("EnrollDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockResolvedValue({ sequences: mockSequences });
    (api.post as any).mockResolvedValue({});
  });

  it("renders dialog when open", () => {
    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    expect(screen.getByText("Enroll John Doe in a sequence")).toBeInTheDocument();
    expect(screen.getByText("Follow-up emails are sent automatically")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enroll/i })).toBeInTheDocument();
  });

  it("loads sequences on open", async () => {
    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
      expect(screen.getByText("Follow-up Sequence")).toBeInTheDocument();
    });
  });

  it("shows loading state while fetching sequences", () => {
    (api.get as any).mockImplementation(() => new Promise(() => {})); // Never resolves

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument(); // Actually it shows animate-pulse
    expect(screen.getByRole("button", { name: /enroll/i })).toBeDisabled();
  });

  it("shows message when no active sequences", async () => {
    (api.get as any).mockResolvedValue({ sequences: [] });

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no active sequences/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /enroll/i })).toBeDisabled();
  });

  it("enables enroll button when sequence selected", async () => {
    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enroll/i })).toBeDisabled();
    });

    // Select first sequence
    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enroll/i })).not.toBeDisabled();
    });
  });

  it("enrolls contact and shows success notice", async () => {
    const onOpenChange = vi.fn();
    const onEnrolled = vi.fn();

    render(
      <EnrollDialog
        open={true}
        onOpenChange={onOpenChange}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
        onEnrolled={onEnrolled}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enroll/i })).not.toBeDisabled();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/sequences/seq-1/enroll", {
        contactId: "contact-1",
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/was enrolled/i)).toBeInTheDocument();
      expect(onEnrolled).toHaveBeenCalled();
    });

    // Wait for auto-close
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }, { timeout: 2000 });
  });

  it("enrolls lead with leadId parameter", async () => {
    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="lead"
        recordId="lead-1"
        recordName="Jane Lead"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/api/sequences/seq-1/enroll", {
        leadId: "lead-1",
      });
    });
  });

  it("shows error when already enrolled", async () => {
    const apiError = new (eval("require('@/lib/api-client').ApiError"))(
      "Already enrolled",
      "ALREADY_ENROLLED",
      400
    );
    (api.post as any).mockRejectedValue(apiError);

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/already enrolled/i)).toBeInTheDocument();
    });
  });

  it("shows validation errors for 400 responses", async () => {
    const apiError = new (eval("require('@/lib/api-client').ApiError"))(
      "Invalid data",
      "VALIDATION_ERROR",
      400
    );
    (api.post as any).mockRejectedValue(apiError);
    (eval("require('@/lib/api-client').validationDetails") as any).mockReturnValue({
      field: "Validation failed",
    });

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(screen.getByText("Validation failed")).toBeInTheDocument();
    });
  });

  it("shows generic error for other failures", async () => {
    (api.post as any).mockRejectedValue(new Error("Network error"));

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/enrollment failed/i)).toBeInTheDocument();
    });
  });

  it("disables enroll button while submitting", async () => {
    let resolvePost: (value: any) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });
    (api.post as any).mockReturnValue(postPromise);

    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Welcome Sequence")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Welcome Sequence"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enroll/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /enrolling/i })).toBeDisabled();
    });

    await act(async () => {
      resolvePost!({});
    });
  });

  it("closes on cancel button click", () => {
    const onOpenChange = vi.fn();

    render(
      <EnrollDialog
        open={true}
        onOpenChange={onOpenChange}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows step count and first delay in sequence list", async () => {
    render(
      <EnrollDialog
        open={true}
        onOpenChange={vi.fn()}
        recordType="contact"
        recordId="contact-1"
        recordName="John Doe"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("2 steps")).toBeInTheDocument();
      expect(screen.getByText("first email after 0h")).toBeInTheDocument();
      expect(screen.getByText("1 steps")).toBeInTheDocument();
      expect(screen.getByText("first email after 1h")).toBeInTheDocument();
    });
  });
});
