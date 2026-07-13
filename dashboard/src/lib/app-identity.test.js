import { describe, expect, it } from "vitest";
import { applyDocumentIdentity } from "./app-identity.js";

describe("applyDocumentIdentity", () => {
  it("replaces a legacy document title with the Token Eyes app name", () => {
    const target = { title: "CC Switch" };
    applyDocumentIdentity(target);
    expect(target.title).toBe("Token Eyes");
  });
});
