import { useEffect, useState } from "react";
import {
  getConsoleSessions,
  getTokenPlans,
  saveTokenPlan,
  syncCodexConsoleQuota,
  syncTraeConsoleQuota,
  verifyCursorConsoleSession,
} from "../lib/api";

const TOKEN_PLANS_CHANGED_EVENT = "token-eyes:token-plans-changed";
const TOKEN_PLANS_CACHE_KEY = "token-eyes:token-service-plans:v1";
const CONNECTED_PLAN_REFRESH_TTL_MS = 60_000;

function readPlansCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOKEN_PLANS_CACHE_KEY) || "null");
    if (!Array.isArray(parsed?.records)) return null;
    return {
      records: parsed.records,
      lastConnectedRefreshAt: Number(parsed.lastConnectedRefreshAt || 0),
    };
  } catch {
    return null;
  }
}

function writePlansCache(records, lastConnectedRefreshAt) {
  if (typeof window === "undefined") return;
  try {
    const previous = readPlansCache();
    window.localStorage.setItem(TOKEN_PLANS_CACHE_KEY, JSON.stringify({
      records: Array.isArray(records) ? records : [],
      lastConnectedRefreshAt: Number(
        lastConnectedRefreshAt ?? previous?.lastConnectedRefreshAt ?? 0,
      ),
    }));
  } catch {
    // The native store remains the source of truth if browser storage is unavailable.
  }
}

function hasConnectedNativePlans(plans) {
  return (Array.isArray(plans) ? plans : []).some((plan) => {
    const provider = String(plan?.provider_id || "").toLowerCase();
    const official = plan?.detection_config?.official_account;
    return ["codex", "trae", "cursor"].includes(provider)
      && plan?.detection_method === "official_account"
      && Boolean(official?.session_ref || official?.account_binding_id);
  });
}

function resolveNativeSessionRef(plan, sessions) {
  const official = plan?.detection_config?.official_account || {};
  if (official.session_ref) return official.session_ref;
  const bindingId = official.account_binding_id;
  return (Array.isArray(sessions) ? sessions : []).find((session) => session?.id === bindingId)?.session_ref || "";
}

export function attachOfficialSessionLabels(plans, sessions = []) {
  const sessionsById = new Map();
  const sessionsByRef = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const displayName = String(session?.display_name || "").trim();
    if (!displayName) continue;
    if (session?.id) sessionsById.set(String(session.id), displayName);
    if (session?.session_ref) sessionsByRef.set(String(session.session_ref), displayName);
  }

  return (Array.isArray(plans) ? plans : []).map((plan) => {
    if (plan?.detection_method !== "official_account") return plan;
    const official = plan?.detection_config?.official_account || {};
    if (String(official.display_name || "").trim()) return plan;
    const displayName = sessionsById.get(String(official.account_binding_id || ""))
      || sessionsByRef.get(String(official.session_ref || ""));
    if (!displayName) return plan;
    return {
      ...plan,
      detection_config: {
        ...plan.detection_config,
        official_account: { ...official, display_name: displayName },
      },
    };
  });
}

function applyNativeQuotaToPlan(plan, status) {
  const now = new Date().toISOString();
  const providerId = String(plan?.provider_id || "").trim().toLowerCase();
  const nativeExpiry = status.quota.subscription_expires_at
    || status.quota.expires_at
    || "";
  const cursorReportedFields = ["total_quota", "used_quota", "remaining_quota", "quota_windows"]
    .filter((field) => Object.prototype.hasOwnProperty.call(status.quota, field)
      && status.quota[field] !== null
      && status.quota[field] !== undefined);
  return {
    ...plan,
    expires_at: providerId === "cursor" ? nativeExpiry : (nativeExpiry || plan.expires_at || ""),
    total_quota: Number(status.quota.total_quota || plan.total_quota || 0),
    used_quota: Number(status.quota.used_quota || 0),
    remaining_quota: Number(status.quota.remaining_quota || 0),
    quota_windows: status.quota.quota_windows || [],
    provider_reported_at: status.quota.provider_reported_at || status.quota.fetched_at || now,
    sync_status: "success",
    last_refresh_status: "success",
    last_refresh_at: now,
    last_synced_at: now,
    last_error_code: "",
    last_error_message: "",
    ...(providerId === "cursor" ? { provider_reported_fields: cursorReportedFields } : {}),
    detection_config: {
      ...plan.detection_config,
      official_account: {
        ...(plan.detection_config?.official_account || {}),
        // Persist session_ref only — never a global "current Cursor account".
        session_ref: status.session_ref
          || plan.detection_config?.official_account?.session_ref
          || "",
        account_id: status.quota.account_id
          || plan.detection_config?.official_account?.account_id
          || "",
        plan_name: status.quota.plan_name
          || plan.detection_config?.official_account?.plan_name
          || "",
        display_name: status.quota.account_label
          || plan.detection_config?.official_account?.display_name
          || "",
      },
    },
  };
}

export async function refreshConnectedCursorPlans(plans, sessions = []) {
  const cursorPlans = (Array.isArray(plans) ? plans : []).filter((plan) => (
    String(plan?.provider_id || "").toLowerCase() === "cursor"
    && plan?.detection_method === "official_account"
    && (
      plan?.detection_config?.official_account?.session_ref
      || plan?.detection_config?.official_account?.account_binding_id
    )
  ));
  await Promise.allSettled(cursorPlans.map(async (plan) => {
    const sessionRef = resolveNativeSessionRef(plan, sessions);
    if (!sessionRef) return;
    const status = await verifyCursorConsoleSession(sessionRef);
    if (status?.state_code !== "connected" || !status?.quota) {
      if (status?.state_code === "sync_failed" || status?.state_code === "reauth_required") {
        const now = new Date().toISOString();
        await saveTokenPlan({
          ...plan,
          sync_status: status.state_code === "reauth_required" ? "reauth_required" : "failed",
          last_refresh_status: "failed",
          last_refresh_at: now,
          last_sync_attempt_at: now,
          last_error_code: status.error_code || "SYNC_FAILED",
          last_error_message: status.error_message || "Cursor usage sync failed",
        }, { notify: false });
      }
      return;
    }
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status), { notify: false });
  }));
}

