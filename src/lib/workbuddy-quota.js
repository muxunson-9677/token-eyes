// WorkBuddy (Tencent CodeBuddy CLI rebrand) — read-only credit quota reader.
//
// Provider behavior was cross-checked against the source-available Cockpit
// Tools project (jlcodes99/cockpit-tools, CC BY-NC-SA 4.0). Endpoint names,
// response fields, and package identifiers below are protocol facts; no
// Cockpit implementation module is imported. Commercial distribution still
// requires an explicit provenance/license review.
//
// 1. The WorkBuddy desktop client persists its login session as PLAINTEXT
//    JSON at a fixed per-OS path ("workbuddy-desktop.info"). A sibling
//    ".logged-out" marker means the session is signed out.
// 2. POST https://www.codebuddy.cn/v2/billing/meter/get-user-resource with
//    the file's Bearer accessToken returns the credit packages shown in the
//    official "账号管理" screen (基础体验包 / 活动赠送包 / 加量包 …).
// 3. Packages are grouped by PackageCode into base / activity / extra
//    buckets; used = total - remain, values may be fractional credit strings.
//
// Privacy: the access token is read from the user's own machine, sent ONLY
// to codebuddy.cn, and never persisted or logged by Token Eyes.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WORKBUDDY_BILLING_HOST = "https://www.codebuddy.cn";
const AUTH_FILE_NAME = "workbuddy-desktop.info";
const QUOTA_TIMEOUT_MS = 10_000;

// Provider PackageCode → user-facing native Credits bucket.
const PACKAGE_BUCKETS = Object.freeze({
  TCACA_code_001_PqouKr6QWV: "base", // 基础体验包 (free)
  TCACA_code_002_AkiJS3ZHF5: "base", // 专业版订阅 (monthly)
  TCACA_code_003_FAnt7lcmRT: "base", // 专业版订阅 (yearly)
  TCACA_code_006_DbXS0lrypC: "base", // 基础体验包 (trial gift)
  TCACA_code_007_nzdH5h4Nl0: "activity", // 活动赠送包
  TCACA_code_008_cfWoLwvjU4: "base", // 基础体验包 (monthly free)
  TCACA_code_009_0XmEQc2xOf: "extra", // 加量包
});

const PRO_PACKAGE_CODES = new Set([
  "TCACA_code_002_AkiJS3ZHF5",
  "TCACA_code_003_FAnt7lcmRT",
]);
const TRIAL_PACKAGE_CODE = "TCACA_code_006_DbXS0lrypC";

function resolveWorkbuddyAuthFile({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(localAppData, "CodeBuddyExtension", "Data", "Public", "auth", AUTH_FILE_NAME);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth", AUTH_FILE_NAME);
  }
  return path.join(home, ".local", "share", "CodeBuddyExtension", "Data", "Public", "auth", AUTH_FILE_NAME);
}

/**
 * Read the WorkBuddy desktop login session.
 * Returns null when not installed / logged out / unreadable.
 */
function readWorkbuddyAuth(options = {}) {
  const authFile = resolveWorkbuddyAuthFile(options);
  try {
    if (fs.existsSync(`${authFile}.logged-out`)) return null;
    const raw = fs.readFileSync(authFile, "utf8");
    const parsed = JSON.parse(raw);
    const auth = parsed?.auth && typeof parsed.auth === "object" ? parsed.auth : {};
    const account = parsed?.account && typeof parsed.account === "object" ? parsed.account : {};
    // Support the credential shapes emitted by current and older WorkBuddy
    // clients: root token fields first, then auth.accessToken. Older clients may pack
    // "<uid>+<token>" into one string.
    let token = [parsed?.token, parsed?.access_token, parsed?.accessToken, auth.accessToken, auth.access_token]
      .find((value) => typeof value === "string" && value.trim()) || "";
    token = token.trim();
    let uidFromToken = "";
    if (token.includes("+")) {
      const splitAt = token.indexOf("+");
      uidFromToken = token.slice(0, splitAt);
      token = token.slice(splitAt + 1);
    }
    if (!token) return null;
    return {
      accessToken: token,
      uid: String(account.uid || uidFromToken || ""),
      domain: String(auth.domain || "www.codebuddy.cn"),
      enterpriseId: String(account.enterpriseId || ""),
      authFile,
    };
  } catch {
    return null;
  }
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function packageTotal(entry) {
  for (const key of ["CycleCapacitySizePrecise", "CycleCapacitySize", "CapacitySizePrecise", "CapacitySize"]) {
    if (entry[key] != null && entry[key] !== "") return toFiniteNumber(entry[key]);
  }
  return null;
}

function packageRemain(entry) {
  for (const key of ["CycleCapacityRemainPrecise", "CycleCapacityRemain", "CapacityRemainPrecise", "CapacityRemain"]) {
    if (entry[key] != null && entry[key] !== "") return toFiniteNumber(entry[key]);
  }
  return null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function summarizeWorkbuddyQuota(groups) {
  const source = Array.isArray(groups) ? groups : [];
  if (!source.length) return { total: null, remaining: null };
  const totals = source.map((group) => toFiniteNumber(group?.total));
  const remaining = source.map((group) => toFiniteNumber(group?.remain));
  return {
    total: totals.every((value) => value !== null)
      ? round2(totals.reduce((sum, value) => sum + value, 0))
      : null,
    remaining: remaining.every((value) => value !== null)
      ? round2(remaining.reduce((sum, value) => sum + value, 0))
      : null,
  };
}

function advanceWorkbuddyDailyObservation(previous, observation) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(observation?.day || ""))
    ? String(observation.day)
    : null;
  const remaining = toFiniteNumber(observation?.remaining);
  const total = toFiniteNumber(observation?.total);
  const observedAt = typeof observation?.observedAt === "string" ? observation.observedAt : null;
  if (!day || remaining === null) {
    return { snapshot: null, todayConsumed: null, evidenceState: "connected_no_exact_data" };
  }

  const sameDay = previous?.day === day;
  const previousFirst = toFiniteNumber(previous?.first_remaining);
  const previousTotal = toFiniteNumber(previous?.total);
  const refilled = sameDay && previousFirst !== null && remaining > previousFirst;
  const capacityChanged = sameDay && previousTotal !== null && total !== null && total > previousTotal;
  const resetBaseline = !sameDay || previousFirst === null || refilled || capacityChanged;
  const firstRemaining = resetBaseline ? remaining : previousFirst;
  const snapshot = {
    day,
    first_remaining: firstRemaining,
    last_remaining: remaining,
    total,
    first_observed_at: resetBaseline ? observedAt : previous?.first_observed_at || observedAt,
    last_observed_at: observedAt,
  };
  return {
    snapshot,
    todayConsumed: round2(Math.max(0, firstRemaining - remaining)),
    evidenceState: "observed",
  };
}

