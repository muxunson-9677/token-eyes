const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

const {
  detectClaudeCodeSubscriptionDetails,
  readClaudeCodeAccessToken,
  readCodexAccessToken,
  readCodexAuthBundle,
} = require("./subscriptions");
const {
  isTokenStale,
  refreshCodexTokens,
  persistRefreshedAuth,
} = require("./codex-token-refresh");
const {
  isCursorInstalled,
  extractCursorSessionToken,
  fetchCursorUsageSummary,
} = require("./cursor-config");
const { normalizeCursorUsageSummary } = require("./cursor-token-plan");
const codexUsageMapper = require("./codex-token-plan");
const { fetchGrokLimits } = require("./grok-limits");
const { fetchZedLimits } = require("./zed-limits");
const { readSqliteJsonRows } = require("./sqlite-reader");
const { decorateUsageLimitsWithEvidence } = require("./data-evidence");
const { redactSecrets, writeCredentialJsonFileSync } = require("./credential-file");

// 2-minute in-memory cache
let cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const ANTIGRAVITY_LIMITS_CACHE_FILE = "usage-limits-cache.json";
const ANTIGRAVITY_LIMITS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANTIGRAVITY_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS = 12 * 60 * 60 * 1000;
// Claude shares its OAuth usage endpoint budget with Claude Code itself, so a transient
// 429 is common. Persist the last successful read so the panel can keep showing it instead
// of flashing a red error. Separate file from Antigravity's (whose writer rewrites the whole
// file with only its own key, so a shared file would clobber).
const CLAUDE_LIMITS_CACHE_FILE = "claude-usage-limits-cache.json";
const CLAUDE_LIMITS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_LIMITS_CACHE_FRESH_TTL_MS = 10 * 60 * 1000;
// A 429 from the usage endpoint carries a long `retry-after` (often 20+ minutes). Persist
// the cooldown so every surface — this process, the menu bar app's embedded server, a later
// restart — stops calling until it expires. Hammering during the cooldown just renews the
// penalty, which is what kept the panel stuck on the error.
const CLAUDE_RATE_LIMIT_FILE = "claude-usage-rate-limit.json";
const CLAUDE_RATE_LIMIT_DEFAULT_COOLDOWN_SEC = 5 * 60;
const CLAUDE_RATE_LIMIT_MAX_COOLDOWN_SEC = 60 * 60;

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function buildWindow({ usedPercent, resetAt }) {
  const pct = clampPercent(usedPercent);
  if (pct === null) return null;
  return {
    used_percent: pct,
    reset_at: typeof resetAt === "string" && resetAt ? resetAt : null,
  };
}

function decodeJwtPayload(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1];
  const padLen = (4 - (payload.length % 4)) % 4;
  const padded = payload + "=".repeat(padLen);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeAbortSignals(signalA, signalB) {
  if (!signalA) return signalB;
  if (!signalB) return signalA;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signalA, signalB]);
  }
  return signalA;
}

function withFetchTimeout(fetchImpl, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl;
  return (url, options = {}) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return fetchImpl(url, {
      ...options,
      signal: mergeAbortSignals(options.signal, timeoutSignal),
    });
  };
}

function withProviderTimeout(promise, label, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} usage request timed out.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseRetryAfterSeconds(headers) {
  const ra = headers?.get ? headers.get("retry-after") : null;
  const sec = ra ? Number.parseInt(ra, 10) : NaN;
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

function formatClaudeRateLimitMessage(retryAfterSec) {
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    const mins = Math.ceil(retryAfterSec / 60);
    return `Claude API rate limited (429) — retry in ~${mins}m.`;
  }
  return "Claude API rate limited (429) — retry shortly.";
}

async function fetchClaudeUsageLimits(accessToken, { fetchImpl = fetch, maxAttempts = 3 } = {}) {
  const url = "https://api.anthropic.com/api/oauth/usage";
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json",
  };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchImpl(url, { method: "GET", headers });
    if (res.status === 401) {
      throw new Error("Claude token expired — run `claude` once to refresh.");
    }
    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
      const ra = res.headers.get("retry-after");
      const sec = ra ? Number.parseInt(ra, 10) : NaN;
      const delayMs = Number.isFinite(sec) && sec > 0 ? Math.min(sec * 1000, 30_000) : 1500 * (attempt + 1);
      await sleepMs(delayMs);
      continue;
    }
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfterSec = parseRetryAfterSeconds(res.headers);
        const err = new Error(formatClaudeRateLimitMessage(retryAfterSec));
        err.code = "RATE_LIMITED";
        err.retryAfterSec = retryAfterSec;
        throw err;
      }
      throw new Error(`Claude API returned ${res.status}`);
    }
    const body = await res.json();
    return {
      five_hour: body.five_hour ?? null,
      seven_day: body.seven_day ?? null,
      seven_day_opus: body.seven_day_opus ?? null,
      extra_usage: body.extra_usage ?? null,
    };
  }
}

async function fetchCodexUsageLimits(
  accessToken,
  { fetchImpl = fetch, accountId = null } = {},
) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  // The wham endpoint rejects some plan tiers without an explicit account id — match
  // CodexBar's request shape so free / multi-account users don't see opaque 4xx.
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  let res;
  try {
    res = await fetchImpl("https://chatgpt.com/backend-api/wham/usage", {
      method: "GET",
      headers,
    });
  } catch {
    throw new codexUsageMapper.CodexTokenPlanError(
      "CODEX_NETWORK_ERROR",
      "Codex usage request failed",
    );
  }
  if (!res.ok) {
    throw codexUsageMapper.codexUsageErrorForHttpStatus(res.status);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new codexUsageMapper.CodexTokenPlanError(
      "CODEX_RESPONSE_STRUCTURE_DRIFT",
      "Codex usage response is not valid JSON",
    );
  }
  const mapped = codexUsageMapper.mapCodexUsageResponse(body);
  if (!mapped.primary_window && !mapped.secondary_window) {
    throw new codexUsageMapper.CodexTokenPlanError(
      "CODEX_NO_QUOTA_WINDOWS",
      "Codex quota windows are missing",
    );
  }
  return mapped;
}

