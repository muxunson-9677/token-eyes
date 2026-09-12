import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createHandler, LeaderboardRefreshCoordinator, runResetRefresh } from "./index";

it('protects the reset collection trigger before any upstream request', async () => {
  const {handler} = handlerWithCache();
  const {env} = objectStore();
  expect((await handler(new Request('https://cache.example/internal/codex-reset/refresh', {method:'POST'}), env)).status).toBe(401);
});

it('keeps the public payload unchanged during an incomplete scan and publishes pending items on completion', async () => {
  const {privateKey}=generateKeyPairSync('ed25519');
  const {env,storage}=objectStore({LEADERBOARD_SIGNING_PRIVATE_KEY_B64:privateKey.export({format:'der',type:'pkcs8'}).toString('base64')});
  const {signedEnvelope}=await import('./codex-reset-collector');
  const old=await signedEnvelope([],env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64,Date.now()-3600000);
  const key='publicObject:v1/codex-reset/feed.json';
  storage.values.set(key,{body:JSON.stringify(old),contentType:'application/json',cacheControl:'public',contentSha256:'a'.repeat(64)});
  const ids=Array.from({length:5},(_,i)=>String((BigInt(Date.now()-10000-i*1000)-1288834974657n)<<22n));
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>{
    const target=String(input);
    if(target.startsWith('https://api.fxtwitter.com/')) return new Response('auth',{status:401});
    if(target==='https://x.com/thsottiaux') return new Response('<link rel="canonical" href="https://x.com/thsottiaux">'+ids.map(id=>`<a href="/thsottiaux/status/${id}">post</a>`).join(''));
    const url=target.startsWith('https://publish.x.com/')?new URL(target).searchParams.get('url')!:target;
    const text=url.endsWith(ids[0])?'Codex usage limits have been reset.':'Ordinary post.';
    if(target.startsWith('https://publish.x.com/'))return Response.json({url,author_url:'https://x.com/thsottiaux',provider_name:'X',html:`<p>${text}</p>`});
    return new Response(`<link rel="canonical" href="${url}"><div dir="auto"><span>${text}</span></div>`);
  }));
  const payload=()=>JSON.parse(Buffer.from(JSON.parse(Buffer.from((storage.values.get(key) as any).body).toString()).payload_b64,'base64url').toString());
  try {
    expect((await runResetRefresh(env,new MemoryCache())).complete).toBe(false);
    expect(payload().announcements).toEqual([]);
    expect(payload().generated_at).toBe(JSON.parse(Buffer.from(old.payload_b64,'base64url').toString()).generated_at);
    expect((await runResetRefresh(env,new MemoryCache())).complete).toBe(true);
    expect(payload().announcements[0].source_post_id).toBe(ids[0]);
    expect(payload().pending_announcements).toBeUndefined();
  } finally {vi.unstubAllGlobals();}
});

it('rejects a stale conditional write instead of overwriting a newer reset feed', async () => {
  const {coordinator,storage} = objectStore();
  const key='publicObject:v1/codex-reset/feed.json';
  storage.values.set(key,{body:'old',contentType:'application/json',cacheControl:'public',contentSha256:'a'.repeat(64)});
  const write=(hash:string,body:string)=>coordinator.fetch(new Request('https://coordinator/objects/v1/codex-reset/feed.json',{
    method:'PUT',headers:{'If-Match':'"'+ 'a'.repeat(64)+'"','X-Object-Content-Sha256':hash.repeat(64)},body,
  }));
  expect((await write('b','new')).status).toBe(200);
  expect((await write('c','late old scan')).status).toBe(412);
  expect((storage.values.get(key) as any).contentSha256).toBe('b'.repeat(64));
});

