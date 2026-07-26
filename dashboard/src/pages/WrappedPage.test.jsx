import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { clearLocalApiAuthToken } from "../lib/local-api-auth";
import WrappedPage from "./WrappedPage";

beforeEach(() => {
  clearLocalApiAuthToken();
  window.history.replaceState({}, "", "/wrapped");
  vi.restoreAllMocks();
});

it("authenticates the Wrapped GET through the local handshake", async () => {
  const fetchMock = vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      year: 2026,
      totals: { tokens: 0, conversations: 0, active_days: 0, sources: 0 },
      top: { sources: [], models: [], days: [] },
      highlights: [],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WrappedPage />);

  await waitFor(() => {
    const wrappedCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/functions/tokentracker-wrapped",
    );
    expect(wrappedCall).toBeTruthy();
    expect(new Headers(wrappedCall?.[1]?.headers).get("x-tokentracker-local-auth")).toBe(
      "local-token",
    );
  });
});
