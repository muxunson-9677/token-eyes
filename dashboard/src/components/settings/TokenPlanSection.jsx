import React, { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, X, Link2, CheckCircle2, AlertCircle, Clock, ShieldAlert } from "lucide-react";
import {
  getTokenPlans,
  saveTokenPlan,
  refreshTokenPlan,
  getUsageLimits,
  getTokenPlanCatalog,
  getConsoleSessions,
  createConsoleSession,
  deleteConsoleSession,
  verifyConsoleSession,
  openXiaomiMimoConsoleLogin,
  verifyXiaomiMimoConsoleSession,
  deleteXiaomiMimoConsoleSession,
  saveTokenPlanSecret,
} from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";

const AGENT_OPTIONS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "every-code", name: "Every Code" },
  { id: "cursor", name: "Cursor" },
  { id: "gemini", name: "Gemini CLI" },
  { id: "opencode", name: "OpenCode" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "kilo-cli", name: "Kilo CLI" },
  { id: "kilocode", name: "Kilo Code" },
  { id: "roocode", name: "Roo Code" },
  { id: "kiro", name: "Kiro" },
  { id: "kiro-cli", name: "Kiro CLI" },
  { id: "hermes", name: "Hermes Agent" },
  { id: "kimi", name: "Kimi" },
  { id: "kimi-code", name: "Kimi Code" },
  { id: "codebuddy", name: "CodeBuddy" },
  { id: "omp", name: "oh-my-pi" },
  { id: "pi", name: "pi" },
  { id: "craft", name: "Craft Agents" },
  { id: "grok", name: "Grok Build" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "zed", name: "Zed Agent" },
  { id: "goose", name: "Goose" },
  { id: "droid", name: "Droid" },
  { id: "antigravity", name: "Antigravity" },
];

function isCodexSource(source) {
  return String(source || "").trim().toLowerCase() === "codex";
}

