import { useEffect, useState } from "react";
import {
  getConsoleSessions,
  getTokenPlans,
  saveTokenPlan,
  syncCodexConsoleQuota,
  syncTraeConsoleQuota,
  verifyCursorConsoleSession,
} from "../lib/api";

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
        });
      }
      return;
    }
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status));
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
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status));
  }));
}

export async function refreshConnectedTraePlans(plans, sessions = []) {
  const traePlans = (Array.isArray(plans) ? plans : []).filter((plan) => (
    String(plan?.provider_id || "").toLowerCase() === "trae"
    && plan?.detection_method === "official_account"
    && plan?.detection_config?.official_account?.account_binding_id
  ));
  await Promise.allSettled(traePlans.map(async (plan) => {
    const sessionRef = resolveNativeSessionRef(plan, sessions);
    if (!sessionRef) return;
    const status = await syncTraeConsoleQuota(sessionRef);
    if (status?.state_code !== "connected" || !status?.quota) return;
    await saveTokenPlan(applyNativeQuotaToPlan(plan, status));
  }));
}

export function useTokenServicePlans(refreshRevision = 0) {
  const [state, setState] = useState({ plans: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    Promise.all([getTokenPlans(), getConsoleSessions().catch(() => ({ sessions: [] }))])
      .then(async ([result, sessionResult]) => {
        const initialPlans = Array.isArray(result?.records) ? result.records : [];
        const sessions = Array.isArray(sessionResult?.sessions) ? sessionResult.sessions : [];
        await Promise.all([
          refreshConnectedCodexPlans(initialPlans, sessions),
          refreshConnectedTraePlans(initialPlans, sessions),
          refreshConnectedCursorPlans(initialPlans, sessions),
        ]);
        const refreshed = await getTokenPlans();
        if (cancelled) return;
        setState({
          plans: Array.isArray(refreshed?.records) ? refreshed.records : initialPlans,
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
  }, [refreshRevision]);

  return state;
}
