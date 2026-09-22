const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const { readJson } = require("./fs");
const {
  readLimitedFetchResponse,
  readLimitedResponseBody,
  redactSecrets,
  safeOutboundRequest,
} = require("./safe-outbound-request");
const { readSqliteFirstValue } = require("./sqlite-reader");

// ── Path resolution ──

function resolveCursorPaths({ appDir: appDirOverride, home, platform = process.platform, env = process.env } = {}) {
  const h = home || os.homedir();
  const pathForPlatform = platform === "win32" ? path.win32 : path.posix;
  let appDir = typeof appDirOverride === "string" ? appDirOverride.trim() : "";
  if (!appDir && platform === "darwin") {
    appDir = pathForPlatform.join(h, "Library", "Application Support", "Cursor");
  } else if (!appDir && platform === "win32") {
    const appData =
      (typeof env.APPDATA === "string" && env.APPDATA.trim()) ||
      pathForPlatform.join(h, "AppData", "Roaming");
    appDir = pathForPlatform.join(appData, "Cursor");
  } else if (!appDir) {
    const xdg =
      (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
      pathForPlatform.join(h, ".config");
    appDir = pathForPlatform.join(xdg, "Cursor");
  }
  return {
    appDir,
    stateDbPath: pathForPlatform.join(appDir, "User", "globalStorage", "state.vscdb"),
    cliConfigPath: pathForPlatform.join(h, ".cursor", "cli-config.json"),
  };
}

function isCursorInstalled({ appDir, home, platform, env } = {}) {
  const { appDir: resolvedAppDir } = resolveCursorPaths({ appDir, home, platform, env });
  try {
    return fs.statSync(resolvedAppDir).isDirectory();
  } catch {
    return false;
  }
}

// ── Auth token extraction ──

const CURSOR_ACCESS_TOKEN_SQL =
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';";

function cursorDebugLog(message, env = process.env) {
  const dbg = String((env && env.TOKENTRACKER_DEBUG) || "").toLowerCase();
  if (dbg === "1" || dbg === "true") {
    process.stderr.write(`[cursor] ${message}\n`);
  }
}

function readCursorAccessTokenFromStateDb(stateDbPath, deps = {}) {
  return readSqliteFirstValue(stateDbPath, CURSOR_ACCESS_TOKEN_SQL, "value", {
    execFileSync: deps.execFileSync,
    requireFn: deps.requireFn,
    env: deps.env,
    stderr: deps.stderr,
    label: "Cursor",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Extract Cursor session cookie from local SQLite + cli-config.json.
 * Returns { cookie, userId } or null on failure.
 *
 * Cookie format: WorkosCursorSessionToken=<userId>%3A%3A<jwt>
 * - JWT from state.vscdb → ItemTable → cursorAuth/accessToken
 * - userId from cli-config.json → authInfo.authId
 *   - native Cursor email/password: "auth0|user_XXXXX"        → "user_XXXXX"
 *   - Google sign-in via WorkOS:    "google-oauth2|<numeric>" → kept verbatim
 *   - other WorkOS subjects:        "github|…", "oidc|…"      → kept verbatim
 */
function extractCursorSessionToken({ appDir, home, platform, env, deps } = {}) {
  const { stateDbPath, cliConfigPath } = resolveCursorPaths({ appDir, home, platform, env });

  // 1. Extract JWT from SQLite
  if (!fs.existsSync(stateDbPath)) {
    cursorDebugLog(`Cursor state DB not found at ${stateDbPath}`, deps?.env);
    return null;
  }
  const jwt = readCursorAccessTokenFromStateDb(stateDbPath, deps);
  if (!jwt || jwt.length < 10) return null;

  // 2. Extract userId — try cli-config.json first, fall back to JWT decode
  let userId = extractUserIdFromCliConfig(cliConfigPath);
  if (!userId) {
    userId = extractUserIdFromJwt(jwt);
  }
  if (!userId) return null;

  // 3. Build cookie
  const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${jwt}`;
  return { cookie, userId };
}

// WorkOS OAuth subject prefixes Cursor accepts as-is in the session cookie.
// Verified against cursor.com/api/usage-summary (issue #88).
const WORKOS_OAUTH_SUBJECT_RE = /^(google-oauth2|github|oidc|auth0)\|[^|]+$/;

function normalizeCursorSubject(subject) {
  if (!subject) return null;
  // Native Cursor: "auth0|user_XXXXX" → strip provider prefix, return "user_XXXXX"
  const native = subject.match(/\|(user_[A-Za-z0-9_]+)$/);
  if (native) return native[1];
  // WorkOS-bridged OAuth: keep the full "<provider>|<id>" subject
  if (WORKOS_OAUTH_SUBJECT_RE.test(subject)) return subject;
  return null;
}

function extractUserIdFromCliConfig(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return normalizeCursorSubject(config?.authInfo?.authId || "");
  } catch {
    return null;
  }
}

function extractUserIdFromJwt(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return normalizeCursorSubject(payload.sub || "");
  } catch {
    return null;
  }
}

// ── API client ──

const CURSOR_CSV_URL = "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";
const CURSOR_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const CURSOR_SOURCE_SCOPE = "account";
const CURSOR_ORIGIN = "https://cursor.com";
const CURSOR_CSV_MAX_BYTES = 25 * 1024 * 1024;
const CURSOR_SUMMARY_MAX_BYTES = 1024 * 1024;

function createCursorRequestHeaders(cookie, accept) {
  return {
    Accept: accept,
    Cookie: cookie,
    Referer: "https://www.cursor.com/settings",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
}

function cursorApiError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function sanitizeCursorApiError(error, secrets) {
  let message = redactSecrets(error?.message || String(error), secrets);
  for (const secret of secrets) {
    if (secret) message = String(message).split(secret).join("[REDACTED]");
  }
  const sanitized = cursorApiError(message || "Cursor API request failed", error?.code);
  return sanitized;
}

function validateCursorApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw cursorApiError("Cursor API redirect has an invalid Location header", "cursor_redirect_rejected");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== CURSOR_ORIGIN ||
    url.username ||
    url.password
  ) {
    throw cursorApiError("Cursor API redirect target is not allowed", "cursor_redirect_rejected");
  }
  return url;
}

function resolveCursorRedirect(currentUrl, location) {
  if (typeof location !== "string" || !location.trim()) {
    throw cursorApiError("Cursor API redirect is missing a Location header", "cursor_redirect_rejected");
  }
  let target;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw cursorApiError("Cursor API redirect has an invalid Location header", "cursor_redirect_rejected");
  }
  return validateCursorApiUrl(target);
}

function isRedirectStatus(status) {
  return Number.isInteger(status) && status >= 300 && status < 400;
}

function discardNodeResponse(response, request) {
  try { request?.destroy?.(); } catch { /* best-effort socket cleanup */ }
  try { response?.destroy?.(); } catch { /* best-effort stream cleanup */ }
}

async function discardFetchResponse(response) {
  try {
    if (response?.body && !response.body.locked) await response.body.cancel();
  } catch {
    // The response is being rejected; cancellation is best-effort cleanup.
  }
}

function getResponseHeader(response, name) {
  if (typeof response?.headers?.get === "function") return response.headers.get(name);
  if (!response?.headers || typeof response.headers !== "object") return null;
  const key = Object.keys(response.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? response.headers[key] : null;
}

/**
 * Fetch one authenticated Cursor resource with at most one redirect.
 * Every Node request goes through the shared DNS/IP validation and pinned
 * lookup layer; redirects are additionally restricted to exact cursor.com.
 */
async function fetchCursorAuthenticated({
  urlStr = CURSOR_CSV_URL,
  cookie,
  timeoutMs = 30000,
  dnsLookup,
  requestImpl,
}) {
  let currentUrl = validateCursorApiUrl(urlStr);

  try {
    for (let redirectCount = 0; redirectCount <= 1; redirectCount += 1) {
      const { request, response } = await safeOutboundRequest(currentUrl, {
        dnsLookup,
        requestImpl,
        method: "GET",
        headers: createCursorRequestHeaders(cookie, "*/*"),
        timeoutMs,
        rejectSecretQuery: true,
        secrets: [cookie],
      });
      const status = Number(response.statusCode || 0);

      if (status === 401 || status === 403) {
        discardNodeResponse(response, request);
        throw cursorApiError("Cursor session expired — re-login in Cursor to refresh");
      }

      if (isRedirectStatus(status)) {
        const location = response.headers?.location;
        discardNodeResponse(response, request);
        if (redirectCount >= 1) {
          throw cursorApiError("Cursor API returned more than one redirect", "cursor_redirect_rejected");
        }
        currentUrl = resolveCursorRedirect(currentUrl, location);
        continue;
      }

      if (status !== 200) {
        discardNodeResponse(response, request);
        throw cursorApiError(`Cursor API returned ${status}`);
      }

      const body = await readLimitedResponseBody(response, {
        maxBytes: CURSOR_CSV_MAX_BYTES,
        request,
        secrets: [cookie],
      });
      return body.toString("utf8");
    }
  } catch (error) {
    throw sanitizeCursorApiError(error, [cookie]);
  }

  throw cursorApiError("Cursor API redirect could not be completed", "cursor_redirect_rejected");
}

/**
 * Fetch full usage CSV from Cursor API.
 * Returns raw CSV string or throws on error.
 */
function fetchCursorUsageCsv({ cookie, timeoutMs = 30000, dnsLookup, requestImpl }) {
  return fetchCursorAuthenticated({
    urlStr: CURSOR_CSV_URL,
    cookie,
    timeoutMs,
    dnsLookup,
    requestImpl,
  });
}

/**
 * Fetch Cursor usage summary JSON.
 * Returns parsed JSON body or throws on error.
 */
async function fetchCursorUsageSummary({ cookie, timeoutMs = 30000, fetchImpl = fetch }) {
  let currentUrl = validateCursorApiUrl(CURSOR_SUMMARY_URL);

  try {
    for (let redirectCount = 0; redirectCount <= 1; redirectCount += 1) {
      const response = await fetchImpl(currentUrl.href, {
        method: "GET",
        headers: createCursorRequestHeaders(cookie, "application/json"),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const status = Number(response.status || 0);

      if (status === 401 || status === 403) {
        await discardFetchResponse(response);
        throw cursorApiError("Cursor session expired — re-login in Cursor to refresh");
      }

      if (isRedirectStatus(status)) {
        const location = getResponseHeader(response, "location");
        await discardFetchResponse(response);
        if (redirectCount >= 1) {
          throw cursorApiError("Cursor API returned more than one redirect", "cursor_redirect_rejected");
        }
        currentUrl = resolveCursorRedirect(currentUrl, location);
        continue;
      }

      if (status !== 200) {
        await discardFetchResponse(response);
        throw cursorApiError(`Cursor API returned ${status}`);
      }

      const body = await readLimitedFetchResponse(response, {
        maxBytes: CURSOR_SUMMARY_MAX_BYTES,
      });
      try {
        return JSON.parse(body.toString("utf8"));
      } catch {
        throw cursorApiError("Cursor API returned invalid JSON");
      }
    }
  } catch (error) {
    throw sanitizeCursorApiError(error, [cookie]);
  }

  throw cursorApiError("Cursor API redirect could not be completed", "cursor_redirect_rejected");
}

// ── CSV parsing ──

/**
 * Parse Cursor usage CSV into structured records.
 *
 * Column order has changed multiple times (e.g. new "Cloud Agent ID",
 * "Automation ID" columns inserted before "Kind"). Resolve columns by
 * header name instead of fixed index so the parser keeps working across
 * future Cursor updates.
 *
 * Known required columns: Date, Model, Input (w/ Cache Write),
 * Input (w/o Cache Write), Cache Read, Output Tokens, Total Tokens, Cost.
 * Optional: Kind, Max Mode.
 */
function parseCursorCsv(csvText, { strict = false } = {}) {
  const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
  if (!lines.length || (lines.length < 2 && !strict)) return [];

  const headerFields = parseCsvLine(lines[0]).map((f) => stripQuotes(f));
  const columnIndex = new Map();
  for (let i = 0; i < headerFields.length; i++) {
    columnIndex.set(headerFields[i], i);
  }

  const dateIdx = columnIndex.get("Date");
  const modelIdx = columnIndex.get("Model");
  const inputWithIdx = columnIndex.get("Input (w/ Cache Write)");
  const inputWithoutIdx = columnIndex.get("Input (w/o Cache Write)");
  const cacheReadIdx = columnIndex.get("Cache Read");
  const outputIdx = columnIndex.get("Output Tokens");
  const totalIdx = columnIndex.get("Total Tokens");
  const costIdx = columnIndex.get("Cost");
  const kindIdx = columnIndex.get("Kind");
  const maxModeIdx = columnIndex.get("Max Mode");

  const required = [dateIdx, modelIdx, inputWithIdx, inputWithoutIdx, cacheReadIdx, outputIdx, totalIdx, costIdx];
  if (required.some((idx) => idx === undefined)) {
    if (strict) throw new Error("Cursor export schema unsupported");
    return [];
  }

  const minFields = Math.max(...required) + 1;

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (!fields || fields.length < minFields) {
      if (strict) throw new Error("Cursor export row incomplete");
      continue;
    }
    if (strict && !Number.isFinite(Date.parse(stripQuotes(fields[dateIdx])))) throw new Error("Cursor export date invalid");

    const inputWithCache = toNum(fields[inputWithIdx]);
    const inputWithoutCache = toNum(fields[inputWithoutIdx]);
    const record = {
      date: stripQuotes(fields[dateIdx]),
      kind: kindIdx !== undefined ? stripQuotes(fields[kindIdx]) : "unknown",
      model: stripQuotes(fields[modelIdx]),
      maxMode: maxModeIdx !== undefined ? stripQuotes(fields[maxModeIdx]) : "No",
      sourceScope: CURSOR_SOURCE_SCOPE,
      billableKind: isCursorBillableKind(kindIdx !== undefined ? fields[kindIdx] : "unknown")
        ? "billable"
        : "non_billable",
      inputTokens: inputWithoutCache,
      cacheWriteTokens: Math.max(0, inputWithCache - inputWithoutCache),
      cacheReadTokens: toNum(fields[cacheReadIdx]),
      outputTokens: toNum(fields[outputIdx]),
      totalTokens: toNum(fields[totalIdx]),
      cost: toFloat(fields[costIdx]),
    };

    if (record.totalTokens <= 0 && record.inputTokens <= 0 && record.outputTokens <= 0) continue;

    records.push(record);
  }

  return records;
}

/**
 * Normalize a Cursor CSV record to TokenTracker's standard token format.
 */
function normalizeCursorUsage(record) {
  const inputTokens = Math.max(0, Math.floor(record.inputTokens || 0));
  const cacheWrite = Math.max(0, Math.floor(record.cacheWriteTokens || 0));
  const cacheRead = Math.max(0, Math.floor(record.cacheReadTokens || 0));
  const outputTokens = Math.max(0, Math.floor(record.outputTokens || 0));
  const totalTokens = inputTokens + outputTokens + cacheWrite + cacheRead;
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    // Usage tracking and billing are orthogonal: a Cursor Enterprise /
    // Included-in-Pro request still consumes tokens even when the user
    // pays nothing for them. Cost is computed independently from
    // per-column tokens × MODEL_PRICING (see computeRowCost — it never
    // reads this field), while the dashboard headline reads
    // billable_total_tokens. Writing 0 here silently hides non-billable
    // Cursor usage from the headline once any other source pushes the
    // aggregate billable above 0 (see GitHub issue #106).
    // isCursorBillableKind is retained for a future paid-vs-included
    // breakdown via a separate is_billable field, not by overloading the
    // token count.
    billable_total_tokens: totalTokens,
  };
}

function isCursorBillableKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("no charge")) return false;
  if (normalized === "free") return false;
  return true;
}

// ── CSV helpers ──

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function stripQuotes(s) {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toNum(s) {
  const n = Number(stripQuotes(s));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function toFloat(s) {
  const cleaned = stripQuotes(s).replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Stage every account before publishing any queue snapshot. A failed account
// must not erase its contribution when another account's export succeeds.
async function collectCursorAccountUsage({ homes, home, previousAccountKeys = [],
  isInstalled = isCursorInstalled, readAuth = extractCursorSessionToken,
  fetchCsv = fetchCursorUsageCsv } = {}) {
  const accountKeys = new Set();
  const records = [];
  for (const appDir of [...new Set(homes || [])]) {
    if (!isInstalled({ home, appDir })) continue;
    const auth = readAuth({ home, appDir });
    if (!auth?.userId) throw new Error("Cursor account identity unavailable");
    const key = require("node:crypto").createHash("sha256").update(auth.userId).digest("hex");
    if (accountKeys.has(key)) continue;
    const csv = await fetchCsv({ cookie: auth.cookie });
    records.push(...parseCursorCsv(csv, { strict: true }));
    accountKeys.add(key);
  }
  if (previousAccountKeys.some(key => !accountKeys.has(key))) throw new Error("Cursor account coverage incomplete");
  return { records, accountKeys: [...accountKeys] };
}

module.exports = {
  collectCursorAccountUsage,
  resolveCursorPaths,
  isCursorInstalled,
  readCursorAccessTokenFromStateDb,
  extractCursorSessionToken,
  fetchCursorAuthenticated,
  fetchCursorUsageCsv,
  fetchCursorUsageSummary,
  parseCursorCsv,
  isCursorBillableKind,
  normalizeCursorUsage,
};
