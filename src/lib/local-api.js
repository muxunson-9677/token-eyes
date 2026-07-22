const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { DEFAULT_BASE_URL, resolveRuntimeConfig } = require("./runtime-config");
const {
  DATA_DIRECTORY_KEYS,
  detectDataDirectoryPaths,
  inspectDataDirectory,
  normalizeDataDirectories,
  resolveDataDirectoryPaths,
} = require("./data-directories");
const {
  filterRowsByUsageScope,
  getSourceScope,
  listExcludedSources,
  normalizeSource,
  normalizeUsageScope,
} = require("./source-metadata");
const { accountSlugFor, fetchAccountUsage, mintAccessToken } = require("./cloud-account");
const { getOrCreateMachineId, computeStableMachineId } = require("./machine-id");
const {
  assertCompactStateSize,
  buildLeaderboardDeviceState,
  stableStateHash,
} = require("./leaderboard-state");
const {
  buildLeaderboardActualCostSummary,
} = require("./leaderboard-actual-cost");
const {
  createCodexResetMonitorStore,
} = require("./codex-reset-monitor-store");
const {
  createCodexResetMonitorService,
} = require("./codex-reset-monitor-service");
const { getCodexUsageLimits } = require("./usage-limits");

const SYNC_TIMEOUT_MS = 120_000;
const TRACKER_BIN = path.resolve(__dirname, "../../bin/tracker.js");
const MVP_USD_TO_CNY = 7.2;
const LOCAL_API_PROTOCOL_VERSION = 2;
const LOCAL_API_PRODUCT_ID = "token-eyes";
const LOCAL_API_BUILD_VERSION = (() => {
  try {
    return String(require("../../package.json")?.version || "");
  } catch {
    return "";
  }
})();
const LOCAL_API_CAPABILITIES = Object.freeze([
  "spend_usage_v2",
  "provider_model_stats",
  "request_usage_records",
  "project_usage_paths",
  "agent_environment_detection",
  "data_directory_detection",
  "provider_api_balance",
  "codex_reset_events",
]);

// Avatar proxy (see /api/avatar-proxy below). In-memory LRU; survives the
// CLI server lifetime, which is good enough 鈥?the dashboard reloads cheaply.
const AVATAR_PROXY_TTL_MS = 60 * 60 * 1000; // 1h
const AVATAR_PROXY_MAX_BYTES = 512 * 1024; // 512 KiB per image
const AVATAR_PROXY_MAX_ENTRIES = 64;
const avatarProxyCache = new Map();

// Request-usage-records list cache: avoids rebuilding/sorting the full capped
// record set on every page request. Keyed by filters + queue mtime; TTL-bound.
const REQUEST_USAGE_RECORDS_CACHE_TTL_MS = 60_000;
const REQUEST_USAGE_RECORDS_CACHE_MAX_ENTRIES = 16;
const requestUsageRecordsListCache = new Map();
const QUEUE_DATA_CACHE_MAX_ENTRIES = 8;
const queueDataCache = new Map();

function normalizeDataDirectoryOrder(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((key) => String(key || "").trim().toLowerCase())
    .filter((key) => DATA_DIRECTORY_KEYS.includes(key) && !seen.has(key) && seen.add(key));
}
const ZONED_PARTS_FORMATTER_CACHE_MAX_ENTRIES = 32;
const zonedPartsFormatterCache = new Map();
const ZONED_PARTS_CACHE_MAX_ENTRIES = 20_000;
const zonedPartsCache = new Map();
const USAGE_AGGREGATE_RESPONSE_CACHE_TTL_MS = 30_000;
const USAGE_AGGREGATE_RESPONSE_CACHE_MAX_ENTRIES = 64;
const USAGE_AGGREGATE_RESPONSE_PATHS = new Set([
  "/functions/tokentracker-usage-summary",
  "/functions/tokentracker-provider-stats",
  "/functions/tokentracker-model-stats",
  "/functions/tokentracker-spend-records",
  "/functions/tokentracker-spend-timeseries",
]);

function queueFileMtimeKey(queuePath) {
  try {
    const st = fs.statSync(queuePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "missing";
  }
}

function buildRequestUsageRecordsListCacheKey({
  queuePath,
  effectiveSources,
  from,
  to,
  tz,
  tzOffset,
  models,
  limit,
}) {
  const sourcesKey = effectiveSources ? effectiveSources.slice().sort().join(",") : "__all__";
  const modelsKey = models && models.length > 0 ? models.slice().sort().join(",") : "";
  return [
    queuePath,
    queueFileMtimeKey(queuePath),
    sourcesKey,
    from || "",
    to || "",
    tz || "",
    String(tzOffset ?? ""),
    modelsKey,
    String(limit),
  ].join("\u0001");
}

function readRequestUsageRecordsListCache(cacheKey) {
  const entry = requestUsageRecordsListCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.builtAt > REQUEST_USAGE_RECORDS_CACHE_TTL_MS) {
    requestUsageRecordsListCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function writeRequestUsageRecordsListCache(cacheKey, payload) {
  requestUsageRecordsListCache.set(cacheKey, { ...payload, builtAt: Date.now() });
  while (requestUsageRecordsListCache.size > REQUEST_USAGE_RECORDS_CACHE_MAX_ENTRIES) {
    const oldestKey = requestUsageRecordsListCache.keys().next().value;
    if (oldestKey === undefined) break;
    requestUsageRecordsListCache.delete(oldestKey);
  }
}

function clearRequestUsageRecordsListCacheForTests() {
  requestUsageRecordsListCache.clear();
}

function readTrackerConfigAt(trackerDataDir) {
  const configPath = path.join(trackerDataDir, "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_e) {
    return {};
  }
}

async function buildRequestUsageRecordsList({
  qp,
  trackerDataDir,
  effectiveSources,
  from,
  to,
  timeZoneContext,
  limit,
  models,
  pricingOptions,
}) {
  const allRecords = [];
  const allRows = readQueueData(qp);
  let aggregateOnlySources = [];

  const fromPartsRur = from
    ? getZonedParts(new Date(`${from}T00:00:00Z`), timeZoneContext)
    : null;
  const toPartsRur = to
    ? getZonedParts(new Date(`${to}T00:00:00Z`), timeZoneContext)
    : null;
  const fromKeyRur = fromPartsRur ? formatPartsDayKey(fromPartsRur) : null;
  const toKeyRur = toPartsRur ? formatPartsDayKey(toPartsRur) : null;

  const wantsCodex = !effectiveSources || effectiveSources.includes("codex");
  const nonCodexSources = effectiveSources
    ? effectiveSources.filter((s) => s !== "codex")
    : null;

  if (nonCodexSources && nonCodexSources.length > 0) {
    aggregateOnlySources = [...nonCodexSources];
  } else if (!effectiveSources) {
    const queueSources = [...new Set(allRows.map(r => normalizeSource(r.source)).filter(Boolean))];
    aggregateOnlySources = queueSources.filter(s => s !== "codex");
  }

  const aggregateRecords = buildAggregateUsageRecords(allRows, {
    fromKey: fromKeyRur,
    toKey: toKeyRur,
    timeZoneContext,
    pricingOptions,
    sources: aggregateOnlySources.length > 0 ? aggregateOnlySources : [],
    models,
  });
  allRecords.push(...aggregateRecords);

  if (wantsCodex) {
    try {
      const dataDirectoryPaths = resolveDataDirectoryPaths({
        config: readTrackerConfigAt(trackerDataDir),
        env: process.env,
        home: os.homedir(),
      });
      const rolloutFiles = await listCodexRolloutFilesFromHomes(
        dataDirectoryPaths.codexHomes?.length ? dataDirectoryPaths.codexHomes : [dataDirectoryPaths.codexHome],
      );

      const codexResult = await collectRolloutRequestUsageRecords({
        rolloutFiles,
        source: "codex",
        from: from || undefined,
        to: to || undefined,
        timeZoneContext,
        limit,
        pricingOptions,
      });

      for (const record of codexResult.records || []) {
        record.source_display_name = getSourceDisplayName("codex");
        if (record.status === undefined) record.status = null;
        if (record.latency_ms === undefined) record.latency_ms = null;
        if (record.first_token_ms === undefined) record.first_token_ms = null;
        if (record.request_source === undefined) record.request_source = "codex_rollout";
        if (record.record_kind === undefined) record.record_kind = "request_event";
        allRecords.push(record);
      }
    } catch (e) {
      console.error("[LocalAPI] request-usage-records codex branch error:", e?.message || e);
    }
  }

  allRecords.sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    if (ta === tb) return 0;
    return ta < tb ? 1 : -1;
  });
  if (allRecords.length > limit) {
    allRecords.length = limit;
  }

  return { allRecords, aggregateOnlySources, allRows, fromKeyRur, toKeyRur };
}

// ---------------------------------------------------------------------------
// Per-model pricing 鈥?delegated to src/lib/pricing/
//   - CURATED overrides (kiro-*, hy3-*, composer-*, kimi-for-coding, etc.)
//   - LiteLLM live data (mainstream claude / gpt-5 / gemini), 24h disk-cached
//   - Bundled seed snapshot for first-install / offline fallback
// ---------------------------------------------------------------------------

const {
  MODEL_PRICING,
  getModelPricing,
  computeRowCost,
  computeRowCostDetailed,
  ensurePricingLoaded,
  normalizeAgentDefaultPricing,
  normalizePricingRules,
  normalizeUsdToCny,
} = require("./pricing");

const {
  computeClaudeCategoryBreakdown,
  unsupportedSourcePayload: unsupportedCategoryPayload,
} = require("./claude-categorizer");

const { computeCodexContextBreakdown } = require("./codex-context-breakdown");

const tokenPlanRefresh = require("./token-plan-refresh");
const { getPlanById, listProviderOptions, getProviderCatalog } = require("./token-plan-catalog");
const { getAgentAdapter, listAgentAdapters } = require("./agent-adapters");
const { collectApiBillingAccounts } = require("./api-billing");

// 02-ia-api-balance: provider API balance/spend backend (financial query only)
const providerApiConfigs = require("./provider-api-configs");
const providerApiSecrets = require("./provider-api-secrets");
const providerApiBalance = require("./provider-api-balance");
// 01-密钥安全修复: 导入 executor 以复用 sanitizeErrorMessage，避免 provider
// endpoint catch 块直接返回未经脱敏的 e.message（密钥可能出现在错误中）。
const providerApiExecutor = require("./provider-api-executor");

const {
  listRolloutFilesDeep,
  collectRolloutRequestUsageRecords,
} = require("./rollout");

const {
  extractTokenCount: extractCodexTokenCount,
  normalizeUsage: normalizeCodexUsage,
  timestampDayKey: codexTimestampDayKey,
} = require("./codex-rollout-parser");

const {
  detectPathKind,
  resolvePathStatus,
  normalizeProjectKey,
  extractProjectName,
  resolveProjectPathDisplay,
} = require("./project-path");

const {
  detectAgentEnvironment,
  detectAllAgentEnvironments,
} = require("./agent-env-detect");

// ---------------------------------------------------------------------------
// Queue data helpers
// ---------------------------------------------------------------------------

function resolveQueuePath() {
  const home = os.homedir();
  return path.join(home, ".tokentracker", "tracker", "queue.jsonl");
}

function readProjectQueueData(projectQueuePath) {
  let raw;
  try {
    raw = fs.readFileSync(projectQueuePath, "utf8");
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.error("[LocalAPI] readProjectQueueData: failed to read:", e?.message || e);
    }
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  const seen = new Map();
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const key = `${row.project_key || ""}|${row.source || ""}|${row.hour_start || ""}`;
      seen.set(key, normalizeQueueRow(row));
    } catch {
      // skip malformed
    }
  }
  const projectRows = Array.from(seen.values());
  const missingModelRows = projectRows.filter((row) => !row.model);
  if (missingModelRows.length > 0) {
    const mainQueueRows = readQueueData(resolveQueuePath());
    const sourceHourModelMap = new Map();
    for (const r of mainQueueRows) {
      const mainKey = `${r.source || ""}|${r.hour_start || ""}`;
      if (!sourceHourModelMap.has(mainKey) && r.model) {
        sourceHourModelMap.set(mainKey, r.model);
      }
    }
    for (const row of missingModelRows) {
      const mainKey = `${row.source || ""}|${row.hour_start || ""}`;
      if (sourceHourModelMap.has(mainKey)) {
        row.model = sourceHourModelMap.get(mainKey);
      }
    }
  }
  return projectRows;
}

function isLegacyInclusiveCodexRow(row) {
  if (!row || (row.source !== "codex" && row.source !== "every-code")) return false;
  const inputTokens = Number(row.input_tokens || 0);
  const cachedInputTokens = Number(row.cached_input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const totalTokens = Number(row.total_tokens || 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedInputTokens)) return false;
  if (cachedInputTokens <= 0 || inputTokens < cachedInputTokens) return false;
  // Legacy Codex queue rows stored input inclusive of cache reads, while
  // total_tokens remained input + output. Canonical rows keep input as pure
  // non-cached input, so cache-heavy legacy rows can be identified by this
  // exact invariant.
  return totalTokens === inputTokens + outputTokens;
}

function normalizeQueueRow(row) {
  let normalized = row;
  if (isLegacyInclusiveCodexRow(normalized)) {
    normalized = {
      ...normalized,
      input_tokens:
        Number(normalized.input_tokens || 0) - Number(normalized.cached_input_tokens || 0),
    };
  }
  // Legacy Cursor rows from versions 鈮?0.26.5 wrote billable_total_tokens = 0
  // for "Included in Pro" / "Enterprise" / "no charge" records (kind-based
  // gating in cursor-config.js#normalizeCursorUsage). The dashboard headline
  // sums billable_total_tokens across sources, so those rows silently
  // disappeared from the displayed total once any other source contributed
  // non-zero billable usage (GitHub issue #106). Treat billing and usage as
  // orthogonal: bump billable up to total_tokens at read time so historical
  // queue.jsonl entries render correctly without requiring a file rewrite.
  const sourceName = String(normalized.source || "").toLowerCase();
  if (sourceName === "cursor") {
    const totalTokens = Number(normalized.total_tokens || 0);
    const billable = Number(normalized.billable_total_tokens || 0);
    if (totalTokens > 0 && billable < totalTokens) {
      normalized = { ...normalized, billable_total_tokens: totalTokens };
    }
  }
  return normalized;
}

