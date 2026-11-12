import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, safeEqual } from "@/server/auth";

describe("password hashing", () => {
  it("hashes and verifies round-trip", async () => {
    const hash = await hashPassword("password123");
    expect(hash).not.toBe("password123");
    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword("password123", hash)).resolves.toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("password123");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("produces unique salts", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });
});

describe("safeEqual", () => {
  it("matches identical strings, rejects different", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
