"use strict";

/**
 * Token Plan auto refresh scheduler (TE-FULL-F03).
 *
 * 设计要点（见 docs/dev-notes/token-eyes-full-plan-interfaces.md#F02）:
 * - 后台调度只在本地进程存活时运行，不新增系统服务。
 * - 同一 plan 同一时刻只允许一个 refresh in-flight。
 * - refresh_method:
 *   - manual: 不自动刷新，保留手动录入。
 *   - official_api: 第一批没有可用 provider quota API 时，写 failed 状态。
 *   - cookie_scrape: 仅展示风险提示和未配置状态，不执行真实抓取。
 * - 不保存原始 token/cookie；credential_ref 只能保存引用名。
 * - 失败必须给用户可读错误，不能静默失败。
 */

const ALLOWED_INTERVALS = new Set([15, 30, 60, 240, 1440]);
const ALLOWED_METHODS = new Set(["manual", "official_api", "cookie_scrape"]);
const ALLOWED_CREDENTIAL_REFS = new Set([
  "codex_auth_json",
  "claude_credentials_json",
  "",
]);

// 可识别的 provider quota API 实现注册表（第一批为空）。
// provider adapter 返回 { total_quota, used_quota, remaining_quota }。
const PROVIDER_ADAPTERS = new Map();

function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(iso, minutes) {
  const base = iso ? new Date(iso) : new Date();
  if (Number.isFinite(minutes) && minutes > 0) {
    base.setUTCMinutes(base.getUTCMinutes() + Math.trunc(minutes));
  }
  return base.toISOString();
}

function isDue(plan, now = new Date()) {
  if (!plan || plan.refresh_enabled !== true) return false;
  if (plan.refresh_method === "manual") return false;
  const next = plan.next_refresh_at ? new Date(plan.next_refresh_at) : null;
  if (!next || Number.isNaN(next.getTime())) return true;
  return now.getTime() >= next.getTime();
}

function pickIntervalMinutes(value, fallback = 60) {
  const n = Number(value);
  if (Number.isFinite(n) && ALLOWED_INTERVALS.has(n)) return n;
  const fb = Number(fallback);
  return Number.isFinite(fb) && ALLOWED_INTERVALS.has(fb) ? fb : 60;
}

function pickMethod(value, fallback = "manual") {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOWED_METHODS.has(v)) return v;
  const fb = typeof fallback === "string" ? fallback.trim().toLowerCase() : "";
  return ALLOWED_METHODS.has(fb) ? fb : "manual";
}

function pickCredentialRef(value) {
  const v = typeof value === "string" ? value.trim() : "";
  // 只允许白名单引用名，避免保存任意字符串（更不允许原始 token/cookie）。
  return ALLOWED_CREDENTIAL_REFS.has(v) ? v : "";
}

/**
 * 把任意输入归一化成合法的 token plan 刷新配置/状态字段。
 * 与 MVP 字段合并使用；不覆盖 source/plan_label/total_quota 等。
 */
function normalizeRefreshFields(record, fallback = {}) {
  const input = record && typeof record === "object" ? record : {};
  const fallbackInput = fallback && typeof fallback === "object" ? fallback : {};
  const refreshEnabledRaw = input.refresh_enabled ?? fallbackInput.refresh_enabled;
  const refreshEnabled = refreshEnabledRaw === true || refreshEnabledRaw === "true";
  const interval = pickIntervalMinutes(
    input.refresh_interval_minutes ?? fallbackInput.refresh_interval_minutes,
    fallbackInput.refresh_interval_minutes,
  );
  const method = pickMethod(
    input.refresh_method ?? fallbackInput.refresh_method,
    fallbackInput.refresh_method || "manual",
  );
  const credentialRef = pickCredentialRef(
    input.credential_ref ?? fallbackInput.credential_ref,
  );
  const lastStatus = String(
    input.last_refresh_status ?? fallbackInput.last_refresh_status ?? "",
  ).trim().toLowerCase();
  const lastError = String(input.last_refresh_error ?? fallbackInput.last_refresh_error ?? "");
  const lastRefreshAt = String(input.last_refresh_at ?? fallbackInput.last_refresh_at ?? "").trim();
  const nextRefreshAt = String(input.next_refresh_at ?? fallbackInput.next_refresh_at ?? "").trim();
  return {
    refresh_enabled: refreshEnabled,
    refresh_interval_minutes: interval,
    refresh_method: method,
    credential_ref: credentialRef,
    last_refresh_status: lastStatus,
    last_refresh_error: lastError,
    last_refresh_at: lastRefreshAt,
    next_refresh_at: nextRefreshAt,
  };
}

