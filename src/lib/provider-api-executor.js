"use strict";

/**
 * Provider API Financial Request Executor (02 - 供应商 API 余额后端)
 *
 * Security invariants:
 * - Only allows GET or read-only POST to financial query endpoints.
 * - HTTPS required in production; HTTP only via test-mode flag for mock servers.
 * - Rejects cloud metadata addresses, file protocol, and non-HTTP(S) protocols.
 * - Rejects model inference endpoints (chat/completions, responses, messages,
 *   embeddings, images/generations) — allowlist over blocklist.
 * - Enforces connect + total request timeout, response body size limit, and
 *   max redirect count.
 * - Cross-domain redirects MUST NOT carry Authorization or custom key headers.
 * - Error messages and logs are sanitized — no API key, Bearer token, or
 *   query-param secrets leak into responses or logs.
 *
 * This module NEVER calls model inference endpoints. It only queries
 * provider account balance / spend financial endpoints.
 */

const https = require("node:https");
const http = require("node:http");
const {
  getCredentialRedactions,
  parseAccessKeyCredential,
  signAliyunRpcRequest,
  signVolcengineRequest,
} = require("./provider-api-signing");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_REDIRECTS = 3;

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]); // http only in test mode

const MODEL_ENDPOINT_PATTERNS = [
  /\/chat\/completions?$/i,
  /\/completions?$/i, // legacy OpenAI /completions (separate from /chat/completions)
  /\/responses?$/i,
  /\/messages?$/i,
  /\/embeddings?$/i,
  /\/images\/generations?$/i,
  /\/images\/edits?$/i,
  /\/images\/variations?$/i,
  /\/audio\/transcriptions?$/i,
  /\/audio\/translations?$/i,
  /\/audio\/speech?$/i,
  /\/moderations?$/i,
  // 01-密钥安全修复: 扩展模型调用路径黑名单，覆盖 Gemini / Bedrock / 通用推理路径，
  // 防止 generic 配置通过这些路径绕过"只查财务"边界。
  // generateContent / streamGenerateContent（Gemini，路径段可能以 ':' 分隔，如
  // .../models/gemini-pro:generateContent），故用 [\/:] 锚定前缀。
  /[\/:]generateContent$/i,
  /[\/:]streamGenerateContent$/i,
  /\/generate$/i,
  /\/predict$/i,
  /\/invoke$/i, // AWS Bedrock invoke / invoke-with-response-stream
  /\/infer$/i,
];

const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254", // AWS / Azure IMDS
  "169.254.170.2", // ECS task metadata
  "169.254.170.3", // ECS task metadata v4
  "metadata.google.internal", // GCP metadata
  "metadata", // GCP metadata alias
  "fd00:ec2::254", // AWS IMDS IPv6
]);

// 05-供应商API财务端点白名单修复: 财务 endpoint 允许关键词。
// 供应商 API 配置只用于读取账户余额、账单、用量、花销、credit、订阅、发票、
// 配额、支付等财务信息。任何不在该集合内的 pathname 默认拒绝（default-deny）。
// 这是 allowlist 策略：即使攻击者构造了一个新的非财务 POST endpoint（如
// /v1/realtime/sessions、/v1/batches、/api/run-agent），由于 pathname 不含
// 财务关键词，会被 isFinancialProviderEndpoint 拒绝。
const FINANCIAL_KEYWORDS = [
  "balance", "balances",
  "billing",
  "cost", "costs",
  "usage",
  "spend", "spending",
  "credit", "credits",
  "subscription", "subscriptions",
  "invoice", "invoices",
  "quota", "quotas",
  "payment", "payments",
];

