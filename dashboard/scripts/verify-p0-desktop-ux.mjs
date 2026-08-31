import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import {
  createTemporaryDashboardServerConfig,
  getEphemeralPort,
} from "./visual-baseline-runtime.js";

const hostname = "127.0.0.1";
const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(dashboardRoot, "..");
const referenceMode = process.env.TOKEN_EYES_REFERENCE_UI === "1";
const referenceScenarioFilter = process.env.TOKEN_EYES_REFERENCE_SCENARIO?.trim();
const resetGeometryOnly = process.env.TOKEN_EYES_RESET_GEOMETRY_ONLY === "1";
const keyboardJourneyOnly = process.env.TOKEN_EYES_KEYBOARD_JOURNEY_ONLY === "1";
const referenceContractOnly = process.env.TOKEN_EYES_REFERENCE_CONTRACT_ONLY === "1";
const outputDir = path.join(
  repoRoot,
  "docs",
  "screenshots",
  referenceMode ? "token-eyes-reference-ui" : "p0-restoration-2026-08-01",
);
const port = await getEphemeralPort(hostname);
if (referenceMode) {
  process.env.VITE_LEADERBOARD_PUBLIC_BASE_URL = `http://${hostname}:${port}/functions`;
}
const originalWorkingDirectory = process.cwd();
process.chdir(dashboardRoot);
const dashboardServerConfig = createTemporaryDashboardServerConfig({
  dashboardRoot,
  hostname,
  port,
});
if (referenceMode) {
  dashboardServerConfig.define = {
    "import.meta.env.VITE_LEADERBOARD_PUBLIC_BASE_URL": JSON.stringify(`http://${hostname}:${port}/functions`),
  };
}
const server = await createServer(dashboardServerConfig);

const p0Scenarios = [
  { name: "dashboard-zh-light-900x600", page: "dashboard", route: "/dashboard", width: 900, height: 600, locale: "zh-CN", theme: "light" },
  { name: "dashboard-zh-dark-stale-900x600", page: "dashboard", route: "/dashboard", width: 900, height: 600, locale: "zh-CN", theme: "dark", staleAfterLoad: true },
  { name: "dashboard-en-light-900x600", page: "dashboard", route: "/dashboard", width: 900, height: 600, locale: "en", theme: "light" },
  { name: "dashboard-en-dark-900x600", page: "dashboard", route: "/dashboard", width: 900, height: 600, locale: "en", theme: "dark" },
  { name: "usage-zh-light-1440x900", page: "usage", route: "/spend/usage", width: 1440, height: 900, locale: "zh-CN", theme: "light" },
  { name: "usage-zh-dark-1440x900", page: "usage", route: "/spend/usage", width: 1440, height: 900, locale: "zh-CN", theme: "dark" },
  { name: "usage-en-light-1440x900", page: "usage", route: "/spend/usage", width: 1440, height: 900, locale: "en", theme: "light" },
  { name: "usage-en-dark-1440x900", page: "usage", route: "/spend/usage", width: 1440, height: 900, locale: "en", theme: "dark" },
  { name: "settings-basic-zh-dark-1024x700", page: "settings-basic", route: "/settings/basic", width: 1024, height: 700, locale: "zh-CN", theme: "dark" },
  { name: "settings-cost-en-light-1024x700", page: "settings-cost", route: "/settings/cost", width: 1024, height: 700, locale: "en", theme: "light" },
  { name: "data-sources-zh-light-1200x800", page: "data-sources", route: "/settings/data", width: 1200, height: 800, locale: "zh-CN", theme: "light" },
  { name: "reset-history-en-dark-1200x800", page: "reset-history", route: "/reset-history", width: 1200, height: 800, locale: "en", theme: "dark" },
];

const referenceScenarios = [
  { name: "01-overview", page: "dashboard", route: "/dashboard", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "02-usage", page: "usage", route: "/spend/usage", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "03-cost-and-quota", page: "spend-cost", route: "/spend/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "04-leaderboard", page: "leaderboard", route: "/leaderboard", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "05-reset-history", page: "reset-history", route: "/reset-history", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "06-widgets", page: "widgets", route: "/widgets", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "07-settings-basic", page: "settings-basic", route: "/settings/basic", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "08-settings-data", page: "data-sources", route: "/settings/data", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "09-settings-cost-0", page: "settings-cost", route: "/settings/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light" },
  { name: "10-settings-cost-1", page: "settings-cost", route: "/settings/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light", openDisclosure: "cost.other-ai" },
  { name: "11-settings-cost-2", page: "settings-cost", route: "/settings/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light", openDisclosure: "cost.agent-pricing" },
  { name: "12-settings-cost-3", page: "settings-cost", route: "/settings/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light", openDisclosure: "cost.token-plans" },
  { name: "13-settings-cost-4", page: "settings-cost", route: "/settings/cost", width: 1672, height: 941, locale: "zh-CN", theme: "light", openDisclosure: "cost.provider-api" },
];

let scenarios = referenceMode ? referenceScenarios : p0Scenarios;

if (keyboardJourneyOnly) {
  scenarios = [];
} else if (resetGeometryOnly) {
  scenarios = p0Scenarios.filter(({ page }) => page === "reset-history");
} else if (referenceMode && referenceScenarioFilter) {
  scenarios = scenarios.filter(({ name }) => name === referenceScenarioFilter);
  if (scenarios.length === 0) {
    throw new Error(`Unknown reference scenario: ${referenceScenarioFilter}`);
  }
}

const usageTotals = {
  total_tokens: 10_251_000_000,
  billable_total_tokens: 10_251_000_000,
  input_tokens: 2_478_000_000,
  output_tokens: 1_026_000_000,
  cache_creation_input_tokens: 1_200,
  cached_input_tokens: 585_755_877,
  request_count: 79_400,
  conversation_count: 79_400,
  cost_usd: 25_014.3458,
  total_cost_usd: 25_014.3458,
  cache_hit_rate: 0.914,
  pricing_coverage: "complete",
  unpriced_tokens: 12_000,
  unattributed_tokens: 8_000,
};

function shiftDayKey(dayKey, delta) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function currentLocalDayKey(requestUrl) {
  const timeZone = requestUrl.searchParams.get("tz") || "";
  if (timeZone) {
    try {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date()).map(({ type, value }) => [type, value]),
      );
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      // Fall through to the explicit offset supplied by the dashboard.
    }
  }
  const offset = Number(requestUrl.searchParams.get("tz_offset_minutes"));
  return new Date(Date.now() + (Number.isFinite(offset) ? offset : 0) * 60_000)
    .toISOString()
    .slice(0, 10);
}

function buildProviderStatsFixture(requestUrl, view) {
  const recent = view === "recent_api_7d";
  const costBasis = recent
    ? { authority: "official_invoice", accuracy: "exact" }
    : { authority: "local_list_price_estimate", accuracy: "estimated" };
  const requestedFrom = requestUrl.searchParams.get("from");
  const requestedTo = requestUrl.searchParams.get("to");
  const to = requestedTo || currentLocalDayKey(requestUrl);
  const from = requestedFrom || shiftDayKey(to, -6);
  const timeZone = requestUrl.searchParams.get("tz") || "UTC";
  const days = Math.max(1, Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  ) + 1);
  const period = { from, to, days, time_zone: timeZone };
  const dailyCosts = [0.12, 0.18, 0.16, 0.24, 0.21, 0.3, 0.27];
  const dailyTokens = [120_000, 180_000, 160_000, 240_000, 210_000, 300_000, 270_000];
  const dailyRequests = [2, 3, 2, 4, 3, 5, 4];
  const breakdown = (id, displayName, breakdownTokens, breakdownRequests, breakdownCost) => ({
    id,
    display_name: displayName,
    tokens: breakdownTokens,
    request_count: breakdownRequests,
    cost_usd: breakdownCost,
  });
  const daily = recent ? Array.from({ length: days }, (_, index) => {
    const dayCost = dailyCosts[index % dailyCosts.length];
    const date = shiftDayKey(from, index);
    const dayTokens = dailyTokens[index % dailyTokens.length];
    const dayRequests = dailyRequests[index % dailyRequests.length];
    return {
      date,
      agents: [breakdown("codex", "Codex", dayTokens, dayRequests, dayCost)],
      models: [breakdown("deepseek-chat", "deepseek-chat", dayTokens, dayRequests, dayCost)],
      tokens: dayTokens,
      request_count: dayRequests,
      request_count_basis: "request_event",
      cost_usd: dayCost,
      cost_basis: costBasis,
      period,
    };
  }) : [];
  const tokens = recent
    ? daily.reduce((sum, item) => sum + item.tokens, 0)
    : 6_240_000;
  const requestCount = recent
    ? daily.reduce((sum, item) => sum + item.request_count, 0)
    : 84;
  const costUsd = recent
    ? daily.reduce((sum, item) => sum + item.cost_usd, 0)
    : 8.42;
  const provider = {
    provider_id: "deepseek",
    display_name: "DeepSeek",
    account_label: null,
    account_ref: null,
    agents: [breakdown("codex", "Codex", tokens, requestCount, costUsd)],
    models: [breakdown("deepseek-chat", "deepseek-chat", tokens, requestCount, costUsd)],
    period,
    daily,
    balance: null,
    request_count: requestCount,
    request_count_basis: "request_event",
    conversation_count: requestCount,
    tokens,
    input_tokens: tokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    cost_usd: costUsd,
    cost_basis: costBasis,
    priced_tokens: tokens,
    unpriced_tokens: 0,
    pricing_coverage: "complete",
    success_count: requestCount - 1,
    interrupted_count: 0,
    failure_count: 1,
    success_rate: Number((((requestCount - 1) / requestCount) * 100).toFixed(2)),
    avg_latency_ms: 240,
    status_sample_count: requestCount,
    success_rate_sample_count: requestCount,
    latency_sample_count: requestCount,
    availability: { status: "measured", latency: "measured" },
    metric_availability: "measured",
  };
  return {
    ok: true,
    view,
    from,
    to,
    requested_from: requestedFrom,
    requested_to: requestedTo,
    period,
    totals_scope: recent
      ? "api_key_attributed_official_billed_cost_positive"
      : "all_provider_attributed",
    providers: [provider],
    totals: {
      provider_count: 1,
      total_tokens: tokens,
      input_tokens: tokens,
      output_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 0,
      cost_usd: costUsd,
      conversation_count: requestCount,
      request_count: requestCount,
      priced_tokens: tokens,
      unpriced_tokens: 0,
      pricing_coverage: "complete",
    },
  };
}

const dataIntegrity = {
  status: "verified",
  raw_records: 3_391,
  visible_records: 2_844,
  duplicate_records: 546,
  malformed_records: 1,
  token_delta: 0,
  component_token_delta: 0,
  component_mismatch_records: 0,
  updated_at: "2026-08-01T04:00:00.000Z",
};

