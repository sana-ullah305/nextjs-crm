import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { EntityForm, type FieldDef } from "@/components/entity-form";

const mockFields: FieldDef[] = [
  { name: "firstName", label: "First Name", type: "text", required: true, placeholder: "John" },
  { name: "lastName", label: "Last Name", type: "text", required: true, placeholder: "Doe" },
  { name: "email", label: "Email", type: "text", required: true, placeholder: "john@example.com" },
  { name: "bio", label: "Bio", type: "textarea", placeholder: "Tell us about yourself" },
  { name: "status", label: "Status", type: "select", options: [
    { label: "Active", value: "active" },
    { label: "Inactive", value: "inactive" },
  ], required: true },
  { name: "startDate", label: "Start Date", type: "date" },
  { name: "score", label: "Score", type: "number", placeholder: "100" },
];

describe("EntityForm", () => {
  it("renders form with all fields", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("Create Contact")).toBeInTheDocument();
    expect(screen.getByLabelText("First Name *")).toBeInTheDocument();
    expect(screen.getByLabelText("Last Name *")).toBeInTheDocument();
    expect(screen.getByLabelText("Email *")).toBeInTheDocument();
    expect(screen.getByLabelText("Bio")).toBeInTheDocument();
    expect(screen.getByLabelText("Status *")).toBeInTheDocument();
    expect(screen.getByLabelText("Start Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Score")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        description="Fill in the contact details"
        fields={mockFields}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("Fill in the contact details")).toBeInTheDocument();
  });

  it("populates fields with initial values", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Edit Contact"
        fields={mockFields}
        values={{
          firstName: "Jane",
          lastName: "Smith",
          email: "jane@example.com",
          status: "active",
        }}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("Jane")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Smith")).toBeInTheDocument();
    expect(screen.getByDisplayValue("jane@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("active")).toBeInTheDocument();
  });

  it("uses defaultValue when value not provided", () => {
    const fieldsWithDefaults: FieldDef[] = [
      { name: "country", label: "Country", type: "text", defaultValue: "USA" },
      { name: "role", label: "Role", type: "select", options: [
        { label: "Admin", value: "admin" },
        { label: "User", value: "user" },
      ], defaultValue: "user" },
    ];

    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create"
        fields={fieldsWithDefaults}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue("USA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("user")).toBeInTheDocument();
  });

  it("calls onChange when field value changes", () => {
    const onChange = vi.fn();
    
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        onChange={onChange}
        onSubmit={vi.fn()}
      />
    );

    const firstNameInput = screen.getByLabelText("First Name *");
    fireEvent.change(firstNameInput, { target: { value: "John" } });

    expect(onChange).toHaveBeenCalledWith("firstName", "John");
  });

  it("calls onSubmit when form submitted", async () => {
    const onSubmit = vi.fn();
    
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const saveButton = screen.getByRole("button", { name: /save/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(onSubmit).toHaveBeenCalled();
  });

  it("shows field errors when provided", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        errors={{ email: "Invalid email format", firstName: "Required" }}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText("Invalid email format")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByLabelText("Email *")).toHaveAttribute("aria-invalid", "true");
  });

  it("disables submit button when submitting", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        submitting={true}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("closes on cancel button click", () => {
    const onOpenChange = vi.fn();
    
    render(
      <EntityForm
        open={true}
        onOpenChange={onOpenChange}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders select options correctly", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const selectTrigger = screen.getByLabelText("Status *");
    fireEvent.click(selectTrigger);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("uses custom submit label", () => {
    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Create Contact"
        fields={mockFields}
        values={{}}
        submitLabel="Create Contact"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /create contact/i })).toBeInTheDocument();
  });

  it("handles colSpan for full-width fields", () => {
    const fieldsWithColSpan: FieldDef[] = [
      { name: "fullWidth", label: "Full Width", type: "textarea", colSpan: 2 },
      { name: "halfWidth", label: "Half Width", type: "text" },
    ];

    render(
      <EntityForm
        open={true}
        onOpenChange={vi.fn()}
        title="Test"
        fields={fieldsWithColSpan}
        values={{}}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    // Both fields should render
    expect(screen.getByLabelText("Full Width")).toBeInTheDocument();
    expect(screen.getByLabelText("Half Width")).toBeInTheDocument();
  });
});
