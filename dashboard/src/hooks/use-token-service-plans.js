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

function applyNativeQuotaToPlan(plan, status) {
  const now = new Date().toISOString();
  return {
    ...plan,
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
    && plan?.detection_config?.official_account?.account_binding_id
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

export function useTokenServicePlans(refreshRevision = 0) {
  const [state, setState] = useState(() => {
    const cached = readPlansCache();
    return {
      plans: cached?.records || [],
      loading: !cached,
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

        const cached = readPlansCache();
        const shouldRefreshConnected = forceConnectedRefresh
          || Date.now() - Number(cached?.lastConnectedRefreshAt || 0) >= CONNECTED_PLAN_REFRESH_TTL_MS;
        if (!shouldRefreshConnected || !hasConnectedNativePlans(initialPlans)) return;

        const connectedRefreshStartedAt = Date.now();
        writePlansCache(initialPlans, connectedRefreshStartedAt);
        const sessionResult = await getConsoleSessions().catch(() => ({ sessions: [] }));
        const sessions = Array.isArray(sessionResult?.sessions) ? sessionResult.sessions : [];
        await Promise.all([
          refreshConnectedCodexPlans(initialPlans, sessions),
          refreshConnectedTraePlans(initialPlans, sessions),
          refreshConnectedCursorPlans(initialPlans, sessions),
        ]);
        const refreshed = await getTokenPlans();
        if (cancelled) return;
        const refreshedPlans = Array.isArray(refreshed?.records) ? refreshed.records : initialPlans;
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
  }, [refreshRevision, planRevision]);

  return state;
}
