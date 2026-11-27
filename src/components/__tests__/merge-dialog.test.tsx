import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MergeDialog } from "@/components/merge-dialog";

// Mock the api client and duplicate search
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/duplicate-search", () => ({
  findDuplicateCandidatesClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { api } from "@/lib/api-client";
import { findDuplicateCandidatesClient } from "@/lib/duplicate-search";

const mockCandidates = [
  {
    id: "dup-1",
    type: "contact" as const,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    companyName: "Acme Inc",
    score: 85,
    createdAt: "2024-01-15T10:00:00Z",
  },
];

const mockPreview = {
  source: {
    type: "contact" as const,
    id: "src-1",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.com",
    phone: "555-1234",
    company: "Acme Inc",
    title: "Manager",
    status: "active",
    owner: "Admin",
    createdAt: "2024-01-10T10:00:00Z",
  },
  target: {
    type: "contact" as const,
    id: "dup-1",
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "555-5678",
    company: "Acme Inc",
    title: "Director",
    status: "active",
    owner: "Admin",
    createdAt: "2024-01-15T10:00:00Z",
  },
  fields: [
    { field: "email", source: "jane@example.com", target: "john.doe@example.com", differs: true },
    { field: "firstName", source: "Jane", target: "John", differs: true },
    { field: "lastName", source: "Smith", target: "Doe", differs: true },
    { field: "phone", source: "555-1234", target: "555-5678", differs: true },
    { field: "title", source: "Manager", target: "Director", differs: true },
    { field: "status", source: "active", target: "active", differs: false },
  ],
  relations: { activities: 2, notes: 1, tasks: 0, deals: 1, sentEmails: 3, inboundEmails: 2, leads: 0 },
  recommendedSurvivor: "target" as const,
};

describe("MergeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders candidates step when opened", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue(mockCandidates);
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Find and merge duplicates")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("85% match")).toBeInTheDocument();
    });
  });

  it("shows no candidates message when empty", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue([]);
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No duplicate candidates found for this record.")).toBeInTheDocument();
    });
  });

  it("navigates to preview step when candidate clicked", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue(mockCandidates);
    (api.get as any).mockResolvedValue(mockPreview);
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("John Doe"));
    });

    await waitFor(() => {
      expect(screen.getByText("Comparing this contact with John Doe")).toBeInTheDocument();
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
      expect(screen.getByText("john.doe@example.com")).toBeInTheDocument();
    });
  });

  it("navigates to confirm step and shows field choices", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue(mockCandidates);
    (api.get as any).mockResolvedValue(mockPreview);
    (api.post as any).mockResolvedValue({ moved: mockPreview.relations });
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("John Doe"));
    });

    await waitFor(() => {
      expect(screen.getByText("Continue to merge")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Continue to merge"));
    });

    await waitFor(() => {
      expect(screen.getByText("The other record is archived after merging")).toBeInTheDocument();
      expect(screen.getByText("Keep jane@example.com for Email")).toBeInTheDocument();
      expect(screen.getByText("Keep john.doe@example.com for Email")).toBeInTheDocument();
    });
  });

  it("submits merge and closes on success", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue(mockCandidates);
    (api.get as any).mockResolvedValue(mockPreview);
    (api.post as any).mockResolvedValue({ moved: mockPreview.relations });
    
    const onOpenChange = vi.fn();
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={onOpenChange}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("John Doe"));
    });

    await waitFor(() => {
      expect(screen.getByText("Continue to merge")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Continue to merge"));
    });

    await waitFor(() => {
      expect(screen.getByText("Merge records")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Merge records"));
    });

    await waitFor(() => {
      expect(screen.getByText("Merged.")).toBeInTheDocument();
    });

    // Wait for the auto-close
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }, { timeout: 2000 });
  });

  it("shows error on merge failure", async () => {
    (findDuplicateCandidatesClient as any).mockResolvedValue(mockCandidates);
    (api.get as any).mockResolvedValue(mockPreview);
    (api.post as any).mockRejectedValue(new Error("Merge failed"));
    
    render(
      <MergeDialog
        open={true}
        onOpenChange={vi.fn()}
        sourceType="contact"
        sourceId="src-1"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("John Doe"));
    });

    await waitFor(() => {
      expect(screen.getByText("Continue to merge")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Continue to merge"));
    });

    await waitFor(() => {
      expect(screen.getByText("Merge records")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Merge records"));
    });

    await waitFor(() => {
      expect(screen.getByText("Merge failed")).toBeInTheDocument();
    });
  });
});
