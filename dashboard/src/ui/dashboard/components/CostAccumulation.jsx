import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, CreditCard, Package, Globe, RefreshCw, AlertCircle, CheckCircle, Plus, Pencil, Trash2, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";

/**
 * CostAccumulation component (03-cost-billing).
 *
 * Displays four rendered sections; detailed subscription records are intentionally omitted.
 * 1. Cost Summary (top cards)
 * 2. Token 套餐 (Token Packages)
 * 3. 供应商账户 (Provider API Account balances — from 02 financial endpoints)
 * 4. API 计费 (API Billing — local usage cost aggregation)
 * 5. 订阅记录 (Subscription Records — with CRUD)
 *
 * Hard boundaries (03 work order):
 * - Provider API balances come ONLY from 02's financial endpoints
 *   (useProviderApiBalances). Local token costs are NEVER substituted for
 *   balances, and the two are NEVER summed (different semantics).
 * - This component NEVER renders an API Key input — keys live only in
 *   /settings/cost. The "前往成本设置配置" link navigates there.
 * - Unknown / failed / not-connected values render "—" — never 0.
 */

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// F6/02 work order (未知成本不得显示 0): formatAmount now distinguishes a
// missing value (null/undefined/NaN → "—") from a real 0 (→ "0.00"). This
// stops the UI from faking a zero cost when the backend field is absent.
function formatAmount(value, currency = "USD") {
  if (value === null || value === undefined) return "—";
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "—";
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Pure MoM copy helper — exported for contract/unit tests. */
export function getMonthComparison(currentUsd, previousUsd, usdToCny) {
  if (!Number.isFinite(Number(currentUsd)) || !Number.isFinite(Number(previousUsd))) return null;
  const current = Number(currentUsd);
  const previous = Number(previousUsd);
  if (previous === 0) {
    if (current === 0) {
      return { label: copy("spend.monthly_change.flat"), className: "text-oai-gray-400 dark:text-oai-gray-500" };
    }
    return {
      label: copy("spend.monthly_change.new_amount", { amount: formatAmount(current * usdToCny, "CNY") }),
      className: "text-emerald-600 dark:text-emerald-400",
    };
  }
  const percentage = Math.abs(((current - previous) / previous) * 100).toFixed(1);
  if (current > previous) {
    return { label: copy("spend.monthly_change.increase", { value: percentage }), className: "text-emerald-600 dark:text-emerald-400" };
  }
  if (current < previous) {
    return { label: copy("spend.monthly_change.decrease", { value: percentage }), className: "text-emerald-600 dark:text-emerald-400" };
  }
  return { label: copy("spend.monthly_change.flat"), className: "text-oai-gray-400 dark:text-oai-gray-500" };
}

function formatDualAmount(usd, cny, comparison = null) {
  // If the USD total is missing, both lines show "—" — never fake 0. The CNY
  // argument is derived as `usd * usdToCny` by the caller, so when usd is null
  // the caller must not pass a faked 0; we guard on usd here regardless.
  if (usd === null || usd === undefined) {
    return (
      <div className="flex flex-col">
        <span className="tabular-nums">—</span>
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">—</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{formatAmount(usd, "USD")}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
        <span>{formatAmount(cny, "CNY")}</span>
        {comparison ? (
          <span data-testid={`monthly-cost-comparison-${comparison.id}`} className={cn("text-[10px] font-medium", comparison.className)}>
            {comparison.label}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function formatQuotaDisplay(quota) {
  if (!quota && quota !== 0) return "—";
  return quota;
}

// Render a financial value or "—" when unknown/missing.
// NEVER renders 0 for unknown — only real 0 from the provider is shown.
function formatFinancialValue(value, currency, formatter = formatAmount) {
  if (value === null || value === undefined) return "—";
  if (Number.isNaN(Number(value))) return "—";
  return formatter(value, currency);
}

// ---------------------------------------------------------------------------
// Cost Summary Cards
// ---------------------------------------------------------------------------

function CostSummaryCards({ summary, loading }) {
  if (loading) {
    return (
      <div className="mb-6 grid gap-2 grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl border border-oai-gray-200 bg-white p-3 shadow-oai-sm dark:border-oai-gray-800 dark:bg-oai-gray-900 animate-pulse">
            <div className="h-3 w-20 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
            <div className="mt-2 h-5 w-16 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const comparison = (id, current, previous) => {
    const value = getMonthComparison(current, previous, summary.usdToCny);
    return value ? { id, ...value } : null;
  };

  return (
    <div className="mb-6 grid gap-2 grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label={copy("spend.cost.summary.month_api")}
        value={formatDualAmount(
          summary.monthApiCostUsd,
          summary.monthApiCostUsd * summary.usdToCny,
          comparison("api", summary.monthApiCostUsd, summary.previousMonthApiCostUsd),
        )}
      />
      <SummaryCard
        label={copy("spend.cost.summary.month_subscription")}
        value={formatDualAmount(
          summary.monthSubscriptionCostUsd,
          summary.monthSubscriptionCostUsd * summary.usdToCny,
          comparison("subscription", summary.monthSubscriptionCostUsd, summary.previousMonthSubscriptionCostUsd),
        )}
      />
      <SummaryCard
        label={copy("spend.cost.summary.month_total")}
        value={formatDualAmount(
          summary.monthTotalCostUsd,
          summary.monthTotalCostUsd * summary.usdToCny,
          comparison("total", summary.monthTotalCostUsd, summary.previousMonthTotalCostUsd),
        )}
        highlight
      />
      <SummaryCard
        label={copy("spend.cost.summary.lifetime_total")}
        value={formatDualAmount(summary.lifetimeTotalCostUsd, summary.lifetimeTotalCostUsd * summary.usdToCny)}
      />
    </div>
  );
}

function SummaryCard({ label, value, highlight = false }) {
  return (
    <div className={cn(
      "rounded-xl border bg-white p-4 shadow-oai-sm transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:shadow-oai-md dark:bg-oai-gray-900",
      highlight
        ? "border-oai-brand-300 bg-oai-brand-50 dark:border-oai-brand-700 dark:bg-oai-brand-900/20"
        : "border-oai-gray-200 dark:border-oai-gray-800"
    )}>
      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className={cn(
        "mt-1 text-lg font-semibold",
        highlight ? "text-oai-brand-600 dark:text-oai-brand-400" : "text-oai-gray-900 dark:text-oai-gray-100"
      )}>
        {value}
      </div>
    </div>
  );
}

function OtherAiGroupCostSection({ groups = [] }) {
  if (!groups.length) return null;
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
          {copy("spend.cost.other_ai_groups.section")}
        </h3>
      </div>
      <div data-testid="compact-cost-group-grid" className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {groups.map((group) => (
          <article key={group.group_id || "ungrouped"} data-testid={`compact-cost-group-${group.group_id || "ungrouped"}`} data-layout="compact-cost-group" data-density="ultra-compact" className="rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h4 className="truncate text-xs font-semibold text-oai-gray-900 dark:text-oai-gray-100">{group.group_name}</h4>
              <span className="rounded-full bg-oai-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-oai-gray-500 dark:bg-oai-gray-800">{group.record_count}</span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-oai-gray-100 dark:divide-oai-gray-800">
              {[
                ["month", group.month_usd, group.month_cny],
                ["year", group.year_usd, group.year_cny],
                ["lifetime", group.lifetime_usd, group.lifetime_cny],
              ].map(([period, usd, cny]) => (
                <div key={period} className="min-w-0 px-1 py-0.5">
                  <div className="text-[10px] text-oai-gray-500 dark:text-oai-gray-400">{copy(`spend.cost.other_ai_groups.${period}`)}</div>
                  <div className="truncate text-[11px] font-semibold">{formatDualAmount(usd, cny)}</div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Token Package Section
// ---------------------------------------------------------------------------

function TokenPackageSection({ packages, loading }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-4" data-testid="token-package-collapsible">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mb-3 flex w-full items-center justify-between rounded-xl border border-oai-gray-200 bg-white px-3 py-2 text-left dark:border-oai-gray-800 dark:bg-oai-gray-900">
        <SectionHeader icon={Package} title={copy("spend.cost.token_package.section")} count={packages.length} />
        {open ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
      </button>
      {open ? <>
      {loading ? (
        <LoadingSkeleton />
      ) : packages.length === 0 ? (
        <EmptyState message={copy("spend.cost.token_package.empty")} />
      ) : (
        <div className="space-y-2">
          {packages.map((pkg) => (
            <TokenPackageCard key={pkg.id} package={pkg} />
          ))}
        </div>
      )}</> : null}
    </section>
  );
}

function TokenPackageCard({ package: pkg }) {
  const syncStatusColor = {
    synced: "text-green-600 dark:text-green-400",
    success: "text-green-600 dark:text-green-400",
    not_configured: "text-oai-gray-400",
    auth_required: "text-yellow-600 dark:text-yellow-400",
    syncing: "text-blue-600 dark:text-blue-400",
    failed: "text-red-600 dark:text-red-400",
    error: "text-red-600 dark:text-red-400",
    reauth_required: "text-orange-600 dark:text-orange-400",
    unsupported: "text-oai-gray-400",
  };

  return (
    <div className="rounded-xl border border-oai-gray-200 bg-white p-4 shadow-oai-sm transition-[border-color,box-shadow] hover:border-oai-gray-300 hover:shadow-oai-md dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:hover:border-oai-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {pkg.name}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {pkg.provider}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>{copy("spend.cost.token_package.quota")}: {formatQuotaDisplay(pkg.quota)}</span>
            <span>{copy("spend.cost.token_package.used")}: {formatQuotaDisplay(pkg.used)}</span>
            <span>{copy("spend.cost.token_package.remaining")}: {formatQuotaDisplay(pkg.remaining)}</span>
            {pkg.expiresAt && (
              <span>{copy("spend.cost.token_package.expires_at")}: {pkg.expiresAt}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-xs", syncStatusColor[pkg.syncStatus] || "text-oai-gray-400")}>
            {pkg.syncStatusLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider API Account Section (NEW — 03 work order, data from 02 endpoints)
// ---------------------------------------------------------------------------

function statusBadgeKey(status) {
  if (status === "synced") return "spend.cost.provider_account.status.synced";
  if (status === "not-connected") return "spend.cost.provider_account.status.not_connected";
  if (status === "unsupported") return "spend.cost.provider_account.status.unsupported";
  return "spend.cost.provider_account.status.error";
}

function statusBadgeClass(status) {
  if (status === "synced") {
    return "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400";
  }
  if (status === "unsupported") {
    return "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400";
  }
  if (status === "not-connected") {
    return "bg-oai-gray-50 text-oai-gray-500 dark:bg-oai-gray-900/20 dark:text-oai-gray-400";
  }
  return "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
}

function ProviderApiAccountSection({
  balances,
  refreshing,
  refreshingIds,
  stale,
  lastUpdatedAt,
  onRefreshAll,
  onRefreshOne,
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const hasBalances = Array.isArray(balances) && balances.length > 0;

  return (
    <section className="mb-4" data-testid="provider-api-account-section">
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-oai-gray-200 bg-white px-3 py-2 dark:border-oai-gray-800 dark:bg-oai-gray-900">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex flex-1 items-center justify-between text-left">
        <SectionHeader
          icon={Globe}
          title={copy("spend.cost.provider_account.section")}
          count={hasBalances ? balances.length : 0}
        />
        {open ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
        </button>
        <div className="flex items-center gap-2">
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {copy("spend.cost.provider_account.stale")}
            </span>
          )}
          {hasBalances && (
            <button
              type="button"
              onClick={onRefreshAll}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden="true" />
              {refreshing ? copy("spend.cost.provider_account.refreshing") : copy("spend.cost.provider_account.refresh_all")}
            </button>
          )}
        </div>
      </div>
      {open ? <>
      {!hasBalances ? (
        <EmptyState message={copy("spend.cost.provider_account.empty")} />
      ) : (
        <div className="space-y-2">
          {balances.map((balance) => (
            <ProviderApiAccountCard
              key={balance.configId || balance.providerId}
              balance={balance}
              refreshing={Boolean(refreshingIds && refreshingIds.has(balance.configId))}
              onRefresh={() => onRefreshOne(balance.configId)}
            />
          ))}
        </div>
      )}

      {/* Config entry — navigates to /settings/cost. NO key editing here. */}
      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => navigate("/settings/cost")}
          className="inline-flex items-center gap-1 text-xs text-oai-brand-600 hover:underline dark:text-oai-brand-400"
        >
          <Settings className="h-3 w-3" aria-hidden="true" />
          {copy("spend.cost.provider_account.config_link")}
        </button>
      </div>
      </> : null}
    </section>
  );
}

function ProviderApiAccountCard({ balance, refreshing, onRefresh }) {
  const status = balance?.status || "not-connected";
  const isSynced = status === "synced";
  // Unknown/missing financial values render "—" — never 0.
  const balanceValue = isSynced ? formatFinancialValue(balance?.balance, balance?.currency) : "—";
  const monthSpendValue = isSynced ? formatFinancialValue(balance?.monthSpend, balance?.currency) : "—";
  const lifetimeSpendValue = isSynced ? formatFinancialValue(balance?.lifetimeSpend, balance?.currency) : "—";
  const currencyValue = isSynced ? (balance?.currency || "—") : "—";

  return (
    <div className="rounded-xl border border-oai-gray-200 bg-white p-4 shadow-oai-sm transition-[border-color,box-shadow] hover:border-oai-gray-300 hover:shadow-oai-md dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:hover:border-oai-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {balance?.accountLabel || balance?.providerId || "—"}
            </span>
            {balance?.providerId && (
              <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                {balance.providerId}
              </span>
            )}
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs", statusBadgeClass(status))}>
              {copy(statusBadgeKey(status))}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>
              {copy("spend.cost.provider_account.balance")}: {balanceValue}
            </span>
            <span>
              {copy("spend.cost.provider_account.month_spend")}: {monthSpendValue}
            </span>
            <span>
              {copy("spend.cost.provider_account.lifetime_spend")}: {lifetimeSpendValue}
            </span>
            <span>
              {copy("spend.cost.provider_account.currency")}: {currencyValue}
            </span>
            {balance?.lastSyncedAt && (
              <span>
                {copy("spend.cost.provider_account.last_synced")}: {balance.lastSyncedAt}
              </span>
            )}
          </div>
          {/* Error message line — shows actionable reason for error status. */}
          {status === "error" && balance?.errorMessage && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
              {balance.errorMessage}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || !balance?.configId}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 disabled:opacity-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          aria-label={copy("spend.cost.provider_account.refresh_all")}
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Billing Section (existing — local usage cost aggregation)
// ---------------------------------------------------------------------------

function ApiBillingSection({ accounts, loading }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-4" data-testid="api-billing-collapsible">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mb-3 flex w-full items-center justify-between rounded-xl border border-oai-gray-200 bg-white px-3 py-2 text-left dark:border-oai-gray-800 dark:bg-oai-gray-900">
        <SectionHeader icon={Globe} title={copy("spend.cost.api_billing.section")} count={accounts.length} />
        {open ? <ChevronUp className="h-4 w-4 text-oai-gray-400" /> : <ChevronDown className="h-4 w-4 text-oai-gray-400" />}
      </button>
      {open ? <>
      {loading ? (
        <LoadingSkeleton />
      ) : accounts.length === 0 ? (
        <EmptyState message={copy("spend.cost.api_billing.empty")} />
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <ApiBillingCard key={account.id} account={account} />
          ))}
        </div>
      )}</> : null}
    </section>
  );
}

function ApiBillingCard({ account }) {
  const statusConfig = {
    synced: { icon: CheckCircle, color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
    "not-connected": { icon: AlertCircle, color: "text-oai-gray-400", bg: "bg-oai-gray-50 dark:bg-oai-gray-900/20" },
    error: { icon: AlertCircle, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-900/20" },
  };

  const status = statusConfig[account.status] || statusConfig["not-connected"];
  const StatusIcon = status.icon;
  const hasCostData = account.status === "synced";

  return (
    <div className="rounded-xl border border-oai-gray-200 bg-white p-4 shadow-oai-sm transition-[border-color,box-shadow] hover:border-oai-gray-300 hover:shadow-oai-md dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:hover:border-oai-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {account.accountName}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {account.provider}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {getBillingSourceLabel(account.billingSource)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>{copy("spend.cost.api_billing.month_cost")}: {hasCostData ? formatAmount(account.monthCostUsd) : "—"}</span>
            <span>{copy("spend.cost.api_billing.lifetime_cost")}: {hasCostData ? formatAmount(account.lifetimeCostUsd) : "—"}</span>
            {account.lastSyncedAt && (
              <span>{copy("spend.cost.api_billing.last_synced")}: {account.lastSyncedAt}</span>
            )}
          </div>
        </div>
        <div className={cn("shrink-0 rounded-full p-1", status.bg)}>
          <StatusIcon className={cn("h-4 w-4", status.color)} />
        </div>
      </div>
    </div>
  );
}

function getBillingSourceLabel(source) {
  const labels = {
    api: copy("spend.cost.api_billing.source.api"),
    console: copy("spend.cost.api_billing.source.console"),
    manual: copy("spend.cost.api_billing.source.manual"),
  };
  return labels[source] || copy("spend.cost.api_billing.source.unknown");
}

// ---------------------------------------------------------------------------
// Subscription Records Section (with CRUD — 03 work order task 4)
// ---------------------------------------------------------------------------

const SUBSCRIPTION_DEFAULT_FORM = {
  name: "",
  provider: "",
  amount: "",
  currency: "USD",
  cycle: "monthly",
  start_date: "",
  end_date: "",
  note: "",
};

function SubscriptionSection({ records, loading, onAdd, onEdit, onDelete }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionHeader
          icon={CreditCard}
          title={copy("spend.cost.subscription.section")}
          count={records.length}
        />
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md bg-oai-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-oai-brand-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {copy("spend.cost.subscription.add")}
        </button>
      </div>

      {/* Separate-columns note — subscription fees vs provider API spend. */}
      <p className="mb-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy("spend.cost.subscription.note_separate")}
      </p>

      {loading ? (
        <LoadingSkeleton />
      ) : records.length === 0 ? (
        <EmptyState message={copy("spend.cost.subscription.empty")} />
      ) : (
        <div className="space-y-2">
          {records.map((record) => (
            <SubscriptionCard
              key={record.id}
              record={record}
              onEdit={() => onEdit(record)}
              onDelete={() => onDelete(record)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SubscriptionCard({ record, onEdit, onDelete }) {
  const statusConfig = {
    active: { label: copy("spend.cost.subscription.status.active"), color: "text-green-600 dark:text-green-400" },
    expired: { label: copy("spend.cost.subscription.status.expired"), color: "text-oai-gray-400" },
    cancelled: { label: copy("spend.cost.subscription.status.cancelled"), color: "text-red-600 dark:text-red-400" },
  };

  const cycleLabels = {
    monthly: copy("spend.cycle_monthly"),
    yearly: copy("spend.cycle_yearly"),
    one_time: copy("spend.cycle_one_time"),
  };

  const status = statusConfig[record.status] || statusConfig.active;

  return (
    <div className="rounded-xl border border-oai-gray-200 bg-white p-4 shadow-oai-sm transition-[border-color,box-shadow] hover:border-oai-gray-300 hover:shadow-oai-md dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:hover:border-oai-gray-700">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
              {record.name}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {record.provider}
            </span>
            <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
              {cycleLabels[record.cycle] || record.cycle}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>{formatAmount(record.amount, record.currency)}</span>
            {record.startedAt && <span>{copy("spend.cost.subscription.started_at")}: {record.startedAt}</span>}
            {record.renewsAt && <span>{copy("spend.cost.subscription.renews_at")}: {record.renewsAt}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={cn("text-xs font-medium", status.color)}>
            {status.label}
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            aria-label={copy("spend.cost.subscription.edit")}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            {copy("spend.cost.subscription.edit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
            aria-label={copy("spend.cost.subscription.delete")}
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            {copy("spend.cost.subscription.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Subscription add/edit form (inline modal-style block).
// Fields map to the spend record API: source, plan_label, amount, currency,
// billing_cycle, start_date, end_date, note.
function SubscriptionForm({ initial, onSave, onCancel, saving, formError }) {
  const [form, setForm] = useState(() => ({
    ...SUBSCRIPTION_DEFAULT_FORM,
    name: initial?.name || "",
    provider: initial?.provider || "",
    amount: initial?.amount !== undefined ? String(initial.amount) : "",
    currency: initial?.currency || "USD",
    cycle: initial?.cycle || "monthly",
    start_date: initial?.startedAt || "",
    end_date: initial?.renewsAt || "",
    note: initial?.note || "",
  }));

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isEdit = Boolean(initial?.id);

  const handleSave = () => {
    onSave({
      id: initial?.id,
      source: form.provider.trim(),
      plan_label: form.name.trim(),
      amount: Number(form.amount) || 0,
      currency: form.currency.trim().toUpperCase() || "USD",
      billing_cycle: form.cycle,
      start_date: form.start_date,
      end_date: form.end_date,
      note: form.note.trim(),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800" data-testid="subscription-form">
      <h4 className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
        {isEdit ? copy("spend.cost.subscription.form.title_edit") : copy("spend.cost.subscription.form.title_add")}
      </h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("spend.cost.subscription.form.name")}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.provider")}>
          <input
            type="text"
            value={form.provider}
            onChange={(e) => setField("provider", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={copy("spend.cost.subscription.form.amount")}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setField("amount", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.currency")}>
          <select
            value={form.currency}
            onChange={(e) => setField("currency", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="USD">{copy("spend.cost.subscription.form.currency")} USD</option>
            <option value="CNY">{copy("spend.cost.subscription.form.currency")} CNY</option>
          </select>
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.cycle")}>
          <select
            value={form.cycle}
            onChange={(e) => setField("cycle", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          >
            <option value="monthly">{copy("spend.cycle_monthly")}</option>
            <option value="yearly">{copy("spend.cycle_yearly")}</option>
            <option value="one_time">{copy("spend.cycle_one_time")}</option>
          </select>
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={copy("spend.cost.subscription.form.start_date")}>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setField("start_date", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
        <FormField label={copy("spend.cost.subscription.form.end_date")}>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setField("end_date", e.target.value)}
            className="w-full rounded-md border border-oai-gray-200 px-2 py-1.5 text-sm dark:border-oai-gray-700 dark:bg-oai-gray-900"
          />
        </FormField>
      </div>

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
          {copy("spend.cost.subscription.form.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-oai-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-oai-brand-700 disabled:opacity-50"
        >
          {copy("spend.cost.subscription.form.save")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helper components
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, title, count }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" />
      <h3 className="text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">{title}</h3>
      {count > 0 && (
        <span className="rounded-full bg-oai-gray-100 px-2 py-0.5 text-xs text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-lg border border-oai-gray-200 p-4 text-center text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
      {message}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
      <div className="animate-pulse space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-12 bg-oai-gray-200 dark:bg-oai-gray-700 rounded" />
        ))}
      </div>
    </div>
  );
}

function FormField({ label, hint, children }) {
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

// ---------------------------------------------------------------------------
// Main CostAccumulation component
// ---------------------------------------------------------------------------

export function CostAccumulation({
  tokenPackages = [],
  apiBillingAccounts = [],
  subscriptionRecords = [],
  costSummary = {
    monthApiCostUsd: 0,
    monthSubscriptionCostUsd: 0,
    monthTotalCostUsd: 0,
    lifetimeTotalCostUsd: 0,
    usdToCny: 7.2,
  },
  otherAiGroupCosts = [],
  loading = false,
  error = null,
  // 03 work order: provider API account balances from 02 endpoints.
  providerApiBalances = [],
  providerApiRefreshing = false,
  providerApiRefreshingIds = new Set(),
  providerApiStale = false,
  providerApiLastUpdatedAt = null,
  onRefreshAllProviderApis,
  onRefreshOneProviderApi,
  // 03 work order: subscription CRUD handlers.
  subscriptionFormState = null, // null | "new" | record
  subscriptionFormSaving = false,
  subscriptionFormError = null,
  onAddSubscription,
  onEditSubscription,
  onSaveSubscription,
  onDeleteSubscription,
  onCancelSubscriptionForm,
}) {
  return (
    <div className="space-y-6">
      {/* Cost Summary */}
      <CostSummaryCards summary={costSummary} loading={loading} />
      <OtherAiGroupCostSection groups={otherAiGroupCosts} />

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}

      {/* Token Packages */}
      <TokenPackageSection packages={tokenPackages} loading={loading} />

      {/* Provider API Accounts (NEW — 03 work order, data from 02 endpoints) */}
      <ProviderApiAccountSection
        balances={providerApiBalances}
        refreshing={providerApiRefreshing}
        refreshingIds={providerApiRefreshingIds}
        stale={providerApiStale}
        lastUpdatedAt={providerApiLastUpdatedAt}
        onRefreshAll={onRefreshAllProviderApis}
        onRefreshOne={onRefreshOneProviderApi}
      />

      {/* API Billing (existing — local usage cost aggregation) */}
      <ApiBillingSection accounts={apiBillingAccounts} loading={loading} />

    </div>
  );
}
