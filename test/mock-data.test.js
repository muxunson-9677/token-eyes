const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadDashboardModule } = require("./helpers/load-dashboard-module");

test("getMockUsageModelBreakdown includes model_id per model", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/mock-data.ts");
  const getMockUsageModelBreakdown = mod.getMockUsageModelBreakdown;

  const data = getMockUsageModelBreakdown({
    from: "2024-01-01",
    to: "2024-01-01",
    seed: "mock-seed",
  });

  const models = (data?.sources || []).flatMap((source) =>
    Array.isArray(source?.models) ? source.models : [],
  );

  assert.ok(models.length > 0, "expected mock models");
  for (const model of models) {
    assert.equal(typeof model?.model_id, "string");
    assert.ok(model.model_id.length > 0);
  }
});

test("clearDashboardUsageCachesForRealData removes only dashboard usage caches", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/usage-cache.ts");
  const originalWindow = global.window;
  const store = new Map([
    ["tokentracker.usage.local.default.2026-01-01.2026-01-01.daily.utc.all", "usage"],
    ["tokentracker.usageSummary.local.default.2026-01-01.2026-01-01.utc.all", "summary"],
    ["tokentracker.usageTrend.local.default.2026-01-01.2026-01-01.utc.all", "trend"],
    ["tokentracker.requestUsageRecords.local.default.2026-01-01.2026-01-01.utc.all.100", "records"],
    ["tokentracker.providerStats.local.default.2026-01-01.2026-01-01.utc.all", "providers"],
    ["tokentracker.modelStats.local.default.2026-01-01.2026-01-01.utc.all", "models"],
    ["tokentracker.projectUsage.local.default.2026-01-01.2026-01-01.utc.all", "projects"],
    ["tokentracker-currency", "CNY"],
    ["tokentracker:leaderboard:pageSize", "50"],
  ]);

  global.window = {
    localStorage: {
      get length() {
        return store.size;
      },
      key(index) {
        return Array.from(store.keys())[index] || null;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };

  try {
    const removed = mod.clearDashboardUsageCachesForRealData();
    assert.equal(removed, 7);
    assert.equal(store.has("tokentracker.usage.local.default.2026-01-01.2026-01-01.daily.utc.all"), false);
    assert.equal(store.has("tokentracker.usageSummary.local.default.2026-01-01.2026-01-01.utc.all"), false);
    assert.equal(store.has("tokentracker.usageTrend.local.default.2026-01-01.2026-01-01.utc.all"), false);
    assert.equal(store.has("tokentracker.requestUsageRecords.local.default.2026-01-01.2026-01-01.utc.all.100"), false);
    assert.equal(store.has("tokentracker.providerStats.local.default.2026-01-01.2026-01-01.utc.all"), false);
    assert.equal(store.has("tokentracker.modelStats.local.default.2026-01-01.2026-01-01.utc.all"), false);
    assert.equal(store.has("tokentracker.projectUsage.local.default.2026-01-01.2026-01-01.utc.all"), false);
    assert.equal(store.get("tokentracker-currency"), "CNY");
    assert.equal(store.get("tokentracker:leaderboard:pageSize"), "50");
  } finally {
    global.window = originalWindow;
  }
});

test("isMockEnabled is false in Tauri desktop unless ?mock=1", async () => {
  const mod = await loadDashboardModule("dashboard/src/lib/mock-data.ts");
  const originalWindow = global.window;
  global.window = { __TAURI__: {}, location: { search: "" } };
  try {
    assert.equal(mod.isMockEnabled(), false);
  } finally {
    global.window = originalWindow;
  }
});
