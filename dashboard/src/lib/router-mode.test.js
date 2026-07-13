import { describe, expect, it } from "vitest";
import { shouldUseHashRouter } from "./router-mode.js";

describe("shouldUseHashRouter", () => {
  it.each(["1", "true", "TRUE"])("enables hash routing for %s", (value) => {
    expect(shouldUseHashRouter(value)).toBe(true);
  });

  it.each([undefined, "", "0", "false"])("keeps browser routing for %s", (value) => {
    expect(shouldUseHashRouter(value)).toBe(false);
  });
});