function readQueueData(queuePath) {
  const cacheKey = path.resolve(queuePath);
  const fingerprint = queueFileMtimeKey(cacheKey);
  const cached = queueDataCache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) return cached.rows;

  let raw;
  try {
    raw = fs.readFileSync(cacheKey, "utf8");
  } catch (e) {
    // ENOENT is legitimate (never synced yet); anything else is a signal we
    // don't want to hide behind an empty array forever 鈥?the dashboard would
    // otherwise render "0 tokens" with no clue the queue was unreadable.
    if (e?.code !== "ENOENT") {
      console.error("[LocalAPI] readQueueData: failed to read queue:", e?.message || e);
    }
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  // Parse row-by-row so a single corrupted line (partial write, disk-full
  // truncation, 鈥? does not wipe out every other row with it.
  const parsed = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  if (malformed > 0) {
    console.error(
      `[LocalAPI] readQueueData: skipped ${malformed}/${lines.length} malformed line(s) in ${queuePath}`,
    );
  }
  // Deduplicate: each sync appends cumulative totals per bucket, so for
  // each (source, model, hour_start) keep only the latest (last) entry.
  const seen = new Map();
  for (const row of parsed) {
    const key = `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
    seen.set(key, normalizeQueueRow(row));
  }
  const rows = Array.from(seen.values());
  queueDataCache.delete(cacheKey);
  queueDataCache.set(cacheKey, { fingerprint, rows });
  while (queueDataCache.size > QUEUE_DATA_CACHE_MAX_ENTRIES) {
    const oldestKey = queueDataCache.keys().next().value;
    if (oldestKey === undefined) break;
    queueDataCache.delete(oldestKey);
  }
  return rows;
}

function clearQueueDataCacheForTests() {
  queueDataCache.clear();
}

function summarizeTokenOnlyUsage(rows, directoryStates = {}) {
  const totals = { trae: 0, codebuddy: 0, opencode: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const source = normalizeSource(row?.source);
    if (!Object.prototype.hasOwnProperty.call(totals, source)) continue;
    totals[source] += Math.max(0, Number(row?.total_tokens || 0));
  }
  return Object.fromEntries(
    Object.entries(totals).map(([source, totalTokens]) => {
      const directoryState = directoryStates?.[source];
      const detected = directoryState && directoryState.status !== "not-detected";
      const result = {
        configured: totalTokens > 0 || Boolean(detected),
        error: null,
        token_only: true,
        total_tokens: totalTokens,
      };
      if (detected && totalTokens === 0) {
        result.collection_status = "connected_no_precise_tokens";
        result.tracking_ready = Boolean(directoryState.trackingReady);
        result.evidence = directoryState.evidence || null;
        result.data_path = directoryState.dataPath || directoryState.path || null;
      }
      return [source, result];
    }),
  );
}

function resolveTokenOnlyDirectoryStates(settings, options = {}) {
  const resolved = resolveDataDirectoryPaths({
    config: { dataDirectories: settings?.dataDirectories || {} },
    env: options.env || process.env,
    home: options.home || os.homedir(),
    platform: options.platform || process.platform,
  });
  return {
    trae: inspectDataDirectory("trae", resolved.traeHome, options),
    codebuddy: inspectDataDirectory("codebuddy", resolved.codebuddyHome, options),
    opencode: inspectDataDirectory("opencode", resolved.opencodeHome, options),
  };
}

function appendDetectedTokenOnlyProviders(providers, directoryStates = {}, sources = null) {
  const result = Array.isArray(providers) ? providers.slice() : [];
  const existing = new Set(result.map((provider) => normalizeSource(provider?.source)));
  for (const source of ["trae", "codebuddy", "opencode"]) {
    if (sources && !sources.includes(source)) continue;
    if (existing.has(source)) continue;
    const state = directoryStates?.[source];
    if (!state || state.status === "not-detected") continue;
    result.push({
      source,
      source_display_name: getSourceDisplayName(source),
      request_count: null,
      conversation_count: null,
      tokens: 0,
      cost_usd: 0,
      priced_tokens: 0,
      unpriced_tokens: 0,
      pricing_coverage: "complete",
      success_rate: null,
      avg_latency_ms: null,
      metric_availability: "connected_no_precise_tokens",
      collection_status: "connected_no_precise_tokens",
      evidence: state.evidence || null,
      data_path: state.dataPath || state.path || null,
    });
  }
  return result;
}

function rowDayKey(row, timeZoneContext) {
  const hs = row.hour_start;
  if (!hs) return "";
  if (
    timeZoneContext &&
    (timeZoneContext.timeZone || Number.isFinite(timeZoneContext.offsetMinutes))
  ) {
    const parts = getZonedParts(new Date(hs), timeZoneContext);
    const key = formatPartsDayKey(parts);
    if (key) return key;
  }
  return hs.slice(0, 10);
}

function toUtcHalfHourStart(ts) {
  const dt = new Date(ts);
  if (!Number.isFinite(dt.getTime())) return null;
  const minutes = dt.getUTCMinutes();
  const halfMinute = minutes >= 30 ? 30 : 0;
  return new Date(Date.UTC(
    dt.getUTCFullYear(),
    dt.getUTCMonth(),
    dt.getUTCDate(),
    dt.getUTCHours(),
    halfMinute,
    0,
    0,
  )).toISOString();
}

const CODEX_ROLLOUT_QUEUE_CACHE = new Map();
const CODEX_ROLLOUT_QUEUE_INFLIGHT = new Map();
const CODEX_ROLLOUT_QUEUE_CACHE_TTL_MS = 30_000;
const CODEX_ROLLOUT_FILES_CACHE = new Map();
const CODEX_ROLLOUT_FILES_CACHE_TTL_MS = 60_000;

async function listCodexRolloutFilesFromHomes(codexHomes) {
  const homes = Array.isArray(codexHomes) ? codexHomes : [codexHomes];
  const cacheKey = homes.map((home) => String(home || "").trim().toLowerCase()).filter(Boolean).join("\u0001");
  if (cacheKey) {
    const cached = CODEX_ROLLOUT_FILES_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < CODEX_ROLLOUT_FILES_CACHE_TTL_MS) {
      return cached.files.slice();
    }
  }
  const seen = new Set();
  const files = [];
  for (const home of homes) {
    const found = await listCodexRolloutFilesFromHome(home);
    for (const filePath of found) {
      const key = String(filePath || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      files.push(filePath);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  if (cacheKey) {
    CODEX_ROLLOUT_FILES_CACHE.set(cacheKey, { at: Date.now(), files: files.slice() });
  }
  return files;
}

async function listCodexRolloutFilesFromHome(codexHome) {
  const home = typeof codexHome === "string" ? codexHome.trim() : "";
  if (!home) return [];
  const dirs = [
    path.join(home, "sessions"),
    path.join(home, "archived_sessions"),
  ];
  const seen = new Set();
  const files = [];
  for (const dir of dirs) {
    const found = await listRolloutFilesDeep(dir).catch(() => []);
    for (const filePath of found) {
      const key = String(filePath || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      files.push(filePath);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function maxFileMtimeMs(files) {
  let max = 0;
  for (const filePath of files || []) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    } catch {
      // File disappeared during refresh; ignore this scan entry.
    }
  }
  return max;
}

function shiftDayKey(dayKey, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return null;
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function codexRolloutFileDay(filePath) {
  const match = path.basename(String(filePath || "")).match(/^rollout-(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : null;
}

async function collectCodexRolloutQueueRows({
  codexHome,
  codexHomes,
  from = "",
  to = "",
  timeZoneContext = null,
} = {}) {
  const homes = Array.isArray(codexHomes) && codexHomes.length > 0
    ? codexHomes
    : (codexHome ? [codexHome] : []);
  const files = await listCodexRolloutFilesFromHomes(homes);
  if (files.length === 0) return [];

  const cacheKey = [
    "codex-rollout-queue-v1",
    homes.join("\u0001"),
    from || "",
    to || "",
    timeZoneContext?.timeZone || "",
    Number.isFinite(timeZoneContext?.offsetMinutes) ? timeZoneContext.offsetMinutes : "",
    files.length,
    maxFileMtimeMs(files),
  ].join("|");
  const cached = CODEX_ROLLOUT_QUEUE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < CODEX_ROLLOUT_QUEUE_CACHE_TTL_MS) {
    return cached.rows.map((row) => ({ ...row }));
  }
  const existingScan = CODEX_ROLLOUT_QUEUE_INFLIGHT.get(cacheKey);
  if (existingScan) {
    const rows = await existingScan;
    return rows.map((row) => ({ ...row }));
  }

  const scan = (async () => {
    const buckets = new Map();
    const minFileDay = from ? shiftDayKey(from, -1) : null;
    const maxFileDay = to ? shiftDayKey(to, 1) : null;

    for (const filePath of files) {
      const fileDay = codexRolloutFileDay(filePath);
      if (fileDay && minFileDay && fileDay < minFileDay) continue;
      if (fileDay && maxFileDay && fileDay > maxFileDay) continue;

      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) continue;

      let model = "unknown";
      const stream = fs.createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      try {
        for await (const line of rl) {
          if (!line) continue;
          if (
            !line.includes('"token_count"') &&
            !line.includes('"turn_context"') &&
            !line.includes('"session_meta"')
          ) {
            continue;
          }

          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }

          if (
            (obj?.type === "turn_context" || obj?.type === "session_meta") &&
            obj?.payload &&
            typeof obj.payload === "object"
          ) {
            if (typeof obj.payload.model === "string" && obj.payload.model.trim()) {
              model = obj.payload.model.trim();
            }
            continue;
          }

          const token = extractCodexTokenCount(obj);
          if (!token?.info || typeof token.info !== "object") continue;
          const timestamp = typeof token.timestamp === "string" ? token.timestamp : "";
          if (!timestamp) continue;
          const dayKey = codexTimestampDayKey(timestamp, timeZoneContext);
          if (!dayKey) continue;
          if (from && dayKey < from) continue;
          if (to && dayKey > to) continue;

          const usage = normalizeCodexUsage(token.info.last_token_usage);
          if (!usage || !Number(usage.total_tokens || 0)) continue;
          const hourStart = toUtcHalfHourStart(timestamp);
          if (!hourStart) continue;

          const bucketKey = `codex|${model}|${hourStart}`;
          if (!buckets.has(bucketKey)) {
            buckets.set(bucketKey, {
              hour_start: hourStart,
              source: "codex",
              model,
              input_tokens: 0,
              output_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 0,
              billable_total_tokens: 0,
              conversation_count: 0,
            });
          }
          const row = buckets.get(bucketKey);
          row.input_tokens += Number(usage.input_tokens || 0);
          row.output_tokens += Number(usage.output_tokens || 0);
          row.cached_input_tokens += Number(usage.cached_input_tokens || 0);
          row.cache_creation_input_tokens += Number(usage.cache_creation_input_tokens || 0);
          row.reasoning_output_tokens += Number(usage.reasoning_output_tokens || 0);
          row.total_tokens += Number(usage.total_tokens || 0);
          row.billable_total_tokens += Number(usage.total_tokens || 0);
          row.conversation_count += 1;
        }
      } finally {
        rl.close();
        stream.close?.();
      }
    }

    const rows = Array.from(buckets.values()).sort((a, b) => {
      const timeCmp = a.hour_start.localeCompare(b.hour_start);
      if (timeCmp !== 0) return timeCmp;
      return String(a.model || "").localeCompare(String(b.model || ""));
    });
    CODEX_ROLLOUT_QUEUE_CACHE.set(cacheKey, { at: Date.now(), rows });
    return rows;
  })();
  CODEX_ROLLOUT_QUEUE_INFLIGHT.set(cacheKey, scan);
  try {
    const rows = await scan;
    return rows.map((row) => ({ ...row }));
  } finally {
    if (CODEX_ROLLOUT_QUEUE_INFLIGHT.get(cacheKey) === scan) {
      CODEX_ROLLOUT_QUEUE_INFLIGHT.delete(cacheKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-value filter param parsing (comma-separated) — project-first pattern.
// Returns null when the param is absent (meaning "do not filter"); returns a
// lower-cased, de-duplicated array otherwise. Empty/whitespace items dropped.
// ---------------------------------------------------------------------------

function parseMultiParam(url, key) {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  const seen = new Set();
  const out = [];
  for (const piece of String(raw).split(",")) {
    const normalized = normalizeSource(piece);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > 0 ? out : null;
}

// Merge source filters with agent_ids. When agent_ids is present, effective
// sources are ONLY the mapped queueSource values (optionally intersected with
// explicit sources) — never unioned with the full visible allowlist.
function resolveAgentIdsToQueueSources(agentIds) {
  if (!Array.isArray(agentIds) || agentIds.length === 0) return null;
  const seen = new Set();
  const out = [];
  for (const id of agentIds) {
    const adapter = getAgentAdapter(id);
    const source = normalizeSource(adapter?.queueSource || id);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }
  return out.length > 0 ? out : null;
}

function mergeSourceFilters(...candidates) {
  if (candidates.length === 0) return null;

  // agent_ids is always the final argument at every call site (may be null).
  const agentIds = candidates.length > 1 ? candidates[candidates.length - 1] : null;
  const sourceCandidates = candidates.length > 1 ? candidates.slice(0, -1) : candidates;

  const agentSources = resolveAgentIdsToQueueSources(
    Array.isArray(agentIds) ? agentIds : null,
  );

  const seen = new Set();
  const explicitSources = [];
  for (const candidate of sourceCandidates) {
    if (!candidate) continue;
    const arr = Array.isArray(candidate) ? candidate : [candidate];
    for (const item of arr) {
      const normalized = normalizeSource(item);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      explicitSources.push(normalized);
    }
  }

  if (agentSources) {
    if (explicitSources.length > 0) {
      const narrowed = agentSources.filter((s) => explicitSources.includes(s));
      return narrowed.length > 0 ? narrowed : agentSources;
    }
    return agentSources;
  }

  return explicitSources.length > 0 ? explicitSources : null;
}

// ---------------------------------------------------------------------------
// source -> display name mapping.
// Built from listAgentAdapters() keyed by queueSource (NOT adapter id —
// getAgentAdapter(id) would miss kilocode/omp whose id ≠ queueSource).
// ---------------------------------------------------------------------------

const SOURCE_DISPLAY_NAME_MAP = (() => {
  const map = new Map();
  for (const adapter of listAgentAdapters()) {
    const key = normalizeSource(adapter.queueSource);
    if (key && !map.has(key)) map.set(key, adapter.displayName);
  }
  return map;
})();

function getSourceDisplayName(source) {
  const key = normalizeSource(source);
  return SOURCE_DISPLAY_NAME_MAP.get(key) || key || "Unknown";
}

// ---------------------------------------------------------------------------
// Shared queue-row aggregator — the single source of truth that guarantees
// three-way caliber consistency between usage-summary, spend-timeseries totals
// and request-usage-records totals (for non-codex sources). All three call
// this function with the same rows + filters + time range.
// ---------------------------------------------------------------------------

function computeQueueTotals(rows, options = {}) {
  const {
    fromKey = null,
    toKey = null,
    timeZoneContext = null,
    pricingOptions = {},
    sources = null,
    models = null,
  } = options;
  const acc = {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    cost_usd: 0,
    conversation_count: 0,
    priced_tokens: 0,
    unpriced_tokens: 0,
    pricing_coverage: "complete",
  };
  for (const row of rows) {
    if (!row || !row.hour_start) continue;
    const src = normalizeSource(row.source);
    if (sources && !sources.includes(src)) continue;
    const modelKey = String(row.model || "").trim().toLowerCase();
    if (models && !models.includes(modelKey)) continue;
    const dayKey = rowDayKey(row, timeZoneContext);
    if (fromKey && dayKey < fromKey) continue;
    if (toKey && dayKey > toKey) continue;
    acc.total_tokens += Number(row.total_tokens || 0);
    acc.input_tokens += Number(row.input_tokens || 0);
    acc.output_tokens += Number(row.output_tokens || 0);
    acc.cached_input_tokens += Number(row.cached_input_tokens || 0);
    acc.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
    acc.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
    const rowCost = computeRowCostDetailed(row, pricingOptions);
    acc.cost_usd += Number(rowCost.cost_usd || 0);
    acc.conversation_count += Number(row.conversation_count || 0);
    acc.priced_tokens += Number(rowCost.priced_tokens || 0);
    acc.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);
  }
  acc.cost_usd = Number(acc.cost_usd.toFixed(6));
  const total = acc.priced_tokens + acc.unpriced_tokens;
  if (total === 0) {
    acc.pricing_coverage = "complete";
  } else if (acc.unpriced_tokens === 0) {
    acc.pricing_coverage = "complete";
  } else if (acc.priced_tokens === 0) {
    acc.pricing_coverage = "unpriced";
  } else {
    acc.pricing_coverage = "partial";
  }
  return acc;
}

function buildAggregateUsageRecords(rows, options = {}) {
  const {
    fromKey = null,
    toKey = null,
    timeZoneContext = null,
    pricingOptions = {},
    sources = null,
    models = null,
  } = options;
  const out = [];
  let index = 0;
  for (const row of rows) {
    if (!row || !row.hour_start) continue;
    const src = normalizeSource(row.source);
    if (!src || src === "codex") continue;
    if (sources && !sources.includes(src)) continue;
    const model = String(row.model || "unknown");
    const modelKey = model.trim().toLowerCase();
    if (models && !models.includes(modelKey)) continue;
    const dayKey = rowDayKey(row, timeZoneContext);
    if (fromKey && dayKey < fromKey) continue;
    if (toKey && dayKey > toKey) continue;

    const cost = computeRowCostDetailed(row, pricingOptions);
    out.push({
      id: `aggregate:${src}:${modelKey || "unknown"}:${row.hour_start}:${index}`,
      timestamp: row.hour_start,
      hour_start: row.hour_start,
      aggregate_bucket_start: row.hour_start,
      source: src,
      source_display_name: getSourceDisplayName(src),
      model,
      input_tokens: Number(row.input_tokens || 0),
      cached_input_tokens: Number(row.cached_input_tokens || 0),
      cache_creation_input_tokens: Number(row.cache_creation_input_tokens || 0),
      output_tokens: Number(row.output_tokens || 0),
      reasoning_output_tokens: Number(row.reasoning_output_tokens || 0),
      total_tokens: Number(row.total_tokens || 0),
      cost_usd: Number(cost.cost_usd || 0),
      priced_tokens: Number(cost.priced_tokens || 0),
      unpriced_tokens: Number(cost.unpriced_tokens || 0),
      pricing_coverage: cost.pricing_coverage || "complete",
      conversation_count: Number(row.conversation_count || 0),
      status: null,
      latency_ms: null,
      first_token_ms: null,
      request_source: "queue_aggregate",
      record_kind: "aggregate_bucket",
    });
    index += 1;
  }
  return out;
}



// Compute the enhanced totals fields (request_count, success_rate, etc.)
// from a list of records. Token sums come from the records themselves.
// Only computes success_rate and avg_latency_ms from records that have
// measured status/latency (not aggregate-only queue sources).
function computeRecordTotals(records) {
  const totals = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    request_count: 0,
    success_count: null,
    success_rate: null,
    avg_latency_ms: null,
    cache_hit_rate: 0,
    priced_tokens: 0,
    unpriced_tokens: 0,
    pricing_coverage: "complete",
    status_sample_count: 0,
    latency_sample_count: 0,
  };
  let latencySum = 0;
  let measuredStatusCount = 0;
  let measuredLatencyCount = 0;
  let successCount = 0;
  for (const r of records) {
    const aggregateCount = Number(r.conversation_count || 0);
    totals.request_count += r.record_kind === "aggregate_bucket"
      ? (aggregateCount > 0 ? aggregateCount : 1)
      : 1;
    totals.input_tokens += Number(r.input_tokens || 0);
    totals.cached_input_tokens += Number(r.cached_input_tokens || 0);
    totals.cache_creation_input_tokens += Number(r.cache_creation_input_tokens || 0);
    totals.output_tokens += Number(r.output_tokens || 0);
    totals.reasoning_output_tokens += Number(r.reasoning_output_tokens || 0);
    totals.total_tokens += Number(r.total_tokens || 0);
    totals.cost_usd += Number(r.cost_usd || 0);
    totals.priced_tokens += Number(r.priced_tokens || 0);
    totals.unpriced_tokens += Number(r.unpriced_tokens || r.total_tokens || 0) - Number(r.priced_tokens || 0);
    if (r.status !== null && r.status !== undefined) {
      measuredStatusCount++;
      if (Number(r.status) >= 200 && Number(r.status) < 300) successCount++;
    }
    if (r.latency_ms !== null && r.latency_ms !== undefined) {
      measuredLatencyCount++;
      latencySum += Number(r.latency_ms);
    }
  }
  totals.status_sample_count = measuredStatusCount;
  totals.latency_sample_count = measuredLatencyCount;
  if (measuredStatusCount > 0) {
    totals.success_count = successCount;
    totals.success_rate = Number(((successCount / measuredStatusCount) * 100).toFixed(2));
  }
  if (measuredLatencyCount > 0) {
    totals.avg_latency_ms = Math.round(latencySum / measuredLatencyCount);
  }
  const cacheBase = totals.input_tokens + totals.cached_input_tokens;
  totals.cache_hit_rate = cacheBase > 0
    ? Number(((totals.cached_input_tokens / cacheBase) * 100).toFixed(2))
    : 0;
  totals.cost_usd = Number(totals.cost_usd.toFixed(6));
  const total = totals.priced_tokens + totals.unpriced_tokens;
  if (total === 0) {
    totals.pricing_coverage = "complete";
  } else if (totals.unpriced_tokens === 0) {
    totals.pricing_coverage = "complete";
  } else if (totals.priced_tokens === 0) {
    totals.pricing_coverage = "unpriced";
  } else {
    totals.pricing_coverage = "partial";
  }
  return totals;
}

// Aggregate queue rows by source for the provider-stats endpoint.
// Each provider entry contains source / display_name / conversation_count /
// tokens (= total_tokens) / cost_usd / and null for request_count,
// success_rate, avg_latency_ms (queue.jsonl has no per-request granularity).
// Results are sorted by tokens descending. Shares the same filter semantics
// as computeQueueTotals so the three-caliber consistency (usage-summary /
// spend-timeseries / provider-stats) is preserved.
function aggregateBySource(rows, options = {}) {
  const {
    fromKey = null,
    toKey = null,
    timeZoneContext = null,
    pricingOptions = {},
    sources = null,
    models = null,
  } = options;
  const map = new Map();
  for (const row of rows) {
    if (!row || !row.hour_start) continue;
    const src = normalizeSource(row.source);
    if (sources && !sources.includes(src)) continue;
    const modelKey = String(row.model || "").trim().toLowerCase();
    if (models && !models.includes(modelKey)) continue;
    const dayKey = rowDayKey(row, timeZoneContext);
    if (fromKey && dayKey < fromKey) continue;
    if (toKey && dayKey > toKey) continue;
    if (!map.has(src)) {
      map.set(src, {
        source: src,
        source_display_name: getSourceDisplayName(src),
        request_count: null,
        conversation_count: 0,
        tokens: 0,
        cost_usd: 0,
        priced_tokens: 0,
        unpriced_tokens: 0,
        pricing_coverage: "complete",
        success_rate: null,
        avg_latency_ms: null,
        metric_availability: "aggregate_only",
      });
    }
    const acc = map.get(src);
    acc.conversation_count += Number(row.conversation_count || 0);
    acc.tokens += Number(row.total_tokens || 0);
    const rowCost = computeRowCostDetailed(row, pricingOptions);
    acc.cost_usd += Number(rowCost.cost_usd || 0);
    acc.priced_tokens += Number(rowCost.priced_tokens || 0);
    acc.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);
  }
  const providers = Array.from(map.values());
  for (const p of providers) {
    p.cost_usd = Number(p.cost_usd.toFixed(6));
    const total = p.priced_tokens + p.unpriced_tokens;
    if (total === 0) {
      p.pricing_coverage = "complete";
    } else if (p.unpriced_tokens === 0) {
      p.pricing_coverage = "complete";
    } else if (p.priced_tokens === 0) {
      p.pricing_coverage = "unpriced";
    } else {
      p.pricing_coverage = "partial";
    }
  }
  providers.sort((a, b) => b.tokens - a.tokens);
  return providers;
}

// Aggregate queue rows by (source, model) for the model-stats endpoint.
// Aggregation key is `${source}|${model}` so the same model name under
// different sources is not merged. Model field preserves original casing
// for display; filtering uses the lowercased form. Sorted by tokens
// descending. Same filter semantics as computeQueueTotals.
function aggregateByModel(rows, options = {}) {
  const {
    fromKey = null,
    toKey = null,
    timeZoneContext = null,
    pricingOptions = {},
    sources = null,
    models = null,
  } = options;
  const map = new Map();
  for (const row of rows) {
    if (!row || !row.hour_start) continue;
    const src = normalizeSource(row.source);
    if (sources && !sources.includes(src)) continue;
    const modelKey = String(row.model || "").trim().toLowerCase();
    if (models && !models.includes(modelKey)) continue;
    const dayKey = rowDayKey(row, timeZoneContext);
    if (fromKey && dayKey < fromKey) continue;
    if (toKey && dayKey > toKey) continue;
    const key = `${src}|${modelKey}`;
    if (!map.has(key)) {
      map.set(key, {
        model: String(row.model || "unknown"),
        source: src,
        source_display_name: getSourceDisplayName(src),
        request_count: null,
        conversation_count: 0,
        tokens: 0,
        cost_usd: 0,
        priced_tokens: 0,
        unpriced_tokens: 0,
        pricing_coverage: "complete",
        success_rate: null,
        avg_latency_ms: null,
        metric_availability: "aggregate_only",
      });
    }
    const acc = map.get(key);
    acc.conversation_count += Number(row.conversation_count || 0);
    acc.tokens += Number(row.total_tokens || 0);
    const rowCost = computeRowCostDetailed(row, pricingOptions);
    acc.cost_usd += Number(rowCost.cost_usd || 0);
    acc.priced_tokens += Number(rowCost.priced_tokens || 0);
    acc.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);
  }
  const models_out = Array.from(map.values());
  for (const m of models_out) {
    m.cost_usd = Number(m.cost_usd.toFixed(6));
    const total = m.priced_tokens + m.unpriced_tokens;
    if (total === 0) {
      m.pricing_coverage = "complete";
    } else if (m.unpriced_tokens === 0) {
      m.pricing_coverage = "complete";
    } else if (m.priced_tokens === 0) {
      m.pricing_coverage = "unpriced";
    } else {
      m.pricing_coverage = "partial";
    }
  }
  models_out.sort((a, b) => b.tokens - a.tokens);
  return models_out;
}

function aggregateByDay(rows, timeZoneContext = null, pricingOptions = {}) {
  const byDay = new Map();
  for (const row of rows) {
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const a = byDay.get(day);
    a.total_tokens += row.total_tokens || 0;
    a.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    a.total_cost_usd += computeRowCost(row, pricingOptions);
    a.input_tokens += row.input_tokens || 0;
    a.output_tokens += row.output_tokens || 0;
    a.cached_input_tokens += row.cached_input_tokens || 0;
    a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    a.conversation_count += row.conversation_count || 0;

    if (!a.models) {
      a.models = {};
    }
    const model = row.model || "unknown";
    a.models[model] = (a.models[model] || 0) + (row.total_tokens || 0);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function buildCodexCategoryFallbackFromQueue(queueRows, { from, to, timeZoneContext }) {
  const totals = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
  let conversationCount = 0;

  for (const row of queueRows || []) {
    if ((row?.source || "") !== "codex") continue;
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (from && day < from) continue;
    if (to && day > to) continue;
    totals.input_tokens += Number(row.input_tokens || 0);
    totals.cached_input_tokens += Number(row.cached_input_tokens || 0);
    totals.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
    totals.output_tokens += Number(row.output_tokens || 0);
    totals.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
    totals.total_tokens += Number(row.total_tokens || 0);
    conversationCount += Number(row.conversation_count || 0);
  }

  return {
    source: "codex",
    scope: "supported",
    breakdown_status: "queue_fallback",
    totals,
    session_count: 0,
    message_count: conversationCount,
    fallback: "queue_totals",
    message_breakdown: {
      categories: [
        {
          key: "user_input",
          name: "User input",
          totals: {
            input_tokens: totals.input_tokens,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: totals.input_tokens,
          },
        },
        {
          key: "conversation_history",
          name: "Conversation history",
          totals: {
            input_tokens: 0,
            cached_input_tokens: totals.cached_input_tokens,
            cache_creation_input_tokens: totals.cache_creation_input_tokens,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: totals.cached_input_tokens + totals.cache_creation_input_tokens,
          },
        },
        {
          key: "assistant_response",
          name: "Assistant response",
          totals: {
            input_tokens: 0,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: Math.max(0, totals.output_tokens - totals.reasoning_output_tokens),
            reasoning_output_tokens: 0,
            total_tokens: Math.max(0, totals.output_tokens - totals.reasoning_output_tokens),
          },
        },
      ].sort((a, b) => Number(b.totals.total_tokens || 0) - Number(a.totals.total_tokens || 0)),
      privacy: {
        includes_content: false,
        note: "Queue fallback includes aggregated token categories only; message text is never returned.",
      },
    },
    tool_calls_breakdown: {
      total_calls: 0,
      tools: [],
      categories: [],
      tools_total: 0,
      privacy: {
        includes_inputs: false,
        note: "Codex rollout sessions were unavailable; totals come from Token Eyes local usage rows.",
      },
    },
    exec_command_breakdown: {
      by_type: [],
      by_exit: [],
    },
  };
}

function getRequestedUsageScope(url) {
  if (url.searchParams.get("include_account_level") === "1") return "all";
  return normalizeUsageScope(url.searchParams.get("scope"));
}

function scopedQueueRows(queuePath, url) {
  const scope = getRequestedUsageScope(url);
  const allRows = readQueueData(queuePath);
  return {
    scope,
    allRows,
    rows: filterRowsByUsageScope(allRows, scope),
    excludedSources: listExcludedSources(allRows, scope),
  };
}

function getTimeZoneContext(url) {
  const tz = String(url.searchParams.get("tz") || "").trim();
  const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
  return {
    timeZone: tz || null,
    offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
  };
}

function getZonedPartsFormatter(timeZone) {
  const cached = zonedPartsFormatterCache.get(timeZone);
  if (cached) {
    zonedPartsFormatterCache.delete(timeZone);
    zonedPartsFormatterCache.set(timeZone, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  zonedPartsFormatterCache.set(timeZone, formatter);
  while (zonedPartsFormatterCache.size > ZONED_PARTS_FORMATTER_CACHE_MAX_ENTRIES) {
    const oldestKey = zonedPartsFormatterCache.keys().next().value;
    if (oldestKey === undefined) break;
    zonedPartsFormatterCache.delete(oldestKey);
  }
  return formatter;
}

function writeZonedPartsCache(cacheKey, parts) {
  zonedPartsCache.set(cacheKey, parts);
  while (zonedPartsCache.size > ZONED_PARTS_CACHE_MAX_ENTRIES) {
    const oldestKey = zonedPartsCache.keys().next().value;
    if (oldestKey === undefined) break;
    zonedPartsCache.delete(oldestKey);
  }
  return parts;
}

function getZonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(dt.getTime())) return null;
  const zoneKey = timeZone || (Number.isFinite(offsetMinutes) ? `offset:${offsetMinutes}` : "local");
  const cacheKey = `${zoneKey}|${dt.getTime()}`;
  const cached = zonedPartsCache.get(cacheKey);
  if (cached) return cached;

  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const formatter = getZonedPartsFormatter(timeZone);
      const parts = formatter.formatToParts(dt);
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value;
        return acc;
      }, {});
      const year = Number(values.year);
      const month = Number(values.month);
      const day = Number(values.day);
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      const second = Number(values.second);
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return writeZonedPartsCache(cacheKey, { year, month, day, hour, minute, second });
      }
    } catch (_e) {
      // fall through
    }
  }

  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000);
    return writeZonedPartsCache(cacheKey, {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    });
  }

  return writeZonedPartsCache(cacheKey, {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  });
}

function formatPartsDayKey(parts) {
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function aggregateHourlyByDay(rows, dayKey, timeZoneContext) {
  const byHour = new Map();
  for (const row of rows) {
    if (!row.hour_start) continue;
    const parts = getZonedParts(new Date(row.hour_start), timeZoneContext);
    if (!parts) continue;
    if (formatPartsDayKey(parts) !== dayKey) continue;
    const hourKey = `${dayKey}T${String(parts.hour).padStart(2, "0")}:00:00`;
    if (!byHour.has(hourKey)) {
      byHour.set(hourKey, {
        hour: hourKey,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const bucket = byHour.get(hourKey);
    bucket.total_tokens += row.total_tokens || 0;
    bucket.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    bucket.input_tokens += row.input_tokens || 0;
    bucket.output_tokens += row.output_tokens || 0;
    bucket.cached_input_tokens += row.cached_input_tokens || 0;
    bucket.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    bucket.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    bucket.conversation_count += row.conversation_count || 0;

    if (!bucket.models) {
      bucket.models = {};
    }
    const model = row.model || "unknown";
    bucket.models[model] = (bucket.models[model] || 0) + (row.total_tokens || 0);
  }
  return Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

// ---------------------------------------------------------------------------
// Sync helper
// ---------------------------------------------------------------------------

function trimOutput(value, max = 4000) {
  const t = String(value || "");
  return t.length <= max ? t : t.slice(t.length - max);
}

function normalizeRemoteHttpBaseUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_e) {
    return null;
  }
}

function resolveAllowedInsforgeBaseUrl(value) {
  const requested = normalizeRemoteHttpBaseUrl(value);
  if (!requested) return null;

  const runtime = resolveRuntimeConfig();
  const allowed = new Set(
    [runtime.baseUrl, DEFAULT_BASE_URL]
      .map((entry) => normalizeRemoteHttpBaseUrl(entry))
      .filter(Boolean),
  );

  return allowed.has(requested) ? requested : null;
}

function parseCookieHeader(value) {
  const out = new Map();
  if (typeof value !== "string" || !value.trim()) return out;
  for (const part of value.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (key) out.set(key, rawValue);
  }
  return out;
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function isAllowedLocalAppOrigin(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return true;
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "tauri.localhost") {
      return true;
    }
    return url.protocol === "tauri:" && url.hostname === "localhost";
  } catch (_e) {
    return false;
  }
}

function hasAllowedLoopbackOrigin(headers = {}) {
  const candidates = [headers.origin, headers.referer];
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    if (!isAllowedLocalAppOrigin(raw)) return false;
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runSyncCommand(extraEnv = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = [TRACKER_BIN, "sync"];
    if (opts.drain === true) args.push("--drain");
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      fn(v);
    };
    const tid = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        reject,
        Object.assign(new Error("Sync timed out"), {
          code: "SYNC_TIMEOUT",
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
        }),
      );
    }, SYNC_TIMEOUT_MS);
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (e) => {
      finish(reject, Object.assign(e, { stdout: trimOutput(stdout), stderr: trimOutput(stderr) }));
    });
    child.on("close", (code) => {
      const r = { code: code ?? 1, stdout: trimOutput(stdout), stderr: trimOutput(stderr) };
      code === 0
        ? finish(resolve, r)
        : finish(reject, Object.assign(new Error(r.stderr || r.stdout || `exit ${r.code}`), r));
    });
  });
}

// ---------------------------------------------------------------------------
// Project detection helpers
// ---------------------------------------------------------------------------

function parseGitUrl(url) {
  if (!url) return null;
  const ssh = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const http = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (http) return { owner: http[1], repo: http[2] };
  return null;
}

function extractProjectFromCwd(cwd) {
  const home = os.homedir();
  if (!cwd || cwd === home) return null;
  const rel = cwd.replace(home + "/", "");
  const parts = rel.split("/").filter((p) => p && !p.startsWith(".") && p !== "ext-global");
  return parts.length > 0 ? parts[0] : null;
}

function scanCodexProjects(projectMap) {
  const dir = path.join(os.homedir(), ".codex", "sessions");
  try {
    for (const year of fs.readdirSync(dir)) {
      const yp = path.join(dir, year);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const month of fs.readdirSync(yp)) {
        const mp = path.join(yp, month);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const day of fs.readdirSync(mp)) {
          const dp = path.join(mp, day);
          if (!fs.statSync(dp).isDirectory()) continue;
          const files = fs.readdirSync(dp).filter((f) => f.endsWith(".jsonl"));
          for (const file of files.slice(0, 200)) {
            try {
              const first = fs.readFileSync(path.join(dp, file), "utf8").split("\n")[0];
              const d = JSON.parse(first);
              if (d.git?.repository_url) {
                const p = parseGitUrl(d.git.repository_url);
                if (p) {
                  const key = `${p.owner}/${p.repo}`;
                  if (!projectMap.has(key))
                    projectMap.set(key, {
                      project_key: key,
                      project_ref: d.git.repository_url,
                      count: 0,
                    });
                  projectMap.get(key).count++;
                }
              }
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}
}

function findSubagentsDirs(dir, depth) {
  const out = [];
  if (depth > 3) return out;
  try {
    for (const item of fs.readdirSync(dir)) {
      const fp = path.join(dir, item);
      if (!fs.statSync(fp).isDirectory()) continue;
      if (item === "subagents") out.push(fp);
      else out.push(...findSubagentsDirs(fp, depth + 1));
    }
  } catch (_e) {}
  return out;
}

function scanClaudeProjects(projectMap) {
  const dir = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const subDir of findSubagentsDirs(dir, 0)) {
      const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files.slice(0, 100)) {
        try {
          const first = fs.readFileSync(path.join(subDir, file), "utf8").split("\n")[0];
          if (!first) continue;
          const d = JSON.parse(first);
          const name = extractProjectFromCwd(d.cwd);
          if (name) {
            if (!projectMap.has(name))
              projectMap.set(name, {
                project_key: name,
                project_ref: `file://${d.cwd}`,
                count: 0,
              });
            projectMap.get(name).count++;
          }
        } catch (_e) {}
      }
    }
  } catch (_e) {}
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function json(res, data, status) {
  res.writeHead(status || 200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-TokenTracker-Local-Auth",
  });
  res.end(JSON.stringify(data));
}

const CODEX_RESET_EVENT_TYPES = new Set([
  "reset_upcoming",
  "reset_completed",
  "unexpected_quota_restore",
  "banked_reset_available",
  "official_reset_announcement",
]);
const CODEX_RESET_WINDOWS = new Set(["rolling_5_hour", "rolling_weekly"]);
const CODEX_RESET_OFFICIAL_HOSTS = new Set([
  "help.openai.com",
  "openai.com",
  "chatgpt.com",
]);

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function safeIsoString(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeCodexResetUrl(value, { allowX = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return null;
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (CODEX_RESET_OFFICIAL_HOSTS.has(hostname)) return url.toString();
  if (
    allowX
    && hostname === "x.com"
    && !url.search
    && /^\/(?:OpenAI|thsottiaux)\/status\/[0-9]+\/?$/iu.test(url.pathname)
  ) {
    return url.toString();
  }
  return null;
}

function sanitizeCodexResetStatus(status) {
  const errorCode = (value) => (
    typeof value === "string" && /^[a-z0-9_]{1,64}$/u.test(value) ? value : null
  );
  return {
    enabled: status?.enabled === true,
    configured: status?.configured === true
      ? true
      : status?.configured === false ? false : null,
    running: status?.running === true,
    last_checked_at: safeIsoString(status?.last_checked_at),
    last_successful_at: safeIsoString(status?.last_successful_at),
    next_check_at: safeIsoString(status?.next_check_at),
    last_error_code: errorCode(status?.last_error_code),
    failure_count: Number.isInteger(status?.failure_count)
      ? Math.max(0, Math.min(status.failure_count, 1_000))
      : 0,
    unread_count: Number.isInteger(status?.unread_count)
      ? Math.max(0, Math.min(status.unread_count, 1_000))
      : 0,
    feed_enabled: status?.feed_enabled === true,
    feed_last_checked_at: safeIsoString(status?.feed_last_checked_at),
    feed_error_code: errorCode(status?.feed_error_code),
  };
}

function sanitizeCodexResetEvent(event) {
  const id = boundedString(event?.id, 128);
  const type = CODEX_RESET_EVENT_TYPES.has(event?.type) ? event.type : null;
  const createdAt = safeIsoString(event?.createdAt);
  const officialUrl = safeCodexResetUrl(event?.officialUrl);
  if (!id || !type || !createdAt || !officialUrl) return null;
  const dto = {
    id,
    type,
    window: CODEX_RESET_WINDOWS.has(event.window) ? event.window : null,
    created_at: createdAt,
    reset_at: safeIsoString(event.resetAt),
    official_url: officialUrl,
    source: event.source === "signed_feed" ? "signed_feed" : "local_quota",
  };
  if (type === "official_reset_announcement") {
    const sourceUrl = safeCodexResetUrl(event.sourceUrl, { allowX: true });
    const title = boundedString(event.title, 80);
    const summary = boundedString(event.summary, 240);
    const expiresAt = safeIsoString(event.expiresAt);
    if (!sourceUrl || !title || !summary || !expiresAt) return null;
    const parsedSourceUrl = new URL(sourceUrl);
    if (parsedSourceUrl.hostname.toLowerCase() === "x.com") {
      const sourceMatch = parsedSourceUrl.pathname.match(
        /^\/(OpenAI|thsottiaux)\/status\/([0-9]+)\/?$/u,
      );
      if (
        !sourceMatch
        || event.sourceAuthor !== sourceMatch[1]
        || event.sourcePostId !== sourceMatch[2]
      ) {
        return null;
      }
    }
    dto.source_url = sourceUrl;
    dto.source_author = boundedString(event.sourceAuthor, 32);
    dto.source_post_id = boundedString(event.sourcePostId, 32);
    dto.title = title;
    dto.summary = summary;
    dto.expires_at = expiresAt;
  }
  return dto;
}

function writeCodexResetResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Content-Type, X-TokenTracker-Local-Auth",
  });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// IP check API proxy: dashboard/src/pages/IpCheckPage.jsx is a native React
// page that calls ip.net.coffee's data endpoints (/api/iprisk, /api/geoip,
// /api/dns/result, /favicons, /claude/status.json). Browser-side fetch can't
// hit them cross-origin from the dashboard, so we reverse-proxy /proxy/ipcheck/*
// to https://ip.net.coffee/* and strip embedding-hostile headers.
// (Previously this proxy also served the upstream HTML page for an iframe;
// the iframe and its HTML-rewrite path have been removed.)
// ---------------------------------------------------------------------------

const IP_CHECK_PROXY_PREFIX = "/proxy/ipcheck";
const IP_CHECK_TARGET = "https://ip.net.coffee";

// HTTP hop-by-hop headers (RFC 7230 搂6.1) plus headers undici/fetch manages
// internally. Forwarding any of these to `fetch(...)` either silently breaks
// the request (host being wrong) or, on stricter undici versions like the
// 6.24.1 shipped with Node 22.22.2, throws UND_ERR_INVALID_ARG and turns
// every proxied POST into a 502. Keep this set authoritative for every
// reverse-proxy site in this module.
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
]);