it('refreshes the stored reset feed only after successful discovery and preserves it on failure', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const store = objectStore({ LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateKey.export({format:'der',type:'pkcs8'}).toString('base64') });
  const { signedEnvelope } = await import('./codex-reset-collector');
  const old = await signedEnvelope([], store.env.LEADERBOARD_SIGNING_PRIVATE_KEY_B64, Date.now()-3600000);
  const key = 'publicObject:v1/codex-reset/feed.json';
  store.storage.values.set(key, {body:JSON.stringify(old), contentType:'application/json', cacheControl:'public',contentSha256:'old'});
  const cache = new MemoryCache();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({results:[],cursor:{}})));
  try {
    await runResetRefresh(store.env, cache);
    const updated = store.storage.values.get(key);
    expect(updated).not.toEqual({body:JSON.stringify(old), contentType:'application/json', cacheControl:'public',contentSha256:'old'});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('failure',{status:503})));
    await expect(runResetRefresh(store.env, cache)).rejects.toThrow();
    expect(store.storage.values.get(key)).toEqual(updated);
  } finally { vi.unstubAllGlobals(); }
});

class MemoryCache {
  values = new Map<string, Response>();
  deletes = 0;

  async match(request: Request) {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response) {
    this.values.set(request.url, response.clone());
  }

  async delete(request: Request) {
    this.deletes += 1;
    return this.values.delete(request.url);
  }
}

class MemoryDurableStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  puts = 0;

  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown) {
    this.puts += 1;
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

function objectStore(options: Record<string, string> = {}) {
  const storage = new MemoryDurableStorage();
  const env = {
    PUBLIC_FEED_ORIGIN: "https://cache.example",
    LEADERBOARD_PUBLISHER_SECRET: "publisher-secret",
    LEADERBOARD_PUBLISHING_PAUSED: "false",
    LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "70000",
    LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "90000",
    LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "70000",
    LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "90000",
    ...options,
  } as any;
  const coordinator = new LeaderboardRefreshCoordinator({ storage } as any, env);
  const fetch = vi.fn((request: Request) => coordinator.fetch(request));
  env.LEADERBOARD_REFRESH_COORDINATOR = {
    idFromName: vi.fn(() => "global"),
    get: vi.fn(() => ({ fetch })),
  };
  return { coordinator, env, fetch, storage };
}

function handlerWithCache() {
  const cache = new MemoryCache();
  const pending: Promise<unknown>[] = [];
  const originFetch = vi.fn(async () => new Response("origin access forbidden", { status: 500 }));
  return {
    cache,
    originFetch,
    pending,
    handler: createHandler({
      cache,
      originFetch,
      waitUntil: (promise) => pending.push(promise),
    }),
  };
}

function publisherRequest(body: unknown) {
  return new Request("https://cache.example/internal/leaderboard-snapshots", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-leaderboard-publisher-secret": "publisher-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("Workers Free SQLite Durable Object public object store", () => {
  it("publishes, anonymously serves, and globally caches a signed leaderboard object without an origin fetch", async () => {
    const keys = generateKeyPairSync("ed25519");
    const privateDer = keys.privateKey.export({ type: "pkcs8", format: "der" });
    const store = objectStore({
      LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateDer.toString("base64"),
      LEADERBOARD_SIGNING_KEY_ID: "token-eyes-static-test",
    });
    const runtime = handlerWithCache();
    const body = {
      generated_at: "2026-08-30T08:00:00.123456+00:00",
      dimensions: [{
        period: "total",
        metric: "tokens",
        source: "all",
        rows: [{
          rank: 1,
          participant_count: 1,
          public_entry_id: "a".repeat(64),
          display_name: "Alice",
          avatar_url: null,
          github_url: null,
          total_tokens: "123",
          estimated_cost_usd: 1.25,
          actual_cost_usd: null,
          source_breakdown: [],
          pricing_version: "2026-08-30",
          from_day: "1970-01-01",
          to_day: "2026-08-30",
        }],
      }],
    };

    const publish = await runtime.handler(publisherRequest(body), store.env);
    expect(publish.status).toBe(200);
    expect(await publish.json()).toMatchObject({ ok: true, written: 1, unchanged: 0 });

    const publicRequest = new Request("https://cache.example/v1/leaderboard/total/tokens/all.json");
    const miss = await runtime.handler(publicRequest, store.env);
    expect(miss.status).toBe(200);
    expect(miss.headers.get("access-control-allow-origin")).toBe("*");
    expect(miss.headers.get("access-control-expose-headers")).toContain("X-Token-Eyes-Cache");
    expect(miss.headers.get("x-token-eyes-cache")).toBe("MISS");
    expect(miss.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const envelope = await miss.json() as { payload_b64: string; signature_b64: string };
    const payload = Buffer.from(envelope.payload_b64, "base64url");
    expect(verify(null, payload, keys.publicKey, Buffer.from(envelope.signature_b64, "base64url"))).toBe(true);
    await Promise.all(runtime.pending.splice(0));

    const callsAfterMiss = store.fetch.mock.calls.length;
    const hit = await runtime.handler(publicRequest, store.env);
    expect(hit.status).toBe(200);
    expect(hit.headers.get("x-token-eyes-cache")).toBe("HIT");
    expect(store.fetch).toHaveBeenCalledTimes(callsAfterMiss + 1);
    expect(runtime.originFetch).not.toHaveBeenCalled();
  });

  it("allows anonymous browser origins to read public objects without credentials", async () => {
    const store = objectStore();
    const runtime = handlerWithCache();
    const preflight = await runtime.handler(new Request(
      "https://cache.example/v1/leaderboard/total/tokens/all.json",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example",
          "Access-Control-Request-Method": "GET",
        },
      },
    ), store.env);

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(store.fetch).not.toHaveBeenCalled();
  });

  it("never serves a stale leaderboard object from a different edge cache after publication", async () => {
    const keys = generateKeyPairSync("ed25519");
    const privateDer = keys.privateKey.export({ type: "pkcs8", format: "der" });
    const store = objectStore({
      LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateDer.toString("base64"),
      LEADERBOARD_SIGNING_KEY_ID: "token-eyes-static-test",
    });
    const publisherRuntime = handlerWithCache();
    const readerRuntime = handlerWithCache();
    const dimension = (generated_at: string, display_name: string) => ({
      generated_at,
      dimensions: [{
        period: "total",
        metric: "tokens",
        source: "all",
        rows: [{
          rank: 1,
          participant_count: 1,
          public_entry_id: "a".repeat(64),
          display_name,
          avatar_url: null,
          github_url: null,
          total_tokens: "123",
          estimated_cost_usd: 1.25,
          actual_cost_usd: null,
          source_breakdown: [],
          pricing_version: "2026-08-30",
          from_day: "1970-01-01",
          to_day: "2026-08-30",
        }],
      }],
    });

    expect((await publisherRuntime.handler(
      publisherRequest(dimension("2026-08-30T08:00:00.000Z", "Alice")),
      store.env,
    )).status).toBe(200);
    const publicRequest = new Request("https://cache.example/v1/leaderboard/total/tokens/all.json");
    const first = await readerRuntime.handler(publicRequest, store.env);
    expect(Buffer.from((await first.json() as any).payload_b64, "base64url").toString()).toContain("Alice");
    await Promise.all(readerRuntime.pending.splice(0));

    expect((await publisherRuntime.handler(
      publisherRequest(dimension("2026-08-30T08:01:00.000Z", "Bob")),
      store.env,
    )).status).toBe(200);
    const refreshed = await readerRuntime.handler(publicRequest, store.env);
    expect(Buffer.from((await refreshed.json() as any).payload_b64, "base64url").toString()).toContain("Bob");
    expect(refreshed.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("stores the two fixed signed feeds through an authenticated Worker endpoint and serves them anonymously", async () => {
    const store = objectStore();
    const runtime = handlerWithCache();
    const envelope = {
      version: 1,
      algorithm: "Ed25519",
      key_id: "token-eyes-static-test",
      payload_b64: "e30",
      signature_b64: "c2lnbmF0dXJl",
    };

    for (const feed of ["plan-market", "codex-reset"] as const) {
      const feedEnvelope = feed === "codex-reset"
        ? { version: 1, payload_b64: envelope.payload_b64, signature_b64: envelope.signature_b64 }
        : envelope;
      const upload = await runtime.handler(new Request(`https://cache.example/internal/static-feed/${feed}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-leaderboard-publisher-secret": "publisher-secret",
        },
        body: JSON.stringify(feedEnvelope),
      }), store.env);
      expect(upload.status).toBe(200);
      const read = await runtime.handler(new Request(`https://cache.example/v1/${feed}/feed.json`), store.env);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(feedEnvelope);
    }
  });

  it("is idempotent by content hash and fails closed before a storage write when the daily budget stops", async () => {
    const store = objectStore({
      LEADERBOARD_DO_DAILY_REQUEST_WARNING_LIMIT: "2",
      LEADERBOARD_DO_DAILY_REQUEST_STOP_LIMIT: "2",
      LEADERBOARD_DO_DAILY_WRITE_WARNING_LIMIT: "3",
      LEADERBOARD_DO_DAILY_WRITE_STOP_LIMIT: "3",
    });
    const runtime = handlerWithCache();
    const envelope = {
      version: 1,
      algorithm: "Ed25519",
      key_id: "token-eyes-static-test",
      payload_b64: "e30",
      signature_b64: "c2lnbmF0dXJl",
    };
    const request = () => new Request("https://cache.example/internal/static-feed/plan-market", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-leaderboard-publisher-secret": "publisher-secret",
      },
      body: JSON.stringify(envelope),
    });

    const first = await runtime.handler(request(), store.env);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ unchanged: false });
    const second = await runtime.handler(request(), store.env);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ unchanged: true });

    const changed = { ...envelope, payload_b64: "eyJ2IjoyfQ" };
    const stopped = await runtime.handler(new Request("https://cache.example/internal/static-feed/plan-market", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-leaderboard-publisher-secret": "publisher-secret",
      },
      body: JSON.stringify(changed),
    }), store.env);
    expect(stopped.status).toBe(429);
    expect(stopped.headers.get("x-token-eyes-zero-dollar-gate")).toBe("stopped");
  });

  it("returns an explicit unavailable state when the object store binding is missing", async () => {
    const runtime = handlerWithCache();
    const response = await runtime.handler(
      new Request("https://cache.example/v1/plan-market/feed.json"),
      { PUBLIC_FEED_ORIGIN: "https://cache.example" } as any,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toMatch(/object store/i);
  });

  it("publishes all 285 leaderboard dimensions through one Durable Object subrequest", async () => {
    const keys = generateKeyPairSync("ed25519");
    const privateDer = keys.privateKey.export({ type: "pkcs8", format: "der" });
    const store = objectStore({
      LEADERBOARD_SIGNING_PRIVATE_KEY_B64: privateDer.toString("base64"),
      LEADERBOARD_SIGNING_KEY_ID: "token-eyes-static-test",
    });
    const runtime = handlerWithCache();
    const periods = ["today", "week", "30d", "month", "total"];
    const sources = [
      "all", "claude", "codex", "every-code", "cursor", "trae", "gemini", "opencode", "openclaw",
      "kilo-cli", "kilocode", "roocode", "kiro", "hermes", "kimi", "kimi-code", "codebuddy",
      "workbuddy", "omp", "pi", "craft", "grok", "copilot", "zed", "goose", "droid",
      "antigravity", "deepseek-harness",
    ];
    const dimensions = periods.flatMap((period) => [
      ...["tokens", "estimated_spend"].flatMap((metric) => sources.map((source) => ({ period, metric, source, rows: [] }))),
      { period, metric: "actual_cost", source: "all", rows: [] },
    ]);
    expect(dimensions).toHaveLength(285);

    const response = await runtime.handler(publisherRequest({
      generated_at: "2026-08-30T08:00:00.000Z",
      dimensions,
    }), store.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ written: 285, unchanged: 0 });
    expect(store.fetch).toHaveBeenCalledTimes(1);
    expect(runtime.cache.deletes).toBeLessThanOrEqual(40);
  });
});
