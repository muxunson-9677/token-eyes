// LiteLLM data loader: 24h disk cache + bundled seed snapshot fallback.
// Fetches from upstream once when cache is missing or stale, then keeps a
// per-process in-memory map. fetchModelPricing() is async; subsequent reads
// (lookupPricing in matcher.js) operate on the in-memory map synchronously.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PRICING_HARD_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const SEED_SNAPSHOT_PATH = path.resolve(__dirname, "seed-snapshot.json");

function readJsonSync(p) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

async function readJsonAsync(p) {
  const raw = await fsp.readFile(p, "utf8");
  return JSON.parse(raw);
}

function isFresh(stat, ttlMs, nowMs = Date.now()) {
  if (!stat) return false;
  return nowMs - stat.mtimeMs < ttlMs;
}

function validIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function unpackCatalog(payload, { source, nowMs, fallbackUrl = LITELLM_PRICING_URL } = {}) {
  const meta = payload?._meta && typeof payload._meta === "object" ? payload._meta : {};
  const cachedAt = validIso(meta.cached_at) || null;
  const sourceUpdatedAt = validIso(meta.source_updated_at)
    || validIso(meta.generated_at)
    || cachedAt;
  const sourceUrl = typeof meta.source_url === "string" && /^https:\/\//.test(meta.source_url)
    ? meta.source_url
    : typeof meta.source === "string" && /^https:\/\//.test(meta.source)
      ? meta.source
      : fallbackUrl;
  const data = { ...(payload || {}) };
  delete data._meta;
  return {
    data,
    source,
    source_url: sourceUrl,
    cached_at: cachedAt,
    source_updated_at: sourceUpdatedAt,
    observed_at: new Date(nowMs).toISOString(),
    is_stale: sourceUpdatedAt == null
      || nowMs - Date.parse(sourceUpdatedAt) > PRICING_HARD_MAX_AGE_MS,
  };
}

async function statSafe(p) {
  try {
    return await fsp.stat(p);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

async function loadSeedSnapshot() {
  // Sync read is fine — file is bundled and small (~250KB). Falling back to
  // sync avoids a race with caller's synchronous lookup if seed must answer
  // immediately.
  try {
    return readJsonSync(SEED_SNAPSHOT_PATH);
  } catch (e) {
    // Tolerate missing seed in dev environments where the build script
    // hasn't run yet. Empty data = LiteLLM lookup miss = falls back to
    // CURATED only.
    return {};
  }
}

async function fetchUpstream({ url = LITELLM_PRICING_URL, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`LiteLLM fetch failed: HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function writeCache(cachePath, data, { nowMs = Date.now(), url = LITELLM_PRICING_URL } = {}) {
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  // Persist only the slimmed shape (4 cost fields) to keep disk small and
  // make the cache file easy to inspect/edit.
  const slim = {};
  let kept = 0;
  for (const [name, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object" || name.startsWith("_")) continue;
    const out = {};
    let hasAny = false;
    for (const f of [
      "input_cost_per_token",
      "output_cost_per_token",
      "cache_read_input_token_cost",
      "cache_creation_input_token_cost",
    ]) {
      const v = entry[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[f] = v;
        hasAny = true;
      }
    }
    if (hasAny) {
      slim[name] = out;
      kept++;
    }
  }
  const observedAt = new Date(nowMs).toISOString();
  const payload = {
    _meta: {
      source: url,
      cached_at: observedAt,
      source_updated_at: validIso(data?._meta?.source_updated_at)
        || validIso(data?._meta?.generated_at)
        || observedAt,
      kept_models: kept,
    },
    ...slim,
  };
  await fsp.writeFile(cachePath, JSON.stringify(payload) + "\n");
  return payload;
}

// Public: load LiteLLM data into memory. Resolution chain:
//   1. disk cache (if mtime < ttl)
//   2. fetch upstream + write disk cache
//   3. stale disk cache (network failed)
//   4. bundled seed snapshot (fresh install / offline)
async function loadLitellmData({
  cachePath,
  ttlMs = DEFAULT_TTL_MS,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl = fetchUpstream,
  url = LITELLM_PRICING_URL,
  logger = null,
  nowMs = Date.now(),
} = {}) {
  if (!cachePath) {
    throw new Error("loadLitellmData: cachePath is required");
  }
  const log = (level, msg) => {
    if (logger && typeof logger[level] === "function") logger[level](msg);
  };

  // 1. Fresh disk cache
  const stat = await statSafe(cachePath);
  if (isFresh(stat, ttlMs, nowMs)) {
    try {
      const data = await readJsonAsync(cachePath);
      return unpackCatalog(data, { source: "disk-cache", nowMs, fallbackUrl: url });
    } catch (e) {
      log("warn", `[pricing] disk cache unreadable: ${e?.message || e}`);
    }
  }

  // 2. Fetch upstream
  try {
    const upstream = await fetchImpl({ url, timeoutMs: fetchTimeoutMs });
    const payload = await writeCache(cachePath, upstream, { nowMs, url });
    return unpackCatalog(payload, { source: "upstream", nowMs, fallbackUrl: url });
  } catch (e) {
    log("warn", `[pricing] upstream fetch failed: ${e?.message || e}`);
  }

  // 3. Stale disk cache (better than seed)
  if (stat) {
    try {
      const data = await readJsonAsync(cachePath);
      log("warn", "[pricing] using stale disk cache");
      return unpackCatalog(data, { source: "stale-cache", nowMs, fallbackUrl: url });
    } catch (e) {
      log("warn", `[pricing] stale cache unreadable: ${e?.message || e}`);
    }
  }

  // 4. Bundled seed snapshot
  const seed = await loadSeedSnapshot();
  return unpackCatalog(seed, { source: "seed-snapshot", nowMs, fallbackUrl: url });
}

module.exports = {
  LITELLM_PRICING_URL,
  DEFAULT_TTL_MS,
  PRICING_HARD_MAX_AGE_MS,
  loadLitellmData,
  loadSeedSnapshot,
  fetchUpstream,
};
