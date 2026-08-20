const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("./helpers/local-api.cjs");

const ALLOWED_CURRENCIES = new Set(["CNY", "USD"]);
const ALLOWED_CYCLES = new Set(["monthly", "quarterly", "yearly", "one_time"]);
const ALLOWED_STATUS = new Set(["available", "discontinued"]);

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalCompare(left, right) {
  const leftJson = canonicalJson(left);
  const rightJson = canonicalJson(right);
  if (leftJson < rightJson) return -1;
  if (leftJson > rightJson) return 1;
  return 0;
}

function normalizedMarketClaim(claim, scope) {
  const supports = [...(claim.evidence?.supports || [])].sort();
  const normalized = { claim_scope: scope, supports };
  if (scope === "market_provider") {
    if (supports.includes("provider_identity")) Object.assign(normalized, {
      id: claim.id,
      display_name: claim.display_name,
      vendor: claim.vendor,
      region: claim.region,
    });
    if (supports.includes("plan_inventory")) {
      normalized.plan_ids = (claim.plans || []).map((plan) => plan.plan_id).sort();
    }
    return normalized;
  }
  if (scope === "market_plan") {
    if (supports.includes("plan_identity")) Object.assign(normalized, {
      plan_id: claim.plan_id,
      display_name: claim.display_name,
      status: claim.status,
    });
    if (supports.includes("price")) Object.assign(normalized, {
      price: claim.price,
      alt_prices: claim.alt_prices ?? null,
    });
    if (supports.includes("quota")) Object.assign(normalized, {
      quota_summary: claim.quota_summary,
      entitlement_windows: (claim.entitlement_windows || []).map((window) => ({
        kind: window.kind,
        unit: window.unit,
        total: window.total,
      })),
    });
    if (supports.includes("eligibility")) normalized.highlights = claim.highlights ?? null;
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    if (supports.includes("promotion")) {
      normalized.promotion_prices = (claim.alt_prices || [])
        .filter((price) => price.promotion_id)
        .map((price) => ({ ...price }));
    }
    return normalized;
  }
  if (scope === "market_promotion") {
    if (supports.includes("promotion")) Object.assign(normalized, {
      promotion_id: claim.promotion_id,
      display: claim.display,
      offers: (claim.offers || []).map((offer) => ({
        promotion_id: offer.promotion_id,
        plan_id: offer.plan_id,
        amount: offer.amount,
        currency: offer.currency,
        cycle: offer.cycle,
        note: offer.note ?? null,
      })).sort(canonicalCompare),
    });
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    return normalized;
  }
  throw new Error(`unsupported normalized claim scope ${scope}`);
}

function withExplicitGlmPromotionOffers(raw) {
  const result = structuredClone(raw);
  const glm = result.providers.find((provider) => provider.id === "glm");
  const promotion = glm.promotions.find((entry) => entry.promotion_id === "glm-2026-08-15-term-discount");
  promotion.offers = glm.plans.flatMap((plan) => (plan.alt_prices || [])
    .filter((price) => price.promotion_id === promotion.promotion_id)
    .map((price) => ({
      promotion_id: price.promotion_id,
      plan_id: plan.plan_id,
      amount: price.amount,
      currency: price.currency,
      cycle: price.cycle,
      note: price.note ?? null,
    })));
  promotion.evidence.content_sha256 = replayMarketHash(promotion);
  return result;
}

function replayMarketHash(claim) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(normalizedMarketClaim(claim, claim.evidence.claim_scope)), "utf8")
    .digest("hex");
}

