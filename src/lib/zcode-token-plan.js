"use strict";

/**
 * ZCode (Zhipu / Z.ai / BigModel) token-plan adapter.
 *
 * ZCode is a local CLI whose OAuth credentials live in
 *   ~/.zcode/v2/credentials.json
 * Values that hold secrets are stored AES-256-GCM encrypted with the on-disk
 * envelope prefix `enc:v1:{nonce}.{tag}.{ciphertext}` (each part base64url,
 * no padding). The symmetric key is SHA-256 of a secret string that is either
 * the `ZCODE_CREDENTIAL_SECRET` env var or a host/user-bound fallback string.
 *
 * We read the `zcode_jwt_token` value (decrypting when needed) and call the
 * official balance endpoint. No secret is ever persisted by Token Eyes — the
 * JWT is read from disk on each refresh and used only for the balance call.
 *
 * Verification note: the exact fallback-secret derivation and the on-disk
 * platform token cannot be confirmed here without a real ZCode install, so the
 * decryption path is defensive (plaintext token and `TOKENTRACKER_ZCODE_JWT`
 * escape hatches are honoured first) and every failure maps to an actionable
 * reauth/console error rather than a crash. The crypto itself is proven by a
 * round-trip unit test; the balance HTTP + response parsing is the primary
 * tested path.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ZCODE_BALANCE_URL = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
const ZCODE_APP_VERSION = "3.3.4";
const ENC_PREFIX = "enc:v1:";
const MAX_RESPONSE_BYTES = 1024 * 1024;

class ZcodeTokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ZcodeTokenPlanError";
    this.code = code;
  }
}

function mapZcodeErrorCode(error) {
  if (!(error instanceof ZcodeTokenPlanError)) return "failed";
  switch (error.code) {
    case "ZCODE_NOT_INSTALLED":
    case "ZCODE_TOKEN_MISSING":
      return "not_configured";
    case "ZCODE_REAUTH_REQUIRED":
    case "ZCODE_DECRYPT_FAILED":
      return "reauth_required";
    case "ZCODE_RESPONSE_STRUCTURE_DRIFT":
    case "ZCODE_NO_BALANCE":
      return "unsupported";
    default:
      return "failed";
  }
}

function resolveZcodeHome({ home, env = process.env } = {}) {
  const override = typeof env.TOKENTRACKER_ZCODE_HOME === "string" ? env.TOKENTRACKER_ZCODE_HOME.trim() : "";
  if (override) return path.resolve(override);
  return path.join(home || os.homedir(), ".zcode");
}

function zcodeCredentialsPath({ home, env } = {}) {
  return path.join(resolveZcodeHome({ home, env }), "v2", "credentials.json");
}

/**
 * Derive the AES-256 key ZCode uses for `enc:v1:` values.
 *
 * secret = ZCODE_CREDENTIAL_SECRET || `zcode-credential-fallback:{platform}:{home}:{username}`
 * key    = SHA-256(secret)  (raw 32 bytes)
 *
 * platform/home/username are injectable so tests are deterministic and so the
 * fallback token can be corrected once confirmed against a real install.
 */