function toIsoResetAt(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sanitizeCodexWindow(window) {
  const normalized = codexUsageMapper.normalizeCodexRateWindow(window);
  if (!normalized) return null;
  return {
    used_percent: normalized.used_percent,
    reset_at: toIsoResetAt(normalized.reset_at),
  };
}

async function refreshCodexAuthBundle(codexAuth, { fetchImpl = fetch } = {}) {
  if (!codexAuth) return { auth: null, refreshError: null };
  if (!isTokenStale(codexAuth.lastRefresh) || !codexAuth.refreshToken) {
    return { auth: codexAuth, refreshError: null };
  }
  try {
    const newTokens = await refreshCodexTokens({
      refreshToken: codexAuth.refreshToken,
      fetchImpl,
    });
    const updatedAuth = await persistRefreshedAuth(
      codexAuth.authPath,
      codexAuth.authJson,
      newTokens,
    );
    return {
      auth: {
        ...codexAuth,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        lastRefresh: updatedAuth.last_refresh,
        authJson: updatedAuth,
      },
      refreshError: null,
    };
  } catch (refreshError) {
    return { auth: codexAuth, refreshError };
  }
}

async function getCodexUsageLimits({
  home,
  env,
  fetchImpl = fetch,
  now = new Date(),
  providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
} = {}) {
  const checkedAt = new Date(now);
  const checked_at = Number.isFinite(checkedAt.getTime())
    ? checkedAt.toISOString()
    : new Date().toISOString();
  const codexAuth = await readCodexAuthBundle({ home, env });
  if (!codexAuth) return { configured: false, checked_at };

  const refreshed = await refreshCodexAuthBundle(codexAuth, { fetchImpl });
  if (refreshed.refreshError?.code === "REFRESH_TOKEN_EXPIRED") {
    return {
      configured: true,
      checked_at,
      auth_action_required: "reauth",
      error_code: "auth_refresh_expired",
    };
  }

  const auth = refreshed.auth;
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
  };
  if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

  let response;
  try {
    response = await withProviderTimeout(
      fetchImpl("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers,
      }),
      "Codex",
      providerTimeoutMs,
    );
  } catch (_error) {
    return {
      configured: true,
      checked_at,
      ...codexUsageMapper.codexUsageErrorState(
        new codexUsageMapper.CodexTokenPlanError("CODEX_NETWORK_ERROR", "Codex usage request failed"),
      ),
    };
  }

  if (!response.ok) {
    return {
      configured: true,
      checked_at,
      ...codexUsageMapper.codexUsageErrorState(
        codexUsageMapper.codexUsageErrorForHttpStatus(response.status),
      ),
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (_error) {
    return {
      configured: true,
      checked_at,
      ...codexUsageMapper.codexUsageErrorState(
        new codexUsageMapper.CodexTokenPlanError(
          "CODEX_RESPONSE_STRUCTURE_DRIFT",
          "Codex usage response is not valid JSON",
        ),
      ),
    };
  }
  const mapped = codexUsageMapper.mapCodexUsageResponse(body);
  if (!mapped.primary_window && !mapped.secondary_window) {
    return {
      configured: true,
      checked_at,
      ...codexUsageMapper.codexUsageErrorState(
        new codexUsageMapper.CodexTokenPlanError(
          "CODEX_NO_QUOTA_WINDOWS",
          "Codex quota windows are missing",
        ),
      ),
    };
  }
  return {
    configured: true,
    checked_at,
    primary_window: sanitizeCodexWindow(mapped.primary_window),
    secondary_window: sanitizeCodexWindow(mapped.secondary_window),
    spark_primary_window: sanitizeCodexWindow(mapped.spark_primary_window),
    spark_secondary_window: sanitizeCodexWindow(mapped.spark_secondary_window),
    ...(mapped.reset_credits ? { reset_credits: mapped.reset_credits } : {}),
  };
}

async function fetchCursorLimits({ home, fetchImpl = fetch } = {}) {
  if (!isCursorInstalled({ home })) {
    return { configured: false };
  }
  const auth = extractCursorSessionToken({ home });
  if (!auth?.cookie) {
    return { configured: false };
  }
  try {
    const body = await fetchCursorUsageSummary({ cookie: auth.cookie, fetchImpl });
    return {
      configured: true,
      error: null,
      ...normalizeCursorUsageSummary(body),
    };
  } catch (error) {
    return {
      configured: true,
      error: error?.message || "Unknown error",
    };
  }
}

function resolveKimiHome({ home, env } = {}) {
  const explicit = typeof env?.KIMI_HOME === "string" ? env.KIMI_HOME.trim() : "";
  if (explicit) return path.resolve(explicit);
  const base = home || os.homedir();
  // Prefer the official Kimi Code (@moonshot-ai/kimi-code, ~/.kimi-code) when it
  // holds a login — its credential file shape (kimi-code.json) and the
  // auth/usages endpoints are identical to the legacy kimi-cli (~/.kimi), so the
  // existing fetch path works unchanged. Fall back to legacy when kimi-code has
  // no credentials, keeping old kimi-cli users untouched.
  const explicitCode = typeof env?.KIMI_CODE_HOME === "string" ? env.KIMI_CODE_HOME.trim() : "";
  const codeHome = explicitCode ? path.resolve(explicitCode) : path.join(base, ".kimi-code");
  const codeCredsPath = path.join(codeHome, "credentials", "kimi-code.json");
  try {
    const raw = fs.readFileSync(codeCredsPath, "utf8").trim();
    if (raw && JSON.parse(raw)?.access_token) return codeHome;
  } catch { /* missing / empty / corrupt — fall through to legacy */ }
  return path.join(base, ".kimi");
}

function loadKimiCredentials({ home, env } = {}) {
  const kimiHome = resolveKimiHome({ home, env });
  const credsPath = path.join(kimiHome, "credentials", "kimi-code.json");
  if (!fs.existsSync(credsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(credsPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function readCredentialJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Vendor credential file is not a JSON object");
  }
  return parsed;
}

function credentialTokenSecrets(...groups) {
  const secrets = [];
  for (const group of groups) {
    if (typeof group === "string") {
      if (group) secrets.push(group);
      continue;
    }
    if (!group || typeof group !== "object") continue;
    for (const key of ["access_token", "refresh_token", "id_token"]) {
      if (typeof group[key] === "string" && group[key]) secrets.push(group[key]);
    }
  }
  return Array.from(new Set(secrets));
}

function credentialPersistWarning(provider, error, secrets) {
  const detail = redactSecrets(error?.message || "Unknown persistence error", secrets);
  return `${provider} refreshed credential was not saved; Token Eyes will retry from the vendor file next time: ${detail}`;
}

function persistCredentialJson(filePath, value, credentialFileOptions, secrets) {
  const injectedSecrets = Array.isArray(credentialFileOptions?.secrets)
    ? credentialFileOptions.secrets
    : [];
  return writeCredentialJsonFileSync(filePath, value, {
    ...(credentialFileOptions || {}),
    mergeLatest: true,
    secrets: [
      ...credentialTokenSecrets(...injectedSecrets),
      ...secrets,
    ],
  });
}

function kimiNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function kimiResetTime(value) {
  if (typeof value !== "string" || !value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

function kimiWindowFromUsage(data) {
  if (!data || typeof data !== "object") return null;
  const limit = kimiNumber(data.limit);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  let used = kimiNumber(data.used);
  if (used === null) {
    const remaining = kimiNumber(data.remaining);
    if (remaining !== null) used = limit - remaining;
  }
  if (!Number.isFinite(used)) return null;
  return buildWindow({
    usedPercent: (used / limit) * 100,
    resetAt: kimiResetTime(data.resetTime || data.reset_at || data.resetAt),
  });
}

function normalizeKimiUsageResponse(body) {
  const firstLimit = Array.isArray(body?.limits) ? body.limits[0] : null;
  const detail = firstLimit?.detail && typeof firstLimit.detail === "object" ? firstLimit.detail : firstLimit;
  const parallelLimit = kimiNumber(body?.parallel?.limit);

  return {
    membership_level: typeof body?.user?.membership?.level === "string" ? body.user.membership.level : null,
    subscription_type: typeof body?.subType === "string" ? body.subType : null,
    parallel_limit: parallelLimit !== null ? parallelLimit : null,
    primary_window: kimiWindowFromUsage(body?.usage),
    secondary_window: kimiWindowFromUsage(detail),
    tertiary_window: kimiWindowFromUsage(body?.totalQuota),
  };
}

function kimiCredentialsExpired(creds, nowMs = Date.now()) {
  const expiresAt = Number(creds?.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt * 1000 <= nowMs + 30_000;
}

async function refreshKimiAccessToken({
  refreshToken,
  credentialPath,
  credentialFileOptions,
  knownSecrets,
  fetchImpl = fetch,
} = {}) {
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new Error("Not logged in to Kimi. Run 'kimi' in Terminal to authenticate.");
  }

  const body = new URLSearchParams({
    client_id: "17e5f671-d194-4dfb-9706-5516cb48c098",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetchImpl("https://auth.kimi.com/api/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Msh-Platform": "kimi_cli",
    },
    body,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Not logged in to Kimi. Run 'kimi' in Terminal to authenticate.");
  }
  if (!res.ok) {
    throw new Error(`Kimi token refresh failed (HTTP ${res.status})`);
  }

  const json = await res.json();
  if (!json?.access_token) {
    throw new Error("Could not parse Kimi token refresh response");
  }

  const expiresIn = Number(json.expires_in);
  const accessToken = String(json.access_token);
  const secrets = credentialTokenSecrets(
    ...(Array.isArray(knownSecrets) ? knownSecrets : []),
    refreshToken,
    json,
  );
  let effectiveRefreshToken = typeof json.refresh_token === "string" && json.refresh_token
    ? json.refresh_token
    : refreshToken;
  let warning = null;
  try {
    const lifetimeSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900;
    const rotations = {
      access_token: accessToken,
      expires_at: Date.now() / 1000 + lifetimeSeconds,
      expires_in: lifetimeSeconds,
    };
    if (typeof json.refresh_token === "string" && json.refresh_token) {
      rotations.refresh_token = json.refresh_token;
    }
    if (typeof json.scope === "string" && json.scope) rotations.scope = json.scope;
    if (typeof json.token_type === "string" && json.token_type) rotations.token_type = json.token_type;
    const persisted = persistCredentialJson(credentialPath, rotations, credentialFileOptions, secrets);
    secrets.push(...credentialTokenSecrets(persisted.value));
    if (!(typeof json.refresh_token === "string" && json.refresh_token)
        && typeof persisted.value?.refresh_token === "string"
        && persisted.value.refresh_token) {
      effectiveRefreshToken = persisted.value.refresh_token;
    }
  } catch (error) {
    warning = credentialPersistWarning("Kimi", error, secrets);
    if (!(typeof json.refresh_token === "string" && json.refresh_token)) {
      try {
        const latestCredentials = readCredentialJson(credentialPath);
        secrets.push(...credentialTokenSecrets(latestCredentials));
        if (typeof latestCredentials.refresh_token === "string" && latestCredentials.refresh_token) {
          effectiveRefreshToken = latestCredentials.refresh_token;
        }
      } catch (_readError) {}
    }
  }
  return {
    accessToken,
    refreshToken: effectiveRefreshToken,
    credentialPersistWarning: warning,
    redactionSecrets: credentialTokenSecrets(...secrets, accessToken),
  };
}

async function fetchKimiUsage(accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl("https://api.kimi.com/coding/v1/usages", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401) {
    throw new Error("token_expired");
  }
  if (!res.ok) {
    throw new Error(`Kimi API returned ${res.status}`);
  }
  return res.json();
}

async function fetchKimiLimits({ home, env, fetchImpl = fetch, credentialFileOptions } = {}) {
  const kimiHome = resolveKimiHome({ home, env });
  if (!fs.existsSync(path.join(kimiHome, "config.toml"))) {
    return { configured: false };
  }
  const credentialPath = path.join(kimiHome, "credentials", "kimi-code.json");
  let creds = null;
  try {
    creds = readCredentialJson(credentialPath);
  } catch (_error) {
    return { configured: false };
  }
  let accessToken = typeof creds?.access_token === "string" ? creds.access_token.trim() : "";
  if (!accessToken) {
    return { configured: false };
  }
  const errorSecrets = credentialTokenSecrets(creds);
  try {
    let persistWarning = null;
    let refreshToken = typeof creds?.refresh_token === "string" ? creds.refresh_token : "";
    if (kimiCredentialsExpired(creds) && refreshToken) {
      const refreshed = await refreshKimiAccessToken({
        refreshToken,
        credentialPath,
        credentialFileOptions,
        knownSecrets: errorSecrets,
        fetchImpl,
      });
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken || refreshToken;
      errorSecrets.push(...refreshed.redactionSecrets);
      persistWarning = refreshed.credentialPersistWarning;
    }
    let body;
    try {
      body = await fetchKimiUsage(accessToken, { fetchImpl });
    } catch (error) {
      if (error?.message === "token_expired" && refreshToken) {
        const refreshed = await refreshKimiAccessToken({
          refreshToken,
          credentialPath,
          credentialFileOptions,
          knownSecrets: errorSecrets,
          fetchImpl,
        });
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken || refreshToken;
        errorSecrets.push(...refreshed.redactionSecrets);
        persistWarning = refreshed.credentialPersistWarning || persistWarning;
        body = await fetchKimiUsage(accessToken, { fetchImpl });
      } else {
        throw error;
      }
    }
    return {
      configured: true,
      error: null,
      ...normalizeKimiUsageResponse(body),
      ...(persistWarning ? { credential_persist_warning: persistWarning } : {}),
    };
  } catch (error) {
    return {
      configured: true,
      error: redactSecrets(error?.message || "Unknown error", errorSecrets),
    };
  }
}

function resolveGeminiHome({ home, env } = {}) {
  const explicit = typeof env?.GEMINI_HOME === "string" ? env.GEMINI_HOME.trim() : "";
  return explicit ? path.resolve(explicit) : path.join(home, ".gemini");
}

function loadGeminiSettings({ home, env } = {}) {
  const geminiHome = resolveGeminiHome({ home, env });
  const settingsPath = path.join(geminiHome, "settings.json");
  if (!fs.existsSync(settingsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function loadGeminiCredentials({ home, env } = {}) {
  const geminiHome = resolveGeminiHome({ home, env });
  const credsPath = path.join(geminiHome, "oauth_creds.json");
  if (!fs.existsSync(credsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(credsPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function resolveSymlinkOnce(filePath) {
  try {
    const resolved = fs.readlinkSync(filePath);
    return path.isAbsolute(resolved)
      ? resolved
      : path.join(path.dirname(filePath), resolved);
  } catch (_error) {
    return filePath;
  }
}

function expandGeminiExecutableCandidates({ home } = {}) {
  const candidates = [];
  const add = (filePath) => {
    if (typeof filePath === "string" && filePath && !candidates.includes(filePath)) {
      candidates.push(filePath);
    }
  };

  const nvmDir = path.join(home || os.homedir(), ".nvm", "versions", "node");
  try {
    for (const version of fs.readdirSync(nvmDir)) {
      add(path.join(nvmDir, version, "bin", "gemini"));
    }
  } catch (_error) {}

  add(path.join(path.dirname(resolveSymlinkOnce(process.execPath)), "gemini"));
  add("/opt/homebrew/bin/gemini");
  add("/usr/local/bin/gemini");

  return candidates;
}

async function extractGeminiOauthClientCredentials({ commandRunner, home } = {}) {
  const result = await runCommand(commandRunner, "which", ["gemini"], { timeout: 2000 });
  const geminiPath = typeof result?.stdout === "string" ? result.stdout.trim() : "";

  const geminiPaths = [
    ...(geminiPath ? [geminiPath] : []),
    ...expandGeminiExecutableCandidates({ home }),
  ];

  for (const candidateGeminiPath of geminiPaths) {
    if (!fs.existsSync(candidateGeminiPath)) continue;
    const realPath = resolveSymlinkOnce(candidateGeminiPath);
    const binDir = path.dirname(realPath);
    const baseDir = path.dirname(binDir);
    const bundleDir = path.dirname(realPath);
    const candidates = [
      path.join(baseDir, "libexec/lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
      path.join(baseDir, "lib/node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
      path.join(baseDir, "share/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
      path.join(baseDir, "../gemini-cli-core/dist/src/code_assist/oauth2.js"),
      path.join(baseDir, "node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"),
    ];
    if (path.basename(bundleDir) === "bundle") {
      candidates.push(realPath);
      try {
        for (const file of fs.readdirSync(bundleDir)) {
          if (/^chunk-.*\.js$/.test(file)) {
            candidates.push(path.join(bundleDir, file));
          }
        }
      } catch (_error) {}
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const content = fs.readFileSync(candidate, "utf8");
        const clientId = content.match(/OAUTH_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/)?.[1] || null;
        const clientSecret = content.match(/OAUTH_CLIENT_SECRET\s*=\s*['"]([^'"]+)['"]/)?.[1] || null;
        if (clientId && clientSecret) {
          return { clientId, clientSecret };
        }
      } catch (_error) {}
    }
  }
  return null;
}

async function refreshGeminiAccessToken({
  refreshToken,
  home,
  credentialPath,
  credentialFileOptions,
  fetchImpl = fetch,
  commandRunner,
}) {
  const oauthClient = await extractGeminiOauthClientCredentials({ commandRunner, home });
  if (!oauthClient?.clientId || !oauthClient?.clientSecret) {
    throw new Error("Gemini API error: Could not find Gemini CLI OAuth configuration");
  }

  const body = new URLSearchParams({
    client_id: oauthClient.clientId,
    client_secret: oauthClient.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.");
  }

  const json = await res.json();
  if (!json?.access_token) {
    throw new Error("Could not parse Gemini usage: invalid token refresh response");
  }

  const accessToken = String(json.access_token);
  const secrets = credentialTokenSecrets(refreshToken, json);
  let latestIdToken = typeof json.id_token === "string" && json.id_token ? json.id_token : null;
  let warning = null;
  try {
    const rotations = { access_token: accessToken };
    if (typeof json.refresh_token === "string" && json.refresh_token) {
      rotations.refresh_token = json.refresh_token;
    }
    if (typeof json.id_token === "string" && json.id_token) {
      rotations.id_token = json.id_token;
    }
    if (typeof json.expires_in === "number" && Number.isFinite(json.expires_in)) {
      rotations.expiry_date = Date.now() + json.expires_in * 1000;
    }
    const persisted = persistCredentialJson(credentialPath, rotations, credentialFileOptions, secrets);
    secrets.push(...credentialTokenSecrets(persisted.value));
    if (!latestIdToken && typeof persisted.value.id_token === "string" && persisted.value.id_token) {
      latestIdToken = persisted.value.id_token;
    }
  } catch (error) {
    warning = credentialPersistWarning("Gemini", error, secrets);
  }

  return {
    accessToken,
    idToken: latestIdToken,
    credentialPersistWarning: warning,
    redactionSecrets: credentialTokenSecrets(...secrets, accessToken, latestIdToken),
  };
}

async function loadGeminiCodeAssistStatus(accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" } }),
  });
  if (!res.ok) {
    return { tier: null, projectId: null };
  }
  const json = await res.json();
  const tier = typeof json?.currentTier?.id === "string" ? json.currentTier.id : null;
  const rawProject = json?.cloudaicompanionProject;
  const projectId =
    typeof rawProject === "string"
      ? rawProject.trim() || null
      : typeof rawProject?.id === "string"
        ? rawProject.id
        : typeof rawProject?.projectId === "string"
          ? rawProject.projectId
          : null;
  return { tier, projectId };
}

function normalizeGeminiModelBuckets(buckets) {
  if (!Array.isArray(buckets)) return [];
  const byModel = new Map();
  for (const bucket of buckets) {
    const modelId = typeof bucket?.modelId === "string" ? bucket.modelId : null;
    const remainingFraction = Number(bucket?.remainingFraction);
    if (!modelId || !Number.isFinite(remainingFraction)) continue;
    const existing = byModel.get(modelId);
    if (!existing || remainingFraction < existing.remainingFraction) {
      byModel.set(modelId, {
        model_id: modelId,
        remainingFraction,
        reset_at: parseAntigravityDate(bucket?.resetTime),
      });
    }
  }
  return Array.from(byModel.values()).sort((a, b) => a.model_id.localeCompare(b.model_id));
}

function isGeminiFlashLiteModel(id) {
  return String(id || "").toLowerCase().includes("flash-lite");
}

function isGeminiFlashModel(id) {
  const lower = String(id || "").toLowerCase();
  return lower.includes("flash") && !isGeminiFlashLiteModel(lower);
}

function isGeminiProModel(id) {
  return String(id || "").toLowerCase().includes("pro");
}

function normalizeGeminiQuotaResponse({ buckets, email, tier }) {
  const models = normalizeGeminiModelBuckets(buckets);
  if (!models.length) {
    throw new Error("Could not parse Gemini usage: no quota buckets in response");
  }

  const pickLowest = (predicate) =>
    models
      .filter((model) => predicate(model.model_id))
      .sort((a, b) => a.remainingFraction - b.remainingFraction)[0] || null;

  const plan =
    tier === "standard-tier"
      ? "Paid"
      : tier === "legacy-tier"
        ? "Legacy"
        : tier === "free-tier"
          ? "Free"
          : null;

  const pro = pickLowest(isGeminiProModel);
  const flash = pickLowest(isGeminiFlashModel);
  const flashLite = pickLowest(isGeminiFlashLiteModel);
  const fallback = !pro && !flash && !flashLite
    ? [...models].sort((a, b) => a.remainingFraction - b.remainingFraction)[0]
    : null;

  const toWindow = (model) =>
    model
      ? buildWindow({
          usedPercent: 100 - model.remainingFraction * 100,
          resetAt: model.reset_at,
        })
      : null;

  return {
    account_email: email || null,
    account_plan: plan,
    primary_window: toWindow(pro || fallback),
    secondary_window: toWindow(flash),
    tertiary_window: toWindow(flashLite),
  };
}

async function fetchGeminiLimits({
  home,
  env,
  fetchImpl = fetch,
  commandRunner,
  credentialFileOptions,
} = {}) {
  const settings = loadGeminiSettings({ home, env });
  const selectedType = settings?.security?.auth?.selectedType ?? null;
  if (!settings && !loadGeminiCredentials({ home, env })) {
    return { configured: false };
  }
  if (selectedType === "api-key") {
    return { configured: true, error: "Gemini API key auth not supported. Use Google account (OAuth) instead." };
  }
  if (selectedType === "vertex-ai") {
    return { configured: true, error: "Gemini Vertex AI auth not supported. Use Google account (OAuth) instead." };
  }

  const creds = loadGeminiCredentials({ home, env });
  if (!creds?.access_token) {
    return { configured: true, error: "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate." };
  }

  const errorSecrets = credentialTokenSecrets(creds);
  try {
    let accessToken = creds.access_token;
    let idToken = creds.id_token;
    let persistWarning = null;
    const expiry = Number(creds.expiry_date);
    if (Number.isFinite(expiry) && expiry > 0 && expiry < Date.now() && creds.refresh_token) {
      const refreshed = await refreshGeminiAccessToken({
        refreshToken: creds.refresh_token,
        home,
        credentialPath: path.join(resolveGeminiHome({ home, env }), "oauth_creds.json"),
        credentialFileOptions,
        fetchImpl,
        commandRunner,
      });
      accessToken = refreshed.accessToken;
      idToken = refreshed.idToken || idToken;
      errorSecrets.push(...refreshed.redactionSecrets);
      persistWarning = refreshed.credentialPersistWarning;
    }

    const claims = decodeJwtPayload(idToken);
    const codeAssist = await loadGeminiCodeAssistStatus(accessToken, { fetchImpl });
    const res = await fetchImpl("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(codeAssist.projectId ? { project: codeAssist.projectId } : {}),
    });
    if (res.status === 401) {
      throw new Error("Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.");
    }
    if (!res.ok) {
      throw new Error(`Gemini API error: HTTP ${res.status}`);
    }
    const json = await res.json();
    return {
      configured: true,
      error: null,
      ...normalizeGeminiQuotaResponse({
        buckets: json?.buckets,
        email: claims?.email || null,
        tier: codeAssist.tier,
      }),
      ...(persistWarning ? { credential_persist_warning: persistWarning } : {}),
    };
  } catch (error) {
    return {
      configured: true,
      error: redactSecrets(error?.message || "Unknown error", errorSecrets),
    };
  }
}

// Async command runner. Previously this wrapped `cp.spawnSync`, which blocked the
// Node event loop for the full command duration (up to 20s for Kiro) and froze every
// other local-api endpoint plus the other providers' withProviderTimeout races.
// Returns a promise for a spawnSync-shaped result: { status, stdout, stderr, error? }.
// Injected runners (tests) may stay synchronous — their return value is wrapped in
// Promise.resolve so both sync and async runners work.
function runCommand(commandRunner, command, args, options = {}) {
  const merged = {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  if (typeof commandRunner === "function") {
    return Promise.resolve(commandRunner(command, args, merged));
  }

  const { timeout, maxBuffer, ...spawnOptions } = merged;
  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn(command, args, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ status: null, stdout: "", stderr: "", error });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer = null;
    let hardTimer = null;

    const settle = ({ status = null, error = null } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      let finalError = error;
      if (!finalError && timedOut) {
        finalError = new Error(`spawn ${command} ETIMEDOUT`);
        finalError.code = "ETIMEDOUT";
      }
      const result = { status, stdout, stderr };
      if (finalError) result.error = finalError;
      resolve(result);
    };

    if (Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch (_error) {}
        // Guarantee settlement even if the child ignores SIGTERM or keeps stdio open.
        hardTimer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch (_error) {}
          settle({ status: null });
        }, 1000);
        if (typeof hardTimer.unref === "function") hardTimer.unref();
      }, timeout);
    }

    const collect = (stream, append) => {
      if (!stream) return;
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        append(chunk);
        if (stdout.length + stderr.length > maxBuffer) {
          const error = new Error(`spawn ${command} maxBuffer length exceeded`);
          error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          try { child.kill("SIGKILL"); } catch (_error) {}
          settle({ status: null, error });
        }
      });
    };
    collect(child.stdout, (chunk) => { stdout += chunk; });
    collect(child.stderr, (chunk) => { stderr += chunk; });

    child.on("error", (error) => settle({ status: null, error }));
    child.on("close", (code) => settle({ status: timedOut ? null : code }));
  });
}

async function whichBinary(binary, { commandRunner } = {}) {
  const result = await runCommand(commandRunner, "which", [binary], { timeout: 2000 });
  if (result?.error || result?.status !== 0) return null;
  const stdout = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  return stdout ? stdout.split("\n")[0] : null;
}

async function isBinaryAvailable(binary, { commandRunner } = {}) {
  return (await whichBinary(binary, { commandRunner })) !== null;
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1B\[[0-9;?]*[A-Za-z]|\x1B\].*?\x07/g, "");
}

function extractFirstNumber(text) {
  const match = String(text || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseMonthDayResetDate(dateStr, now = new Date()) {
  if (typeof dateStr !== "string") return null;
  const match = dateStr.match(/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  const currentYear = now.getUTCFullYear();

  let candidate = new Date(Date.UTC(currentYear, month - 1, day, 0, 0, 0, 0));
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(Date.UTC(currentYear + 1, month - 1, day, 0, 0, 0, 0));
  }
  return candidate.toISOString();
}

function isKiroUsageOutputComplete(output) {
  const lowered = stripAnsi(output).toLowerCase();
  return lowered.includes("covered in plan")
    || lowered.includes("resets on")
    || lowered.includes("bonus credits")
    || lowered.includes("plan:")
    || lowered.includes("managed by admin")
    || lowered.includes("managed by organization");
}

function parseKiroUsageOutput(output, { now = new Date() } = {}) {
  const stripped = stripAnsi(output).trim();
  if (!stripped) {
    throw new Error("Failed to parse Kiro usage: empty output");
  }

  const lowered = stripped.toLowerCase();
  if (
    lowered.includes("not logged in")
    || lowered.includes("login required")
    || lowered.includes("failed to initialize auth portal")
    || lowered.includes("kiro-cli login")
    || lowered.includes("oauth error")
  ) {
    throw new Error("Not logged in to Kiro. Run 'kiro-cli login' first.");
  }
  if (lowered.includes("could not retrieve usage information")) {
    throw new Error("Failed to parse Kiro usage: Kiro CLI could not retrieve usage information.");
  }

  let planName = "Kiro";
  const legacyPlan = stripped.match(/\|\s*(KIRO\s+\w+)/);
  if (legacyPlan?.[1]) {
    planName = legacyPlan[1].trim();
  }
  const modernPlan = stripped.match(/Plan:\s*(.+)/);
  if (modernPlan?.[1]) {
    planName = modernPlan[1].split("\n")[0].trim() || planName;
  }

  const resetMatch = stripped.match(/resets on (\d{2}\/\d{2})/i);
  const primaryReset = resetMatch ? parseMonthDayResetDate(resetMatch[1], now) : null;

  let creditsPercent = null;
  const percentMatch = stripped.match(/█+\s*(\d+)%/);
  if (percentMatch?.[1]) {
    creditsPercent = clampPercent(Number(percentMatch[1]));
  }

  let creditsUsed = null;
  let creditsTotal = null;
  const coveredMatch = stripped.match(/\((\d+(?:\.\d+)?)\s+of\s+(\d+(?:\.\d+)?)\s+covered/i);
  if (coveredMatch?.[1] && coveredMatch?.[2]) {
    creditsUsed = Number(coveredMatch[1]);
    creditsTotal = Number(coveredMatch[2]);
  }
  if (creditsPercent === null && creditsUsed !== null && creditsTotal && creditsTotal > 0) {
    creditsPercent = clampPercent((creditsUsed / creditsTotal) * 100);
  }

  const managedPlan = lowered.includes("managed by admin") || lowered.includes("managed by organization");
  if (creditsPercent === null && creditsUsed === null && managedPlan) {
    return {
      plan_name: planName,
      primary_window: buildWindow({ usedPercent: 0, resetAt: null }),
      secondary_window: null,
    };
  }
  if (creditsPercent === null && creditsUsed === null) {
    throw new Error("Failed to parse Kiro usage: usage output format may have changed.");
  }

  let bonusWindow = null;
  const bonusMatch = stripped.match(/Bonus credits:[\s\S]*?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/i);
  const expiryMatch = stripped.match(/expires in (\d+) days?/i);
  if (bonusMatch?.[1] && bonusMatch?.[2]) {
    const bonusUsed = Number(bonusMatch[1]);
    const bonusTotal = Number(bonusMatch[2]);
    const bonusPct = bonusTotal > 0 ? clampPercent((bonusUsed / bonusTotal) * 100) : 0;
    let bonusReset = null;
    if (expiryMatch?.[1]) {
      const days = Number(expiryMatch[1]);
      if (Number.isFinite(days) && days >= 0) {
        bonusReset = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    bonusWindow = buildWindow({ usedPercent: bonusPct, resetAt: bonusReset });
  }

  return {
    plan_name: planName,
    primary_window: buildWindow({ usedPercent: creditsPercent, resetAt: primaryReset }),
    secondary_window: bonusWindow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Copilot — `GET https://api.github.com/copilot_internal/user`
// Reuses the OAuth token from the user's existing Copilot install. Older clients
// keep it in plaintext (`~/.config/github-copilot/{apps,hosts}.json`); recent
// copilot-language-server builds (Zed, copilot.vim) migrate it into an encrypted
// SQLite store (`auth.db`) and leave the plaintext files behind as stale legacy
// copies. Prefer secure-store candidates; legacy plaintext is attempted only
// after a 401/403 response. No device flow is needed either way.
// ─────────────────────────────────────────────────────────────────────────────

const MACOS_SECURITY_BIN = "/usr/bin/security";
// copilot-language-server stores the OAuth token as AES-256-GCM ciphertext in
// auth.db (`oauth_tokens.token_ciphertext`) and the 32-byte key in the macOS
// Keychain (service `copilot-language-server`, account `oauth-token-key`,
// base64-encoded). Ciphertext layout: iv(12) ‖ ciphertext ‖ authTag(16).
const COPILOT_LS_KEYCHAIN_SERVICE = "copilot-language-server";
const COPILOT_LS_KEYCHAIN_ACCOUNT = "oauth-token-key";
const COPILOT_AUTH_DB_SQL =
  "SELECT user_login, auth_authority, scopes, hex(token_ciphertext) AS token_hex, "
  + "last_used_at, updated_at FROM oauth_tokens ORDER BY last_used_at DESC, updated_at DESC";
const COPILOT_CREDENTIAL_IDENTITY = Symbol.for("tokentracker.copilot.credential-identity");

function copilotAuthDbPath(home) {
  return path.join(home, ".config", "github-copilot", "auth.db");
}

function candidateTimestamp(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function orderCopilotCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const leftPublic = left.authority === "github.com" ? 0 : 1;
    const rightPublic = right.authority === "github.com" ? 0 : 1;
    return leftPublic - rightPublic;
  });
}

function dedupeCopilotCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.token || seen.has(candidate.token)) return false;
    seen.add(candidate.token);
    return true;
  });
}

function readPlaintextCopilotOauthCandidates({ home }) {
  const candidates = [
    path.join(home, ".config", "github-copilot", "apps.json"),
    path.join(home, ".config", "github-copilot", "hosts.json"),
  ];
  // Keys are either "github.com", "github.example.com" (enterprise), or a
  // composite like "github.com:Iv1.b507a08c87ecfe98". We always hit
  // api.github.com, so prefer the public-host token; only fall back to
  // whatever's there if no public-host entry exists.
  const found = [];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (_e) {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const token = typeof value.oauth_token === "string" ? value.oauth_token : "";
      if (!token) continue;
      const host = String(key).split(":")[0];
      found.push({
        token,
        credential_source: "legacy_plaintext",
        authority: host || null,
        updated_at: candidateTimestamp(value.updated_at),
        last_used_at: candidateTimestamp(value.last_used_at),
      });
    }
  }
  return dedupeCopilotCandidates(orderCopilotCandidates(found));
}

function readMacosKeychainGenericPassword({ service, account, securityRunner } = {}) {
  const runner = typeof securityRunner === "function" ? securityRunner : cp.spawnSync;
  if (runner === cp.spawnSync && !fs.existsSync(MACOS_SECURITY_BIN)) return null;
  const args = ["find-generic-password", "-s", service];
  if (account) args.push("-a", account);
  args.push("-w");
  const result = runner(MACOS_SECURITY_BIN, args, {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
    encoding: "utf8",
  });
  if (!result || result.error || result.status !== 0) return null;
  const stdout =
    typeof result.stdout === "string"
      ? result.stdout
      : Buffer.isBuffer(result.stdout)
        ? result.stdout.toString("utf8")
        : "";
  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function decryptCopilotAuthDbToken(keyBase64, ciphertextHex) {
  if (typeof keyBase64 !== "string" || typeof ciphertextHex !== "string") return null;
  let key;
  let blob;
  try {
    key = Buffer.from(keyBase64, "base64");
    blob = Buffer.from(ciphertextHex, "hex");
  } catch (_e) {
    return null;
  }
  if (key.length !== 32) return null; // AES-256 key
  if (blob.length < 12 + 16 + 1) return null; // iv(12) + authTag(16) + >=1 byte token
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(blob.length - 16);
  const data = blob.subarray(12, blob.length - 16);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    const token = out.toString("utf8").trim();
    return token.length > 0 ? token : null;
  } catch (_e) {
    return null;
  }
}

function readMacosCopilotAuthDbCandidates({ home, securityRunner, sqliteReader } = {}) {
  const resolvedHome = home || os.homedir();
  const reader = typeof sqliteReader === "function" ? sqliteReader : readSqliteJsonRows;
  let rows;
  try {
    rows = reader(copilotAuthDbPath(resolvedHome), COPILOT_AUTH_DB_SQL, { label: "GitHub Copilot" });
  } catch (_e) {
    return [];
  }
  if (!Array.isArray(rows) || rows.length === 0) return [];
  let keyBase64;
  try {
    keyBase64 = readMacosKeychainGenericPassword({
      service: COPILOT_LS_KEYCHAIN_SERVICE,
      account: COPILOT_LS_KEYCHAIN_ACCOUNT,
      securityRunner,
    });
  } catch (_e) {
    return [];
  }
  if (!keyBase64) return [];

  const found = [];
  for (const row of orderCopilotCandidates(rows.map((item) => ({
    ...item,
    authority: String(item?.auth_authority || "").split(":")[0] || null,
  })))) {
    const ciphertextHex = typeof row?.token_hex === "string" ? row.token_hex : null;
    if (!ciphertextHex) continue;
    const token = decryptCopilotAuthDbToken(keyBase64, ciphertextHex);
    if (!token) continue;
    found.push({
      token,
      credential_source: "secure_auth_db_macos",
      authority: row.authority,
      updated_at: candidateTimestamp(row.updated_at),
      last_used_at: candidateTimestamp(row.last_used_at),
    });
  }
  return dedupeCopilotCandidates(found);
}

function readCopilotCredentialCandidates({
  home = os.homedir(),
  platform = process.platform,
  securityRunner,
  sqliteReader,
} = {}) {
  // Windows Credential Manager target/blob semantics are not yet backed by a
  // fixed upstream fixture. If auth.db proves that the secure store is in use,
  // fail closed instead of guessing a target or sending a stale plaintext copy.
  if (platform === "win32" && fs.existsSync(copilotAuthDbPath(home))) {
    return { candidates: [], secure_store_status: "secure_store_unsupported" };
  }

  const secure = platform === "darwin"
    ? readMacosCopilotAuthDbCandidates({ home, securityRunner, sqliteReader })
    : [];
  const legacy = readPlaintextCopilotOauthCandidates({ home });
  return {
    candidates: dedupeCopilotCandidates([...secure, ...legacy]),
    secure_store_status: null,
  };
}

function candidateIdentity(candidate) {
  return `sha256:${crypto.createHash("sha256").update(candidate.token).digest("hex")}`;
}

function attachCopilotCredentialContext(entry, candidate) {
  if (!entry || !candidate) return entry;
  Object.defineProperty(entry, COPILOT_CREDENTIAL_IDENTITY, {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      identity: candidateIdentity(candidate),
      credential_source: candidate.credential_source,
      authority: candidate.authority,
      updated_at: candidate.updated_at,
      last_used_at: candidate.last_used_at,
    }),
  });
  return entry;
}

function getCopilotCredentialIdentity(entry) {
  const context = entry?.[COPILOT_CREDENTIAL_IDENTITY];
  const identity = typeof context === "string" ? context : context?.identity;
  return typeof identity === "string" && identity ? identity : null;
}

function describeCopilotCredentialStatus(options = {}) {
  const result = readCopilotCredentialCandidates(options);
  const selected = result.candidates[0] || null;
  if (result.secure_store_status === "secure_store_unsupported") {
    return {
      configured: true,
      status: "secure_store_unsupported",
      credential_source: null,
      authority: null,
    };
  }
  return {
    configured: Boolean(selected),
    status: selected ? "available" : "not_found",
    credential_source: selected?.credential_source || null,
    authority: selected?.authority || null,
  };
}

function copilotRequestHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/json",
    "Editor-Version": "vscode/1.96.2",
    "Editor-Plugin-Version": "copilot-chat/0.26.7",
    "User-Agent": "GitHubCopilotChat/0.26.7",
    "X-Github-Api-Version": "2025-04-01",
  };
}

function copilotResetIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  // Accept "YYYY-MM-DD" or full ISO timestamps
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const ts = Date.parse(dateOnly ? `${trimmed}T00:00:00Z` : trimmed);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function buildCopilotWindow(snapshot, resetIso) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const entitlement = Number(snapshot.entitlement);
  const remaining = Number(snapshot.remaining);
  const percentRemaining = Number(snapshot.percent_remaining);
  const allZero = (!entitlement || entitlement <= 0) && (!remaining || remaining <= 0) && (!percentRemaining || percentRemaining <= 0);
  if (allZero) return null;
  let usedPercent;
  if (Number.isFinite(percentRemaining)) {
    usedPercent = 100 - percentRemaining;
  } else if (Number.isFinite(entitlement) && entitlement > 0 && Number.isFinite(remaining)) {
    usedPercent = ((entitlement - remaining) / entitlement) * 100;
  } else {
    return null;
  }
  return buildWindow({ usedPercent, resetAt: resetIso });
}

function describeCopilotOtelStatus({ home, env = process.env } = {}) {
  const resolvedHome = home || env.HOME || os.homedir();
  const enabled = String(env.COPILOT_OTEL_ENABLED || "").toLowerCase() === "true";
  const exporterType = String(env.COPILOT_OTEL_EXPORTER_TYPE || "").toLowerCase();
  const explicitPath = typeof env.COPILOT_OTEL_FILE_EXPORTER_PATH === "string"
    ? env.COPILOT_OTEL_FILE_EXPORTER_PATH
    : "";
  const defaultDir = path.join(resolvedHome, ".copilot", "otel");
  let hasFiles = false;
  try {
    if (fs.existsSync(defaultDir)) {
      hasFiles = fs.readdirSync(defaultDir).some((entry) => entry.endsWith(".jsonl"));
    }
  } catch (_e) {}
  if (!hasFiles && explicitPath && fs.existsSync(explicitPath)) hasFiles = true;
  return {
    otel_enabled: enabled && (exporterType === "" || exporterType === "file"),
    otel_exporter_type: exporterType || null,
    otel_path: explicitPath || null,
    otel_default_dir: defaultDir,
    otel_has_files: hasFiles,
  };
}

