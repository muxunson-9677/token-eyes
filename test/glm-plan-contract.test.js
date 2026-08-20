const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "shared", "provider-plan-contracts", "glm.json");
const CATALOG_PATH = path.join(ROOT, "src", "lib", "token-plan-catalog", "glm.catalog.json");
const MARKET_PATH = path.join(ROOT, "shared", "plan-market-catalog.json");
const { getProviderCatalog } = require("../src/lib/token-plan-catalog");
const { getPlanMarketCatalog } = require("../src/lib/plan-market");

function readJsonOr(pathName, fallback) {
  if (!fs.existsSync(pathName)) return fallback;
  return JSON.parse(fs.readFileSync(pathName, "utf8"));
}

function planMatrix(cohort) {
  return (cohort?.plans || []).map((plan) => ({
    plan_id: plan.plan_id,
    windows: (plan.entitlement_windows || []).map((window) => ({
      kind: window.kind,
      unit: window.unit,
      total: window.total,
    })),
  }));
}

function contractWindow(window) {
  const {
    link_id: _linkId,
    supports: _supports,
    stale_after_seconds: _staleAfterSeconds,
    ...projected
  } = window;
  return projected;
}

function visibleGlmCopy(contract, catalog, marketProvider) {
  return JSON.stringify({
    cohort_name: contract?.cohorts?.current_v3_points?.user_facing_name,
    catalog_cohort_name: catalog?.cohort_display_name,
    catalog_plans: (catalog?.plans || []).map((plan) => ({
      display_name: plan.display_name,
      quota_display: plan.quota?.display,
    })),
    market: marketProvider && {
      display_name: marketProvider.display_name,
      announcement: marketProvider.announcement,
      plans: (marketProvider.plans || []).map((plan) => ({
        display_name: plan.display_name,
        quota_summary: plan.quota_summary,
        highlights: plan.highlights,
      })),
    },
  });
}

test("DATA-02 shared GLM contract exposes four explicit cohorts", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  assert.deepEqual(Object.keys(contract.cohorts || {}).sort(), [
    "current_v3_points",
    "legacy_v1",
    "legacy_v2_prompts",
    "unknown",
  ]);
  assert.equal(contract.provider_id, "glm");
});

test("DATA-02 current GLM cohort fixes the official points entitlement matrix", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  assert.deepEqual(planMatrix(contract.cohorts?.current_v3_points), [
    {
      plan_id: "glm_lite",
      windows: [
        { kind: "rolling_5_hour", unit: "points", total: 2000 },
        { kind: "rolling_weekly", unit: "points", total: 10000 },
      ],
    },
    {
      plan_id: "glm_pro",
      windows: [
        { kind: "rolling_5_hour", unit: "points", total: 12000 },
        { kind: "rolling_weekly", unit: "points", total: 60000 },
      ],
    },
    {
      plan_id: "glm_max",
      windows: [
        { kind: "rolling_5_hour", unit: "points", total: 28000 },
        { kind: "rolling_weekly", unit: "points", total: 140000 },
      ],
    },
  ]);
  assert.deepEqual(
    (contract.cohorts?.current_v3_points?.plans || []).map((plan) => plan.quota_display),
    [
      "每 5 小时 2,000 积分；每周 10,000 积分",
      "每 5 小时 12,000 积分；每周 60,000 积分",
      "每 5 小时 28,000 积分；每周 140,000 积分",
    ],
  );
});

test("DATA-02 historical GLM V2 values remain isolated prompts entitlements", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  assert.deepEqual(planMatrix(contract.cohorts?.legacy_v2_prompts), [
    {
      plan_id: "glm_lite",
      windows: [
        { kind: "rolling_5_hour", unit: "prompts", total: 80 },
        { kind: "rolling_weekly", unit: "prompts", total: 400 },
      ],
    },
    {
      plan_id: "glm_pro",
      windows: [
        { kind: "rolling_5_hour", unit: "prompts", total: 400 },
        { kind: "rolling_weekly", unit: "prompts", total: 2000 },
      ],
    },
    {
      plan_id: "glm_max",
      windows: [
        { kind: "rolling_5_hour", unit: "prompts", total: 1600 },
        { kind: "rolling_weekly", unit: "prompts", total: 8000 },
      ],
    },
  ]);
});

