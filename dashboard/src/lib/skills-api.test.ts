import { beforeEach, expect, it, vi } from "vitest";
import { getInstalledSkills } from "./skills-api";
import { clearLocalApiAuthToken } from "./local-api-auth";
import { resetLocalApiOriginForTests } from "./local-api-url";

beforeEach(() => {
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  clearLocalApiAuthToken();
  resetLocalApiOriginForTests();
  vi.restoreAllMocks();
});

it("authenticates the installed-skills GET through the local handshake", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/local-auth")) {
      return new Response(JSON.stringify({ token: "local-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ skills: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await getInstalledSkills();

  const skillsCall = fetchMock.mock.calls.find(([input]) =>
    String(input).includes("/functions/tokentracker-skills?mode=installed"));
  expect(skillsCall).toBeTruthy();
  expect(new Headers(skillsCall?.[1]?.headers).get("x-tokentracker-local-auth")).toBe(
    "local-token",
  );
});

it("routes Skills through the Tauri-reported loopback API", async () => {
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {
      core: {
        invoke: vi.fn().mockResolvedValue({
          running: true,
          url: "http://127.0.0.1:17680",
        }),
      },
    },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.endsWith("/api/local-auth")
      ? { token: "local-token" }
      : { skills: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await getInstalledSkills();

  expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
    "http://127.0.0.1:17680/functions/tokentracker-skills?mode=installed",
  );
});