/**
 * Group raw billing accounts into the base/activity/extra buckets the
 * official client renders. Only Status 0 (valid) and 3 (used up) count.
 */
function groupWorkbuddyPackages(accounts) {
  const groups = {
    base: { id: "base", items: 0, total: 0, remain: 0, hasUnknownTotal: false, hasUnknownRemain: false },
    activity: { id: "activity", items: 0, total: 0, remain: 0, hasUnknownTotal: false, hasUnknownRemain: false },
    extra: { id: "extra", items: 0, total: 0, remain: 0, hasUnknownTotal: false, hasUnknownRemain: false },
    other: { id: "other", items: 0, total: 0, remain: 0, hasUnknownTotal: false, hasUnknownRemain: false },
  };
  let plan = "FREE";
  for (const entry of Array.isArray(accounts) ? accounts : []) {
    if (!entry || typeof entry !== "object") continue;
    const status = Number(entry.Status);
    if (status !== 0 && status !== 3) continue;
    const code = String(entry.PackageCode || "");
    const bucket = groups[PACKAGE_BUCKETS[code] || "other"];
    bucket.items += 1;
    const total = packageTotal(entry);
    const remain = packageRemain(entry);
    if (total === null) bucket.hasUnknownTotal = true;
    else bucket.total += total;
    if (remain === null) bucket.hasUnknownRemain = true;
    else bucket.remain += remain;
    if (status === 0 && PRO_PACKAGE_CODES.has(code)) plan = "PRO";
    else if (plan === "FREE" && status === 0 && code === TRIAL_PACKAGE_CODE) plan = "TRIAL";
  }
  const result = [];
  for (const group of Object.values(groups)) {
    if (group.total <= 0 && group.items === 0) continue;
    const total = group.hasUnknownTotal ? null : round2(group.total);
    const remain = group.hasUnknownRemain || total === null ? null : round2(Math.min(group.remain, total));
    const used = total === null || remain === null ? null : round2(Math.max(0, total - remain));
    result.push({
      id: group.id,
      items: group.items,
      total,
      remain,
      used,
      used_percent: total === null || used === null ? null : total > 0 ? round2((used / total) * 100) : 0,
    });
  }
  return { groups: result, plan };
}

function formatQuotaTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function postWorkbuddyBilling(auth, endpoint, body, { fetchImpl = fetch, timeoutMs = QUOTA_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    };
    if (auth.uid) headers["X-User-Id"] = auth.uid;
    if (auth.domain) headers["X-Domain"] = auth.domain;
    if (auth.enterpriseId) {
      headers["X-Enterprise-Id"] = auth.enterpriseId;
      headers["X-Tenant-Id"] = auth.enterpriseId;
    }
    const response = await fetchImpl(`${WORKBUDDY_BILLING_HOST}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`workbuddy billing HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const code = Number(payload?.code);
    if (code !== 0 && code !== 200) {
      throw new Error(`workbuddy billing code ${payload?.code}: ${payload?.message || "unknown"}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch + group the credit packages for the logged-in WorkBuddy account.
 * Shape: { signed_in, account?, plan?, groups?, fetched_at, error? }
 */
async function fetchWorkbuddyQuota({ env, home, platform, fetchImpl, now = new Date() } = {}) {
  const auth = readWorkbuddyAuth({ env, home, platform });
  if (!auth) {
    return { signed_in: false, error: null, fetched_at: new Date().toISOString() };
  }
  try {
    const rangeBegin = formatQuotaTimestamp(now);
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 101);
    const payload = await postWorkbuddyBilling(auth, "/v2/billing/meter/get-user-resource", {
      PageNumber: 1,
      PageSize: 100,
      ProductCode: "p_tcaca",
      Status: [0, 3],
      PackageEndTimeRangeBegin: rangeBegin,
      PackageEndTimeRangeEnd: formatQuotaTimestamp(end),
    }, { fetchImpl });
    const accounts = payload?.data?.Response?.Data?.Accounts;
    const { groups, plan } = groupWorkbuddyPackages(accounts);
    return {
      signed_in: true,
      plan,
      groups,
      fetched_at: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      signed_in: true,
      plan: null,
      groups: [],
      fetched_at: new Date().toISOString(),
      error: error?.status === 401 ? "unauthorized" : "fetch_failed",
    };
  }
}

module.exports = {
  resolveWorkbuddyAuthFile,
  readWorkbuddyAuth,
  groupWorkbuddyPackages,
  summarizeWorkbuddyQuota,
  advanceWorkbuddyDailyObservation,
  fetchWorkbuddyQuota,
};
