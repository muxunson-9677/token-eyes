const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getProviderCatalog,
  getPlanById,
  listProviderOptions,
} = require("./index");

test("小米目录只暴露已核验的套餐", () => {
  const catalog = getProviderCatalog("xiaomi_mimo");
  assert.equal(catalog.provider_id, "xiaomi_mimo");
  assert.ok(Array.isArray(catalog.plans));
  for (const plan of catalog.plans) {
    assert.ok(plan.plan_id);
    assert.ok(plan.official_evidence_url);
  }
});

test("GLM 目录暴露官方 Coding Plan 套餐", () => {
  const catalog = getProviderCatalog("glm");
  assert.equal(catalog.provider_id, "glm");
  assert.equal(catalog.provider_name, "GLM");
  assert.deepEqual(
    catalog.plans.map((plan) => ({
      plan_id: plan.plan_id,
      quota_kind: plan.quota_kind,
      quota_unit: plan.quota_unit,
      total_quota: plan.total_quota,
    })),
    [
      {
        plan_id: "glm_lite",
        quota_kind: "rolling_window",
        quota_unit: "tokens",
        total_quota: 0,
      },
      {
        plan_id: "glm_pro",
        quota_kind: "rolling_window",
        quota_unit: "tokens",
        total_quota: 0,
      },
      {
        plan_id: "glm_max",
        quota_kind: "rolling_window",
        quota_unit: "tokens",
        total_quota: 0,
      },
    ],
  );
  for (const plan of catalog.plans) {
    assert.ok(plan.official_evidence_url);
  }
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
