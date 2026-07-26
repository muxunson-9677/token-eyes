import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../../components";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { formatCompactNumber } from "../../../lib/format";
import { getTokenPlans } from "../../../lib/api";
import { ProviderIcon } from "./ProviderIcon";
import { getProviderColor } from "./UsageOverview.jsx";

/**
 * 使用统计页右栏「Token 服务列表」。展示用户在成本设置里配置好的、
 * 在用 Token 套餐的额度用量（已用 / 总量 / 百分比 + 进度条 + 状态）。
 *
 * 数据源是 token plans（getTokenPlans → config.tokenPlans），与「供应商
 * API 财务余额」「Claude/Cursor 官方限流窗口」是三套不同的东西，这里只读
 * token 套餐额度。当 total_quota 缺失时进度条不渲染，避免把"未知"显示成 0。
 */

const WARN_THRESHOLD = 85;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatQuota(value) {
  const n = toNum(value);
  if (n === null) return "—";
  if (n <= 0) return "0";
  return formatCompactNumber(n, {
    decimals: n >= 1_000_000 ? 2 : 0,
    thousandSuffix: "K",
    millionSuffix: "M",
    billionSuffix: "B",
  });
}

function derivePlan(plan) {
  const total = toNum(plan.total_quota);
  let used = toNum(plan.used_quota);
  const remaining = toNum(plan.remaining_quota);
  if (used === null && total !== null && remaining !== null) {
    used = Math.max(0, total - remaining);
  }
  const hasQuota = total !== null && total > 0;
  const pct = hasQuota && used !== null ? Math.min(100, Math.max(0, (used / total) * 100)) : null;
  const providerKey = String(plan.provider_id || plan.source || "").toUpperCase();
  return {
    id: plan.id,
    name: plan.plan_label || plan.provider_id || plan.source || copy("spend.usage.token_services.unknown_quota"),
    providerKey,
    totalDisplay: plan.total_quota_display || formatQuota(total),
    usedDisplay: formatQuota(used),
    hasQuota,
    pct,
  };
}

function statusFor(pct) {
  if (pct === null) return null;
  if (pct >= 100) return { key: "status_full", tone: "danger" };
  if (pct >= WARN_THRESHOLD) return { key: "status_warn", tone: "danger" };
  return { key: "status_ok", tone: "ok" };
}

export function TokenServiceListPanel({ refreshRevision = 0, className }) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTokenPlans()
      .then((result) => {
        if (cancelled) return;
        setPlans(Array.isArray(result?.records) ? result.records : []);
      })
      .catch((err) => {
        console.warn("[TokenServiceListPanel] failed to load token plans:", err);
        if (!cancelled) setPlans([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshRevision]);

  const items = useMemo(() => plans.map(derivePlan), [plans]);

  return (
    <Card className={cn("", className)} bodyClassName="p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-oai-black dark:text-white">
          {copy("spend.usage.token_services.title")}
        </h2>
        <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("spend.usage.token_services.subtitle")}
        </p>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-oai-gray-400">
          {copy("spend.usage.token_services.loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-oai-gray-200 p-4 text-center dark:border-oai-gray-800">
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {copy("spend.usage.token_services.empty")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/settings/cost")}
            className="mt-1 inline-block text-xs font-medium text-oai-blue-600 hover:underline dark:text-oai-blue-400"
          >
            {copy("spend.usage.token_services.empty_cta")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, index) => {
            const status = statusFor(item.pct);
            const brandColor = item.providerKey ? getProviderColor(item.providerKey, index) : null;
            const barColor = status?.tone === "danger" ? "bg-red-500" : "bg-green-500";
            return (
              <div
                key={item.id || `${item.providerKey}-${index}`}
                className="rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: brandColor ? `${brandColor}18` : undefined,
                        color: brandColor || undefined,
                      }}
                    >
                      <ProviderIcon
                        provider={item.providerKey}
                        size={16}
                        color={brandColor || undefined}
                      />
                    </span>
                    <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                      {item.name}
                    </span>
                  </div>
                  {status && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        status.tone === "danger"
                          ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                          : "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400",
                      )}
                    >
                      {copy(`spend.usage.token_services.${status.key}`)}
                    </span>
                  )}
                </div>

                {item.hasQuota ? (
                  <>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-700">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${item.pct ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      <span>
                        {copy("spend.usage.token_services.used")}: {item.usedDisplay}
                      </span>
                      <span>
                        {copy("spend.usage.token_services.total")}: {item.totalDisplay}
                      </span>
                      <span className="font-semibold tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
                        {item.pct === null ? "—" : `${Math.round(item.pct)}%`}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-xs text-oai-gray-400">
                    {copy("spend.usage.token_services.unknown_quota")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