async function fetchCopilotLimits({
  home,
  env = process.env,
  fetchImpl = fetch,
  platform = process.platform,
  securityRunner,
  sqliteReader,
} = {}) {
  const otel = describeCopilotOtelStatus({ home, env });
  const credentialResult = readCopilotCredentialCandidates({
    home: home || (env.HOME || os.homedir()),
    platform,
    securityRunner,
    sqliteReader,
  });
  if (credentialResult.secure_store_status === "secure_store_unsupported") {
    return {
      configured: true,
      error: "secure_store_unsupported",
      error_code: "secure_store_unsupported",
      ...otel,
    };
  }
  if (credentialResult.candidates.length === 0) return { configured: false, ...otel };

  for (let index = 0; index < credentialResult.candidates.length; index += 1) {
    const candidate = credentialResult.candidates[index];
    let res;
    try {
      res = await fetchImpl("https://api.github.com/copilot_internal/user", {
        method: "GET",
        headers: copilotRequestHeaders(candidate.token),
      });
    } catch (_error) {
      return attachCopilotCredentialContext({
        configured: true,
        error: "GitHub Copilot request failed.",
        error_code: "network_error",
        ...otel,
      }, candidate);
    }

    if (res.status === 401 || res.status === 403) {
      if (index + 1 < credentialResult.candidates.length) continue;
      return attachCopilotCredentialContext({
        configured: true,
        error: "GitHub Copilot credential rejected. Re-authenticate via GitHub Copilot CLI/extension.",
        error_code: "auth_error",
        ...otel,
      }, candidate);
    }
    if (!res.ok) {
      return attachCopilotCredentialContext({
        configured: true,
        error: `GitHub Copilot API error: HTTP ${res.status}`,
        error_code: "upstream_error",
        ...otel,
      }, candidate);
    }

    let json;
    try {
      json = await res.json();
    } catch (_error) {
      return attachCopilotCredentialContext({
        configured: true,
        error: "GitHub Copilot response could not be parsed.",
        error_code: "response_error",
        ...otel,
      }, candidate);
    }
    const planName = typeof json?.copilot_plan === "string" && json.copilot_plan
      ? json.copilot_plan.charAt(0).toUpperCase() + json.copilot_plan.slice(1)
      : null;
    const resetIso = copilotResetIso(json?.quota_reset_date);
    const snapshots = json?.quota_snapshots || {};
    const premiumWindow = buildCopilotWindow(snapshots.premium_interactions, resetIso);
    const chatWindow = buildCopilotWindow(snapshots.chat, resetIso);

    return attachCopilotCredentialContext({
      configured: true,
      error: null,
      plan_name: planName,
      primary_window: premiumWindow,
      secondary_window: chatWindow,
      ...otel,
    }, candidate);
  }

  return { configured: false, ...otel };
}

