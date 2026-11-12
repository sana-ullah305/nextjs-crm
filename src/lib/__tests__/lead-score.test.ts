import { describe, expect, it } from "vitest";
import { scoreLead, scoreBand } from "@/lib/lead-score";

describe("lead scoring", () => {
  it("scores a fully-enriched referral lead near the top", () => {
    const score = scoreLead({
      email: "a@b.com",
      phone: "+1 555 0100",
      companyName: "Acme",
      estimatedValue: 80000,
      sourceName: "Referral",
      hasFollowUp: true,
    });
    expect(score).toBe(100);
    expect(scoreBand(score)).toBe("HOT");
  });

  it("scores a bare cold lead low", () => {
    const score = scoreLead({
      email: "a@b.com",
      phone: "",
      companyName: "",
      estimatedValue: 0,
      sourceName: "",
      hasFollowUp: false,
    });
    expect(score).toBe(20); // only email
    expect(scoreBand(score)).toBe("COLD");
  });

  it("is clamped to 0-100", () => {
    const maxed = scoreLead({
      email: "a@b.com",
      phone: "1",
      companyName: "x",
      estimatedValue: 999999,
      sourceName: "Referral",
      hasFollowUp: true,
    });
    expect(maxed).toBeLessThanOrEqual(100);
  });

  it("weighs deal size in tiers", () => {
    const base = (v: number) =>
      scoreLead({
        email: "a@b.com",
        phone: "",
        companyName: "",
        estimatedValue: v,
        sourceName: "",
        hasFollowUp: false,
      });
    expect(base(50000)).toBeGreaterThan(base(9000));
    expect(base(9000)).toBeGreaterThan(base(500));
  });

  it("bands scores correctly", () => {
    expect(scoreBand(75)).toBe("HOT");
    expect(scoreBand(45)).toBe("WARM");
    expect(scoreBand(10)).toBe("COLD");
  });
});