// 关键词匹配正则：关键词前后必须是字符串边界或路径分隔符（/ : . _ -）。
// 这样 `cost` 不会误匹配 `toast`，`credit` 只匹配 `credit_grants` 这类以
// 分隔符衔接的路径段。`:` 覆盖 Gemini 风格的 `models/foo:generateContent`
// 路径（generateContent 不是财务关键词，仍被拒绝）。
const FINANCIAL_KEYWORD_REGEX = new RegExp(
  "(?:^|[/:._-])(" + FINANCIAL_KEYWORDS.join("|") + ")(?:[/:._-]|$)",
  "i"
);

// Query param names that indicate a secret in the URL
const SECRET_QUERY_PARAMS = new Set([
  "api_key", "apikey", "api-key",
  "key", "token", "secret",
  "access_token", "accesstoken",
  "refresh_token", "refreshtoken",
  "password", "passwd",
  "private_key", "privatekey",
  "accesskeyid", "signature",
]);

// ---------------------------------------------------------------------------
// URL / endpoint validation
// ---------------------------------------------------------------------------

/**
 * Check if a URL points to a model inference endpoint.
 * These endpoints are FORBIDDEN — this module only queries financial endpoints.
 *
 * 01-密钥安全修复 (对抗性审查修复): 必须在测试 pattern 前剥离 query string
 * 和 fragment，否则 `?foo=bar` 或 `#section` 会使 `$` 锚失效，导致
 * `https://api.openai.com/v1/chat/completions?foo=bar` 绕过检测。
 */