async function fetchKiroLimits({ commandRunner, now = new Date() } = {}) {
  if (!(await isBinaryAvailable("kiro-cli", { commandRunner }))) {
    return { configured: false };
  }

  const result = await runCommand(
    commandRunner,
    "kiro-cli",
    ["chat", "--no-interactive", "/usage"],
    {
      timeout: 20_000,
      env: { ...process.env, TERM: "xterm-256color" },
    },
  );

  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const output = stderr.trim() || stdout.trim();

  try {
    if (result?.error?.code === "ETIMEDOUT" && !isKiroUsageOutputComplete(output)) {
      throw new Error("Kiro CLI timed out.");
    }
    if (!output && result?.status !== 0) {
      throw new Error(`Kiro CLI failed with status ${result.status}.`);
    }

    return {
      configured: true,
      error: null,
      ...parseKiroUsageOutput(output, { now }),
    };
  } catch (error) {
    return {
      configured: true,
      error: error?.message || "Unknown error",
    };
  }
}

function parseProcessLine(line) {
  const match = String(line || "")
    .trim()
    .match(/^(\d+)\s+(.*)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    command: match[2],
  };
}

function isAntigravityCommandLine(command) {
  const lower = String(command || "").toLowerCase();
  return lower.includes("language_server")
    && (
      (lower.includes("--app_data_dir") && lower.includes("antigravity"))
      || lower.includes("/antigravity/")
      || lower.includes("\\antigravity\\")
      || lower.includes("--override_ide_name antigravity")
    );
}

