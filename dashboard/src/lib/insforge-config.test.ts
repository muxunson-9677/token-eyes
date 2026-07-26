import { beforeEach, expect, it, vi } from "vitest";

const createClientMock = vi.fn((options) => ({ options }));
const getLocalApiAuthHeadersMock = vi.fn(async () => ({
  "x-tokentracker-local-auth": "local-token",
}));
const clearLocalApiAuthTokenMock = vi.fn();

vi.mock("@insforge/sdk", () => ({
  createClient: createClientMock,
}));

vi.mock("./local-api-auth", () => ({
  clearLocalApiAuthToken: clearLocalApiAuthTokenMock,
  getLocalApiAuthHeaders: getLocalApiAuthHeadersMock,
}));

beforeEach(() => {
  vi.resetModules();
  createClientMock.mockClear();
  getLocalApiAuthHeadersMock.mockReset().mockResolvedValue({
    "x-tokentracker-local-auth": "local-token",
  });
  clearLocalApiAuthTokenMock.mockClear();
  vi.restoreAllMocks();
});

it("injects local auth into SDK writes to the same-origin auth proxy", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { getOrCreateInsforgeClient } = await import("./insforge-config");

  getOrCreateInsforgeClient();
  const sdkFetch = createClientMock.mock.calls[0]?.[0]?.fetch;
  expect(sdkFetch).toBeTypeOf("function");

  await sdkFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  expect(getLocalApiAuthHeadersMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/login",
    expect.objectContaining({
      method: "POST",
      headers: expect.any(Headers),
    }),
  );
  const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  expect(headers.get("x-tokentracker-local-auth")).toBe("local-token");
});

it("injects local auth into SDK reads from the same-origin auth proxy", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { getOrCreateInsforgeClient } = await import("./insforge-config");

  getOrCreateInsforgeClient();
  const sdkFetch = createClientMock.mock.calls[0]?.[0]?.fetch;
  await sdkFetch("/api/auth/sessions/current", { method: "GET" });

  const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  expect(headers.get("x-tokentracker-local-auth")).toBe("local-token");
});

it("refreshes local auth once when the SDK auth proxy returns 401", async () => {
  getLocalApiAuthHeadersMock
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "expired-token" })
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "current-token" });
  const fetchMock = vi.fn(async (_url, init) => {
    const token = new Headers(init?.headers).get("x-tokentracker-local-auth");
    return new Response("{}", {
      status: token === "current-token" ? 200 : 401,
      headers: token === "current-token"
        ? undefined
        : { "X-TokenTracker-Local-Auth-Required": "1" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { getOrCreateInsforgeClient } = await import("./insforge-config");

  getOrCreateInsforgeClient();
  const sdkFetch = createClientMock.mock.calls[0]?.[0]?.fetch;
  const response = await sdkFetch("/api/auth/sessions/current", { method: "GET" });

  expect(response.status).toBe(200);
  expect(clearLocalApiAuthTokenMock).toHaveBeenCalledTimes(1);
  expect(getLocalApiAuthHeadersMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => String(url)).join("\n")).not.toMatch(
    /expired-token|current-token/,
  );
});

it("replays a body Request from a fresh clone after a marked local-auth 401", async () => {
  getLocalApiAuthHeadersMock
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "expired-token" })
    .mockResolvedValueOnce({ "x-tokentracker-local-auth": "current-token" });
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), window.location.href), init);
    bodies.push(await request.text());
    const token = request.headers.get("x-tokentracker-local-auth");
    return new Response("{}", {
      status: token === "current-token" ? 200 : 401,
      headers: token === "current-token"
        ? undefined
        : { "X-TokenTracker-Local-Auth-Required": "1" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { getOrCreateInsforgeClient } = await import("./insforge-config");

  getOrCreateInsforgeClient();
  const sdkFetch = createClientMock.mock.calls[0]?.[0]?.fetch;
  const request = new Request(`${window.location.origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com" }),
  });
  const response = await sdkFetch(request);

  expect(response.status).toBe(200);
  expect(bodies).toEqual([
    JSON.stringify({ email: "user@example.com" }),
    JSON.stringify({ email: "user@example.com" }),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not replay an unmarked SDK business 401", async () => {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  const { getOrCreateInsforgeClient } = await import("./insforge-config");

  getOrCreateInsforgeClient();
  const sdkFetch = createClientMock.mock.calls[0]?.[0]?.fetch;
  const response = await sdkFetch("/api/auth/login", {
    method: "POST",
    body: "{}",
  });

  expect(response.status).toBe(401);
  expect(clearLocalApiAuthTokenMock).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
