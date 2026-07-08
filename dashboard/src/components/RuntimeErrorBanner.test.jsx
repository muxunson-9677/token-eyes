import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RuntimeErrorBanner } from "./RuntimeErrorBanner.jsx";

const localApiUrlMock = vi.hoisted(() => ({
  getLastLocalApiRuntimeError: vi.fn(() => ({ code: "E_RUNTIME_BACKEND_CRASHED" })),
  retryLocalApiOrigin: vi.fn(),
  getLocalApiOrigin: vi.fn(() => Promise.resolve("http://127.0.0.1:7681")),
}));

vi.mock("../lib/native-bridge.js", () => ({
  isTauriApp: () => true,
}));

vi.mock("../lib/copy", () => ({
  copy: (key) => ({
    "runtime.error.title": "LOCAL RUNTIME UNAVAILABLE",
    "runtime.error.subtitle": "The bundled backend could not start",
    "runtime.error.hint": "Click retry to restart it.",
    "runtime.error.code_label": "CODE",
    "runtime.error.retry_action": "Retry",
  }[key] || key),
}));

vi.mock("../lib/local-api-url", () => localApiUrlMock);

describe("RuntimeErrorBanner", () => {
  it("retry actively re-resolves the local API origin", async () => {
    render(<RuntimeErrorBanner />);

    const retry = await screen.findByRole("button", { name: /Retry/i });
    await act(async () => {
      fireEvent.click(retry);
    });

    expect(localApiUrlMock.retryLocalApiOrigin).toHaveBeenCalledTimes(1);
    expect(localApiUrlMock.getLocalApiOrigin).toHaveBeenCalledTimes(1);
  });
});