function extractCommandFlag(command, flag) {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(command || "").match(new RegExp(`${escaped}[=\\s]+([^\\s]+)`, "i"));
  return match?.[1] || null;
}

async function detectAntigravityProcess({ commandRunner } = {}) {
  const result = await runCommand(commandRunner, "/bin/ps", ["-ax", "-o", "pid=,command="], {
    timeout: 4000,
  });
  const lines = String(result?.stdout || "").split("\n");

  let sawProcess = false;
  for (const line of lines) {
    const parsed = parseProcessLine(line);
    if (!parsed) continue;
    if (!isAntigravityCommandLine(parsed.command)) continue;
    sawProcess = true;
    const csrfToken = extractCommandFlag(parsed.command, "--csrf_token");
    if (!csrfToken) continue;
    const extensionPort = extractFirstNumber(extractCommandFlag(parsed.command, "--extension_server_port"));
    return {
      configured: true,
      pid: parsed.pid,
      csrfToken,
      extensionPort: Number.isFinite(extensionPort) ? extensionPort : null,
    };
  }

  if (sawProcess) {
    return { configured: true, error: "Antigravity CSRF token not found. Restart Antigravity and retry." };
  }
  return { configured: false };
}

function resolveAntigravityLimitsCachePath({ home } = {}) {
  return path.join(home || os.homedir(), ".tokentracker", "tracker", ANTIGRAVITY_LIMITS_CACHE_FILE);
}

