import { describe, expect, it } from "vitest";
import {
  campaignCreateSchema,
  campaignUpdateSchema,
  campaignMemberCreateSchema,
  campaignMemberUpdateSchema,
  campaignListQuerySchema,
  campaignMemberListQuerySchema,
} from "@/lib/schemas";

describe("campaignCreateSchema", () => {
  it("requires name, applies defaults", () => {
    const r = campaignCreateSchema.parse({ name: "Q4 Campaign" });
    expect(r.name).toBe("Q4 Campaign");
    expect(r.status).toBe("PLANNING");
    expect(r.budget).toBe(0);
    expect(r.cost).toBe(0);
    expect(r.description).toBe("");
  });

  it("accepts valid status values", () => {
    for (const status of ["PLANNING", "ACTIVE", "COMPLETED", "ON_HOLD"]) {
      const r = campaignCreateSchema.parse({ name: "Test", status });
      expect(r.status).toBe(status);
    }
  });

  it("rejects invalid status", () => {
    expect(campaignCreateSchema.safeParse({ name: "Test", status: "INVALID" }).success).toBe(false);
  });

  it("parses dates", () => {
    const r = campaignCreateSchema.parse({
      name: "Test",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(r.startDate).toBe("2026-01-01");
    expect(r.endDate).toBe("2026-12-31");
  });

  it("coerces budget and cost from strings", () => {
    const r = campaignCreateSchema.parse({ name: "Test", budget: "5000", cost: "1200" });
    expect(r.budget).toBe(5000);
    expect(r.cost).toBe(1200);
  });

  it("rejects negative budget", () => {
    expect(campaignCreateSchema.safeParse({ name: "Test", budget: -1 }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(campaignCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("campaignUpdateSchema", () => {
  it("allows partial updates", () => {
    const r = campaignUpdateSchema.parse({ status: "ACTIVE" });
    expect(r.status).toBe("ACTIVE");
    expect(r.name).toBeUndefined();
  });

  it("allows clearing dates with null", () => {
    const r = campaignUpdateSchema.parse({ startDate: "" });
    expect(r.startDate).toBeUndefined();
  });
});

describe("campaignMemberCreateSchema", () => {
  it("requires exactly one of leadId, contactId, dealId", () => {
    expect(
      campaignMemberCreateSchema.safeParse({ leadId: "lead1" }).success
    ).toBe(true);
    expect(
      campaignMemberCreateSchema.safeParse({ contactId: "contact1" }).success
    ).toBe(true);
    expect(
      campaignMemberCreateSchema.safeParse({ dealId: "deal1" }).success
    ).toBe(true);
  });

  it("rejects when none provided", () => {
    expect(campaignMemberCreateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects when multiple provided", () => {
    expect(
      campaignMemberCreateSchema.safeParse({ leadId: "lead1", contactId: "contact1" }).success
    ).toBe(false);
    expect(
      campaignMemberCreateSchema.safeParse({ leadId: "lead1", dealId: "deal1" }).success
    ).toBe(false);
    expect(
      campaignMemberCreateSchema.safeParse({ contactId: "contact1", dealId: "deal1" }).success
    ).toBe(false);
    expect(
      campaignMemberCreateSchema.safeParse({ leadId: "lead1", contactId: "contact1", dealId: "deal1" }).success
    ).toBe(false);
  });

  it("defaults status to ADDED", () => {
    const r = campaignMemberCreateSchema.parse({ leadId: "lead1" });
    expect(r.status).toBe("ADDED");
  });

  it("accepts valid status values", () => {
    for (const status of ["ADDED", "ENGAGED", "CONVERTED", "LOST"]) {
      const r = campaignMemberCreateSchema.parse({ leadId: "lead1", status });
      expect(r.status).toBe(status);
    }
  });

  it("rejects invalid status", () => {
    expect(campaignMemberCreateSchema.safeParse({ leadId: "lead1", status: "INVALID" }).success).toBe(false);
  });
});

describe("campaignMemberUpdateSchema", () => {
  it("requires status", () => {
    expect(campaignMemberUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid status values", () => {
    for (const status of ["ADDED", "ENGAGED", "CONVERTED", "LOST"]) {
      const r = campaignMemberUpdateSchema.parse({ status });
      expect(r.status).toBe(status);
    }
  });
});

describe("campaignListQuerySchema", () => {
  it("applies defaults", () => {
    const r = campaignListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
    expect(r.sort).toBe("recent");
  });

  it("accepts valid sort values", () => {
    for (const sort of ["recent", "name", "budget"]) {
      const r = campaignListQuerySchema.parse({ sort });
      expect(r.sort).toBe(sort);
    }
  });
});

describe("campaignMemberListQuerySchema", () => {
  it("applies defaults", () => {
    const r = campaignMemberListQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(20);
  });
});