function isModelEndpoint(url) {
  if (typeof url !== "string") return false;
  // Strip query string (?) and fragment (#) before pattern matching.
  let path = url;
  const qIdx = path.indexOf("?");
  if (qIdx >= 0) path = path.slice(0, qIdx);
  const hIdx = path.indexOf("#");
  if (hIdx >= 0) path = path.slice(0, hIdx);
  // 04-独立贝叶斯复验 对抗性审查修复: 剥离尾部斜杠。模式用 $ 锚定 URL 末尾，
  // 尾部斜杠（如 /v1/chat/completions/）会使 $ 不匹配，从而绕过检测。HTTP
  // 服务器通常将 /chat/completions/ 与 /chat/completions 视为同一 endpoint，
  // 因此这是真实可利用的绕过，必须关闭。
  path = path.replace(/\/+$/, "");
  const lower = path.toLowerCase();
  for (const pattern of MODEL_ENDPOINT_PATTERNS) {
    if (pattern.test(lower)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Financial endpoint allowlist (05-供应商API财务端点白名单修复)
// ---------------------------------------------------------------------------

/**
 * Normalize a URL pathname for financial-endpoint matching.
 * - Lowercase
 * - Collapse repeated slashes (// -> /)
 * - Resolve "." and ".." segments (split + stack approach — a simple regex
 *   cannot pop the preceding segment, which is required for correct ".."
 *   resolution; URL parser already handles these, but we re-normalize
 *   defensively in case the input is a raw string)
 * - Strip trailing slash(es)
 *
 * Note: query string (?) and fragment (#) are excluded by URL.pathname,
 * so callers MUST pass parsed.pathname (not the raw URL string).
 *
 * @param {string} pathname
 * @returns {string}
 */
function normalizeFinancialPath(pathname) {
  if (typeof pathname !== "string") return "";
  let p = pathname.toLowerCase();
  if (!p) return "";
  // Collapse repeated slashes first so split() yields clean segments
  p = p.replace(/\/{2,}/g, "/");
  // Split into segments and resolve . / .. with a stack (correct ".." pop)
  const segments = p.split("/").filter((s) => s.length > 0);
  const resolved = [];
  for (const seg of segments) {
    if (seg === ".") continue;
    if (seg === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(seg);
  }
  // Empty resolved list means root path — return "/" so callers can detect it
  if (resolved.length === 0) return "/";
  return "/" + resolved.join("/");
}

/**
 * Check if a URL points to a financial query endpoint (allowlist).
 *
 * 05-供应商API财务端点白名单修复: 之前只拦截模型推理 endpoint（chat/completions、
 * messages、embeddings 等），但 realtime/sessions、batches、countTokens、
 * run-agent 等非财务 POST endpoint 因为不在模型黑名单内而通过校验，导致真实
 * API Key 可能被发往非财务接口。现在改为 allowlist：URL pathname 必须包含
 * 财务关键词（balance/billing/costs/usage/spend/credit/subscription/invoice/
 * quota/payment）才被允许，否则默认拒绝。
 *
 * 以 host+pathname 双重判断为准：先用 new URL() 解析出 pathname（host 已由
 * isCloudMetadataAddress 和 HTTPS 校验覆盖），再对规范化后的 pathname 做关键词
 * 匹配。路径规范化处理尾部斜杠、重复斜杠、`.` 段、大小写，关闭绕过路径。
 *
 * @param {string} url
 * @returns {boolean}
 */
function isFinancialProviderEndpoint(url) {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const action = String(parsed.searchParams.get("Action") || "");
  if (host === "business.aliyuncs.com" && action === "QueryAccountBalance") return true;
  if (host === "open.volcengineapi.com" && action === "QueryBalanceAcct") return true;
  const normalized = normalizeFinancialPath(parsed.pathname);
  // Root path "/" or empty pathname cannot be a financial endpoint
  if (!normalized || normalized === "/") return false;
  return FINANCIAL_KEYWORD_REGEX.test(normalized);
}

/**
 * Check if a host is a cloud metadata address (SSRF protection).
 */
function isCloudMetadataAddress(host) {
  if (typeof host !== "string") return false;
  const lower = host.toLowerCase().trim();
  if (CLOUD_METADATA_HOSTS.has(lower)) return true;
  // AWS IMDS IPv6
  if (lower === "[fd00:ec2::254]") return true;
  // Wildcard check for 169.254.x.x (link-local)
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(lower)) return true;
  return false;
}

/**
 * Check if a URL is allowed (valid protocol, not metadata, not model endpoint).
 * In production mode, only HTTPS is allowed. In test mode, HTTP is also allowed
 * (for mock servers).
 */
function isAllowedUrl(url, options = {}) {
  const testMode = Boolean(options.testMode);
  if (typeof url !== "string") return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Protocol check
  if (testMode) {
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  } else {
    if (parsed.protocol !== "https:") return false;
  }

  // Reject cloud metadata addresses
  if (isCloudMetadataAddress(parsed.hostname)) return false;

  // Reject model inference endpoints
  if (isModelEndpoint(url)) return false;

  // 05-供应商API财务端点白名单修复: 只允许财务 endpoint（allowlist）。
  // 非财务 POST endpoint（realtime/sessions、batches、countTokens、run-agent）
  // 即使不是模型推理 endpoint，也会因 pathname 不含财务关键词而被拒绝。
  if (!isFinancialProviderEndpoint(url)) return false;

  // Reject secrets in query params
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sanitization (never leak secrets into logs or error messages)
// ---------------------------------------------------------------------------

/**
 * Sanitize a URL for logging — redact secret query param values.
 */
function sanitizeUrlForLogging(url) {
  if (typeof url !== "string") return String(url || "");
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const keysToRedact = [];
    for (const key of params.keys()) {
      if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToRedact.push(key);
      }
    }
    for (const key of keysToRedact) {
      params.set(key, "***");
    }
    return parsed.toString();
  } catch {
    // Not a valid URL — do regex-based redaction
    return url
      .replace(/([?&](?:api[_-]?key|key|token|secret|password)=)[^&]*/gi, "$1***")
      .replace(/(Bearer\s+)[^\s,]+/gi, "$1***");
  }
}

/**
 * Sanitize an error message — redact Bearer tokens, sk- keys, api_key values.
 * Real provider keys (e.g. sk-proj-xxxx, sk-ant-xxxx) contain internal hyphens,
 * so the redaction pattern allows hyphens after the sk-/tp- prefix.
 *
 * 01-密钥安全修复: `extraSecrets` lets callers redact the actual secret value
 * verbatim — required because unique test secrets (TE_REPAIR_SECRET_<uuid>) and
 * non-sk- prefixed keys are not matched by the pattern redactors. Callers that
 * have the resolved secret in scope MUST pass it here so it never leaks into an
 * API response or log.
 *
 * @param {string} msg
 * @param {string[]} [extraSecrets=[]] - Verbatim strings to redact (e.g. [secret])
 */
function sanitizeErrorMessage(msg, extraSecrets = []) {
  if (msg == null) return String(msg);
  let str = typeof msg === "string" ? msg : String(msg);
  str = str
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9\-_]{10,}/g, "sk-***")
    .replace(/tp-[A-Za-z0-9\-_]{10,}/g, "tp-***")
    .replace(/(api[_-]?key[=:]\s*)\S+/gi, "$1***")
    .replace(/(Authorization:\s*)\S+/gi, "$1***")
    .replace(/([?&](?:api[_-]?key|key|token|secret|password)=)[^&\s]+/gi, "$1***");
  // Verbatim redaction of any caller-supplied secret (non-empty only).
  for (const s of extraSecrets) {
    if (typeof s === "string" && s.length > 0) {
      // Escape regex metacharacters in the secret before redacting.
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      str = str.replace(new RegExp(escaped, "g"), "***");
    }
  }
  return str;
}

