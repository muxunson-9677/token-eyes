import React, { useCallback, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  PlugZap,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  BookOpen,
  Copy,
  Orbit,
} from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import {
  applyProviderApiPreset,
  getProviderFinancialCapabilities,
  getProviderConfigurationGuide,
  PROVIDER_API_MODES,
} from "../../lib/provider-api-presets.js";
import {
  saveProviderApiConfig,
  updateProviderApiConfig,
  deleteProviderApiConfig,
  saveProviderApiSecret,
  deleteProviderApiSecret,
  testProviderApiConfig,
  createConsoleSession,
  deleteConsoleSession,
  verifyConsoleSession,
  openXiaomiMimoConsoleLogin,
  verifyXiaomiMimoConsoleSession,
  deleteXiaomiMimoConsoleSession,
  openGlmConsoleLogin,
  verifyGlmConsoleSession,
  deleteGlmConsoleSession,
  openMiniMaxConsoleLogin,
  verifyMiniMaxConsoleSession,
  deleteMiniMaxConsoleSession,
} from "../../lib/api";
import { useProviderApiBalances } from "../../hooks/use-provider-api-balances.js";
import { SectionCard } from "./Controls.jsx";

// 03-ia-api-balance: Provider API configuration section (settings > cost).
//
// Hard boundaries (enforced by 02 backend, re-enforced here for UX):
// - This section ONLY configures financial-query endpoints. There is no model
//   call / chat / completion / embedding entry anywhere in this file.
// - The API Key input is a one-time secret input. It is NEVER prefilled on
//   edit (the field starts blank), NEVER stored in localStorage/sessionStorage,
//   NEVER placed in a data-* attribute or non-password DOM node, and is
//   cleared from component state immediately after a successful save. The
//   backend returns only a masked preview (••••1234) + an apiKeyRef.
// - requestUrl is shown as a masked summary (protocol + host) in the list so
//   path/query secrets (which the backend rejects anyway) never render.
//
// The component talks to the 02 endpoints via the shared api.ts client — no
// parallel fetch plumbing, no field-shape drift from the data contract.

const DEFAULT_FORM = {
  providerId: "",
  label: "",
  requestUrl: "",
  requestMethod: "GET",
  authType: "bearer",
  authHeaderName: "",
  balancePath: "",
  monthSpendPath: "",
  lifetimeSpendPath: "",
  currencyPath: "",
  refreshIntervalSeconds: 300,
  enabled: true,
  nonSecretHeadersText: "",
};

function formatSaveError(result) {
  if (!result) return copy("settings.cost.provider_api.error_generic");
  if (result.error_code === "credential_store_unavailable") {
    return copy("settings.cost.provider_api.error_credential_unavailable");
  }
  if (result.error_code === "unsupported_endpoint") {
    return result.error || copy("settings.cost.provider_api.error_unsupported_endpoint");
  }
  if (result.error_code === "invalid_config") {
    return result.error || copy("settings.cost.provider_api.error_invalid");
  }
  return result.error || copy("settings.cost.provider_api.error_generic");
}

// Map 02 balance.errorCode → user-facing test-result copy key.
function testResultFromBalance(balance) {
  if (!balance) return { tone: "error", key: "settings.cost.provider_api.test_unknown" };
  if (balance.status === "synced") {
    return { tone: "success", key: "settings.cost.provider_api.test_success" };
  }
  const map = {
    provider_unauthorized: "settings.cost.provider_api.test_unauthorized",
    provider_rate_limited: "settings.cost.provider_api.test_rate_limited",
    request_timeout: "settings.cost.provider_api.test_timeout",
    unsupported_endpoint: "settings.cost.provider_api.test_unsupported",
    provider_response_invalid: "settings.cost.provider_api.test_invalid",
    provider_unavailable: "settings.cost.provider_api.test_unavailable",
    credential_missing: "settings.cost.provider_api.test_unauthorized",
    credential_store_unavailable: "settings.cost.provider_api.error_credential_unavailable",
  };
  const key = map[balance.errorCode] || "settings.cost.provider_api.test_unknown";
  const tone = balance.status === "unsupported" ? "warn" : "error";
  return { tone, key };
}

function statusLabelKey(status) {
  if (status === "synced") return "settings.cost.provider_api.status.synced";
  if (status === "stale") return "settings.cost.provider_api.stale";
  if (status === "unsupported") return "settings.cost.provider_api.status.unsupported";
  if (status === "not-connected") return "settings.cost.provider_api.status.not_connected";
  return "settings.cost.provider_api.status.error";
}

function maskUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(rawUrl || "");
  }
}

const OFFICIAL_CONSOLE_AUTH_TIMEOUT_MS = 120_000;
const OFFICIAL_CONSOLE_TEST_RESULTS = Object.freeze({
  reauth_required: { tone: "error", key: "settings.cost.provider_api.console_reauth_required", showWithConfirmedData: true },
  temporary: { tone: "warn", key: "settings.cost.provider_api.console_temporary", showWithConfirmedData: true },
  unsupported: { tone: "warn", key: "settings.cost.provider_api.console_unsupported", showWithConfirmedData: true },
});