test("plan market catalog exposes validated, sourced provider plan data", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const catalog = getPlanMarketCatalog();

  assert.ok(catalog.updated_at, "catalog must carry updated_at");
  assert.ok(Array.isArray(catalog.providers) && catalog.providers.length >= 4);

  const seenIds = new Set();
  for (const provider of catalog.providers) {
    assert.ok(provider.id && typeof provider.id === "string", "provider id required");
    assert.ok(!seenIds.has(provider.id), `duplicate provider id ${provider.id}`);
    seenIds.add(provider.id);
    assert.ok(provider.display_name, `provider ${provider.id} needs display_name`);
    assert.ok(provider.evidence, `provider ${provider.id} needs claim provenance`);
    assert.match(
      String(provider.last_verified || ""),
      /^\d{4}-\d{2}-\d{2}$/,
      `provider ${provider.id} needs last_verified date`,
    );
    assert.ok(
      Array.isArray(provider.sources) && provider.sources.length >= 1,
      `provider ${provider.id} needs at least one source link`,
    );
    for (const source of provider.sources) {
      assert.ok(source.label, `provider ${provider.id} source needs label`);
      assert.match(String(source.url || ""), /^https:\/\//, `provider ${provider.id} source URL must be https`);
    }
    assert.ok(Array.isArray(provider.plans));
    if (provider.id === "volcengine-doubao") {
      assert.equal(provider.plans.length, 0, "unverified Volcengine campaign must not expose purchase claims");
    } else {
      assert.ok(provider.plans.length >= 1);
    }
    const seenPlanIds = new Set();
    for (const plan of provider.plans) {
      assert.ok(plan.plan_id, `provider ${provider.id} plan needs plan_id`);
      assert.ok(!seenPlanIds.has(plan.plan_id), `duplicate plan id ${provider.id}/${plan.plan_id}`);
      seenPlanIds.add(plan.plan_id);
      assert.ok(plan.display_name, `plan ${provider.id}/${plan.plan_id} needs display_name`);
      assert.ok(plan.evidence, `plan ${provider.id}/${plan.plan_id} needs claim provenance`);
      assert.ok(plan.price && typeof plan.price === "object");
      const hasNumericPrice = Number.isFinite(Number(plan.price.amount)) && Number(plan.price.amount) >= 0;
      const hasOfficialDisplayPrice = typeof plan.price.display === "string" && plan.price.display.trim().length > 0;
      assert.ok(
        hasNumericPrice || hasOfficialDisplayPrice,
        `plan ${provider.id}/${plan.plan_id} price must be a non-negative amount or official display label`,
      );
      if (hasNumericPrice) {
        assert.ok(
          ALLOWED_CURRENCIES.has(plan.price.currency),
          `plan ${provider.id}/${plan.plan_id} currency must be CNY or USD`,
        );
        assert.ok(
          ALLOWED_CYCLES.has(plan.price.cycle),
          `plan ${provider.id}/${plan.plan_id} cycle invalid: ${plan.price.cycle}`,
        );
      }
      assert.ok(plan.quota_summary, `plan ${provider.id}/${plan.plan_id} needs quota_summary`);
      assert.ok(
        ALLOWED_STATUS.has(plan.status),
        `plan ${provider.id}/${plan.plan_id} status invalid: ${plan.status}`,
      );
    }
  }

  const providerIds = catalog.providers.map((p) => p.id);
  for (const expected of ["glm", "aliyun-bailian", "claude", "openai", "xiaomi-mimo"]) {
    assert.ok(providerIds.includes(expected), `catalog must include seed provider ${expected}`);
  }

  const kimi = catalog.providers.find((provider) => provider.id === "kimi");
  assert.deepEqual(
    kimi.plans.map((plan) => [plan.display_name, plan.price.amount]),
    [["Andante", 49], ["Moderato", 99], ["Allegretto", 199], ["Allegro", 699]],
  );

  const xiaomiMiMo = catalog.providers.find((provider) => provider.id === "xiaomi-mimo");
  assert.deepEqual(
    xiaomiMiMo.plans.map((plan) => [plan.display_name, plan.price.amount]),
    [["Lite", 39], ["Standard", 99], ["Pro", 329], ["Max", 659]],
  );

  const grok = catalog.providers.find((provider) => provider.id === "grok");
  assert.deepEqual(grok.plans.slice(0, 6).map((plan) => plan.price.amount), [0, 10, 30, 100, 300, 30]);

  const glm = catalog.providers.find((provider) => provider.id === "glm");
  assert.equal(glm.entitlement_revision, "current_v3_points");
  assert.match(glm.cohort_display_name, /新版积分套餐/);
  assert.doesNotMatch(JSON.stringify({
    cohort_display_name: glm.cohort_display_name,
    announcement: glm.announcement,
    plans: glm.plans.map((plan) => ({
      display_name: plan.display_name,
      quota_summary: plan.quota_summary,
    })),
  }), /\bV3\b/i);
  assert.deepEqual(
    glm.plans.map((plan) => plan.entitlement_windows.map((window) => [window.kind, window.unit, window.total])),
    [
      [["rolling_5_hour", "points", 2000], ["rolling_weekly", "points", 10000]],
      [["rolling_5_hour", "points", 12000], ["rolling_weekly", "points", 60000]],
      [["rolling_5_hour", "points", 28000], ["rolling_weekly", "points", 140000]],
    ],
  );
  assert.deepEqual(glm.plans.map((plan) => plan.quota_summary), [
    "每 5 小时 2,000 积分；每周 10,000 积分",
    "每 5 小时 12,000 积分；每周 60,000 积分",
    "每 5 小时 28,000 积分；每周 140,000 积分",
  ]);

  const microsoftCopilot = catalog.providers.find((provider) => provider.id === "microsoft-copilot");
  assert.ok(microsoftCopilot, "Microsoft Copilot must use its market-only provider id");
  assert.equal(microsoftCopilot.vendor, "Microsoft");
  assert.equal(microsoftCopilot.vendor_family, "microsoft");
  assert.equal(microsoftCopilot.product_family, "microsoft-copilot");
  assert.equal(
    microsoftCopilot.sources[0]?.url,
    "https://www.microsoft.com/microsoft-copilot/for-individuals",
  );
  assert.equal(
    catalog.providers.some((provider) => provider.id === "copilot"),
    false,
    "the existing copilot id belongs to GitHub usage/capability data, not the Microsoft market",
  );
});