/**
 * 为 plan 计算下一次 next_refresh_at。
 * manual 方法下不安排下次。
 */
function computeNextRefreshAt(plan, fromIso = nowIso()) {
  if (!plan) return "";
  if (plan.refresh_method === "manual" || plan.refresh_enabled !== true) return "";
  const interval = pickIntervalMinutes(plan.refresh_interval_minutes, 60);
  return addMinutesIso(fromIso, interval);
}

function ensureStatusFields(plan) {
  const base = normalizeRefreshFields(plan);
  // 初次落库时，next_refresh_at 可能为空——若启用且非 manual，补一个。
  if (plan && plan.refresh_enabled === true && plan.refresh_method !== "manual" && !base.next_refresh_at) {
    base.next_refresh_at = computeNextRefreshAt(plan, base.last_refresh_at || nowIso());
  }
  return base;
}

/**
 * 注册 provider quota adapter。第一批无内置 adapter。
 * adapter 签名: async (plan, { credentialRef }) => { total_quota, used_quota, remaining_quota }
 */
function registerProviderAdapter(source, adapter) {
  if (typeof source !== "string" || !source.trim()) return;
  if (typeof adapter !== "function") return;
  PROVIDER_ADAPTERS.set(source.trim().toLowerCase(), adapter);
}

function getProviderAdapter(source) {
  if (typeof source !== "string") return null;
  return PROVIDER_ADAPTERS.get(source.trim().toLowerCase()) || null;
}

/**
 * 执行单个 plan 的刷新。
 * 返回 { status, error, record }，其中 record 是合并了刷新结果的新 plan 记录
 * （不含 id/source/plan_label 等 MVP 字段，仅含刷新相关字段及可能的 quota 更新）。
 *
 * 调用方负责把返回的 record 写回 config 并更新 next_refresh_at。
 */
async function refreshPlan(plan, options = {}) {
  const opts = options || {};
  const now = opts.now || nowIso();
  if (!plan || !plan.id) {
    return {
      status: "failed",
      error: "Invalid plan: missing id",
      record: null,
    };
  }
  const method = pickMethod(plan.refresh_method, "manual");

  if (method === "manual") {
    // 手动方法不自动刷新，保留手动录入；视为 no-op 成功。
    return {
      status: "success",
      error: "",
      record: {
        ...plan,
        last_refresh_status: "success",
        last_refresh_error: "",
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
      },
    };
  }

  if (method === "cookie_scrape") {
    // 第一批不实现真实 cookie 抓取，只写未配置/风险状态。
    return {
      status: "failed",
      error:
        "Cookie 抓取未配置：当前版本不执行真实 Cookie 读取，存在账号风控风险。请改为手动录入或 official_api。",
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error:
          "Cookie 抓取未配置：当前版本不执行真实 Cookie 读取，存在账号风控风险。请改为手动录入或 official_api。",
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
      },
    };
  }

  // official_api
  const adapter = getProviderAdapter(plan.source);
  if (typeof adapter !== "function") {
    return {
      status: "failed",
      error:
        "不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。",
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error:
          "不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。",
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
      },
    };
  }

  try {
    const quota = await adapter(plan, { credentialRef: plan.credential_ref || "" });
    if (!quota || typeof quota !== "object") {
      throw new Error("provider adapter 返回非法数据");
    }
    const total = Number.isFinite(Number(quota.total_quota)) ? Number(quota.total_quota) : plan.total_quota;
    const used = Number.isFinite(Number(quota.used_quota)) ? Number(quota.used_quota) : plan.used_quota;
    const remaining = Number.isFinite(Number(quota.remaining_quota))
      ? Number(quota.remaining_quota)
      : plan.remaining_quota;
    return {
      status: "success",
      error: "",
      record: {
        ...plan,
        total_quota: total,
        used_quota: used,
        remaining_quota: remaining,
        last_refresh_status: "success",
        last_refresh_error: "",
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
      },
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return {
      status: "failed",
      error: msg,
      record: {
        ...plan,
        last_refresh_status: "failed",
        last_refresh_error: msg,
        last_refresh_at: now,
        next_refresh_at: computeNextRefreshAt(plan, now),
      },
    };
  }
}

