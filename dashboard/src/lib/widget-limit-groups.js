import { tokenPlanValidityState } from "./token-plan-validity.js";

export function groupWidgetLimits(limits) {
  const groups = new Map();
  for (const limit of Array.isArray(limits) ? limits : []) {
    const planId = String(limit?.planId || limit?.id || "");
    if (!planId) continue;
    if (!groups.has(planId)) {
      groups.set(planId, {
        id: planId,
        planId,
        agent: limit.agent,
        provider: limit.provider,
        planLabel: limit.planLabel,
        catalogPlanId: limit.catalogPlanId,
        reportedPlanName: limit.reportedPlanName,
        accountLabel: limit.accountLabel,
        subscriptionAmount: limit.subscriptionAmount,
        subscriptionCurrency: limit.subscriptionCurrency,
        usedPercent: limit.usedPercent,
        resetAt: limit.resetAt,
        startsAt: limit.startsAt,
        expiresAt: limit.expiresAt,
        notes: limit.notes,
        error: limit.error,
        windows: [],
      });
    }
    const group = groups.get(planId);
    group.windows.push(limit);
    if (limit.usedPercent != null && (group.usedPercent == null || limit.usedPercent > group.usedPercent)) {
      group.usedPercent = limit.usedPercent;
    }
    if (!group.error && limit.error) group.error = limit.error;
    if (!group.startsAt && limit.startsAt) group.startsAt = limit.startsAt;
    if (!group.expiresAt && limit.expiresAt) group.expiresAt = limit.expiresAt;
  }
  return Array.from(groups.values());
}

export function splitWidgetLimitGroups(groups, now = new Date()) {
  const result = { active: [], scheduled: [], expired: [] };
  for (const group of Array.isArray(groups) ? groups : []) {
    const state = tokenPlanValidityState({
      provider_id: group?.agent,
      plan_id: group?.catalogPlanId,
      reportedPlanName: group?.reportedPlanName,
      subscription_start_date: group?.startsAt,
      subscription_end_date: group?.expiresAt,
    }, now);
    result[state].push(group);
  }
  return result;
}

export function widgetLimitGroupSelected(group, selectedIds) {
  if (selectedIds == null) return true;
  const selected = new Set(selectedIds);
  return group.windows.some((limit) => selected.has(limit.id));
}
