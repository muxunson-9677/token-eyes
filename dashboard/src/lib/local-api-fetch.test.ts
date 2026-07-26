import { beforeEach, expect, it, vi } from "vitest";
import { fetchAuthenticatedLocalApi } from "./local-api-fetch";

const {
  getLocalApiAuthHeadersMock,
  clearLocalApiAuthTokenMock,
} = vi.hoisted(() => ({
  getLocalApiAuthHeadersMock: vi.fn(),
  clearLocalApiAuthTokenMock: vi.fn(),
}));

vi.mock("./local-api-auth", () => ({
  clearLocalApiAuthToken: clearLocalApiAuthTokenMock,
  getLocalApiAuthHeaders: getLocalApiAuthHeadersMock,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  clearLocalApiAuthTokenMock.mockClear();
  getLocalApiAuthHeadersMock
    .mockReset()
    .mockResolvedValue({ "x-tokentracker-local-auth": "local-token" });
});

it("replays a body Request from a fresh clone only for a marked auth-layer 401", async () => {
  getLocalApiAuthHeadersMock
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "expired-token" })
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "current-token" });
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), window.location.href), init);
    bodies.push(await request.text());
    const current = request.headers.get("x-tokentracker-local-auth") === "current-token";
    return new Response("{}", {
      status: current ? 200 : 401,
      headers: current ? undefined : { "X-TokenTracker-Local-Auth-Required": "1" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const body = JSON.stringify({ native: true });
  const request = new Request(`${window.location.origin}/api/auth-bridge/verifier`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const response = await fetchAuthenticatedLocalApi(request);

  expect(response.status).toBe(200);
  expect(bodies).toEqual([body, body]);
  expect(clearLocalApiAuthTokenMock).toHaveBeenCalledTimes(1);
  expect(getLocalApiAuthHeadersMock).toHaveBeenCalledTimes(2);
});

it("returns an unmarked business 401 without replaying the request", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);

  const response = await fetchAuthenticatedLocalApi("/functions/example", {
    method: "POST",
    body: "{}",
  });

  expect(response.status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(clearLocalApiAuthTokenMock).not.toHaveBeenCalled();
});

it("does not replay a non-idempotent mutation after a transport error", async () => {
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {},
  });
  const fetchMock = vi.fn(async () => {
    throw new Error("connection reset after write");
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(fetchAuthenticatedLocalApi(
    "http://127.0.0.1:7680/functions/example",
    { method: "POST", body: "{}" },
  )).rejects.toThrow("connection reset after write");

  expect(fetchMock).toHaveBeenCalledTimes(1);
});