test("DATA-02 every GLM entitlement window carries field-level source and validity evidence", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  for (const cohortId of ["legacy_v2_prompts", "current_v3_points"]) {
    const cohort = contract.cohorts?.[cohortId];
    assert.ok(cohort, `missing ${cohortId}`);
    for (const plan of cohort.plans || []) {
      for (const window of plan.entitlement_windows || []) {
        assert.match(window.unit, /^(prompts|points)$/);
        assert.equal(window.source_type, "official_document");
        assert.match(window.source_url, /^https:\/\/docs\.bigmodel\.cn\//);
        assert.equal(window.verified, true);
        assert.match(window.verified_at, /^\d{4}-\d{2}-\d{2}(?:T|$)/);
        assert.match(window.fetched_at, /^\d{4}-\d{2}-\d{2}(?:T|$)/);
        assert.match(window.content_sha256, /^[a-f0-9]{64}$/);
        assert.ok(window.valid_from === null || /^\d{4}-\d{2}-\d{2}$/.test(window.valid_from));
        assert.ok(Object.prototype.hasOwnProperty.call(window, "valid_until"));
        assert.equal(window.is_stale, false);
        assert.equal(window.estimated, false);
        assert.equal(window.confidence, "exact");
      }
    }
  }
  assert.equal(contract.cohorts?.legacy_v1?.evidence_status, "manual_evidence_required");
  assert.deepEqual(contract.cohorts?.legacy_v1?.plans, []);
  assert.equal(contract.cohorts?.unknown?.evidence_status, "manual_evidence_required");
  assert.deepEqual(contract.cohorts?.unknown?.plans, []);
});

test("DATA-02 GLM contract pins the two reviewed source URLs and SHA-256 values exactly", () => {
  const contract = readJsonOr(CONTRACT_PATH, { sources: {} });
  assert.deepEqual(contract.sources, {
    overview_md: {
      source_type: "official_document",
      source_url: "https://docs.bigmodel.cn/cn/coding-plan/overview.md",
      verified_at: "2026-08-20",
      fetched_at: "2026-08-20",
      content_sha256: "d0224afd5a7c63367e52d32000ba5c8b3e6520454bdbeb6f17f4019ebd9238d9",
    },
    usage_revision_md: {
      source_type: "official_document",
      source_url: "https://docs.bigmodel.cn/cn/coding-plan/notice/usage-revision.md",
      verified_at: "2026-08-20",
      fetched_at: "2026-08-20",
      content_sha256: "09e4e52b41de37500c758ae424dde4a384e9feddaf8df5aaa36d04950f5a7db8",
    },
  });
});

test("DATA-02 user-facing GLM copy says 新版积分套餐 and never presents V3 as an official name", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  const catalog = readJsonOr(CATALOG_PATH, {});
  const market = readJsonOr(MARKET_PATH, { providers: [] });
  const marketProvider = market.providers.find((provider) => provider.id === "glm");
  const visibleCopy = visibleGlmCopy(contract, catalog, marketProvider);
  assert.match(visibleCopy, /新版积分套餐/);
  assert.doesNotMatch(visibleCopy, /\bV3\b/i);
});

test("DATA-02 GLM catalog and plan market projections match the shared current contract", () => {
  const contract = readJsonOr(CONTRACT_PATH, { cohorts: {} });
  const now = "2026-08-21T00:00:00.000Z";
  const catalog = getProviderCatalog("glm", { now });
  const market = getPlanMarketCatalog({ now });
  const current = contract.cohorts?.current_v3_points || { plans: [] };
  const marketProvider = market.providers.find((provider) => provider.id === "glm") || { plans: [] };

  assert.equal(catalog.entitlement_revision, "current_v3_points");
  assert.deepEqual(
    (catalog.plans || []).map((plan) => ({
      plan_id: plan.plan_id,
      entitlement_revision: plan.entitlement_revision,
      entitlement_windows: plan.entitlement_windows.map(contractWindow),
    })),
    (current.plans || []).map((plan) => ({
      plan_id: plan.plan_id,
      entitlement_revision: "current_v3_points",
      entitlement_windows: plan.entitlement_windows,
    })),
  );
  assert.deepEqual(
    (marketProvider.plans || []).map((plan) => ({
      plan_id: plan.contract_plan_id,
      entitlement_revision: plan.entitlement_revision,
      entitlement_windows: plan.entitlement_windows.map(contractWindow),
    })),
    (current.plans || []).map((plan) => ({
      plan_id: plan.plan_id,
      entitlement_revision: "current_v3_points",
      entitlement_windows: plan.entitlement_windows,
    })),
  );
  assert.deepEqual(
    (catalog.plans || []).map((plan) => plan.quota?.display),
    (current.plans || []).map((plan) => plan.quota_display),
  );
  assert.deepEqual(
    (marketProvider.plans || []).map((plan) => plan.quota_summary),
    (current.plans || []).map((plan) => plan.quota_display),
  );
});

