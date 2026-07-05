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
} from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { applyProviderApiPreset } from "../../lib/provider-api-presets.js";
import {
  saveProviderApiConfig,
  updateProviderApiConfig,
  deleteProviderApiConfig,
  saveProviderApiSecret,
  deleteProviderApiSecret,
  testProviderApiConfig,
} from "../../lib/api";
import { useProviderApiBalances } from "../../hooks/use-provider-api-balances.js";

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

// F4 / F6: render a financial value or "—" when unknown/missing.
// - null/undefined/NaN → "—" (NEVER fake 0 for unknown — that was the F4/F6 bug)
// - real 0 → "0.00" (a true zero balance from the provider is meaningful)
// - number → formatted with 2 fraction digits, prefixed by currency
// `currency` is only shown when a value exists; an unknown value's "—" must
// not be prefixed with a possibly-wrong currency.
function formatFinancialValue(value, currency) {
  if (value === null || value === undefined) return copy("settings.cost.provider_api.data_unknown");
  const num = Number(value);
  if (Number.isNaN(num)) return copy("settings.cost.provider_api.data_unknown");
  const prefix = currency ? `${currency} ` : "";
  return `${prefix}${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ProviderApiConfigSection() {
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

  const [editing, setEditing] = useState(null); // null | "new" | config
  const [form, setForm] = useState(DEFAULT_FORM);
  // apiKeyInput is the one-time secret field. Blank on edit (never prefilled).
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Per-config transient action state: { [id]: { testing?, testResult? } }
  // (refreshing is now sourced from the hook's refreshingIds, not cardState.)
  const [cardState, setCardState] = useState({});

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const startAdd = () => {
    setForm({ ...DEFAULT_FORM });
    setApiKeyInput("");
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
    setApiKeyInput("");
    setFormError(null);
    setShowAdvanced(true);
    setEditing(config);
  };

  const cancelEdit = () => {
    setEditing(null);
    setApiKeyInput("");
    setFormError(null);
    setShowAdvanced(false);
  };

  const handleSave = async () => {
    setFormError(null);
    setSaving(true);
    try {
      const preparedForm = applyProviderApiPreset(form);
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
        refreshIntervalSeconds: Number(preparedForm.refreshIntervalSeconds) || 300,
        enabled: preparedForm.enabled,
        nonSecretHeaders: parseNonSecretHeaders(preparedForm.nonSecretHeadersText),
      };

      const isEditingExisting = editing && editing !== "new";
      const result = isEditingExisting
        ? await updateProviderApiConfig(editing.id, payload)
        : await saveProviderApiConfig(payload);

      if (!result?.ok) {
        if (result?.error_code === "credential_store_unavailable") {
          setFormError(copy("settings.cost.provider_api.error_credential_unavailable"));
        } else if (result?.error_code === "invalid_config") {
          setFormError(copy("settings.cost.provider_api.error_invalid"));
        } else {
          setFormError(result?.error || copy("settings.cost.provider_api.error_generic"));
        }
        return;
      }

      const savedConfig = result.data?.config;
      const configId = savedConfig?.id;

      // If a new API Key was entered, save it via the secrets endpoint. The
      // secret leaves this state object immediately after this call.
      if (apiKeyInput && configId) {
        const secretResult = await saveProviderApiSecret({ configId, secret: apiKeyInput });
        if (!secretResult?.ok) {
          if (secretResult?.error_code === "credential_store_unavailable") {
            setFormError(copy("settings.cost.provider_api.error_credential_unavailable"));
          } else {
            setFormError(secretResult?.error || copy("settings.cost.provider_api.error_generic"));
          }
          // Config was saved but secret was not — keep the form open so the
          // user can retry. Clear the secret input regardless.
          setApiKeyInput("");
          return;
        }
      }
      // Clear the secret from state immediately after handling.
      setApiKeyInput("");
      await reload();
      setEditing(null);
    } catch (err) {
      setFormError(err?.message || copy("settings.cost.provider_api.error_generic"));
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
      const result = await testProviderApiConfig(config.id);
      const balance = result?.data?.balance;
      setCardState((prev) => ({
        ...prev,
        [config.id]: { ...(prev[config.id] || {}), testing: false, testResult: testResultFromBalance(balance) },
      }));
    } catch {
      setCardState((prev) => ({
        ...prev,
        [config.id]: { ...(prev[config.id] || {}), testing: false, testResult: { tone: "error", key: "settings.cost.provider_api.test_unknown" } },
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
    <section data-testid="provider-api-config-section" className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
            {copy("settings.cost.provider_api.section")}
          </h3>
          <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.cost.provider_api.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* F4: stale badge surfaces network failures without losing the last
              successful balance (the hook keeps it and marks `stale`). */}
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {copy("settings.cost.provider_api.stale")}
            </span>
          )}
          {editing === null && configs.length > 0 && (
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1.5 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
              {refreshing ? copy("settings.cost.provider_api.refreshing") : copy("settings.cost.provider_api.refresh_all")}
            </button>
          )}
          {editing === null && (
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex items-center gap-1 rounded-md bg-oai-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-oai-brand-700"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {copy("settings.cost.provider_api.add")}
            </button>
          )}
        </div>
      </div>

      {editing !== null ? (
        <ProviderApiConfigForm
          form={form}
          setField={setField}
          apiKeyInput={apiKeyInput}
          setApiKeyInput={setApiKeyInput}
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
        <div className="space-y-2">
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
    </section>
  );
}

function ProviderApiConfigCard({ config, state, balance, refreshing, onEdit, onDelete, onTest, onRefresh, onRevokeSecret }) {
  const statusKey = balance?.status
    ? statusLabelKey(balance.status)
    : "settings.cost.provider_api.status.not_connected";
  const testResult = state.testResult;
  const isSynced = balance?.status === "synced";
  // F4: financial fields are only meaningful when synced. For any other
  // status (not-connected / error / unsupported / never-refreshed) we render
  // "—" — NEVER 0. The balance object may be absent entirely (e.g. config has
  // no apiKeyRef yet), which also yields "—".
  const balanceValue = isSynced
    ? formatFinancialValue(balance?.balance, balance?.currency)
    : copy("settings.cost.provider_api.data_unknown");
  const monthSpendValue = isSynced
    ? formatFinancialValue(balance?.monthSpend, balance?.currency)
    : copy("settings.cost.provider_api.data_unknown");
  const lifetimeSpendValue = isSynced
    ? formatFinancialValue(balance?.lifetimeSpend, balance?.currency)
    : copy("settings.cost.provider_api.data_unknown");
  const currencyValue = isSynced && balance?.currency
    ? balance.currency
    : copy("settings.cost.provider_api.data_unknown");

  return (
    <div className="rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {config.label}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {config.providerId}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400" title={copy("settings.cost.provider_api.url_masked")}>
              {maskUrl(config.requestUrl)}
            </span>
            <span className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-xs",
              balance?.status === "synced"
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : balance?.status === "unsupported"
                  ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                  : "bg-oai-gray-50 text-oai-gray-500 dark:bg-oai-gray-900/20 dark:text-oai-gray-400"
            )}>
              {copy(statusKey)}
            </span>
            {!config.enabled && (
              <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-400 dark:bg-oai-gray-800">
                {copy("settings.cost.provider_api.form.enabled")}
              </span>
            )}
          </div>
          {/* F4: financial data row — balance / monthSpend / lifetimeSpend /
              currency, auto-loaded from the 02 endpoints via the shared hook.
              Unknown values render "—"; a real 0 from the provider renders
              "0.00". This row is the core F4 fix: previously the card only
              showed lastSyncedAt + masked_saved and never rendered amounts. */}
          <div
            data-testid={`provider-api-card-financial-${config.id}`}
            className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-600 dark:text-oai-gray-300 tabular-nums"
          >
            <span>
              {copy("settings.cost.provider_api.balance")}:{" "}
              <span data-testid={`provider-api-card-balance-${config.id}`}>{balanceValue}</span>
            </span>
            <span>
              {copy("settings.cost.provider_api.month_spend")}:{" "}
              <span data-testid={`provider-api-card-month-spend-${config.id}`}>{monthSpendValue}</span>
            </span>
            <span>
              {copy("settings.cost.provider_api.lifetime_spend")}:{" "}
              <span data-testid={`provider-api-card-lifetime-spend-${config.id}`}>{lifetimeSpendValue}</span>
            </span>
            <span>
              {copy("settings.cost.provider_api.currency")}:{" "}
              <span data-testid={`provider-api-card-currency-${config.id}`}>{currencyValue}</span>
            </span>
            {balance?.lastSyncedAt && (
              <span>{copy("settings.cost.provider_api.last_synced")}: {balance.lastSyncedAt}</span>
            )}
            {config.apiKeyRef && (
              <span>{copy("settings.cost.provider_api.masked_saved")}</span>
            )}
          </div>
          {testResult && (
            <div className={cn(
              "mt-2 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs",
              testResult.tone === "success"
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : testResult.tone === "warn"
                  ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                  : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
            )}>
              {testResult.tone === "success"
                ? <CheckCircle className="h-3 w-3" aria-hidden="true" />
                : <AlertCircle className="h-3 w-3" aria-hidden="true" />}
              {copy(testResult.key)}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
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
          {config.apiKeyRef && (
            <button
              type="button"
              onClick={onRevokeSecret}
              disabled={state.deleting}
              title={copy("settings.cost.provider_api.masked_saved")}
              className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-500 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:hover:bg-oai-gray-800"
            >
              <XCircle className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
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
      </div>
    </div>
  );
}

function ProviderApiConfigForm({
  form,
  setField,
  apiKeyInput,
  setApiKeyInput,
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

  return (
    <div className="space-y-3 rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <h4 className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
        {isEdit ? copy("settings.cost.provider_api.form.title_edit") : copy("settings.cost.provider_api.form.title_add")}
      </h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("settings.cost.provider_api.form.provider")}>
          <input
            type="text"
            value={form.providerId}
            onChange={(e) => setField("providerId", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("settings.cost.provider_api.form.label")}>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setField("label", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

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

      <div className="rounded-md bg-oai-gray-50 px-3 py-2 text-xs text-oai-gray-600 dark:bg-oai-gray-900 dark:text-oai-gray-300">
        {copy("settings.cost.provider_api.form.auto_hint")}
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-left text-xs font-medium text-oai-brand-600 hover:text-oai-brand-700 dark:text-oai-brand-400"
      >
        {showAdvanced
          ? copy("settings.cost.provider_api.form.advanced_hide")
          : copy("settings.cost.provider_api.form.advanced_show")}
      </button>

      {showAdvanced && (
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

      {/* API Key — one-time secret input. Never prefilled; type=password so the
          value never renders as plain text in the DOM. Cleared after submit. */}
        </>
      )}

      <FormField label={copy("settings.cost.provider_api.form.api_key")}>
        <input
          type="password"
          autoComplete="off"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder={hasExistingKey ? copy("settings.cost.provider_api.form.api_key_placeholder") : ""}
          className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          // The secret is intentionally not mirrored into any data-* attribute.
        />
        <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {hasExistingKey
            ? copy("settings.cost.provider_api.form.api_key_placeholder")
            : copy("settings.cost.provider_api.form.api_key_hint_new")}
        </p>
      </FormField>

      {showAdvanced && (
        <>
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

      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

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
          disabled={saving}
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