// Strip forbidden + hop-by-hop headers when forwarding an inbound request to
// fetch(). Honours the Connection header's named-headers list (RFC 7230 搂6.1)
// so values like `Connection: keep-alive, x-custom` also drop x-custom.
function buildProxyHeaders(headers) {
  const entries =
    headers && typeof headers.entries === "function"
      ? Array.from(headers.entries())
      : Object.entries(headers || {});

  const connectionNamed = new Set();
  const normalized = [];
  for (const [rawKey, rawValue] of entries) {
    if (rawValue == null) continue;
    const key = String(rawKey).toLowerCase();
    normalized.push([key, rawValue]);
    if (key === "connection") {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const v of values) {
        String(v)
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
          .forEach((part) => connectionNamed.add(part));
      }
    }
  }

  const out = {};
  for (const [key, rawValue] of normalized) {
    if (HOP_BY_HOP_HEADERS.has(key) || connectionNamed.has(key)) continue;
    if (Array.isArray(rawValue)) {
      const joined = rawValue.filter((e) => e != null).map(String).join(", ");
      if (joined) out[key] = joined;
      continue;
    }
    out[key] = String(rawValue);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

function createLocalApiHandler({
  queuePath,
  trackerDataDir: trackerDataDirOverride,
  credentialStore: injectedCredentialStore,
  detectDataDirectories: detectDataDirectoriesOverride,
  detectAgentEnvironment: detectAgentEnvironmentOverride,
  codexResetMonitorService: injectedCodexResetMonitorService,
  providerApiTestMode = false,
  providerApiTimeoutMs,
  usageLimitsProvider,
  tokenOnlyDirectoryStatesProvider,
  now: nowProvider = () => new Date(),
} = {}) {
  const qp = queuePath || resolveQueuePath();
  const detectDataDirectories = detectDataDirectoriesOverride || detectDataDirectoryPaths;
  const detectAgentEnvironmentForRequest = detectAgentEnvironmentOverride || detectAgentEnvironment;

  // Server-side cookie relay: captures auth cookies from InsForge cloud responses
  // so that both browser and WKWebView share the same login session via the proxy.
  // Persisted to disk so cookies survive server restarts.
  const csrfRelayCookieName = "insforge_csrf_token";
  let relayCookies = new Map();
  // W03-R3D: Token Plan secrets use the OS-backed credential store (same as
  // Provider API). Legacy in-memory map kept only for same-process migration.
  const tokenPlanSecretStore = new Map();
  const localAuthToken = crypto.randomBytes(24).toString("hex");
  const trackerDataDir = trackerDataDirOverride || path.join(os.homedir(), ".tokentracker", "tracker");
  const cookiePath = path.join(trackerDataDir, "relay-cookies.json");
  const usageAggregateResponseCache = new Map();

  function prepareUsageAggregateResponseCache(req, res, url) {
    if (String(req.method || "GET").toUpperCase() !== "GET") return false;
    if (!USAGE_AGGREGATE_RESPONSE_PATHS.has(url.pathname)) return false;

    const normalizedQuery = new URLSearchParams(
      Array.from(url.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
        const keyOrder = aKey.localeCompare(bKey);
        return keyOrder !== 0 ? keyOrder : aValue.localeCompare(bValue);
      }),
    ).toString();
    const cacheKey = [
      url.pathname,
      normalizedQuery,
      queueFileMtimeKey(qp),
      queueFileMtimeKey(path.join(trackerDataDir, "config.json")),
    ].join("\u0001");
    const cached = usageAggregateResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt <= USAGE_AGGREGATE_RESPONSE_CACHE_TTL_MS) {
      res.writeHead(cached.statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-TokenTracker-Local-Auth",
        "X-TokenTracker-Usage-Cache": "hit",
      });
      res.end(cached.body);
      return true;
    }
    if (cached) usageAggregateResponseCache.delete(cacheKey);

    let statusCode = 200;
    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    res.writeHead = (code, ...args) => {
      statusCode = Number(code) || 200;
      return originalWriteHead(code, ...args);
    };
    res.end = (body, ...args) => {
      if (statusCode === 200 && body !== undefined && body !== null) {
        usageAggregateResponseCache.delete(cacheKey);
        usageAggregateResponseCache.set(cacheKey, {
          body: Buffer.isBuffer(body) ? body.toString("utf8") : String(body),
          cachedAt: Date.now(),
          statusCode,
        });
        while (usageAggregateResponseCache.size > USAGE_AGGREGATE_RESPONSE_CACHE_MAX_ENTRIES) {
          const oldestKey = usageAggregateResponseCache.keys().next().value;
          if (oldestKey === undefined) break;
          usageAggregateResponseCache.delete(oldestKey);
        }
      }
      return originalEnd(body, ...args);
    };
    return false;
  }

  const codexResetFeedEnabled =
    process.env.TOKEN_EYES_CODEX_RESET_FEED_ENABLED !== "0";
  const codexResetMonitorStore = injectedCodexResetMonitorService
    ? null
    : createCodexResetMonitorStore({ trackerDataDir });
  const codexResetMonitorService = injectedCodexResetMonitorService
    || createCodexResetMonitorService({
      getCodexUsageLimits: () => {
        const dataDirectoryPaths = resolveDataDirectoryPaths({
          config: readTrackerConfigAt(trackerDataDir),
          env: process.env,
          home: os.homedir(),
          platform: process.platform,
        });
        const codexHome = dataDirectoryPaths.codexHomes?.[0]
          || dataDirectoryPaths.codexHome;
        return getCodexUsageLimits({
          home: os.homedir(),
          env: codexHome
            ? { ...process.env, CODEX_HOME: codexHome }
            : process.env,
          platform: process.platform,
        });
      },
      loadState: codexResetMonitorStore.load,
      saveState: codexResetMonitorStore.save,
       enabled: process.env.TOKEN_EYES_CODEX_RESET_MONITOR_ENABLED !== "0",
       feedEnabled: codexResetFeedEnabled,
      feedPublicKey: codexResetFeedEnabled
        ? fs.readFileSync(
          path.join(__dirname, "codex-reset-feed-public-key.pem"),
          "utf8",
         )
         : null,
     });

  // 02-ia-api-balance: Provider API credential store + balance refresh manager.
  // Uses injected store for testing, or the OS-backed default (macOS Keychain /
  // Windows DPAPI / unavailable on Linux) for production.
  const providerApiCredStore = injectedCredentialStore ||
    providerApiSecrets.createDefaultCredentialStore({ trackerDataDir });
  const providerApiBalanceManager = providerApiBalance.createBalanceRefreshManager({
    credentialStore: providerApiCredStore,
    testMode: providerApiTestMode,
    timeoutMs: providerApiTimeoutMs,
    resolveOfficialConsoleBalance,
  });

  // Load persisted cookies on startup
  try {
    if (!fs.existsSync(trackerDataDir)) fs.mkdirSync(trackerDataDir, { recursive: true });
    if (fs.existsSync(cookiePath)) {
      const content = fs.readFileSync(cookiePath, "utf8");
      const saved = JSON.parse(content);
      if (saved && typeof saved === "object") {
        let count = 0;
        for (const [k, v] of Object.entries(saved)) {
          relayCookies.set(k, v);
          count++;
        }
        if (count > 0) console.log(`[LocalAPI] Loaded ${count} relay cookies from ${cookiePath}`);
      }
    }
  } catch (e) {
    console.error("[LocalAPI] Failed to load relay cookies:", e.message);
  }

  function persistRelayCookies() {
    try {
      // Sticky semantics: never replace an existing on-disk session with an empty cookie map.
      if (relayCookies.size === 0) return;

      const json = JSON.stringify(Object.fromEntries(relayCookies));
      fs.writeFileSync(cookiePath, json, { encoding: "utf8", mode: 0o600 });
    } catch (e) {
      console.error("[LocalAPI] Failed to persist relay cookies:", e.message);
    }
  }

  function clearRelayCookies(reason) {
    if (relayCookies.size === 0) return;
    relayCookies.clear();
    try {
      if (fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
    } catch (e) {
      console.error("[LocalAPI] Failed to clear relay cookies:", e.message);
      return;
    }
    if (reason) console.warn(`[LocalAPI] Cleared relay cookies: ${reason}`);
  }

  function captureSetCookies(headerValue) {
    if (!headerValue) return;
    const parts = headerValue.split(/,(?=\s*\w+=)/);
    let changed = false;
    for (const raw of parts) {
      const eqIdx = raw.indexOf("=");
      if (eqIdx < 1) continue;
      const name = raw.substring(0, eqIdx).trim();
      if (!name) continue;

      // Basic sticky logic: if it's a deletion cookie (Max-Age=0 or past date),
      // we only remove it if we have it.
      const lower = raw.toLowerCase();
      const isDeletion = lower.includes("max-age=0") || lower.includes("expires=thu, 01 jan 1970");
      
      if (isDeletion) {
        if (relayCookies.has(name)) {
          relayCookies.delete(name);
          changed = true;
          console.log(`[LocalAPI] Cookie deleted: ${name}`);
        }
      } else {
        const oldVal = relayCookies.get(name);
        if (oldVal !== raw.trim()) {
          relayCookies.set(name, raw.trim());
          changed = true;
          console.log(`[LocalAPI] Cookie captured: ${name}`);
        }
      }
    }
    if (changed) persistRelayCookies();
  }

  function getRelayCookieValue(name, { decode = false } = {}) {
    const raw = relayCookies.get(name);
    if (!raw || typeof raw !== "string") return "";
    const pair = raw.split(";")[0] || "";
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) return "";
    const value = pair.substring(eqIdx + 1).trim();
    if (!decode) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function captureAuthTokensFromBody(bodyBuffer, contentType) {
    if (!bodyBuffer || !String(contentType || "").toLowerCase().includes("application/json")) return;
    let parsed = null;
    try {
      parsed = JSON.parse(bodyBuffer.toString("utf8"));
    } catch {
      return;
    }
    let changed = false;
    const token = typeof parsed?.csrfToken === "string" ? parsed.csrfToken.trim() : "";
    if (token) {
      const cookie = `${csrfRelayCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
      if (relayCookies.get(csrfRelayCookieName) !== cookie) {
        relayCookies.set(csrfRelayCookieName, cookie);
        changed = true;
      }
    }
    const refreshToken = typeof parsed?.refreshToken === "string" ? parsed.refreshToken.trim() : "";
    if (refreshToken) {
      const cookie = `insforge_refresh_token=${encodeURIComponent(refreshToken)}; Path=/; HttpOnly; SameSite=Lax`;
      if (relayCookies.get("insforge_refresh_token") !== cookie) {
        relayCookies.set("insforge_refresh_token", cookie);
        changed = true;
      }
    }
    if (changed) persistRelayCookies();
  }

  // --- Account (cross-device) view for the native popover ---------------
  // The popover follows the dashboard: it shows aggregated cross-device data
  // only when the user is signed in (a relayed refresh token exists) AND cloud
  // sync is on. Cloud sync is a dashboard (WebView) preference persisted in
  // localStorage; the dashboard mirrors it here via POST
  // /functions/tokentracker-cloud-sync-pref so the auth-unaware popover can key
  // off the same flag. Defaults OFF, exactly like the dashboard toggle.
  const cloudSyncPrefPath = path.join(trackerDataDir, "cloud-sync-pref.json");
  let cloudSyncPrefCache;
  function getCloudSyncPref() {
    if (cloudSyncPrefCache === undefined) {
      try {
        cloudSyncPrefCache = JSON.parse(fs.readFileSync(cloudSyncPrefPath, "utf8"))?.enabled === true;
      } catch {
        cloudSyncPrefCache = false;
      }
    }
    return cloudSyncPrefCache;
  }
  function setCloudSyncPref(enabled) {
    cloudSyncPrefCache = Boolean(enabled);
    try {
      if (!fs.existsSync(trackerDataDir)) fs.mkdirSync(trackerDataDir, { recursive: true });
      fs.writeFileSync(
        cloudSyncPrefPath,
        JSON.stringify({ enabled: cloudSyncPrefCache, updatedAt: new Date().toISOString() }),
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (e) {
      console.error("[LocalAPI] Failed to persist cloud sync pref:", e.message);
    }
  }
  const configPath = path.join(trackerDataDir, "config.json");

  function readTrackerConfig() {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_e) {
      return {};
    }
  }

  function writeTrackerConfig(config) {
    if (!fs.existsSync(trackerDataDir)) fs.mkdirSync(trackerDataDir, { recursive: true });
    const tmp = `${configPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(config || {}, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, configPath);
  }

  function normalizeCurrencySettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    return {
      usdToCny: normalizeUsdToCny(input.usdToCny),
      source: String(input.source || "manual").trim() || "manual",
      updated_at: String(input.updated_at || new Date().toISOString()).trim(),
    };
  }

  const VALID_REFRESH_INTERVALS = new Set(["manual", "30s", "1m", "5m"]);

  function normalizeDashboardRefresh(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const interval = String(input.interval || "").trim();
    return {
      interval: VALID_REFRESH_INTERVALS.has(interval) ? interval : "1m",
      updated_at: String(input.updated_at || new Date().toISOString()).trim(),
    };
  }

  function getUsdToCny() {
    const config = readTrackerConfig();
    return normalizeCurrencySettings(config.currencySettings).usdToCny;
  }

  function hasCodexQueueRowsForRange(rows, { from = "", to = "", timeZoneContext = null } = {}) {
    return rows.some((row) => {
      if (normalizeSource(row.source) !== "codex") return false;
      const day = rowDayKey(row, timeZoneContext);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }

  async function withCodexRolloutRows(rows, { from = "", to = "", timeZoneContext = null, sources = null } = {}) {
    if (Array.isArray(sources) && !sources.includes("codex")) return rows;
    if (hasCodexQueueRowsForRange(rows, { from, to, timeZoneContext })) return rows;
    const config = readTrackerConfig();
    const configuredCodexHome = normalizeDataDirectories(config.dataDirectories).codex;
    const usesDefaultQueue = path.resolve(qp).toLowerCase() === path.resolve(resolveQueuePath()).toLowerCase();
    if (!configuredCodexHome && !usesDefaultQueue) return rows;
    const dataDirectoryPaths = resolveDataDirectoryPaths({
      config,
      env: process.env,
      home: os.homedir(),
    });
    const codexRows = await collectCodexRolloutQueueRows({
      codexHomes: dataDirectoryPaths.codexHomes?.length
        ? dataDirectoryPaths.codexHomes
        : [dataDirectoryPaths.codexHome],
      from,
      to,
      timeZoneContext,
    });
    if (codexRows.length === 0) return rows;
    return [
      ...rows.filter((row) => normalizeSource(row.source) !== "codex"),
      ...codexRows,
    ];
  }

  function readLocalSettings() {
    const config = readTrackerConfig();
    return {
      dataDirectories: normalizeDataDirectories(config.dataDirectories),
      dataDirectoryOrder: normalizeDataDirectoryOrder(config.dataDirectoryOrder),
      agentDefaultPricing: normalizeAgentDefaultPricing(config.agentDefaultPricing),
      pricingRules: normalizePricingRules(config.pricingRules),
      currencySettings: normalizeCurrencySettings(config.currencySettings),
      dashboardRefresh: normalizeDashboardRefresh(config.dashboardRefresh),
    };
  }

  function updateLocalSettings(body) {
    const payload = body && typeof body === "object" ? body : {};
    const config = readTrackerConfig();
    if (Object.prototype.hasOwnProperty.call(payload, "dataDirectories")) {
      config.dataDirectories = normalizeDataDirectories(payload.dataDirectories);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "dataDirectoryOrder")) {
      config.dataDirectoryOrder = normalizeDataDirectoryOrder(payload.dataDirectoryOrder);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "agentDefaultPricing")) {
      config.agentDefaultPricing = normalizeAgentDefaultPricing(payload.agentDefaultPricing);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "pricingRules")) {
      config.pricingRules = normalizePricingRules(payload.pricingRules);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "currencySettings")) {
      const normalized = normalizeCurrencySettings(payload.currencySettings);
      config.currencySettings = {
        ...normalized,
        updated_at: new Date().toISOString(),
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, "dashboardRefresh")) {
      const normalized = normalizeDashboardRefresh(payload.dashboardRefresh);
      config.dashboardRefresh = {
        ...normalized,
        updated_at: new Date().toISOString(),
      };
    }
    writeTrackerConfig(config);
    return readLocalSettings();
  }

  function selectDirectoryWithSystemDialog() {
    if (process.platform !== "win32") {
      return Promise.resolve({ ok: false, error: "Folder selection is only supported on Windows." });
    }

    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select data directory'",
      "$dialog.ShowNewFolderButton = $true",
      "$result = $dialog.ShowDialog()",
      "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  Write-Output $dialog.SelectedPath",
      "}",
    ].join("; ");

    return new Promise((resolve) => {
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ], { windowsHide: false });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({ ok: false, error: error?.message || "Unable to open folder picker." });
      });
      child.on("close", (code) => {
        const selectedPath = stdout.trim();
        if (code === 0 && selectedPath) {
          resolve({ ok: true, path: selectedPath });
          return;
        }
        if (code === 0) {
          resolve({ ok: true, cancelled: true });
          return;
        }
        resolve({ ok: false, error: stderr.trim() || "Unable to open folder picker." });
      });
    });
  }

  function getPricingOptions() {
    const config = readTrackerConfig();
    return {
      agentDefaultPricing: normalizeAgentDefaultPricing(config.agentDefaultPricing),
      pricingRules: normalizePricingRules(config.pricingRules),
      usdToCny: normalizeCurrencySettings(config.currencySettings).usdToCny,
    };
  }

  function validateTokenPlanCatalogSelection(payload, fallback) {
    const input = payload && typeof payload === "object" ? payload : {};
    const previous = fallback && typeof fallback === "object" ? fallback : {};
    const providerId = String(input.provider_id ?? previous.provider_id ?? "").trim().toLowerCase();
    const planId = String(input.plan_id ?? previous.plan_id ?? "").trim();

    if (!providerId || providerId === "custom") {
      if (providerId === "custom" && planId && planId !== "custom") {
        const error = new Error("自定义服务商只能使用自定义套餐");
        error.statusCode = 400;
        throw error;
      }
      return;
    }

    const provider = getProviderCatalog(providerId);
    if (!provider) {
      const error = new Error(`不支持的服务商：${providerId}`);
      error.statusCode = 400;
      throw error;
    }

    if (!planId || !getPlanById(providerId, planId)) {
      const error = new Error("所选套餐不存在或未核验");
      error.statusCode = 400;
      throw error;
    }
  }

  function normalizeTokenPlanRecord(record, fallback = {}) {
    const input = record && typeof record === "object" ? record : {};
    const fallbackInput = fallback && typeof fallback === "object" ? fallback : {};
    const source = String(input.source ?? fallbackInput.source ?? "").trim();
    const planLabel = String(input.plan_label ?? fallbackInput.plan_label ?? "").trim();
    const expiresAt = String(input.expires_at ?? fallbackInput.expires_at ?? "").trim();

    const providerIdRaw = String(input.provider_id ?? fallbackInput.provider_id ?? "").trim().toLowerCase();
    const planIdRaw = String(input.plan_id ?? fallbackInput.plan_id ?? "").trim();

    const isLegacy = !providerIdRaw;
    const providerId = isLegacy ? "custom" : providerIdRaw;
    const planId = isLegacy ? "custom" : planIdRaw;

    const numberFieldNonNegative = (field) => {
      const value = input[field] ?? fallbackInput[field] ?? 0;
      const numberValue = Number(value);
      const allowFraction = providerId === "cursor"
        && ["total_quota", "used_quota", "remaining_quota"].includes(field);
      if (!Number.isFinite(numberValue) || numberValue < 0 || (!allowFraction && !Number.isSafeInteger(numberValue))) return 0;
      return numberValue;
    };

    let quotaKind = String(input.quota_kind ?? fallbackInput.quota_kind ?? "").trim();
    let quotaUnit = String(input.quota_unit ?? fallbackInput.quota_unit ?? "").trim();
    let totalQuota = numberFieldNonNegative("total_quota");
    let totalQuotaDisplay = String(input.total_quota_display ?? fallbackInput.total_quota_display ?? "").trim();
    let quotaCatalogVersion = String(input.quota_catalog_version ?? fallbackInput.quota_catalog_version ?? "").trim();
    let quotaSource = String(input.quota_source ?? fallbackInput.quota_source ?? "").trim();

    const catalogPlan = providerId !== "custom" ? getPlanById(providerId, planId) : null;
    const hasProviderSnapshot = String(input.sync_status || "").trim() === "success"
      && (Array.isArray(input.quota_windows) && input.quota_windows.length > 0)
      && Boolean(String(input.provider_reported_at || input.last_synced_at || "").trim());

    if (catalogPlan) {
      quotaKind = catalogPlan.quota_kind || "unknown";
      quotaUnit = hasProviderSnapshot && input.quota_unit
        ? String(input.quota_unit).trim()
        : (catalogPlan.quota_unit || "tokens");
      const catalogTotal = Number.isSafeInteger(catalogPlan.total_quota) && catalogPlan.total_quota >= 0
        ? catalogPlan.total_quota
        : 0;
      totalQuota = hasProviderSnapshot && catalogTotal === 0
        ? numberFieldNonNegative("total_quota")
        : catalogTotal;
      totalQuotaDisplay = catalogPlan.total_quota_display || "";
      const providerCatalog = getProviderCatalog(providerId);
      quotaCatalogVersion = providerCatalog?.catalog_version || "";
      quotaSource = hasProviderSnapshot ? "provider_reported" : "catalog";
    } else if (isLegacy || providerId === "custom") {
      if (!quotaSource) quotaSource = "manual";
      if (!quotaKind) quotaKind = "manual";
      if (!quotaUnit) quotaUnit = "tokens";
    }

    const usedQuota = numberFieldNonNegative("used_quota");
    const remainingQuota = numberFieldNonNegative("remaining_quota");

    // W03-R3D: When a detection method is configured, do NOT allow manual quota
    // entry to overwrite previously-detected values. Detection is the primary path.
    const detectionMethod = String(input.detection_method ?? fallbackInput.detection_method ?? "").trim();
    const hasDetectionConfigured = detectionMethod && detectionMethod !== "not_configured";
    let finalUsedQuota = usedQuota;
    let finalRemainingQuota = remainingQuota;
    let finalExpiresAt = expiresAt;
    if (hasDetectionConfigured) {
      // If the incoming value is zero/empty but fallback has a real value,
      // preserve the fallback (previously-detected) value.
      const fallbackUsedRaw = fallbackInput.used_quota ?? 0;
      const fallbackUsed = Number.isFinite(Number(fallbackUsedRaw)) ? Number(fallbackUsedRaw) : 0;
      const fallbackRemainingRaw = fallbackInput.remaining_quota ?? 0;
      const fallbackRemaining = Number.isFinite(Number(fallbackRemainingRaw)) ? Number(fallbackRemainingRaw) : 0;
      const fallbackExpires = String(fallbackInput.expires_at ?? "").trim();
      if (usedQuota === 0 && fallbackUsed > 0) finalUsedQuota = fallbackUsed;
      if (remainingQuota === 0 && fallbackRemaining > 0) finalRemainingQuota = fallbackRemaining;
      if (!expiresAt && fallbackExpires) finalExpiresAt = fallbackExpires;
    }

    const refreshFields = tokenPlanRefresh.ensureStatusFields({
      ...tokenPlanRefresh.normalizeRefreshFields(input, fallbackInput),
      id: String(input.id ?? fallbackInput.id ?? crypto.randomUUID()).trim(),
      source,
    });

    if (catalogPlan && providerId === "xiaomi_mimo") {
      refreshFields.refresh_enabled = false;
      refreshFields.refresh_method = "manual";
      refreshFields.credential_ref = "";
    }
    if (catalogPlan && providerId === "cursor" && detectionMethod === "official_account") {
      // Cursor official-account refresh is performed by the desktop native bridge.
      // The Node scheduler has no access to that per-account authorization and must
      // not overwrite a successful live snapshot with CURSOR_CONSOLE_SYNC_REQUIRED.
      refreshFields.refresh_enabled = false;
      refreshFields.next_refresh_at = "";
    }

    const quotaWindows = tokenPlanRefresh.normalizeQuotaWindows(
      input.quota_windows,
      fallbackInput.quota_windows,
    );

    // W03-R3A: Normalize detection fields (new detection_method, sync_status, etc.)
    const detectionFields = tokenPlanRefresh.normalizeDetectionFields(input, fallbackInput);

    const notes = String(input.notes ?? fallbackInput.notes ?? "").trim().slice(0, 200);
    const displayOrderValue = Number(input.display_order ?? fallbackInput.display_order ?? 0);
    const displayOrder = Number.isSafeInteger(displayOrderValue) && displayOrderValue >= 0
      ? displayOrderValue
      : 0;
    const now = new Date(nowProvider()).toISOString();
    const subscriptionAmountRaw = Number(input.subscription_amount ?? fallbackInput.subscription_amount ?? 0);
    const subscriptionCycle = String(input.subscription_cycle ?? fallbackInput.subscription_cycle ?? "").trim().toLowerCase();
    const subscriptionCurrency = String(input.subscription_currency ?? fallbackInput.subscription_currency ?? "").trim().toUpperCase();
    const subscriptionStartDate = String(input.subscription_start_date ?? fallbackInput.subscription_start_date ?? "").trim();
    const subscriptionEndDate = String(input.subscription_end_date ?? fallbackInput.subscription_end_date ?? "").trim();
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());

    return {
      id: String(input.id ?? fallbackInput.id ?? crypto.randomUUID()).trim(),
      source,
      provider_id: providerId,
      plan_id: planId,
      plan_label: catalogPlan ? catalogPlan.display_name : planLabel,
      quota_kind: quotaKind,
      quota_unit: quotaUnit,
      total_quota: totalQuota,
      total_quota_display: totalQuotaDisplay,
      quota_catalog_version: quotaCatalogVersion,
      quota_source: quotaSource,
      used_quota: finalUsedQuota,
      remaining_quota: finalRemainingQuota,
      expires_at: finalExpiresAt,
      refresh_enabled: refreshFields.refresh_enabled,
      refresh_interval_minutes: refreshFields.refresh_interval_minutes,
      refresh_method: refreshFields.refresh_method,
      credential_ref: refreshFields.credential_ref,
      last_refresh_status: refreshFields.last_refresh_status,
      last_refresh_error: refreshFields.last_refresh_error,
      last_refresh_at: refreshFields.last_refresh_at,
      next_refresh_at: refreshFields.next_refresh_at,
      // W03-R3A: Detection fields
      detection_method: detectionFields.detection_method,
      detection_config: detectionFields.detection_config,
      sync_status: detectionFields.sync_status,
      last_sync_attempt_at: detectionFields.last_sync_attempt_at,
      last_synced_at: detectionFields.last_synced_at,
      last_error_code: detectionFields.last_error_code,
      last_error_message: detectionFields.last_error_message,
      provider_reported_at: detectionFields.provider_reported_at,
      subscription_amount: Number.isFinite(subscriptionAmountRaw) && subscriptionAmountRaw > 0
        ? subscriptionAmountRaw
        : 0,
      subscription_currency: ["USD", "CNY"].includes(subscriptionCurrency) ? subscriptionCurrency : "",
      subscription_cycle: ["monthly", "yearly", "one_time"].includes(subscriptionCycle) ? subscriptionCycle : "",
      subscription_start_date: validDate(subscriptionStartDate) ? subscriptionStartDate : "",
      subscription_end_date: validDate(subscriptionEndDate) ? subscriptionEndDate : "",
      created_at: String(input.created_at ?? fallbackInput.created_at ?? now).trim(),
      updated_at: String(input.updated_at ?? fallbackInput.updated_at ?? now).trim(),
      notes,
      display_order: displayOrder,
      ...(quotaWindows.length > 0 ? { quota_windows: quotaWindows } : {}),
    };
  }

  function readTokenPlanRecords() {
    const config = readTrackerConfig();
    const records = Array.isArray(config.tokenPlans) ? config.tokenPlans : [];
    return records
      .map((record, index) => normalizeTokenPlanRecord(record, { display_order: index }))
      .sort((left, right) => left.display_order - right.display_order)
      .map((record, index) => ({ ...record, display_order: index }));
  }

  // ---------------------------------------------------------------------------
  // Q02: billing_mode derivation helpers.
  //
  // We do NOT trust queue rows to carry a `billing_mode` field today (Hermes
  // schema has it but TokenTracker doesn't forward it). Until parser support
  // lands, we infer the mode at read time using:
  //   1) explicit row field (preferred, in case the field ever appears),
  //   2) Token 濂楅 records: `plan_label` keywords matching the model name,
  //   3) source-level plan match for non-mixed sources,
  //   4) model-keyword heuristic,
  //   5) `unknown` (NEVER default to api_key).
  // ---------------------------------------------------------------------------

  // Sources where the same source can carry both API Key and Token Plan
  // traffic; per the spec, these skip the source-level Token Plan fallback so
  // a single plan record for the source can't force every model into token_plan.
  const MIXED_BILLING_SOURCES = new Set(["hermes"]);

  const TOKEN_PLAN_MODEL_KEYWORDS = [
    "mimo",
    "token plan",
    "subscription",
    "pro plan",
    "max plan",
    "plus plan",
  ];
  const API_KEY_MODEL_KEYWORDS = [
    "deepseek",
    "openrouter",
    "api key",
    "payg",
    "pay-as-you-go",
    "custom api",
  ];

  function tokenizeForKeywordMatch(value) {
    if (typeof value !== "string") return [];
    const lower = value.toLowerCase();
    // Split on any non-alphanumeric, keep latin/digit chunks.
    const parts = lower.split(/[^a-z0-9]+/g).filter(Boolean);
    // Spec: length < 3 ignored.
    return parts.filter((part) => part.length >= 3);
  }

  function tokensContainAny(tokens, keywords) {
    if (!Array.isArray(tokens) || !tokens.length) return false;
    const tokenSet = new Set(tokens);
    const joinedTokens = tokens.join(" ");
    for (const keyword of keywords) {
      const keywordTokens = tokenizeForKeywordMatch(String(keyword || ""));
      if (!keywordTokens.length) continue;
      if (keywordTokens.length === 1 && tokenSet.has(keywordTokens[0])) return true;
      if (joinedTokens.includes(keywordTokens.join(" "))) return true;
    }
    return false;
  }

  function normalizeBillingModeRaw(value) {
    if (value == null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (raw === "api_key" || raw === "api-key" || raw === "api key") return "api_key";
    if (
      raw === "payg" ||
      raw === "pay_as_you_go" ||
      raw === "pay-as-you-go"
    ) {
      return "api_key";
    }
    if (raw === "token_plan" || raw === "token-plan" || raw === "token plan") {
      return "token_plan";
    }
    if (raw === "subscription" || raw === "plan") return "token_plan";
    if (raw === "unknown" || raw === "mixed") return raw;
    return null;
  }

  function planLabelMatchesModel(planLabel, model) {
    const labelTokens = tokenizeForKeywordMatch(planLabel);
    const modelTokens = tokenizeForKeywordMatch(model);
    if (!labelTokens.length || !modelTokens.length) return false;
    // Spec: contains relationship after lowercasing + de-symbolization +
    // tokenization. Each side's tokens must intersect on at least one
    // chunk of length >= 3.
    const modelSet = new Set(modelTokens);
    for (const tok of labelTokens) {
      if (modelSet.has(tok)) return true;
    }
    return false;
  }

  function deriveModelBillingMode({ row, model, source, planRecords }) {
    // 1) Explicit row field 鈥?`billing_mode` / `billingMode`.
    const explicitRaw =
      row?.billing_mode ?? row?.billingMode ?? null;
    const explicit = normalizeBillingModeRaw(explicitRaw);
    if (explicit && explicit !== "mixed") {
      return { mode: explicit, confidence: "explicit_row" };
    }

    const safeModel = String(model || "").trim();
    const safeSource = String(source || "").trim().toLowerCase();
    const records = Array.isArray(planRecords) ? planRecords : [];
    const sourceRecords = records.filter(
      (r) => String(r?.source || "").trim().toLowerCase() === safeSource,
    );

    // 2) Token plan label match 鈥?`record.source` == source AND plan_label
    //    keywords intersect the model tokens.
    if (safeSource) {
      for (const record of sourceRecords) {
        if (planLabelMatchesModel(record?.plan_label, safeModel)) {
          return { mode: "token_plan", confidence: "token_plan_label_match" };
        }
      }
    }

    // 3) Source-level plan match 鈥?only for sources that are NOT known to mix
    //    api_key and token_plan traffic. Hermes is the canonical example.
    if (safeSource && !MIXED_BILLING_SOURCES.has(safeSource) && sourceRecords.length > 0) {
      return { mode: "token_plan", confidence: "source_token_plan_match" };
    }

    // 4) Heuristic model keyword match. Token Plan keywords win over
    //    API Key keywords when both are present.
    const modelTokens = tokenizeForKeywordMatch(safeModel);
    if (modelTokens.length) {
      if (tokensContainAny(modelTokens, TOKEN_PLAN_MODEL_KEYWORDS)) {
        return { mode: "token_plan", confidence: "heuristic_model_keyword" };
      }
      if (tokensContainAny(modelTokens, API_KEY_MODEL_KEYWORDS)) {
        return { mode: "api_key", confidence: "heuristic_model_keyword" };
      }
    }

    // 5) Fallback 鈥?never default to api_key.
    return { mode: "unknown", confidence: "fallback_unknown" };
  }

  const SOURCE_BILLING_MODE_ORDER = ["api_key", "token_plan", "unknown"];

  function summarizeSourceBillingMode(modelResults) {
    const modes = new Set();
    for (const r of Array.isArray(modelResults) ? modelResults : []) {
      if (r && (r.mode === "api_key" || r.mode === "token_plan" || r.mode === "unknown")) {
        modes.add(r.mode);
      }
    }
    const sorted = SOURCE_BILLING_MODE_ORDER.filter((m) => modes.has(m));
    let summary;
    if (sorted.length === 0) summary = "unknown";
    else if (sorted.length === 1) summary = sorted[0];
    else summary = "mixed";
    return { mode: summary, billing_modes: sorted };
  }

  function upsertTokenPlanRecord(body) {
    const payload = body && typeof body === "object" ? body : {};

    // W03-R3A: Reject forbidden plaintext credential fields
    const forbiddenCheck = tokenPlanRefresh.checkForbiddenFields(payload);
    if (!forbiddenCheck.valid) {
      const error = new Error(`不允许保存敏感字段：${forbiddenCheck.field}。请使用凭证引用代替明文秘密。`);
      error.statusCode = 400;
      throw error;
    }

    // W03-R3A: Validate api_key_ref format if present in detection_config
    if (payload.detection_config?.custom_api?.api_key_ref) {
      if (!tokenPlanRefresh.isValidApiKeyRef(payload.detection_config.custom_api.api_key_ref)) {
        const error = new Error("api_key_ref 格式无效，必须匹配 token-plan/<provider_id>/<purpose>/<uuid>");
        error.statusCode = 400;
        throw error;
      }
    }
    if (payload.detection_config?.official_account?.api_key_ref) {
      const ref = payload.detection_config.official_account.api_key_ref;
      if (ref && !tokenPlanRefresh.isValidApiKeyRef(ref)) {
        const error = new Error("api_key_ref 格式无效，必须匹配 token-plan/<provider_id>/<purpose>/<uuid>");
        error.statusCode = 400;
        throw error;
      }
    }

    const config = readTrackerConfig();
    const current = Array.isArray(config.tokenPlans) ? config.tokenPlans : [];
    const id = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : crypto.randomUUID();
    const existingIndex = current.findIndex((record) => String(record?.id || "") === id);
    const fallback = existingIndex >= 0 ? current[existingIndex] : { id };
    validateTokenPlanCatalogSelection({ ...payload, id }, fallback);
    const record = normalizeTokenPlanRecord({ ...payload, id }, fallback);
    record.updated_at = new Date(nowProvider()).toISOString();
    record.display_order = existingIndex >= 0
      ? Number.isSafeInteger(Number(fallback.display_order)) ? Number(fallback.display_order) : existingIndex
      : current.length;
    if (!record.source) {
      const error = new Error("来源不能为空");
      error.statusCode = 400;
      throw error;
    }
    const adapter = getAgentAdapter(record.source);
    if (!adapter) {
      const error = new Error(`无效的 Agent 来源：${record.source}`);
      error.statusCode = 400;
      throw error;
    }
    if (!record.plan_label) {
      const error = new Error("套餐名称不能为空");
      error.statusCode = 400;
      throw error;
    }
    const next = current.slice();
    if (existingIndex >= 0) next[existingIndex] = record;
    else next.push(record);
    config.tokenPlans = next;
    writeTrackerConfig(config);

    const previousRefs = getTokenPlanSecretRefs(fallback);
    const nextRefs = new Set(getTokenPlanSecretRefs(record));
    for (const ref of previousRefs) {
      if (!nextRefs.has(ref) && providerApiCredStore.isAvailable()) {
        providerApiCredStore.deleteSecret(ref);
        tokenPlanSecretStore.delete(ref);
      }
    }

    return { record, records: readTokenPlanRecords() };
  }

  function deleteTokenPlanRecord(body) {
    const id = String(body?.id || "").trim();
    if (!id) {
      const error = new Error("套餐 ID 不能为空");
      error.statusCode = 400;
      throw error;
    }
    const config = readTrackerConfig();
    const current = Array.isArray(config.tokenPlans) ? config.tokenPlans : [];
    const index = current.findIndex((record) => String(record?.id || "") === id);
    if (index < 0) {
      const error = new Error("Token 套餐不存在");
      error.statusCode = 404;
      throw error;
    }

    const removed = current[index];
    const remaining = current
      .filter((_, recordIndex) => recordIndex !== index)
      .map((record, displayOrder) => ({ ...record, display_order: displayOrder }));
    config.tokenPlans = remaining;
    writeTrackerConfig(config);

    const remainingRefs = new Set(remaining.flatMap((record) => getTokenPlanSecretRefs(record)));
    for (const ref of getTokenPlanSecretRefs(removed)) {
      if (remainingRefs.has(ref)) continue;
      if (providerApiCredStore.isAvailable()) providerApiCredStore.deleteSecret(ref);
      tokenPlanSecretStore.delete(ref);
    }

    return { record: normalizeTokenPlanRecord(removed), records: readTokenPlanRecords() };
  }

  const VALID_BILLING_CYCLES = new Set(["monthly", "yearly", "one_time"]);
  // F6 (02 work order): only USD and CNY are supported. The UI must not offer
  // EUR/GBP, and the backend must reject any other currency with 400
  // invalid_currency rather than silently rewriting it to USD.
  const VALID_CURRENCIES = new Set(["USD", "CNY"]);

  // 06 (work order): required-field contract. The 02 validator only rejected
  // UNKNOWN values when the field was present; missing currency/billing_cycle/
  // start_date were silently defaulted by normalizeSpendRecord to USD/monthly/
  // today, producing untrustworthy cost data. This validator now enforces all
  // six core fields on create (source, plan_label, amount, currency,
  // billing_cycle, start_date) and rejects empty/null on update for any field
  // the caller explicitly sent. It throws 400 with a structured error_code
  // (missing_required_field / invalid_currency / invalid_billing_cycle /
  // invalid_start_date / invalid_amount) and a `field` property so the UI can
  // surface the real problem instead of faking success.
  //
  // mode = "create": all six fields must be present and valid.
  // mode = "update": partial-update semantics — absent (undefined) fields are
  //   OK (normalizeSpendRecord falls back to the existing record), but
  //   empty-string or null is rejected so the backend never silently coerces
  //   an explicit empty into a default.
  function validateSpendRecordContract(input, { mode = "create" } = {}) {
    const raw = input && typeof input === "object" ? input : {};
    const isCreate = mode === "create";

    function isAbsent(v) { return v === undefined || v === null; }
    function isEmpty(v) { return typeof v === "string" && v.trim() === ""; }

    function requireField(name) {
      if (isCreate) {
        const error = new Error(`Missing required field: ${name}`);
        error.statusCode = 400;
        error.error_code = "missing_required_field";
        error.field = name;
        throw error;
      }
      // update mode: absent is OK (partial update), empty string is not.
      // An explicit empty string must NOT silently become a default value.
    }

    function rejectEmpty(name, value) {
      // Empty string / null on an explicitly-provided field is always invalid,
      // even on update — it must not silently default.
      if (isEmpty(value) || value === null) {
        const error = new Error(`Missing required field: ${name}`);
        error.statusCode = 400;
        error.error_code = "missing_required_field";
        error.field = name;
        throw error;
      }
    }

    // source
    if (isAbsent(raw.source)) requireField("source");
    else rejectEmpty("source", raw.source);

    // plan_label
    if (isAbsent(raw.plan_label)) requireField("plan_label");
    else rejectEmpty("plan_label", raw.plan_label);

    // amount — must be a positive finite number
    if (isAbsent(raw.amount)) requireField("amount");
    else {
      const amt = Number(raw.amount);
      if (isEmpty(raw.amount) || !Number.isFinite(amt) || amt <= 0) {
        const error = new Error(`Invalid amount: '${raw.amount}'. Must be a positive number.`);
        error.statusCode = 400;
        error.error_code = "invalid_amount";
        error.field = "amount";
        throw error;
      }
    }

    // currency — required, must be USD or CNY (case-insensitive)
    if (isAbsent(raw.currency)) requireField("currency");
    else {
      rejectEmpty("currency", raw.currency);
      const currency = String(raw.currency).trim().toUpperCase();
      if (!VALID_CURRENCIES.has(currency)) {
        const error = new Error(`Invalid currency: '${raw.currency}'. Must be one of: USD, CNY.`);
        error.statusCode = 400;
        error.error_code = "invalid_currency";
        error.field = "currency";
        throw error;
      }
    }

    // billing_cycle — required, must be monthly/yearly/one_time (case-insensitive)
    if (isAbsent(raw.billing_cycle)) requireField("billing_cycle");
    else {
      rejectEmpty("billing_cycle", raw.billing_cycle);
      const cycle = String(raw.billing_cycle).trim().toLowerCase();
      if (!VALID_BILLING_CYCLES.has(cycle)) {
        const error = new Error(`Invalid billing_cycle: '${raw.billing_cycle}'. Must be one of: monthly, yearly, one_time.`);
        error.statusCode = 400;
        error.error_code = "invalid_billing_cycle";
        error.field = "billing_cycle";
        throw error;
      }
    }

    // start_date — required, must be a valid YYYY-MM-DD calendar date
    if (isAbsent(raw.start_date)) requireField("start_date");
    else {
      rejectEmpty("start_date", raw.start_date);
      const date = String(raw.start_date).trim();
      const isValidDate = (d) =>
        /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(`${d}T00:00:00Z`).getTime());
      if (!isValidDate(date)) {
        const error = new Error(`Invalid start_date: '${raw.start_date}'. Must be a valid YYYY-MM-DD date.`);
        error.statusCode = 400;
        error.error_code = "invalid_start_date";
        error.field = "start_date";
        throw error;
      }
    }
  }

  function writeAllTokenPlanRecords(records) {
    const config = readTrackerConfig();
    config.tokenPlans = Array.isArray(records) ? records : [];
    writeTrackerConfig(config);
  }

  // F03: 鍗曡繘绋嬭皟搴﹀櫒銆俽eadAll/upsertAll 娉ㄥ叆鏈湴瀛樺偍锛涘畾鏃跺櫒鍦?start() 鍚?
  // 閫氳繃 timer.unref() 涓嶉樆濉炶繘绋嬮€€鍑恒€俿erve.js 鍚姩鏃惰皟鐢?startTokenPlanScheduler()銆?
  // W03-R3D P0 fix: resolveApiKey reads from in-memory store only.
  // NEVER reads from config.json or any plaintext file.  Returns empty
  // string if the ref is not found (e.g. after server restart).
  function getTokenPlanSecretRefs(record) {
    const refs = [
      record?.detection_config?.official_account?.api_key_ref,
      record?.detection_config?.custom_api?.api_key_ref,
    ].filter((ref) => typeof ref === "string" && ref.trim() && tokenPlanRefresh.isValidApiKeyRef(ref));
    return [...new Set(refs)];
  }

  function resolveTokenPlanApiKey(apiKeyRef) {
    if (typeof apiKeyRef !== "string" || !apiKeyRef.trim()) return "";
    if (!tokenPlanRefresh.isValidApiKeyRef(apiKeyRef)) return "";
    return providerApiCredStore.readSecret(apiKeyRef)
      || tokenPlanSecretStore.get(apiKeyRef)
      || "";
  }

  const tokenPlanScheduler = tokenPlanRefresh.createScheduler({
    readAll: () => readTokenPlanRecords(),
    upsertAll: (records) => writeAllTokenPlanRecords(records),
    logger: console,
    resolveApiKey: resolveTokenPlanApiKey,
  });

  function startTokenPlanScheduler() {
    if (typeof tokenPlanScheduler.start === "function") tokenPlanScheduler.start();
  }

  function stopTokenPlanScheduler() {
    if (typeof tokenPlanScheduler.stop === "function") tokenPlanScheduler.stop();
  }

  async function runTokenPlanRefreshById(id) {
    return tokenPlanScheduler.refreshById(id);
  }

  async function runTokenPlanDueRefresh() {
    return tokenPlanScheduler.runDueOnce();
  }

  // --- W03C: Console session bindings (Xiaomi MiMo official console login) ---
  // Status lifecycle (server-side):
  //   pending_login  -> session metadata created, but native verify has not passed
  //   login_started  -> mirror of native LOGIN_STARTED, kept for symmetry
  //   awaiting_verification -> native verify returned AWAITING_VERIFICATION
  //   connected      -> only after native verify returns state_code=connected
  //   expired        -> native verify determined the session is no longer live
  //   revoked        -> the user deleted the session
  //   failed         -> non-official domain, session not found, or other error
  const ALLOWED_CONSOLE_PROVIDER_IDS = new Set(["xiaomi_mimo", "glm", "minimax", "codex", "claude", "cursor", "trae", "kimi"]);
  const ALLOWED_AUTH_KINDS = new Set(["official_console_session"]);
  const ALLOWED_CONSOLE_STATUSES = new Set([
    "pending_login",
    "login_started",
    "awaiting_verification",
    "connected",
    "expired",
    "revoked",
    "failed",
  ]);
  const TERMINAL_FAILURE_STATUSES = new Set(["expired", "revoked", "failed"]);

  function readConsoleSessions() {
    const config = readTrackerConfig();
    const sessions = Array.isArray(config.consoleSessions) ? config.consoleSessions : [];
    return sessions.map((session) => normalizeConsoleSession(session));
  }

  function resolveOfficialConsoleBalance(providerConfig) {
    const providerId = String(providerConfig?.providerId || "").trim();
    if (!providerId) return null;
    const connected = readConsoleSessions()
      .filter((session) => (
        session.provider_id === providerId
        && session.status === "connected"
        && session.balance
      ))
      .sort((left, right) => String(right.last_verified_at || "").localeCompare(String(left.last_verified_at || "")));
    return connected[0]?.balance || null;
  }

  function normalizeConsoleBalance(input) {
    if (!input || typeof input !== "object") return null;
    const balance = Number(input.balance);
    const availableBalance = Number(input.available_balance ?? input.availableBalance);
    const creditBalance = Number(input.credit_balance ?? input.creditBalance);
    if (![balance, availableBalance, creditBalance].every(Number.isFinite)) return null;
    return {
      balance,
      available_balance: availableBalance,
      credit_balance: creditBalance,
      currency: String(input.currency || "CNY"),
      provider_reported_at: String(input.provider_reported_at || new Date().toISOString()),
    };
  }

  function normalizeConsoleSession(input, fallback = {}) {
    const rec = input && typeof input === "object" ? input : {};
    const fb = fallback && typeof fallback === "object" ? fallback : {};
    return {
      id: String(rec.id ?? fb.id ?? crypto.randomUUID()).trim(),
      provider_id: String(rec.provider_id ?? fb.provider_id ?? "").trim(),
      auth_kind: String(rec.auth_kind ?? fb.auth_kind ?? "").trim(),
      display_name: String(rec.display_name ?? fb.display_name ?? "").trim(),
      status: String(rec.status ?? fb.status ?? "pending_login").trim(),
      session_ref: String(rec.session_ref ?? fb.session_ref ?? "").trim(),
      connected_at: String(rec.connected_at ?? fb.connected_at ?? "").trim(),
      last_verified_at: String(rec.last_verified_at ?? fb.last_verified_at ?? "").trim(),
      last_error_code: String(rec.last_error_code ?? fb.last_error_code ?? "").trim(),
      last_error_message: String(rec.last_error_message ?? fb.last_error_message ?? "").trim(),
      balance: normalizeConsoleBalance(rec.balance ?? fb.balance),
    };
  }

  function upsertConsoleSession(body) {
    const payload = body && typeof body === "object" ? body : {};
    const config = readTrackerConfig();
    const current = Array.isArray(config.consoleSessions) ? config.consoleSessions : [];

    // Only allow known console providers
    const providerId = String(payload.provider_id || "").trim();
    if (!ALLOWED_CONSOLE_PROVIDER_IDS.has(providerId)) {
      const error = new Error("provider_id must be a supported console session provider");
      error.statusCode = 400;
      throw error;
    }

    // Only allow official_console_session auth_kind
    const authKind = String(payload.auth_kind || "").trim();
    if (!ALLOWED_AUTH_KINDS.has(authKind)) {
      const error = new Error("auth_kind must be official_console_session for console session bindings");
      error.statusCode = 400;
      throw error;
    }

    const id = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : crypto.randomUUID();
    const existingIndex = current.findIndex((s) => String(s?.id || "") === id);
    const fallback = existingIndex >= 0 ? current[existingIndex] : { id };

    // Initial status MUST be pending_login. The native side is the only
    // authority for transitioning the session to "connected". Reject any
    // attempt to write a terminal or "connected" status from POST.
    const requestedStatus = String(payload.status || "pending_login").trim();
    if (requestedStatus !== "pending_login" && requestedStatus !== "login_started") {
      const error = new Error(
        "POST cannot mark the session connected; only the native verify command can do that"
      );
      error.statusCode = 400;
      throw error;
    }

    const record = normalizeConsoleSession({ ...payload, id, status: requestedStatus }, fallback);

    if (!record.session_ref) {
      const error = new Error("session_ref is required");
      error.statusCode = 400;
      throw error;
    }

    // Security: session_ref must be a path reference, not a cookie value
    if (record.session_ref.includes("cookie") ||
        record.session_ref.includes("Bearer") ||
        record.session_ref.includes("sk-") ||
        record.session_ref.includes("token=")) {
      const error = new Error("session_ref must be a path reference, not a credential value");
      error.statusCode = 400;
      throw error;
    }

    // connected_at is only meaningful when the session is actually connected
    if (record.status !== "connected") {
      record.connected_at = "";
    } else if (!record.connected_at) {
      record.connected_at = new Date().toISOString();
    }

    const next = current.slice();
    if (existingIndex >= 0) {
      next[existingIndex] = record;
    } else {
      next.push(record);
    }
    config.consoleSessions = next;
    writeTrackerConfig(config);
    return { session: record, sessions: readConsoleSessions() };
  }

  function deleteConsoleSessionById(id) {
    const config = readTrackerConfig();
    const current = Array.isArray(config.consoleSessions) ? config.consoleSessions : [];
    const index = current.findIndex((s) => String(s?.id || "") === id);
    if (index < 0) {
      const error = new Error("Session not found");
      error.statusCode = 404;
      throw error;
    }
    current.splice(index, 1);
    config.consoleSessions = current;
    writeTrackerConfig(config);
    return { ok: true };
  }

  /**
   * Apply the result of a native verify call to the stored session.
   *
   * The body MUST contain a `native_result` object that mirrors the
   * `XiaomiMimoSessionStatus` returned by the Tauri command. We never
   * trust a verify call that does not pass through the native bridge.
   */
  function verifyConsoleSessionById(id, body) {
    const payload = body && typeof body === "object" ? body : {};
    const native = payload.native_result && typeof payload.native_result === "object"
      ? payload.native_result
      : null;
    if (!native) {
      const error = new Error(
        "verify requires native_result from the Tauri bridge; the local API cannot self-verify"
      );
      error.statusCode = 400;
      throw error;
    }
    const config = readTrackerConfig();
    const current = Array.isArray(config.consoleSessions) ? config.consoleSessions : [];
    const index = current.findIndex((s) => String(s?.id || "") === id);
    if (index < 0) {
      const error = new Error("Session not found");
      error.statusCode = 404;
      throw error;
    }
    const session = normalizeConsoleSession(current[index]);
    const nativeState = String(native.state_code || "").trim();
    const nativeConnected = Boolean(native.connected);
    const nativeAuthorized = Boolean(native.authorized);
    const forbiddenNativeKeys = ["authorization", "cookie", "token", "raw_response", "headers"];
    for (const key of forbiddenNativeKeys) {
      if (Object.prototype.hasOwnProperty.call(native, key)) {
        const error = new Error(`native_result must not include sensitive field: ${key}`);
        error.statusCode = 400;
        throw error;
      }
    }

    if (nativeConnected && (
      nativeState === "connected"
      || (nativeAuthorized && nativeState === "authorized")
    )) {
      session.status = "connected";
      session.last_verified_at = new Date().toISOString();
      const quotaSyncPending = nativeState === "authorized"
        && String(native.quota_sync_status || "").trim() === "idle";
      session.last_error_code = nativeState === "authorized" && !quotaSyncPending
        ? String(native.error_code || "QUOTA_SYNC_FAILED").slice(0, 64)
        : "";
      session.last_error_message = nativeState === "authorized" && !quotaSyncPending
        ? String(native.error_message || "Authorization completed, but quota sync failed").slice(0, 256)
        : "";
      if (!session.connected_at) {
        session.connected_at = session.last_verified_at;
      }
      const balance = normalizeConsoleBalance(native.balance);
      if (balance) {
        session.balance = balance;
      }
    } else if (nativeState === "non_official_domain" || nativeState === "session_not_found") {
      session.status = "failed";
      session.last_verified_at = new Date().toISOString();
      session.last_error_code = String(native.error_code || nativeState).slice(0, 64);
      session.last_error_message = String(native.error_message || "").slice(0, 256);
    } else if (nativeState === "login_started" || nativeState === "awaiting_verification") {
      session.status = "awaiting_verification";
      session.last_verified_at = new Date().toISOString();
      session.last_error_code = "";
      session.last_error_message = "";
    } else if (nativeState === "desktop_session_not_verified" || nativeState === "not_verified") {
      session.status = "failed";
      session.last_verified_at = new Date().toISOString();
      session.last_error_code = String(native.error_code || "DESKTOP_SESSION_NOT_VERIFIED").slice(0, 64);
      session.last_error_message = String(
        native.error_message || "桌面端尚未完成真实控制台验证"
      ).slice(0, 256);
    } else {
      session.status = "failed";
      session.last_verified_at = new Date().toISOString();
      session.last_error_code = String(native.error_code || "VERIFY_FAILED").slice(0, 64);
      session.last_error_message = String(native.error_message || "验证失败").slice(0, 256);
    }

    current[index] = session;
    config.consoleSessions = current;
    writeTrackerConfig(config);
    return { session, sessions: readConsoleSessions() };
  }

  function normalizeSpendRecord(record, fallback = {}) {
    const input = record && typeof record === "object" ? record : {};
    const fallbackInput = fallback && typeof fallback === "object" ? fallback : {};
    // 06 (work order): normalize does FORMAT standardization only — case
    // normalization (usd → USD, ONE_TIME → one_time) and trimming. It does NOT
    // infer missing core fields (missing currency → USD, missing cycle →
    // monthly, missing start_date → today). The create/update path runs
    // validateSpendRecordContract FIRST, so missing required fields are
    // rejected before normalize ever sees them. On the read path, old stored
    // records with absent fields surface the empty value honestly (the UI
    // renders "—" for null/empty via formatFinancialValue from the 02 fix).
    const currency = String(input.currency ?? fallbackInput.currency ?? "").trim().toUpperCase();
    const amountValue = Number(input.amount ?? fallbackInput.amount ?? NaN);
    const billingCycle = String(input.billing_cycle ?? fallbackInput.billing_cycle ?? "").trim().toLowerCase();
    const startDate = String(input.start_date ?? fallbackInput.start_date ?? "").trim();
    const endDate = String(input.end_date ?? fallbackInput.end_date ?? "").trim();
    const now = new Date().toISOString();
    const isValidDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(`${d}T00:00:00Z`).getTime());
    return {
      id: String(input.id ?? fallbackInput.id ?? crypto.randomUUID()).trim(),
      source: String(input.source ?? fallbackInput.source ?? "").trim(),
      plan_label: String(input.plan_label ?? fallbackInput.plan_label ?? "").trim(),
      // 06: preserve the value as-is after case/trim standardization. Do NOT
      // coerce missing/invalid to 0 — the validator rejects those on write, and
      // on read an honest 0 is still 0. NaN (non-numeric garbage) → 0 for
      // arithmetic safety in downstream cost computation.
      amount: Number.isFinite(amountValue) ? amountValue : 0,
      // 06: case-standardize only (usd → USD, cny → CNY). Do NOT coerce
      // missing/unknown to USD — return the standardized value as-is so the UI
      // can honestly show "—" for empty via formatFinancialValue.
      currency,
      // 06: case-standardize only (ONE_TIME → one_time). Do NOT coerce
      // missing/unknown to monthly.
      billing_cycle: billingCycle,
      // 06: validate YYYY-MM-DD format; invalid/missing → "" (NOT today).
      start_date: isValidDate(startDate) ? startDate : "",
      end_date: isValidDate(endDate) ? endDate : "",
      note: String(input.note ?? fallbackInput.note ?? "").trim(),
      group_id: String(input.group_id ?? fallbackInput.group_id ?? "").trim(),
      favorite: Boolean(input.favorite ?? fallbackInput.favorite ?? false),
      sort_order: Number.isFinite(Number(input.sort_order ?? fallbackInput.sort_order))
        ? Number(input.sort_order ?? fallbackInput.sort_order)
        : 0,
      created_at: String(input.created_at ?? fallbackInput.created_at ?? now).trim(),
      updated_at: String(input.updated_at ?? fallbackInput.updated_at ?? now).trim(),
    };
  }

  function tokenPlanCostRecords(config) {
    const plans = Array.isArray(config?.tokenPlans) ? config.tokenPlans : [];
    return plans
      .map((plan) => normalizeTokenPlanRecord(plan))
      .filter((plan) => plan.subscription_amount > 0
        && plan.subscription_currency
        && plan.subscription_cycle
        && plan.subscription_start_date)
      .map((plan) => normalizeSpendRecord({
        id: `token-plan-cost:${plan.id}`,
        source: String(plan.source || plan.provider_id || "token_plan").trim().toLowerCase(),
        plan_label: plan.plan_label,
        amount: plan.subscription_amount,
        currency: plan.subscription_currency,
        billing_cycle: plan.subscription_cycle,
        start_date: plan.subscription_start_date,
        end_date: plan.subscription_end_date,
        note: "Token Eyes Token Plan",
        created_at: plan.created_at,
        updated_at: plan.updated_at,
      }));
  }

  function assertNoTokenPlanCostDuplicate(record, config) {
    if (String(record?.source || "").toLowerCase() !== "other_ai") return;
    const label = String(record.plan_label || "").trim().toLowerCase().replace(/\s+/g, "");
    const duplicate = tokenPlanCostRecords(config).some((plan) =>
      String(plan.plan_label || "").trim().toLowerCase().replace(/\s+/g, "") === label
      && plan.amount === record.amount
      && plan.currency === record.currency
      && plan.start_date === record.start_date);
    if (!duplicate) return;
    const error = new Error("This cost is already recorded by a Token Plan");
    error.statusCode = 409;
    error.error_code = "duplicate_token_plan_cost";
    throw error;
  }

  function withoutTokenPlanCostDuplicates(records, planCosts) {
    return records.filter((record) => {
      if (String(record?.source || "").toLowerCase() !== "other_ai") return true;
      const label = String(record.plan_label || "").trim().toLowerCase().replace(/\s+/g, "");
      return !planCosts.some((plan) =>
        String(plan.plan_label || "").trim().toLowerCase().replace(/\s+/g, "") === label
        && plan.amount === record.amount
        && plan.currency === record.currency
        && plan.start_date === record.start_date);
    });
  }

  function normalizeOtherAiSpendGroup(group, fallback = {}) {
    const input = group && typeof group === "object" ? group : {};
    const fallbackInput = fallback && typeof fallback === "object" ? fallback : {};
    const now = new Date(nowProvider()).toISOString();
    return {
      id: String(input.id ?? fallbackInput.id ?? crypto.randomUUID()).trim(),
      name: String(input.name ?? fallbackInput.name ?? "").trim(),
      parent_id: String(input.parent_id ?? fallbackInput.parent_id ?? "").trim(),
      favorite: Boolean(input.favorite ?? fallbackInput.favorite ?? false),
      sort_order: Number.isFinite(Number(input.sort_order ?? fallbackInput.sort_order))
        ? Number(input.sort_order ?? fallbackInput.sort_order)
        : 0,
      created_at: String(input.created_at ?? fallbackInput.created_at ?? now).trim(),
      updated_at: String(input.updated_at ?? fallbackInput.updated_at ?? now).trim(),
    };
  }

  function readOtherAiSpendGroups(config = readTrackerConfig()) {
    const groups = Array.isArray(config.otherAiSpendGroups) ? config.otherAiSpendGroups : [];
    return groups
      .map((group) => normalizeOtherAiSpendGroup(group))
      .filter((group) => group.id && group.name)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  }

  function saveOtherAiSpendGroup(body) {
    const payload = body && typeof body === "object" ? body : {};
    const name = String(payload.name || "").trim();
    if (!name) {
      const error = new Error("name is required");
      error.statusCode = 400;
      throw error;
    }
    const config = readTrackerConfig();
    const current = readOtherAiSpendGroups(config);
    const id = String(payload.id || "").trim();
    const existingIndex = id ? current.findIndex((group) => group.id === id) : -1;
    const existing = existingIndex >= 0 ? current[existingIndex] : null;
    const parentId = String(payload.parent_id ?? existing?.parent_id ?? "").trim();
    if (parentId) {
      const parent = current.find((candidate) => candidate.id === parentId);
      if (!parent) {
        const error = new Error("parent group not found");
        error.statusCode = 400;
        throw error;
      }
      if (parent.parent_id) {
        const error = new Error("groups support at most two levels");
        error.statusCode = 400;
        throw error;
      }
      if (parent.id === id || (id && current.some((candidate) => candidate.parent_id === id))) {
        const error = new Error("groups support at most two levels");
        error.statusCode = 400;
        throw error;
      }
    }
    const group = normalizeOtherAiSpendGroup({
      ...payload,
      id: existing?.id || id || crypto.randomUUID(),
      parent_id: parentId,
      sort_order: existing?.sort_order ?? current.length,
      created_at: existing?.created_at,
      updated_at: new Date(nowProvider()).toISOString(),
    }, existing || {});
    if (existingIndex >= 0) current[existingIndex] = group;
    else current.push(group);
    config.otherAiSpendGroups = current;
    writeTrackerConfig(config);
    return { group, groups: readOtherAiSpendGroups(config) };
  }

  function reorderOtherAiSpendGroups(body) {
    const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const config = readTrackerConfig();
    const current = readOtherAiSpendGroups(config);
    if (ids.length !== current.length || new Set(ids).size !== current.length || ids.some((id) => !current.some((group) => group.id === id))) {
      const error = new Error("ids must contain every group exactly once");
      error.statusCode = 400;
      throw error;
    }
    const order = new Map(ids.map((id, index) => [id, index]));
    config.otherAiSpendGroups = current.map((group) => ({ ...group, sort_order: order.get(group.id) }));
    writeTrackerConfig(config);
    return { groups: readOtherAiSpendGroups(config) };
  }

  function deleteOtherAiSpendGroup(body) {
    const id = String(body?.id || "").trim();
    if (!id) {
      const error = new Error("id is required");
      error.statusCode = 400;
      throw error;
    }
    const config = readTrackerConfig();
    const current = readOtherAiSpendGroups(config);
    if (!current.some((group) => group.id === id)) {
      const error = new Error("group not found");
      error.statusCode = 404;
      throw error;
    }
    const removedIds = new Set([
      id,
      ...current.filter((group) => group.parent_id === id).map((group) => group.id),
    ]);
    config.otherAiSpendGroups = current
      .filter((group) => !removedIds.has(group.id))
      .map((group, index) => ({ ...group, sort_order: index }));
    const records = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    config.spendRecords = records.map((record) => removedIds.has(String(record?.group_id || ""))
      ? { ...record, group_id: "", updated_at: new Date(nowProvider()).toISOString() }
      : record);
    writeTrackerConfig(config);
    return { groups: readOtherAiSpendGroups(config) };
  }

  /**
   * Compute subscription cost for a single record within [from, to] month range.
   * Returns USD amount contributed by this record.
   */
  function computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny) {
    const amountUsd = record.currency === "CNY" ? record.amount / usdToCny : record.amount;
    const cycle = record.billing_cycle;

    // Determine record effective range
    const recStart = new Date(`${record.start_date}T00:00:00Z`);
    const recEnd = record.end_date ? new Date(`${record.end_date}T00:00:00Z`) : toDate;

    // one_time: count only if start_date falls within [from, to]
    if (cycle === "one_time") {
      if (recStart >= fromDate && recStart <= toDate) return amountUsd;
      return 0;
    }

    // monthly/yearly: count for each overlapping natural month
    let total = 0;
    const monthlyAmount = cycle === "yearly" ? amountUsd / 12 : amountUsd;

    // Iterate over natural months that could overlap [fromDate, toDate].
    // Normalize iter to the first day of the month containing fromDate so the
    // first natural month is fully evaluated (otherwise a mid-month fromDate
    // such as 2026-06-30 would start the cursor on the 30th, and
    // setUTCMonth(+1) preserves the day, jumping to 2026-07-30 and skipping
    // July entirely when toDate is earlier in that month).
    // The upper bound is the last day of the month containing toDate, so the
    // final partial month is never skipped.
    const iter = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
    const monthEndBound = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() + 1, 0));
    monthEndBound.setUTCHours(23, 59, 59, 999);
    while (iter <= monthEndBound) {
      const monthStart = new Date(iter);
      const monthEnd = new Date(Date.UTC(iter.getUTCFullYear(), iter.getUTCMonth() + 1, 0));
      monthEnd.setUTCHours(23, 59, 59, 999);

      // Check if record's effective range overlaps this month
      if (recStart <= monthEnd && recEnd >= monthStart) {
        total += monthlyAmount;
      }

      // Move to next month
      iter.setUTCMonth(iter.getUTCMonth() + 1);
    }

    return total;
  }

  /**
   * Compute API cost from queue rows for a given date range and source filter.
   * Returns USD cost.
   */
  function computeApiCostForRange(fromDate, toDate, source, timeZoneContext, sources) {
    try {
      const allRows = readQueueData(qp);
      let rows = source
        ? allRows.filter((r) => (r.source || "").toLowerCase() === source.toLowerCase())
        : allRows;
      // Filter by sources allowlist if provided
      if (sources && Array.isArray(sources)) {
        const sourcesSet = new Set(sources.map(s => s.toLowerCase()));
        rows = rows.filter((r) => sourcesSet.has((r.source || "").toLowerCase()));
      }
      const pricingOptions = getPricingOptions();
      const daily = aggregateByDay(rows, timeZoneContext, pricingOptions).filter((d) => d.day >= fromDate.toISOString().slice(0, 10) && d.day <= toDate.toISOString().slice(0, 10));
      return daily.reduce((sum, d) => sum + (d.total_cost_usd || 0), 0);
    } catch (e) {
      // If queue data is unavailable, return 0 (no API cost data)
      return 0;
    }
  }

  function summarizeSpendRecords(records, fromStr, toStr, timeZoneContext, sources) {
    const usdToCny = getUsdToCny();
    const today = new Date(nowProvider());

    // Default to current month if no from/to
    const fromDate = fromStr ? new Date(`${fromStr}T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const toDate = toStr ? new Date(`${toStr}T00:00:00Z`) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    toDate.setUTCHours(23, 59, 59, 999);

    // Lifetime range: from epoch to today
    const lifetimeFrom = new Date("2000-01-01T00:00:00Z");
    const localTodayKey = formatPartsDayKey(getZonedParts(today, timeZoneContext));
    const lifetimeTo = new Date(`${localTodayKey || today.toISOString().slice(0, 10)}T23:59:59.999Z`);

    // Ticket-07 Task 4: filter sources if provided
    const sourcesSet = sources ? new Set(sources) : null;

    // Collect all sources: subscription records + queue rows (API-only sources)
    const allSources = new Set();
    let periodSubscriptionUsd = 0;
    let lifetimeSubscriptionUsd = 0;
    let periodOtherAiUsd = 0;
    let lifetimeOtherAiUsd = 0;

    // by_source: { source -> { subscription_usd, other_ai_usd, api_usd } }
    const bySourceMap = new Map();

    for (const record of records) {
      const src = (record.source || "unknown").toLowerCase();
      // Ticket-07 Task 4: skip if source not in allowlist
      if (sourcesSet && !sourcesSet.has(src)) continue;

      allSources.add(src);
      if (!bySourceMap.has(src)) {
        bySourceMap.set(src, { source: src, subscription_usd: 0, other_ai_usd: 0, api_usd: 0 });
      }
      const periodCost = computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny);
      const lifetimeCost = computeSubscriptionCostForRange(record, lifetimeFrom, lifetimeTo, usdToCny);
      if (src === "other_ai") {
        periodOtherAiUsd += periodCost;
        lifetimeOtherAiUsd += lifetimeCost;
        bySourceMap.get(src).other_ai_usd += periodCost;
      } else {
        periodSubscriptionUsd += periodCost;
        lifetimeSubscriptionUsd += lifetimeCost;
        bySourceMap.get(src).subscription_usd += periodCost;
      }
    }

    // Period API cost (filtered by sources allowlist)
    const periodApiUsd = computeApiCostForRange(fromDate, toDate, null, timeZoneContext, sources);

    // Lifetime API cost (filtered by sources allowlist)
    const lifetimeApiUsd = computeApiCostForRange(lifetimeFrom, lifetimeTo, null, timeZoneContext, sources);

    // Collect API-only sources from queue rows that have usage in this period.
    // Must use rowDayKey (timezone-aware) so the day matches the same window that
    // computeApiCostForRange / aggregateByDay use internally.
    // Use effective fromKey/toKey (always defined) so the default-current-month
    // case also filters out API-only sources that fall outside the period.
    const fromKey = fromDate.toISOString().slice(0, 10);
    const toKey = toDate.toISOString().slice(0, 10);
    try {
      const allRows = readQueueData(qp);
      for (const row of allRows) {
        if (!row.hour_start) continue;
        const day = rowDayKey(row, timeZoneContext);
        if (!day) continue;
        if (day < fromKey || day > toKey) continue;
        const src = (row.source || "").toLowerCase();
        // Ticket-07 Task 4: skip if source not in allowlist
        if (sourcesSet && !sourcesSet.has(src)) continue;

        if (src && !allSources.has(src)) {
          allSources.add(src);
          bySourceMap.set(src, { source: src, subscription_usd: 0, other_ai_usd: 0, api_usd: 0 });
        }
      }
    } catch (e) {
      // Queue unavailable 鈥?proceed with subscription-only sources
    }

    // Per-source API cost (for ALL sources in the union, including API-only)
    for (const [src, entry] of bySourceMap) {
      entry.api_usd = computeApiCostForRange(fromDate, toDate, src, timeZoneContext);
    }

    const periodSubscriptionCny = periodSubscriptionUsd * usdToCny;
    const periodOtherAiCny = periodOtherAiUsd * usdToCny;
    const periodApiCny = periodApiUsd * usdToCny;
    const periodCombinedUsd = periodSubscriptionUsd + periodOtherAiUsd + periodApiUsd;
    const periodCombinedCny = periodCombinedUsd * usdToCny;

    const lifetimeSubscriptionCny = lifetimeSubscriptionUsd * usdToCny;
    const lifetimeOtherAiCny = lifetimeOtherAiUsd * usdToCny;
    const lifetimeApiCny = lifetimeApiUsd * usdToCny;
    const lifetimeCombinedUsd = lifetimeSubscriptionUsd + lifetimeOtherAiUsd + lifetimeApiUsd;
    const lifetimeCombinedCny = lifetimeCombinedUsd * usdToCny;

    const round6 = (v) => Number(v.toFixed(6));

    // Build by_source array
    const bySource = Array.from(bySourceMap.values())
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((entry) => ({
        source: entry.source,
        subscription_usd: round6(entry.subscription_usd),
        subscription_cny: round6(entry.subscription_usd * usdToCny),
        other_ai_usd: round6(entry.other_ai_usd),
        other_ai_cny: round6(entry.other_ai_usd * usdToCny),
        api_usd: round6(entry.api_usd),
        api_cny: round6(entry.api_usd * usdToCny),
        combined_usd: round6(entry.subscription_usd + entry.other_ai_usd + entry.api_usd),
        combined_cny: round6((entry.subscription_usd + entry.other_ai_usd + entry.api_usd) * usdToCny),
      }));

    return {
      totals: {
        subscription_usd: round6(periodSubscriptionUsd),
        subscription_cny: round6(periodSubscriptionCny),
        other_ai_usd: round6(periodOtherAiUsd),
        other_ai_cny: round6(periodOtherAiCny),
        api_usd: round6(periodApiUsd),
        api_cny: round6(periodApiCny),
        combined_usd: round6(periodCombinedUsd),
        combined_cny: round6(periodCombinedCny),
        lifetime_subscription_usd: round6(lifetimeSubscriptionUsd),
        lifetime_subscription_cny: round6(lifetimeSubscriptionCny),
        lifetime_other_ai_usd: round6(lifetimeOtherAiUsd),
        lifetime_other_ai_cny: round6(lifetimeOtherAiCny),
        lifetime_api_usd: round6(lifetimeApiUsd),
        lifetime_api_cny: round6(lifetimeApiCny),
        lifetime_combined_usd: round6(lifetimeCombinedUsd),
        lifetime_combined_cny: round6(lifetimeCombinedCny),
        // Backward-compatible legacy fields
        total_usd: round6(periodCombinedUsd),
        total_cny: round6(periodCombinedCny),
      },
      by_source: bySource,
    };
  }

  function readSpendRecords(fromStr, toStr, timeZoneContext, sources, summaryMonth) {
    const config = readTrackerConfig();
    const records = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    const normalized = records
      .map((record) => normalizeSpendRecord(record))
      .sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
    // Ticket-07 Task 4: filter records by sources before returning
    const sourcesSet = sources ? new Set(sources) : null;
    const filteredRecords = sourcesSet
      ? normalized.filter((record) => sourcesSet.has((record.source || "unknown").toLowerCase()))
      : normalized;
    const planCostRecords = tokenPlanCostRecords(config);
    const canonicalRecords = withoutTokenPlanCostDuplicates(normalized, planCostRecords);
    const filteredPlanCosts = sourcesSet
      ? planCostRecords.filter((record) => sourcesSet.has((record.source || "unknown").toLowerCase()))
      : planCostRecords;
    const canonicalFilteredRecords = sourcesSet
      ? canonicalRecords.filter((record) => sourcesSet.has((record.source || "unknown").toLowerCase()))
      : canonicalRecords;
    const groups = readOtherAiSpendGroups(config);
    return {
      records: filteredRecords,
      other_ai_groups: groups,
      other_ai_group_totals: summarizeOtherAiSpendGroups(normalized, groups, timeZoneContext, summaryMonth),
      ...summarizeSpendRecords([...canonicalFilteredRecords, ...filteredPlanCosts], fromStr, toStr, timeZoneContext, sources),
    };
  }

  function summarizeOtherAiSpendGroups(records, groups, timeZoneContext, requestedSummaryMonth) {
    const today = new Date(nowProvider());
    const localTodayKey = formatPartsDayKey(getZonedParts(today, timeZoneContext));
    const todayKey = localTodayKey || today.toISOString().slice(0, 10);
    const currentMonth = todayKey.slice(0, 7);
    const requestedMonth = String(requestedSummaryMonth || "").trim();
    const summaryMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= currentMonth
      ? requestedMonth
      : currentMonth;
    const year = Number(summaryMonth.slice(0, 4));
    const month = Number(summaryMonth.slice(5, 7));
    const monthFrom = new Date(Date.UTC(year, month - 1, 1));
    const yearFrom = new Date(Date.UTC(year, 0, 1));
    const lifetimeFrom = new Date("2000-01-01T00:00:00Z");
    const selectedToKey = summaryMonth === currentMonth
      ? todayKey
      : new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const toDate = new Date(`${selectedToKey}T23:59:59.999Z`);
    const lifetimeTo = new Date(`${todayKey}T23:59:59.999Z`);
    const usdToCny = getUsdToCny();
    const otherAiRecords = records.filter((record) => record.source === "other_ai");
    const groupIds = new Set(groups.map((group) => group.id));
    const buckets = groups.map((group) => ({ id: group.id, name: group.name, parent_id: group.parent_id, sort_order: group.sort_order }));
    if (otherAiRecords.some((record) => !record.group_id || !groupIds.has(record.group_id))) {
      buckets.push({ id: "", name: "未分组", sort_order: Number.MAX_SAFE_INTEGER });
    }
    const round6 = (value) => Number(value.toFixed(6));
    return buckets.map((group) => {
      const groupRecords = otherAiRecords.filter((record) => group.id
        ? record.group_id === group.id
        : !record.group_id || !groupIds.has(record.group_id));
      const sum = (from) => groupRecords.reduce(
        (total, record) => total + computeSubscriptionCostForRange(record, from, toDate, usdToCny),
        0,
      );
      const monthUsd = sum(monthFrom);
      const yearUsd = sum(yearFrom);
      const lifetimeUsd = groupRecords.reduce(
        (total, record) => total + computeSubscriptionCostForRange(record, lifetimeFrom, lifetimeTo, usdToCny),
        0,
      );
      return {
        group_id: group.id,
        group_name: group.name,
        summary_month: summaryMonth,
        sort_order: group.sort_order,
        record_count: groupRecords.length,
        month_usd: round6(monthUsd),
        month_cny: round6(monthUsd * usdToCny),
        year_usd: round6(yearUsd),
        year_cny: round6(yearUsd * usdToCny),
        lifetime_usd: round6(lifetimeUsd),
        lifetime_cny: round6(lifetimeUsd * usdToCny),
      };
    });
  }

  function createSpendRecord(body) {
    const payload = body && typeof body === "object" ? body : {};
    // 06: validate the wire contract BEFORE normalization with mode="create"
    // so ALL six required fields (source, plan_label, amount, currency,
    // billing_cycle, start_date) are enforced. Missing/empty/null fields are
    // rejected with 400 missing_required_field + field name; invalid values
    // get invalid_currency / invalid_billing_cycle / invalid_start_date /
    // invalid_amount. normalizeSpendRecord then only standardizes case/trim.
    validateSpendRecordContract(payload, { mode: "create" });
    const record = normalizeSpendRecord(payload);
    // Defense-in-depth: the validator already rejected missing/invalid source,
    // plan_label, and amount. These post-normalize guards are kept as a safety
    // net but should never fire under the new contract.
    if (!record.source || !record.plan_label) {
      const error = new Error("source and plan_label are required");
      error.statusCode = 400;
      error.error_code = "missing_required_field";
      throw error;
    }
    if (!(Number.isFinite(record.amount) && record.amount > 0)) {
      const error = new Error("amount must be greater than 0");
      error.statusCode = 400;
      error.error_code = "invalid_amount";
      error.field = "amount";
      throw error;
    }
    const config = readTrackerConfig();
    assertNoTokenPlanCostDuplicate(record, config);
    const current = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    config.spendRecords = [record, ...current];
    writeTrackerConfig(config);
    return { record, ...readSpendRecords() };
  }

  function updateSpendRecord(body) {
    const payload = body && typeof body === "object" ? body : {};
    if (payload.action === "reorder") {
      return reorderSpendRecords(payload);
    }
    const id = String(payload.id || "").trim();
    if (!id) {
      const error = new Error("id is required for update");
      error.statusCode = 400;
      throw error;
    }
    // 06: validate with mode="update" — partial-update semantics. Absent
    // (undefined) fields are OK (normalizeSpendRecord falls back to the
    // existing record), but empty-string/null is rejected so the backend never
    // silently coerces an explicit empty into a default value.
    validateSpendRecordContract(payload, { mode: "update" });
    const config = readTrackerConfig();
    const current = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    const existingIndex = current.findIndex((r) => String(r?.id || "") === id);
    if (existingIndex < 0) {
      const error = new Error("record not found");
      error.statusCode = 404;
      throw error;
    }
    const existing = current[existingIndex];
    const record = normalizeSpendRecord(payload, existing);
    if (!record.source || !record.plan_label) {
      const error = new Error("source and plan_label are required");
      error.statusCode = 400;
      error.error_code = "missing_required_field";
      throw error;
    }
    if (!(Number.isFinite(record.amount) && record.amount > 0)) {
      const error = new Error("amount must be greater than 0");
      error.statusCode = 400;
      error.error_code = "invalid_amount";
      error.field = "amount";
      throw error;
    }
    assertNoTokenPlanCostDuplicate(record, config);
    // Preserve id and created_at from existing, refresh updated_at
    record.id = id;
    record.created_at = existing.created_at || record.created_at;
    record.updated_at = new Date().toISOString();
    current[existingIndex] = record;
    config.spendRecords = current;
    writeTrackerConfig(config);
    return { record, ...readSpendRecords() };
  }

  function reorderSpendRecords(body) {
    const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
    const config = readTrackerConfig();
    const current = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    const otherAi = current.filter((record) => String(record?.source || "").toLowerCase() === "other_ai");
    if (ids.length !== otherAi.length || new Set(ids).size !== otherAi.length || ids.some((id) => !otherAi.some((record) => String(record?.id || "") === id))) {
      const error = new Error("ids must contain every other_ai record exactly once");
      error.statusCode = 400;
      throw error;
    }
    const order = new Map(ids.map((id, index) => [id, index]));
    const movedId = String(body?.moved_id || "").trim();
    const groupId = String(body?.group_id || "").trim();
    if (movedId && !otherAi.some((record) => String(record?.id || "") === movedId)) {
      const error = new Error("moved record not found");
      error.statusCode = 400;
      throw error;
    }
    if (groupId && !readOtherAiSpendGroups(config).some((group) => group.id === groupId)) {
      const error = new Error("target group not found");
      error.statusCode = 400;
      throw error;
    }
    config.spendRecords = current.map((record) => String(record?.source || "").toLowerCase() === "other_ai"
      ? {
          ...record,
          sort_order: order.get(String(record?.id || "")),
          ...(movedId && String(record?.id || "") === movedId
            ? { group_id: groupId, updated_at: new Date(nowProvider()).toISOString() }
            : {}),
        }
      : record);
    writeTrackerConfig(config);
    return readSpendRecords();
  }

  function deleteSpendRecord(body) {
    const id = String(body?.id || "").trim();
    if (!id) {
      const error = new Error("id is required");
      error.statusCode = 400;
      throw error;
    }
    const config = readTrackerConfig();
    const current = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    config.spendRecords = current.filter((record) => String(record?.id || "") !== id);
    writeTrackerConfig(config);
    return readSpendRecords();
  }

  function inferBucket(fromDate, toDate, requestedBucket) {
    if (requestedBucket && ["hour", "day", "week"].includes(requestedBucket)) {
      return requestedBucket;
    }
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return "hour";
    if (diffDays <= 120) return "day";
    return "week";
  }

  function validateBucketRange(fromDate, toDate, bucket) {
    const diffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    switch (bucket) {
      case "hour":
        return diffDays <= 31;
      case "day":
        return diffDays <= 366;
      case "week":
        return diffDays <= 260 * 7;
      default:
        return true;
    }
  }

  function formatBucketStart(parts, bucket) {
    const y = parts.year;
    const m = String(parts.month).padStart(2, "0");
    const d = String(parts.day).padStart(2, "0");
    const h = String(parts.hour).padStart(2, "0");
    switch (bucket) {
      case "hour":
        return `${y}-${m}-${d}T${h}:00:00`;
      case "day":
        return `${y}-${m}-${d}`;
      case "week": {
        const date = new Date(Date.UTC(y, parts.month - 1, parts.day));
        const dayOfWeek = date.getUTCDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(date);
        monday.setUTCDate(date.getUTCDate() + mondayOffset);
        return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
      }
      default:
        return `${y}-${m}-${d}`;
    }
  }

  function formatBucketEnd(bucketStart, bucket) {
    if (!bucketStart) return "";
    switch (bucket) {
      case "hour": {
        const [datePart, timePart] = bucketStart.split("T");
        const [h] = timePart.split(":");
        const nextHour = Number(h) + 1;
        if (nextHour >= 24) {
          const d = new Date(`${datePart}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          return `${d.toISOString().slice(0, 10)}T00:00:00`;
        }
        return `${datePart}T${String(nextHour).padStart(2, "0")}:00:00`;
      }
      case "day":
        return bucketStart;
      case "week": {
        const d = new Date(`${bucketStart}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 6);
        return d.toISOString().slice(0, 10);
      }
      default:
        return bucketStart;
    }
  }

  function generateBucketLabel(bucketStart, bucket) {
    if (!bucketStart) return "";
    switch (bucket) {
      case "hour": {
        const [datePart, timePart] = bucketStart.split("T");
        const [h] = timePart.split(":");
        const [, m, d] = datePart.split("-");
        return `${m}-${d} ${h}:00`;
      }
      case "day": {
        const [, m, d] = bucketStart.split("-");
        return `${m}-${d}`;
      }
      case "week": {
        const d = new Date(`${bucketStart}T00:00:00Z`);
        const end = new Date(d);
        end.setUTCDate(d.getUTCDate() + 6);
        const m1 = String(d.getUTCMonth() + 1).padStart(2, "0");
        const d1 = String(d.getUTCDate()).padStart(2, "0");
        const m2 = String(end.getUTCMonth() + 1).padStart(2, "0");
        const d2 = String(end.getUTCDate()).padStart(2, "0");
        if (d.getUTCMonth() === end.getUTCMonth()) {
          return `${m1}-${d1}~${d2}`;
        }
        return `${m1}-${d1}~${m2}-${d2}`;
      }
      default:
        return bucketStart;
    }
  }

  function generateAllBuckets(fromDate, toDate, bucket, timeZoneContext) {
    const buckets = [];
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const parts = getZonedParts(cursor, timeZoneContext);
      if (!parts) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }
      const bucketStart = formatBucketStart(parts, bucket);
      if (!buckets.length || buckets[buckets.length - 1] !== bucketStart) {
        buckets.push(bucketStart);
      }
      switch (bucket) {
        case "hour":
          cursor.setUTCHours(cursor.getUTCHours() + 1);
          break;
        case "day":
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          break;
        case "week":
          cursor.setUTCDate(cursor.getUTCDate() + 7);
          break;
        default:
          cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return buckets;
  }

  // Aggregates queue rows by (source × model × bucket) with full token breakdown.
  // Returns Map<source, Map<bucketStart, { source, bucket_start, api_cost_usd,
  //   input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens,
  //   reasoning_output_tokens, total_tokens, cost_usd,
  //   models: Map<model, { model, input_tokens, ..., total_tokens, cost_usd }> }>>.
  // `filters.sources` / `filters.models` enable multi-value row-level filtering.
  function aggregateUsageBySourceModelBucket(rows, fromDate, toDate, bucket, timeZoneContext, pricingOptions, filters = {}) {
    const fromParts = getZonedParts(fromDate, timeZoneContext);
    const toParts = getZonedParts(toDate, timeZoneContext);
    const fromKey = fromParts ? formatPartsDayKey(fromParts) : fromDate.toISOString().slice(0, 10);
    const toKey = toParts ? formatPartsDayKey(toParts) : toDate.toISOString().slice(0, 10);
    const sourcesFilter = filters.sources || null;
    const modelsFilter = filters.models || null;
    const bySourceBucket = new Map();

    for (const row of rows) {
      if (!row.hour_start) continue;
      const source = normalizeSource(row.source) || "unknown";
      if (sourcesFilter && !sourcesFilter.includes(source)) continue;
      const modelKey = String(row.model || "").trim().toLowerCase() || "unknown";
      if (modelsFilter && !modelsFilter.includes(modelKey)) continue;

      const parts = getZonedParts(new Date(row.hour_start), timeZoneContext);
      if (!parts) continue;
      const dayKey = formatPartsDayKey(parts);
      if (dayKey < fromKey || dayKey > toKey) continue;

      const bucketStart = formatBucketStart(parts, bucket);
      const costUsd = computeRowCost(row, pricingOptions);

      const key = `${source}|${bucketStart}`;
      if (!bySourceBucket.has(key)) {
        bySourceBucket.set(key, {
          source, bucket_start: bucketStart, api_cost_usd: 0,
          input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
          cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
          total_tokens: 0, cost_usd: 0,
          models: new Map(),
        });
      }
      const entry = bySourceBucket.get(key);
      entry.api_cost_usd += costUsd;
      entry.cost_usd += costUsd;
      entry.input_tokens += Number(row.input_tokens || 0);
      entry.output_tokens += Number(row.output_tokens || 0);
      entry.cached_input_tokens += Number(row.cached_input_tokens || 0);
      entry.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
      entry.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
      entry.total_tokens += Number(row.total_tokens || 0);

      if (!entry.models.has(modelKey)) {
        entry.models.set(modelKey, {
          model: row.model || "unknown",
          input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
          cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
          total_tokens: 0, cost_usd: 0,
        });
      }
      const modelEntry = entry.models.get(modelKey);
      modelEntry.cost_usd += costUsd;
      modelEntry.input_tokens += Number(row.input_tokens || 0);
      modelEntry.output_tokens += Number(row.output_tokens || 0);
      modelEntry.cached_input_tokens += Number(row.cached_input_tokens || 0);
      modelEntry.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
      modelEntry.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
      modelEntry.total_tokens += Number(row.total_tokens || 0);
    }

    return bySourceBucket;
  }

  function allocateSpendCostToBuckets(record, fromDate, toDate, bucket, timeZoneContext, usdToCny) {
    const periodCost = computeSubscriptionCostForRange(record, fromDate, toDate, usdToCny);
    if (periodCost <= 0) return [];

    const source = String(record.source || "unknown").trim().toLowerCase() || "unknown";
    if (record.billing_cycle === "one_time") {
      const fromParts = getZonedParts(fromDate, timeZoneContext);
      const toParts = getZonedParts(toDate, timeZoneContext);
      const fromKey = formatPartsDayKey(fromParts) || fromDate.toISOString().slice(0, 10);
      const toKey = formatPartsDayKey(toParts) || toDate.toISOString().slice(0, 10);
      const spendDay = String(record.start_date || "");
      if (spendDay < fromKey || spendDay > toKey) return [];

      const [year, month, day] = spendDay.split("-").map(Number);
      const bucketStart = formatBucketStart({ year, month, day, hour: 0 }, bucket);
      return [{
        source,
        bucket_start: bucketStart,
        subscription_cost_usd: source === "other_ai" ? 0 : periodCost,
        other_ai_cost_usd: source === "other_ai" ? periodCost : 0,
      }];
    }

    const fromKey = fromDate.toISOString().slice(0, 10);
    const toKey = toDate.toISOString().slice(0, 10);
    const recStart = new Date(`${record.start_date}T00:00:00Z`);
    const recEnd = record.end_date ? new Date(`${record.end_date}T00:00:00Z`) : toDate;

    const validBuckets = new Set();
    const cursor = new Date(fromDate);

    while (cursor <= toDate) {
      const parts = getZonedParts(cursor, timeZoneContext);
      if (!parts) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }
      const bucketStart = formatBucketStart(parts, bucket);
      const dayKey = formatPartsDayKey(parts);

      if (dayKey < fromKey || dayKey > toKey) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        continue;
      }

      let bucketDate;
      if (bucket === "hour") {
        bucketDate = new Date(`${bucketStart}Z`);
      } else {
        bucketDate = new Date(`${bucketStart}T00:00:00Z`);
      }

      let bucketEndDate;
      if (bucket === "hour") {
        bucketEndDate = new Date(bucketDate);
        bucketEndDate.setUTCHours(bucketEndDate.getUTCHours() + 1);
      } else if (bucket === "day") {
        bucketEndDate = new Date(bucketDate);
        bucketEndDate.setUTCDate(bucketEndDate.getUTCDate() + 1);
      } else {
        bucketEndDate = new Date(bucketDate);
        bucketEndDate.setUTCDate(bucketEndDate.getUTCDate() + 7);
      }

      const bucketStartsBeforeRecEnd = bucketDate < recEnd;
      const bucketEndsAfterRecStart = bucketEndDate > recStart;

      if (bucketStartsBeforeRecEnd && bucketEndsAfterRecStart) {
        validBuckets.add(bucketStart);
      }

      switch (bucket) {
        case "hour":
          cursor.setUTCHours(cursor.getUTCHours() + 1);
          break;
        case "day":
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          break;
        case "week":
          cursor.setUTCDate(cursor.getUTCDate() + 7);
          break;
        default:
          cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const bucketList = Array.from(validBuckets).sort();
    const n = bucketList.length;
    if (n === 0) return [];

    const round6 = (v) => Number(v.toFixed(6));
    const baseCost = round6(periodCost / n);
    const lastCost = round6(periodCost - baseCost * (n - 1));

    return bucketList.map((bucketStart, idx) => ({
      source,
      bucket_start: bucketStart,
      subscription_cost_usd: source === "other_ai" ? 0 : (idx === n - 1 ? lastCost : baseCost),
      other_ai_cost_usd: source === "other_ai" ? (idx === n - 1 ? lastCost : baseCost) : 0,
    }));
  }

  async function readSpendTimeseries(fromStr, toStr, requestedBucket, timeZoneContext, filters = {}) {
    const usdToCny = getUsdToCny();
    const pricingOptions = getPricingOptions();

    const today = new Date();
    let fromDate, toDate;
    if (fromStr) {
      const [y, m, d] = fromStr.split("-").map(Number);
      fromDate = new Date(Date.UTC(y, m - 1, d));
      if (Number.isFinite(timeZoneContext.offsetMinutes)) {
        fromDate.setUTCMinutes(fromDate.getUTCMinutes() - timeZoneContext.offsetMinutes);
      }
    } else {
      fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    }

    if (toStr) {
      const [y, m, d] = toStr.split("-").map(Number);
      toDate = new Date(Date.UTC(y, m - 1, d));
      if (Number.isFinite(timeZoneContext.offsetMinutes)) {
        toDate.setUTCMinutes(toDate.getUTCMinutes() - timeZoneContext.offsetMinutes);
      }
      toDate = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else {
      toDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
      toDate.setUTCHours(23, 59, 59, 999);
    }

    const bucket = inferBucket(fromDate, toDate, requestedBucket);

    if (!validateBucketRange(fromDate, toDate, bucket)) {
      throw Object.assign(new Error("spend timeseries range is too large for requested bucket"), { statusCode: 400 });
    }

    const fromPartsForRows = getZonedParts(fromDate, timeZoneContext);
    const toPartsForRows = getZonedParts(toDate, timeZoneContext);
    const fromKeyForRows = fromPartsForRows ? formatPartsDayKey(fromPartsForRows) : fromDate.toISOString().slice(0, 10);
    const toKeyForRows = toPartsForRows ? formatPartsDayKey(toPartsForRows) : toDate.toISOString().slice(0, 10);
    const allRows = await withCodexRolloutRows(readQueueData(qp), {
      from: fromKeyForRows,
      to: toKeyForRows,
      timeZoneContext,
      sources: filters.sources || null,
    });
    const apiAggregate = aggregateUsageBySourceModelBucket(allRows, fromDate, toDate, bucket, timeZoneContext, pricingOptions, filters);

    const config = readTrackerConfig();
    const records = Array.isArray(config.spendRecords) ? config.spendRecords : [];
    const planCosts = tokenPlanCostRecords(config);
    const normalizedRecords = [
      ...withoutTokenPlanCostDuplicates(records.map((r) => normalizeSpendRecord(r)), planCosts),
      ...planCosts,
    ];
    const spendSources = Array.isArray(filters.sources)
      ? new Set(filters.sources.map((source) => String(source).trim().toLowerCase()))
      : null;
    const filteredSpendRecords = spendSources
      ? normalizedRecords.filter((record) => spendSources.has(String(record.source || "").toLowerCase()))
      : normalizedRecords;

    const subAllocations = [];
    for (const record of filteredSpendRecords) {
      const allocations = allocateSpendCostToBuckets(record, fromDate, toDate, bucket, timeZoneContext, usdToCny);
      subAllocations.push(...allocations);
    }

    const allSources = new Set();
    for (const [key, entry] of apiAggregate) {
      allSources.add(entry.source);
    }
    for (const alloc of subAllocations) {
      allSources.add(alloc.source);
    }

    const allBuckets = generateAllBuckets(fromDate, toDate, bucket, timeZoneContext);

    const round6 = (v) => Number(v.toFixed(6));

    const seriesMap = new Map();
    for (const source of allSources) {
      for (const bucketStart of allBuckets) {
        const key = `${source}|${bucketStart}`;
        seriesMap.set(key, {
          bucket_start: bucketStart,
          bucket_end: formatBucketEnd(bucketStart, bucket),
          label: generateBucketLabel(bucketStart, bucket),
          source,
          api_cost_usd: 0,
          api_cost_cny: 0,
          subscription_cost_usd: 0,
          subscription_cost_cny: 0,
          other_ai_cost_usd: 0,
          other_ai_cost_cny: 0,
          combined_usd: 0,
          combined_cny: 0,
          // Token breakdown (sum across all models for this source × bucket).
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
          cost_usd: 0,
          // Per-model breakdown (API cost only; subscription is source-level).
          models: [],
        });
      }
    }

    for (const [key, entry] of apiAggregate) {
      const seriesEntry = seriesMap.get(key);
      if (seriesEntry) {
        seriesEntry.api_cost_usd = entry.api_cost_usd;
        seriesEntry.api_cost_cny = entry.api_cost_usd * usdToCny;
        seriesEntry.input_tokens = entry.input_tokens;
        seriesEntry.output_tokens = entry.output_tokens;
        seriesEntry.cached_input_tokens = entry.cached_input_tokens;
        seriesEntry.cache_creation_input_tokens = entry.cache_creation_input_tokens;
        seriesEntry.reasoning_output_tokens = entry.reasoning_output_tokens;
        seriesEntry.total_tokens = entry.total_tokens;
        seriesEntry.cost_usd = entry.cost_usd;
        seriesEntry.models = Array.from(entry.models.values()).map((m) => ({
          model: m.model,
          input_tokens: m.input_tokens,
          output_tokens: m.output_tokens,
          cached_input_tokens: m.cached_input_tokens,
          cache_creation_input_tokens: m.cache_creation_input_tokens,
          reasoning_output_tokens: m.reasoning_output_tokens,
          total_tokens: m.total_tokens,
          cost_usd: Number(m.cost_usd.toFixed(6)),
        }));
      }
    }

    for (const alloc of subAllocations) {
      const key = `${alloc.source}|${alloc.bucket_start}`;
      const seriesEntry = seriesMap.get(key);
      if (seriesEntry) {
        seriesEntry.subscription_cost_usd = seriesEntry.subscription_cost_usd + alloc.subscription_cost_usd;
        seriesEntry.subscription_cost_cny = seriesEntry.subscription_cost_usd * usdToCny;
        seriesEntry.other_ai_cost_usd = seriesEntry.other_ai_cost_usd + alloc.other_ai_cost_usd;
        seriesEntry.other_ai_cost_cny = seriesEntry.other_ai_cost_usd * usdToCny;
      }
    }

    for (const entry of seriesMap.values()) {
      entry.combined_usd = entry.api_cost_usd + entry.subscription_cost_usd + entry.other_ai_cost_usd;
      entry.combined_cny = entry.combined_usd * usdToCny;
    }

    const series = Array.from(seriesMap.values()).sort((a, b) => {
      const cmpBucket = a.bucket_start.localeCompare(b.bucket_start);
      if (cmpBucket !== 0) return cmpBucket;
      return a.source.localeCompare(b.source);
    });

    const totals = {
      api_cost_usd: 0,
      api_cost_cny: 0,
      subscription_cost_usd: 0,
      subscription_cost_cny: 0,
      other_ai_cost_usd: 0,
      other_ai_cost_cny: 0,
      combined_usd: 0,
      combined_cny: 0,
    };

    for (const entry of series) {
      totals.api_cost_usd += entry.api_cost_usd;
      totals.api_cost_cny += entry.api_cost_cny;
      totals.subscription_cost_usd += entry.subscription_cost_usd;
      totals.subscription_cost_cny += entry.subscription_cost_cny;
      totals.other_ai_cost_usd += entry.other_ai_cost_usd;
      totals.other_ai_cost_cny += entry.other_ai_cost_cny;
      totals.combined_usd += entry.combined_usd;
      totals.combined_cny += entry.combined_cny;
    }

    for (const key of Object.keys(totals)) {
      totals[key] = round6(totals[key]);
    }

    // 04-独立贝叶斯验收 fix (B6-7): Add backward-compatible field aliases and
    // lifetime totals to the timeseries response. The frontend use-cost-accumulation.js
    // hook reads `api_usd`/`subscription_usd`/`lifetime_combined_usd` (matching
    // summarizeSpendRecords naming), but the timeseries used `api_cost_usd`/
    // `subscription_cost_usd` and had no lifetime fields. Without these aliases,
    // `|| 0` silently converted undefined to 0, showing false USD 0.00 in the
    // Cost Summary Cards.
    totals.api_usd = totals.api_cost_usd;
    totals.subscription_usd = totals.subscription_cost_usd;
    totals.other_ai_usd = totals.other_ai_cost_usd;
    totals.usd_to_cny = usdToCny;
    try {
      const lifetimeSummary = summarizeSpendRecords(
        filteredSpendRecords, fromStr, toStr, timeZoneContext, filters.sources,
      );
      totals.lifetime_combined_usd = lifetimeSummary.totals.lifetime_combined_usd;
      totals.lifetime_api_usd = lifetimeSummary.totals.lifetime_api_usd;
      totals.lifetime_subscription_usd = lifetimeSummary.totals.lifetime_subscription_usd;
      totals.lifetime_other_ai_usd = lifetimeSummary.totals.lifetime_other_ai_usd;
    } catch (_e) {
      // Lifetime computation failed; lifetime_* fields remain undefined.
      // Frontend falls back to 0 via || 0 (acceptable degradation, not false data).
    }

    // Token totals via shared aggregator — guarantees three-way caliber
    // consistency with usage-summary and request-usage-records totals.
    const fromPartsTs = getZonedParts(fromDate, timeZoneContext);
    const toPartsTs = getZonedParts(toDate, timeZoneContext);
    const fromKeyTs = fromPartsTs ? formatPartsDayKey(fromPartsTs) : fromDate.toISOString().slice(0, 10);
    const toKeyTs = toPartsTs ? formatPartsDayKey(toPartsTs) : toDate.toISOString().slice(0, 10);
    const queueTotals = computeQueueTotals(allRows, {
      fromKey: fromKeyTs,
      toKey: toKeyTs,
      timeZoneContext,
      pricingOptions,
      sources: filters.sources || null,
      models: filters.models || null,
    });
    totals.input_tokens = queueTotals.input_tokens;
    totals.output_tokens = queueTotals.output_tokens;
    totals.cached_input_tokens = queueTotals.cached_input_tokens;
    totals.cache_creation_input_tokens = queueTotals.cache_creation_input_tokens;
    totals.reasoning_output_tokens = queueTotals.reasoning_output_tokens;
    totals.total_tokens = queueTotals.total_tokens;
    totals.cost_usd = queueTotals.cost_usd;

    const bySourceMap = new Map();
    for (const source of allSources) {
      bySourceMap.set(source, {
        source,
        api_cost_usd: 0,
        api_cost_cny: 0,
        subscription_cost_usd: 0,
        subscription_cost_cny: 0,
        other_ai_cost_usd: 0,
        other_ai_cost_cny: 0,
        combined_usd: 0,
        combined_cny: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        cost_usd: 0,
      });
    }

    for (const entry of series) {
      const sa = bySourceMap.get(entry.source);
      sa.api_cost_usd += entry.api_cost_usd;
      sa.api_cost_cny += entry.api_cost_cny;
      sa.subscription_cost_usd += entry.subscription_cost_usd;
      sa.subscription_cost_cny += entry.subscription_cost_cny;
      sa.other_ai_cost_usd += entry.other_ai_cost_usd;
      sa.other_ai_cost_cny += entry.other_ai_cost_cny;
      sa.combined_usd += entry.combined_usd;
      sa.combined_cny += entry.combined_cny;
      sa.input_tokens += entry.input_tokens;
      sa.output_tokens += entry.output_tokens;
      sa.cached_input_tokens += entry.cached_input_tokens;
      sa.cache_creation_input_tokens += entry.cache_creation_input_tokens;
      sa.reasoning_output_tokens += entry.reasoning_output_tokens;
      sa.total_tokens += entry.total_tokens;
      sa.cost_usd += entry.cost_usd;
    }

    for (const sa of bySourceMap.values()) {
      sa.api_cost_usd = round6(sa.api_cost_usd);
      sa.api_cost_cny = round6(sa.api_cost_cny);
      sa.subscription_cost_usd = round6(sa.subscription_cost_usd);
      sa.subscription_cost_cny = round6(sa.subscription_cost_cny);
      sa.other_ai_cost_usd = round6(sa.other_ai_cost_usd);
      sa.other_ai_cost_cny = round6(sa.other_ai_cost_cny);
      sa.combined_usd = round6(sa.combined_usd);
      sa.combined_cny = round6(sa.combined_cny);
      sa.cost_usd = round6(sa.cost_usd);
    }

    for (const entry of series) {
      entry.api_cost_usd = round6(entry.api_cost_usd);
      entry.api_cost_cny = round6(entry.api_cost_cny);
      entry.subscription_cost_usd = round6(entry.subscription_cost_usd);
      entry.subscription_cost_cny = round6(entry.subscription_cost_cny);
      entry.other_ai_cost_usd = round6(entry.other_ai_cost_usd);
      entry.other_ai_cost_cny = round6(entry.other_ai_cost_cny);
      entry.combined_usd = round6(entry.combined_usd);
      entry.combined_cny = round6(entry.combined_cny);
      entry.cost_usd = round6(entry.cost_usd);
    }

    for (const [source, sa] of bySourceMap) {
      const entries = [];
      for (const entry of series) {
        if (entry.source === source) {
          entries.push(entry);
        }
      }

      const targetUsd = sa.combined_usd;
      const targetCny = sa.combined_cny;

      let sumUsd = 0;
      let sumCny = 0;
      for (const entry of entries) {
        sumUsd += entry.combined_usd;
        sumCny += entry.combined_cny;
      }

      if (Math.abs(sumUsd - targetUsd) > 1e-10 || Math.abs(sumCny - targetCny) > 1e-10) {
        const nonZeroEntries = entries.filter((e) => e.combined_usd !== 0 || e.combined_cny !== 0);
        const targetEntry = nonZeroEntries.length > 0 ? nonZeroEntries[nonZeroEntries.length - 1] : entries[entries.length - 1];

        let otherSumUsd = 0;
        let otherSumCny = 0;
        for (const e of entries) {
          if (e !== targetEntry) {
            otherSumUsd += e.combined_usd;
            otherSumCny += e.combined_cny;
          }
        }

        targetEntry.combined_usd = round6(targetUsd - otherSumUsd);
        targetEntry.combined_cny = round6(targetCny - otherSumCny);

        const oldTotal = targetEntry.api_cost_usd
          + targetEntry.subscription_cost_usd
          + targetEntry.other_ai_cost_usd;
        if (oldTotal !== 0) {
          const apiRatio = targetEntry.api_cost_usd / oldTotal;
          const subscriptionRatio = targetEntry.subscription_cost_usd / oldTotal;
          targetEntry.api_cost_usd = round6(targetEntry.combined_usd * apiRatio);
          targetEntry.subscription_cost_usd = round6(targetEntry.combined_usd * subscriptionRatio);
          targetEntry.other_ai_cost_usd = round6(
            targetEntry.combined_usd - targetEntry.api_cost_usd - targetEntry.subscription_cost_usd,
          );
          targetEntry.api_cost_cny = round6(targetEntry.combined_cny * apiRatio);
          targetEntry.subscription_cost_cny = round6(targetEntry.combined_cny * subscriptionRatio);
          targetEntry.other_ai_cost_cny = round6(
            targetEntry.combined_cny - targetEntry.api_cost_cny - targetEntry.subscription_cost_cny,
          );
        } else if (targetEntry.source === "other_ai") {
          targetEntry.api_cost_usd = 0;
          targetEntry.subscription_cost_usd = 0;
          targetEntry.other_ai_cost_usd = targetEntry.combined_usd;
          targetEntry.api_cost_cny = 0;
          targetEntry.subscription_cost_cny = 0;
          targetEntry.other_ai_cost_cny = targetEntry.combined_cny;
        } else {
          targetEntry.api_cost_usd = 0;
          targetEntry.subscription_cost_usd = targetEntry.combined_usd;
          targetEntry.other_ai_cost_usd = 0;
          targetEntry.api_cost_cny = 0;
          targetEntry.subscription_cost_cny = targetEntry.combined_cny;
          targetEntry.other_ai_cost_cny = 0;
        }
      }
    }

    const bySource = Array.from(bySourceMap.values()).sort((a, b) => a.source.localeCompare(b.source));
    const sources = Array.from(allSources).sort();

    const fromParts = getZonedParts(fromDate, timeZoneContext);
    const toParts = getZonedParts(toDate, timeZoneContext);

    return {
      from: fromParts ? formatPartsDayKey(fromParts) : fromDate.toISOString().slice(0, 10),
      to: toParts ? formatPartsDayKey(toParts) : toDate.toISOString().slice(0, 10),
      bucket,
      timezone: {
        tz: timeZoneContext.timeZone || "",
        tz_offset_minutes: timeZoneContext.offsetMinutes || 0,
      },
      currency: {
        base: "USD",
        usd_to_cny: usdToCny,
      },
      sources,
      totals,
      by_source: bySource,
      series,
    };
  }

  function getRefreshTokenForCloud() {
    return getRelayCookieValue("insforge_refresh_token", { decode: true });
  }
  function setRelayRefreshToken(token) {
    if (!token || typeof token !== "string") return;
    const cookie = `insforge_refresh_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
    if (relayCookies.get("insforge_refresh_token") !== cookie) {
      relayCookies.set("insforge_refresh_token", cookie);
      persistRelayCookies();
    }
  }
  function setRelayCsrfToken(token) {
    if (!token || typeof token !== "string") return;
    const cookie = `${csrfRelayCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
    if (relayCookies.get(csrfRelayCookieName) !== cookie) {
      relayCookies.set(csrfRelayCookieName, cookie);
      persistRelayCookies();
    }
  }

  async function issueDeviceTokenForDrainSync(queuePathForMachineId) {
    if (!getCloudSyncPref()) return null;
    const refreshToken = getRefreshTokenForCloud();
    if (!refreshToken) return null;

    const runtime = resolveRuntimeConfig();
    const baseUrl = runtime.baseUrl || DEFAULT_BASE_URL;
    const minted = await mintAccessToken({
      baseUrl,
      anonKey: runtime.anonKey,
      refreshToken,
      timeoutMs: runtime.httpTimeoutMs,
    });
    if (!minted?.accessToken) return null;
    if (minted.refreshToken) setRelayRefreshToken(minted.refreshToken);
    if (minted.csrfToken) setRelayCsrfToken(minted.csrfToken);

    const machineId = getOrCreateMachineId(queuePathForMachineId);
    if (!machineId) return null;

    const root = String(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${minted.accessToken}`,
    };
    if (runtime.anonKey) headers.apikey = runtime.anonKey;

    let timeoutId;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (controller && runtime.httpTimeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), runtime.httpTimeoutMs);
    }

    const dashboardPlatform =
      process.platform === "darwin" ? "MacIntel" :
        process.platform === "win32" ? "Win32" :
          process.platform === "linux" ? "Linux x86_64" :
            "web";

    const res = await fetch(`${root}/functions/tokentracker-device-token-issue`, {
      method: "POST",
      headers,
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        // 蹇呴』鍜?dashboard/src/lib/cloud-sync.ts 浣跨敤鍚屼竴涓澶囪韩浠姐€?
        // 鏃т簯绔澶囨寜 (platform, device_name) 璁ら锛涘鏋滆繖閲屽彂鏄?
        // local-sync 韬唤锛屼細澶氬嚭涓€涓?active device锛岃处鎴疯鍥句細鎶婂巻鍙叉眰鍜屼袱娆°€?
        device_name: `Token Eyes (dashboard) #${machineId.slice(0, 8)}`,
        platform: dashboardPlatform,
        machine_id: machineId,
      }),
    }).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const token = typeof data?.token === "string" ? data.token.trim() : "";
    return token || null;
  }

  // Returns "served" when the cross-device aggregate was written to `res`, or
  // "fallthrough" when the caller should serve the local single-machine data.
  // Any failure (not signed in, cloud sync off, network/auth error) falls
  // through so the popover always renders something.
  async function tryServeAccountView(usageSlug, url, res) {
    if (!getCloudSyncPref()) return "fallthrough";
    const refreshToken = getRefreshTokenForCloud();
    if (!refreshToken) return "fallthrough";
    const runtime = resolveRuntimeConfig();
    const envTimeout = process.env.TOKENTRACKER_HTTP_TIMEOUT_MS
      ? parseInt(process.env.TOKENTRACKER_HTTP_TIMEOUT_MS, 10)
      : 0;
    const timeoutMs = envTimeout > 0 ? envTimeout : 4000;
    try {
      const out = await fetchAccountUsage({
        usageSlug,
        searchParams: url.searchParams,
        baseUrl: runtime.baseUrl || DEFAULT_BASE_URL,
        anonKey: runtime.anonKey,
        refreshToken,
        timeoutMs,
      });
      if (!out || out.data == null) return "fallthrough";
      if (out.rotatedRefreshToken) setRelayRefreshToken(out.rotatedRefreshToken);
      if (out.rotatedCsrfToken) setRelayCsrfToken(out.rotatedCsrfToken);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-TokenTracker-Account-View": "1",
      });
      res.end(JSON.stringify(out.data));
      return "served";
    } catch (e) {
      // Signed in + cloud sync on, but the cloud read failed (offline, token
      // rejected, edge error, or timeout). Fall back to local data rather than erroring.
      if (resolveRuntimeConfig().debug) {
        console.warn(`[LocalAPI] account view fallback for ${usageSlug}:`, e?.message || e);
      }
      return "fallthrough";
    }
  }

  function normalizeCookieHeader(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("; ");
    return typeof value === "string" ? value : "";
  }

  function buildRelayCookieHeader(clientCookieHeader, { relayPrecedenceNames = [] } = {}) {
    const normalizedClientCookieHeader = normalizeCookieHeader(clientCookieHeader);
    if (relayCookies.size === 0) return normalizedClientCookieHeader;
    const relayPrecedence = new Set(relayPrecedenceNames);
    const clientPairs = new Map();
    if (normalizedClientCookieHeader) {
      for (const part of normalizedClientCookieHeader.split(";")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx < 1) continue;
        const n = part.substring(0, eqIdx).trim();
        if (n) clientPairs.set(n, part.trim());
      }
    }
    // Merge relay cookies. Normal requests keep client precedence; refresh
    // recovery can opt relay cookies into precedence over stale WebView cookies.
    for (const [name, raw] of relayCookies) {
      if (clientPairs.has(name) && !relayPrecedence.has(name)) continue;
      const scIdx = raw.indexOf(";");
      const pair = scIdx > 0 ? raw.substring(0, scIdx).trim() : raw;
      clientPairs.set(name, pair);
    }
    return [...clientPairs.values()].join("; ");
  }

  // Ephemeral auth bridge: WebView sets a "native" flag before opening system browser
  // for OAuth. The callback page (in browser) checks this flag to decide whether to
  // relay the code back to the app or handle it as a normal web flow.
  let _nativeAuthPending = false;
  let _nativeAuthExpiry = 0;

  function isAuthorizedLocalMutation(req) {
    const headerToken = req?.headers?.["x-tokentracker-local-auth"];
    const cookieToken = parseCookieHeader(req?.headers?.cookie).get("tokentracker_local_auth");
    const token = typeof headerToken === "string" && headerToken.trim()
      ? headerToken.trim()
      : cookieToken || "";
    if (!token || token !== localAuthToken) return false;
    return hasAllowedLoopbackOrigin(req?.headers || {});
  }

  async function handleLocalApi(req, res, url) {
    const p = url.pathname;

    if (prepareUsageAggregateResponseCache(req, res, url)) return true;

    if (
      p === "/functions/tokentracker-codex-reset-events"
      || p === "/functions/tokentracker-codex-reset-events/ack"
      || p === "/functions/tokentracker-codex-reset-events/check"
    ) {
      if (!hasAllowedLoopbackOrigin(req?.headers || {})) {
        writeCodexResetResponse(res, { ok: false, error: "Forbidden" }, 403);
        return true;
      }
      const method = String(req.method || "GET").toUpperCase();
      const responseBody = () => ({
        ok: true,
        status: sanitizeCodexResetStatus(codexResetMonitorService.getStatus()),
        events: codexResetMonitorService
          .listUnread()
          .map(sanitizeCodexResetEvent)
          .filter(Boolean),
      });
      if (p === "/functions/tokentracker-codex-reset-events") {
        if (method !== "GET") {
          writeCodexResetResponse(res, { ok: false, error: "Method Not Allowed" }, 405);
          return true;
        }
        writeCodexResetResponse(res, responseBody());
        return true;
      }
      if (method !== "POST") {
        writeCodexResetResponse(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        writeCodexResetResponse(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (_error) {
        writeCodexResetResponse(res, { ok: false, error: "Invalid JSON" }, 400);
        return true;
      }
      if (p.endsWith("/ack")) {
        const eventId = boundedString(body?.event_id, 128);
        if (!eventId || !/^[a-z0-9:._-]+$/iu.test(eventId)) {
          writeCodexResetResponse(res, { ok: false, error: "Invalid event_id" }, 400);
          return true;
        }
        codexResetMonitorService.acknowledge(eventId);
      } else {
        await codexResetMonitorService.check({
          reason: "manual",
          force: body?.force === true,
        });
      }
      writeCodexResetResponse(res, responseBody());
      return true;
    }

    if (p === "/functions/tokentracker-leaderboard-state") {
      if (!hasAllowedLoopbackOrigin(req?.headers || {})) {
        writeCodexResetResponse(res, { ok: false, error: "Forbidden" }, 403);
        return true;
      }
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const state = buildLeaderboardDeviceState(readQueueData(qp), {
          deviceId: getOrCreateMachineId(qp),
          capturedAt: new Date(),
        });
        assertCompactStateSize(state);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type, X-TokenTracker-Local-Auth",
        });
        res.end(JSON.stringify({
          ok: true,
          summary_hash: stableStateHash(state),
          state,
        }));
      } catch (error) {
        json(res, {
          ok: false,
          error: error instanceof RangeError
            ? "Compact leaderboard state exceeds the local size limit"
            : "Unable to build leaderboard state",
        }, error instanceof RangeError ? 413 : 500);
      }
      return true;
    }

    if (p === "/functions/tokentracker-leaderboard-actual-cost") {
      if (!hasAllowedLoopbackOrigin(req?.headers || {})) {
        writeCodexResetResponse(res, { ok: false, error: "Forbidden" }, 403);
        return true;
      }
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const config = readTrackerConfig();
        const records = Array.isArray(config.spendRecords) ? config.spendRecords : [];
        const planCosts = tokenPlanCostRecords(config);
        const normalizedRecords = [
          ...withoutTokenPlanCostDuplicates(records.map((record) => normalizeSpendRecord(record)), planCosts),
          ...planCosts,
        ];
        const timeZoneContext = { timeZone: "Asia/Shanghai", offsetMinutes: 480 };
        const summary = await buildLeaderboardActualCostSummary({
          capturedAt: new Date(),
          readCombinedCost: ({ from, to }) => summarizeSpendRecords(
            normalizedRecords,
            from,
            to,
            timeZoneContext,
            null,
          ),
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type, X-TokenTracker-Local-Auth",
        });
        res.end(JSON.stringify(summary));
      } catch (_error) {
        json(res, { ok: false, error: "Unable to summarize actual AI cost" }, 500);
      }
      return true;
    }

    if (p === "/api/local-auth") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-TokenTracker-Local-Auth",
      });
      res.end(JSON.stringify({
        token: localAuthToken,
        protocol_version: LOCAL_API_PROTOCOL_VERSION,
        product_id: LOCAL_API_PRODUCT_ID,
        build_version: LOCAL_API_BUILD_VERSION,
        capabilities: LOCAL_API_CAPABILITIES,
      }));
      return true;
    }

    // --- Auth bridge: native OAuth flag (WebView 鈫?system browser) ---
    if (p === "/api/auth-bridge/verifier") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "PUT" || method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { error: "Unauthorized" }, 401);
          return true;
        }
        const body = await readJsonBody(req);
        _nativeAuthPending = Boolean(body?.native);
        _nativeAuthExpiry = Date.now() + 5 * 60 * 1000; // 5 min TTL
        json(res, { ok: true });
        return true;
      }
      if (method === "GET") {
        const isNative = _nativeAuthPending && Date.now() < _nativeAuthExpiry;
        _nativeAuthPending = false; // one-time read
        _nativeAuthExpiry = 0;
        json(res, { native: isNative });
        return true;
      }
      json(res, { error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- auth proxy: forward /api/auth/* to InsForge cloud ---
    if (p.startsWith("/api/auth/")) {
      const runtime = resolveRuntimeConfig();
      const insforgeBase = runtime.baseUrl || DEFAULT_BASE_URL;
      try {
        const targetUrl = `${insforgeBase.replace(/\/$/, "")}${p}${url.search || ""}`;
        const proxyHeaders = buildProxyHeaders(req.headers);
        const hasClientCookie = normalizeCookieHeader(proxyHeaders["cookie"]).trim().length > 0;
        const hasCsrfHeader = typeof proxyHeaders["x-csrf-token"] === "string" && proxyHeaders["x-csrf-token"].trim().length > 0;
        const relayCsrfToken = getRelayCookieValue(csrfRelayCookieName);
        const relayRefreshToken = getRelayCookieValue("insforge_refresh_token", { decode: true });
        // A cookie-less client (fresh WebView after an app update/restart) has no
        // browser session to pair a CSRF token with 鈥?the persisted refresh token
        // replayed through the mobile flow is the only viable recovery. The relay
        // csrf token must NOT force the cookie/csrf path here: background mobile
        // rotations (cloud-account.js) can leave it stale, and a stale csrf turns
        // recovery into 403 Invalid CSRF and signs the user out.
        const shouldUseRelayRefreshFallback =
          p === "/api/auth/refresh" && !hasClientCookie && relayRefreshToken;
        if (p === "/api/auth/refresh" && relayCsrfToken && !shouldUseRelayRefreshFallback) {
          proxyHeaders["x-csrf-token"] = relayCsrfToken;
        }
        const hasEffectiveCsrfHeader =
          hasCsrfHeader ||
          (typeof proxyHeaders["x-csrf-token"] === "string" && proxyHeaders["x-csrf-token"].trim().length > 0);
        let shouldInjectRelayCookies =
          p !== "/api/auth/refresh" || hasClientCookie || hasEffectiveCsrfHeader;
        if (shouldUseRelayRefreshFallback) {
          shouldInjectRelayCookies = false;
        }

        // Inject relay cookies so WebView benefits from browser's login session.
        // Refresh requests need either a browser cookie or an explicit CSRF token;
        // otherwise replaying a stale persisted refresh cookie just manufactures
        // Invalid CSRF errors on startup.
        const originalCookieHeader = normalizeCookieHeader(proxyHeaders["cookie"]);
        const mergedCookie = shouldInjectRelayCookies
          ? buildRelayCookieHeader(originalCookieHeader, {
              relayPrecedenceNames: p === "/api/auth/refresh"
                ? [csrfRelayCookieName, "insforge_refresh_token"]
                : [],
            })
          : originalCookieHeader;
        const injectedRelayCookies =
          shouldInjectRelayCookies && relayCookies.size > 0 && mergedCookie !== originalCookieHeader;
        if (mergedCookie) proxyHeaders["cookie"] = mergedCookie;

        const bodyChunks = [];
        for await (const chunk of req) bodyChunks.push(chunk);
        let proxyBody = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
        let effectiveTargetUrl = targetUrl;
        if (shouldUseRelayRefreshFallback) {
          effectiveTargetUrl = `${insforgeBase.replace(/\/$/, "")}/api/auth/refresh?client_type=mobile`;
          proxyHeaders["content-type"] = "application/json";
          delete proxyHeaders["content-length"];
          proxyBody = Buffer.from(JSON.stringify({ refresh_token: relayRefreshToken }), "utf8");
        }
        let proxyRes = await fetch(effectiveTargetUrl, {
          method: req.method || "GET",
          headers: proxyHeaders,
          body: proxyBody,
          credentials: "include",
          redirect: "manual",
        });
        let resBody = Buffer.from(await proxyRes.arrayBuffer());

        // Stale-CSRF rescue: 403 Invalid CSRF on refresh does NOT mean the
        // session is dead 鈥?background mobile rotations (cloud-account.js) can
        // desync the relayed csrf from a still-valid refresh token. Replay the
        // persisted refresh token through the csrf-free mobile flow before
        // letting the client sign out.
        const isStaleCsrf403 =
          p === "/api/auth/refresh"
          && proxyRes.status === 403
          && /invalid csrf token/i.test(resBody.toString("utf8"));
        if (isStaleCsrf403 && relayRefreshToken && !shouldUseRelayRefreshFallback) {
          const rescueHeaders = { ...proxyHeaders, "content-type": "application/json" };
          delete rescueHeaders["cookie"];
          delete rescueHeaders["x-csrf-token"];
          delete rescueHeaders["content-length"];
          const rescueRes = await fetch(
            `${insforgeBase.replace(/\/$/, "")}/api/auth/refresh?client_type=mobile`,
            {
              method: "POST",
              headers: rescueHeaders,
              body: JSON.stringify({ refresh_token: relayRefreshToken }),
              credentials: "include",
              redirect: "manual",
            },
          );
          if (rescueRes.ok) {
            proxyRes = rescueRes;
            resBody = Buffer.from(await rescueRes.arrayBuffer());
          }
        }

        // Error responses must not mutate relay state: a 403's deletion
        // set-cookie (insforge_refresh_token=; Expires=1970) would otherwise
        // destroy a still-valid persisted session.
        const allowRelayCapture = proxyRes.status < 400;
        const responseHeaders = [...proxyRes.headers.entries()]
          .filter(([k]) => !["transfer-encoding", "connection"].includes(k.toLowerCase()))
          .map(([k, v]) => {
            if (k.toLowerCase() === "set-cookie") {
              const rewritten = v.replace(/;\s*[Dd]omain=[^;]*/g, "; Domain=localhost");
              if (allowRelayCapture) captureSetCookies(rewritten);
              return [k, rewritten];
            }
            return [k, v];
          });
        res.writeHead(proxyRes.status, Object.fromEntries(responseHeaders));
        if (proxyRes.status >= 200 && proxyRes.status < 300) {
          if (p === "/api/auth/logout") {
            clearRelayCookies("sign out");
          } else {
            captureAuthTokensFromBody(resBody, proxyRes.headers.get("content-type"));
          }
        }
        if (
          isStaleCsrf403
          && proxyRes.status === 403
          && injectedRelayCookies
          && !hasClientCookie
        ) {
          clearRelayCookies("stale refresh cookie without local CSRF context");
        }
        res.end(resBody);
      } catch (e) {
        json(res, { error: `Auth proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // --- ip-check proxy: reverse-proxy ip.net.coffee (issue #81) ---
    // Lock-down: GET/HEAD only, restricted path prefixes, do not forward
    // browser credentials or fingerprintable headers. Without these limits
    // /proxy/ipcheck is an open reverse-proxy any local process can abuse
    // (exfiltrate dashboard cookies, anonymously POST through user IP).
    if (p.startsWith(`${IP_CHECK_PROXY_PREFIX}/`) || p === IP_CHECK_PROXY_PREFIX) {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const targetPath = p === IP_CHECK_PROXY_PREFIX
        ? "/"
        : p.slice(IP_CHECK_PROXY_PREFIX.length) || "/";
      const ALLOWED_PREFIXES = [
        "/api/geoip/",
        "/api/geoip-batch",
        "/api/iprisk/",
        "/api/dns/result/",
        "/claude/status.json",
        "/favicons/",
        "/ip/",
      ];
      if (!ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
        json(res, { error: "Path not allowed" }, 403);
        return true;
      }
      const targetUrl = `${IP_CHECK_TARGET}${targetPath}${url.search || ""}`;
      try {
        // Whitelist forwarded headers 鈥?no cookies, no auth, no fingerprintable
        // identity. Only what the upstream needs to negotiate content. Do not
        // set `host` explicitly: undici derives it from the URL, and some
        // versions reject a manual host header on fetch() (same forbidden-
        // header family that broke /api/auth/* in 5/13).
        const proxyHeaders = {
          accept: req.headers["accept"] || "*/*",
          "accept-language": req.headers["accept-language"] || "en",
          "accept-encoding": req.headers["accept-encoding"] || "gzip",
          "user-agent": "TokenTracker/IPCheck (https://www.tokentracker.cc)",
          referer: `${IP_CHECK_TARGET}${targetPath}`,
        };

        const proxyRes = await fetch(targetUrl, {
          method,
          headers: proxyHeaders,
          redirect: "manual",
        });

        const stripped = new Set([
          "transfer-encoding",
          "connection",
          "content-length",
          "content-encoding",
          "x-frame-options",
          "content-security-policy",
          "cross-origin-opener-policy",
          "cross-origin-embedder-policy",
          "cross-origin-resource-policy",
        ]);
        const responseHeaders = [...proxyRes.headers.entries()].filter(
          ([k]) => !stripped.has(k.toLowerCase()),
        );

        const resBody = Buffer.from(await proxyRes.arrayBuffer());
        res.writeHead(proxyRes.status, Object.fromEntries(responseHeaders));
        res.end(resBody);
      } catch (e) {
        json(res, { error: `IP check proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // --- avatar proxy: fetch third-party avatars server-side ---
    // Why: WKWebView in TokenTrackerBar fails to load some users' Google /
    // GitHub avatars directly (network-stack / proxy / TLS quirks vary by
    // environment), even when the same URL renders fine in Safari. Proxying
    // through Node's fetch 鈥?which honors system proxy + cookies-of-none 鈥?
    // produces a same-origin <img> the WKWebView always accepts.
    // Lock-down: GET only; host allowlist of well-known avatar CDNs (no open
    // proxy); strip cookies/auth; small in-memory cache.
    if (p === "/api/avatar-proxy") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const target = url.searchParams.get("url");
      if (!target) {
        json(res, { error: "Missing url" }, 400);
        return true;
      }
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        json(res, { error: "Invalid url" }, 400);
        return true;
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        json(res, { error: "Only http(s) allowed" }, 400);
        return true;
      }
      const AVATAR_HOST_ALLOWLIST = [
        "lh3.googleusercontent.com",
        "lh4.googleusercontent.com",
        "lh5.googleusercontent.com",
        "lh6.googleusercontent.com",
        "avatars.githubusercontent.com",
        "secure.gravatar.com",
        "www.gravatar.com",
        "gravatar.com",
        "cdn.discordapp.com",
        "pbs.twimg.com",
        "abs.twimg.com",
        "api.dicebear.com",
      ];
      const hostOk = AVATAR_HOST_ALLOWLIST.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
      );
      if (!hostOk) {
        json(res, { error: "Host not allowed" }, 403);
        return true;
      }

      const cacheKey = parsed.toString();
      const now = Date.now();
      const cached = avatarProxyCache.get(cacheKey);
      if (cached && now - cached.fetchedAt < AVATAR_PROXY_TTL_MS) {
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=3600",
          "X-Avatar-Cache": "HIT",
        });
        res.end(method === "HEAD" ? undefined : cached.body);
        return true;
      }

      try {
        const upstream = await fetch(cacheKey, {
          method,
          redirect: "follow",
          headers: {
            accept: req.headers["accept"] || "image/*",
            "accept-language": req.headers["accept-language"] || "en",
            "user-agent": "TokenTracker/AvatarProxy (https://www.tokentracker.cc)",
          },
        });
        if (!upstream.ok) {
          json(res, { error: `Upstream ${upstream.status}` }, upstream.status);
          return true;
        }
        const contentType = upstream.headers.get("content-type") || "image/png";
        if (!contentType.toLowerCase().startsWith("image/")) {
          json(res, { error: "Not an image" }, 415);
          return true;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        if (body.length <= AVATAR_PROXY_MAX_BYTES) {
          // Simple LRU: drop oldest if over capacity.
          if (avatarProxyCache.size >= AVATAR_PROXY_MAX_ENTRIES) {
            const oldestKey = avatarProxyCache.keys().next().value;
            if (oldestKey) avatarProxyCache.delete(oldestKey);
          }
          avatarProxyCache.set(cacheKey, { body, contentType, fetchedAt: now });
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
          "X-Avatar-Cache": "MISS",
        });
        res.end(method === "HEAD" ? undefined : body);
      } catch (e) {
        json(res, { error: `Avatar proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // --- local-sync (POST) ---
    if (p === "/functions/tokentracker-local-sync") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        if (
          body.drain === true &&
          String(process.env.TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED || "").toLowerCase() !== "true"
        ) {
          json(res, {
            ok: false,
            error: "Legacy hourly leaderboard sync is disabled",
            migration: "leaderboard-compact-state-v1",
          }, 410);
          return true;
        }
        const extraEnv = {};
        const drain = body.drain === true;
        if (typeof body.deviceToken === "string" && body.deviceToken.trim()) {
          extraEnv.TOKENTRACKER_DEVICE_TOKEN = body.deviceToken.trim();
        }
        if (body.insforgeBaseUrl != null) {
          const allowedBaseUrl = resolveAllowedInsforgeBaseUrl(body.insforgeBaseUrl);
          if (!allowedBaseUrl) {
            json(res, { ok: false, error: "Unsupported insforgeBaseUrl override" }, 400);
            return true;
          }
          extraEnv.TOKENTRACKER_INSFORGE_BASE_URL = allowedBaseUrl;
        }
        if (drain && !extraEnv.TOKENTRACKER_DEVICE_TOKEN && getCloudSyncPref() && getRefreshTokenForCloud()) {
          const issuedToken = await issueDeviceTokenForDrainSync(qp).catch(() => null);
          if (!issuedToken) {
            json(res, { ok: false, error: "Unable to issue cloud device token for drain sync" }, 502);
            return true;
          }
          extraEnv.TOKENTRACKER_DEVICE_TOKEN = issuedToken;
        }
        const result = await runSyncCommand(extraEnv, { drain });
        try {
          const { resetUsageLimitsCache } = require("./usage-limits");
          resetUsageLimitsCache();
        } catch (_e) {
          // ignore if module load fails
        }
        json(res, { ok: true, ...result });
      } catch (e) {
        json(res, { ok: false, error: e?.message, code: e?.code ?? null, stdout: e?.stdout || "", stderr: e?.stderr || "" }, 500);
      }
      return true;
    }

    // --- wrapped (year-end summary, 脿 la Spotify Wrapped) ---
    if (p === "/functions/tokentracker-wrapped") {
      const yearParam = url.searchParams.get("year");
      const year = yearParam ? Number(yearParam) : null;
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const { aggregateWrapped } = require("./wrapped-aggregator");
      const summary = aggregateWrapped(rows, year ? { year } : {});
      json(res, { scope, excluded_sources: excludedSources, ...summary });
      return true;
    }

    // --- account (cross-device) view proxy for the native popover ---
    // When ?account=1 and the user is signed in with cloud sync on, serve the
    // same cross-device aggregate the dashboard shows; otherwise tag the
    // response (X-TokenTracker-Account-View: 0) so the popover knows it got
    // local single-machine data, and fall through to the local handler below.
    if (url.searchParams.get("account") === "1") {
      const usageSlug = p.startsWith("/functions/") ? p.slice("/functions/".length) : "";
      if (accountSlugFor(usageSlug)) {
        const result = await tryServeAccountView(usageSlug, url, res);
        if (result === "served") return true;
        res.setHeader("X-TokenTracker-Account-View", "0");
      }
    }

    // --- usage-summary ---
    if (p === "/functions/tokentracker-usage-summary") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: baseScopedRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();

      // Multi-value filters (sources / models / agent_ids). agent_ids is an
      // alias for source filtering (see ticket-01 decision table).
      const sourcesParam = parseMultiParam(url, "sources");
      const agentIds = parseMultiParam(url, "agent_ids");
      const modelsParam = parseMultiParam(url, "models");
      const effectiveSources = mergeSourceFilters(sourcesParam, agentIds);
      const scopedRows = await withCodexRolloutRows(baseScopedRows, {
        from,
        to,
        timeZoneContext,
        sources: effectiveSources,
      });
      const filterRows = (rs) => rs.filter((row) => {
        if (effectiveSources && !effectiveSources.includes(normalizeSource(row.source))) return false;
        if (modelsParam) {
          const mk = String(row.model || "").trim().toLowerCase();
          if (!modelsParam.includes(mk)) return false;
        }
        return true;
      });
      const rows = filterRows(scopedRows);

      const daily = aggregateByDay(rows, timeZoneContext, pricingOptions).filter((d) => d.day >= from && d.day <= to);
      const totals = daily.reduce(
        (acc, r) => {
          acc.total_tokens += r.total_tokens;
          acc.billable_total_tokens += r.billable_total_tokens;
          acc.total_cost_usd += r.total_cost_usd || 0;
          acc.input_tokens += r.input_tokens;
          acc.output_tokens += r.output_tokens;
          acc.cached_input_tokens += r.cached_input_tokens;
          acc.cache_creation_input_tokens += r.cache_creation_input_tokens;
          acc.reasoning_output_tokens += r.reasoning_output_tokens;
          acc.conversation_count += r.conversation_count;
          return acc;
        },
        { total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 },
      );
      const totalCost = totals.total_cost_usd;

      // Shared queue aggregator — guarantees three-way caliber consistency
      // with spend-timeseries totals and request-usage-records queue_baseline_totals.
      const queueTotals = computeQueueTotals(scopedRows, {
        fromKey: from || null,
        toKey: to || null,
        timeZoneContext,
        pricingOptions,
        sources: effectiveSources,
        models: modelsParam,
      });

      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);
      const allDaily = aggregateByDay(rows, timeZoneContext, pricingOptions);

      const shiftDay = (dayStr, delta) => {
        const d = new Date(`${dayStr}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + delta);
        return d.toISOString().slice(0, 10);
      };
      const collectDays = (n) => {
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
          const ds = shiftDay(todayStr, -i);
          const dd = allDaily.find((x) => x.day === ds);
          if (dd) out.push(dd);
        }
        return out;
      };
      const sumDays = (days) =>
        days.reduce((a, r) => {
          a.billable_total_tokens += r.billable_total_tokens;
          a.conversation_count += r.conversation_count;
          return a;
        }, { billable_total_tokens: 0, conversation_count: 0 });

      const l7 = collectDays(7);
      const l30 = collectDays(30);
      const l7t = sumDays(l7);
      const l30t = sumDays(l30);
      const l7fromStr = shiftDay(todayStr, -6);
      const l30fromStr = shiftDay(todayStr, -29);

      // TICKET-06: request/latency/success metrics for the summary panel.
      // queue.jsonl has no per-request status or latency fields, so:
      //   - request_count is null (only conversation_count is available)
      //   - success_count, success_rate, avg_latency_ms are null (no per-request data)
      //   - cache_hit_rate = cached_input_tokens / (input_tokens + cached_input_tokens)
      //   - pricing_coverage reflects whether tokens have pricing info
      const summaryCacheBase = Number(totals.input_tokens || 0) + Number(totals.cached_input_tokens || 0);
      const summaryCacheHitRate = summaryCacheBase > 0
        ? Number(((Number(totals.cached_input_tokens || 0) / summaryCacheBase) * 100).toFixed(2))
        : 0;

      const pricedTokens = queueTotals.priced_tokens;
      const unpricedTokens = queueTotals.unpriced_tokens;
      const pricingCoverage = queueTotals.pricing_coverage;

      json(res, {
        ok: true,
        from, to, days: daily.length, scope, excluded_sources: excludedSources,
        sources: effectiveSources,
        models: modelsParam,
        totals: {
          ...totals,
          total_cost_usd: totalCost.toFixed(6),
          cost_usd: queueTotals.cost_usd,
          request_count: null,
          display_request_count: queueTotals.conversation_count,
          request_count_basis: "conversation_count",
          success_count: null,
          success_rate: null,
          avg_latency_ms: null,
          cache_hit_rate: summaryCacheHitRate,
          priced_tokens: pricedTokens,
          unpriced_tokens: unpricedTokens,
          pricing_coverage: pricingCoverage,
          metric_availability: "aggregate_only",
        },
        rolling: {
          last_7d: { from: l7fromStr, to: todayStr, active_days: l7.length, totals: l7t },
          last_30d: { from: l30fromStr, to: todayStr, active_days: l30.length, totals: l30t, avg_per_active_day: l30.length > 0 ? Math.round(l30t.billable_total_tokens / l30.length) : 0 },
        },
      });
      return true;
    }

    // --- provider-stats (A4) ---
    // Aggregates queue rows by source for the Spend provider leaderboard.
    // Shares filter + scope semantics with usage-summary so totals stay
    // three-way consistent (usage-summary / spend-timeseries / provider-stats).
    if (p === "/functions/tokentracker-provider-stats") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: baseScopedRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();
      const sourcesParam = parseMultiParam(url, "sources");
      const agentIds = parseMultiParam(url, "agent_ids");
      const modelsParam = parseMultiParam(url, "models");
      const effectiveSources = mergeSourceFilters(sourcesParam, agentIds);
      const scopedRows = await withCodexRolloutRows(baseScopedRows, {
        from,
        to,
        timeZoneContext,
        sources: effectiveSources,
      });
      const directoryStates = typeof tokenOnlyDirectoryStatesProvider === "function"
        ? tokenOnlyDirectoryStatesProvider(readLocalSettings())
        : resolveTokenOnlyDirectoryStates(readLocalSettings());
      const providers = appendDetectedTokenOnlyProviders(aggregateBySource(scopedRows, {
        fromKey: from || null,
        toKey: to || null,
        timeZoneContext,
        pricingOptions,
        sources: effectiveSources,
        models: modelsParam,
      }), directoryStates, effectiveSources);
      const totals = computeQueueTotals(scopedRows, {
        fromKey: from || null,
        toKey: to || null,
        timeZoneContext,
        pricingOptions,
        sources: effectiveSources,
        models: modelsParam,
      });
      json(res, {
        ok: true,
        from,
        to,
        scope,
        excluded_sources: excludedSources,
        sources: effectiveSources || [],
        models: modelsParam || [],
        providers,
        totals,
      });
      return true;
    }

    // --- model-stats (A5) ---
    // Aggregates queue rows by (source, model) for the model leaderboard.
    // Aggregation key is `${source}|${model}` so identical model names under
    // different sources are not merged. Sorted by tokens descending.
    if (p === "/functions/tokentracker-model-stats") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: baseScopedRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();
      const sourcesParam = parseMultiParam(url, "sources");
      const agentIds = parseMultiParam(url, "agent_ids");
      const modelsParam = parseMultiParam(url, "models");
      const effectiveSources = mergeSourceFilters(sourcesParam, agentIds);
      const scopedRows = await withCodexRolloutRows(baseScopedRows, {
        from,
        to,
        timeZoneContext,
        sources: effectiveSources,
      });
      const modelEntries = aggregateByModel(scopedRows, {
        fromKey: from || null,
        toKey: to || null,
        timeZoneContext,
        pricingOptions,
        sources: effectiveSources,
        models: modelsParam,
      });
      const totals = computeQueueTotals(scopedRows, {
        fromKey: from || null,
        toKey: to || null,
        timeZoneContext,
        pricingOptions,
        sources: effectiveSources,
        models: modelsParam,
      });
      json(res, {
        ok: true,
        from,
        to,
        scope,
        excluded_sources: excludedSources,
        sources: effectiveSources || [],
        // NOTE: `models` key is used for the stat entries below (per ticket
        // schema). The active model-filter is NOT echoed separately to avoid
        // a key collision; callers can read it from the request URL.
        models: modelEntries,
        totals,
      });
      return true;
    }

    // --- usage-daily ---
    if (p === "/functions/tokentracker-usage-daily") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: baseRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();
      const sourcesParam = parseMultiParam(url, "sources");
      const agentIds = parseMultiParam(url, "agent_ids");
      const modelsParam = parseMultiParam(url, "models");
      const effectiveSources = mergeSourceFilters(sourcesParam, agentIds);
      const rows = await withCodexRolloutRows(baseRows, {
        from,
        to,
        timeZoneContext,
        sources: effectiveSources,
      });
      const filteredRows = rows.filter((row) => {
        if (effectiveSources && !effectiveSources.includes(normalizeSource(row.source))) return false;
        if (modelsParam) {
          const modelKey = String(row.model || "").trim().toLowerCase();
          if (!modelsParam.includes(modelKey)) return false;
        }
        return true;
      });
      const daily = aggregateByDay(filteredRows, timeZoneContext, pricingOptions).filter((d) => d.day >= from && d.day <= to);
      json(res, { from, to, scope, excluded_sources: excludedSources, data: daily });
      return true;
    }

    // --- usage-heatmap ---
    if (p === "/functions/tokentracker-usage-heatmap") {
      const weeks = parseInt(url.searchParams.get("weeks") || "52", 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();
      const daily = aggregateByDay(rows, timeZoneContext, pricingOptions);
      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);
      const end = new Date(`${todayStr}T00:00:00Z`);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      const byDay = new Map(daily.map((d) => [d.day, d]));

      const allValues = daily.map((d) => d.billable_total_tokens).filter((v) => v > 0);
      const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
      const calcLevel = (v) => {
        if (v <= 0) return 0;
        if (maxValue === 0) return 1;
        const r = v / maxValue;
        if (r <= 0.25) return 1;
        if (r <= 0.5) return 2;
        if (r <= 0.75) return 3;
        return 4;
      };

      // Build cells and group into weeks (array of 7-cell arrays) for the dashboard
      const cells = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const data = byDay.get(day);
        const billable = data?.billable_total_tokens || 0;
        cells.push({ day, total_tokens: data?.total_tokens || 0, billable_total_tokens: billable, level: calcLevel(billable), models: data?.models || null });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const weeksArr = [];
      for (let i = 0; i < cells.length; i += 7) {
        weeksArr.push(cells.slice(i, i + 7));
      }

      let totalCostUsd = 0;
      for (const d of daily) {
        if (d.day >= from && d.day <= to) {
          totalCostUsd += d.total_cost_usd || 0;
        }
      }

      json(res, { 
        from, 
        to, 
        scope, 
        excluded_sources: excludedSources, 
        week_starts_on: "sun", 
        active_days: cells.filter((c) => c.billable_total_tokens > 0).length, 
        streak_days: 0, 
        weeks: weeksArr,
        total_cost_usd: totalCostUsd
      });
      return true;
    }

    // --- usage-model-breakdown ---
    if (p === "/functions/tokentracker-usage-model-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: scopedRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const pricingOptions = getPricingOptions();
      const rows = scopedRows.filter((r) => {
        if (!r.hour_start) return false;
        const d = rowDayKey(r, timeZoneContext);
        return d >= from && d <= to;
      });

      // Q02: derive billing_mode from local Token 濂楅 records + queue rows.
      // We do this BEFORE the per-model cost pass so each model carries the
      // (mode, confidence) pair it was attributed with, and the source-level
      // summary can aggregate from the per-model set.
      const planRecords = readTokenPlanRecords();

      const bySource = new Map();
      for (const row of rows) {
        const src = row.source || "unknown";
        const mdl = row.model || "unknown";
        if (!bySource.has(src))
          bySource.set(src, { source: src, source_scope: getSourceScope(src), totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" }, models: new Map() });
        const sa = bySource.get(src);
        sa.totals.total_tokens += row.total_tokens || 0;
        sa.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        sa.totals.input_tokens += row.input_tokens || 0;
        sa.totals.output_tokens += row.output_tokens || 0;
        sa.totals.cached_input_tokens += row.cached_input_tokens || 0;
        sa.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        sa.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        if (!sa.models.has(mdl))
          bySource.get(src).models.set(mdl, { model: mdl, model_id: mdl, totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" } });
        const ma = sa.models.get(mdl);
        ma.totals.total_tokens += row.total_tokens || 0;
        ma.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        ma.totals.input_tokens += row.input_tokens || 0;
        ma.totals.output_tokens += row.output_tokens || 0;
        ma.totals.cached_input_tokens += row.cached_input_tokens || 0;
        ma.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        ma.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
      }

      const sources = Array.from(bySource.values()).map((s) => {
        const modelResults = [];
        s.models = Array.from(s.models.values())
          .map((m) => {
            const cost = computeRowCost({
              ...m.totals,
              model: m.model,
              source: s.source,
            }, pricingOptions);
            // Q02: per-model billing_mode derivation. We use the first row
            // seen for this (source, model) pair to honor the explicit
            // field if any row carries it; queue rows are append-only and
            // carry the same (source, model, hour_start) key.
            const sampleRow = rows.find(
              (r) =>
                (r.source || "unknown") === s.source &&
                (r.model || "unknown") === m.model,
            );
            const derived = deriveModelBillingMode({
              row: sampleRow,
              model: m.model,
              source: s.source,
              planRecords,
            });
            modelResults.push(derived);
            return {
              ...m,
              totals: { ...m.totals, total_cost_usd: cost.toFixed(6) },
              billing_mode: derived.mode,
              billing_mode_confidence: derived.confidence,
            };
          })
          .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
        const sourceCost = s.models.reduce((sum, m) => sum + Number(m.totals.total_cost_usd), 0);
        s.totals.total_cost_usd = sourceCost.toFixed(6);
        const summary = summarizeSourceBillingMode(modelResults);
        s.billing_mode = summary.mode;
        s.billing_modes = summary.billing_modes;
        return s;
      });

      json(res, {
        from, to, days: 0, scope, excluded_sources: excludedSources, sources,
        pricing: { model: "per-model", pricing_mode: "per_token_type", source: "litellm", effective_from: new Date().toISOString().slice(0, 10) },
      });
      return true;
    }

    // --- usage-category-breakdown (Claude + Codex) ---
    // Claude: splits historical Claude usage into seven semantic categories
    // mirroring Claude Code's /context view (approx).
    // Codex: provides a tool-oriented breakdown, attributing per-turn token
    // deltas to observed tool calls (heuristic).
    if (p === "/functions/tokentracker-usage-category-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const requestedSource = (url.searchParams.get("source") || "claude").trim().toLowerCase();
      if (requestedSource === "claude") {
        try {
          const result = await computeClaudeCategoryBreakdown({ from, to, projectDir: process.cwd() });
          json(res, { from, to, ...result });
        } catch (e) {
          console.error("[LocalAPI] usage-category-breakdown:", e?.message || e);
          json(res, { from, to, ...unsupportedCategoryPayload("claude"), error: "compute_failed" }, 500);
        }
        return true;
      }

      if (requestedSource === "codex") {
        try {
          const timeZoneContext = getTimeZoneContext(url);
          const result = await computeCodexContextBreakdown({
            from,
            to,
            top: 50,
            timeZoneContext,
          });
          if (!Number(result?.totals?.total_tokens || 0)) {
            const fallback = buildCodexCategoryFallbackFromQueue(readQueueData(qp), {
              from,
              to,
              timeZoneContext,
            });
            json(res, { from, to, ...fallback });
            return true;
          }
          json(res, { from, to, ...result });
        } catch (e) {
          console.error("[LocalAPI] usage-category-breakdown(codex):", e?.message || e);
          json(res, { from, to, ...unsupportedCategoryPayload("codex"), error: "compute_failed" }, 500);
        }
        return true;
      }

      json(res, { from, to, ...unsupportedCategoryPayload(requestedSource) });
      return true;
    }

    // --- project-usage-summary ---
    if (p === "/functions/tokentracker-project-usage-summary") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 3), 50);
      const timeZoneContext = getTimeZoneContext(url);
      // Use the per-project bucket log that rollout.js emits 鈥?it already
      // carries the actual tokens attributed to each (project_key, source,
      // hour_start). Falling back to "session-file count 脳 total tokens"
      // (the old behavior) produced pure fiction: every short-and-hot
      // project got the same weight as every long-and-cold one.
      const projectQueuePath = path.join(
        path.dirname(qp),
        "project.queue.jsonl",
      );
      const projectRows = readProjectQueueData(projectQueuePath);
      const pricingOptions = getPricingOptions();

      const byProject = new Map();
      for (const row of projectRows) {
        const dayKey = rowDayKey(row, timeZoneContext);
        if (from && dayKey < from) continue;
        if (to && dayKey > to) continue;
        const rawKey = row.project_key || "unknown";
        const rawRef = row.project_ref || rawKey;
        const rawRepoRoot = row.repo_root || null;
        const { key: normalizedKey, kind: pathKindFromKey } = normalizeProjectKey(rawKey, rawRef);

        if (!byProject.has(normalizedKey)) {
          const projectName = extractProjectName(rawKey, rawRef);
          const projectPath = resolveProjectPathDisplay(rawKey, rawRef, rawRepoRoot);
          const resolvedPathKind = rawRepoRoot && detectPathKind(rawRepoRoot) !== "unknown"
            ? detectPathKind(rawRepoRoot)
            : pathKindFromKey;
          byProject.set(normalizedKey, {
            project_key: normalizedKey,
            project_name: projectName,
            project_path: projectPath,
            path_kind: resolvedPathKind,
            path_status: resolvePathStatus(projectPath),
            project_ref: rawRef,
            total_tokens: 0,
            billable_total_tokens: 0,
            cost_usd: 0,
            priced_tokens: 0,
            unpriced_tokens: 0,
            pricing_coverage: "complete",
            request_count: 0,
            last_active_at: null,
          });
        }
        const agg = byProject.get(normalizedKey);
        const tokens = Number(row.total_tokens || 0);
        agg.total_tokens += tokens;
        agg.billable_total_tokens += tokens;

        if (rawRepoRoot && !agg.project_path) {
          agg.project_path = resolveProjectPathDisplay(rawKey, rawRef, rawRepoRoot);
          if (detectPathKind(rawRepoRoot) !== "unknown") {
            agg.path_kind = detectPathKind(rawRepoRoot);
          }
          agg.path_status = resolvePathStatus(agg.project_path);
        }

        const rowCost = computeRowCostDetailed(row, pricingOptions);
        agg.cost_usd += Number(rowCost.cost_usd || 0);
        agg.priced_tokens += Number(rowCost.priced_tokens || 0);
        agg.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);

        const convCount = Number(row.conversation_count || 0);
        if (convCount > 0) {
          agg.request_count += convCount;
        } else {
          agg.request_count += 1;
        }

        const hourStart = row.hour_start;
        if (hourStart) {
          if (!agg.last_active_at || hourStart > agg.last_active_at) {
            agg.last_active_at = hourStart;
          }
        }

        if (!agg.project_ref && rawRef) agg.project_ref = rawRef;
        if (!agg.project_path && resolveProjectPathDisplay(rawKey, rawRef)) {
          agg.project_path = resolveProjectPathDisplay(rawKey, rawRef);
          agg.path_status = resolvePathStatus(agg.project_path);
        }
      }

      // If no project-attributed rows exist yet (user hasn't synced project
      // attribution, or never used a project-capable CLI), fall back to
      // per-source aggregation over the main queue so the panel isn't
      // totally empty. This path used to also exist for the non-empty case
      // and produce wrong numbers; keep it only as the empty fallback.
      let entries;
      if (byProject.size === 0) {
        const rows = readQueueData(qp);
        const bySrc = new Map();
        for (const row of rows) {
          const dayKey = rowDayKey(row, timeZoneContext);
          if (from && dayKey < from) continue;
          if (to && dayKey > to) continue;
          const src = row.source || "unknown";
          if (!bySrc.has(src)) {
            bySrc.set(src, {
              project_key: src,
              project_name: getSourceDisplayName(src) || src,
              project_path: "",
              path_kind: "unknown",
              path_status: "not_detected",
              project_ref: "",
              total_tokens: 0,
              billable_total_tokens: 0,
              cost_usd: 0,
              priced_tokens: 0,
              unpriced_tokens: 0,
              request_count: 0,
              last_active_at: null,
            });
          }
          const agg = bySrc.get(src);
          agg.total_tokens += row.total_tokens || 0;
          agg.billable_total_tokens += row.total_tokens || 0;

          const rowCost = computeRowCostDetailed(row, pricingOptions);
          agg.cost_usd += Number(rowCost.cost_usd || 0);
          agg.priced_tokens += Number(rowCost.priced_tokens || 0);
          agg.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);

          const convCount = Number(row.conversation_count || 0);
          if (convCount > 0) {
            agg.request_count += convCount;
          } else {
            agg.request_count += 1;
          }

          const hourStart = row.hour_start;
          if (hourStart) {
            if (!agg.last_active_at || hourStart > agg.last_active_at) {
              agg.last_active_at = hourStart;
            }
          }
        }
        entries = Array.from(bySrc.values())
          .sort((a, b) => b.billable_total_tokens - a.billable_total_tokens)
          .slice(0, limit)
          .map((e) => {
            const total = Number(e.priced_tokens || 0) + Number(e.unpriced_tokens || 0);
            let pricingCoverage = "complete";
            if (total > 0) {
              if (Number(e.unpriced_tokens || 0) === 0) pricingCoverage = "complete";
              else if (Number(e.priced_tokens || 0) === 0) pricingCoverage = "unpriced";
              else pricingCoverage = "partial";
            }
            return {
              ...e,
              total_tokens: String(e.total_tokens),
              billable_total_tokens: String(e.billable_total_tokens),
              cost_usd: String(e.cost_usd),
              priced_tokens: String(e.priced_tokens || 0),
              unpriced_tokens: String(e.unpriced_tokens || 0),
              pricing_coverage: pricingCoverage,
              request_count: String(e.request_count),
              last_active_at: e.last_active_at || null,
            };
          });
      } else {
        entries = Array.from(byProject.values())
          .sort((a, b) => b.billable_total_tokens - a.billable_total_tokens)
          .slice(0, limit)
          .map((e) => {
            const total = Number(e.priced_tokens || 0) + Number(e.unpriced_tokens || 0);
            let pricingCoverage = "complete";
            if (total > 0) {
              if (Number(e.unpriced_tokens || 0) === 0) pricingCoverage = "complete";
              else if (Number(e.priced_tokens || 0) === 0) pricingCoverage = "unpriced";
              else pricingCoverage = "partial";
            }
            return {
              ...e,
              total_tokens: String(e.total_tokens),
              billable_total_tokens: String(e.billable_total_tokens),
              cost_usd: String(e.cost_usd),
              priced_tokens: String(e.priced_tokens || 0),
              unpriced_tokens: String(e.unpriced_tokens || 0),
              pricing_coverage: pricingCoverage,
              request_count: String(e.request_count),
              last_active_at: e.last_active_at || null,
            };
          });
      }

      json(res, { generated_at: new Date().toISOString(), from: from || null, to: to || null, entries });
      return true;
    }

    // --- user-status (stub) ---
    if (p === "/functions/tokentracker-user-status") {
      json(res, {
        user_id: "local-user", email: "local@localhost", name: "Local User", is_public: false,
        created_at: new Date().toISOString(),
        pro: { active: true, sources: ["local"], expires_at: null, partial: false, as_of: new Date().toISOString() },
        // Cross-device popover state: whether account aggregation can be served
        // (signed in) and whether the dashboard's cloud-sync toggle is on.
        account: {
          available: Boolean(getRefreshTokenForCloud()),
          cloud_sync_enabled: getCloudSyncPref(),
          account_view: Boolean(getRefreshTokenForCloud()) && getCloudSyncPref(),
        },
      });
      return true;
    }

    // --- spend records (full CRUD + billing-cycle-aware monthly/lifetime summary) ---
    if (p === "/functions/tokentracker-spend-records") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const timeZoneContext = getTimeZoneContext(url);
        // Ticket-07 Task 4: parse sources filter (comma-separated string -> array)
        const sourcesParam = url.searchParams.get("sources") || "";
        const sources = sourcesParam
          ? sourcesParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
          : null;
        const summaryMonth = url.searchParams.get("summary_month") || "";
        json(res, readSpendRecords(from, to, timeZoneContext, sources, summaryMonth));
        return true;
      }
      if (method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...createSpendRecord(body) });
        } catch (e) {
          // 06: surface structured error_code (missing_required_field /
          // invalid_currency / invalid_billing_cycle / invalid_start_date /
          // invalid_amount) AND the offending field name so the UI can show
          // the real reason instead of faking success.
          json(res, { ok: false, error: e?.message || "Unable to save spend record", ...(e?.error_code ? { error_code: e.error_code } : {}), ...(e?.field ? { field: e.field } : {}) }, e?.statusCode || 500);
        }
        return true;
      }
      if (method === "PUT") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...updateSpendRecord(body) });
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to update spend record", ...(e?.error_code ? { error_code: e.error_code } : {}), ...(e?.field ? { field: e.field } : {}) }, e?.statusCode || 500);
        }
        return true;
      }
      if (method === "DELETE") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...deleteSpendRecord(body) });
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to delete spend record" }, e?.statusCode || 500);
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- other AI spend groups (group records remain independent of spend rows) ---
    if (p === "/functions/tokentracker-other-ai-groups") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, { groups: readOtherAiSpendGroups() });
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const body = await readJsonBody(req);
        if (method === "POST") {
          json(res, { ok: true, ...saveOtherAiSpendGroup(body) });
        } else if (method === "PUT") {
          json(res, { ok: true, ...(body?.action === "reorder"
            ? reorderOtherAiSpendGroups(body)
            : saveOtherAiSpendGroup(body)) });
        } else if (method === "DELETE") {
          json(res, { ok: true, ...deleteOtherAiSpendGroup(body) });
        } else {
          json(res, { ok: false, error: "Method Not Allowed" }, 405);
        }
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to update other AI spend groups" }, e?.statusCode || 500);
      }
      return true;
    }

    // --- spend timeseries (read-only, returns per-source per-bucket cost series) ---
    if (p === "/functions/tokentracker-spend-timeseries") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const bucket = url.searchParams.get("bucket") || "auto";
        const timeZoneContext = getTimeZoneContext(url);
        // Multi-value filters (project-first pattern). agent_ids is treated as
        // an alias for source filtering (see ticket-01 decision table).
        const sources = parseMultiParam(url, "sources");
        const agentIds = parseMultiParam(url, "agent_ids");
        const models = parseMultiParam(url, "models");
        const filters = {
          sources: mergeSourceFilters(sources, agentIds),
          models,
        };
        try {
          json(res, await readSpendTimeseries(from, to, bucket, timeZoneContext, filters));
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unknown error" }, e?.statusCode || 500);
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- request usage records (read-only, per-request token/cost details) ---
    if (p === "/functions/tokentracker-request-usage-records") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        const singleSource = url.searchParams.get("source"); // backward-compat single param
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const tz = url.searchParams.get("tz") || "";
        const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
        const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 500), 1000);

        const rawPage = Number(url.searchParams.get("page"));
        const rawPageSize = Number(url.searchParams.get("pageSize"));
        const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
        const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1
          ? Math.min(Math.max(1, rawPageSize), 1000)
          : 10;

        // Multi-value filters (project-first pattern). agent_ids is an alias
        // for source filtering (see ticket-01 decision table).
        const sourcesParam = parseMultiParam(url, "sources");
        const agentIds = parseMultiParam(url, "agent_ids");
        const models = parseMultiParam(url, "models");
        const effectiveSources = mergeSourceFilters(singleSource, sourcesParam, agentIds);

        const timeZoneContext = {
          timeZone: tz || null,
          offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
        };

        const pricingOptions = getPricingOptions();

        try {
          const listCacheKey = buildRequestUsageRecordsListCacheKey({
            queuePath: qp,
            effectiveSources,
            from,
            to,
            tz,
            tzOffset: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
            models,
            limit,
          });

          let allRecords;
          let aggregateOnlySources;
          let allRows;
          let fromKeyRur;
          let toKeyRur;

          const cachedList = readRequestUsageRecordsListCache(listCacheKey);
          if (cachedList) {
            allRecords = cachedList.allRecords;
            aggregateOnlySources = cachedList.aggregateOnlySources;
            allRows = cachedList.allRows;
            fromKeyRur = cachedList.fromKeyRur;
            toKeyRur = cachedList.toKeyRur;
          } else {
            const built = await buildRequestUsageRecordsList({
              qp,
              trackerDataDir,
              effectiveSources,
              from,
              to,
              timeZoneContext,
              limit,
              models,
              pricingOptions,
            });
            allRecords = built.allRecords;
            aggregateOnlySources = built.aggregateOnlySources;
            allRows = built.allRows;
            fromKeyRur = built.fromKeyRur;
            toKeyRur = built.toKeyRur;
            writeRequestUsageRecordsListCache(listCacheKey, {
              allRecords,
              aggregateOnlySources,
              allRows,
              fromKeyRur,
              toKeyRur,
            });
          }

          const totalCount = allRecords.length;
          const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
          const currentPage = Math.min(page, totalPages);
          const startIdx = (currentPage - 1) * pageSize;
          const pagedRecords = allRecords.slice(startIdx, startIdx + pageSize);

          const totals = computeRecordTotals(allRecords);

          const queueBaselineTotals = computeQueueTotals(allRows, {
            fromKey: fromKeyRur,
            toKey: toKeyRur,
            timeZoneContext,
            pricingOptions,
            sources: effectiveSources,
            models,
          });

          const hasRequestEvents = allRecords.some(r => r.record_kind !== "aggregate_bucket");
          const hasAggregateRecords = allRecords.some(r => r.record_kind === "aggregate_bucket");
          const hasStatusData = allRecords.some(r => r.status !== null && r.status !== undefined);
          const hasLatencyData = allRecords.some(r => r.latency_ms !== null && r.latency_ms !== undefined);
          const granularity = hasRequestEvents && hasAggregateRecords
            ? "mixed"
            : hasAggregateRecords
              ? "aggregate_bucket"
              : "request_event";
          const requestRecordsAvailability = hasRequestEvents
            ? "measured"
            : hasAggregateRecords
              ? "aggregate_only"
              : "unavailable";

          json(res, {
            ok: true,
            source: singleSource || (effectiveSources ? effectiveSources.join(",") : "all"),
            sources: effectiveSources,
            from: from || null,
            to: to || null,
            records: pagedRecords,
            items: pagedRecords,
            totals,
            granularity,
            aggregate_only_sources: aggregateOnlySources,
            page: {
              page: currentPage,
              pageSize: pageSize,
              total: totalCount,
              total_pages: totalPages,
              limit: Number(limit),
              returned_count: pagedRecords.length,
              total_count: totalCount,
              totals_scope: "all_matching",
            },
            availability: {
              request_records: requestRecordsAvailability,
              status: hasStatusData ? "measured" : "unavailable",
              latency: hasLatencyData ? "measured" : "unavailable",
            },
            queue_baseline_totals: queueBaselineTotals,
          });
        } catch (e) {
          console.error("[LocalAPI] tokentracker-request-usage-records error:", e?.message || e);
          json(res, {
            ok: false,
            source: singleSource || "all",
            from: from || null,
            to: to || null,
            records: [],
            items: [],
            totals: computeRecordTotals([]),
            granularity: "request_event",
            aggregate_only_sources: [],
            page: {
              page: 1,
              pageSize: pageSize,
              total: 0,
              total_pages: 1,
              limit: Number(limit),
              returned_count: 0,
              total_count: 0,
              totals_scope: "all_matching",
            },
            availability: {
              request_records: "unavailable",
              status: "unavailable",
              latency: "unavailable",
            },
            queue_baseline_totals: computeQueueTotals([], {}),
          });
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }

    if (p === "/functions/tokentracker-token-plans-order") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "PUT") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const body = await readJsonBody(req);
        const ids = Array.isArray(body?.ids) ? body.ids.map((id) => String(id || "").trim()) : [];
        const records = readTokenPlanRecords();
        const storedIds = records.map((record) => record.id);
        const submitted = new Set(ids);
        const valid = ids.length === storedIds.length
          && submitted.size === ids.length
          && ids.every((id) => storedIds.includes(id));
        if (!valid) {
          json(res, { ok: false, error: "套餐排序必须包含全部且不重复的记录 ID" }, 400);
          return true;
        }
        const byId = new Map(records.map((record) => [record.id, record]));
        const ordered = ids.map((id, index) => ({ ...byId.get(id), display_order: index }));
        const config = readTrackerConfig();
        config.tokenPlans = ordered;
        writeTrackerConfig(config);
        json(res, { ok: true, records: readTokenPlanRecords() });
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to reorder token plans" }, e?.statusCode || 500);
      }
      return true;
    }

    // --- token plans (F03: 鏀寔 auto refresh 瀛楁涓庢墜鍔?refresh endpoint) ---
    if (p === "/functions/tokentracker-token-plans") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, { records: readTokenPlanRecords() });
        return true;
      }
      if (method === "POST" || method === "PUT") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...upsertTokenPlanRecord(body) });
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to save token plan" }, e?.statusCode || 500);
        }
        return true;
      }
      if (method === "DELETE") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...deleteTokenPlanRecord(body) });
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to delete token plan" }, e?.statusCode || 500);
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- token plan secrets (W03-R3A: 保存自定义 API 密钥，只返回引用) ---
    if (p === "/functions/tokentracker-token-plan-secrets") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      // Only allow from desktop (local auth required)
      if (!isAuthorizedLocalMutation(req)) {
        const headers = req?.headers || {};
        const hasOrigin = Boolean(headers.origin || headers.referer);
        if (!hasOrigin) {
          json(res, { ok: false, error: "desktop_required", error_code: "desktop_required" }, 403);
        } else {
          json(res, { ok: false, error: "Unauthorized" }, 401);
        }
        return true;
      }
      try {
        const body = await readJsonBody(req);
        const providerId = String(body?.provider_id || "").trim().toLowerCase();
        const purpose = String(body?.purpose || "").trim().toLowerCase();
        const secret = String(body?.secret || "").trim();

        if (!providerId) {
          json(res, { ok: false, error: "provider_id is required" }, 400);
          return true;
        }
        if (!purpose) {
          json(res, { ok: false, error: "purpose is required" }, 400);
          return true;
        }
        if (!secret) {
          json(res, { ok: false, error: "secret is required" }, 400);
          return true;
        }

        // Validate provider exists in catalog
        const provider = getProviderCatalog(providerId);
        if (!provider) {
          json(res, { ok: false, error: `不支持的服务商：${providerId}` }, 400);
          return true;
        }

        // Store secret in OS-backed credential vault (persists across restarts).
        if (!providerApiCredStore.isAvailable()) {
          json(res, {
            ok: false,
            error_code: "credential_store_unavailable",
            error: "安全凭据存储不可用，无法保存 API Key",
          }, 503);
          return true;
        }
        const apiKeyRef = `token-plan/${providerId}/${purpose}/${crypto.randomUUID()}`;
        const saved = providerApiCredStore.saveSecret(apiKeyRef, secret);
        if (!saved.ok) {
          json(res, {
            ok: false,
            error_code: saved.error_code || "credential_store_unavailable",
            error: "保存 API Key 失败",
          }, 503);
          return true;
        }
        tokenPlanSecretStore.set(apiKeyRef, secret);
        json(res, {
          ok: true,
          api_key_ref: apiKeyRef,
          provider_id: providerId,
          purpose,
          masked: saved.masked,
        });
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to save secret" }, e?.statusCode || 500);
      }
      return true;
    }
    // --- token plan catalog (W03B: 服务商目录与套餐列表，只读) ---
    if (p === "/functions/tokentracker-token-plan-catalog") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      const providerOptions = listProviderOptions();
      const providers = providerOptions.map((opt) => {
        const catalog = opt.id !== "custom" ? getProviderCatalog(opt.id) : null;
        return {
          id: opt.id,
          name: opt.name,
          plans: catalog ? catalog.plans : [],
        };
      });
      json(res, { providers });
      return true;
    }
    // --- token plans refresh (F03: 鎵嬪姩瑙﹀彂鍗曚釜 plan 鐨勫埛鏂? ---
    if (p === "/functions/tokentracker-token-plans-refresh") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const body = await readJsonBody(req);
        const id = String(body?.id || "").trim();
        if (!id) {
          json(res, { ok: false, error: "id is required" }, 400);
          return true;
        }
        const result = await runTokenPlanRefreshById(id);
        if (!result.ok) {
          json(res, { ok: false, error: result.error }, result.statusCode || 500);
          return true;
        }
        json(res, { ok: true, plan: result.plan, records: readTokenPlanRecords() });
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to refresh token plan" }, e?.statusCode || 500);
      }
      return true;
    }
    // --- 03-cost-billing: API billing accounts ---
    if (p === "/functions/tokentracker-api-billing-accounts") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const spendResult = readSpendRecords();
        const accounts = await collectApiBillingAccounts({
          spendRecords: spendResult.records || [],
          queuePath: qp,
        });

        // 02-ia-api-balance: Augment accounts with provider API config info.
        // Local usage costs (monthCostUsd, lifetimeCostUsd) are kept SEPARATE
        // from provider financial data (balance, monthSpend, lifetimeSpend) —
        // they must NOT be summed (different semantics).
        const config = readTrackerConfig();
        const providerConfigs = providerApiConfigs.readProviderApiConfigs(config);
        for (const account of accounts) {
          // Find matching provider API config by providerId
          const matchingConfig = providerConfigs.find(
            (c) => c.providerId === account.provider && c.enabled,
          );
          account.providerApiConfigured = Boolean(matchingConfig);
          // Include cached balance if available (no network call on list)
          if (matchingConfig) {
            const cached = providerApiBalanceManager.getCachedBalance(matchingConfig.id);
            // Provider financial data is in a SEPARATE field — never mixed into monthCostUsd
            account.providerApiBalance = cached || null;
          } else {
            account.providerApiBalance = null;
          }
        }

        json(res, { accounts });
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to collect API billing accounts", accounts: [] }, 500);
      }
      return true;
    }
    // --- 02-ia-api-balance: Provider API configs CRUD ---
    // GET    /functions/tokentracker-provider-api-configs
    // POST   /functions/tokentracker-provider-api-configs
    // PUT    /functions/tokentracker-provider-api-configs?id=<id>
    // DELETE /functions/tokentracker-provider-api-configs?id=<id>
    if (p === "/functions/tokentracker-provider-api-configs") {
      const method = String(req.method || "GET").toUpperCase();
      const idParam = url.searchParams.get("id");

      if (method === "GET") {
        try {
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          // Sanitize each config — never echo secrets
          const sanitized = configs.map((c) => providerApiConfigs.sanitizeConfigForOutput(c));
          json(res, { configs: sanitized });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to read configs"), configs: [] }, 500);
        }
        return true;
      }

      // All mutations require auth
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }

      if (method === "POST") {
        try {
          const body = await readJsonBody(req);
          const secretValidation = providerApiConfigs.validateProviderApiConfigSecrets(body);
          if (!secretValidation.ok) {
            json(res, { ok: false, error: secretValidation.error, error_code: secretValidation.error_code }, 400);
            return true;
          }
          const normalizedBody = providerApiConfigs.normalizeProviderApiConfig(body);
          const validation = providerApiConfigs.validateProviderApiConfig(normalizedBody, {
            testMode: providerApiTestMode,
          });
          if (!validation.ok) {
            json(res, { ok: false, error: validation.error, error_code: validation.error_code }, 400);
            return true;
          }
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          const { configs: nextConfigs, config: savedConfig } =
            providerApiConfigs.upsertProviderApiConfig(configs, normalizedBody);
          const updated = providerApiConfigs.writeProviderApiConfigs(config, nextConfigs);
          writeTrackerConfig(updated);
          json(res, { config: providerApiConfigs.sanitizeConfigForOutput(savedConfig) });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to save config") }, 500);
        }
        return true;
      }

      if (method === "PUT" && idParam) {
        try {
          const body = await readJsonBody(req);
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          const existing = providerApiConfigs.findConfigById(configs, idParam);
          if (!existing) {
            json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
            return true;
          }
          // Merge: preserve id and apiKeyRef from existing
          const merged = { ...existing, ...body, id: idParam, apiKeyRef: existing.apiKeyRef };
          const secretValidation = providerApiConfigs.validateProviderApiConfigSecrets(merged);
          if (!secretValidation.ok) {
            json(res, { ok: false, error: secretValidation.error, error_code: secretValidation.error_code }, 400);
            return true;
          }
          const normalizedMerged = providerApiConfigs.normalizeProviderApiConfig(merged);
          const validation = providerApiConfigs.validateProviderApiConfig(normalizedMerged, {
            testMode: providerApiTestMode,
          });
          if (!validation.ok) {
            json(res, { ok: false, error: validation.error, error_code: validation.error_code }, 400);
            return true;
          }
          const { configs: nextConfigs, config: updatedConfig } =
            providerApiConfigs.upsertProviderApiConfig(configs, normalizedMerged);
          const updated = providerApiConfigs.writeProviderApiConfigs(config, nextConfigs);
          writeTrackerConfig(updated);
          providerApiBalanceManager.clearCache(idParam);
          json(res, { config: providerApiConfigs.sanitizeConfigForOutput(updatedConfig) });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to update config") }, 500);
        }
        return true;
      }

      if (method === "DELETE" && idParam) {
        try {
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          const { configs: nextConfigs, removed, apiKeyRef } =
            providerApiConfigs.deleteProviderApiConfig(configs, idParam);
          if (!removed) {
            json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
            return true;
          }
          // Delete the associated secret from credential store (no orphan keys)
          if (apiKeyRef) {
            const deleted = providerApiCredStore.deleteSecret(apiKeyRef);
            if (!deleted && providerApiCredStore.isAvailable()) {
              // Credential delete failed — return visible error, don't leave orphan
              json(res, {
                ok: false,
                error: "配置已删除，但关联的 API Key 删除失败，请手动清理",
                error_code: "credential_delete_failed",
              }, 500);
              return true;
            }
          }
          const updated = providerApiConfigs.writeProviderApiConfigs(config, nextConfigs);
          writeTrackerConfig(updated);
          providerApiBalanceManager.clearCache(idParam);
          json(res, { ok: true });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to delete config") }, 500);
        }
        return true;
      }

      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- 02-ia-api-balance: Provider API secrets (save/delete) ---
    // POST   /functions/tokentracker-provider-api-secrets        { configId, secret }
    // DELETE /functions/tokentracker-provider-api-secrets?id=<configId>
    if (p === "/functions/tokentracker-provider-api-secrets") {
      const method = String(req.method || "GET").toUpperCase();

      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }

      if (method === "POST") {
        // 01-密钥安全修复 (F1 错误脱敏): 把 secret 提升到 try 外，使 catch 块能
        // 对其做 verbatim 脱敏。saveSecret 的 PowerShell/DPAPI 错误可能包含密钥原文。
        let secretForSanitization = "";
        try {
          const body = await readJsonBody(req);
          const configId = String(body?.configId || "").trim();
          const secret = String(body?.secret || "");
          secretForSanitization = secret;
          if (!configId) {
            json(res, { ok: false, error: "configId is required", error_code: "invalid_config" }, 400);
            return true;
          }
          if (!secret) {
            json(res, { ok: false, error: "secret is required", error_code: "invalid_config" }, 400);
            return true;
          }

          // Verify config exists
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          const existing = providerApiConfigs.findConfigById(configs, configId);
          if (!existing) {
            json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
            return true;
          }

          // Check credential store availability
          if (!providerApiCredStore.isAvailable()) {
            json(res, {
              ok: false,
              error: "安全凭据存储不可用，无法保存 API Key",
              error_code: "credential_store_unavailable",
            }, 503);
            return true;
          }

          // Generate ref and save to credential store
          const apiKeyRef = providerApiSecrets.generateApiKeyRef(existing.providerId);
          const saveResult = providerApiCredStore.saveSecret(apiKeyRef, secret);
          if (!saveResult.ok) {
            json(res, {
              ok: false,
              error: "保存 API Key 失败",
              error_code: saveResult.error_code || "credential_store_unavailable",
            }, 503);
            return true;
          }

          // Delete old secret if replacing
          if (existing.apiKeyRef && existing.apiKeyRef !== apiKeyRef) {
            try {
              providerApiCredStore.deleteSecret(existing.apiKeyRef);
            } catch {
              // best effort — old key may already be gone
            }
          }

          // Update config with the new apiKeyRef
          existing.apiKeyRef = apiKeyRef;
          const { configs: nextConfigs } = providerApiConfigs.upsertProviderApiConfig(configs, existing);
          const updated = providerApiConfigs.writeProviderApiConfigs(config, nextConfigs);
          writeTrackerConfig(updated);
          providerApiBalanceManager.clearCache(configId);

          // Return only masked preview — NEVER the full secret
          json(res, {
            ok: true,
            apiKeyRef,
            masked: saveResult.masked,
          });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): saveSecret/PowerShell 错误可能包含密钥原文，
          // 必须做 verbatim 脱敏（覆盖非 sk- 前缀密钥如 TE_REPAIR_SECRET_<uuid>）。
          const extraSecrets = secretForSanitization ? [secretForSanitization] : [];
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to save secret", extraSecrets) }, 500);
        }
        return true;
      }

      if (method === "DELETE") {
        try {
          const configId = url.searchParams.get("id");
          if (!configId) {
            json(res, { ok: false, error: "id is required", error_code: "invalid_config" }, 400);
            return true;
          }
          const config = readTrackerConfig();
          const configs = providerApiConfigs.readProviderApiConfigs(config);
          const existing = providerApiConfigs.findConfigById(configs, configId);
          if (!existing) {
            json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
            return true;
          }
          if (existing.apiKeyRef) {
            providerApiCredStore.deleteSecret(existing.apiKeyRef);
          }
          existing.apiKeyRef = "";
          const { configs: nextConfigs } = providerApiConfigs.upsertProviderApiConfig(configs, existing);
          const updated = providerApiConfigs.writeProviderApiConfigs(config, nextConfigs);
          writeTrackerConfig(updated);
          providerApiBalanceManager.clearCache(configId);
          json(res, { ok: true });
        } catch (e) {
          // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
          json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to delete secret") }, 500);
        }
        return true;
      }

      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- 02-ia-api-balance: Provider API test connection ---
    // POST /functions/tokentracker-provider-api-test?id=<configId>
    if (p === "/functions/tokentracker-provider-api-test") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const configId = url.searchParams.get("id");
        if (!configId) {
          json(res, { ok: false, error: "id is required", error_code: "invalid_config" }, 400);
          return true;
        }
        const config = readTrackerConfig();
        const configs = providerApiConfigs.readProviderApiConfigs(config);
        const existing = providerApiConfigs.findConfigById(configs, configId);
        if (!existing) {
          json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
          return true;
        }
        providerApiBalanceManager.clearCache(configId);
        const balance = await providerApiBalanceManager.refreshBalance(existing);
        json(res, { balance });
      } catch (e) {
        // 01-密钥安全修复 (F1 错误脱敏): doRefresh 内部已对 [secret] verbatim 脱敏，
        // 此处外层 catch 只处理基础设施错误，模式脱敏足够覆盖 Bearer/sk-/tp- 等。
        json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Test failed") }, 500);
      }
      return true;
    }
    // --- 02-ia-api-balance: Provider API refresh balance ---
    // POST /functions/tokentracker-provider-api-refresh?id=<configId>
    if (p === "/functions/tokentracker-provider-api-refresh") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const configId = url.searchParams.get("id");
        if (!configId) {
          json(res, { ok: false, error: "id is required", error_code: "invalid_config" }, 400);
          return true;
        }
        const config = readTrackerConfig();
        const configs = providerApiConfigs.readProviderApiConfigs(config);
        const existing = providerApiConfigs.findConfigById(configs, configId);
        if (!existing) {
          json(res, { ok: false, error: "配置不存在", error_code: "invalid_config" }, 404);
          return true;
        }
        const balance = await providerApiBalanceManager.refreshBalance(existing);
        json(res, { balance });
      } catch (e) {
        // 01-密钥安全修复 (F1 错误脱敏): doRefresh 内部已对 [secret] verbatim 脱敏。
        json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Refresh failed") }, 500);
      }
      return true;
    }
    // --- 02-ia-api-balance: Provider API balances (all configs) ---
    // GET /functions/tokentracker-provider-api-balances
    if (p === "/functions/tokentracker-provider-api-balances") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const config = readTrackerConfig();
        const configs = providerApiConfigs.readProviderApiConfigs(config);
        const balances = configs.map((c) => {
          // Return cached balance if available; otherwise return not-connected/placeholder
          const cached = providerApiBalanceManager.getCachedBalance(c.id);
          if (cached) return cached;
          const capabilities = providerApiConfigs.getProviderFinancialCapabilities(c);
          if (capabilities.balance === "unsupported" && capabilities.tokenQuota === "token_plan") {
            return providerApiBalance.makeBalance(c, {
              status: providerApiBalance.STATUS_UNSUPPORTED,
              errorCode: providerApiBalance.ERROR_CODES.UNSUPPORTED_ENDPOINT,
              errorMessage: "该供应商没有可验证的公开现金余额查询接口",
              lastSyncedAt: null,
            });
          }
          if (String(c.authType || "").toLowerCase() === "official_console") {
            const snapshot = resolveOfficialConsoleBalance(c);
            if (snapshot) {
              return providerApiBalance.makeBalance(c, {
                status: providerApiBalance.STATUS_SYNCED,
                balance: Number(snapshot.available_balance ?? snapshot.balance),
                monthSpend: null,
                lifetimeSpend: null,
                currency: String(snapshot.currency || "CNY"),
                lastSyncedAt: String(snapshot.provider_reported_at || new Date().toISOString()),
              });
            }
            return providerApiBalance.makeBalance(c, {
              status: providerApiBalance.STATUS_NOT_CONNECTED,
              errorCode: providerApiBalance.ERROR_CODES.CREDENTIAL_MISSING,
              errorMessage: "未完成官方控制台授权",
              lastSyncedAt: null,
            });
          }
          // If no secret configured, return not-connected
          if (!c.apiKeyRef) {
            return providerApiBalance.makeBalance(c, {
              status: providerApiBalance.STATUS_NOT_CONNECTED,
              errorCode: providerApiBalance.ERROR_CODES.CREDENTIAL_MISSING,
              errorMessage: "未配置 API Key",
              lastSyncedAt: null,
            });
          }
          // Has secret but not yet refreshed — return placeholder
          return providerApiBalance.makeBalance(c, {
            status: providerApiBalance.STATUS_NOT_CONNECTED,
            errorCode: providerApiBalance.ERROR_CODES.CREDENTIAL_MISSING,
            errorMessage: "尚未刷新",
            lastSyncedAt: null,
          });
        });
        json(res, { balances });
      } catch (e) {
        // 01-密钥安全修复 (F1 错误脱敏): 不得直接返回 e.message
        json(res, { ok: false, error: providerApiExecutor.sanitizeErrorMessage(e?.message || "Unable to read balances"), balances: [] }, 500);
      }
      return true;
    }
    // --- W03C: Xiaomi MiMo console session bindings ---
    // GET    /functions/tokentracker-token-plan-console-sessions
    // POST   /functions/tokentracker-token-plan-console-sessions
    // DELETE /functions/tokentracker-token-plan-console-sessions?id=<session-id>
    if (p === "/functions/tokentracker-token-plan-console-sessions") {
      const method = String(req.method || "GET").toUpperCase();
      const idParam = url.searchParams.get("id");

      // DELETE with query param id
      if (method === "DELETE" && idParam) {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const result = deleteConsoleSessionById(idParam);
          json(res, result);
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to delete session" }, e?.statusCode || 500);
        }
        return true;
      }

      // GET list
      if (method === "GET") {
        json(res, { sessions: readConsoleSessions() });
        return true;
      }

      // POST create/update
      if (method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          // Distinguish "no local auth token" from "the request is not coming
          // from the desktop app at all". The web fallback path hits this
          // branch and must surface a `desktop_required` error so the
          // dashboard can render "该功能仅桌面端支持" instead of faking
          // success.
          const headers = req?.headers || {};
          const hasOrigin = Boolean(headers.origin || headers.referer);
          if (!hasOrigin) {
            json(res, { ok: false, error: "desktop_required", error_code: "desktop_required" }, 403);
          } else {
            json(res, { ok: false, error: "Unauthorized" }, 401);
          }
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, upsertConsoleSession(body));
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to save console session" }, e?.statusCode || 500);
        }
        return true;
      }

      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // POST /functions/tokentracker-token-plan-console-sessions/<id>/verify
    if (p.startsWith("/functions/tokentracker-token-plan-console-sessions/") && p.endsWith("/verify")) {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        const headers = req?.headers || {};
        const hasOrigin = Boolean(headers.origin || headers.referer);
        if (!hasOrigin) {
          json(res, { ok: false, error: "desktop_required", error_code: "desktop_required" }, 403);
        } else {
          json(res, { ok: false, error: "Unauthorized" }, 401);
        }
        return true;
      }
      // Extract id from path: /functions/tokentracker-token-plan-console-sessions/<id>/verify
      const match = p.match(/\/functions\/tokentracker-token-plan-console-sessions\/([^/]+)\/verify$/);
      if (!match) {
        json(res, { ok: false, error: "Invalid path" }, 400);
        return true;
      }
      const sessionId = match[1];
      try {
        const body = await readJsonBody(req);
        const result = verifyConsoleSessionById(sessionId, body);
        json(res, { ok: true, ...result });
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unable to verify session" }, e?.statusCode || 500);
      }
      return true;
    }
    // --- local settings (machine-only; never uploaded) ---
    if (p === "/functions/tokentracker-official-model-pricing") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const body = await readJsonBody(req);
        const { verifyOfficialModelPricing } = require("./official-pricing");
        json(res, await verifyOfficialModelPricing(body));
      } catch (error) {
        json(res, {
          ok: false,
          status: "manual_required",
          error: error?.message || "官方自动核价失败。",
        }, 502);
      }
      return true;
    }

    // --- local settings (machine-only; never uploaded) ---
    if (p === "/functions/tokentracker-local-settings") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, readLocalSettings());
        return true;
      }
      if (method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...updateLocalSettings(body) });
        } catch (e) {
          json(res, { ok: false, error: e?.message || "Unable to save local settings" }, 500);
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- discover known local/WSL agent data roots without reading their contents ---
    if (p === "/functions/tokentracker-detect-data-directories") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        const settings = readLocalSettings();
        json(res, {
          ok: true,
          ...detectDataDirectories({ config: { dataDirectories: settings?.dataDirectories || {} } }),
        });
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- select directory (local-only helper for Token Eyes MVP settings) ---
    if (p === "/functions/tokentracker-select-directory") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        json(res, await selectDirectoryWithSystemDialog());
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- agent environment detection ---
    if (p === "/functions/tokentracker-agent-environment") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        const agentId = url.searchParams.get("agent");
        const draftPath = url.searchParams.get("path");
        const settings = readLocalSettings();
        const config = { dataDirectories: settings?.dataDirectories || {} };

        if (agentId) {
          if (draftPath != null) {
            config.dataDirectories = { ...config.dataDirectories, [agentId]: draftPath };
          }
          const result = detectAgentEnvironmentForRequest(agentId, config);
          json(res, { ok: true, result });
        } else {
          const results = detectAllAgentEnvironments(config);
          json(res, { ok: true, results });
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
    // --- cloud-sync preference mirror ---
    // The dashboard's Settings 鈫?Account 鈫?Cloud sync toggle (a WebView
    // localStorage flag) is mirrored here so the auth-unaware native popover can
    // gate its account (cross-device) view on the same preference.
    if (p === "/functions/tokentracker-cloud-sync-pref") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, {
          enabled: getCloudSyncPref(),
          account_available: Boolean(getRefreshTokenForCloud()),
        });
        return true;
      }
      if (method === "POST" || method === "PUT") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        // Reject malformed payloads rather than silently coercing them to a
        // persisted `false` 鈥?this file is the shared cloud-sync preference, so
        // a bad write would desync the popover from the dashboard.
        if (typeof body?.enabled !== "boolean") {
          json(res, { ok: false, error: "enabled must be a boolean" }, 400);
          return true;
        }
        setCloudSyncPref(body.enabled);
        json(res, { ok: true, enabled: getCloudSyncPref() });
        return true;
      }
      json(res, { error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- machine-id (stable per-machine device identity for cloud sync) ---
    // The dashboard reads this before issuing a cloud device token so the
    // device_name keys on the MACHINE, not the browser 鈥?see
    // getOrCreateMachineId above and dashboard/src/lib/cloud-sync.ts.
    if (p === "/functions/tokentracker-machine-id") {
      json(res, { machineId: getOrCreateMachineId(qp) });
      return true;
    }

    // --- usage-hourly (stub for day-view) ---
    if (p === "/functions/tokentracker-usage-hourly") {
      const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const data = aggregateHourlyByDay(rows, day, timeZoneContext);
      json(res, { day, scope, excluded_sources: excludedSources, data });
      return true;
    }

    // --- usage-monthly (stub for trend view) ---
    if (p === "/functions/tokentracker-usage-monthly") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const byMonth = new Map();
      for (const row of rows) {
        if (!row.hour_start) continue;
        const day = rowDayKey(row, timeZoneContext);
        if (!day || day < from || day > to) continue;
        const month = day.slice(0, 7);
        if (!byMonth.has(month))
          byMonth.set(month, { month, total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 });
        const a = byMonth.get(month);
        a.total_tokens += row.total_tokens || 0;
        a.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        a.input_tokens += row.input_tokens || 0;
        a.output_tokens += row.output_tokens || 0;
        a.cached_input_tokens += row.cached_input_tokens || 0;
        a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        a.conversation_count += row.conversation_count || 0;

        if (!a.models) {
          a.models = {};
        }
        const model = row.model || "unknown";
        a.models[model] = (a.models[model] || 0) + (row.total_tokens || 0);
      }
      json(res, { from, to, scope, excluded_sources: excludedSources, data: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)) });
      return true;
    }

    // --- skills manager ---
    if (p === "/functions/tokentracker-skills") {
      const method = String(req.method || "GET").toUpperCase();
      const skills = require("./skills-manager");
      try {
        if (method === "GET") {
          const mode = url.searchParams.get("mode") || "installed";
          if (mode === "installed") {
            json(res, { targets: skills.targetList(), skills: skills.listInstalledSkills() });
            return true;
          }
          if (mode === "repos") {
            json(res, { repos: skills.listRepos() });
            return true;
          }
          if (mode === "discover") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.discoverSkills({ force }));
            return true;
          }
          if (mode === "search") {
            const data = await skills.searchSkillsSh(
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("limit") || 20),
              Number(url.searchParams.get("offset") || 0),
            );
            json(res, data);
            return true;
          }
          if (mode === "popular") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.fetchPopularSkillsSh({ force }));
            return true;
          }
          if (mode === "updates") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.checkUpdates({ force }));
            return true;
          }
          if (mode === "activity") {
            const limit = Number(url.searchParams.get("limit") || 50);
            json(res, { activity: skills.readActivity(limit) });
            return true;
          }
          if (mode === "skill_usage") {
            const force = url.searchParams.get("force") === "1";
            const usage = await require("./skill-usage").scanSkillUsage({ force });
            await ensurePricingLoaded();
            // Join raw per-skill aggregates against installed skills so we can
            // separate user-installed skills (where "dead weight" = unused) from
            // Claude Code built-in tools (bash/agent/鈥?, which dominate the logs
            // and are NOT uninstallable. Cost is priced per-model (source=claude).
            const installed = skills.listInstalledSkills();
            const skillDirectoryLeaf = (value) =>
              String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim().toLowerCase() || "";
            const leafCounts = new Map();
            for (const s of installed) {
              const leaf = skillDirectoryLeaf(s.directory);
              if (leaf) leafCounts.set(leaf, (leafCounts.get(leaf) || 0) + 1);
            }
            const installedByDirectory = new Map();
            const installedByLeaf = new Map();
            const nameCounts = new Map();
            const installedByName = new Map();
            for (const s of installed) {
              const dir = String(s.directory || "").trim().toLowerCase();
              if (dir) installedByDirectory.set(dir, s);
              const leaf = skillDirectoryLeaf(s.directory);
              if (leaf && leafCounts.get(leaf) === 1) installedByLeaf.set(leaf, s);
              const name = String(s.name || "").trim().toLowerCase();
              if (name) {
                nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                if (!installedByName.has(name)) installedByName.set(name, s);
              }
            }
            const findInstalledSkill = (value) => {
              const norm = String(value || "").trim().toLowerCase();
              if (!norm) return null;
              if (installedByDirectory.has(norm)) return installedByDirectory.get(norm);
              if (installedByLeaf.has(norm)) return installedByLeaf.get(norm);
              if (nameCounts.get(norm) === 1) return installedByName.get(norm);
              if (leafCounts.get(norm) > 1) return null;
              return null;
            };
            const usedSkillIds = new Set();
            const priced = usage.skills.map((entry) => {
              let cost = 0;
              for (const [model, tokens] of Object.entries(entry.models || {})) {
                cost += computeRowCost({ ...tokens, model, source: "claude" });
              }
              const match = findInstalledSkill(entry.skill);
              if (match?.id) usedSkillIds.add(match.id);
              return {
                skill: entry.skill,
                invocations: entry.invocations,
                lastUsedAt: entry.lastUsedAt,
                tokens: entry.tokens,
                cost,
                installed: Boolean(match),
                skillId: match?.id || null,
                directory: match?.directory || null,
              };
            });
            // Installed skills with zero invocations = dead-weight candidates.
            const unusedInstalled = installed
              .filter((s) => !usedSkillIds.has(s.id))
              .map((s) => ({ skillId: s.id, directory: s.directory, name: s.name }));
            json(res, {
              generatedAt: usage.generatedAt,
              scannedFiles: usage.scannedFiles,
              totalInvocations: usage.totalInvocations,
              cached: usage.cached,
              skills: priced,
              unusedInstalled,
            });
            return true;
          }
          json(res, { error: "Unknown skills mode" }, 400);
          return true;
        }

        if (method === "POST") {
          if (!isAuthorizedLocalMutation(req)) {
            json(res, { ok: false, error: "Unauthorized" }, 401);
            return true;
          }
          const body = await readJsonBody(req);
          const action = String(body?.action || "");
          if (action === "install") {
            json(res, { ok: true, skill: await skills.installSkill(body.skill, body.targets || ["claude", "codex"]) });
            return true;
          }
          if (action === "uninstall") {
            json(res, { ok: true, ...(skills.uninstallSkill(body.id) || {}) });
            return true;
          }
          if (action === "restore") {
            json(res, { ok: true, skill: skills.restoreSkill(body.id) });
            return true;
          }
          if (action === "set_targets") {
            json(res, { ok: true, skill: skills.setSkillTargets(body.id, body.targets || []) });
            return true;
          }
          if (action === "import_local") {
            json(res, { ok: true, skill: skills.importLocalSkill(body.directory, body.targets || []) });
            return true;
          }
          if (action === "delete_local") {
            json(res, { ok: true, ...(skills.deleteLocalSkill(body.directory, body.targets || []) || {}) });
            return true;
          }
          if (action === "add_repo") {
            json(res, { ok: true, repo: skills.addRepo(body.repo) });
            return true;
          }
          if (action === "remove_repo") {
            json(res, { ok: true, ...(skills.removeRepo(body.owner, body.name) || {}) });
            return true;
          }
          json(res, { ok: false, error: "Unknown skills action" }, 400);
          return true;
        }

        json(res, { ok: false, error: "Method Not Allowed" }, 405);
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unknown skills error" }, 500);
      }
      return true;
    }

    // --- usage-limits ---
    if (p === "/functions/tokentracker-usage-limits") {
      const usageLimitsModule = require("./usage-limits");
      try {
        const forceRefresh = url.searchParams.get("refresh");
        if (
          (forceRefresh === "1" || forceRefresh === "true")
          && typeof usageLimitsProvider !== "function"
        ) {
          usageLimitsModule.resetUsageLimitsCache();
        }
        const loadUsageLimits = typeof usageLimitsProvider === "function"
          ? usageLimitsProvider
          : usageLimitsModule.getUsageLimits;
        const data = await loadUsageLimits({
          home: os.homedir(),
          env: process.env,
          platform: process.platform,
        });
        const directoryStates = typeof tokenOnlyDirectoryStatesProvider === "function"
          ? tokenOnlyDirectoryStatesProvider(readLocalSettings())
          : resolveTokenOnlyDirectoryStates(readLocalSettings());
        json(res, {
          ...data,
          ...summarizeTokenOnlyUsage(readQueueData(qp), directoryStates),
        });
      } catch (e) {
        json(res, { error: e?.message || "Unknown error" }, 500);
      }
      return true;
    }

    return false;
  };

  // F03: 鎶婅皟搴﹀櫒鎺у埗鏂规硶鎸傚埌 handler 涓婏紝渚?serve.js 鍚姩鏃惰皟鐢ㄣ€?
  handleLocalApi.startTokenPlanScheduler = startTokenPlanScheduler;
  handleLocalApi.stopTokenPlanScheduler = stopTokenPlanScheduler;
  handleLocalApi.runTokenPlanDueRefresh = runTokenPlanDueRefresh;
  handleLocalApi.runTokenPlanRefreshById = runTokenPlanRefreshById;
  handleLocalApi.startCodexResetMonitor = () => codexResetMonitorService.start();
  handleLocalApi.stopCodexResetMonitor = () => codexResetMonitorService.stop();
  handleLocalApi.codexResetMonitorService = codexResetMonitorService;
  // Q02: expose billing_mode derivation helpers so unit tests can lock the
  // rules down without standing up the full local-api handler.
  handleLocalApi.deriveModelBillingMode = deriveModelBillingMode;
  handleLocalApi.summarizeSourceBillingMode = summarizeSourceBillingMode;
  handleLocalApi.normalizeBillingModeRaw = normalizeBillingModeRaw;
  handleLocalApi.planLabelMatchesModel = planLabelMatchesModel;

  return handleLocalApi;
}

module.exports = {
  appendDetectedTokenOnlyProviders,
  createLocalApiHandler,
  resolveAllowedInsforgeBaseUrl,
  resolveQueuePath,
  // Exported for cross-consumer tests (pricing + native contract lock).
  MODEL_PRICING,
  getModelPricing,
  computeRowCost,
  ensurePricingLoaded,
  normalizeAgentDefaultPricing,
  normalizePricingRules,
  // Shared legacy-row correction so every queue reader (main queue, project
  // queue, wrapped aggregator) reports the same numbers for the same data.
  normalizeQueueRow,
  // Machine-stable identity (config.json machineId) 鈥?shared with
  // `tracker device-login` so the CLI device-flow anchors its cloud device
  // to the machine, not the hostname.
  getOrCreateMachineId,
  computeStableMachineId,
  readQueueData,
  summarizeTokenOnlyUsage,
  clearQueueDataCacheForTests,
  clearRequestUsageRecordsListCacheForTests,
};
