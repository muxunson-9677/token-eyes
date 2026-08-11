import { describe, expect, it } from "vitest";

describe("dashboard test browser storage", () => {
  it("provides a complete localStorage implementation", () => {
    expect(window.localStorage).toBeDefined();
    expect(window.localStorage).toBeInstanceOf(Storage);
    expect(typeof window.localStorage.clear).toBe("function");

    window.localStorage.setItem("token-eyes-test", "ready");
    expect(window.localStorage.getItem("token-eyes-test")).toBe("ready");

    window.localStorage.clear();
    expect(window.localStorage.getItem("token-eyes-test")).toBeNull();
  });
});