/**
 * 创建一个本地进程内的调度器实例。
 * 依赖注入 readAll/upsertAll 回调，避免与具体存储耦合。
 *
 * readAll: () => Plan[]
 * upsertAll: (plans: Plan[]) => void  （整体写回，调用方负责读取/合并）
 *
 * 返回控制器：
 *   start(): 启动后台定时器（仅进程存活时有效）
 *   stop(): 停止
 *   runDueOnce(): 立即扫描并刷新所有 due plan（供 server 启动调用与测试）
 *   refreshById(id): 手动触发某个 plan 的刷新
 */
function createScheduler({ readAll, upsertAll, intervalMs = 60_000, logger = console } = {}) {
  if (typeof readAll !== "function" || typeof upsertAll !== "function") {
    throw new Error("createScheduler: readAll and upsertAll are required");
  }
  let timer = null;
  const inFlight = new Set();

  async function runDueOnce() {
    let plans;
    try {
      plans = readAll() || [];
    } catch (e) {
      logger.error?.(`[token-plan-refresh] readAll failed: ${e?.message || e}`);
      return { refreshed: 0 };
    }
    const now = new Date();
    const due = plans.filter((p) => isDue(p, now));
    let refreshed = 0;
    for (const plan of due) {
      if (inFlight.has(plan.id)) continue;
      inFlight.add(plan.id);
      try {
        const result = await refreshPlan(plan, { now: now.toISOString() });
        if (result.record) {
          const idx = plans.findIndex((p) => p.id === plan.id);
          if (idx >= 0) {
            plans[idx] = result.record;
            refreshed++;
          }
        }
      } catch (e) {
        logger.error?.(`[token-plan-refresh] refresh failed for ${plan.id}: ${e?.message || e}`);
      } finally {
        inFlight.delete(plan.id);
      }
    }
    if (refreshed > 0) {
      try {
        upsertAll(plans);
      } catch (e) {
        logger.error?.(`[token-plan-refresh] upsertAll failed: ${e?.message || e}`);
      }
    }
    return { refreshed };
  }

  async function refreshById(id) {
    let plans;
    try {
      plans = readAll() || [];
    } catch (e) {
      return { ok: false, error: `readAll failed: ${e?.message || e}` };
    }
    const idx = plans.findIndex((p) => String(p?.id || "") === String(id || ""));
    if (idx < 0) {
      return { ok: false, error: "plan not found", statusCode: 404 };
    }
    if (inFlight.has(id)) {
      return { ok: false, error: "refresh already in-flight", statusCode: 409 };
    }
    inFlight.add(id);
    try {
      const result = await refreshPlan(plans[idx], { now: nowIso() });
      if (result.record) {
        plans[idx] = result.record;
        try {
          upsertAll(plans);
        } catch (e) {
          return { ok: false, error: `upsertAll failed: ${e?.message || e}` };
        }
        return { ok: true, plan: result.record };
      }
      return { ok: false, error: result.error || "refresh failed" };
    } finally {
      inFlight.delete(id);
    }
  }

  function start() {
    if (timer) return;
    const period = Number.isFinite(intervalMs) && intervalMs > 1000 ? intervalMs : 60_000;
    timer = setInterval(() => {
      runDueOnce().catch((e) => {
        logger.error?.(`[token-plan-refresh] tick error: ${e?.message || e}`);
      });
    }, period);
    // Node 定时器不阻塞退出
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runDueOnce, refreshById };
}

module.exports = {
  ALLOWED_INTERVALS,
  ALLOWED_METHODS,
  ALLOWED_CREDENTIAL_REFS,
  normalizeRefreshFields,
  ensureStatusFields,
  computeNextRefreshAt,
  isDue,
  pickIntervalMinutes,
  pickMethod,
  pickCredentialRef,
  refreshPlan,
  registerProviderAdapter,
  getProviderAdapter,
  createScheduler,
  nowIso,
  addMinutesIso,
};