test("plan market catalog returns defensive copies", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const first = getPlanMarketCatalog();
  first.providers[0].display_name = "mutated";
  first.providers[0].plans[0].price.amount = -1;
  const second = getPlanMarketCatalog();
  assert.notEqual(second.providers[0].display_name, "mutated");
  assert.ok(Number(second.providers[0].plans[0].price.amount) > 0);
});

test("Copilot vendor families remain distinct across market, agent, and capability registries", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const agentRegistry = require("../shared/agent-registry.json");
  const capabilityRegistry = require("../shared/provider-capabilities.json");
  const market = getPlanMarketCatalog();

  const microsoftMarket = market.providers.find((provider) => provider.id === "microsoft-copilot");
  const githubAgent = agentRegistry.adapters.find((adapter) => adapter.id === "copilot");
  const githubCapability = capabilityRegistry.providers.find((provider) => provider.id === "copilot");

  assert.equal(microsoftMarket.vendor_family, "microsoft");
  assert.equal(microsoftMarket.product_family, "microsoft-copilot");
  assert.equal(githubAgent.family, "github");
  assert.equal(githubAgent.usage_identity, "copilot");
  assert.equal(githubCapability.display_name, "GitHub Copilot");
  assert.equal(
    agentRegistry.adapters.some((adapter) => adapter.id === microsoftMarket.id),
    false,
    "Microsoft Copilot is market-only and must not become a usage adapter identity",
  );
  assert.equal(
    market.providers.some((provider) => provider.id === githubAgent.id),
    false,
    "GitHub Copilot usage/capability data must not inherit Microsoft market plans",
  );
});