const officialHistory = [
  ["hard", "2026-08-01T03:32:00.000Z", "https://x.com/thsottiaux/status/1"],
  ["hard", "2026-07-29T04:09:00.000Z", "https://x.com/thsottiaux/status/2"],
  ["hard", "2026-07-28T03:09:00.000Z", "https://x.com/thsottiaux/status/3"],
  ["hard", "2026-07-26T19:17:00.000Z", "https://x.com/thsottiaux/status/4"],
  ["unknown", "2026-07-22T16:47:00.000Z", "https://x.com/thsottiaux/status/5"],
  ["hard", "2026-07-18T13:28:00.000Z", "https://x.com/thsottiaux/status/6"],
  ["hard", "2026-07-16T04:14:00.000Z", "https://x.com/thsottiaux/status/7"],
  ["hard", "2026-07-15T16:14:00.000Z", "https://x.com/thsottiaux/status/8"],
  ["banked", "2026-07-14T18:29:00.000Z", "https://x.com/thsottiaux/status/9"],
  ["banked", "2026-07-13T21:28:00.000Z", "https://x.com/thsottiaux/status/10"],
  ["hard", "2026-07-11T05:54:00.000Z", "https://x.com/thsottiaux/status/11"],
  ["mixed", "2026-07-10T17:32:00.000Z", "https://x.com/thsottiaux/status/12"],
  ["hard", "2026-07-09T10:32:00.000Z", "https://x.com/thsottiaux/status/13"],
].map(([resetKind, occurredAt, sourceUrl], index) => ({
  id: `official-preview-${index + 1}`,
  type: "official_reset_announcement",
  agent: "codex",
  account_key: null,
  window: null,
  created_at: occurredAt,
  reset_at: null,
  occurred_at: occurredAt,
  observed_at: occurredAt,
  previous_used_percent: null,
  current_used_percent: null,
  confidence: "confirmed",
  alert_eligible: false,
  official_url: "https://chatgpt.com/codex",
  source_url: sourceUrl,
  source_author: "thsottiaux",
  source: "signed_feed",
  reset_kind: resetKind,
  reset_scope: "all_codex_work_users",
  title: "Official Codex quota update",
  summary: "Official quota reset announcement",
  body: "Official quota reset announcement with complete source-backed details.",
  expires_at: "2026-08-30T12:00:00.000Z",
}));
const resetGeometryHistory = officialHistory.map((event, index) => {
  const occurredAt = new Date(Date.UTC(2026, 7, 29 - index, 8, index)).toISOString();
  return {
    ...event,
    created_at: occurredAt,
    occurred_at: occurredAt,
    observed_at: occurredAt,
    reset_kind: ["hard", "banked", "mixed", "unknown"][index % 4],
    expires_at: "2026-09-30T12:00:00.000Z",
  };
});

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function dailyRows() {
  const start = Date.UTC(2026, 4, 10);
  const referenceDailyMillions = [
    0, 0, 0, 0, 26.5, 51.3, 53, 24.8, 16.6, 6.6, 6.6, 6.6, 51.3, 39.7, 51.3, 61.3, 39.7,
    13.2, 16.6, 8.3, 8.3, 19.9, 13.2, 43, 23.2, 19.9, 49.7, 11.6, 11.6, 13.2, 16.6, 6.6,
    97.7, 168.9, 125.8, 74.5, 56.3, 84.4, 67.9, 64.6, 56.3, 154, 24.8, 54.6, 46.4, 23.2,
    31.5, 97.7, 210.3, 26.5, 71.2, 120.9, 87.7, 21.5, 74.5, 129.1, 64.6, 115.9, 84.4, 250,
    43, 163.9, 119.2, 110.9, 109.3, 51.3, 57.9, 142.4, 109.3, 202, 238.4, 39.7, 205.3,
    117.5, 172.2, 16.6, 173.8, 24.8, 250, 202, 41.4, 250, 250, 250, 202,
  ];
  const rows = Array.from({ length: 85 }, (_, index) => {
    const day = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const total = Math.round(referenceDailyMillions[index] * 1_000_000);
    return {
      day,
      total_tokens: total,
      billable_total_tokens: total,
      conversation_count: Math.round(310 + index * 8),
      average_usage: Math.round(150_000_000 + index * 550_000),
      cost_usd: Math.round((total / 1_000_000) * 2.44 * 100) / 100,
    };
  });
  [
    [0, "2026-05-10"],
    [17, "2026-05-14"],
    [34, "2026-05-16"],
    [50, "2026-05-16"],
    [67, "2026-07-16"],
    [84, "2026-08-02"],
  ].forEach(([index, label]) => {
    rows[index].axis_label = label;
  });
  const setTrendPoint = (index, total, average, conversations) => {
    rows[index].total_tokens = total;
    rows[index].billable_total_tokens = total;
    rows[index].average_usage = average;
    rows[index].conversation_count = conversations;
  };
  setTrendPoint(55, rows[55].total_tokens, 176_280_000, 868);
  setTrendPoint(78, rows[78].total_tokens, 184_000_000, 930);
  setTrendPoint(83, rows[83].total_tokens, 190_000_000, 975);
  setTrendPoint(84, rows[84].total_tokens, 196_200_000, 1_000);
  return rows;
}

function referenceModels() {
  const filler = 62_480_000;
  return {
    codex: [
      ["gpt-5.6-sol", 4_425_000_000],
      ["gpt-5.5", 1_794_000_000],
      ...Array.from({ length: 5 }, (_, index) => [`codex-model-${index + 1}`, filler]),
    ],
    hermes: [
      ["deepseek-v4-pro", 1_085_000_000],
      ...Array.from({ length: 3 }, (_, index) => [`hermes-model-${index + 1}`, filler]),
    ],
    cursor: [
      ["auto", 764_000_000],
      ...Array.from({ length: 15 }, (_, index) => [`cursor-model-${index + 1}`, filler]),
    ],
    claude: [
      ["claude-3.5-sonnet", 621_000_000],
      ["claude-opus", filler],
      ["claude-haiku", filler],
    ],
  };
}