export async function refreshConnectedCodexPlans(plans, sessions = []) {
  const codexPlans = (Array.isArray(plans) ? plans : []).filter((plan) => (
    String(plan?.provider_id || "").toLowerCase() === "codex"
    && plan?.detection_method === "official_account"
    && (
      plan?.detection_config?.official_account?.session_ref
      || plan?.detection_config?.official_account?.account_binding_id
    )
  ));
  await Promise.allSettled(codexPlans.map(async (plan) => {
    const sessionRef = resolveNativeSessionRef(plan, sessions);
    if (!sessionRef) return;
    const status = await syncCodexConsoleQuota(sessionRef);
    if (status?.state_code !== "connected" || !status?.quota) return;
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status), { notify: false });
  }));
}

export async function refreshConnectedTraePlans(plans, sessions = []) {
  const traePlans = (Array.isArray(plans) ? plans : []).filter((plan) => (
    String(plan?.provider_id || "").toLowerCase() === "trae"
    && plan?.detection_method === "official_account"
    && (
      plan?.detection_config?.official_account?.session_ref
      || plan?.detection_config?.official_account?.account_binding_id
    )
  ));
  await Promise.allSettled(traePlans.map(async (plan) => {
    const sessionRef = resolveNativeSessionRef(plan, sessions);
    if (!sessionRef) return;
    const status = await syncTraeConsoleQuota(sessionRef);
    if (status?.state_code !== "connected" || !status?.quota) {
      // Auth file may exist while quota parse fails — never treat as connected 0 requests.
      if (status?.state_code === "sync_failed" || status?.state_code === "reauth_required") {
        const now = new Date().toISOString();
        await saveTokenPlan({
          ...plan,
          sync_status: status.state_code === "reauth_required" ? "reauth_required" : "failed",
          last_refresh_status: "failed",
          last_refresh_at: now,
          last_sync_attempt_at: now,
          last_error_code: status.error_code || "TRAE_QUOTA_FAILED",
          last_error_message: status.error_message || "TRAE quota sync failed",
        }, { notify: false });
      }
      return;
    }
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status), { notify: false });
  }));
}

export function useTokenServicePlans(refreshRevision = 0, { enabled = true } = {}) {
  const [state, setState] = useState(() => {
    const cached = readPlansCache();
    return {
      plans: cached?.records || [],
      loading: enabled && !cached,
      error: null,
    };
  });
  const [planRevision, setPlanRevision] = useState(0);

  useEffect(() => {
    const reload = () => setPlanRevision((value) => value + 1);
    window.addEventListener(TOKEN_PLANS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TOKEN_PLANS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState((current) => ({ ...current, loading: false, error: null }));
      return undefined;
    }

    let cancelled = false;
    const forceConnectedRefresh = refreshRevision > 0 || planRevision > 0;
    setState((current) => ({
      ...current,
      loading: current.plans.length === 0,
      error: null,
    }));

    getTokenPlans()
      .then(async (result) => {
        const initialPlans = Array.isArray(result?.records) ? result.records : [];
        if (!cancelled) {
          writePlansCache(initialPlans);
          setState({ plans: initialPlans, loading: false, error: null });
        }

        const hasConnectedPlans = hasConnectedNativePlans(initialPlans);
        const sessionsPromise = hasConnectedPlans
          ? getConsoleSessions().catch(() => ({ sessions: [] }))
          : null;
        if (sessionsPromise) {
          void sessionsPromise.then((sessionResult) => {
            if (cancelled) return;
            const sessions = Array.isArray(sessionResult?.sessions) ? sessionResult.sessions : [];
            setState((current) => {
              const plansWithAccountLabels = attachOfficialSessionLabels(current.plans, sessions);
              writePlansCache(plansWithAccountLabels);
              return { ...current, plans: plansWithAccountLabels };
            });
          });
        }

        const cached = readPlansCache();
        const shouldRefreshConnected = forceConnectedRefresh
          || Date.now() - Number(cached?.lastConnectedRefreshAt || 0) >= CONNECTED_PLAN_REFRESH_TTL_MS;
        if (!shouldRefreshConnected || !hasConnectedPlans || !sessionsPromise) return;

        const connectedRefreshStartedAt = Date.now();
        writePlansCache(initialPlans, connectedRefreshStartedAt);
        const sessionResult = await sessionsPromise;
        const sessions = Array.isArray(sessionResult?.sessions) ? sessionResult.sessions : [];
        await Promise.all([
          refreshConnectedCodexPlans(initialPlans, sessions),
          refreshConnectedTraePlans(initialPlans, sessions),
          refreshConnectedCursorPlans(initialPlans, sessions),
        ]);
        const refreshed = await getTokenPlans();
        if (cancelled) return;
        const refreshedPlans = attachOfficialSessionLabels(
          Array.isArray(refreshed?.records) ? refreshed.records : initialPlans,
          sessions,
        );
        writePlansCache(refreshedPlans, connectedRefreshStartedAt);
        setState({
          plans: refreshedPlans,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[SpendUsagePage] Failed to load Token services:", error);
        setState((current) => ({ ...current, loading: false, error }));
      });

    return () => { cancelled = true; };
  }, [refreshRevision, planRevision, enabled]);

  return state;
}
