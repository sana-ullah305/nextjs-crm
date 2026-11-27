import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { CommandPalette } from "@/components/command-palette";

// Mock fetch globally
global.fetch = vi.fn();

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders search button", () => {
    render(<CommandPalette />);
    expect(screen.getByLabelText("Open global search")).toBeInTheDocument();
  });

  it("opens palette on Cmd+K", async () => {
    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /global search/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i)).toBeInTheDocument();
    });
  });

  it("closes palette on Escape", async () => {
    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("shows help text when query is too short", async () => {
    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i);
    
    await act(async () => {
      fireEvent.change(input, { target: { value: "a" } });
    });

    await waitFor(() => {
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
    });
  });

  it("shows results when search returns data", async () => {
    const mockResults = {
      data: {
        query: "john",
        results: {
          contacts: [{ id: "c1", label: "John Doe", sub: "john@example.com", href: "/contacts/c1" }],
          companies: [],
          leads: [],
          deals: [],
          tasks: [],
        },
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults,
    });

    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i);
      fireEvent.change(input, { target: { value: "john" } });
    });

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("john@example.com")).toBeInTheDocument();
      expect(screen.getByText("Contacts")).toBeInTheDocument();
    });
  });

  it("shows no results message when search returns empty", async () => {
    const mockResults = {
      data: {
        query: "nonexistent",
        results: {
          contacts: [],
          companies: [],
          leads: [],
          deals: [],
          tasks: [],
        },
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults,
    });

    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i);
      fireEvent.change(input, { target: { value: "nonexistent" } });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText(/no results for/i)).toBeInTheDocument();
    });
  });

  it("shows error message when search fails", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i);
      fireEvent.change(input, { target: { value: "test" } });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText(/search failed/i)).toBeInTheDocument();
    });
  });

  it("navigates with keyboard arrows and enter", async () => {
    const mockResults = {
      data: {
        query: "test",
        results: {
          contacts: [
            { id: "c1", label: "Contact One", sub: "one@example.com", href: "/contacts/c1" },
            { id: "c2", label: "Contact Two", sub: "two@example.com", href: "/contacts/c2" },
          ],
          companies: [],
          leads: [],
          deals: [],
          tasks: [],
        },
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults,
    });

    render(<CommandPalette />);
    
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });

    await waitFor(() => {
      const input = screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i);
      fireEvent.change(input, { target: { value: "test" } });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText("Contact One")).toBeInTheDocument();
      expect(screen.getByText("Contact Two")).toBeInTheDocument();
    });

    // Test arrow down navigation
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i), {
        key: "ArrowDown",
      });
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText(/search contacts, companies, leads, deals, tasks/i), {
        key: "ArrowDown",
      });
    });

    // Second item should be active
    await waitFor(() => {
      expect(screen.getByText("Contact Two")).toHaveAttribute("aria-selected", "true");
    });
  });
});