function officialConsoleStateError(state) {
  const error = new Error("Official console verification stopped");
  error.officialConsoleState = state;
  return error;
}

function officialConsoleAdapter(providerId) {
  if (providerId === "xiaomi_mimo") {
    return {
      open: openXiaomiMimoConsoleLogin,
      verify: verifyXiaomiMimoConsoleSession,
      close: deleteXiaomiMimoConsoleSession,
    };
  }
  if (providerId === "glm") {
    return {
      open: openGlmConsoleLogin,
      verify: verifyGlmConsoleSession,
      close: deleteGlmConsoleSession,
    };
  }
  if (providerId === "minimax") {
    return {
      open: openMiniMaxConsoleLogin,
      verify: verifyMiniMaxConsoleSession,
      close: deleteMiniMaxConsoleSession,
    };
  }
  return null;
}

function waitForNextConsolePoll() {
  return new Promise((resolve) => window.setTimeout(resolve, 750));
}

// Parse the nonSecretHeaders textarea ("Name: Value" per line) into an object.
// Lines without a colon or with empty name are dropped. Secret-like names are
// dropped defensively (the backend rejects them too).
function parseNonSecretHeaders(text) {
  const out = {};
  if (typeof text !== "string") return out;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "cookie") continue;
    out[name] = value;
  }
  return out;
}