// ---------------------------------------------------------------------------
// Redirect target validation (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Validate a redirect target URL.
 *
 * 01-密钥安全修复: extracted as a pure function so the redirect-time checks
 * (HTTPS in production, cloud metadata, model endpoint, secret query params)
 * are unit-testable without spinning up mock servers.
 *
 * @param {string} redirectUrl
 * @param {Object} [options]
 * @param {boolean} [options.testMode=false] - Allow HTTP target in test mode
 * @returns {{ok: true} | {ok: false, error_code: string, error: string}}
 */
function validateRedirectTarget(redirectUrl, options = {}) {
  const testMode = Boolean(options.testMode);
  let parsed;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return { ok: false, error_code: "provider_response_invalid", error: "重定向地址无效" };
  }
  // HTTP downgrade rejection in production mode
  if (!testMode && parsed.protocol !== "https:") {
    return { ok: false, error_code: "provider_response_invalid", error: "重定向目标必须为 HTTPS" };
  }
  if (testMode && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error_code: "provider_response_invalid", error: "重定向目标协议不被允许" };
  }
  if (isCloudMetadataAddress(parsed.hostname)) {
    return { ok: false, error_code: "provider_response_invalid", error: "重定向目标不允许指向云元数据地址" };
  }
  if (isModelEndpoint(redirectUrl)) {
    return { ok: false, error_code: "provider_response_invalid", error: "重定向目标不允许指向模型推理端点" };
  }
  // Reject secrets in query params on the redirect target
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
      return { ok: false, error_code: "provider_response_invalid", error: "重定向目标不允许携带密钥查询参数" };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Financial request executor
// ---------------------------------------------------------------------------

/**
 * Execute a financial query request to a provider's balance/cost endpoint.
 *
 * @param {Object} config - ProviderApiConfig (non-secret fields)
 * @param {string} secret - The resolved API key (never logged)
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=15000] - Total request timeout
 * @param {number} [options.maxResponseBytes=10485760] - Max response body size
 * @param {number} [options.maxRedirects=3] - Max redirects to follow
 * @param {boolean} [options.testMode=false] - Allow HTTP for mock servers
 * @returns {Promise<{ok: true, data: object, statusCode: number} | {ok: false, error_code: string, error: string, statusCode?: number}>}
 */