test("local API serves plan market catalog read-only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-plan-market-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });

    const res = await call(handler, "/functions/tokentracker-plan-market");
    assert.equal(res.statusCode, 200);
    const body = readJsonResponse(res);
    assert.ok(body.updated_at);
    assert.ok(Array.isArray(body.providers) && body.providers.length >= 4);
    assert.ok(body.providers.every((p) => Array.isArray(p.sources) && p.sources.length >= 1));

    const rejected = await call(handler, "/functions/tokentracker-plan-market", { method: "POST" });
    assert.equal(rejected.statusCode, 405);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("raw market catalog uses provider-links references and every resolved claim carries provenance", () => {
  const rawPath = path.join(__dirname, "..", "shared", "plan-market-catalog.json");
  const rawText = fsSync.readFileSync(rawPath, "utf8");
  assert.doesNotMatch(rawText, /https?:\/\//, "market catalog must not duplicate provider URLs");

  const raw = JSON.parse(rawText);
  const links = require("../shared/provider-links.json").links;
  const linkIds = new Set(links.map((link) => link.link_id));
  for (const provider of raw.providers) {
    for (const source of provider.sources || []) {
      assert.ok(linkIds.has(source.link_id), `${provider.id} source must join provider-links`);
      assert.ok(Array.isArray(source.supports) && source.supports.length > 0);
      assert.equal("url" in source, false);
    }
    for (const claim of [provider, ...provider.plans, ...(provider.promotions || [])]) {
      assert.ok(claim.evidence, `${provider.id} claim needs provenance`);
      if (!claim.evidence.verified) {
        assert.equal(claim.evidence.content_sha256, null);
      } else if (claim.evidence.content_hash_kind === "normalized_extracted_fields_v1") {
        assert.equal(claim.evidence.content_sha256, replayMarketHash(claim));
      } else {
        assert.equal(claim.evidence.content_hash_kind, "source_body_utf8_lf");
        assert.match(claim.evidence.content_sha256, /^[a-f0-9]{64}$/);
      }
    }
  }

  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const catalog = getPlanMarketCatalog({ now: new Date("2026-08-20T12:00:00.000Z") });
  for (const provider of catalog.providers) {
    for (const source of provider.sources) {
      assert.ok(linkIds.has(source.link_id));
      assert.match(source.url, /^https:\/\//);
      assert.match(source.source_type, /^(?:official|third_party)_[a-z_]+$/);
    }
    for (const claim of [provider, ...provider.plans, ...(provider.promotions || [])]) {
      const evidence = claim.evidence;
      assert.equal(typeof evidence.verified, "boolean");
      assert.ok(Array.isArray(evidence.supports));
      assert.ok("content_sha256" in evidence);
      assert.ok("valid_from" in evidence);
      assert.ok("valid_until" in evidence);
      assert.ok(Number(evidence.stale_after_seconds) > 0);
      assert.equal(typeof evidence.is_stale, "boolean");
      if (evidence.verified) {
        assert.ok(linkIds.has(evidence.link_id));
        assert.match(evidence.verified_at, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(evidence.fetched_at, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(evidence.content_sha256, /^[a-f0-9]{64}$/);
      }
    }
  }
});

test("market evidence supports map to explicit fields and normalized hashes bind supports, inventory, and dates", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const now = new Date("2026-08-15T00:00:00.000Z");
  const allowedSupports = {
    market_provider: new Set(["provider_identity", "plan_inventory"]),
    market_plan: new Set(["plan_identity", "price", "quota", "eligibility", "effective_dates", "promotion"]),
    market_promotion: new Set(["promotion", "effective_dates"]),
  };

  for (const provider of raw.providers) {
    for (const claim of [provider, ...provider.plans, ...(provider.promotions || [])]) {
      const { claim_scope: scope, supports } = claim.evidence;
      for (const support of supports) {
        assert.ok(allowedSupports[scope]?.has(support), `${provider.id}/${scope} unsupported evidence field ${support}`);
      }
      if (scope === "market_plan" && supports.includes("price")) assert.ok(claim.price);
      if (scope === "market_plan" && supports.includes("quota")) assert.equal(typeof claim.quota_summary, "string");
      if (scope === "market_plan" && supports.includes("eligibility")) assert.ok(Array.isArray(claim.highlights));
      if (scope === "market_plan" && supports.includes("promotion")) {
        assert.ok((claim.alt_prices || []).some((price) => price.promotion_id));
      }
      if (supports.includes("effective_dates")) {
        assert.ok(claim.evidence.valid_from || claim.evidence.valid_until);
      }
    }
  }

  const glm = raw.providers.find((provider) => provider.id === "glm");
  assert.equal(replayMarketHash(glm), glm.evidence.content_sha256);
  const withoutPlan = structuredClone(glm);
  withoutPlan.plans.pop();
  assert.notEqual(replayMarketHash(withoutPlan), glm.evidence.content_sha256);
  const rawWithoutPlan = structuredClone(raw);
  rawWithoutPlan.providers.find((provider) => provider.id === "glm").plans.pop();
  assert.throws(() => projectPlanMarketCatalog(rawWithoutPlan, registry, { now }), /evidence hash mismatch/i);

  const promotion = glm.promotions[0];
  assert.equal(replayMarketHash(promotion), promotion.evidence.content_sha256);
  const extendedPromotion = structuredClone(promotion);
  extendedPromotion.evidence.valid_until = "2099-12-31";
  assert.notEqual(replayMarketHash(extendedPromotion), promotion.evidence.content_sha256);
  const rawWithExtendedPromotion = structuredClone(raw);
  rawWithExtendedPromotion.providers.find((provider) => provider.id === "glm")
    .promotions[0].evidence.valid_until = "2099-12-31";
  assert.throws(() => projectPlanMarketCatalog(rawWithExtendedPromotion, registry, { now }), /evidence hash mismatch/i);

  const expandedSupports = structuredClone(glm);
  expandedSupports.evidence.supports.push("promotion");
  assert.notEqual(replayMarketHash(expandedSupports), glm.evidence.content_sha256);
  const rawWithExpandedSupports = structuredClone(raw);
  rawWithExpandedSupports.providers.find((provider) => provider.id === "glm")
    .evidence.supports.push("promotion");
  assert.throws(() => projectPlanMarketCatalog(rawWithExpandedSupports, registry, { now }), /evidence hash mismatch/i);

  const claudePlan = raw.providers.find((provider) => provider.id === "claude").plans[0];
  const unsupportedMutation = structuredClone(claudePlan);
  unsupportedMutation.quota_summary = "not covered by this price evidence";
  assert.equal(replayMarketHash(unsupportedMutation), claudePlan.evidence.content_sha256);
  const rawWithUnsupportedMutation = structuredClone(raw);
  rawWithUnsupportedMutation.providers.find((provider) => provider.id === "claude")
    .plans[0].quota_summary = "not covered by this price evidence";
  assert.doesNotThrow(() => projectPlanMarketCatalog(rawWithUnsupportedMutation, registry, { now }));
});

test("verified market claims stay within supports declared by their exact source reference", () => {
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));

  for (const provider of raw.providers) {
    const sourceSupportsByLinkId = new Map((provider.sources || []).map((source) => [
      source.link_id,
      new Set(source.supports || []),
    ]));
    for (const claim of [provider, ...provider.plans, ...(provider.promotions || [])]) {
      if (!claim.evidence?.verified) continue;
      const sourceSupports = sourceSupportsByLinkId.get(claim.evidence.link_id);
      assert.ok(sourceSupports, `${provider.id}/${claim.evidence.claim_scope} evidence must join an exact source reference`);
      for (const support of claim.evidence.supports || []) {
        assert.ok(
          sourceSupports.has(support),
          `${provider.id}/${claim.evidence.claim_scope} ${support} exceeds source ${claim.evidence.link_id}`,
        );
      }
    }
  }
});

test("market projector rejects evidence support removed from its exact source reference", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const glm = raw.providers.find((provider) => provider.id === "glm");
  const overview = glm.sources.find((source) => source.link_id === "market-glm-overview");
  overview.supports = overview.supports.filter((support) => support !== "quota");

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /source.*quota|quota.*source/i,
  );
});