function nonSecretHeadersToText(obj) {
  if (!obj || typeof obj !== "object") return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function providerApiModeValue(providerId) {
  for (const mode of PROVIDER_API_MODES) {
    if (mode.value === providerId) return providerId;
  }
  return providerId ? "custom" : "";
}

function serializeAccessKeyCredential(accessKeyId, accessKeySecret) {
  return JSON.stringify({
    version: 1,
    type: "access_key_pair",
    accessKeyId: accessKeyId.trim(),
    accessKeySecret: accessKeySecret.trim(),
  });
}

// F4 / F6: render a financial value only when the provider supplied one.
// - null/undefined/NaN → omitted by the caller
// - real 0 → "0.00" (a true zero balance from the provider is meaningful)
// - number → formatted with 2 fraction digits, prefixed by currency
// `currency` is only shown when a value exists, so a missing amount cannot be
// paired with a possibly-wrong currency.
function formatFinancialValue(value, currency) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const prefix = currency ? `${currency} ` : "";
  return `${prefix}${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ProviderApiBrandMark({ providerId, label }) {
  const id = String(providerId || "").toLowerCase();
  let mark = String(label || providerId || "P").slice(0, 1);
  if (id === "deepseek") {
    mark = <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 18c3-1 5-3 7-6 3 3 7 4 13 3-1 6-5 10-11 10-5 0-8-2-9-7Z" fill="currentColor"/><path d="M20 11c2-3 5-4 8-2-1 3-3 5-7 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="10" cy="18" r="1" fill="white"/></svg>;
  } else if (id === "glm") {
    mark = <svg viewBox="0 0 32 32" aria-hidden="true">{[[16,5],[10,8],[22,8],[7,14],[16,14],[25,14],[10,21],[22,21],[16,27]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.3" fill="currentColor"/>)}</svg>;
  } else if (id.includes("volcengine")) {
    mark = <svg viewBox="0 0 32 32" aria-hidden="true"><path className="tt-provider-api-volc-blue" d="M4 27 12 7l5 20H4Z"/><path className="tt-provider-api-volc-teal" d="m14 27 6-16 8 16H14Z"/><path className="tt-provider-api-volc-violet" d="m11 27 5-13 4 13h-9Z"/></svg>;
  } else if (id.includes("aliyun")) {
    mark = <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 20c4-8 12-12 24-9-7 1-12 4-15 8 5-2 9-2 13-1-6 5-14 6-22 2Z" fill="currentColor"/><path d="M21 19c3 0 5 1 7 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
  }
  return <span className={cn("tt-provider-api-mark", `tt-provider-api-mark--${providerId}`)} aria-hidden="true">{mark}</span>;
}

function ProviderApiSummary({ summary, testId }) {
  return (
    <div className="tt-provider-api-summary" data-testid={testId} aria-label={copy("settings.cost.provider_api.summary.aria_label")}>
      <span>{copy("settings.cost.provider_api.summary.total")}<strong>{summary.total}</strong></span>
      <span>{copy("settings.cost.provider_api.summary.connected")}<strong data-tone="connected">● {summary.connected}</strong></span>
      <span>{copy("settings.cost.provider_api.summary.disconnected")}<strong data-tone="disconnected">● {summary.disconnected}</strong></span>
      <span>
        {copy("settings.cost.provider_api.summary.balance_cny")}
        <strong>{summary.totalBalanceCny.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      </span>
    </div>
  );
}

export function ProviderApiConfigSection({ onSummaryChange }) {
  // F4: cost settings must auto-load and display balance/monthSpend/
  // lifetimeSpend/currency from the 02 financial endpoints — same hook the
  // spend/cost page uses. The section previously kept its own configs/loading
  // state and only read `lastBalance` from a manual refresh, so the card never
  // rendered real financial data. Delegating to the hook gives mount-time
  // cached load + background refresh + per-config refresh, with no parallel
  // data flow drifting from the spend page's contract.
  const {
    configs,
    balances,
    refreshingIds,
    refreshing,
    stale,
    lastUpdatedAt,
    loading,
    refreshAll,
    refreshOne,
    reload,
  } = useProviderApiBalances();

  // balancesByConfigId: O(1) lookup so each card reads its own balance without
  // re-scanning the array on every render.
  const balancesByConfigId = useMemo(() => {
    const m = new Map();
    for (const b of balances || []) {
      if (b && b.configId) m.set(b.configId, b);
    }
    return m;
  }, [balances]);
  const providerSummary = useMemo(() => {
    const connected = (configs || []).filter((config) => balancesByConfigId.get(config.id)?.status === "synced").length;
    const totalBalanceCny = (configs || []).reduce((total, config) => {
      const balance = balancesByConfigId.get(config.id);
      const value = Number(balance?.balance);
      const currency = String(balance?.currency || "CNY").toUpperCase();
      return currency === "CNY" && Number.isFinite(value) ? total + value : total;
    }, 0);
    return { connected, disconnected: Math.max(0, (configs || []).length - connected), totalBalanceCny };
  }, [balancesByConfigId, configs]);
  React.useEffect(() => {
    onSummaryChange?.({
      total: configs.length,
      connected: providerSummary.connected,
      disconnected: providerSummary.disconnected,
      totalBalanceCny: providerSummary.totalBalanceCny,
    });
  }, [configs.length, onSummaryChange, providerSummary]);

  const [editing, setEditing] = useState(null); // null | "new" | config
  const [form, setForm] = useState(DEFAULT_FORM);
  // apiKeyInput is the one-time secret field. Blank on edit (never prefilled).
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [accessKeyIdInput, setAccessKeyIdInput] = useState("");
  const [accessKeySecretInput, setAccessKeySecretInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Per-config transient action state: { [id]: { testing?, testResult? } }
  // (refreshing is now sourced from the hook's refreshingIds, not cardState.)
  const [cardState, setCardState] = useState({});
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const clearCredentialInputs = () => {
    setApiKeyInput("");
    setAccessKeyIdInput("");
    setAccessKeySecretInput("");
  };

  const startAdd = () => {
    setForm({ ...DEFAULT_FORM });
    clearCredentialInputs();
    setFormError(null);
    setShowAdvanced(false);
    setEditing("new");
  };

  const startEdit = (config) => {
    setForm({
      ...DEFAULT_FORM,
      providerId: config.providerId || "",
      label: config.label || "",
      requestUrl: config.requestUrl || "",
      requestMethod: config.requestMethod || "GET",
      authType: config.authType || "bearer",
      authHeaderName: config.authHeaderName || "",
      balancePath: config.balancePath || "",
      monthSpendPath: config.monthSpendPath || "",
      lifetimeSpendPath: config.lifetimeSpendPath || "",
      currencyPath: config.currencyPath || "",
      refreshIntervalSeconds: Number(config.refreshIntervalSeconds) || 300,
      enabled: config.enabled !== false,
      nonSecretHeadersText: nonSecretHeadersToText(config.nonSecretHeaders),
    });
    // API Key field is intentionally left blank — never prefilled.
    clearCredentialInputs();
    setFormError(null);
    setShowAdvanced(false);
    setEditing(config);
  };

  const cancelEdit = () => {
    setEditing(null);
    clearCredentialInputs();
    setFormError(null);
    setShowAdvanced(false);
  };

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const preparedForm = applyProviderApiPreset(form);
      if (
        preparedForm.financialCapabilities.balance === "unsupported"
        && preparedForm.financialCapabilities.tokenQuota === "token_plan"
      ) {
        setFormError(copy(
          preparedForm.providerId === "minimax"
            ? "settings.cost.provider_api.capability.minimax_balance_unsupported"
            : "settings.cost.provider_api.capability.glm_finance_unsupported"
        ));
        return;
      }
      const usesAccessKeyPair = preparedForm.authType === "aliyun_rpc"
        || preparedForm.authType === "volcengine_hmac";
      let credentialSecret = apiKeyInput;
      if (usesAccessKeyPair) {
        const accessKeyId = accessKeyIdInput.trim();
        const accessKeySecret = accessKeySecretInput.trim();
        if ((accessKeyId && !accessKeySecret) || (!accessKeyId && accessKeySecret)) {
          setFormError(copy("settings.cost.provider_api.form.access_key_pair_required"));
          return;
        }
        credentialSecret = accessKeyId && accessKeySecret
          ? serializeAccessKeyCredential(accessKeyId, accessKeySecret)
          : "";
      }
      const payload = {
        providerId: preparedForm.providerId.trim(),
        label: preparedForm.label.trim(),
        requestUrl: preparedForm.requestUrl.trim(),
        requestMethod: preparedForm.requestMethod,
        authType: preparedForm.authType,
        authHeaderName: preparedForm.authType === "header" ? preparedForm.authHeaderName.trim() : "",
        balancePath: preparedForm.balancePath.trim(),
        monthSpendPath: preparedForm.monthSpendPath.trim(),
        lifetimeSpendPath: preparedForm.lifetimeSpendPath.trim(),
        currencyPath: preparedForm.currencyPath.trim(),
        currencyValue: String(preparedForm.currencyValue || "").trim(),
        refreshIntervalSeconds: Number(preparedForm.refreshIntervalSeconds) || 300,
        enabled: preparedForm.enabled,
        nonSecretHeaders: parseNonSecretHeaders(preparedForm.nonSecretHeadersText),
      };

      const isEditingExisting = editing && editing !== "new";
      const result = isEditingExisting
        ? await updateProviderApiConfig(editing.id, payload)
        : await saveProviderApiConfig(payload);

      if (!result?.ok) {
        setFormError(formatSaveError(result));
        return;
      }

      const savedConfig = result.data?.config;
      const configId = savedConfig?.id;

      // If a new API Key was entered, save it via the secrets endpoint. The
      // secret leaves this state object immediately after this call.
      if (credentialSecret && configId) {
        const secretResult = await saveProviderApiSecret({ configId, secret: credentialSecret });
        if (!secretResult?.ok) {
          setFormError(formatSaveError(secretResult));
          // Config was saved but secret was not — keep the form open so the
          // user can retry. Clear the secret input regardless.
          clearCredentialInputs();
          return;
        }
      }
      // Clear the secret from state immediately after handling.
      clearCredentialInputs();
      await reload();
      setEditing(null);
    } catch {
      setFormError(copy("settings.cost.provider_api.error_generic"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (config) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.cost.provider_api.confirm_delete"))) return;
    setCardState((prev) => ({ ...prev, [config.id]: { ...(prev[config.id] || {}), deleting: true } }));
    try {
      const result = await deleteProviderApiConfig(config.id);
      if (!result?.ok) {
        setCardState((prev) => ({
          ...prev,
          [config.id]: { ...(prev[config.id] || {}), deleting: false, testResult: { tone: "error", key: "settings.cost.provider_api.error_generic" } },
        }));
        return;
      }
      setCardState((prev) => {
        const next = { ...prev };
        delete next[config.id];
        return next;
      });
      await reload();
    } catch {
      setCardState((prev) => ({ ...prev, [config.id]: { ...(prev[config.id] || {}), deleting: false } }));
    }
  };

  const handleTest = async (config) => {
    setCardState((prev) => ({ ...prev, [config.id]: { ...(prev[config.id] || {}), testing: true, testResult: null } }));
    try {
      if (config.authType === "official_console") {
        const adapter = officialConsoleAdapter(config.providerId);
        if (!adapter) throw new Error("Unsupported official console provider");
        const sessionRef = `provider-api/${config.providerId}/session/${crypto.randomUUID()}`;
        const created = await createConsoleSession({
          provider_id: config.providerId,
          auth_kind: "official_console_session",
          display_name: config.label || config.providerId,
          session_ref: sessionRef,
        });
        let connected = false;
        try {
          await adapter.open(sessionRef);
          const deadline = Date.now() + OFFICIAL_CONSOLE_AUTH_TIMEOUT_MS;
          while (Date.now() < deadline) {
            const nativeResult = await adapter.verify(sessionRef);
            if (nativeResult?.connected && nativeResult?.balance) {
              await verifyConsoleSession(created.session.id, {
                ...nativeResult,
                session_ref: nativeResult.session_ref || sessionRef,
                state_code: "connected",
              });
              connected = true;
              break;
            }
            if (["reauth_required", "temporary", "unsupported", "failed", "session_not_found"].includes(nativeResult?.state_code)) {
              await verifyConsoleSession(created.session.id, nativeResult);
              if (Object.prototype.hasOwnProperty.call(OFFICIAL_CONSOLE_TEST_RESULTS, nativeResult.state_code)) {
                throw officialConsoleStateError(nativeResult.state_code);
              }
              throw new Error("Console verification failed");
            }
            await waitForNextConsolePoll();
          }
          if (!connected) throw new Error("Official console authorization timed out");
        } catch (error) {
          await adapter.close(sessionRef).catch(() => null);
          if (!Object.prototype.hasOwnProperty.call(OFFICIAL_CONSOLE_TEST_RESULTS, error?.officialConsoleState)) {
            await deleteConsoleSession(created.session.id).catch(() => null);
          }
          throw error;
        }
      }
      const result = await testProviderApiConfig(config.id);
      const balance = result?.data?.balance;
      setCardState((prev) => ({
        ...prev,
        [config.id]: { ...(prev[config.id] || {}), testing: false, testResult: testResultFromBalance(balance) },
      }));
    } catch (error) {
      const officialConsoleResult = OFFICIAL_CONSOLE_TEST_RESULTS[error?.officialConsoleState];
      setCardState((prev) => ({
        ...prev,
        [config.id]: {
          ...(prev[config.id] || {}),
          testing: false,
          testResult: officialConsoleResult || { tone: "error", key: "settings.cost.provider_api.test_unknown" },
        },
      }));
    }
  };

  // F4: per-card refresh delegates to the hook's refreshOne (dedup'd, updates
  // the shared balances array, marks stale on failure — never fakes 0). The
  // old code stored a transient `lastBalance` on cardState that the card never
  // rendered, so a manual refresh had no visible effect on financial data.
  const handleRefresh = async (config) => {
    await refreshOne(config.id);
  };

  const handleDeleteSecret = async (config) => {
    if (!config.apiKeyRef) return;
    setCardState((prev) => ({ ...prev, [config.id]: { ...(prev[config.id] || {}), deleting: true } }));
    try {
      await deleteProviderApiSecret(config.id);
      // Reload configs (apiKeyRef clears) + re-read cached balances so the card
      // status flips to "not-connected" immediately.
      await reload();
    } finally {
      setCardState((prev) => ({ ...prev, [config.id]: { ...(prev[config.id] || {}), deleting: false } }));
    }
  };

  return (
    <div data-testid="provider-api-config-section">
      <SectionCard
        title={copy("settings.cost.provider_api.section")}
        subtitle={copy("settings.cost.provider_api.subtitle")}
        icon={Orbit}
        iconTone="blue"
        iconTestId="provider-api-section-icon"
        collapsible
        defaultOpen={false}
        storageKey="cost.provider-api"
        collapsedSummaryContent={<ProviderApiSummary summary={{ ...providerSummary, total: configs.length }} testId="provider-api-collapsed-summary" />}
        collapsedSummaryTone="blue"
        action={editing === null ? (
          <button
            type="button"
            onClick={startAdd}
            className="tt-cost-header-action tt-cost-header-action-primary"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {copy("settings.cost.provider_api.add")}
          </button>
        ) : null}
      >
      {editing !== null ? (
        <ProviderApiConfigForm
          form={form}
          setField={setField}
          apiKeyInput={apiKeyInput}
          setApiKeyInput={setApiKeyInput}
          accessKeyIdInput={accessKeyIdInput}
          setAccessKeyIdInput={setAccessKeyIdInput}
          accessKeySecretInput={accessKeySecretInput}
          setAccessKeySecretInput={setAccessKeySecretInput}
          editing={editing}
          saving={saving}
          formError={formError}
          showAdvanced={showAdvanced}
          setShowAdvanced={setShowAdvanced}
          onSave={handleSave}
          onCancel={cancelEdit}
        />
      ) : loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-oai-gray-100 dark:bg-oai-gray-800" />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <div className="rounded-md border border-dashed border-oai-gray-300 p-4 text-center text-sm text-oai-gray-500 dark:border-oai-gray-700 dark:text-oai-gray-400">
          {copy("settings.cost.provider_api.empty")}
        </div>
      ) : (
        <div className="tt-provider-api-list space-y-2">
          <div className="tt-provider-api-toolbar">
            <div className="flex flex-wrap items-center gap-2">
              {stale ? (
                <span
                  data-testid="provider-api-stale-badge"
                  className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                >
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  {copy("settings.cost.provider_api.stale")}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => { void refreshAll(); }}
                disabled={refreshing}
                className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2.5 py-1.5 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
                {refreshing ? copy("settings.cost.provider_api.refreshing") : copy("settings.cost.provider_api.refresh_all")}
              </button>
            </div>
          </div>
          {configs.map((config) => (
            <ProviderApiConfigCard
              key={config.id}
              config={config}
              state={cardState[config.id] || {}}
              balance={balancesByConfigId.get(config.id) || null}
              refreshing={Boolean(refreshingIds && refreshingIds.has(config.id))}
              onEdit={() => startEdit(config)}
              onDelete={() => handleDelete(config)}
              onTest={() => handleTest(config)}
              onRefresh={() => handleRefresh(config)}
              onRevokeSecret={() => handleDeleteSecret(config)}
            />
          ))}
        </div>
      )}
      </SectionCard>
    </div>
  );
}

function ProviderApiConfigCard({ config, state, balance, refreshing, onEdit, onDelete, onTest, onRefresh, onRevokeSecret }) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideCopied, setGuideCopied] = useState(false);
  const statusKey = balance?.status
    ? statusLabelKey(balance.status)
    : "settings.cost.provider_api.status.not_connected";
  const testResult = state.testResult;
  const hasConfirmedData = balance?.status === "synced" || (balance?.status === "stale" && (
    balance?.balance != null
    || balance?.monthSpend != null
    || balance?.lifetimeSpend != null
    || Boolean(balance?.lastSyncedAt)
  ));
  const capabilities = getProviderFinancialCapabilities(config);
  const balanceValue = capabilities.balance === "unsupported"
    ? copy("settings.cost.provider_api.capability.unsupported")
    : hasConfirmedData
      ? formatFinancialValue(balance?.balance, balance?.currency)
      : null;
  const monthSpendValue = capabilities.monthSpend === "unsupported" ? copy("settings.cost.provider_api.capability.unsupported") : hasConfirmedData ? formatFinancialValue(balance?.monthSpend, balance?.currency) : null;
  const lifetimeSpendValue = capabilities.lifetimeSpend === "unsupported" ? copy("settings.cost.provider_api.capability.unsupported") : hasConfirmedData ? formatFinancialValue(balance?.lifetimeSpend, balance?.currency) : null;
  const tokenQuotaValue = capabilities.tokenQuota === "token_plan" ? copy("settings.cost.provider_api.capability.token_plan_settings") : copy("settings.cost.provider_api.capability.unsupported");
  const currencyValue = hasConfirmedData && balance?.currency
    ? balance.currency
    : null;
  const visibleTestResult = hasConfirmedData && !testResult?.showWithConfirmedData ? null : testResult;
  const guide = getProviderConfigurationGuide(config);
  const guideText = [
    `Provider: ${guide.provider}`,
    `Balance endpoint: ${guide.endpoint}`,
    `Method: ${guide.method}`,
    `Authentication: ${guide.authType}`,
    `Balance field path: ${guide.balancePath || "not provided"}`,
    `Currency field path: ${guide.currencyPath || "not provided"}`,
    `Safety note: ${guide.note}`,
  ].join("\n");

  const copyGuide = async () => {
    await navigator.clipboard.writeText(guideText);
    setGuideCopied(true);
  };

  return (
    <div data-testid={`provider-api-row-${config.id}`} data-layout="compact-two-line" className="tt-provider-api-card rounded-xl border border-oai-gray-200 bg-white px-3 py-2.5 shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ProviderApiBrandMark providerId={config.providerId} label={config.label} />
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {config.label}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {config.providerId}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400" title={copy("settings.cost.provider_api.url_masked")}>
              {maskUrl(config.requestUrl)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          >
            <BookOpen className="h-3 w-3" aria-hidden="true" />
            {copy("settings.cost.provider_api.guide")}
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={state.testing}
            className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          >
            <PlugZap className="h-3 w-3" aria-hidden="true" />
            {copy("settings.cost.provider_api.test")}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden="true" />
            {copy("settings.cost.provider_api.refresh")}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            {copy("settings.cost.provider_api.edit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={state.deleting}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            {copy("settings.cost.provider_api.delete")}
          </button>
        </div>
        <div data-testid={`provider-api-card-financial-${config.id}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <span className={cn("rounded px-1.5 py-0.5", balance?.status === "synced" ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : balance?.status === "unsupported" ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400" : "bg-oai-gray-50 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400")}>{copy(statusKey)}</span>
          {balanceValue ? <span className="tabular-nums text-oai-gray-700 dark:text-oai-gray-200">{copy("settings.cost.provider_api.balance")}: <span data-testid={`provider-api-card-balance-${config.id}`}>{balanceValue}</span></span> : null}
          {balance?.lastSyncedAt ? <span className="truncate">{copy("settings.cost.provider_api.last_synced")}: {balance.lastSyncedAt}</span> : null}
          {visibleTestResult ? <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", visibleTestResult.tone === "success" ? "bg-green-50 text-green-700" : visibleTestResult.tone === "warn" ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700")}>{visibleTestResult.tone === "success" ? <CheckCircle className="h-3 w-3" aria-hidden="true" /> : <AlertCircle className="h-3 w-3" aria-hidden="true" />}{copy(visibleTestResult.key)}</span> : null}
          {monthSpendValue ? <span className="sr-only" data-testid={`provider-api-card-month-spend-${config.id}`}>{monthSpendValue}</span> : null}
          {lifetimeSpendValue ? <span className="sr-only" data-testid={`provider-api-card-lifetime-spend-${config.id}`}>{lifetimeSpendValue}</span> : null}
          {currencyValue ? <span className="sr-only" data-testid={`provider-api-card-currency-${config.id}`}>{currencyValue}</span> : null}
          <span className="sr-only" data-testid={`provider-api-card-token-quota-${config.id}`}>{tokenQuotaValue}</span>
        </div>
        <div className="flex justify-end">
          {config.apiKeyRef ? <button type="button" onClick={onRevokeSecret} disabled={state.deleting} title={copy("settings.cost.provider_api.masked_saved")} className="rounded-md p-1 text-oai-gray-400 hover:bg-oai-gray-100 disabled:opacity-50 dark:hover:bg-oai-gray-800"><XCircle className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
        </div>
      </div>
      {guideOpen ? (
        <div role="dialog" aria-modal="true" aria-label={`${copy("settings.cost.provider_api.guide")} ${config.label}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setGuideOpen(false); }}>
          <div className="w-full max-w-xl rounded-2xl border border-oai-gray-200 bg-white p-4 shadow-xl dark:border-oai-gray-700 dark:bg-oai-gray-900">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-oai-gray-900 dark:text-oai-gray-100">{copy("settings.cost.provider_api.guide")} · {config.label}</h3>
              <button type="button" onClick={() => setGuideOpen(false)} aria-label={copy("settings.cost.provider_api.guide_close")} className="rounded-md p-1 text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800"><XCircle className="h-4 w-4" /></button>
            </div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-oai-gray-50 p-3 text-xs leading-5 text-oai-gray-700 dark:bg-oai-gray-950 dark:text-oai-gray-300">{guideText}</pre>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{copy("settings.cost.provider_api.guide_secret_warning")}</p>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={copyGuide} className="inline-flex items-center gap-1.5 rounded-lg bg-oai-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-oai-brand-700"><Copy className="h-3.5 w-3.5" />{copy(guideCopied ? "settings.cost.provider_api.guide_copied" : "settings.cost.provider_api.guide_copy")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProviderApiConfigForm({
  form,
  setField,
  apiKeyInput,
  setApiKeyInput,
  accessKeyIdInput,
  setAccessKeyIdInput,
  accessKeySecretInput,
  setAccessKeySecretInput,
  editing,
  saving,
  formError,
  showAdvanced,
  setShowAdvanced,
  onSave,
  onCancel,
}) {
  const isEdit = editing && editing !== "new";
  const hasExistingKey = Boolean(isEdit && editing.apiKeyRef);
  const preview = applyProviderApiPreset(form);
  const unsupportedKnownProvider = preview.financialCapabilities.balance === "unsupported"
    && preview.financialCapabilities.tokenQuota === "token_plan";
  const selectedMode = providerApiModeValue(form.providerId);
  const usesAccessKeyPair = preview.authType === "aliyun_rpc"
    || preview.authType === "volcengine_hmac";
  const usesOfficialConsole = preview.authType === "official_console";
  const usesFixedPreset = Boolean(selectedMode && selectedMode !== "custom");
  const showEditableUrl = !usesFixedPreset;
  const capabilityNoticeKey = selectedMode === "minimax"
    ? "settings.cost.provider_api.capability.minimax_balance_unsupported"
    : "settings.cost.provider_api.capability.glm_finance_unsupported";
  const accountScopeKey = preview.providerId === "aliyun_bss"
    ? "settings.cost.provider_api.capability.aliyun_account_scope"
    : preview.providerId === "volcengine_billing"
      ? "settings.cost.provider_api.capability.volcengine_account_scope"
      : null;

  const handleModeChange = (providerId) => {
    setField("providerId", providerId);
    setApiKeyInput("");
    setAccessKeyIdInput("");
    setAccessKeySecretInput("");
  };

  return (
    <div className="space-y-3 rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <h4 className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
        {isEdit ? copy("settings.cost.provider_api.form.title_edit") : copy("settings.cost.provider_api.form.title_add")}
      </h4>

      <FormField label={copy("settings.cost.provider_api.form.name")}>
        <input
          type="text"
          value={form.label}
          onChange={(e) => setField("label", e.target.value)}
          placeholder={copy("settings.cost.provider_api.form.name_placeholder")}
          className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
        />
      </FormField>

      <FormField label={copy("settings.cost.provider_api.form.api_mode")}>
        <select
          value={selectedMode}
          onChange={(e) => handleModeChange(e.target.value)}
          className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
        >
          {PROVIDER_API_MODES.map((mode) => (
            <option key={mode.copyKey || mode.value} value={mode.value}>
              {mode.copyKey ? copy(mode.copyKey) : mode.label}
            </option>
          ))}
        </select>
      </FormField>

      {showEditableUrl && (
        <FormField label={copy("settings.cost.provider_api.form.url")}>
          <input
            type="url"
            inputMode="url"
            value={form.requestUrl}
            onChange={(e) => setField("requestUrl", e.target.value)}
            placeholder="https://api.deepseek.com"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      )}

      {showEditableUrl && (
        <div className="rounded-md bg-oai-gray-50 px-3 py-2 text-xs text-oai-gray-600 dark:bg-oai-gray-900 dark:text-oai-gray-300">
          {copy("settings.cost.provider_api.form.auto_hint")}
        </div>
      )}

      {unsupportedKnownProvider && (
        <div className="space-y-1 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-300">
          <p>{copy(capabilityNoticeKey)}</p>
          <p>{copy("settings.cost.provider_api.capability.token_plan_settings")}</p>
        </div>
      )}

      {accountScopeKey && (
        <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {copy(accountScopeKey)}
        </div>
      )}

      {usesOfficialConsole && (
        <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
          {copy(preview.providerId === "xiaomi_mimo"
            ? "settings.cost.provider_api.capability.xiaomi_console_best_effort"
            : "settings.cost.provider_api.capability.official_console_hint")}
        </div>
      )}

      {!unsupportedKnownProvider && usesAccessKeyPair && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={copy("settings.cost.provider_api.form.access_key_id")}>
            <input
              type="password"
              autoComplete="off"
              value={accessKeyIdInput}
              onChange={(e) => setAccessKeyIdInput(e.target.value)}
              placeholder={hasExistingKey ? copy("settings.cost.provider_api.form.api_key_placeholder") : ""}
              className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
            />
          </FormField>
          <FormField label={copy("settings.cost.provider_api.form.access_key_secret")}>
            <input
              type="password"
              autoComplete="off"
              value={accessKeySecretInput}
              onChange={(e) => setAccessKeySecretInput(e.target.value)}
              placeholder={hasExistingKey ? copy("settings.cost.provider_api.form.api_key_placeholder") : ""}
              className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
            />
          </FormField>
          <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400 sm:col-span-2">
            {copy("settings.cost.provider_api.form.access_key_pair_hint")}
          </p>
        </div>
      )}

      {!unsupportedKnownProvider && !usesAccessKeyPair && !usesOfficialConsole && (
        <FormField label={copy("settings.cost.provider_api.form.api_key")}>
          <input
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={hasExistingKey ? copy("settings.cost.provider_api.form.api_key_placeholder") : ""}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
          <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {hasExistingKey
              ? copy("settings.cost.provider_api.form.api_key_placeholder")
              : copy("settings.cost.provider_api.form.api_key_hint_new")}
          </p>
        </FormField>
      )}

      <FormField label={copy("settings.cost.provider_api.form.enabled")}>
        <label className="inline-flex items-center gap-2 text-sm text-oai-gray-700 dark:text-oai-gray-300">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setField("enabled", e.target.checked)}
            className="h-4 w-4 rounded border-oai-gray-300"
          />
          {copy("settings.cost.provider_api.form.enabled")}
        </label>
      </FormField>

      {!usesFixedPreset && (
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-left text-xs font-medium text-oai-brand-600 hover:text-oai-brand-700 dark:text-oai-brand-400"
        >
          {showAdvanced
            ? copy("settings.cost.provider_api.form.advanced_hide")
            : copy("settings.cost.provider_api.form.advanced_show")}
        </button>
      )}

      {showAdvanced && !usesFixedPreset && (
        <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("settings.cost.provider_api.form.method")}>
          <select
            value={form.requestMethod}
            onChange={(e) => setField("requestMethod", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="GET">{copy("settings.cost.provider_api.form.method_get")}</option>
            <option value="POST">{copy("settings.cost.provider_api.form.method_post")}</option>
          </select>
        </FormField>
        <FormField label={copy("settings.cost.provider_api.form.auth_type")}>
          <select
            value={form.authType}
            onChange={(e) => setField("authType", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="bearer">{copy("settings.cost.provider_api.form.auth_bearer")}</option>
            <option value="header">{copy("settings.cost.provider_api.form.auth_header")}</option>
          </select>
        </FormField>
      </div>

      {form.authType === "header" && (
        <FormField label={copy("settings.cost.provider_api.form.auth_header_name")}>
          <input
            type="text"
            value={form.authHeaderName}
            onChange={(e) => setField("authHeaderName", e.target.value)}
            placeholder="X-API-Key"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("settings.cost.provider_api.form.balance_path")}>
          <input
            type="text"
            value={form.balancePath}
            onChange={(e) => setField("balancePath", e.target.value)}
            placeholder="data.balance"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("settings.cost.provider_api.form.month_spend_path")}>
          <input
            type="text"
            value={form.monthSpendPath}
            onChange={(e) => setField("monthSpendPath", e.target.value)}
            placeholder="data.month_spend"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("settings.cost.provider_api.form.lifetime_spend_path")}>
          <input
            type="text"
            value={form.lifetimeSpendPath}
            onChange={(e) => setField("lifetimeSpendPath", e.target.value)}
            placeholder="data.lifetime_spend"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("settings.cost.provider_api.form.currency_path")}>
          <input
            type="text"
            value={form.currencyPath}
            onChange={(e) => setField("currencyPath", e.target.value)}
            placeholder="data.currency"
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

      <FormField label={copy("settings.cost.provider_api.form.refresh_interval")}>
        <input
          type="number"
          min={60}
          max={86400}
          value={form.refreshIntervalSeconds}
          onChange={(e) => setField("refreshIntervalSeconds", Number(e.target.value))}
          className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
        />
      </FormField>

      <FormField
        label={copy("settings.cost.provider_api.form.non_secret_headers")}
        hint={copy("settings.cost.provider_api.form.non_secret_headers_hint")}
      >
        <textarea
          rows={3}
          value={form.nonSecretHeadersText}
          onChange={(e) => setField("nonSecretHeadersText", e.target.value)}
          placeholder={"X-Org-Id: 12345"}
          className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm font-mono dark:border-oai-gray-700 dark:bg-oai-gray-900"
        />
      </FormField>
        </>
      )}

      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {formError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-oai-gray-200 px-3 py-1.5 text-sm text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
        >
          {copy("settings.cost.provider_api.cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || unsupportedKnownProvider}
          className="inline-flex items-center gap-1 rounded-md bg-oai-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-oai-brand-700 disabled:opacity-50"
        >
          {copy("settings.cost.provider_api.save")}
        </button>
      </div>
    </div>
  );
}

function FormField({ label, hint, children }) {
  // Wrap children inside the label element so screen readers associate the
  // label text with the input control (matches CostAccumulation's pattern).
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-400">
        <span className="block">{label}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</p>}
    </div>
  );
}
