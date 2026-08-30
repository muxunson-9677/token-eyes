import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createHandler,
  LeaderboardRefreshCoordinator,
  runScheduledRefresh,
} from "./index";

class MemoryCache {
  values = new Map<string, Response>();

  async match(request: Request) {
    const response = this.values.get(request.url);
    return response ? response.clone() : undefined;
  }

  async put(request: Request, response: Response) {
    this.values.set(request.url, response.clone());
  }
}

class MemoryDurableStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async getAlarm() {
    return this.alarm;
  }

  async setAlarm(value: number) {
    this.alarm = value;
  }
}

function durableStore(overrides: Record<string, string> = {}) {
  const storage = new MemoryDurableStorage();
  const coordinatorEnv = {
    PUBLIC_FEED_ORIGIN: "https://feeds.example",
    LEADERBOARD_PUBLISHING_PAUSED: "false",
    LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "70000",
    LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "90000",
    LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "70000",
    LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "90000",
    ...overrides,
  } as any;
  const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, coordinatorEnv);
  const fetch = vi.fn((request: Request) => coordinator.fetch(request));
  return {
    storage,
    coordinator,
    namespace: {
      idFromName: vi.fn(() => "global"),
      get: vi.fn(() => ({ fetch })),
    },
    fetch,
  };
}

function setup(originResponse = new Response(JSON.stringify({ entries: [], stale: false }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
})) {
  const cache = new MemoryCache();
  const originFetch = vi.fn(async () => originResponse.clone());
  const handler = createHandler({
    cache,
    originFetch,
    waitUntil: (promise) => void promise,
  });
  const env = {
    PUBLIC_FEED_ORIGIN: "https://feeds.example",
  };
  return { cache, env, handler, originFetch };
}