test("market projector rejects a normalized plan forged as source-body evidence", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const plan = raw.providers.find((provider) => provider.id === "aliyun-bailian").plans[0];
  plan.price.amount = 1;
  plan.evidence.content_hash_kind = "source_body_utf8_lf";

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /hash kind|normalized/i,
  );
});

test("GLM promotion evidence hash binds the exact plan purchase offers", () => {
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const withOffers = withExplicitGlmPromotionOffers(raw);
  const promotion = withOffers.providers.find((provider) => provider.id === "glm").promotions[0];
  const originalHash = replayMarketHash(promotion);
  promotion.offers[0].amount = 1;

  assert.notEqual(replayMarketHash(promotion), originalHash);
});

test("market projector rejects the unattested GLM Lite promotional amount 94.4 to 1", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  raw.providers.find((provider) => provider.id === "glm").plans[0].alt_prices[0].amount = 1;

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /promotion offer mismatch/i,
  );
});

test("market projector rejects changed and orphaned promotional purchase prices", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const withOffers = withExplicitGlmPromotionOffers(raw);
  const now = new Date("2026-08-15T00:00:00.000Z");

  const changedAmount = structuredClone(withOffers);
  changedAmount.providers.find((provider) => provider.id === "glm").plans[0].alt_prices[0].amount = 1;
  assert.throws(() => projectPlanMarketCatalog(changedAmount, registry, { now }), /promotion offer mismatch/i);

  const orphaned = structuredClone(withOffers);
  orphaned.providers.find((provider) => provider.id === "glm").plans[0]
    .alt_prices[0].promotion_id = "glm-orphan-promotion";
  assert.throws(() => projectPlanMarketCatalog(orphaned, registry, { now }), /orphan promotion/i);
});

test("market projector rejects duplicate promotional alt prices sharing one offer", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const plan = raw.providers.find((provider) => provider.id === "glm").plans[0];
  plan.alt_prices.push(structuredClone(plan.alt_prices[0]));

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /duplicate promotion price|one-to-one/i,
  );
});

test("market projector rejects a promotion offer left after its alt price is removed", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  raw.providers.find((provider) => provider.id === "glm").plans[0].alt_prices = [];

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /orphan promotion offer|one-to-one/i,
  );
});

