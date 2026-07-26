import { beforeEach, expect, it, vi } from "vitest";
import {
  clearCloudDeviceSession,
  setCloudSyncEnabled,
} from "./cloud-sync-prefs";
import { clearLocalApiAuthToken } from "./local-api-auth";

beforeEach(() => {
  clearLocalApiAuthToken();
  clearCloudDeviceSession();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("authenticates the local cloud-sync preference mirror through the handshake", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  setCloudSyncEnabled(true);

  await vi.waitFor(() => {
    const mirrorCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/functions/tokentracker-cloud-sync-pref",
    );
    expect(mirrorCall).toBeTruthy();
    expect(new Headers(mirrorCall?.[1]?.headers).get("x-tokentracker-local-auth")).toBe(
      "local-token",
    );
  });
});