function formatCodexReset(isoOrUnix) {
  const ts = typeof isoOrUnix === "number" ? isoOrUnix * 1000 : Date.parse(String(isoOrUnix));
  if (!Number.isFinite(ts)) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return copy("shared.time.now");
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatQuota(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat().format(Number.isFinite(n) ? n : 0);
}

const EMPTY_FORM = {
  id: "",
  source: "",
  provider_id: "custom",
  plan_id: "custom",
  plan_label: "",
  quota_kind: "manual",
  quota_unit: "tokens",
  total_quota: 0,
  total_quota_display: "",
  quota_catalog_version: "",
  quota_source: "manual",
  used_quota: 0,
  remaining_quota: 0,
  expires_at: "",
  refresh_enabled: false,
  refresh_interval_minutes: 60,
  refresh_method: "manual",
  credential_ref: "",
  // W03-R3B: detection fields per R3A contract
  detection_method: "",
  detection_config: {
    official_account: {
      provider_home_url: "",
      account_binding_id: "",
    },
    custom_api: {
      api_key_ref: "",
      api_format: "",
      request_url: "",
      official_url: "",
      method: "GET",
      response_mapping: {
        total_quota_path: "",
        used_quota_path: "",
        remaining_quota_path: "",
        expires_at_path: "",
      },
    },
  },
};

const REFRESH_INTERVAL_OPTIONS = [15, 30, 60, 240, 1440];
// W03E-R3E: cookie_scrape is removed from user-visible options. Historical
// records with refresh_method=cookie_scrape are normalized to "manual" at
// the editRecord boundary below; the backend keeps its legacy compatibility
// branch in src/lib/token-plan-refresh.js untouched.
const REFRESH_METHOD_OPTIONS = ["manual", "official_api"];
const LEGACY_REFRESH_METHODS = new Set(["manual", "official_api"]);
const XIAOMI_AUTH_POLL_MS = 1000;
const XIAOMI_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeRecords(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCatalog(value) {
  const providers = Array.isArray(value?.providers) ? value.providers : [];
  return providers.map((p) => ({
    id: String(p?.id || ""),
    name: String(p?.name || ""),
    plans: Array.isArray(p?.plans) ? p.plans : [],
  }));
}

export function TokenPlanSection() {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState("");
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [usageLimits, setUsageLimits] = useState(null);
  const [loadingUsageLimits, setLoadingUsageLimits] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [catalogError, setCatalogError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // W03C: Xiaomi MiMo console session state
  const [consoleSessions, setConsoleSessions] = useState([]);
  const [loadingConsoleSessions, setLoadingConsoleSessions] = useState(false);
  const [consoleSessionError, setConsoleSessionError] = useState("");
  const [connectingConsole, setConnectingConsole] = useState(false);

  // W03-R3D: API Key input lives in separate state — NEVER stored in form or
  // serialized into the plan record.  It is only sent once to the secrets
  // endpoint which returns an api_key_ref, and the ref is what gets saved.
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingCatalog(true);
    Promise.all([getTokenPlans(), getTokenPlanCatalog().catch((err) => {
      if (!cancelled) setCatalogError(err?.message || "");
      return { providers: [{ id: "custom", name: copy("settings.token_plan.custom_plan"), plans: [] }] };
    })])
      .then(([plansResult, catalogResult]) => {
        if (cancelled) return;
        setRecords(normalizeRecords(plansResult?.records));
        setCatalog(normalizeCatalog(catalogResult));
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("settings.token_plan.load_error"));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingCatalog(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hasCodexRecord = records.some((r) => isCodexSource(r.source));
    if (!hasCodexRecord || loading) return;

    let cancelled = false;
    setLoadingUsageLimits(true);
    getUsageLimits()
      .then((result) => {
        if (cancelled) return;
        setUsageLimits(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setUsageLimits({
          codex: {
            configured: true,
            error: err?.message || copy("settings.token_plan.codex_quota.error"),
          },
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingUsageLimits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [records, loading]);

  // W03C: Load console sessions
  useEffect(() => {
    let cancelled = false;
    setLoadingConsoleSessions(true);
    setConsoleSessionError("");
    getConsoleSessions()
      .then((result) => {
        if (cancelled) return;
        setConsoleSessions(Array.isArray(result?.sessions) ? result.sessions : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // "该功能仅桌面端支持" is expected in web/vite environment
        if (err?.message?.includes("桌面端")) {
          setConsoleSessions([]);
        } else {
          setConsoleSessionError(err?.message || "");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConsoleSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const xiaomiMimoSession = useMemo(() => {
    return consoleSessions.find((s) => s.provider_id === "xiaomi_mimo") || null;
  }, [consoleSessions]);

  const xiaomiMimoStatusLabel = useMemo(() => {
    if (!xiaomiMimoSession) return null;
    const statusLabels = {
      connected: copy("settings.token_plan.console_session.status_connected"),
      awaiting_verification: copy("settings.token_plan.console_session.status_awaiting_verification"),
      login_started: copy("settings.token_plan.console_session.status_login_started"),
      pending_login: copy("settings.token_plan.console_session.status_pending_login"),
      expired: copy("settings.token_plan.console_session.status_expired"),
      revoked: copy("settings.token_plan.console_session.status_revoked"),
      failed: copy("settings.token_plan.console_session.status_failed"),
    };
    return (
      statusLabels[xiaomiMimoSession.status] ||
      copy("settings.token_plan.console_session.status_failed")
    );
  }, [xiaomiMimoSession]);

  const xiaomiMimoStage = useMemo(() => {
    if (!xiaomiMimoSession) return "disconnected";
    if (xiaomiMimoSession.last_error_code === "DESKTOP_SESSION_NOT_VERIFIED") {
      return "desktop_not_verified";
    }
    switch (xiaomiMimoSession.status) {
      case "connected":
        return "connected";
      case "awaiting_verification":
      case "login_started":
        return "awaiting_verification";
      case "pending_login":
        return connectingConsole ? "login_started" : "awaiting_verification";
      case "expired":
      case "revoked":
      case "failed":
        return "failed";
      default:
        return "awaiting_verification";
    }
  }, [xiaomiMimoSession, connectingConsole]);

  const handleConnectXiaomiMimo = async () => {
    if (connectingConsole) return;
    setConsoleSessionError("");
    if (!form.source) {
      setConsoleSessionError(copy("settings.token_plan.console_session.source_required"));
      return;
    }

    setConnectingConsole(true);
    const resumableSession = xiaomiMimoSession && [
      "pending_login",
      "login_started",
      "awaiting_verification",
    ].includes(xiaomiMimoSession.status)
      ? xiaomiMimoSession
      : null;
    const sessionRef = resumableSession?.session_ref
      || `token-plan/xiaomi_mimo/session/${crypto.randomUUID()}`;
    let createdSession = resumableSession;
    let quotaReady = false;
    try {
      if (!createdSession && xiaomiMimoSession) {
        await deleteConsoleSession(xiaomiMimoSession.id);
        await deleteXiaomiMimoConsoleSession(xiaomiMimoSession.session_ref).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== xiaomiMimoSession.id));
      }

      if (!createdSession) {
        const created = await createConsoleSession({
          provider_id: "xiaomi_mimo",
          auth_kind: "official_console_session",
          display_name: copy("settings.token_plan.console_session.mimo_display_name"),
          session_ref: sessionRef,
        });
        createdSession = created.session;
        setConsoleSessions(Array.isArray(created.sessions) ? created.sessions : []);

        await openXiaomiMimoConsoleLogin(sessionRef);
      }

      const deadline = Date.now() + XIAOMI_AUTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const nativeStatus = await verifyXiaomiMimoConsoleSession(sessionRef);
        if (nativeStatus?.connected && nativeStatus?.quota) {
          quotaReady = true;
          const nativeResult = {
            connected: true,
            session_ref: nativeStatus.session_ref || sessionRef,
            state_code: "connected",
            error_code: "",
            error_message: "",
            quota: nativeStatus.quota,
          };
          const verified = await verifyConsoleSession(createdSession.id, nativeResult);
          const accountBindingId = verified.session?.id || createdSession.id;
          const now = new Date().toISOString();
          const saved = await saveTokenPlan({
            ...form,
            used_quota: Number(nativeStatus.quota.used_quota || 0),
            remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
            total_quota: Number(nativeStatus.quota.total_quota || form.total_quota || 0),
            expires_at: nativeStatus.quota.expires_at || form.expires_at || "",
            provider_reported_at: nativeStatus.quota.provider_reported_at || now,
            detection_method: "official_account",
            detection_config: {
              ...form.detection_config,
              official_account: {
                ...form.detection_config.official_account,
                account_binding_id: accountBindingId,
              },
            },
            sync_status: "success",
            last_synced_at: now,
            last_sync_attempt_at: now,
            last_error_code: "",
            last_error_message: "",
          });
          await deleteXiaomiMimoConsoleSession(sessionRef);
          setConsoleSessions((previous) => previous.map((session) =>
            session.id === accountBindingId ? verified.session : session
          ));
          setRecords(normalizeRecords(saved.records));
          setForm(EMPTY_FORM);
          setFormOpen(false);
          setSavedNotice(true);
          return;
        }

        if (nativeStatus?.state_code === "session_not_found") {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.window_closed"));
        }
        if (["unsupported", "failed"].includes(nativeStatus?.state_code)) {
          throw new Error(nativeStatus.error_message || copy("settings.token_plan.console_session.verify_error"));
        }
        await wait(XIAOMI_AUTH_POLL_MS);
      }
      throw new Error(copy("settings.token_plan.console_session.timeout"));
    } catch (err) {
      if (createdSession && !quotaReady) {
        await deleteXiaomiMimoConsoleSession(sessionRef).catch(() => {});
        await deleteConsoleSession(createdSession.id).catch(() => {});
        setConsoleSessions((previous) => previous.filter((session) => session.id !== createdSession.id));
      }
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.connect_error"));
    } finally {
      setConnectingConsole(false);
    }
  };

  const handleDeleteConsoleSession = async (sessionId, sessionRef) => {
    try {
      await deleteConsoleSession(sessionId);
      try {
        await deleteXiaomiMimoConsoleSession(sessionRef);
      } catch {
        // Native session may already be gone; ignore.
      }
      setConsoleSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setConsoleSessionError(err?.message || copy("settings.token_plan.console_session.delete_error"));
    }
  };

  const quotaSummary = useMemo(() => records.reduce(
    (acc, record) => ({
      total: acc.total + Number(record.total_quota || 0),
      used: acc.used + Number(record.used_quota || 0),
      remaining: acc.remaining + Number(record.remaining_quota || 0),
    }),
    { total: 0, used: 0, remaining: 0 },
  ), [records]);

  const currentProvider = useMemo(() => {
    return catalog.find((p) => p.id === form.provider_id) || null;
  }, [catalog, form.provider_id]);

  const planOptions = useMemo(() => {
    const plans = currentProvider?.plans || [];
    const opts = plans.map((p) => ({ value: p.plan_id, label: p.display_name }));
    if (form.provider_id === "custom") {
      opts.push({ value: "custom", label: copy("settings.token_plan.custom_plan") });
    }
    return opts;
  }, [currentProvider, form.provider_id]);

  const selectedPlan = useMemo(() => {
    if (form.provider_id === "custom" || form.plan_id === "custom") return null;
    return currentProvider?.plans?.find((p) => p.plan_id === form.plan_id) || null;
  }, [currentProvider, form.provider_id, form.plan_id]);

  const isCatalogPlan = form.provider_id !== "custom" && form.plan_id !== "custom" && selectedPlan;
  const isManual = form.provider_id === "custom" || form.plan_id === "custom";
  const isManualOnlyProvider = form.provider_id === "xiaomi_mimo" && isCatalogPlan;
  // W03-R3D: When a detection method is configured, disable manual quota entry.
  // Detection is the primary path — used_quota/remaining_quota/expires_at come from the detection source.
  const hasDetectionConfigured = form.detection_method && form.detection_method !== "not_configured";

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => {
      const next = {
        ...current,
        [field]: ["total_quota", "used_quota", "remaining_quota", "refresh_interval_minutes"].includes(field)
          ? Number(value || 0)
          : value,
      };
      if (field === "provider_id") {
        next.plan_id = value === "custom" ? "custom" : "";
        next.plan_label = "";
        next.quota_kind = "manual";
        next.quota_unit = "tokens";
        next.total_quota = 0;
        next.total_quota_display = "";
        next.quota_catalog_version = "";
        next.quota_source = "manual";
        // W03-R3B: reset detection fields when provider changes
        next.detection_method = "";
        next.detection_config = { ...EMPTY_FORM.detection_config };
        // W03-R3D: reset API Key input when provider changes
        setApiKeyInput("");
      }
      if (field === "plan_id") {
        const provider = catalog.find((p) => p.id === current.provider_id);
        const plan = provider?.plans?.find((p) => p.plan_id === value);
        if (plan) {
          next.plan_label = plan.display_name;
          next.quota_kind = plan.quota_kind || "unknown";
          next.quota_unit = plan.quota_unit || "tokens";
          next.total_quota = Number(plan.total_quota || 0);
          next.total_quota_display = plan.total_quota_display || "";
          next.quota_catalog_version = "";
          next.quota_source = "catalog";
          // W03-R3B: pre-fill provider_home_url for catalog plans
          if (current.provider_id === "xiaomi_mimo") {
            next.detection_config = {
              ...next.detection_config,
              official_account: {
                ...next.detection_config.official_account,
                provider_home_url: "https://platform.xiaomimimo.com/token-plan",
              },
            };
          }
        } else {
          next.plan_label = current.plan_label;
          next.quota_kind = "manual";
          next.quota_unit = "tokens";
          next.quota_source = "manual";
        }
      }
      return next;
    });
    setSavedNotice(false);
  };

  const updateCheckbox = (field) => (event) => {
    const checked = event.target.checked;
    setForm((current) => ({
      ...current,
      [field]: checked,
    }));
    setSavedNotice(false);
  };

  // W03-R3B: detection method selector
  const updateDetectionMethod = (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_method: value,
    }));
    setSavedNotice(false);
  };

  // W03-R3C: update nested custom_api detection config fields
  const updateCustomApiField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_config: {
        ...current.detection_config,
        custom_api: {
          ...(current.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
          [field]: value,
        },
      },
    }));
    setSavedNotice(false);
  };

  const updateCustomApiMappingField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      detection_config: {
        ...current.detection_config,
        custom_api: {
          ...(current.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
          response_mapping: {
            ...(current.detection_config?.custom_api?.response_mapping || EMPTY_FORM.detection_config.custom_api.response_mapping),
            [field]: value,
          },
        },
      },
    }));
    setSavedNotice(false);
  };

  const openNewForm = () => {
    setForm(EMPTY_FORM);
    setApiKeyInput("");
    setFormOpen(true);
    setSavedNotice(false);
    setError("");
  };

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setApiKeyInput("");
    setFormOpen(false);
    setSavedNotice(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      // W03-R3D P0: If the user entered an API Key and detection_method is
      // custom_api, save the secret first via the secrets endpoint to get
      // an api_key_ref.  The api_key_ref is what gets persisted — the raw
      // API Key is never stored in config.json or the plan record.
      //
      // W03-R3D P1 fix: ALWAYS save when the user typed a new key, even if
      // an old api_key_ref already exists.  The in-memory credential store
      // is volatile — after a server restart the old ref is stale and the
      // user MUST be able to re-enter / rotate the key.  Only when the
      // input is empty do we fall back to the existing ref (preserve it).
      let apiKeyRef = form.detection_config?.custom_api?.api_key_ref || "";
      if (form.detection_method === "custom_api" && apiKeyInput.trim()) {
        const secretResult = await saveTokenPlanSecret({
          provider_id: form.provider_id || "xiaomi_mimo",
          purpose: "custom-api",
          secret: apiKeyInput.trim(),
        });
        if (!secretResult?.ok || !secretResult?.api_key_ref) {
          throw new Error(
            secretResult?.error || copy("settings.token_plan.secret_save_error"),
          );
        }
        apiKeyRef = secretResult.api_key_ref;
      }

      // W03-R3B: build save payload with R3A contract detection fields.
      // Never send API key / cookie / authorization in the plan record.
      const payload = {
        ...form,
        // Strip forbidden fields per R3A contract
        api_key: undefined,
        apiKey: undefined,
        cookie: undefined,
        authorization: undefined,
        authorization_header: undefined,
        bearer: undefined,
        token: undefined,
        password: undefined,
      };
      // Only include detection_config if detection_method is set
      if (!payload.detection_method) {
        delete payload.detection_config;
      } else if (payload.detection_method === "custom_api" && apiKeyRef) {
        // W03-R3D: Write the api_key_ref into the detection config
        payload.detection_config = {
          ...payload.detection_config,
          custom_api: {
            ...(payload.detection_config?.custom_api || EMPTY_FORM.detection_config.custom_api),
            api_key_ref: apiKeyRef,
          },
        };
      }
      const result = await saveTokenPlan(payload);
      setRecords(normalizeRecords(result?.records));
      setForm(EMPTY_FORM);
      setApiKeyInput("");
      setFormOpen(false);
      setSavedNotice(true);
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async (id) => {
    setRefreshingId(id);
    setError("");
    try {
      // For xiaomi_mimo plans with official_account detection and a
      // connected console session, fetch fresh quota via the Tauri
      // bridge (same-session WebView) before calling the backend refresh.
      const plan = records.find((r) => r.id === id);
      if (
        plan &&
        plan.provider_id === "xiaomi_mimo" &&
        plan.detection_method === "official_account" &&
        xiaomiMimoSession &&
        xiaomiMimoSession.status === "connected" &&
        xiaomiMimoSession.session_ref
      ) {
        try {
          const nativeStatus = await verifyXiaomiMimoConsoleSession(
            xiaomiMimoSession.session_ref
          );
          if (nativeStatus?.quota) {
            // Update the plan directly with fresh quota from the native bridge
            await saveTokenPlan({
              ...plan,
              used_quota: Number(nativeStatus.quota.used_quota || 0),
              remaining_quota: Number(nativeStatus.quota.remaining_quota || 0),
              total_quota: Number(nativeStatus.quota.total_quota || plan.total_quota),
              expires_at: nativeStatus.quota.expires_at || plan.expires_at || "",
              sync_status: "success",
              last_synced_at: new Date().toISOString(),
              last_sync_attempt_at: new Date().toISOString(),
              last_error_code: "",
              last_error_message: "",
              last_refresh_status: "success",
              last_refresh_error: "",
              last_refresh_at: new Date().toISOString(),
            });
            // Re-fetch records to reflect the update
            const plansResult = await getTokenPlans();
            setRecords(normalizeRecords(plansResult?.records));
            setRefreshingId("");
            return;
          }
        } catch (_) {
          // Native fetch failed; fall through to backend refresh
        }
      }
      // Standard backend refresh path
      const result = await refreshTokenPlan(id);
      setRecords(normalizeRecords(result?.records));
      const refreshedPlan = result?.plan;
      if (refreshedPlan?.last_refresh_status === "failed") {
        setError(refreshedPlan?.last_refresh_error || copy("settings.token_plan.refresh_failed"));
      }
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.refresh_failed"));
    } finally {
      setRefreshingId("");
    }
  };

  const editRecord = (record) => {
    const isLegacy = !record.provider_id;
    // W03E-R3E: Normalize legacy refresh_method=cookie_scrape to "manual" at
    // the record→form boundary. cookie_scrape is no longer a user-selectable
    // path; the backend keeps its legacy read/reject branch, but editing an
    // old record must never re-save cookie_scrape or show an invalid select
    // value. This is the single normalization point — render branches do not
    // need to repeat this check.
    const rawRefreshMethod = record.refresh_method || "manual";
    const normalizedRefreshMethod = LEGACY_REFRESH_METHODS.has(rawRefreshMethod)
      ? rawRefreshMethod
      : "manual";
    // W03-R3B: preserve detection fields from existing records
    const detectionConfig = record.detection_config
      ? {
          official_account: {
            provider_home_url: record.detection_config?.official_account?.provider_home_url || "",
            account_binding_id: record.detection_config?.official_account?.account_binding_id || "",
          },
          custom_api: {
            api_key_ref: record.detection_config?.custom_api?.api_key_ref || "",
            api_format: record.detection_config?.custom_api?.api_format || "",
            request_url: record.detection_config?.custom_api?.request_url || "",
            official_url: record.detection_config?.custom_api?.official_url || "",
            method: record.detection_config?.custom_api?.method || "GET",
            response_mapping: {
              total_quota_path: record.detection_config?.custom_api?.response_mapping?.total_quota_path || "",
              used_quota_path: record.detection_config?.custom_api?.response_mapping?.used_quota_path || "",
              remaining_quota_path: record.detection_config?.custom_api?.response_mapping?.remaining_quota_path || "",
              expires_at_path: record.detection_config?.custom_api?.response_mapping?.expires_at_path || "",
            },
          },
        }
      : { ...EMPTY_FORM.detection_config };
    setForm({
      ...EMPTY_FORM,
      ...record,
      provider_id: isLegacy ? "custom" : record.provider_id,
      plan_id: isLegacy ? "custom" : record.plan_id,
      quota_source: isLegacy ? "manual" : (record.quota_source || "manual"),
      // W03E-R3E: override refresh_method after spread so legacy cookie_scrape
      // is normalized before it reaches the form state / select value.
      refresh_method: normalizedRefreshMethod,
      detection_method: record.detection_method || "",
      detection_config: detectionConfig,
    });
    // W03-R3D: Never pre-fill the API Key field — it must be re-entered.
    // The api_key_ref is preserved in detection_config for existing records.
    setApiKeyInput("");
    setFormOpen(true);
    setSavedNotice(false);
    setError("");
  };

  const canSave = formOpen && !loading && !saving && form.source.trim() && form.plan_label.trim();

  const showEmptyCatalog = formOpen &&
    form.provider_id !== "custom" &&
    form.provider_id &&
    currentProvider &&
    currentProvider.plans.length === 0;

  const displayTotalQuota = useMemo(() => {
    if (isCatalogPlan) {
      return selectedPlan.total_quota_display || formatQuota(selectedPlan.total_quota);
    }
    if (form.quota_kind === "unknown") {
      return copy("settings.token_plan.unknown_quota");
    }
    return formatQuota(form.total_quota);
  }, [isCatalogPlan, selectedPlan, form.quota_kind, form.total_quota]);

  return (
    <SectionCard
      title={copy("settings.section.token_plan")}
      subtitle={copy("settings.token_plan.subtitle")}
      action={
        <button
          type="button"
          onClick={openNewForm}
          disabled={loading || saving}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {copy("settings.token_plan.add")}
        </button>
      }
    >
      {records.length !== 0 && (
        <div className="mb-3 grid gap-2 border-y border-oai-gray-200 py-3 text-xs dark:border-oai-gray-800 sm:grid-cols-3">
          <SummaryMetric label={copy("settings.token_plan.total_quota")} value={formatQuota(quotaSummary.total)} />
          <SummaryMetric label={copy("settings.token_plan.used_quota")} value={formatQuota(quotaSummary.used)} />
          <SummaryMetric label={copy("settings.token_plan.remaining_quota")} value={formatQuota(quotaSummary.remaining)} />
        </div>
      )}

      <div className="border-b border-oai-gray-200 pb-3 dark:border-oai-gray-800">
        {records.length === 0 ? (
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.token_plan.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <div key={record.id} className="rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                      {record.provider_id && record.provider_id !== "custom"
                        ? `${record.source} / ${record.provider_id} / ${record.plan_label}`
                        : `${record.source} / ${record.plan_label}`}
                    </div>
                    <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {formatQuota(record.used_quota)} / {formatQuota(record.total_quota)} - {formatQuota(record.remaining_quota)} {copy("settings.token_plan.remaining")}
                      {record.quota_unit && record.quota_unit !== "tokens" ? ` ${record.quota_unit}` : ""}
                      {record.expires_at ? ` · ${copy("settings.token_plan.expires_at")} ${record.expires_at}` : ""}
                    </div>
                    <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                      {record.quota_source
                        ? ` · ${record.quota_source === "catalog"
                          ? copy("settings.token_plan.quota_source_catalog")
                          : record.quota_source === "custom_api"
                          ? copy("settings.token_plan.quota_source_custom_api")
                          : copy("settings.token_plan.quota_source_manual")}`
                        : ""}
                    </div>
                    {/* W03-R3D: Unified detection/sync status display for both official_account and custom_api */}
                    <RecordSyncStatus record={record} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => refresh(record.id)}
                      disabled={refreshingId === record.id}
                      title={copy("settings.token_plan.refresh")}
                      className="text-xs font-medium text-oai-gray-600 hover:text-oai-brand dark:text-oai-gray-300 disabled:opacity-50"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", refreshingId === record.id && "animate-spin")} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => editRecord(record)}
                      className="shrink-0 text-xs font-medium text-oai-brand hover:text-oai-brand-dark"
                    >
                      {copy("settings.token_plan.edit")}
                    </button>
                  </div>
                </div>
                {isCodexSource(record.source) && (
                  <CodexQuotaBlock codexData={usageLimits?.codex} loading={loadingUsageLimits} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-3 dark:border-oai-gray-800">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {form.id ? copy("settings.token_plan.form_title_edit") : copy("settings.token_plan.form_title_new")}
            </div>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-oai-gray-500 hover:bg-oai-gray-100 hover:text-oai-gray-900 disabled:opacity-50 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-100"
              aria-label={copy("settings.token_plan.cancel")}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectInput
              label={copy("settings.token_plan.agent_source")}
              value={form.source}
              onChange={updateField("source")}
              disabled={loading || saving}
              options={[{ value: "", label: "" }, ...AGENT_OPTIONS.map((a) => ({ value: a.id, label: a.name }))]}
            />
            <SelectInput
              label={copy("settings.token_plan.provider")}
              value={form.provider_id}
              onChange={updateField("provider_id")}
              disabled={loading || saving || loadingCatalog}
              options={[{ value: "", label: "" }, ...catalog.map((p) => ({ value: p.id, label: p.name }))]}
            />
            <SelectInput
              label={copy("settings.token_plan.plan")}
              value={form.plan_id}
              onChange={updateField("plan_id")}
              disabled={loading || saving || !form.provider_id}
              options={[{ value: "", label: "" }, ...planOptions]}
            />
            {isManual && (
              <TextInput
                label={copy("settings.token_plan.plan_label")}
                value={form.plan_label}
                onChange={updateField("plan_label")}
                disabled={loading || saving}
              />
            )}
            <NumberInput
              label={copy("settings.token_plan.total_quota")}
              value={form.total_quota}
              onChange={updateField("total_quota")}
              disabled={loading || saving || isCatalogPlan}
            />
            <NumberInput
              label={copy("settings.token_plan.used_quota")}
              value={form.used_quota}
              onChange={updateField("used_quota")}
              disabled={loading || saving || hasDetectionConfigured}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            <NumberInput
              label={copy("settings.token_plan.remaining_quota")}
              value={form.remaining_quota}
              onChange={updateField("remaining_quota")}
              disabled={loading || saving || hasDetectionConfigured}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            <TextInput
              label={copy("settings.token_plan.expires_at")}
              value={form.expires_at}
              onChange={updateField("expires_at")}
              disabled={loading || saving || hasDetectionConfigured}
              placeholder={hasDetectionConfigured ? "" : "2026-12-31"}
              hint={hasDetectionConfigured ? copy("settings.token_plan.quota_from_detection") : undefined}
            />
            {!isManualOnlyProvider && (
              <SelectInput
                label={copy("settings.token_plan.refresh_method")}
                value={form.refresh_method}
                onChange={updateField("refresh_method")}
                disabled={loading || saving}
                options={REFRESH_METHOD_OPTIONS.map((m) => ({ value: m, label: copy(`settings.token_plan.refresh_method.${m}`) }))}
              />
            )}
            {!isManualOnlyProvider && (
              <SelectInput
                label={copy("settings.token_plan.refresh_interval")}
                value={String(form.refresh_interval_minutes)}
                onChange={updateField("refresh_interval_minutes")}
                disabled={loading || saving}
                options={REFRESH_INTERVAL_OPTIONS.map((n) => ({ value: String(n), label: `${n} min` }))}
              />
            )}
            {!isManualOnlyProvider && (
              <TextInput
                label={copy("settings.token_plan.credential_ref")}
                value={form.credential_ref}
                onChange={updateField("credential_ref")}
                disabled={loading || saving}
                placeholder="codex_auth_json"
              />
            )}
            {!isManualOnlyProvider && (
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(form.refresh_enabled)}
                  onChange={updateCheckbox("refresh_enabled")}
                  disabled={loading || saving}
                  className="h-4 w-4 rounded border-oai-gray-300 text-oai-brand-600 focus:ring-oai-brand-500"
                />
                <span className="text-xs text-oai-gray-700 dark:text-oai-gray-300">
                  {copy("settings.token_plan.refresh_enabled")}
                </span>
              </label>
            )}
            {isManualOnlyProvider && (
              <div className="sm:col-span-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("settings.token_plan.manual_only_notice")}
              </div>
            )}
          </div>

          {/* W03-R3B: Detection method section — only for xiaomi_mimo catalog plans */}
          {form.provider_id === "xiaomi_mimo" && isCatalogPlan && (
            <div className="mt-4 border-t border-oai-gray-200 pt-3 dark:border-oai-gray-800">
              <div className="mb-2 text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                {copy("settings.token_plan.detection_method.label")}
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                <SelectInput
                  label={copy("settings.token_plan.detection_method.select")}
                  value={form.detection_method}
                  onChange={updateDetectionMethod}
                  disabled={loading || saving}
                  options={[
                    { value: "", label: copy("settings.token_plan.detection_method.none") },
                    { value: "official_account", label: copy("settings.token_plan.detection_method.official_account") },
                    { value: "custom_api", label: copy("settings.token_plan.detection_method.custom_api") },
                  ]}
                />
              </div>

              {/* Official account detection: console session connect inside the form */}
              {form.detection_method === "official_account" && (
                <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                  <div className="mb-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.official_account.title")}
                  </div>
                  <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("settings.token_plan.detection.official_account.desc")}
                  </div>
                  <div className="mt-1 text-xs text-oai-gray-400 dark:text-oai-gray-500">
                    {copy("settings.token_plan.detection.official_account.url_label")}:{" "}
                    {copy("settings.token_plan.detection.official_account.url_value")}
                  </div>
                  {consoleSessionError && (
                    <div className="mt-2 text-xs text-red-500 dark:text-red-400">
                      {consoleSessionError}
                    </div>
                  )}
                  {loadingConsoleSessions ? (
                    <div className="mt-2 text-xs text-oai-gray-500">
                      {copy("settings.token_plan.console_session.loading")}
                    </div>
                  ) : xiaomiMimoStage === "disconnected" ? (
                    <div className="mt-2 space-y-2">
                      <button
                        type="button"
                        onClick={handleConnectXiaomiMimo}
                        disabled={connectingConsole}
                        data-testid="detection-connect-xiaomi"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                          "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                        )}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        {connectingConsole
                          ? copy("settings.token_plan.console_session.connecting")
                          : copy("settings.token_plan.detection.official_account.connect")}
                      </button>
                    </div>
                  ) : xiaomiMimoStage === "login_started" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-login-started">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                        <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                          {copy("settings.token_plan.console_session.status_login_started")}
                        </div>
                      </div>
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.console_session.login_started_desc")}
                      </div>
                    </div>
                  ) : xiaomiMimoStage === "awaiting_verification" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-awaiting-verification">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
                        <div>
                          <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                            {xiaomiMimoSession?.display_name}
                          </div>
                          <div className="text-xs text-amber-600 dark:text-amber-300">
                            {copy("settings.token_plan.console_session.status_awaiting_verification")}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("settings.token_plan.console_session.awaiting_verification_desc")}
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectXiaomiMimo}
                        disabled={connectingConsole}
                        data-testid="detection-resume"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                          "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                        )}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        {copy("settings.token_plan.console_session.retry")}
                      </button>
                    </div>
                  ) : xiaomiMimoStage === "failed" || xiaomiMimoStage === "desktop_not_verified" ? (
                    <div className="mt-2 space-y-2" data-testid="detection-failed">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-red-500" aria-hidden />
                        <div>
                          <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                            {xiaomiMimoSession?.display_name}
                          </div>
                          <div className="text-xs text-red-500 dark:text-red-400">
                            {xiaomiMimoStatusLabel}
                          </div>
                          {xiaomiMimoSession?.last_error_message && (
                            <div className="text-xs text-red-500 dark:text-red-400">
                              {xiaomiMimoSession.last_error_message}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleConnectXiaomiMimo}
                          disabled={connectingConsole}
                          data-testid="detection-retry"
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          {copy("settings.token_plan.console_session.retry")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2" data-testid="detection-connected">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />
                          <div>
                            <div className="text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                              {xiaomiMimoSession?.display_name}
                            </div>
                            <div className="text-xs text-green-600 dark:text-green-300">
                              {xiaomiMimoStatusLabel}
                            </div>
                            {xiaomiMimoSession?.last_verified_at && (
                              <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                                {copy("settings.token_plan.console_session.last_verified")}:{" "}
                                {new Date(xiaomiMimoSession.last_verified_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* W03-R3C: Custom API detection config */}
              {form.detection_method === "custom_api" && (
                <div className="mt-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                  <div className="mb-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.custom_api.title")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.api_key")}
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                        setSavedNotice(false);
                      }}
                      disabled={loading || saving}
                      placeholder="sk-..."
                    />
                    <SelectInput
                      label={copy("settings.token_plan.detection.custom_api.api_format")}
                      value={form.detection_config?.custom_api?.api_format || "json_path"}
                      onChange={updateCustomApiField("api_format")}
                      disabled={loading || saving}
                      options={[
                        { value: "json_path", label: "JSON Path" },
                        { value: "openai_compatible", label: "OpenAI Compatible" },
                        { value: "custom_mapping", label: copy("settings.token_plan.detection.custom_api.custom_mapping") },
                      ]}
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.request_url")}
                      value={form.detection_config?.custom_api?.request_url || ""}
                      onChange={updateCustomApiField("request_url")}
                      disabled={loading || saving}
                      placeholder="https://api.example.com/v1/quota"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.official_url")}
                      value={form.detection_config?.custom_api?.official_url || ""}
                      onChange={updateCustomApiField("official_url")}
                      disabled={loading || saving}
                      placeholder="https://platform.example.com/token-plan"
                    />
                    <SelectInput
                      label={copy("settings.token_plan.detection.custom_api.method")}
                      value={form.detection_config?.custom_api?.method || "GET"}
                      onChange={updateCustomApiField("method")}
                      disabled={loading || saving}
                      options={[
                        { value: "GET", label: "GET" },
                        { value: "POST", label: "POST" },
                      ]}
                    />
                  </div>
                  <div className="mt-3 mb-1 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                    {copy("settings.token_plan.detection.custom_api.response_mapping")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.total_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.total_quota_path || ""}
                      onChange={updateCustomApiMappingField("total_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.total"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.used_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.used_quota_path || ""}
                      onChange={updateCustomApiMappingField("used_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.used"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.remaining_quota_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.remaining_quota_path || ""}
                      onChange={updateCustomApiMappingField("remaining_quota_path")}
                      disabled={loading || saving}
                      placeholder="$.data.remaining"
                    />
                    <TextInput
                      label={copy("settings.token_plan.detection.custom_api.expires_at_path")}
                      value={form.detection_config?.custom_api?.response_mapping?.expires_at_path || ""}
                      onChange={updateCustomApiMappingField("expires_at_path")}
                      disabled={loading || saving}
                      placeholder="$.data.expires_at"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isCatalogPlan && (
            <div className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.token_plan.total_quota")}: <span>{displayTotalQuota}</span>
            </div>
          )}
          {showEmptyCatalog && (
            <div className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.token_plan.empty_catalog")}
            </div>
          )}
          {catalogError && formOpen && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
              {catalogError}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-700 hover:bg-oai-gray-100 disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            >
              {copy("settings.token_plan.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
                "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
                "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
              )}
            >
              <Save className="h-3.5 w-3.5" aria-hidden />
              {saving ? copy("settings.token_plan.saving") : copy("settings.token_plan.save")}
            </button>
          </div>
        </div>
      )}

      {(error || savedNotice) && (
        <div className="pt-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">{copy("settings.token_plan.saved")}</span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// W03-R3D: Unified sync status display for both detection methods
function RecordSyncStatus({ record }) {
  if (!record) return null;

  const hasDetection = record.detection_method && record.detection_method !== "not_configured";
  const syncStatus = record.sync_status || "not_configured";

  // No detection method selected: prompt user
  if (!hasDetection) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-oai-gray-400 dark:text-oai-gray-500">
        <Clock className="h-3 w-3" aria-hidden />
        <span>{copy("settings.token_plan.no_detection_prompt")}</span>
      </div>
    );
  }

  // Build status display
  const statusLabel = copy(`settings.token_plan.sync_status.${syncStatus}`) || syncStatus;
  const detectionLabel = record.detection_method === "official_account"
    ? copy("settings.token_plan.detection_method.official_account")
    : copy("settings.token_plan.detection_method.custom_api");

  const isSuccess = syncStatus === "success";
  const isFailed = syncStatus === "failed" || syncStatus === "reauth_required" || syncStatus === "unsupported";
  const isSyncing = syncStatus === "syncing";
  const isPending = syncStatus === "auth_required" || syncStatus === "not_configured";

  const lastSynced = record.last_synced_at
    ? new Date(record.last_synced_at).toLocaleString()
    : null;
  const lastAttempt = record.last_sync_attempt_at
    ? new Date(record.last_sync_attempt_at).toLocaleString()
    : null;
  const errorMsg = record.last_error_message || "";
  const errorCode = record.last_error_code || "";

  return (
    <div className="mt-1 space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-oai-gray-400 dark:text-oai-gray-500">
          {copy("settings.token_plan.detection_method_label")}: {detectionLabel}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-1 py-px font-medium",
            isSuccess && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
            isFailed && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
            isSyncing && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
            isPending && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
          )}
        >
          {isSuccess && <CheckCircle2 className="h-3 w-3" aria-hidden />}
          {isFailed && <ShieldAlert className="h-3 w-3" aria-hidden />}
          {isSyncing && <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />}
          {isPending && <AlertCircle className="h-3 w-3" aria-hidden />}
          {copy("settings.token_plan.sync_status_label")}: {statusLabel}
        </span>
      </div>
      {/* Last sync time */}
      {(lastSynced || lastAttempt) && (
        <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
          {lastSynced && (
            <span>{copy("settings.token_plan.last_synced_at")}: {lastSynced}</span>
          )}
          {!lastSynced && lastAttempt && (
            <span>{copy("settings.token_plan.last_synced_at")}: --</span>
          )}
        </div>
      )}
      {/* Error info for failed/reauth_required/unsupported */}
      {isFailed && errorMsg && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {errorCode ? `${errorCode}: ` : ""}{errorMsg}
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div>
      <div className="text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-oai-gray-900 dark:text-oai-gray-100">{value}</div>
    </div>
  );
}

function CodexQuotaBlock({ codexData, loading }) {
  if (loading) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
      </div>
    );
  }

  if (!codexData) {
    return null;
  }

  if (!codexData.configured) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.unconfigured")}
        </div>
      </div>
    );
  }

  if (codexData.auth_action_required === "reauth") {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.reauth")}
        </div>
      </div>
    );
  }

  if (codexData.error) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-red-600 dark:text-red-400">
          {`${copy("settings.token_plan.codex_quota.error")}: ${codexData.error}`}
        </div>
      </div>
    );
  }

  const hasAnyWindow =
    codexData.primary_window ||
    codexData.secondary_window ||
    codexData.spark_primary_window ||
    codexData.spark_secondary_window;

  if (!hasAnyWindow) {
    return (
      <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
        <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.title")}
        </div>
        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.token_plan.codex_quota.unavailable")}
        </div>
      </div>
    );
  }

  const renderWindow = (window, labelKey) => {
    if (!window) return null;
    const used = Number(window?.used_percent || 0);
    const remaining = Math.max(0, 100 - Math.round(Number.isFinite(used) ? used : 0));
    return (
      <div key={labelKey} className="flex items-center justify-between mt-1">
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy(labelKey)}
        </span>
        <span className="text-xs text-oai-gray-600 dark:text-oai-gray-300">
          {remaining}% {copy("settings.token_plan.codex_quota.remaining")}
          <span className="ml-2 text-oai-gray-400">
            {copy("settings.token_plan.codex_quota.reset")} {formatCodexReset(window.reset_at)}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="mt-2 pt-2 border-t border-oai-gray-200 dark:border-oai-gray-800">
      <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
        {copy("settings.token_plan.codex_quota.title")}
      </div>
      {renderWindow(codexData.primary_window, "settings.token_plan.codex_quota.5h")}
      {renderWindow(codexData.secondary_window, "settings.token_plan.codex_quota.7d")}
      {renderWindow(codexData.spark_primary_window, "settings.token_plan.codex_quota.spark_5h")}
      {renderWindow(codexData.spark_secondary_window, "settings.token_plan.codex_quota.spark_7d")}
    </div>
  );
}

function TextInput({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClassName}
      />
    </label>
  );
}

function NumberInput({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClassName}
      />
    </label>
  );
}

function SelectInput({ label, value, onChange, disabled, options }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClassName}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

const inputClassName = cn(
  "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 text-xs text-oai-gray-900 outline-none transition-colors",
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
  "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
);
