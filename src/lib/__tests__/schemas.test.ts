import { describe, expect, it } from "vitest";
import {
  loginSchema,
  contactCreateSchema,
  leadCreateSchema,
  taskCreateSchema,
  dealCreateSchema,
} from "@/lib/schemas";

describe("loginSchema", () => {
  it("lowercases and trims email", () => {
    const result = loginSchema.parse({ email: "  USER@Example.COM ", password: "x" });
    expect(result.email).toBe("user@example.com");
  });

  it("rejects empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("contactCreateSchema", () => {
  it("applies defaults", () => {
    const r = contactCreateSchema.parse({ firstName: "A", lastName: "B" });
    expect(r.status).toBe("ACTIVE");
    expect(r.tags).toEqual([]);
    expect(r.phone).toBe("");
  });

  it("normalizes empty companyId to undefined", () => {
    const r = contactCreateSchema.parse({ firstName: "A", lastName: "B", companyId: "" });
    expect(r.companyId).toBeUndefined();
  });

  it("validates email format when provided", () => {
    expect(
      contactCreateSchema.safeParse({ firstName: "A", lastName: "B", email: "not-an-email" }).success
    ).toBe(false);
  });

  it("rejects invalid phone characters", () => {
    expect(
      contactCreateSchema.safeParse({ firstName: "A", lastName: "B", phone: "abc-def" }).success
    ).toBe(false);
  });

  it("allows typical phone formats", () => {
    expect(
      contactCreateSchema.safeParse({ firstName: "A", lastName: "B", phone: "+1 (555) 010-1234" })
        .success
    ).toBe(true);
  });
});

describe("leadCreateSchema", () => {
  it("requires email and names, defaults status NEW", () => {
    const r = leadCreateSchema.parse({
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
    });
    expect(r.status).toBe("NEW");
    expect(r.estimatedValue).toBe(0);
  });

  it("coerces estimatedValue from string", () => {
    const r = leadCreateSchema.parse({
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      estimatedValue: "1500",
    });
    expect(r.estimatedValue).toBe(1500);
  });
});

describe("taskCreateSchema", () => {
  it("defaults type and priority", () => {
    const r = taskCreateSchema.parse({ title: "Call back" });
    expect(r.type).toBe("TODO");
    expect(r.priority).toBe("MEDIUM");
  });

  it("rejects unknown type", () => {
    expect(taskCreateSchema.safeParse({ title: "x", type: "SMOKE_SIGNAL" }).success).toBe(false);
  });
});

describe("dealCreateSchema", () => {
  it("requires stageId and clamps value", () => {
    expect(dealCreateSchema.safeParse({ name: "D", value: 5 }).success).toBe(false);
    const r = dealCreateSchema.parse({ name: "D", stageId: "s1", value: "500" });
    expect(r.value).toBe(500);
  });
});