function deriveZcodeKey({ env = process.env, platform, home, username } = {}) {
  const explicit = typeof env.ZCODE_CREDENTIAL_SECRET === "string" ? env.ZCODE_CREDENTIAL_SECRET : "";
  let secret = explicit;
  if (!secret) {
    const plat = platform || process.platform;
    const homeDir = home || os.homedir();
    const user = username
      || env.USER
      || env.USERNAME
      || (typeof os.userInfo === "function" ? safeUserInfoName() : "")
      || "";
    secret = `zcode-credential-fallback:${plat}:${homeDir}:${user}`;
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function safeUserInfoName() {
  try {
    return os.userInfo().username || "";
  } catch {
    return "";
  }
}

function b64urlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function bufferToB64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isEncryptedValue(value) {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a plaintext into the `enc:v1:` envelope. Used by tests to prove the
 * decrypt path round-trips; also handy for fixtures.
 */
function encryptZcodeValue(plaintext, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${bufferToB64url(nonce)}.${bufferToB64url(tag)}.${bufferToB64url(ciphertext)}`;
}

function decryptZcodeValue(value, key) {
  if (!isEncryptedValue(value)) return String(value ?? "");
  const body = value.slice(ENC_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) {
    throw new ZcodeTokenPlanError("ZCODE_DECRYPT_FAILED", "ZCode 凭据密文格式无法识别");
  }
  try {
    const nonce = b64urlToBuffer(parts[0]);
    const tag = b64urlToBuffer(parts[1]);
    const ciphertext = b64urlToBuffer(parts[2]);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    if (error instanceof ZcodeTokenPlanError) throw error;
    throw new ZcodeTokenPlanError("ZCODE_DECRYPT_FAILED", "无法解密 ZCode 本地凭据（密钥可能与本机不匹配）");
  }
}

function isZcodeInstalled({ home, env } = {}) {
  try {
    return fs.existsSync(zcodeCredentialsPath({ home, env }));
  } catch {
    return false;
  }
}

/**
 * Read the ZCode JWT used for the billing/balance call.
 *
 * Resolution order:
 *   1. TOKENTRACKER_ZCODE_JWT env override (plaintext).
 *   2. `zcode_jwt_token` from credentials.json (plaintext or `enc:v1:`).
 * The JWT is returned but never written back to disk by Token Eyes.
 */
function readZcodeJwt({ home, env = process.env, platform, username } = {}) {
  const override = typeof env.TOKENTRACKER_ZCODE_JWT === "string" ? env.TOKENTRACKER_ZCODE_JWT.trim() : "";
  if (override) return override;

  const credentialsPath = zcodeCredentialsPath({ home, env });
  let raw;
  try {
    raw = fs.readFileSync(credentialsPath, "utf8");
  } catch {
    throw new ZcodeTokenPlanError("ZCODE_NOT_INSTALLED", "未找到 ZCode 本地凭据，请先在 ZCode 中登录");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 凭据文件异常过大");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 凭据文件不是有效 JSON");
  }
  const stored = parsed && typeof parsed === "object" ? parsed.zcode_jwt_token : "";
  if (!stored || typeof stored !== "string") {
    throw new ZcodeTokenPlanError("ZCODE_TOKEN_MISSING", "ZCode 凭据中缺少 zcode_jwt_token，请重新登录 ZCode");
  }
  const key = deriveZcodeKey({ env, platform, home, username });
  const jwt = decryptZcodeValue(stored, key).trim();
  if (!jwt) {
    throw new ZcodeTokenPlanError("ZCODE_TOKEN_MISSING", "ZCode JWT 为空，请重新登录 ZCode");
  }
  return jwt;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseResetAt(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    // Some payloads use unix seconds/millis for period_end / expires_at.
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
      return new Date(ms).toISOString();
    }
    return "";
  }
  const ts = Date.parse(raw.trim());
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : "";
}

/**
 * Parse the ZCode balance envelope.
 *   { code: 0, msg, data: { plans: [...], balances: [...] } }
 * plans[] → the active plan (status === "active") provides the plan label.
 * balances[] → summed across models: total_units / used_units /
 *   (remaining_units || available_units); reset = earliest period_end.
 */
function parseZcodeBalanceResponse(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 余额响应无效");
  }
  const code = Number(payload.code);
  if (Number.isFinite(code) && code !== 0 && code !== 200) {
    throw new ZcodeTokenPlanError("ZCODE_PROVIDER_ERROR", `ZCode 余额接口返回错误 code=${code}`);
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const balances = Array.isArray(data.balances) ? data.balances : [];
  if (balances.length === 0) {
    throw new ZcodeTokenPlanError("ZCODE_NO_BALANCE", "ZCode 未返回任何额度信息");
  }

  let total = 0;
  let used = 0;
  let remaining = 0;
  let sawTotal = false;
  let sawUsed = false;
  let sawRemaining = false;
  let resetAt = "";
  for (const entry of balances) {
    if (!entry || typeof entry !== "object") continue;
    const t = finiteNonNegative(entry.total_units);
    const u = finiteNonNegative(entry.used_units);
    const r = finiteNonNegative(entry.remaining_units ?? entry.available_units);
    if (t !== null) { total += t; sawTotal = true; }
    if (u !== null) { used += u; sawUsed = true; }
    if (r !== null) { remaining += r; sawRemaining = true; }
    const candidateReset = parseResetAt(entry.period_end ?? entry.expires_at);
    if (candidateReset) {
      if (!resetAt || Date.parse(candidateReset) < Date.parse(resetAt)) resetAt = candidateReset;
    }
  }

  if (!sawTotal && !sawRemaining && !sawUsed) {
    throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 额度字段缺失");
  }
  // Derive the missing leg when only two of the three are present.
  if (!sawTotal && sawUsed && sawRemaining) total = used + remaining;
  if (!sawRemaining && sawTotal && sawUsed) remaining = Math.max(0, total - used);
  if (!sawUsed && sawTotal && sawRemaining) used = Math.max(0, total - remaining);

  const plans = Array.isArray(data.plans) ? data.plans : [];
  const activePlan = plans.find((plan) => String(plan?.status || "").toLowerCase() === "active") || plans[0] || null;
  const planLabel = activePlan
    ? String(activePlan.name || activePlan.plan_id || "").trim()
    : "";

  return {
    total_quota: total,
    used_quota: used,
    remaining_quota: remaining,
    quota_windows: [
      {
        kind: "total",
        unit: "tokens",
        total,
        used,
        remaining,
        percentage: total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0,
        resets_at: resetAt,
      },
    ],
    plan_label: planLabel,
  };
}

async function fetchZcodeQuota({ home, env = process.env, platform, username, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (!isZcodeInstalled({ home, env })) {
    throw new ZcodeTokenPlanError("ZCODE_NOT_INSTALLED", "未检测到 ZCode 本地登录，请先在 ZCode 中登录");
  }
  const jwt = readZcodeJwt({ home, env, platform, username });

  const url = `${ZCODE_BALANCE_URL}?app_version=${encodeURIComponent(ZCODE_APP_VERSION)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 响应超过大小限制");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ZcodeTokenPlanError("ZCODE_REAUTH_REQUIRED", "ZCode 登录已失效，请重新登录 ZCode");
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ZcodeTokenPlanError("ZCODE_RESPONSE_STRUCTURE_DRIFT", "ZCode 余额响应不是有效 JSON");
    }
    if (!response.ok) {
      throw new ZcodeTokenPlanError("ZCODE_PROVIDER_ERROR", `ZCode 余额接口返回 HTTP ${response.status}`);
    }
    const parsed = parseZcodeBalanceResponse(payload);
    return {
      ...parsed,
      provider_reported_at: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ZcodeTokenPlanError("ZCODE_TIMEOUT", "ZCode 余额请求超时");
    }
    if (error instanceof ZcodeTokenPlanError) throw error;
    throw new ZcodeTokenPlanError("ZCODE_NETWORK_ERROR", "无法查询 ZCode 额度");
  } finally {
    clearTimeout(timeout);
  }
}

function createZcodeProviderAdapter({ fetchImpl = globalThis.fetch, home, env, platform, username } = {}) {
  return async function zcodeProviderAdapter() {
    return fetchZcodeQuota({ home, env, platform, username, fetchImpl });
  };
}

module.exports = {
  ZCODE_BALANCE_URL,
  ZCODE_APP_VERSION,
  ZcodeTokenPlanError,
  mapZcodeErrorCode,
  resolveZcodeHome,
  zcodeCredentialsPath,
  deriveZcodeKey,
  encryptZcodeValue,
  decryptZcodeValue,
  isEncryptedValue,
  isZcodeInstalled,
  readZcodeJwt,
  parseZcodeBalanceResponse,
  fetchZcodeQuota,
  createZcodeProviderAdapter,
};