async function installApi(page, scenario = {}) {
  let failUsage = false;
  let spendRequestCount = 0;
  const requests = new Map();
  const isReferenceUsage = referenceMode && scenario.page === "usage";
  const isReferenceCost = referenceMode && scenario.page === "spend-cost";
  const isReferenceWidgets = referenceMode && scenario.page === "widgets";
  const isReferenceBasic = referenceMode && scenario.page === "settings-basic";
  const isReferenceData = referenceMode && scenario.page === "data-sources";
  const isReferenceSettingsCost = referenceMode && scenario.page === "settings-cost";
  const isReferenceFinancial = isReferenceCost || isReferenceSettingsCost;

  const usageReferenceTotals = isReferenceUsage
    ? {
        ...usageTotals,
        total_tokens: 10_261_000_000,
        billable_total_tokens: 10_261_000_000,
        input_tokens: 529_000_000,
        output_tokens: 36_000_000,
        cache_creation_input_tokens: 6_192_300,
        cached_input_tokens: 9_764_000_000,
        request_count: 80_022,
        conversation_count: 80_022,
        cost_usd: 25_395.8,
        total_cost_usd: 25_395.8,
        cache_hit_rate: 0.949,
        unpriced_tokens: 0,
        unattributed_tokens: 0,
      }
    : usageTotals;

  const usageReferenceSeries = Array.from({ length: 140 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 2, 16) + index * 86_400_000).toISOString().slice(0, 10);
    const progress = index / 139;
    const lateGrowth = Math.max(0, (progress - 0.68) / 0.32);
    const pulse = (Math.sin(index / 3.8) + 1) / 2;
    const inputTokens = Math.round(2_000_000 + pulse * 8_000_000 + lateGrowth * 9_000_000);
    const outputTokens = Math.round(700_000 + ((Math.sin(index / 5.2 + 1.2) + 1) / 2) * 3_000_000);
    const cacheCreationTokens = Math.round(80_000 + pulse * 500_000);
    const cachedTokens = Math.round(
      80_000_000
        + Math.max(0, Math.sin(index / 8.5 - 1.8)) * 1_150_000_000
        + lateGrowth * 2_450_000_000
        + lateGrowth * pulse * 1_200_000_000,
    );
    const cost = Math.round((1_500 + progress * 44_000 + lateGrowth * pulse * 70_000) * 100) / 100;
    return {
      bucket_start: `${date}T00:00:00.000Z`,
      bucket_end: `${date}T23:59:59.999Z`,
      label: date.slice(5),
      source: "codex",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      reasoning_output_tokens: 0,
      total_tokens: inputTokens + outputTokens + cachedTokens + cacheCreationTokens,
      cost_usd: cost,
      api_cost_usd: cost,
      subscription_cost_usd: 0,
      combined_usd: cost,
      models: [],
    };
  });

  const usageReferencePlans = [
    {
      id: "reference-codex-plus-1",
      source: "codex",
      provider_id: "codex",
      plan_label: "Plus",
      notes: "q***",
      quota_source: "official",
      used_quota: 98,
      total_quota: 100,
      remaining_quota: 2,
      quota_unit: "percent",
      expires_at: null,
      detection_method: "manual",
      quota_windows: [{ kind: "rolling_5_hour", unit: "percent", used: 98, total: 100, percentage: 98, resets_at: "2026-08-05T04:20:00.000Z" }],
    },
    {
      id: "reference-codex-plus-2",
      source: "codex",
      provider_id: "codex",
      plan_label: "Plus",
      notes: "alfalfa",
      quota_source: "official",
      used_quota: 67,
      total_quota: 100,
      remaining_quota: 33,
      quota_unit: "percent",
      expires_at: null,
      detection_method: "manual",
      quota_windows: [{ kind: "rolling_5_hour", unit: "percent", used: 67, total: 100, percentage: 67, resets_at: "2026-08-05T04:19:00.000Z" }],
    },
    {
      id: "reference-cursor-pro",
      source: "cursor",
      provider_id: "cursor",
      plan_label: "Pro",
      notes: "ewly",
      quota_source: "official",
      used_quota: 34,
      total_quota: 100,
      remaining_quota: 66,
      quota_unit: "percent",
      expires_at: null,
      detection_method: "manual",
      quota_windows: [{ kind: "total", unit: "percent", used: 34, total: 100, percentage: 34, resets_at: "2026-08-06T14:31:00.000Z" }],
    },
  ];

  await page.route("**/api/local-auth", async (route) => {
    await route.fulfill(jsonResponse({
      token: "p0-desktop-ux-token",
      protocol_version: 2,
      capabilities: [
        "spend_usage_v2",
        "provider_model_stats",
        "request_usage_records",
        "provider_api_balance",
      ],
    }));
  });

  await page.route("**/*tokentracker-*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const segments = requestUrl.pathname.split("/").filter(Boolean);
    const functionIndex = segments.indexOf("functions");
    let slug = functionIndex >= 0 ? segments[functionIndex + 1] : segments.at(-1);
    if (slug === "tokentracker-leaderboard-public") slug = "tokentracker-leaderboard";
    requests.set(slug, (requests.get(slug) || 0) + 1);

    if (slug === "tokentracker-usage-summary") {
      if (failUsage) {
        await route.fulfill(jsonResponse({ error: "Synthetic local usage refresh failure" }, 503));
        return;
      }
      await route.fulfill(jsonResponse({
        totals: isReferenceData
          ? { ...usageTotals, total_tokens: 10_261_000_000, billable_total_tokens: 10_261_000_000, unpriced_tokens: 215_046_397, unattributed_tokens: 0 }
          : usageReferenceTotals,
        data_integrity: isReferenceData
          ? { raw_records: 3_856, visible_records: 2_974, duplicate_records: 881, malformed_records: 0, status: "verified" }
          : isReferenceUsage
          ? { ...dataIntegrity, malformed_records: 0, status: "verified" }
          : dataIntegrity,
        rolling: {
          active_days: 85,
          last_7d: { totals: { billable_total_tokens: 2_700_000_000 } },
          last_30d: {
            totals: { billable_total_tokens: 5_700_000_000 },
            avg_per_active_day: 196_200_000,
          },
          last_7d_change_percent: 18.6,
          last_30d_change_percent: 24.3,
          avg_change_percent: 11.3,
          conversation_change_percent: 15.2,
          day_over_day_percent: 12.6,
        },
      }));
      return;
    }

    if (slug === "tokentracker-spend-records") {
      spendRequestCount += 1;
      const previous = spendRequestCount % 2 === 0;
      await route.fulfill(jsonResponse({
        records: isReferenceSettingsCost
          ? [
              { id: "other-1", source: "other_ai", plan_label: "EqualVPN", amount: 42, currency: "CNY", billing_cycle: "one_time", start_date: "2025-05-15", note: "静态 US-账号 IP", group_id: "vpn" },
              { id: "other-2", source: "other_ai", plan_label: "iKuuuVPN", amount: 30, currency: "CNY", billing_cycle: "one_time", start_date: "2025-05-20", note: "动态不固定 - 广州 IP", group_id: "vpn" },
              { id: "other-3", source: "other_ai", plan_label: "SakuraCat", amount: 20, currency: "CNY", billing_cycle: "one_time", start_date: "2025-05-28", note: "动态宽带", group_id: "vpn" },
              { id: "other-4", source: "other_ai", plan_label: "DeepSeek 官方 API", amount: 260, currency: "CNY", billing_cycle: "one_time", start_date: "2025-06-14", note: "API 调用", group_id: "api" },
            ]
          : isReferenceCost
            ? [{ id: "subscription-1", source: "codex", plan_label: "ChatGPT Plus", amount: 0, lifetime_amount: 2_387.12, currency: "USD", billing_cycle: "monthly", start_date: "2026-08-01", end_date: "2026-09-01" }]
            : [],
        other_ai_groups: isReferenceSettingsCost ? [
          { id: "vpn", name: "VPN", parent_id: "", sort_order: 0 },
          { id: "api", name: "API", parent_id: "", sort_order: 1 },
        ] : [],
        by_source: [],
        other_ai_group_totals: isReferenceCost
          ? [
              { group_id: "custom-1", group_name: "OpenAI", record_count: 1, month_usd: 640.2 },
              { group_id: "custom-2", group_name: "Anthropic", record_count: 1, month_usd: 522.1 },
              { group_id: "custom-3", group_name: "Google", record_count: 1, month_usd: 430.15 },
              { group_id: "custom-4", group_name: "Other", record_count: 1, month_usd: 300 },
            ]
          : [],
        totals: previous
          ? (isReferenceUsage
              ? { api_usd: 280.9, subscription_usd: 0, combined_usd: 280.9 }
              : { api_usd: 7.36, subscription_usd: 20, combined_usd: 29.43 })
          : {
              api_usd: isReferenceUsage ? 3_616.69 : 8.25,
              subscription_usd: isReferenceUsage ? 0 : 20,
              combined_usd: isReferenceUsage ? 3_616.69 : 28.25,
              lifetime_combined_usd: isReferenceUsage ? 25_613.13 : 138.4,
            },
      }));
      return;
    }

    const responses = {
      "tokentracker-usage-bounds": isReferenceUsage
        ? { from: "2026-03-16", to: "2026-08-02" }
        : { from: "2026-05-10", to: "2026-08-02" },
      "tokentracker-usage-daily": { data: dailyRows() },
      "tokentracker-usage-hourly": { data: [] },
      "tokentracker-usage-monthly": { data: [] },
      "tokentracker-usage-model-breakdown": {
        sources: Object.entries({
          codex: 7_175_700_000,
          hermes: 1_517_148_000,
          cursor: 1_148_112_000,
          claude: 410_040_000,
        }).map(([source, totalTokens]) => ({
          source,
          billing_mode: source === "codex" || source === "cursor" ? "token_plan" : "api_key",
          billing_modes: [source === "codex" || source === "cursor" ? "token_plan" : "api_key"],
          totals: {
            total_tokens: totalTokens,
            billable_total_tokens: totalTokens,
            total_cost_usd: 25_014.35 * (totalTokens / 10_251_000_000),
          },
          models: referenceModels()[source].map(([model, tokens]) => ({
            model,
            billing_mode: source === "codex" || source === "cursor" ? "token_plan" : "api_key",
            totals: { total_tokens: tokens, billable_total_tokens: tokens },
          })),
        })),
      },
      "tokentracker-project-usage-summary": {
        entries: [
          { project_key: "token-eyes", project_name: "Token Eyes", total_tokens: 121_000_000, billable_total_tokens: 118_000_000, cost_usd: 48.2, pricing_coverage: "complete" },
          { project_key: "local-agent", project_name: "Local Agent", total_tokens: 82_000_000, billable_total_tokens: 80_000_000, cost_usd: 31.8, pricing_coverage: "complete" },
        ],
      },
      "tokentracker-provider-stats": buildProviderStatsFixture(requestUrl, "range"),
      "tokentracker-provider-api-stats": buildProviderStatsFixture(requestUrl, "recent_api_7d"),
      "tokentracker-model-stats": {
        models: [
          { source: "codex", model: "gpt-5-codex", requests: 3_000, tokens: 330_000_000, cost_usd: 118.4 },
          { source: "codex", model: "gpt-5", requests: 1_230, tokens: 190_000_000, cost_usd: 76.2 },
        ],
      },
      "tokentracker-request-usage-records": { records: [], total: 0, totals: { request_count: 0 } },
      "tokentracker-local-settings": {
        dashboardRefresh: { interval: "manual" },
        dataDirectories: isReferenceBasic ? { codex: "C:\\Users\\admin\\AppData\\Roaming\\TokenEyes\\data" } : {},
      },
      "tokentracker-agent-environment": {
        ok: true,
        results: isReferenceData ? [
          { agent: "claude", agent_name: "Claude Code", status: "ready", trackingReady: true, evidenceCount: 5, latestActivityAt: "2026-08-02T11:02:00.000Z", environment: "wsl-ubuntu" },
          { agent: "codex", agent_name: "Codex", status: "ready", trackingReady: true, evidenceCount: 257, latestActivityAt: "2026-08-02T12:52:00.000Z", environment: "win" },
          { agent: "cursor", agent_name: "Cursor", status: "ready", trackingReady: true, evidenceCount: 1, latestActivityAt: "2026-07-30T13:07:00.000Z", environment: "win" },
          { agent: "trae", agent_name: "Trae", status: "detected", trackingReady: false, evidenceCount: 0, latestActivityAt: "2026-07-26T15:16:00.000Z", environment: "win" },
          { agent: "gemini", agent_name: "Gemini CLI", status: "not-detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: "win" },
          { agent: "opencode", agent_name: "OpenCode", status: "not-detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: "win" },
          { agent: "openclaw", agent_name: "OpenClaw", status: "not-detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: "win" },
          { agent: "hermes", agent_name: "Hermes Agent", status: "ready", trackingReady: true, evidenceCount: 2, latestActivityAt: "2026-08-02T11:16:00.000Z", environment: "wsl-ubuntu" },
          { agent: "codebuddy", agent_name: "CodeBuddy", status: "detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: "win" },
        ] : [
          { agent: "codex", agent_name: "Codex", status: "ready", trackingReady: true, evidenceCount: 48, latestActivityAt: "2026-08-01T04:00:00.000Z", environment: "Windows local" },
          { agent: "claude", agent_name: "Claude Code", status: "detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: "Windows local" },
          { agent: "cursor", agent_name: "Cursor", status: "not-detected", trackingReady: false, evidenceCount: 0, latestActivityAt: null, environment: null },
        ],
      },
      "tokentracker-token-plans": {
        records: isReferenceUsage
          ? usageReferencePlans
          : isReferenceSettingsCost
            ? [
                { id: "settings-plan-active", source: "codex", provider_id: "codex", plan_id: "codex_plus", plan_label: "Plus", total_quota: 100, used_quota: 46, remaining_quota: 54, sync_status: "success", expires_at: "2099-12-31" },
                { id: "settings-plan-expired", source: "cursor", provider_id: "cursor", plan_id: "cursor_pro", plan_label: "Pro", total_quota: 100, used_quota: 100, remaining_quota: 0, sync_status: "success", expires_at: "2026-07-01" },
              ]
            : isReferenceFinancial
            ? [
                { id: "reference-plan-1", source: "hermes", provider_id: "xiaomi_mimo", plan_label: "Standard（月付）", account_label: "", total_quota: 11_000_000_000, used_quota: 10_999_864_960, remaining_quota: 136_040, remaining_percent: 0.12, quota_unit: "Credits", sync_status: "success", ui_status_label: "正常", ui_status_tone: "success", last_refreshed_at: "12 分钟前" },
                { id: "reference-plan-2", source: "cursor", provider_id: "cursor", plan_label: "Pro", account_label: "evely", total_quota: 0, used_quota: 0, remaining_quota: 0, quota_unit: "账户周期用量", sync_status: "error", ui_status_label: "待刷新", ui_status_tone: "muted", last_refreshed_at: "1 小时前" },
                { id: "reference-plan-3", source: "codex", provider_id: "codex", plan_label: "Plus", account_label: "alfalfa", total_quota: 100, used_quota: 67, remaining_quota: 33, quota_unit: "5 小时与 7 天窗口", sync_status: "success", ui_status_label: "接近上限", ui_status_tone: "warning", last_refreshed_at: "6 分钟前" },
                { id: "reference-plan-4", source: "codex", provider_id: "codex", plan_label: "Plus", account_label: "twiddly", total_quota: 100, used_quota: 87, remaining_quota: 13, quota_unit: "5 小时与 7 天窗口", sync_status: "success", ui_status_label: "正常", ui_status_tone: "success", last_refreshed_at: "8 分钟前" },
                { id: "reference-plan-5", source: "trae", provider_id: "trae", plan_label: "Trae CN Pro", account_label: "官方账户", total_quota: 100, used_quota: 46, remaining_quota: 54, quota_unit: "requests", sync_status: "success", ui_status_label: "接近上限", ui_status_tone: "warning", last_refreshed_at: "3 小时前" },
                { id: "reference-plan-6", source: "codex", provider_id: "codex", plan_label: "Plus", account_label: "—", total_quota: 100, used_quota: 102, remaining_quota: -2, quota_unit: "5 小时与 7 天窗口", sync_status: "success", ui_status_label: "已超额", ui_status_tone: "danger", last_refreshed_at: "10 分钟前" },
              ]
            : [],
      },
      "tokentracker-token-plan-catalog": { records: [] },
      "tokentracker-api-billing-accounts": {
        accounts: isReferenceCost
          ? [
              { id: "billing-1", provider: "OpenAI", accountName: "OpenAI API", billingSource: "api", monthCostUsd: 0, lifetimeCostUsd: 0, status: "synced" },
              { id: "billing-2", provider: "Anthropic", accountName: "Anthropic API", billingSource: "api", monthCostUsd: 0, lifetimeCostUsd: 0, status: "synced" },
            ]
          : [],
      },
      "tokentracker-spend-timeseries": isReferenceUsage
        ? {
            ok: true,
            from: "2026-03-16",
            to: "2026-08-02",
            bucket: "day",
            timezone: "Asia/Shanghai",
            currency: "USD",
            sources: ["codex"],
            series: usageReferenceSeries,
            by_source: [],
            totals: { ...usageReferenceTotals, api_usd: 3_616.69, subscription_usd: 0, combined_usd: 3_616.69 },
          }
        : isReferenceCost
          ? {
              totals: requestUrl.searchParams.get("from")?.startsWith("2026-07")
                ? { api_usd: 48.15, subscription_usd: 0, combined_usd: 48.15, usd_to_cny: 7.2 }
                : { api_usd: 3_576.85, subscription_usd: 0, combined_usd: 3_576.85, lifetime_combined_usd: 25_613.13, usd_to_cny: 7.2 },
            }
          : { totals: { api_usd: 8.25, subscription_usd: 20, combined_usd: 28.25 } },
      "tokentracker-provider-api-configs": {
        configs: isReferenceFinancial ? [
          { id: "reference-provider-1", providerId: "deepseek", label: "DeepSeek", requestUrl: "https://api.deepseek.com", enabled: true, authType: "api_key", refreshIntervalSeconds: 300 },
          { id: "reference-provider-2", providerId: "glm", label: "智谱 GLM", requestUrl: "https://www.bigmodel.cn", enabled: true, authType: "api_key", refreshIntervalSeconds: 300 },
          { id: "reference-provider-3", providerId: "volcengine_billing", label: "volcengine_billing", requestUrl: "https://open.volcengineapi.com", enabled: true, authType: "volcengine_hmac", refreshIntervalSeconds: 300 },
          { id: "reference-provider-4", providerId: "aliyun_bss", label: "阿里云 / aliyun_bss", requestUrl: "https://business.aliyuncs.com", enabled: true, authType: "aliyun_rpc", refreshIntervalSeconds: 300 },
        ] : [
          { id: "preview-deepseek", providerId: "deepseek", label: "DeepSeek", enabled: false, authType: "api_key", apiMode: "preset", refreshIntervalSeconds: 300 },
        ],
      },
      "tokentracker-provider-api-balances": {
        balances: isReferenceFinancial ? [
          { configId: "reference-provider-1", providerId: "deepseek", accountLabel: "DeepSeek", balance: 91.65, monthSpend: 22.2, lifetimeSpend: 190, currency: "CNY", status: "synced", lastSyncedAt: "2026-08-04 02:52:09" },
          { configId: "reference-provider-2", providerId: "glm", accountLabel: "智谱 GLM", balance: 499.99, monthSpend: 160.2, lifetimeSpend: 700, currency: "CNY", status: "synced", lastSyncedAt: "2026-07-14 07:42:17" },
          { configId: "reference-provider-3", providerId: "volcengine_billing", accountLabel: "volcengine_billing", balance: 50, monthSpend: 12.1, lifetimeSpend: 100, currency: "CNY", status: "synced", lastSyncedAt: "2026-08-04 02:52:10" },
          { configId: "reference-provider-4", providerId: "aliyun_bss", accountLabel: "阿里云", balance: 46.69, monthSpend: 10.1, lifetimeSpend: 80, currency: "CNY", status: "synced", lastSyncedAt: "2026-08-04 02:52:10" },
        ] : [],
      },
      "tokentracker-other-ai-spend-groups": { groups: [] },
      "tokentracker-usage-limits": {
        codex: { configured: false },
        trae: {
          configured: true,
          collection_status: "connected_no_precise_tokens",
          data_path: "C:/Users/admin/AppData/Roaming/Trae/logs",
        },
      },
      "tokentracker-limit-accounts": { accounts: [] },
      "tokentracker-desktop-widget": isReferenceWidgets ? {
        agents: ["all", "codex", "claude", "cursor"],
        selectedAgent: "all",
        projectStatus: {
          red: 0,
          yellow: 2,
          green: 4,
          unknown: 0,
          recentProjects: [
            { id: "project-token-eye", label: "010-Token eye", path: "D:/04-AI-Project/010-Token eye", status: "active", updatedAt: "2026-08-02T10:00:00Z", lastActiveLabel: "2 小时前" },
            { id: "project-text", label: "text", path: "D:/04-AI-Project/text", status: "active", updatedAt: "2026-08-01T12:00:00Z", lastActiveLabel: "1 天前" },
            { id: "project-realtime", label: "realtime-voice-chat-3", path: "D:/04-AI-Project/realtime-voice-chat-3", status: "recovering", updatedAt: "2026-07-31T12:00:00Z", lastActiveLabel: "2 天前" },
            { id: "project-card", label: "015-重车终结者交互思维卡", path: "D:/04-AI-Project/015-card", status: "active", updatedAt: "2026-07-30T12:00:00Z", lastActiveLabel: "3 天前" },
            { id: "project-quiz", label: "qiuzhishengcun", path: "D:/04-AI-Project/qiuzhishengcun", status: "inactive", updatedAt: "2026-07-28T12:00:00Z", lastActiveLabel: "5 天前" },
            { id: "project-claude", label: "claude-research", path: "D:/04-AI-Project/claude-research", status: "inactive", updatedAt: "2026-07-27T12:00:00Z", lastActiveLabel: "6 天前" },
          ],
        },
        limits: [
          { id: "limit-openai", label: "Codex · Plus · 5h", provider: "OpenAI", usedPercent: 67 },
          { id: "limit-anthropic", label: "Codex · Plus · 5h", provider: "Anthropic", usedPercent: 100 },
          { id: "limit-meta", label: "Codex · Plus · 5h", provider: "Meta", usedPercent: 98 },
          { id: "limit-cursor", label: "Cursor · Pro", provider: "Cursor", usedPercent: 42 },
          { id: "limit-gemini", label: "Gemini · Pro", provider: "Google", usedPercent: 21 },
          { id: "limit-claude", label: "Claude · Max", provider: "Anthropic", usedPercent: 73 },
        ],
      } : { agents: ["all"], selectedAgent: "all", projectStatus: { red: 0, yellow: 0, green: 0, unknown: 0, recentProjects: [] }, limits: [] },
      "tokentracker-codex-reset-events": {
        ok: true,
        status: { enabled: true, configured: true, running: false, unread_count: 0 },
        events: [],
        tray_events: [],
        widget_events: [],
        notification_events: [],
        history: resetGeometryOnly || (!referenceMode && scenario.page === "reset-history")
          ? resetGeometryHistory
          : officialHistory,
      },
      "tokentracker-leaderboard": {
        period: "total",
        source: "all",
        metric: "tokens",
        from: "1970-01-01",
        to: "2026-08-02",
        generated_at: "2026-08-02 20:53:18",
        page: 1,
        limit: 20,
        offset: 0,
        participant_count: 1,
        ranked_entry_count: 1,
        total_entries: 1,
        total_pages: 1,
        aggregate_total_tokens: 10_261_000_000,
        aggregate_total_cost_usd: 23_548.33,
        show_account_actions: true,
        summary_details: {
          participants: "今日活跃  1",
          tokens: "较昨日  +5.21亿（+5.35%）",
          cost: "较昨日  +¥8,732（+5.42%）",
        },
        sync_message: "正在同步本地统计并生成你的排名…",
        entries: [{
          user_id: "reference-user",
          rank: 1,
          is_me: true,
          display_name: "你",
          avatar_display_name: "T",
          current_user_label: "当前用户",
          show_actions: true,
          avatar_url: null,
          total_tokens: 10_261_000_000,
          estimated_cost_usd: 23_548.33,
          gpt_tokens: 7_350_980_400,
          hermes_tokens: 1_567_854_700,
          cursor_tokens: 1_186_171_600,
          claude_tokens: 424_993_400,
          source_breakdown: [
            { source: "codex", total_tokens: 7_350_980_400 },
            { source: "hermes", total_tokens: 1_567_854_700 },
            { source: "cursor", total_tokens: 1_186_171_600 },
            { source: "claude", total_tokens: 424_993_400 },
          ],
        }],
      },
    };
    await route.fulfill(jsonResponse(responses[slug] || {}));
  });

  return {
    requests,
    failUsage: () => {
      failUsage = true;
    },
  };
}

async function seedProductState(page, { locale, theme, openDisclosure, page: pageName, name: referenceScenario }) {
  await page.addInitScript(({ initialLocale, initialTheme, disclosure, nativeWindows, referencePage, scenarioName }) => {
    if (scenarioName) {
      const applyScenarioName = () => {
        if (document.documentElement) document.documentElement.dataset.referenceScenario = scenarioName;
      };
      applyScenarioName();
      if (!document.documentElement) document.addEventListener("DOMContentLoaded", applyScenarioName, { once: true });
    }
    if (nativeWindows) {
      window.__TAURI_INTERNALS__ = {};
      localStorage.setItem("tokentracker_cloud_last_sync_ts", String(Date.now() - 60_000));
    }
    localStorage.setItem("tokentracker.firstRun.completed.v1", "1");
    localStorage.setItem("tokentracker-locale", initialLocale);
    localStorage.setItem("tokentracker-theme", initialTheme);
    if (referencePage === "leaderboard") {
      localStorage.setItem("tokentracker-currency", "CNY");
      localStorage.setItem("tokentracker-exchange-rates", JSON.stringify({ USD: 1, CNY: 7.2 }));
      localStorage.setItem("tokentracker-exchange-rate-source", "fetched");
      localStorage.setItem("tokentracker-exchange-rate-fetched-at", String(Date.now()));
    }
    if (referencePage === "settings-basic") {
      localStorage.setItem("tokentracker-locale", "system");
      localStorage.setItem("tokentracker-currency", "CNY");
      localStorage.setItem("tokentracker-exchange-rates", JSON.stringify({ USD: 1, CNY: 7.2 }));
      localStorage.setItem("tt.limits.providerVisibility", JSON.stringify({ claude: true, codex: true, cursor: true, gemini: true, antigravity: true, hermes: false }));
      localStorage.setItem("tt.limits.providerOrder", JSON.stringify(["claude", "codex", "cursor", "gemini", "antigravity", "hermes", "trae", "codebuddy", "openclaw", "opencode"]));
    }
    for (const key of [
      "cost.agent-pricing",
      "cost.token-plans",
      "cost.provider-api",
      "cost.other-ai",
    ]) {
      localStorage.setItem(`token-eyes.settings.disclosure.${key}.v1`, "0");
    }
    if (disclosure) {
      localStorage.setItem(`token-eyes.settings.disclosure.${disclosure}.v1`, "1");
    }
    if (referencePage === "spend-cost") {
      for (const key of ["other-ai", "token-packages", "provider-api", "api-billing", "subscriptions"]) {
        localStorage.setItem(`token-eyes:cost-section:${key}`, "closed");
      }
    }
  }, {
    initialLocale: locale,
    initialTheme: theme,
    disclosure: openDisclosure,
    nativeWindows: referenceMode,
    referencePage: pageName,
    scenarioName: referenceScenario,
  });
}

function scenarioReadySelector(pageName) {
  const selectors = {
    dashboard: '[data-testid="dashboard-primary-workspace"]',
    usage: '[data-testid="usage-cost-summary"]',
    "spend-cost": "main h1",
    leaderboard: '[data-testid="leaderboard-list-surface"]',
    widgets: "main h1",
    "settings-basic": "main h1",
    "settings-cost": '[data-testid="provider-api-config-section"]',
    "data-sources": '[data-testid="data-privacy-boundary"]',
    "reset-history": '[data-testid="reset-history-timeline"]',
  };
  return selectors[pageName];
}

async function readShell(page) {
  return page.evaluate((isReferenceMode) => {
    const aside = document.querySelector("aside.tt-sidebar-material");
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 2
        && rect.height >= 2
        && style.visibility !== "hidden"
        && style.display !== "none";
    };
    const tooSmall = [...document.querySelectorAll(
      "main button, main select, main input[type=button], main input[type=submit], aside.tt-sidebar-material button, aside.tt-sidebar-material a[href]",
    )]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const isCompactEvidenceAction = Boolean(
          element.closest('[data-testid="usage-summary-details"]'),
        );
        const minimumHeight = isReferenceMode
          ? 15.5
          : isCompactEvidenceAction ? 19.5 : 39.5;
        return isVisible(element) && !element.disabled && rect.height < minimumHeight;
      })
      .map((element) => ({
        label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
    return {
      language: document.documentElement.lang,
      dark: document.documentElement.classList.contains("dark"),
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      sidebarDisplay: aside ? getComputedStyle(aside).display : null,
      sidebarWidth: aside ? Math.round(aside.getBoundingClientRect().width) : null,
      tooSmall,
      heading: [...document.querySelectorAll("main h1")].find(isVisible)?.textContent?.trim() || "",
      cjkText: [...document.querySelectorAll("main, aside.tt-sidebar-material, main svg text")]
        .filter(isVisible)
        .map((element) => element.innerText || element.textContent || "")
        .join(" ")
        .match(/[\u3400-\u9fff]+/gu) || [],
    };
  }, referenceMode);
}

async function firstVisibleKeyboardFocus(page, maxTabs = 20) {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || "",
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden",
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    if (focus?.visible) return focus;
  }
  return null;
}

const referenceGeometryTargets = {
  "01-overview": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 62, width: 252, height: 879 },
    activeNav: { selector: 'aside.tt-desktop-sidebar [aria-current="page"]', x: 9, y: 92, width: 224, height: 44 },
    firstMetric: { selector: '[data-testid="overview-stat-card"]', x: 292, y: 81, width: 172, height: 177 },
    ranking: { selector: '[data-testid="overview-model-ranking"]', x: 292, y: 270, width: 620, height: 347 },
    firstRankingRow: { selector: '[data-testid="overview-model-row"]', x: 313, y: 322, width: 566, height: 56 },
    trend: { selector: '[data-testid="dashboard-trend"]', x: 292, y: 630, width: 620, height: 255 },
    trendRange: { selector: '[data-testid="trend-range"]', x: 350, y: 852, width: 546, height: 22 },
    hero: { selector: '[data-testid="usage-overview-hero"]', x: 930, y: 81, width: 728, height: 532 },
    heroMetrics: { selector: '[data-testid="usage-overview-metrics"]', x: 1076, y: 382, width: 388, height: 64 },
    providers: { selector: '[data-testid="usage-overview-providers"]', x: 930, y: 629, width: 728, height: 257 },
    firstProvider: { selector: '.tt-overview-provider-panel .tt-provider-card', x: 939, y: 715, width: 134, height: 169 },
  },
  "02-usage": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 80, width: 229, height: 861 },
    filter: { selector: ".tt-usage-filter-toolbar", x: 258, y: 190, width: 1354, height: 83 },
    stats: { selector: '.tt-surface:has([data-testid="usage-stats-layout"])', x: 258, y: 293, width: 1354, height: 313 },
    firstDimension: { selector: '[data-testid="usage-dimension-card"]', x: 279, y: 423, width: 262, height: 82 },
    requestSummary: { selector: '[data-testid="usage-request-summary"]', x: 1367, y: 312, width: 235, height: 102 },
    trend: { selector: '[data-testid="usage-chart-token-services-layout"] > :first-child', x: 258, y: 620, width: 843, height: 306 },
    tokenServices: { selector: '[data-testid="token-service-list"]', x: 1117, y: 620, width: 495, height: 306 },
    firstTokenService: { selector: '[data-testid="token-service-row"]', x: 1128, y: 672, width: 473, height: 75 },
  },
  "03-cost-and-quota": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 62, width: 246, height: 879 },
    summary: { selector: '[data-testid="cost-summary-region"]', x: 282, y: 174, width: 1358, height: 275 },
    firstSummaryCard: { selector: '[data-testid="cost-summary-card"]', x: 301, y: 253, width: 633, height: 177 },
    customGroups: { selector: '[data-cost-section="other-ai"]', x: 282, y: 463, width: 1358, height: 70 },
    tokenPlans: { selector: '[data-cost-section="token-packages"]', x: 282, y: 545, width: 1358, height: 70 },
    providerAccounts: { selector: '[data-cost-section="provider-api"]', x: 282, y: 629, width: 1358, height: 70 },
    apiBilling: { selector: '[data-cost-section="api-billing"]', x: 282, y: 711, width: 1358, height: 70 },
    subscriptions: { selector: '[data-cost-section="subscriptions"]', x: 282, y: 793, width: 1358, height: 70 },
  },
  "04-leaderboard": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 105, width: 268, height: 836 },
    summary: { selector: '[data-testid="leaderboard-summary"]', x: 306, y: 219, width: 1286, height: 136 },
    syncBanner: { selector: ".tt-leaderboard-sync-banner", x: 306, y: 377, width: 1286, height: 53 },
    filters: { selector: '[data-testid="leaderboard-filter-toolbar"]', x: 306, y: 449, width: 820, height: 42 },
    list: { selector: '[data-testid="leaderboard-list-surface"]', x: 306, y: 512, width: 1286, height: 257 },
    tableHead: { selector: '[data-testid="leaderboard-table-head"]', x: 306, y: 512, width: 1286, height: 76 },
    firstRow: { selector: '[data-testid="leaderboard-list-surface"] ol > li', x: 306, y: 588, width: 1286, height: 109 },
    pagination: { selector: '[data-testid="leaderboard-list-surface"] > div:last-child', x: 306, y: 697, width: 1286, height: 72 },
  },
  "05-reset-history": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 80, width: 223, height: 861 },
    heading: { selector: '[data-testid="reset-history-heading"]', x: 277, y: 96, width: 1327, height: 62 },
    statistics: { selector: '[data-testid="reset-history-statistics"]', x: 277, y: 173, width: 1327, height: 113 },
    firstStatistic: { selector: '[data-testid="reset-history-stat"]', x: 277, y: 173, width: 249, height: 113 },
    activity: { selector: '[data-testid="reset-history-activity"]', x: 277, y: 301, width: 1327, height: 109 },
    historyHeading: { selector: 'section[aria-labelledby="reset-history-title"] > div:first-child', x: 277, y: 428, width: 1327, height: 32 },
    tableHead: { selector: ".tt-reset-history-table-head", x: 277, y: 460, width: 1327, height: 29 },
    timeline: { selector: '[data-testid="reset-history-timeline"]', x: 305, y: 489, width: 1299, height: 330 },
    listFooter: { selector: ".tt-reset-history-list-footer", x: 277, y: 819, width: 1327, height: 45 },
  },
  "06-widgets": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 0, width: 259, height: 941 },
    heading: { selector: '[data-testid="widgets-heading"]', x: 303, y: 27, width: 1336, height: 76 },
    summary: { selector: '[data-testid="widget-summary"]', x: 303, y: 123, width: 1336, height: 102 },
    projects: { selector: '[data-testid="widget-projects"]', x: 289, y: 247, width: 1352, height: 394 },
    projectTable: { selector: ".tt-widget-project-table", x: 303, y: 359, width: 1324, height: 270 },
    bottom: { selector: ".tt-widget-bottom-grid", x: 289, y: 653, width: 1352, height: 260 },
    limits: { selector: '[data-testid="widget-limits"]', x: 289, y: 653, width: 851, height: 260 },
    quickSettings: { selector: '[data-testid="widget-quick-settings"]', x: 1160, y: 653, width: 481, height: 260 },
  },
  "07-settings-basic": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 82, width: 235, height: 859 },
    heading: { selector: '[data-testid="settings-basic-heading"]', x: 270, y: 111, width: 1277, height: 62 },
    appearance: { selector: ".tt-settings-appearance-card", x: 270, y: 193, width: 1277, height: 317 },
    dataDirectory: { selector: ".tt-settings-data-directory-card", x: 270, y: 521, width: 1277, height: 74 },
    limits: { selector: ".tt-settings-limits-card", x: 270, y: 606, width: 1277, height: 301 },
  },
  "08-settings-data": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 60, width: 265, height: 881 },
    heading: { selector: ".tt-main-work-surface main > .mx-auto > header", x: 351, y: 95, width: 1199, height: 64 },
    sources: { selector: '[data-testid="data-source-summary"]', x: 351, y: 175, width: 1199, height: 423 },
    firstSource: { selector: '[data-testid="data-source-claude"]', x: 368, y: 236, width: 377, height: 114 },
    ledger: { selector: '[data-testid="data-ledger-diagnostics"]', x: 351, y: 616, width: 395, height: 288 },
    privacy: { selector: '[data-testid="data-privacy-boundary"]', x: 764, y: 616, width: 786, height: 288 },
  },
  "09-settings-cost-0": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 71, width: 299, height: 870 },
    heading: { selector: '[data-testid="settings-cost-heading"]', x: 355, y: 119, width: 1235, height: 116 },
    pricing: { selector: ".space-y-4 > :nth-child(1)", x: 355, y: 259, width: 1235, height: 130 },
    plans: { selector: ".space-y-4 > :nth-child(2) .tt-surface", x: 355, y: 402, width: 1235, height: 130 },
    providers: { selector: ".space-y-4 > :nth-child(3) .tt-surface", x: 355, y: 545, width: 1235, height: 130 },
    otherAi: { selector: ".space-y-4 > :nth-child(4)", x: 355, y: 688, width: 1235, height: 130 },
  },
  "10-settings-cost-1": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 61, width: 280, height: 880 },
    heading: { selector: '[data-testid="settings-cost-heading"]', x: 327, y: 85, width: 1268, height: 69 },
    pricing: { selector: ".space-y-4 > :nth-child(1)", x: 327, y: 178, width: 1268, height: 89 },
    plans: { selector: ".space-y-4 > :nth-child(2) .tt-surface", x: 327, y: 278, width: 1268, height: 87 },
    providers: { selector: ".space-y-4 > :nth-child(3) .tt-surface", x: 327, y: 375, width: 1268, height: 87 },
    otherAi: { selector: ".space-y-4 > :nth-child(4)", x: 327, y: 471, width: 1268, height: 455 },
  },
  "11-settings-cost-2": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 49, width: 221, height: 892 },
    heading: { selector: '[data-testid="settings-cost-heading"]', x: 262, y: 73, width: 1334, height: 69 },
    pricing: { selector: ".space-y-4 > :nth-child(1)", x: 262, y: 159, width: 1334, height: 553 },
    plans: { selector: ".space-y-4 > :nth-child(2) .tt-surface", x: 262, y: 718, width: 1334, height: 64 },
    providers: { selector: ".space-y-4 > :nth-child(3) .tt-surface", x: 262, y: 788, width: 1334, height: 64 },
    otherAi: { selector: ".space-y-4 > :nth-child(4)", x: 262, y: 858, width: 1334, height: 64 },
  },
  "12-settings-cost-3": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 57, width: 249, height: 884 },
    heading: { selector: '[data-testid="settings-cost-heading"]', x: 292, y: 82, width: 1323, height: 69 },
    pricing: { selector: ".space-y-4 > :nth-child(1)", x: 292, y: 169, width: 1323, height: 85 },
    plans: { selector: ".space-y-4 > :nth-child(2) .tt-surface", x: 292, y: 264, width: 1323, height: 489 },
    providers: { selector: ".space-y-4 > :nth-child(3) .tt-surface", x: 292, y: 761, width: 1323, height: 76 },
    otherAi: { selector: ".space-y-4 > :nth-child(4)", x: 292, y: 845, width: 1323, height: 76 },
  },
  "13-settings-cost-4": {
    sidebar: { selector: "aside.tt-desktop-sidebar", x: 0, y: 51, width: 241, height: 890 },
    heading: { selector: '[data-testid="settings-cost-heading"]', x: 288, y: 81, width: 1318, height: 69 },
    pricing: { selector: ".space-y-4 > :nth-child(1)", x: 288, y: 174, width: 1318, height: 75 },
    plans: { selector: ".space-y-4 > :nth-child(2) .tt-surface", x: 288, y: 257, width: 1318, height: 74 },
    providers: { selector: ".space-y-4 > :nth-child(3) .tt-surface", x: 288, y: 341, width: 1318, height: 457 },
    otherAi: { selector: ".space-y-4 > :nth-child(4)", x: 288, y: 806, width: 1318, height: 75 },
  },
};

