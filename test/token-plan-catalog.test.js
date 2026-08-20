const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getProviderCatalog,
  getPlanById,
  listProviderOptions,
} = require("../src/lib/token-plan-catalog");

test("小米目录只暴露已核验的套餐", () => {
  const catalog = getProviderCatalog("xiaomi_mimo");
  assert.equal(catalog.provider_id, "xiaomi_mimo");
  assert.ok(Array.isArray(catalog.plans));
  for (const plan of catalog.plans) {
    assert.ok(plan.plan_id);
    assert.ok(plan.official_evidence_url);
  }
  assert.equal(catalog.account_access.official_quota_api, false);
  assert.equal(catalog.account_access.usage_endpoint_documented, false);
  assert.equal(catalog.account_access.source_kind, "undocumented_console_api");
  assert.equal(catalog.account_access.support_tier, "best_effort");
  assert.match(catalog.account_access.notes, /非公开|未文档化/);
});

test("GLM 目录只把新版积分套餐投影为当前 entitlement", () => {
  const catalog = getProviderCatalog("glm");
  assert.equal(catalog.provider_id, "glm");
  assert.equal(catalog.provider_name, "GLM");
  assert.equal(catalog.entitlement_revision, "current_v3_points");
  assert.equal(catalog.cohort_display_name, "新版积分套餐");
  assert.deepEqual(
    catalog.plans.map((plan) => ({
      plan_id: plan.plan_id,
      quota_kind: plan.quota_kind,
      quota_unit: plan.quota_unit,
      total_quota: plan.total_quota,
      total_quota_display: plan.total_quota_display,
      entitlement_revision: plan.entitlement_revision,
      entitlement_totals: plan.entitlement_windows.map((window) => window.total),
    })),
    [
      {
        plan_id: "glm_lite",
        quota_kind: "entitlement_windows",
        quota_unit: "points",
        total_quota: 0,
        total_quota_display: "每 5 小时 2,000 积分；每周 10,000 积分",
        entitlement_revision: "current_v3_points",
        entitlement_totals: [2000, 10000],
      },
      {
        plan_id: "glm_pro",
        quota_kind: "entitlement_windows",
        quota_unit: "points",
        total_quota: 0,
        total_quota_display: "每 5 小时 12,000 积分；每周 60,000 积分",
        entitlement_revision: "current_v3_points",
        entitlement_totals: [12000, 60000],
      },
      {
        plan_id: "glm_max",
        quota_kind: "entitlement_windows",
        quota_unit: "points",
        total_quota: 0,
        total_quota_display: "每 5 小时 28,000 积分；每周 140,000 积分",
        entitlement_revision: "current_v3_points",
        entitlement_totals: [28000, 140000],
      },
    ],
  );
  for (const plan of catalog.plans) {
    assert.ok(plan.official_evidence_url);
  }
});

test("GLM nested entitlement windows are returned as defensive copies", () => {
  const firstPlan = getPlanById("glm", "glm_lite");
  assert.ok(Array.isArray(firstPlan.entitlement_windows));
  firstPlan.entitlement_windows[0].total = -1;
  const secondPlan = getPlanById("glm", "glm_lite");
  assert.equal(secondPlan.entitlement_windows[0].total, 2000);

  const firstCatalog = getProviderCatalog("glm");
  firstCatalog.plans[0].entitlement_windows[1].total = -1;
  const secondCatalog = getProviderCatalog("glm");
  assert.equal(secondCatalog.plans[0].entitlement_windows[1].total, 10000);
});

test("MiniMax manual quota catalog uses provider_count without token conversion", () => {
  const plan = getPlanById("minimax", "minimax_manual_quota");
  assert.equal(plan.quota_unit, "provider_count");
  assert.equal(JSON.stringify(plan).includes("token_conversion"), false);
  assert.equal(JSON.stringify(plan).includes("overage"), false);
});

test("未知套餐不会回退为任意目录记录", () => {
  assert.equal(getPlanById("xiaomi_mimo", "not-a-plan"), null);
});

test("服务商选择始终包含自定义套餐入口", () => {
  assert.deepEqual(
    listProviderOptions().map((item) => item.id).includes("custom"),
    true,
  );
});

test("服务商选择包含已开发的主流手动套餐目录", () => {
  const options = listProviderOptions();
  const ids = options.map((item) => item.id);

  assert.ok(ids.includes("aliyun_bailian"));
  assert.ok(ids.includes("kimi"));
  assert.ok(ids.includes("minimax"));
  assert.ok(ids.includes("codex"));
  assert.ok(ids.includes("claude"));
  assert.ok(ids.includes("cursor"));
  assert.equal(options.find((item) => item.id === "custom")?.name, "自定义套餐");
});