test("DATA-05 GLM source hash validator accepts exact evidence and gates either changed source", () => {
  const contract = readJsonOr(CONTRACT_PATH, { sources: {} });
  const {
    assessGlmContractSourceHashes,
    projectGlmCatalog,
  } = require("../src/lib/glm-token-plan");
  assert.equal(typeof assessGlmContractSourceHashes, "function");
  assert.equal(typeof projectGlmCatalog, "function");
  const exactHashes = {
    overview_md: "d0224afd5a7c63367e52d32000ba5c8b3e6520454bdbeb6f17f4019ebd9238d9",
    usage_revision_md: "09e4e52b41de37500c758ae424dde4a384e9feddaf8df5aaa36d04950f5a7db8",
  };
  assert.deepEqual(assessGlmContractSourceHashes(exactHashes), {
    status: "verified",
    changed_sources: [],
  });
  const result = assessGlmContractSourceHashes({
    overview_md: "f".repeat(64),
    usage_revision_md: "e".repeat(64),
  });
  assert.equal(result.status, "manual_evidence_required");
  assert.deepEqual(result.changed_sources, ["overview_md", "usage_revision_md"]);

  const catalog = readJsonOr(CATALOG_PATH, {});
  const beforeContract = structuredClone(contract);
  const beforeCatalog = structuredClone(catalog);
  const projected = projectGlmCatalog(catalog, {
    contract,
    observedSourceHashes: {
      overview_md: "f".repeat(64),
      usage_revision_md: exactHashes.usage_revision_md,
    },
  });
  assert.equal(projected.evidence_status, "manual_evidence_required");
  assert.deepEqual(projected.source_hashes, catalog.source_hashes);
  assert.deepEqual(contract, beforeContract, "hash drift must not mutate or auto-accept the contract");
  assert.deepEqual(catalog, beforeCatalog, "hash drift must not mutate or auto-accept the catalog");
});

test("DATA-02 GLM tier mapping is exact and cannot treat profile as Pro cohort evidence", () => {
  const { mapGlmLevelToPlanId } = require("../src/lib/glm-token-plan");
  assert.equal(mapGlmLevelToPlanId("lite"), "glm_lite");
  assert.equal(mapGlmLevelToPlanId("pro"), "glm_pro");
  assert.equal(mapGlmLevelToPlanId("max"), "glm_max");
  assert.equal(mapGlmLevelToPlanId("profile"), "");
});

test("DATA-02 GLM rejects numeric-string quota fields as structure drift without echoing raw values", () => {
  const {
    GlmTokenPlanError,
    parseGlmQuotaResponse,
  } = require("../src/lib/glm-token-plan");
  const basePayload = {
    data: {
      level: "pro",
      limits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          usage: 100,
          currentValue: 20,
          percentage: 20,
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          usage: 500,
          currentValue: 100,
          percentage: 20,
        },
      ],
    },
  };

  for (const field of ["usage", "currentValue", "percentage"]) {
    const payload = structuredClone(basePayload);
    const rawValue = String(payload.data.limits[0][field]);
    payload.data.limits[0][field] = rawValue;
    assert.throws(
      () => parseGlmQuotaResponse(payload),
      (error) => {
        assert.ok(error instanceof GlmTokenPlanError);
        assert.equal(error.code, "GLM_RESPONSE_STRUCTURE_DRIFT");
        assert.equal(error.message.includes(rawValue), false);
        return true;
      },
      `${field} numeric strings must not be coerced`,
    );
  }
});