async function readReferenceGeometry(page, scenario) {
  const targets = referenceGeometryTargets[scenario.name];
  if (!targets) return null;
  const tolerance = 4;
  const geometry = {};
  const mismatches = [];
  for (const [key, target] of Object.entries(targets)) {
    const locator = page.locator(target.selector).first();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${scenario.name}: missing reference geometry target ${key}`);
    const actual = Object.fromEntries(
      ["x", "y", "width", "height"].map((field) => [field, Math.round(box[field])]),
    );
    geometry[key] = actual;
    for (const field of ["x", "y", "width", "height"]) {
      if (Math.abs(actual[field] - target[field]) > tolerance) {
        mismatches.push(`${key}.${field}: expected ${target[field]}, received ${actual[field]}`);
      }
    }
  }
  if (mismatches.length) {
    throw new Error(`${scenario.name}: reference geometry differs by more than ${tolerance}px (${mismatches.join("; ")})`);
  }
  return geometry;
}

async function assertProviderJourneys(page, requests, label) {
  const initialScroll = await page.evaluate(() => ({
    windowY: window.scrollY,
    mainY: document.querySelector(".tt-main-scroll-region")?.scrollTop || 0,
  }));
  const modePanel = page.getByTestId("token-service-mode-panel");
  const subscriptionPanelBox = await modePanel.boundingBox();
  const modeButtons = modePanel.locator('button[aria-pressed]');
  if (await modeButtons.count() !== 2) {
    throw new Error(`${label}: Token service switch is incomplete`);
  }
  const subscriptionButton = modeButtons.nth(0);
  const apiButton = modeButtons.nth(1);
  if (await subscriptionButton.getAttribute("aria-pressed") !== "true") {
    throw new Error(`${label}: Subscription was not the initial Token service mode`);
  }

  await apiButton.click();
  try {
    await page.getByTestId("provider-api-card").first().waitFor({ state: "visible", timeout: 8_000 });
  } catch (error) {
    const panelText = await modePanel.innerText().catch(() => "<unavailable>");
    throw new Error(`${label}: API Provider cards did not render; requests=${JSON.stringify(Object.fromEntries(requests))}; panel=${JSON.stringify(panelText)}; cause=${error.message}`);
  }
  if ((requests.get("tokentracker-provider-api-stats") || 0) < 1) {
    throw new Error(`${label}: API mode did not request the recent Provider endpoint`);
  }
  const apiProviders = await page.getByTestId("provider-api-card").evaluateAll((cards) => (
    cards.map((card) => card.querySelector("strong")?.textContent?.trim())
  ));
  if (!apiProviders.includes("DeepSeek") || apiProviders.includes("Codex")) {
    throw new Error(`${label}: API cards are not grouped by true Provider ${JSON.stringify(apiProviders)}`);
  }
  const apiPanelBox = await modePanel.boundingBox();
  if (!subscriptionPanelBox || !apiPanelBox
    || ["x", "y", "width", "height"].some((field) => (
      Math.abs(subscriptionPanelBox[field] - apiPanelBox[field]) > 2
    ))) {
    throw new Error(`${label}: Token service card moved or resized after switching to API ${JSON.stringify({ subscriptionPanelBox, apiPanelBox })}`);
  }
  const apiCardText = await page.getByTestId("provider-api-card").first().innerText();
  const expectedApiFrom = referenceMode ? "2026-03-16" : "2026-05-10";
  const apiDayCount = Number(apiCardText.match(/(\d+)\s*天/u)?.[1]);
  if (!apiCardText.includes(expectedApiFrom) || apiDayCount <= 7) {
    throw new Error(`${label}: API Provider card does not show the selected range ${JSON.stringify(apiCardText)}`);
  }

  await subscriptionButton.click();
  if (await subscriptionButton.getAttribute("aria-pressed") !== "true") {
    throw new Error(`${label}: Subscription mode was not restored`);
  }
  if (await page.getByTestId("provider-api-card").count() !== 0) {
    throw new Error(`${label}: API cards remained mounted after restoring Subscription mode`);
  }

  const detailTabs = page.locator('[role="tablist"]').last().locator('[role="tab"]');
  if (await detailTabs.count() !== 3) {
    throw new Error(`${label}: Usage detail tabs are incomplete`);
  }
  await detailTabs.nth(1).click();
  const providerTable = page.getByTestId("usage-tabpanel-provider").locator("table");
  await providerTable.waitFor({ state: "visible", timeout: 8_000 });
  if ((requests.get("tokentracker-provider-stats") || 0) < 1) {
    throw new Error(`${label}: Provider tab did not request the selected-range endpoint`);
  }
  const providerLabels = await providerTable.locator("tbody tr td:first-child").allTextContents();
  if (!providerLabels.includes("DeepSeek") || providerLabels.some((value) => /Codex|Claude Code/u.test(value))) {
    throw new Error(`${label}: Provider table contains an Agent masquerading as a Provider ${JSON.stringify(providerLabels)}`);
  }
  await detailTabs.nth(0).click();
  await page.evaluate(({ windowY, mainY }) => {
    const resetTarget = document.querySelector('.tt-usage-filter-toolbar button:not([disabled])')
      || document.querySelector('a[href], button:not([disabled]), input:not([disabled])');
    resetTarget?.focus({ preventScroll: true });
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo({ top: windowY, behavior: "instant" });
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
    const mainScroller = document.querySelector(".tt-main-scroll-region");
    if (mainScroller) {
      const previousMainScrollBehavior = mainScroller.style.scrollBehavior;
      mainScroller.style.scrollBehavior = "auto";
      mainScroller.scrollTo({ top: mainY, behavior: "instant" });
      mainScroller.style.scrollBehavior = previousMainScrollBehavior;
    }
  }, initialScroll);
  await page.waitForFunction(({ windowY, mainY }) => (
    Math.abs(window.scrollY - windowY) <= 1
      && Math.abs((document.querySelector(".tt-main-scroll-region")?.scrollTop || 0) - mainY) <= 1
  ), initialScroll);
}

async function assertPageContract(page, scenario, api) {
  if (scenario.page === "dashboard") {
    for (const selector of [
      '[data-testid="dashboard-secondary-context"]',
      '[data-testid="dashboard-trend"]',
      '[data-testid="model-usage-legend"]',
      '[data-testid="dashboard-primary-workspace"]',
      '[data-testid="dashboard-data-details"]',
    ]) {
      if (!(await page.locator(selector).isVisible())) {
        throw new Error(`${scenario.name}: missing restored overview module ${selector}`);
      }
    }
    if (scenario.staleAfterLoad) {
      const staleNotice = page.getByRole("status").filter({
        hasText: "Synthetic local usage refresh failure",
      });
      await staleNotice.waitFor({ state: "visible", timeout: 10_000 });
    }
    const tabVisibility = await page.locator('[role="tablist"]').first().evaluate((tablist) => {
      const first = tablist.querySelector('[role="tab"]');
      const listRect = tablist.getBoundingClientRect();
      const firstRect = first?.getBoundingClientRect();
      return firstRect ? {
        firstLeft: firstRect.left,
        firstRight: firstRect.right,
        listLeft: listRect.left,
        listRight: listRect.right,
      } : null;
    });
    if (!tabVisibility
      || tabVisibility.firstLeft < tabVisibility.listLeft - 1
      || tabVisibility.firstRight > tabVisibility.listRight + 1) {
      throw new Error(`${scenario.name}: first period tab is clipped ${JSON.stringify(tabVisibility)}`);
    }
    const providerShadowVisibility = await page.locator(".tt-overview-provider-panel").evaluate((panel) => {
      const stage = panel.querySelector(".tt-provider-card-stage");
      const grid = stage?.querySelector(".grid.grid-cols-2");
      const card = grid?.querySelector(".tt-provider-card");
      const overflow = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return { x: style.overflowX, y: style.overflowY };
      };
      return {
        panel: overflow(panel),
        stage: overflow(stage),
        grid: overflow(grid),
        cardShadow: card ? getComputedStyle(card).boxShadow : null,
      };
    });
    const clipsShadow = ({ x, y } = {}) => [x, y].some((value) => value === "hidden" || value === "clip");
    if (!providerShadowVisibility.cardShadow
      || providerShadowVisibility.cardShadow === "none"
      || clipsShadow(providerShadowVisibility.panel)
      || clipsShadow(providerShadowVisibility.stage)
      || clipsShadow(providerShadowVisibility.grid)) {
      throw new Error(`${scenario.name}: overview Agent card depth is clipped ${JSON.stringify(providerShadowVisibility)}`);
    }
  }

  if (scenario.page === "usage") {
    if (await page.getByTestId("usage-cost-card").count() !== 4) {
      throw new Error(`${scenario.name}: restored financial summary does not contain four real cards`);
    }
    if (await page.getByTestId("monthly-cost-comparison").count() !== 3) {
      throw new Error(`${scenario.name}: restored month comparison does not contain three comparable cards`);
    }
    if (referenceMode) {
      if (!(await page.getByTestId("usage-trend-plot").isVisible())) {
        throw new Error(`${scenario.name}: reference usage trend is not rendered`);
      }
      if (await page.getByTestId("token-service-row").count() !== 3) {
        throw new Error(`${scenario.name}: expected three reference token services`);
      }
    }
    const placeholders = await page.locator("main.flex-1").evaluate((main) => (
      [...main.querySelectorAll("*")]
        .filter((element) => element.children.length === 0)
        .map((element) => ({
          text: element.textContent?.trim(),
          tag: element.tagName,
          className: element.getAttribute("class"),
          parentText: element.parentElement?.textContent?.trim().slice(0, 160),
        }))
        .filter(({ text }) => text === "-" || text === "—" || text === "未提供字段" || text === "Not provided")
    ));
    if (placeholders.length) {
      throw new Error(`${scenario.name}: ordinary data placeholders remain ${JSON.stringify(placeholders)}`);
    }
    if (scenario.locale === "zh-CN") {
      const text = await page.locator("main.flex-1").innerText();
      const mixedLanguage = ["Output", "Total Usage", "Auto + Composer", "API Usage", " percent"]
        .filter((fragment) => text.includes(fragment));
      if (mixedLanguage.length) {
        throw new Error(`${scenario.name}: mixed English copy remains ${JSON.stringify(mixedLanguage)}`);
      }
    }
    await assertProviderJourneys(page, api.requests, scenario.name);
  }

  if (scenario.page === "settings-basic") {
    if (!(await page.locator("#data-directories").isVisible())) {
      throw new Error(`${scenario.name}: approved data-directory settings are missing`);
    }
  }

  if (scenario.page === "settings-cost") {
    const headers = page.locator('main button[aria-expanded]:has([role="heading"][aria-level="2"])');
    if (await headers.count() !== 4) {
      throw new Error(`${scenario.name}: expected four collapsible cost modules`);
    }
    const expanded = await headers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-expanded")));
    const expectedExpandedCount = scenario.openDisclosure ? 1 : 0;
    const expandedCount = expanded.filter((value) => value === "true").length;
    if (expandedCount !== expectedExpandedCount) {
      throw new Error(`${scenario.name}: unexpected cost disclosure state ${JSON.stringify(expanded)}`);
    }
    const chevronX = await headers.evaluateAll((nodes) => nodes.map((node) => {
      const svg = node.querySelector(":scope > svg");
      return svg ? Math.round(svg.getBoundingClientRect().x * 10) / 10 : null;
    }));
    if (!referenceContractOnly
      && (chevronX.some((value) => value === null) || Math.max(...chevronX) - Math.min(...chevronX) > 1)) {
      throw new Error(`${scenario.name}: cost disclosure chevrons are not aligned ${JSON.stringify(chevronX)}`);
    }
    if (scenario.openDisclosure === "cost.token-plans") {
      const expiredSection = page.getByTestId("expired-token-plans");
      await expiredSection.waitFor({ state: "visible", timeout: 8_000 });
      const expiredToggle = expiredSection.locator("button[aria-expanded]");
      if (await expiredToggle.getAttribute("aria-expanded") !== "false"
        || await expiredSection.getByTestId("expired-token-plan-row").count() !== 0) {
        throw new Error(`${scenario.name}: expired Token plans are not initially folded`);
      }
      await expiredToggle.click();
      if (await expiredToggle.getAttribute("aria-expanded") !== "true") {
        throw new Error(`${scenario.name}: expired Token plan fold did not expand`);
      }
      await expiredSection.getByTestId("expired-token-plan-row").first().waitFor({ state: "visible", timeout: 8_000 });
    }
  }

  if (scenario.page === "data-sources") {
    for (const selector of [
      '[data-testid="data-source-codex"]',
      '[data-testid="data-ledger-diagnostics"]',
      '[data-testid="data-privacy-boundary"]',
    ]) {
      if (!(await page.locator(selector).isVisible())) {
        throw new Error(`${scenario.name}: missing diagnostics module ${selector}`);
      }
    }
    const placeholders = await page.locator("main.flex-1").evaluate((main) => (
      [...main.querySelectorAll("*")]
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim())
        .filter((text) => text === "-" || text === "—" || text === "未提供字段" || text === "Not provided")
    ));
    if (placeholders.length) {
      throw new Error(`${scenario.name}: diagnostic data placeholders remain ${JSON.stringify(placeholders)}`);
    }
  }

  if (scenario.page === "reset-history") {
    const stats = page.getByTestId("reset-history-stat");
    if (await stats.count() !== 5) throw new Error(`${scenario.name}: expected five reset statistic cards`);
    const tones = await stats.evaluateAll((nodes) => nodes.map((node) => node.dataset.tone));
    if (new Set(tones).size !== 5) throw new Error(`${scenario.name}: statistic tones are not distinct`);
    const eventTones = await page.getByTestId("reset-history-node").evaluateAll(
      (nodes) => nodes.map((node) => `${node.dataset.kind}:${node.dataset.tone}`),
    );
    if (new Set(eventTones).size !== 4) throw new Error(`${scenario.name}: reset event icons are not distinct`);
    return resetGeometryOnly
      ? { resetExpansionGeometry: await assertResetExpansionGeometry(page, scenario) }
      : null;
  }
  return null;
}

async function assertResetExpansionGeometry(page, scenario) {
  const items = page.getByTestId("reset-history-item");
  if (await items.count() < 5) {
    throw new Error(`${scenario.name}: fewer than five reset rows are available`);
  }
  const measurements = [];
  for (const index of [0, 2, 3, 4]) {
    const item = items.nth(index);
    const trigger = item.getByTestId("reset-history-expand");
    await item.scrollIntoViewIfNeeded();
    const before = await page.evaluate(({ itemIndex }) => {
      const rows = [...document.querySelectorAll('[data-testid="reset-history-item"]')];
      const row = rows[itemIndex];
      const next = rows[itemIndex + 1];
      const rect = row.getBoundingClientRect();
      const nextRect = next?.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        row: {
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
          height: rect.height,
        },
        next: nextRect ? { top: nextRect.top + window.scrollY } : null,
      };
    }, { itemIndex: index });

    await item.click();
    const detail = item.getByTestId("reset-history-detail");
    await detail.waitFor({ state: "visible" });
    await page.waitForTimeout(50);
    const after = await page.evaluate(({ itemIndex }) => {
      const rows = [...document.querySelectorAll('[data-testid="reset-history-item"]')];
      const row = rows[itemIndex];
      const next = rows[itemIndex + 1];
      const detail = row.querySelector('[data-testid="reset-history-detail"]');
      const rowRect = row.getBoundingClientRect();
      const nextRect = next?.getBoundingClientRect();
      const detailRect = detail.getBoundingClientRect();
      const style = getComputedStyle(detail);
      const summaryBottom = Math.max(...[...row.children]
        .filter((child) => child !== detail)
        .map((child) => child.getBoundingClientRect().bottom + window.scrollY));
      return {
        scrollY: window.scrollY,
        row: {
          top: rowRect.top + window.scrollY,
          bottom: rowRect.bottom + window.scrollY,
          height: rowRect.height,
        },
        next: nextRect ? { top: nextRect.top + window.scrollY } : null,
        detail: {
          top: detailRect.top + window.scrollY,
          bottom: detailRect.bottom + window.scrollY,
          height: detailRect.height,
          viewportTop: detailRect.top,
          viewportBottom: detailRect.bottom,
          position: style.position,
          parentIsRow: detail.parentElement === row,
        },
        summaryBottom,
        activeIsDetail: document.activeElement === detail,
        viewportHeight: window.innerHeight,
      };
    }, { itemIndex: index });

    const expansion = after.row.height - before.row.height;
    const detailGap = after.detail.top - before.row.bottom;
    if (!after.detail.parentIsRow || after.detail.position !== "absolute") {
      throw new Error(`${scenario.name}: row ${index + 1} detail is not an anchored overlay ${JSON.stringify(after.detail)}`);
    }
    if (detailGap < 0 || detailGap > 16) {
      throw new Error(`${scenario.name}: row ${index + 1} detail is not adjacent to its owner (${detailGap}px)`);
    }
    if (Math.abs(expansion) > 2 || Math.abs(after.scrollY - before.scrollY) > 1) {
      throw new Error(`${scenario.name}: row ${index + 1} overlay changed layout or scroll ${JSON.stringify({ expansion, beforeScroll: before.scrollY, afterScroll: after.scrollY })}`);
    }
    if (after.next) {
      const downstreamShift = after.next.top - before.next.top;
      if (Math.abs(downstreamShift) > 2) {
        throw new Error(`${scenario.name}: row ${index + 1} moved downstream content ${JSON.stringify({ downstreamShift })}`);
      }
      if (after.detail.bottom <= after.next.top + 0.5) {
        throw new Error(`${scenario.name}: row ${index + 1} overlay did not cover downstream content`);
      }
    }
    if (
      !after.activeIsDetail
      || after.detail.viewportTop < -0.5
    ) {
      throw new Error(`${scenario.name}: row ${index + 1} detail was not focused below its owner ${JSON.stringify(after)}`);
    }

    measurements.push({ row: index + 1, expansion, detailGap, detailHeight: after.detail.height });
    await page.keyboard.press("Escape");
    await detail.waitFor({ state: "detached" });
    if (!await trigger.evaluate((element) => document.activeElement === element)) {
      throw new Error(`${scenario.name}: row ${index + 1} did not restore focus after Escape`);
    }
  }
  return measurements;
}

async function tabUntil(page, predicate, maxTabs = 220) {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        href: element.getAttribute("href"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        ariaControls: element.getAttribute("aria-controls"),
        preview: Boolean(element.querySelector('[data-testid="reset-history-preview-icon"]')),
        providerHeader: Boolean(element.closest('[data-testid="provider-api-config-section"]')),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    if (active && predicate(active)) return active;
  }
  throw new Error("Keyboard journey could not reach the requested control");
}

async function runKeyboardJourney(browser, baseUrl, { captureArtifacts = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installApi(page);
  await seedProductState(page, { locale: "zh-CN", theme: "dark" });
  await page.goto(`${baseUrl}/dashboard?mock=1&mock_seed=baseline&mock_today=2026-08-01&mock_now=2026-08-01T12:00:00Z`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('[data-testid="dashboard-primary-workspace"]').waitFor({ state: "visible" });

  await tabUntil(page, (active) => active.ariaControls === "nav-children-settings");
  await page.keyboard.press("Enter");
  await page.locator("#data-directories").waitFor({ state: "visible" });
  await tabUntil(page, (active) => active.href === "/settings/cost");
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="provider-api-config-section"]').waitFor({ state: "visible" });

  const focusedHeader = await tabUntil(page, (active) => active.providerHeader && active.ariaExpanded === "false");
  if (focusedHeader.outlineStyle === "none" || Number.parseFloat(focusedHeader.outlineWidth) < 2) {
    throw new Error(`Provider API header has no visible keyboard focus ${JSON.stringify(focusedHeader)}`);
  }
  await page.keyboard.press("Enter");
  const providerHeader = page.locator('[data-testid="provider-api-config-section"] button[aria-expanded]');
  await providerHeader.waitFor({ state: "visible" });
  if (await providerHeader.getAttribute("aria-expanded") !== "true") {
    throw new Error("Provider API did not expand through the keyboard");
  }
  const persistedOpen = await page.evaluate(() => (
    localStorage.getItem("token-eyes.settings.disclosure.cost.provider-api.v1")
  ));
  if (persistedOpen !== "1") throw new Error(`Provider disclosure did not persist: ${persistedOpen}`);

  const expandedScreenshot = path.join(
    outputDir,
    "settings-cost-provider-expanded-zh-dark-1024x700.png",
  );
  if (captureArtifacts) await page.screenshot({ path: expandedScreenshot, fullPage: false });

  await tabUntil(page, (active) => active.href === "/settings/basic");
  await page.keyboard.press("Enter");
  await page.locator("#data-directories").waitFor({ state: "visible" });
  await tabUntil(page, (active) => active.href === "/settings/cost");
  await page.keyboard.press("Enter");
  await providerHeader.waitFor({ state: "visible" });
  if (await providerHeader.getAttribute("aria-expanded") !== "true") {
    throw new Error("Provider API disclosure state was lost after route navigation");
  }

  await tabUntil(page, (active) => active.providerHeader && active.ariaExpanded === "true");
  await page.keyboard.press("Enter");
  if (await providerHeader.getAttribute("aria-expanded") !== "false") {
    throw new Error("Provider API did not collapse through the keyboard");
  }
  const providerFocusables = await page.locator('[data-testid="provider-api-config-section"]')
    .locator('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    .evaluateAll((elements) => elements.map((element) => ({
      visible: Boolean(element.getClientRects().length),
      text: element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName,
    })));
  const hiddenProviderFocusables = providerFocusables.filter((item) => !item.visible);
  if (hiddenProviderFocusables.length > 0) {
    throw new Error(`Collapsed Provider API retained hidden focus targets: ${JSON.stringify(hiddenProviderFocusables)}`);
  }

  await tabUntil(page, (active) => active.href === "/reset-history");
  await page.keyboard.press("Enter");
  await page.getByTestId("reset-history-timeline").waitFor({ state: "visible" });
  await tabUntil(page, (active) => active.preview);
  await page.keyboard.press("Enter");
  const overlay = page.locator('.tt-reset-celebration[data-effect-id="meteors"]');
  await overlay.waitFor({ state: "visible" });
  if (!await page.evaluate(() => Boolean(document.activeElement?.querySelector('[data-testid="reset-history-preview-icon"]')))) {
    throw new Error("Celebration preview moved keyboard focus away from its trigger");
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Enter");
  await page.locator(".tt-reset-celebration--static").waitFor({ state: "visible" });
  const reducedMotionScreenshot = path.join(
    outputDir,
    "reset-history-preview-reduced-motion-zh-dark-1024x700.png",
  );
  if (captureArtifacts) {
    await page.screenshot({ path: reducedMotionScreenshot, fullPage: false });
  }

  if (pageErrors.length) throw new Error(`Keyboard journey page errors: ${pageErrors.join(" | ")}`);
  await context.close();
  return {
    expandedScreenshot: captureArtifacts ? expandedScreenshot : null,
    reducedMotionScreenshot: captureArtifacts ? reducedMotionScreenshot : null,
    providerStateRestored: true,
    collapsedFocusableCount: providerFocusableCount,
    previewFocusPreserved: true,
    reducedMotionFallback: true,
  };
}

async function runResetKeyboardJourney(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installApi(page, { page: "reset-history" });
  await seedProductState(page, {
    locale: "zh-CN",
    theme: "dark",
    page: "reset-history",
  });
  await page.goto(`${baseUrl}/reset-history?mock=1&mock_seed=baseline&mock_today=2026-08-30&mock_now=2026-08-30T12:00:00Z`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("reset-history-timeline").waitFor({ state: "visible" });

  const trigger = page.getByTestId("reset-history-expand").first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByTestId("reset-history-detail");
  await detail.waitFor({ state: "visible" });
  if (!await detail.evaluate((element) => document.activeElement === element)) {
    throw new Error("Reset detail did not receive keyboard focus");
  }
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "detached" });
  if (!await trigger.evaluate((element) => document.activeElement === element)) {
    throw new Error("Reset detail did not restore keyboard focus");
  }
  if (pageErrors.length) {
    throw new Error(`Reset keyboard journey page errors: ${pageErrors.join(" | ")}`);
  }
  await context.close();
  return { timelineReady: true, detailFocusRestored: true };
}

let browser;
const results = [];

try {
  if (!resetGeometryOnly && !keyboardJourneyOnly) {
    await fs.mkdir(outputDir, { recursive: true });
  }
  await server.listen();
  browser = await chromium.launch();
  const baseUrl = `http://${hostname}:${port}`;

  for (const scenario of scenarios) {
    const context = await browser.newContext({
      viewport: { width: scenario.width, height: scenario.height },
    });
    const pageErrors = [];
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const api = await installApi(page, scenario);
    await seedProductState(page, scenario);

    const params = new URLSearchParams({
      mock_seed: "baseline",
      mock_today: "2026-08-01",
      mock_now: "2026-08-01T12:00:00Z",
    });
    if (!referenceMode && !scenario.staleAfterLoad) params.set("mock", "1");
    await page.goto(`${baseUrl}${scenario.route}?${params}`, { waitUntil: "domcontentloaded" });
    await page.locator(scenarioReadySelector(scenario.page)).last().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.waitForTimeout(referenceMode ? 1_000 : 350);

    if (scenario.staleAfterLoad) {
      api.failUsage();
      await page.getByRole("button", { name: scenario.locale === "en" ? "Refresh" : "刷新" }).click();
    }

    const pageContract = await assertPageContract(page, scenario, api);
    const shell = await readShell(page);
    if (shell.horizontalOverflow > 1) {
      throw new Error(`${scenario.name}: horizontal overflow ${shell.horizontalOverflow}px`);
    }
    if (shell.sidebarDisplay === "none" || !shell.sidebarWidth) {
      throw new Error(`${scenario.name}: desktop sidebar is not visible ${JSON.stringify(shell)}`);
    }
    if (!resetGeometryOnly && !referenceContractOnly && shell.tooSmall.length) {
      throw new Error(`${scenario.name}: undersized main controls ${JSON.stringify(shell.tooSmall)}`);
    }
    if ((scenario.theme === "dark") !== shell.dark) {
      throw new Error(`${scenario.name}: theme did not resolve`);
    }
    if (scenario.locale === "en" ? shell.language !== "en" : !shell.language.startsWith("zh")) {
      throw new Error(`${scenario.name}: language did not resolve (${shell.language})`);
    }
    if (!resetGeometryOnly && scenario.locale === "en" && shell.cjkText.length) {
      throw new Error(
        `${scenario.name}: untranslated CJK text ${JSON.stringify([...new Set(shell.cjkText)])}`,
      );
    }
    const focus = resetGeometryOnly
      ? { skipped: "covered-by-reset-expansion-journey" }
      : await firstVisibleKeyboardFocus(page);
    if (
      !resetGeometryOnly
      && (!focus?.visible || focus.outlineStyle === "none" || Number.parseFloat(focus.outlineWidth) < 2)
    ) {
      throw new Error(`${scenario.name}: keyboard focus is not visibly outlined ${JSON.stringify(focus)}`);
    }
    if (pageErrors.length) {
      throw new Error(`${scenario.name}: page errors ${pageErrors.join(" | ")}`);
    }

    const screenshotPath = resetGeometryOnly
      ? null
      : path.join(outputDir, `${scenario.name}.png`);
    if (referenceMode) await page.evaluate(() => document.activeElement?.blur?.());
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: false });
    const referenceGeometry = referenceMode && !referenceContractOnly
      ? await readReferenceGeometry(page, scenario)
      : null;
    results.push({ ...scenario, screenshotPath, shell, focus, referenceGeometry, pageContract });
    await context.close();
  }

  const keyboardJourney = keyboardJourneyOnly
    ? await runResetKeyboardJourney(browser, baseUrl)
    : resetGeometryOnly || referenceContractOnly
    ? { skipped: referenceContractOnly ? "reference-contract-only" : "reset-geometry-only" }
    : await runKeyboardJourney(browser, baseUrl, {
      captureArtifacts: !keyboardJourneyOnly,
    });
  console.log(JSON.stringify({
    status: referenceMode ? "STRUCTURE_PASS" : "PASS",
    visualApprovalRequired: referenceMode,
    outputDir,
    scenarioCount: results.length,
    results,
    keyboardJourney,
  }, null, 2));
} finally {
  await browser?.close();
  await server.close();
  process.chdir(originalWorkingDirectory);
}