function parseTimeMs(value) {
  if (typeof value !== "string" || !value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function isCacheWindowUsable(window, { cachedAtMs, nowMs } = {}) {
  if (!window || typeof window !== "object") return false;
  const resetAtMs = parseTimeMs(window.reset_at);
  if (resetAtMs !== null) return resetAtMs > nowMs;
  return Number.isFinite(cachedAtMs)
    && nowMs - cachedAtMs <= ANTIGRAVITY_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS;
}

function hasAntigravityWindow(limits) {
  return Boolean(limits?.primary_window || limits?.secondary_window || limits?.tertiary_window);
}

function normalizeAntigravityCachedLimits(raw, { nowMs = Date.now() } = {}) {
  const cachedAtMs = parseTimeMs(raw?.cached_at);
  if (!Number.isFinite(cachedAtMs)) return null;
  if (cachedAtMs > nowMs + 60_000) return null;
  if (nowMs - cachedAtMs > ANTIGRAVITY_LIMITS_CACHE_MAX_AGE_MS) return null;

  const cached = {
    configured: true,
    error: null,
    account_email: typeof raw?.account_email === "string" ? raw.account_email : null,
    account_plan: typeof raw?.account_plan === "string" ? raw.account_plan : null,
    primary_window: isCacheWindowUsable(raw?.primary_window, { cachedAtMs, nowMs }) ? raw.primary_window : null,
    secondary_window: isCacheWindowUsable(raw?.secondary_window, { cachedAtMs, nowMs }) ? raw.secondary_window : null,
    tertiary_window: isCacheWindowUsable(raw?.tertiary_window, { cachedAtMs, nowMs }) ? raw.tertiary_window : null,
    cached: true,
    cached_at: raw.cached_at,
  };
  return hasAntigravityWindow(cached) ? cached : null;
}

function readAntigravityLimitsCache({ home, nowMs = Date.now() } = {}) {
  const cachePath = resolveAntigravityLimitsCachePath({ home });
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return normalizeAntigravityCachedLimits(parsed?.antigravity, { nowMs });
  } catch (_error) {
    return null;
  }
}

function writeAntigravityLimitsCache(limits, { home, nowMs = Date.now() } = {}) {
  if (!limits?.configured || limits.error || !hasAntigravityWindow(limits)) return;
  const cachePath = resolveAntigravityLimitsCachePath({ home });
  const payload = {
    antigravity: {
      account_email: limits.account_email || null,
      account_plan: limits.account_plan || null,
      primary_window: limits.primary_window || null,
      secondary_window: limits.secondary_window || null,
      tertiary_window: limits.tertiary_window || null,
      cached_at: new Date(nowMs).toISOString(),
    },
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function resolveClaudeLimitsCachePath({ home } = {}) {
  return path.join(home || os.homedir(), ".tokentracker", "tracker", CLAUDE_LIMITS_CACHE_FILE);
}

// Claude windows carry their own `resets_at`; a window whose reset has already passed is
// stale data, not a usable fallback, so drop it. Windows without a reset stamp are kept
// (the overall cached_at max-age gate already bounds them).
function isClaudeCacheWindowUsable(window, { nowMs } = {}) {
  if (!window || typeof window !== "object") return false;
  const resetAtMs = parseTimeMs(window.resets_at);
  if (resetAtMs === null) return true;
  return resetAtMs > nowMs;
}

function hasClaudeWindow(limits) {
  return Boolean(limits?.five_hour || limits?.seven_day || limits?.seven_day_opus);
}

function normalizeClaudeCachedLimits(
  raw,
  {
    nowMs = Date.now(),
    maxAgeMs = CLAUDE_LIMITS_CACHE_MAX_AGE_MS,
    stale = true,
  } = {},
) {
  const cachedAtMs = parseTimeMs(raw?.cached_at);
  if (!Number.isFinite(cachedAtMs)) return null;
  if (cachedAtMs > nowMs + 60_000) return null;
  if (nowMs - cachedAtMs > maxAgeMs) return null;

  const cached = {
    configured: true,
    error: null,
    five_hour: isClaudeCacheWindowUsable(raw?.five_hour, { nowMs }) ? raw.five_hour : null,
    seven_day: isClaudeCacheWindowUsable(raw?.seven_day, { nowMs }) ? raw.seven_day : null,
    seven_day_opus: isClaudeCacheWindowUsable(raw?.seven_day_opus, { nowMs }) ? raw.seven_day_opus : null,
    extra_usage: raw?.extra_usage ?? null,
    stale,
    cached_at: raw.cached_at,
  };
  return hasClaudeWindow(cached) ? cached : null;
}

function readClaudeLimitsCache({
  home,
  nowMs = Date.now(),
  maxAgeMs = CLAUDE_LIMITS_CACHE_MAX_AGE_MS,
  stale = true,
} = {}) {
  const cachePath = resolveClaudeLimitsCachePath({ home });
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return normalizeClaudeCachedLimits(parsed?.claude, { nowMs, maxAgeMs, stale });
  } catch (_error) {
    return null;
  }
}

function readFreshClaudeLimitsCache({ home, nowMs = Date.now() } = {}) {
  return readClaudeLimitsCache({
    home,
    nowMs,
    maxAgeMs: CLAUDE_LIMITS_CACHE_FRESH_TTL_MS,
    stale: false,
  });
}

function writeClaudeLimitsCache(limits, { home, nowMs = Date.now() } = {}) {
  if (!limits?.configured || limits.error || !hasClaudeWindow(limits)) return;
  const cachePath = resolveClaudeLimitsCachePath({ home });
  const payload = {
    claude: {
      five_hour: limits.five_hour || null,
      seven_day: limits.seven_day || null,
      seven_day_opus: limits.seven_day_opus || null,
      extra_usage: limits.extra_usage || null,
      cached_at: new Date(nowMs).toISOString(),
    },
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function resolveClaudeRateLimitPath({ home } = {}) {
  return path.join(home || os.homedir(), ".tokentracker", "tracker", CLAUDE_RATE_LIMIT_FILE);
}

// Returns the cooldown expiry in ms if a 429 cooldown is still active, else null.
function readClaudeRateLimitRetryAtMs({ home, nowMs = Date.now() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveClaudeRateLimitPath({ home }), "utf8"));
    const retryAtMs = parseTimeMs(parsed?.retry_at);
    if (retryAtMs !== null && retryAtMs > nowMs) return retryAtMs;
  } catch (_error) {}
  return null;
}

function writeClaudeRateLimitCooldown(retryAfterSec, { home, nowMs = Date.now() } = {}) {
  const sec = Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? Math.min(retryAfterSec, CLAUDE_RATE_LIMIT_MAX_COOLDOWN_SEC)
    : CLAUDE_RATE_LIMIT_DEFAULT_COOLDOWN_SEC;
  const cachePath = resolveClaudeRateLimitPath({ home });
  const payload = { retry_at: new Date(nowMs + sec * 1000).toISOString() };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function clearClaudeRateLimitCooldown({ home } = {}) {
  try {
    fs.unlinkSync(resolveClaudeRateLimitPath({ home }));
  } catch (_error) {}
}

async function resolveLsofBinary({ commandRunner } = {}) {
  for (const candidate of ["/usr/sbin/lsof", "/usr/bin/lsof"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return whichBinary("lsof", { commandRunner });
}

function parseListeningPorts(output) {
  const matches = String(output || "").matchAll(/:(\d+)\s+\(LISTEN\)/g);
  const ports = new Set();
  for (const match of matches) {
    const port = Number(match[1]);
    if (Number.isFinite(port)) {
      ports.add(port);
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
}

async function listAntigravityPorts(pid, { commandRunner } = {}) {
  const lsof = await resolveLsofBinary({ commandRunner });
  if (!lsof) {
    throw new Error("Antigravity port detection needs lsof. Install it, then retry.");
  }
  const result = await runCommand(
    commandRunner,
    lsof,
    ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", String(pid)],
    { timeout: 4000 },
  );
  const ports = parseListeningPorts(result?.stdout);
  if (!ports.length) {
    throw new Error("Antigravity is running but not exposing ports yet. Try again in a few seconds.");
  }
  return ports;
}

function antigravityDefaultBody() {
  return {
    metadata: {
      ideName: "antigravity",
      extensionName: "antigravity",
      ideVersion: "unknown",
      locale: "en",
    },
  };
}

function antigravityUnleashBody() {
  return {
    context: {
      properties: {
        devMode: "false",
        extensionVersion: "unknown",
        hasAnthropicModelAccess: "true",
        ide: "antigravity",
        ideVersion: "unknown",
        installationId: "tokentracker",
        language: "UNSPECIFIED",
        os: "macos",
        requestedModelId: "MODEL_UNSPECIFIED",
      },
    },
  };
}

function requestLocalJson({
  scheme,
  port,
  path,
  body,
  csrfToken,
  timeoutMs = 8000,
  requestFn,
}) {
  if (typeof requestFn === "function") {
    return requestFn({ scheme, port, path, body, csrfToken, timeoutMs });
  }

  const client = scheme === "https" ? https : http;
  return new Promise((resolve, reject) => {
    const rawBody = JSON.stringify(body);
    const req = client.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(rawBody),
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": csrfToken,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${error.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.write(rawBody);
    req.end();
  });
}

function antigravityCodeIsOk(code) {
  if (code === null || code === undefined) return true;
  if (typeof code === "number") return code === 0;
  if (typeof code === "string") {
    const lower = code.toLowerCase();
    return lower === "ok" || lower === "success" || lower === "0";
  }
  return false;
}

function parseAntigravityDate(value) {
  if (typeof value === "string" && value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric * 1000).toISOString();
    }
    if (Number.isFinite(numeric)) return null;
    const iso = Date.parse(value);
    if (Number.isFinite(iso) && iso > 0) return new Date(iso).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString();
  }
  return null;
}

function parseAntigravityModelConfigs(configs) {
  if (!Array.isArray(configs)) return [];
  return configs
    .map((config) => {
      const quota = config?.quotaInfo || null;
      if (!quota) return null;
      return {
        label: typeof config?.label === "string" ? config.label : "",
        model_id: typeof config?.modelOrAlias?.model === "string" ? config.modelOrAlias.model : "",
        remaining_fraction:
          typeof quota?.remainingFraction === "number" && Number.isFinite(quota.remainingFraction)
            ? quota.remainingFraction
            : null,
        reset_at: parseAntigravityDate(quota?.resetTime),
      };
    })
    .filter(Boolean);
}

function antigravityFamily(model) {
  const text = `${model?.label || ""} ${model?.model_id || ""}`.toLowerCase();
  if (text.includes("claude")) return "claude";
  if (text.includes("gemini") && text.includes("pro")) return "gemini_pro";
  if (text.includes("gemini") && text.includes("flash")) return "gemini_flash";
  return "unknown";
}

function antigravityPriority(model) {
  const text = `${model?.label || ""} ${model?.model_id || ""}`.toLowerCase();
  if (text.includes("lite") || text.includes("autocomplete") || text.includes("tab_")) return null;
  if (antigravityFamily(model) === "gemini_pro") {
    return text.includes("pro-low") || (text.includes("pro") && text.includes("low")) ? 0 : 1;
  }
  return 0;
}

function chooseAntigravityModel(models, family) {
  const candidates = models
    .filter((model) => antigravityFamily(model) === family)
    .map((model) => ({
      model,
      priority: antigravityPriority(model),
      remaining:
        typeof model.remaining_fraction === "number"
          ? model.remaining_fraction
          : Number.POSITIVE_INFINITY,
    }))
    .filter((entry) => entry.priority !== null);

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.remaining - b.remaining;
  });
  return candidates[0].model;
}

function makeAntigravityWindow(model) {
  if (!model) return null;
  const remaining = typeof model.remaining_fraction === "number" ? model.remaining_fraction * 100 : 0;
  return buildWindow({
    usedPercent: 100 - remaining,
    resetAt: model.reset_at,
  });
}

function normalizeAntigravityResponse(body, { fallbackToConfigs = false } = {}) {
  if (!antigravityCodeIsOk(body?.code)) {
    throw new Error(`Antigravity API error: ${body?.code}`);
  }

  const userStatus = body?.userStatus || null;
  const configs = fallbackToConfigs
    ? body?.clientModelConfigs
    : userStatus?.cascadeModelConfigData?.clientModelConfigs;
  const models = parseAntigravityModelConfigs(configs);
  if (!models.length) {
    throw new Error("Could not parse Antigravity quota: no quota models available.");
  }

  const primary = chooseAntigravityModel(models, "claude");
  const secondary = chooseAntigravityModel(models, "gemini_pro");
  const tertiary = chooseAntigravityModel(models, "gemini_flash");
  const fallback = !primary && !secondary && !tertiary
    ? [...models].sort((a, b) => {
        const aRemaining = typeof a.remaining_fraction === "number" ? a.remaining_fraction : Number.POSITIVE_INFINITY;
        const bRemaining = typeof b.remaining_fraction === "number" ? b.remaining_fraction : Number.POSITIVE_INFINITY;
        return aRemaining - bRemaining;
      })[0]
    : null;

  return {
    account_email: typeof userStatus?.email === "string" ? userStatus.email : null,
    account_plan:
      userStatus?.planStatus?.planInfo?.planDisplayName
      || userStatus?.planStatus?.planInfo?.displayName
      || userStatus?.planStatus?.planInfo?.productName
      || userStatus?.planStatus?.planInfo?.planName
      || userStatus?.planStatus?.planInfo?.planShortName
      || null,
    primary_window: makeAntigravityWindow(primary || fallback),
    secondary_window: makeAntigravityWindow(secondary),
    tertiary_window: makeAntigravityWindow(tertiary),
  };
}

async function probeAntigravityPort(port, csrfToken, { timeoutMs, requestFn } = {}) {
  try {
    await requestLocalJson({
      scheme: "https",
      port,
      path: "/exa.language_server_pb.LanguageServerService/GetUnleashData",
      body: antigravityUnleashBody(),
      csrfToken,
      timeoutMs,
      requestFn,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function fetchAntigravityLimits({ home, commandRunner, requestFn, timeoutMs = 8000, nowMs = Date.now() } = {}) {
  const processInfo = await detectAntigravityProcess({ commandRunner });
  if (!processInfo.configured) {
    return readAntigravityLimitsCache({ home, nowMs }) || { configured: false };
  }
  if (processInfo.error) {
    return { configured: true, error: processInfo.error };
  }

  const finalize = (payload, normalizeOptions) => {
    const result = {
      configured: true,
      error: null,
      ...normalizeAntigravityResponse(payload, normalizeOptions),
    };
    writeAntigravityLimitsCache(result, { home, nowMs });
    return result;
  };

  try {
    const ports = await listAntigravityPorts(processInfo.pid, { commandRunner });
    let workingPort = null;
    for (const port of ports) {
      if (await probeAntigravityPort(port, processInfo.csrfToken, { timeoutMs, requestFn })) {
        workingPort = port;
        break;
      }
    }
    if (!workingPort) {
      throw new Error("Antigravity port detection failed: no working API port found");
    }

    try {
      const userStatus = await requestLocalJson({
        scheme: "https",
        port: workingPort,
        path: "/exa.language_server_pb.LanguageServerService/GetUserStatus",
        body: antigravityDefaultBody(),
        csrfToken: processInfo.csrfToken,
        timeoutMs,
        requestFn,
      });
      return finalize(userStatus);
    } catch (primaryError) {
      const fallbackPort =
        Number.isFinite(processInfo.extensionPort) && processInfo.extensionPort > 0
          ? processInfo.extensionPort
          : workingPort;
      const modelConfigs = await requestLocalJson({
        scheme: fallbackPort === workingPort ? "https" : "http",
        port: fallbackPort,
        path: "/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs",
        body: antigravityDefaultBody(),
        csrfToken: processInfo.csrfToken,
        timeoutMs,
        requestFn,
      });
      return finalize(modelConfigs, { fallbackToConfigs: true });
    }
  } catch (error) {
    const cached = readAntigravityLimitsCache({ home, nowMs });
    if (cached) return cached;
    const message = error?.message === "timeout"
      ? "Antigravity quota request timed out."
      : error?.message || "Unknown error";
    return {
      configured: true,
      error: message,
    };
  }
}

function toTitleCase(s) {
  return s.split(/\s+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// Normalize a plan tier name: free/empty/placeholder -> null; otherwise strip the
// leading brand word and Title Case the rest.
function normalizePlanLabel(raw, brand) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (["free", "none", "unknown"].includes(lower)) return null;
  if (brand && lower === brand.toLowerCase()) return null; // e.g. Kiro defaults plan_name to "Kiro" when parse fails
  if (brand) {
    s = s.replace(new RegExp("^" + brand + "\\s+", "i"), "").trim();
    if (!s) return null;
  }
  return toTitleCase(s);
}

// Attach plan_label only to a configured, error-free provider object (immutable).
function withPlanLabel(obj, raw, brand) {
  if (!obj || !obj.configured || obj.error) return obj;
  return { ...obj, plan_label: normalizePlanLabel(raw, brand) };
}

// Single-flight guard: concurrent cache misses share one upstream fetch instead of
// each triggering the full 9-provider round (Claude's OAuth usage endpoint 429s when
// hammered). Survives an external resetUsageLimitsCache() (refresh=1 path in
// local-api.js): a refresh arriving while a fetch is already running reuses that
// in-flight fetch and returns its result.
let inFlightFetch = null;

async function getUsageLimits(options = {}) {
  const nowMs = Date.now();
  if (cache.data && nowMs - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  if (inFlightFetch) {
    return inFlightFetch;
  }
  const promise = fetchUsageLimitsUncached(options).finally(() => {
    if (inFlightFetch === promise) inFlightFetch = null;
  });
  inFlightFetch = promise;
  return promise;
}

async function fetchUsageLimitsUncached({
  home,
  env,
  platform,
  securityRunner,
  fetchImpl = fetch,
  commandRunner,
  requestFn,
  credentialFileOptions,
  now = new Date(),
  providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
} = {}) {
  const nowMs = Date.now();

  const [claudeToken, claudeSubscription, codexAuth] = await Promise.all([
    Promise.resolve().then(() => readClaudeCodeAccessToken({ platform, securityRunner, home })),
    Promise.resolve().then(() => detectClaudeCodeSubscriptionDetails({ platform, securityRunner, home })),
    readCodexAuthBundle({ home, env, platform }),
  ]);
  const claudePlanType = claudeSubscription?.planType || null;

  // Proactively refresh Codex tokens that are >8 days stale, mirroring CodexBar's
  // CodexTokenRefresher.swift. Without this, users who logged in once and didn't run
  // `codex` for >a week get wham 401 → "Fetch failed" (issue #52). Best-effort: any
  // refresh failure falls through to using the existing (possibly stale) token, then the
  // 4xx graceful path in fetchCodexUsageLimits surfaces a neutral state instead of red.
  const {
    auth: codexAuthRefreshed,
    refreshError,
  } = await refreshCodexAuthBundle(codexAuth, { fetchImpl });

  const codexToken = codexAuthRefreshed?.accessToken || null;
  const codexAccountId = codexAuthRefreshed?.accountId || null;
  const codexPlanType = codexAuthRefreshed?.planType || null;

  // Skip the upstream Claude call entirely while a 429 cooldown is active — calling again
  // just renews the penalty. The result handling below serves cache or a cooldown message.
  const claudeRetryAtMs = claudeToken ? readClaudeRateLimitRetryAtMs({ home, nowMs }) : null;
  // Also avoid cross-process hammering after a recent successful read. The macOS app can
  // restart its embedded Node server or force-refresh the limits page, both of which clear
  // the in-memory cache; the disk cache keeps those paths from immediately spending
  // another Claude OAuth usage request.
  const freshClaudeCache = claudeToken ? readFreshClaudeLimitsCache({ home, nowMs }) : null;

  const providerFetch = withFetchTimeout(fetchImpl, providerTimeoutMs);
  const [claudeResult, codexResult, cursor, kimi, gemini, kiro, antigravity, copilot, grok, zed] = await Promise.all([
    claudeToken && !freshClaudeCache && !claudeRetryAtMs
      ? withProviderTimeout(fetchClaudeUsageLimits(claudeToken, { fetchImpl: providerFetch, maxAttempts: 1 }), "Claude", providerTimeoutMs).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason }),
        )
      : Promise.resolve(null),
    codexToken
      ? withProviderTimeout(
          fetchCodexUsageLimits(codexToken, { fetchImpl: providerFetch, accountId: codexAccountId }),
          "Codex",
          providerTimeoutMs,
        ).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason }),
        )
      : Promise.resolve(null),
    withProviderTimeout(fetchCursorLimits({ home, fetchImpl: providerFetch }), "Cursor", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
    withProviderTimeout(fetchKimiLimits({ home, env, fetchImpl: providerFetch, credentialFileOptions }), "Kimi", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
    withProviderTimeout(fetchGeminiLimits({
      home,
      env,
      fetchImpl: providerFetch,
      commandRunner,
      credentialFileOptions,
    }), "Gemini", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
    fetchKiroLimits({ commandRunner, now }),
    fetchAntigravityLimits({ home, commandRunner, requestFn, nowMs }),
    withProviderTimeout(fetchCopilotLimits({ home, env, fetchImpl: providerFetch, platform, securityRunner }), "GitHub Copilot", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
    withProviderTimeout(fetchGrokLimits({ home, env, fetchImpl: providerFetch }), "Grok Build", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
    withProviderTimeout(fetchZedLimits({ platform, env, fetchImpl: providerFetch, securityRunner, commandRunner }), "Zed", providerTimeoutMs)
      .catch((reason) => ({ configured: true, error: reason?.message || "Unknown error" })),
  ]);

  let claude;
  if (!claudeToken) {
    claude = { configured: false };
  } else if (freshClaudeCache) {
    claude = freshClaudeCache;
  } else if (claudeResult && claudeResult.status === "fulfilled") {
    claude = {
      configured: true,
      error: null,
      five_hour: claudeResult.value.five_hour,
      seven_day: claudeResult.value.seven_day,
      seven_day_opus: claudeResult.value.seven_day_opus,
      extra_usage: claudeResult.value.extra_usage,
    };
    writeClaudeLimitsCache(claude, { home, nowMs });
    clearClaudeRateLimitCooldown({ home });
  } else {
    // Either a fresh 429 (record its cooldown) or a call we skipped because a cooldown was
    // already active. Serve the last successful read so the bars stay visible; otherwise
    // surface an accurate "retry in ~Nm" message rather than the misleading hardcoded one.
    const reason = claudeResult?.reason;
    if (reason?.code === "RATE_LIMITED") {
      writeClaudeRateLimitCooldown(reason.retryAfterSec, { home, nowMs });
    }
    const cached = readClaudeLimitsCache({ home, nowMs });
    if (cached) {
      claude = cached;
    } else {
      const retryAtMs = readClaudeRateLimitRetryAtMs({ home, nowMs }) || claudeRetryAtMs;
      claude = {
        configured: true,
        error: retryAtMs
          ? formatClaudeRateLimitMessage(Math.round((retryAtMs - nowMs) / 1000))
          : reason?.message || "Unknown error",
      };
    }
  }

  let codex;
  if (!codexToken) {
    codex = { configured: false };
  } else if (refreshError && refreshError.code === "REFRESH_TOKEN_EXPIRED") {
    // Refresh token is dead — the user must re-run `codex` to log in again. Surface a
    // specific, actionable message rather than the generic "Fetch failed".
    codex = {
      configured: true,
      error: refreshError.message,
      auth_action_required: "reauth",
    };
  } else if (!codexResult || codexResult.status === "rejected") {
    codex = {
      configured: true,
      ...codexUsageMapper.codexUsageErrorState(codexResult?.reason),
    };
  } else {
    codex = {
      configured: true,
      error: null,
      plan_type: codexPlanType || null,
      primary_window: codexResult.value.primary_window,
      secondary_window: codexResult.value.secondary_window,
      spark_primary_window: codexResult.value.spark_primary_window,
      spark_secondary_window: codexResult.value.spark_secondary_window,
    };
  }

  const data = {
    fetched_at: new Date(nowMs).toISOString(),
    claude: withPlanLabel(claude, claudePlanType, "Claude"),
    codex: withPlanLabel(codex, codex.plan_type, "Codex"),
    cursor: withPlanLabel(cursor, cursor.membership_type, "Cursor"),
    // Kimi's subType (TYPE_PURCHASE/TYPE_EVENT) is the credit *source*, not a plan
    // tier, and membership.level is an opaque enum (LEVEL_INTERMEDIATE) with no
    // authoritative human-readable plan mapping. Both rendered as garbage like
    // "Kimi Type_event" (issue #130), so show the bare brand instead.
    kimi: withPlanLabel(kimi, null, "Kimi"),
    gemini: withPlanLabel(gemini, gemini.account_plan, "Gemini"),
    kiro: withPlanLabel(kiro, kiro.plan_name, "Kiro"),
    antigravity: withPlanLabel(antigravity, antigravity.account_plan, "Antigravity"),
    copilot: withPlanLabel(copilot, copilot.plan_name, "Copilot"),
    grok: withPlanLabel(grok, null, "Grok"),
    zed: withPlanLabel(zed, zed.plan_name, "Zed"),
  };

  const evidencedData = decorateUsageLimitsWithEvidence(data, { nowMs });
  cache = { data: evidencedData, fetchedAt: nowMs };
  return evidencedData;
}

function resetUsageLimitsCache() {
  cache = { data: null, fetchedAt: 0 };
}

module.exports = {
  CODEX_RESET_CREDIT_ALLOWLIST: codexUsageMapper.CODEX_RESET_CREDIT_ALLOWLIST,
  getCodexUsageLimits,
  getUsageLimits,
  normalizePlanLabel,
  resetUsageLimitsCache,
  runCommand,
  extractGeminiOauthClientCredentials,
  loadKimiCredentials,
  normalizeCursorUsageSummary,
  normalizeGeminiQuotaResponse,
  normalizeKimiUsageResponse,
  parseKiroUsageOutput,
  parseCodexResetCreditFields: codexUsageMapper.parseCodexResetCreditFields,
  normalizeAntigravityResponse,
  parseListeningPorts,
  detectAntigravityProcess,
  fetchAntigravityLimits,
  fetchCopilotLimits,
  describeCopilotCredentialStatus,
  getCopilotCredentialIdentity,
  decryptCopilotAuthDbToken,
  describeCopilotOtelStatus,
  fetchGrokLimits,
  fetchZedLimits,
};