describe("leaderboard cache worker", () => {
  it("redirects the fixed public leaderboard dimensions to signed static objects", async () => {
    const { env, handler, originFetch } = setup();
    const response = await handler(
      new Request("https://cache.example/leaderboard?source=CODEX&period=week&metric=tokens&limit=50&offset=0"),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://feeds.example/v1/leaderboard/week/tokens/codex.json",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("uses fixed defaults and accepts the 30d period", async () => {
    const { env, handler, originFetch } = setup();
    const response = await handler(
      new Request("https://cache.example/leaderboard?period=30d"),
      env,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://feeds.example/v1/leaderboard/30d/tokens/all.json",
    );
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("rejects pagination, private identifiers, and unknown dimensions", async () => {
    const { env, handler, originFetch } = setup();
    const urls = [
      "https://cache.example/leaderboard?limit=20",
      "https://cache.example/leaderboard?offset=1",
      "https://cache.example/leaderboard?user_id=secret",
      "https://cache.example/leaderboard?source=other",
    ];
    for (const url of urls) {
      expect((await handler(new Request(url), env)).status).toBe(400);
    }
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("has no public avatar proxy or other InsForge-backed path", async () => {
    const { env, handler, originFetch } = setup();
    expect((await handler(new Request("https://cache.example/admin"), env)).status).toBe(404);
    expect((await handler(new Request(`https://cache.example/avatars/${"a".repeat(64)}.webp`), env)).status).toBe(404);
    expect((await handler(new Request("https://cache.example/avatars/..%2Fsecret.webp"), env)).status).toBe(404);
    expect(originFetch).not.toHaveBeenCalled();
  });

  it("signs and idempotently publishes fixed leaderboard objects to SQLite Durable Object storage", async () => {
    const { env, handler } = setup();
    const keys = generateKeyPairSync("ed25519");
    const privateDer = keys.privateKey.export({ type: "pkcs8", format: "der" });
    const store = durableStore();
    const publisherEnv = {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateDer.toString("base64"),
      LEADERBOARD_SIGNING_KEY_ID: "token-eyes-static-test",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_REFRESH_COORDINATOR: store.namespace,
    };
    const body = {
      generated_at: "2026-08-30T08:00:00.123456+00:00",
      dimensions: [{
        period: "total",
        metric: "tokens",
        source: "all",
        rows: [{
          rank: 1,
          public_entry_id: "a".repeat(64),
          display_name: "Alice",
          avatar_url: "https://insforge.example/functions/avatar?hash=secret",
          github_url: "https://evil.example/private",
          total_tokens: "123",
          estimated_cost_usd: 1.25,
          actual_cost_usd: null,
          source_breakdown: [{
            source: "codex",
            total_tokens: "123",
            estimated_cost_usd: 1.25,
            unpriced_tokens: "0",
          }],
          pricing_version: "2026-08-30",
          from_day: "1970-01-01",
          to_day: "2026-08-30",
        }],
      }],
    };
    const request = () => new Request("https://cache.example/internal/leaderboard-snapshots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-leaderboard-publisher-secret": "publisher-secret",
      },
      body: JSON.stringify(body),
    });

    expect(await (await handler(request(), publisherEnv)).json()).toMatchObject({ written: 1, unchanged: 0 });
    expect(await (await handler(request(), publisherEnv)).json()).toMatchObject({ written: 0, unchanged: 1 });
    expect(store.fetch).toHaveBeenCalledTimes(2);
    const stored = store.storage.values.get("publicObject:v1/leaderboard/total/tokens/all.json") as { body: Uint8Array };
    const envelope = JSON.parse(new TextDecoder().decode(stored.body));
    const payloadBytes = Buffer.from(envelope.payload_b64, "base64url");
    expect(verify(null, payloadBytes, keys.publicKey, Buffer.from(envelope.signature_b64, "base64url"))).toBe(true);
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    expect(payload.generated_at).toBe("2026-08-30T08:00:00.123Z");
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].user_id).toBeUndefined();
    expect(payload.entries[0].avatar_url).toBeNull();
    expect(payload.entries[0].github_url).toBeNull();
    expect(payload.entries[0].source_breakdown).toEqual([{
      source: "codex",
      total_tokens: "123",
      estimated_cost_usd: 1.25,
      unpriced_tokens: "0",
    }]);
  });

  it("rejects unknown nested breakdown fields before signing", async () => {
    const { env, handler } = setup();
    const keys = generateKeyPairSync("ed25519");
    const privateDer = keys.privateKey.export({ type: "pkcs8", format: "der" });
    const response = await handler(new Request("https://cache.example/internal/leaderboard-snapshots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-leaderboard-publisher-secret": "publisher-secret",
      },
      body: JSON.stringify({
        generated_at: "2026-08-30T08:00:00.000Z",
        dimensions: [{
          period: "total",
          metric: "tokens",
          source: "all",
          rows: [{
            rank: 1,
            public_entry_id: "a".repeat(64),
            source_breakdown: [{ source: "codex", user_id: "private" }],
          }],
        }],
      }),
    }), {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateDer.toString("base64"),
      LEADERBOARD_SIGNING_KEY_ID: "token-eyes-static-test",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_REFRESH_COORDINATOR: durableStore().namespace,
    });
    expect(response.status).toBe(400);
  });

  it("publishes content-addressed avatars to SQLite Durable Object storage without a public InsForge proxy", async () => {
    const { env, handler } = setup();
    const bytes = new TextEncoder().encode("small-webp-fixture");
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const store = durableStore();
    const publisherEnv = {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_REFRESH_COORDINATOR: store.namespace,
    };
    const response = await handler(new Request(
      `https://cache.example/internal/leaderboard-avatar/${hash}.webp`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/webp",
          "x-leaderboard-publisher-secret": "publisher-secret",
        },
        body: bytes,
      },
    ), publisherEnv);

    expect(response.status).toBe(200);
    expect(store.storage.values.has(`publicObject:v1/avatars/${hash}.webp`)).toBe(true);
    expect(store.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed before optional object writes when the Durable Object binding is missing", async () => {
    const { env, handler } = setup();
    const bytes = new TextEncoder().encode("small-webp-fixture");
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const response = await handler(new Request(
      `https://cache.example/internal/leaderboard-avatar/${hash}.webp`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/webp",
          "x-leaderboard-publisher-secret": "publisher-secret",
        },
        body: bytes,
      },
    ), {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
    });

    expect(response.status).toBe(503);
  });

  it("blocks optional object writes when the daily Durable Object hard stop is reached", async () => {
    const { env, handler } = setup();
    const bytes = new TextEncoder().encode("small-webp-fixture");
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const store = durableStore({
      LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "1",
      LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "1",
      LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "1",
      LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "1",
    });
    const response = await handler(new Request(
      `https://cache.example/internal/leaderboard-avatar/${hash}.webp`,
      {
        method: "PUT",
        headers: {
          "content-type": "image/webp",
          "x-leaderboard-publisher-secret": "publisher-secret",
        },
        body: bytes,
      },
    ), {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_REFRESH_COORDINATOR: store.namespace,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(store.storage.values.has(`publicObject:v1/avatars/${hash}.webp`)).toBe(false);
  });

  it("enforces daily Durable Object warning and stop limits for public objects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
    const storage = new MemoryDurableStorage();
    const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "2",
      LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "2",
      LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "4",
      LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "4",
    } as any);

    const body = new TextEncoder().encode("{}");
    const put = () => coordinator.fetch(new Request("https://coordinator/objects/v1/plan-market/feed.json", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-object-cache-control": "public, max-age=300",
        "x-object-content-sha256": "a".repeat(64),
      },
      body,
    }));
    const first = await put();
    expect(first.status).toBe(200);
    const second = await put();
    expect(second.status).toBe(200);
    expect(second.headers.get("x-token-eyes-zero-dollar-gate")).toBe("warning");
    const stopped = await put();
    expect(stopped.status).toBe(429);
    expect(storage.values.get("durableDailyBudget")).toEqual({ day: "2026-08-30", requests: 2, writes: 3 });
    vi.useRealTimers();
  });

  it("stops new dirty work before the Durable Object daily request or write reserve is exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
    const storage = new MemoryDurableStorage();
    const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "1",
      LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "1",
      LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "3",
      LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "3",
    } as any);

    const accepted = await coordinator.fetch(new Request("https://coordinator/mark", { method: "POST" }));
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("x-token-eyes-zero-dollar-gate")).toBe("warning");
    const stopped = await coordinator.fetch(new Request("https://coordinator/mark", { method: "POST" }));
    expect(stopped.status).toBe(429);
    expect(stopped.headers.get("x-token-eyes-zero-dollar-gate")).toBe("stopped");
    vi.useRealTimers();
  });

  it("does not allow deployment variables to raise the code-locked zero-dollar ceilings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
    const storage = new MemoryDurableStorage();
    const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_PUBLISHING_PAUSED: "false",
      LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "9999999",
      LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "9999999",
      LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "9999999",
      LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "9999999",
    } as any);

    storage.values.set("durableDailyBudget", {
      day: "2026-08-30",
      requests: 90_000,
      writes: 0,
    });
    const durableStopped = await coordinator.fetch(new Request(
      "https://coordinator/mark",
      { method: "POST" },
    ));
    expect(durableStopped.status).toBe(429);
    vi.useRealTimers();
  });

  it("fails optional object writes closed when the zero-dollar gate is paused", async () => {
    const { env, handler } = setup();
    const store = durableStore({ LEADERBOARD_PUBLISHING_PAUSED: "true" });
    const response = await handler(new Request(
      `https://cache.example/internal/leaderboard-avatar/${"a".repeat(64)}.webp`,
      {
        method: "DELETE",
        headers: { "x-leaderboard-publisher-secret": "publisher-secret" },
      },
    ), {
      ...env,
      LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
      LEADERBOARD_PUBLISHING_PAUSED: "true",
      LEADERBOARD_REFRESH_COORDINATOR: store.namespace,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3600");
  });

  it("coalesces dirty refresh alarms and runs daily reconciliation once at 00:05 Shanghai", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_REFRESH_URL: "https://cloud.example/functions/tokentracker-leaderboard-refresh",
      LEADERBOARD_SCHEDULER_SECRET: "scheduler-secret",
    };

    await runScheduledRefresh(Date.parse("2026-08-30T16:05:00.000Z"), env);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: "daily-reconcile" });
    await runScheduledRefresh(Date.parse("2026-08-30T16:06:00.000Z"), env);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ mode: "scheduler" });
    expect(fetchMock.mock.calls[1][1].headers["x-leaderboard-scheduler-secret"]).toBe("scheduler-secret");
    vi.unstubAllGlobals();
  });

  it("stops the scheduler when the zero-dollar gate is paused", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runScheduledRefresh(Date.parse("2026-08-30T16:06:00.000Z"), {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_REFRESH_URL: "https://cloud.example/functions/refresh",
      LEADERBOARD_SCHEDULER_SECRET: "scheduler-secret",
      LEADERBOARD_PUBLISHING_PAUSED: "true",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("coalesces dirty notifications behind a sixty-second durable alarm", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T08:00:00.000Z"));
    const values = new Map<string, unknown>();
    let alarm: number | null = null;
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => void values.set(key, value)),
      getAlarm: vi.fn(async () => alarm),
      setAlarm: vi.fn(async (value: number) => { alarm = value; }),
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, dimensions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, {
      PUBLIC_FEED_ORIGIN: "https://feeds.example",
      LEADERBOARD_REFRESH_URL: "https://cloud.example/functions/refresh",
      LEADERBOARD_SCHEDULER_SECRET: "scheduler-secret",
    } as any);

    expect((await coordinator.fetch(new Request("https://coordinator/mark", { method: "POST" }))).status).toBe(202);
    const firstAlarm = alarm;
    expect(firstAlarm).toBe(Date.now());
    await coordinator.fetch(new Request("https://coordinator/mark", { method: "POST" }));
    expect(storage.setAlarm).toHaveBeenCalledTimes(1);

    await coordinator.alarm();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(values.get("lastSuccessfulRefreshAt")).toBe(Date.now());

    vi.setSystemTime(new Date(Date.now() + 5_000));
    alarm = null;
    await coordinator.fetch(new Request("https://coordinator/mark", { method: "POST" }));
    expect(alarm).toBe(Number(values.get("lastSuccessfulRefreshAt")) + 60_000);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("accepts only the secret internal dirty trigger and forwards it to the coordinator", async () => {
    const { env, handler } = setup();
    const coordinatorFetch = vi.fn(async () => new Response("{}", { status: 202 }));
    const triggerEnv = {
      ...env,
      LEADERBOARD_DIRTY_TRIGGER_SECRET: "dirty-secret",
      LEADERBOARD_REFRESH_COORDINATOR: {
        idFromName: vi.fn(() => "global"),
        get: vi.fn(() => ({ fetch: coordinatorFetch })),
      },
    };
    const request = (secret: string) => new Request("https://cache.example/internal/leaderboard-refresh-dirty", {
      method: "POST",
      headers: { "x-leaderboard-dirty-secret": secret },
    });

    expect((await handler(request("wrong"), triggerEnv as any)).status).toBe(401);
    expect((await handler(request("dirty-secret"), triggerEnv as any)).status).toBe(202);
    expect(coordinatorFetch).toHaveBeenCalledTimes(1);
  });
});
