import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocalApiOriginForTests } from "../lib/local-api-url";
import * as dailyModelBreakdown from "../lib/daily-model-breakdown.js";

const { fetchDailyModelBreakdown } = dailyModelBreakdown;

const VALID_JWT = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetLocalApiOriginForTests();
  Reflect.deleteProperty(window, "__TAURI__");
  vi.restoreAllMocks();
});

it("canonicalizes source filters to the exact single-source request semantics", () => {
  expect(dailyModelBreakdown.canonicalizeDailyBreakdownSources(null)).toEqual(null);
  expect(dailyModelBreakdown.canonicalizeDailyBreakdownSources([])).toEqual(null);
  expect(dailyModelBreakdown.canonicalizeDailyBreakdownSources([" Codex ", "codex", "CLAUDE"])).toEqual([
    "claude",
    "codex",
  ]);
});

describe.each([
  ["local", false],
  ["cloud", true],
])("daily model breakdown %s loader", (_label, useCloud) => {
  it("does not start a fetch when auth resolution finishes after abort", async () => {
    if (!useCloud) {
      Object.defineProperty(window, "__TAURI__", {
        configurable: true,
        value: {
          core: {
            invoke: vi.fn().mockResolvedValue({ running: true, url: "http://127.0.0.1:17680" }),
          },
        },
      });
    }
    const auth = deferred();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sources: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = fetchDailyModelBreakdown({
      day: "2026-08-07",
      useCloud,
      accountAccessToken: useCloud ? { getAccessToken: () => auth.promise } : null,
      accessToken: useCloud ? null : { getAccessToken: () => auth.promise },
      baseUrl: useCloud ? "https://usage.example.test" : "http://127.0.0.1:17680",
      source: "codex",
      timeZone: "UTC",
      tzOffsetMinutes: 0,
      signal: controller.signal,
    });
    controller.abort();
    auth.resolve(VALID_JWT);

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.each([
  ["local", false],
  ["cloud", true],
])("daily model breakdown source request (%s)", (_label, useCloud) => {
  it("passes the full canonical source set to the real request", async () => {
    if (!useCloud) {
      Object.defineProperty(window, "__TAURI__", {
        configurable: true,
        value: {
          core: {
            invoke: vi.fn().mockResolvedValue({ running: true, url: "http://127.0.0.1:17680" }),
          },
        },
      });
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sources: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDailyModelBreakdown({
      day: "2026-08-07",
      useCloud,
      accountAccessToken: useCloud ? VALID_JWT : null,
      accessToken: useCloud ? null : VALID_JWT,
      sources: [" Codex ", "CLAUDE", "codex"],
      timeZone: "UTC",
      tzOffsetMinutes: 0,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.getAll("source")).toEqual(["claude", "codex"]);
  });
});