test("market projector rejects a validly hashed promotion offer for an unknown plan", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const promotion = raw.providers.find((provider) => provider.id === "glm").promotions[0];
  promotion.offers.push({
    ...structuredClone(promotion.offers[0]),
    plan_id: "unknown-plan",
  });
  promotion.evidence.content_sha256 = replayMarketHash(promotion);

  assert.throws(
    () => projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") }),
    /unknown plan|orphan promotion offer|one-to-one/i,
  );
});

test("market freshness and promotion expiry are recomputed per read without hiding stale base plans", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const beforeExpiry = getPlanMarketCatalog({ now: new Date("2026-08-15T00:00:00.000Z") });
  const afterExpiry = getPlanMarketCatalog({ now: new Date("2026-08-20T12:00:00.000Z") });
  const farFuture = getPlanMarketCatalog({ now: new Date("2030-01-01T00:00:00.000Z") });

  const glmBefore = beforeExpiry.providers.find((provider) => provider.id === "glm");
  const glmAfter = afterExpiry.providers.find((provider) => provider.id === "glm");
  assert.match(JSON.stringify(glmBefore), /7 折|8 折/);
  assert.doesNotMatch(JSON.stringify(glmAfter), /7 折|8 折|限时/);

  assert.deepEqual(
    farFuture.providers.map((provider) => provider.id),
    afterExpiry.providers.map((provider) => provider.id),
    "stale base providers remain visible",
  );
  for (const provider of farFuture.providers) {
    assert.equal(provider.evidence.is_stale, true);
    assert.equal(provider.is_recent, false);
    assert.equal((provider.tags || []).some((tag) => ["latest", "new", "hot"].includes(tag)), false);
  }
});

test("pure market projector accepts raw data, provider-links, and an injected now", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");

  const before = projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-15T00:00:00.000Z") });
  const after = projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-20T12:00:00.000Z") });
  assert.match(JSON.stringify(before.providers.find((provider) => provider.id === "glm")), /7 折|8 折/);
  assert.doesNotMatch(JSON.stringify(after.providers.find((provider) => provider.id === "glm")), /7 折|8 折|限时/);
  assert.match(after.providers[0].sources[0].url, /^https:\/\//);
});

test("market projectors reject invalid injected now instead of reading the wall clock", () => {
  const { getPlanMarketCatalog, projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  for (const now of [null, "not-a-date", new Date(Number.NaN)]) {
    assert.throws(() => getPlanMarketCatalog({ now }), /now must be a valid date/i);
    assert.throws(() => projectPlanMarketCatalog(raw, registry, { now }), /now must be a valid date/i);
  }
});

test("official coverage requires the provider claim evidence itself to be official", () => {
  const { projectPlanMarketCatalog } = require("../src/lib/plan-market");
  const raw = JSON.parse(fsSync.readFileSync(path.join(__dirname, "..", "shared", "plan-market-catalog.json"), "utf8"));
  const registry = require("../shared/provider-links.json");
  const baseline = projectPlanMarketCatalog(raw, registry, { now: new Date("2026-08-20T12:00:00.000Z") });

  const mutated = structuredClone(raw);
  const openai = mutated.providers.find((provider) => provider.id === "openai");
  openai.evidence.link_id = "third-party-opentherank-ai-pricing";
  openai.sources.push({
    label: "第三方比较来源",
    link_id: "third-party-opentherank-ai-pricing",
    supports: [...openai.evidence.supports],
  });
  const projected = projectPlanMarketCatalog(mutated, registry, { now: new Date("2026-08-20T12:00:00.000Z") });

  assert.equal(projected.official_source_coverage.provider_count, baseline.official_source_coverage.provider_count - 1);
});

test("Volcengine drift removes unsupported purchase claims and OpenTheRank never raises official coverage", () => {
  const { getPlanMarketCatalog } = require("../src/lib/plan-market");
  const catalog = getPlanMarketCatalog({ now: new Date("2026-08-20T12:00:00.000Z") });
  const volcengine = catalog.providers.find((provider) => provider.id === "volcengine-doubao");

  assert.equal(volcengine.evidence.verified, false);
  assert.equal(volcengine.evidence.is_stale, true);
  assert.deepEqual(volcengine.plans, []);
  assert.doesNotMatch(JSON.stringify(volcengine), /(?:¥|￥)\s*19|1\s*亿|62\s*个|200\s*张|有效期\s*2\s*个月/);

  assert.equal(
    catalog.official_source_coverage.source_link_ids.includes("third-party-opentherank-ai-pricing"),
    false,
  );
  assert.ok(catalog.official_source_coverage.provider_count < catalog.providers.length + 1);
});
