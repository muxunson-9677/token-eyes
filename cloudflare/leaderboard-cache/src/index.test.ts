import { describe, expect, it, vi } from "vitest";
import { createHandler } from "./index";

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
  const env = { INSFORGE_PUBLIC_ORIGIN: "https://origin.example" };
  return { cache, env, handler, originFetch };
}

describe("leaderboard cache worker", () => {
  it("canonicalizes only the five public leaderboard query keys", async () => {
    const { env, handler, originFetch } = setup();
    const response = await handler(
      new Request("https://cache.example/leaderboard?offset=7&source=CODEX&period=week&metric=tokens&limit=999&user_id=secret"),
      env,
    );

    expect(response.status).toBe(200);
    const origin = new URL(originFetch.mock.calls[0][0].url);
    expect(origin.pathname).toBe("/functions/tokentracker-leaderboard");
    expect(Object.fromEntries(origin.searchParams)).toEqual({
      period: "week",
      metric: "tokens",
      source: "codex",
      limit: "100",
      offset: "7",
    });
    expect(originFetch.mock.calls[0][0].headers.get("authorization")).toBeNull();
    expect(originFetch.mock.calls[0][0].headers.get("cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("s-maxage=900");
  });

  it("caches successful leaderboard reads and serves stale data on origin error", async () => {
    const { env, handler, originFetch } = setup();
    const request = new Request("https://cache.example/leaderboard");
    await handler(request, env);
    await handler(request, env);
    expect(originFetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached stale:true data after an origin failure", async () => {
    const { cache, env, handler } = setup();
    const request = new Request("https://cache.example/leaderboard?period=today");
    await handler(request, env);
    const failing = createHandler({
      cache,
      originFetch: vi.fn(async () => new Response("bad gateway", { status: 502 })),
      waitUntil: (promise) => void promise,
      bypassFreshCache: true,
    });

    const response = await failing(request, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stale: true });
  });

  it("allows hash-only WebP avatars with one-year immutable caching", async () => {
    const { env, handler, originFetch } = setup(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      }),
    );
    const hash = "a".repeat(64);
    const response = await handler(new Request(`https://cache.example/avatars/${hash}.webp`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new URL(originFetch.mock.calls[0][0].url).searchParams.get("hash")).toBe(hash);
  });

  it("rejects arbitrary paths and avatar traversal", async () => {
    const { env, handler, originFetch } = setup();
    expect((await handler(new Request("https://cache.example/admin"), env)).status).toBe(404);
    expect((await handler(new Request("https://cache.example/avatars/..%2Fsecret.webp"), env)).status).toBe(404);
    expect(originFetch).not.toHaveBeenCalled();
  });
});