async function executeFinancialRequest(config, secret, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = Number(options.maxResponseBytes) || DEFAULT_MAX_RESPONSE_BYTES;
  const configuredMaxRedirects = Number(options.maxRedirects);
  const maxRedirects = Number.isInteger(configuredMaxRedirects) && configuredMaxRedirects >= 0
    ? configuredMaxRedirects
    : DEFAULT_MAX_REDIRECTS;
  const testMode = Boolean(options.testMode);

  let requestUrl = String(config?.requestUrl || "").trim();
  if (!requestUrl) {
    return { ok: false, error_code: "invalid_config", error: "请求地址未配置" };
  }

  // Validate URL
  if (!isAllowedUrl(requestUrl, { testMode })) {
    // Distinguish the reason for a better error code
    let parsed;
    try {
      parsed = new URL(requestUrl);
    } catch {
      return { ok: false, error_code: "invalid_config", error: "请求地址格式无效" };
    }
    if (testMode && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error_code: "invalid_config", error: "只允许 HTTP/HTTPS 协议" };
    }
    if (!testMode && parsed.protocol !== "https:") {
      return { ok: false, error_code: "invalid_config", error: "生产模式下只允许 HTTPS" };
    }
    if (isCloudMetadataAddress(parsed.hostname)) {
      return { ok: false, error_code: "invalid_config", error: "不允许访问云元数据地址" };
    }
    if (isModelEndpoint(requestUrl)) {
      return { ok: false, error_code: "invalid_config", error: "不允许调用模型推理端点" };
    }
    // 05-供应商API财务端点白名单修复: 非财务 endpoint 用独立的错误码，让 UI
    // 能区分"配置格式不合法"（invalid_config）和"endpoint 不受支持"
    // （unsupported_endpoint）。错误信息不泄露 URL 原文（可能含敏感路径）。
    if (!isFinancialProviderEndpoint(requestUrl)) {
      return {
        ok: false,
        error_code: "unsupported_endpoint",
        error: "只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）",
      };
    }
    return { ok: false, error_code: "invalid_config", error: "请求地址不被允许" };
  }

  const method = String(config?.requestMethod || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return { ok: false, error_code: "invalid_config", error: "只允许 GET 或 POST 方法" };
  }

  // Build auth headers
  const authType = String(config?.authType || "bearer").trim().toLowerCase();
  const headers = {
    Accept: "application/json",
    "User-Agent": "TokenEyes/2.0 (balance-query)",
  };

  // 01-密钥安全修复 (F2): 敏感 Header 名集合（小写）。
  // 跨 origin 重定向时，这些 Header 必须被精确剥离——包括实际配置的自定义
  // 鉴权 Header 名（如 X-Custom-Auth），而不仅是固定的 Authorization/Cookie。
  // 大小写不敏感：集合统一存小写，比较时也对 Header 名转小写。
  const sensitiveHeaderNames = new Set(["authorization", "cookie"]);
  let configuredAuthHeaderName = "";
  let signedRequest = false;

  if (authType === "aliyun_rpc" || authType === "volcengine_hmac") {
    if (method !== "GET") {
      return { ok: false, error_code: "invalid_config", error: "签名余额接口仅支持 GET" };
    }
    const credentials = parseAccessKeyCredential(secret);
    if (!credentials) {
      return { ok: false, error_code: "invalid_config", error: "AccessKey 凭据格式无效" };
    }
    try {
      const signed = authType === "aliyun_rpc"
        ? signAliyunRpcRequest(requestUrl, credentials, options.signing)
        : signVolcengineRequest(requestUrl, credentials, options.signing);
      requestUrl = signed.url;
      Object.assign(headers, signed.headers);
      signedRequest = true;
    } catch {
      return { ok: false, error_code: "invalid_config", error: "余额查询请求签名失败" };
    }
  } else if (secret) {
    if (authType === "bearer") {
      headers["Authorization"] = `Bearer ${secret}`;
    } else if (authType === "header") {
      const headerName = String(config?.authHeaderName || "").trim();
      if (headerName) {
        headers[headerName] = secret;
        configuredAuthHeaderName = headerName;
        sensitiveHeaderNames.add(headerName.toLowerCase());
      }
    }
  }

  // Add non-secret custom headers
  const nonSecretHeaders = config?.nonSecretHeaders;
  if (nonSecretHeaders && typeof nonSecretHeaders === "object") {
    for (const [k, v] of Object.entries(nonSecretHeaders)) {
      // Never overwrite auth headers
      const lower = k.toLowerCase();
      if (lower === "authorization" || lower === "cookie") continue;
      headers[k] = String(v);
    }
  }

  // 01-密钥安全修复 (F1 错误脱敏): 把实际密钥作为 verbatim 脱敏目标传入，
  // 保证子进程/网络错误中出现的密钥原文被清除（覆盖非 sk- 前缀的密钥）。
  const extraRedactions = getCredentialRedactions(secret);

  // Execute with redirect handling
  // SECURITY: originalHost uses URL.host (includes port) so that redirects to a
  // different port on the same hostname are treated as cross-domain and have
  // auth headers stripped — matching browser same-origin policy.
  const originalParsed = new URL(requestUrl);
  return executeWithRedirects(requestUrl, method, headers, {
    timeoutMs,
    maxResponseBytes,
    maxRedirects: signedRequest ? 0 : maxRedirects,
    testMode,
    originalHost: originalParsed.host,
    originalProtocol: originalParsed.protocol,
    sensitiveHeaderNames,
    extraRedactions,
  });
}

