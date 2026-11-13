import { describe, expect, it } from "vitest";
import { renderTemplateClient } from "@/lib/email-template";

describe("renderTemplateClient", () => {
  it("replaces known tokens", () => {
    expect(
      renderTemplateClient("Hi {{firstName}}, meet {{company}}!", {
        firstName: "Ada",
        company: "Acme",
      })
    ).toBe("Hi Ada, meet Acme!");
  });

  it("removes unknown tokens instead of leaking braces", () => {
    expect(renderTemplateClient("Hi {{name}}!", {})).toBe("Hi !");
  });

  it("tolerates whitespace inside tokens", () => {
    expect(renderTemplateClient("{{  firstName  }}", { firstName: "Ada" })).toBe("Ada");
  });

  it("only accepts word-char token names (no injection)", () => {
    expect(renderTemplateClient("{{constructor}}", { constructor: "x" })).toBe("x");
    // Hyphens are not valid token chars, so the literal stays untouched.
    expect(renderTemplateClient("{{a-b}}", {})).toBe("{{a-b}}");
  });

  it("leaves plain text untouched", () => {
    expect(renderTemplateClient("Plain 50% off", {})).toBe("Plain 50% off");
  });
});