function executeWithRedirects(url, method, headers, opts, redirectCount = 0) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, error_code: "invalid_config", error: "请求地址格式无效" });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const requestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers },
      timeout: opts.timeoutMs,
    };

    let settled = false;
    let totalBytes = 0;
    const chunks = [];
    let aborted = false;

    function done(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    const req = client.request(requestOptions, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); // drain

        if (redirectCount >= opts.maxRedirects) {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: `重定向次数超过限制（${opts.maxRedirects}）`,
            statusCode: res.statusCode,
          });
          return;
        }

        let redirectUrl;
        try {
          redirectUrl = new URL(res.headers.location, url).toString();
        } catch {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: "重定向地址无效",
            statusCode: res.statusCode,
          });
          return;
        }

        let redirectParsed;
        try {
          redirectParsed = new URL(redirectUrl);
        } catch {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: "重定向地址无效",
            statusCode: res.statusCode,
          });
          return;
        }

        // 01-密钥安全修复 (F2): 每个重定向目标重新执行 HTTPS / 云元数据 / 模型
        // endpoint / 密钥查询参数校验。HTTP 降级在生产模式下被拒绝。
        const targetCheck = validateRedirectTarget(redirectUrl, { testMode: opts.testMode });
        if (!targetCheck.ok) {
          done({
            ok: false,
            error_code: targetCheck.error_code,
            error: targetCheck.error,
            statusCode: res.statusCode,
          });
          return;
        }

        // SECURITY: Cross-origin redirect — strip sensitive headers.
        // "Same origin" means same host (hostname:port) AND same protocol, matching
        // browser same-origin policy. A redirect to a different port is cross-origin
        // because it may be a different service that must not receive the credentials.
        //
        // 01-密钥安全修复 (F2): 剥离集合必须包含实际配置的 authHeaderName
        // （如 X-Custom-Auth），而不仅是固定名称。大小写不敏感。第一跳跨域剥离
        // 后，后续跳传递的是已剥离的 redirectHeaders 副本，因此即使再跳回原域，
        // 密钥也不会恢复（不存在"重新注入"路径）。
        const redirectHeaders = { ...headers };
        const isSameOrigin = redirectParsed.host === opts.originalHost &&
          redirectParsed.protocol === opts.originalProtocol;

        if (!isSameOrigin) {
          const sensitive = opts.sensitiveHeaderNames || new Set(["authorization", "cookie"]);
          for (const key of Object.keys(redirectHeaders)) {
            const lower = key.toLowerCase();
            if (sensitive.has(lower) ||
                lower === "authorization" ||
                lower === "cookie" ||
                lower.includes("api-key") ||
                lower.includes("apikey") ||
                SECRET_QUERY_PARAMS.has(lower)) {
              delete redirectHeaders[key];
            }
          }
        }

        done(executeWithRedirects(redirectUrl, method, redirectHeaders, opts, redirectCount + 1));
        return;
      }

      // Check Content-Type — reject HTML pages (likely login pages)
      const contentType = String(res.headers["content-type"] || "").toLowerCase();
      const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");

      res.on("data", (chunk) => {
        if (aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > opts.maxResponseBytes) {
          aborted = true;
          req.destroy();
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: "响应体超过大小限制",
            statusCode: res.statusCode,
          });
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        if (aborted) return;
        const body = Buffer.concat(chunks).toString("utf8");

        // Map HTTP errors to error codes
        if (res.statusCode === 401 || res.statusCode === 403) {
          done({
            ok: false,
            error_code: "provider_unauthorized",
            error: `供应商鉴权失败（HTTP ${res.statusCode}）`,
            statusCode: res.statusCode,
          });
          return;
        }
        if (res.statusCode === 429) {
          done({
            ok: false,
            error_code: "provider_rate_limited",
            error: "供应商限流（HTTP 429）",
            statusCode: res.statusCode,
          });
          return;
        }
        if (res.statusCode >= 500) {
          done({
            ok: false,
            error_code: "provider_unavailable",
            error: `供应商不可用（HTTP ${res.statusCode}）`,
            statusCode: res.statusCode,
          });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: `供应商返回非成功状态（HTTP ${res.statusCode}）`,
            statusCode: res.statusCode,
          });
          return;
        }

        // Reject HTML responses (likely login pages)
        if (isHtml) {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: "供应商返回 HTML 页面而非 JSON（可能是登录页）",
            statusCode: res.statusCode,
          });
          return;
        }

        // Parse JSON
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          done({
            ok: false,
            error_code: "provider_response_invalid",
            error: "供应商响应不是有效 JSON",
            statusCode: res.statusCode,
          });
          return;
        }

        done({ ok: true, data, statusCode: res.statusCode });
      });
    });

    req.on("timeout", () => {
      if (aborted) return;
      aborted = true;
      req.destroy();
      done({
        ok: false,
        error_code: "request_timeout",
        error: "请求超时",
      });
    });

    req.on("error", (err) => {
      if (aborted) return;
      aborted = true;
      const sanitized = sanitizeErrorMessage(err?.message || String(err), opts.extraRedactions || []);
      done({
        ok: false,
        error_code: "provider_unavailable",
        error: `网络错误：${sanitized}`,
      });
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

const ERROR_CODES = Object.freeze({
  INVALID_CONFIG: "invalid_config",
  CREDENTIAL_STORE_UNAVAILABLE: "credential_store_unavailable",
  CREDENTIAL_MISSING: "credential_missing",
  UNSUPPORTED_ENDPOINT: "unsupported_endpoint",
  REQUEST_TIMEOUT: "request_timeout",
  PROVIDER_UNAUTHORIZED: "provider_unauthorized",
  PROVIDER_RATE_LIMITED: "provider_rate_limited",
  PROVIDER_RESPONSE_INVALID: "provider_response_invalid",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  isModelEndpoint,
  isFinancialProviderEndpoint,
  normalizeFinancialPath,
  isCloudMetadataAddress,
  isAllowedUrl,
  sanitizeUrlForLogging,
  sanitizeErrorMessage,
  validateRedirectTarget,
  executeFinancialRequest,
  ERROR_CODES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_REDIRECTS,
};
