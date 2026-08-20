const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const REPO_ROOT = path.join(__dirname, "..");
const PROVIDER_LINKS_PATH = path.join(REPO_ROOT, "shared", "provider-links.json");
const CATALOG_DIR = path.join(REPO_ROOT, "src", "lib", "token-plan-catalog");
const CATALOG_FILES = [
  "aliyun-bailian.catalog.json",
  "claude.catalog.json",
  "codex.catalog.json",
  "cursor.catalog.json",
  "glm.catalog.json",
  "kimi.catalog.json",
  "minimax.catalog.json",
  "trae.catalog.json",
  "xiaomi-mimo.catalog.json",
  "zcode.catalog.json",
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedClaim(claim, scope) {
  const supports = [...(claim.evidence?.supports || [])].sort();
  const normalized = { claim_scope: scope, supports };
  if (scope === "catalog_provider") {
    if (supports.includes("provider_identity")) Object.assign(normalized, {
      provider_id: claim.provider_id,
      provider_name: claim.provider_name,
      catalog_version: claim.catalog_version,
    });
    return normalized;
  }
  if (scope === "catalog_plan") {
    if (supports.includes("plan_identity")) Object.assign(normalized, {
      plan_id: claim.plan_id,
      display_name: claim.display_name,
    });
    if (supports.includes("quota")) normalized.quota = claim.quota;
    if (supports.includes("effective_dates")) Object.assign(normalized, {
      valid_from: claim.evidence.valid_from,
      valid_until: claim.evidence.valid_until,
    });
    return normalized;
  }
  throw new Error(`unsupported normalized claim scope ${scope}`);
}

function replayNormalizedHash(claim) {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(normalizedClaim(claim, claim.evidence.claim_scope)), "utf8")
    .digest("hex");
}

test("provider-links is the sole URL authority for every token-plan catalog", () => {
  assert.equal(fs.existsSync(PROVIDER_LINKS_PATH), true, "shared/provider-links.json must exist");
  const registry = JSON.parse(fs.readFileSync(PROVIDER_LINKS_PATH, "utf8"));
  assert.equal(registry?._meta?.schema_version, 1);
  assert.ok(Array.isArray(registry.links) && registry.links.length > 0);

  const linkIds = new Set();
  const urls = new Set();
  for (const link of registry.links) {
    assert.match(String(link.link_id || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(linkIds.has(link.link_id), false, `duplicate link_id ${link.link_id}`);
    linkIds.add(link.link_id);

    const original = new URL(link.url);
    assert.equal(original.protocol, "https:", `${link.link_id} must use HTTPS`);
    assert.equal(original.username, "", `${link.link_id} must not contain credentials`);
    assert.equal(original.password, "", `${link.link_id} must not contain credentials`);
    assert.equal(original.port, "", `${link.link_id} must not contain a non-default port`);
    assert.equal(urls.has(original.href), false, `duplicate registry URL ${original.href}`);
    urls.add(original.href);

    assert.ok(Array.isArray(link.allowed_hosts) && link.allowed_hosts.length > 0);
    assert.ok(link.allowed_hosts.includes(original.hostname));
    assert.ok(link.allowed_hosts.every((host) => host === host.toLowerCase() && !host.includes(":")));
    assert.match(String(link.source_type || ""), /^(?:official|third_party)_[a-z_]+$/);

    const expected = new URL(link.expected_final?.url);
    assert.equal(expected.protocol, "https:");
    assert.equal(link.expected_final?.path, expected.pathname);
    assert.ok(link.allowed_hosts.includes(expected.hostname));
  }

  for (const fileName of CATALOG_FILES) {
    const raw = fs.readFileSync(path.join(CATALOG_DIR, fileName), "utf8");
    assert.doesNotMatch(raw, /https?:\/\//, `${fileName} must use link_id references instead of URL literals`);
    const catalog = JSON.parse(raw);
    assert.ok(linkIds.has(catalog.official_site_link_id), `${fileName} official site must join provider-links`);
    assert.equal(typeof catalog.evidence?.verified, "boolean", `${fileName} provider claim needs provenance`);
    for (const source of catalog.sources || []) {
      assert.ok(linkIds.has(source.link_id), `${fileName} source must join provider-links`);
      assert.ok(Array.isArray(source.supports) && source.supports.length > 0);
    }
    for (const plan of catalog.plans || []) {
      assert.ok(linkIds.has(plan.evidence?.link_id), `${fileName}/${plan.plan_id} must join provider-links`);
    }
  }
});

test("verified token-plan claims join an exact catalog source whose supports cover the claim", () => {
  const violations = [];
  for (const fileName of CATALOG_FILES) {
    const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, fileName), "utf8"));
    const sourcesByLinkId = new Map((catalog.sources || []).map((source) => [source.link_id, source]));
    for (const claim of [catalog, ...(catalog.plans || [])]) {
      const evidence = claim.evidence;
      if (!evidence?.verified) continue;
      const source = sourcesByLinkId.get(evidence.link_id);
      const claimName = claim.plan_id || claim.provider_id;
      if (!source) {
        violations.push(`${fileName}/${claimName}: missing exact source ${evidence.link_id}`);
        continue;
      }
      const sourceSupports = new Set(source.supports || []);
      for (const support of evidence.supports || []) {
        if (!sourceSupports.has(support)) {
          violations.push(`${fileName}/${claimName}: ${support} exceeds source ${evidence.link_id}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("token-plan production loader rejects a verified claim that exceeds its exact source supports", () => {
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const target = path.resolve("src/lib/token-plan-catalog/glm.catalog.json");
    const forged = JSON.parse(fs.readFileSync(target, "utf8"));
    const source = forged.sources.find((entry) => entry.link_id === forged.plans[0].evidence.link_id);
    source.supports = source.supports.filter((support) => support !== "quota");
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === target) return JSON.stringify(forged);
      return originalReadFileSync.call(this, filePath, ...args);
    };
    const errors = [];
    console.error = (...args) => errors.push(args.join(" "));
    const result = require("./src/lib/token-plan-catalog")
      .getProviderCatalog("glm", { now: new Date("2026-08-20T00:00:00.000Z") });
    if (result !== null) {
      process.stderr.write("production loader accepted excess claim support");
      process.exit(2);
    }
    if (!errors.some((message) => /source.*quota|quota.*source/i.test(message))) {
      process.stderr.write(errors.join("\n") || "missing source-support diagnostic");
      process.exit(3);
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("token-plan production loader rejects a normalized Codex claim forged as source-body evidence", () => {
  const script = String.raw`
    const fs = require("node:fs");
    const path = require("node:path");
    const target = path.resolve("src/lib/token-plan-catalog/codex.catalog.json");
    const forged = JSON.parse(fs.readFileSync(target, "utf8"));
    const providerSource = forged.sources.find((entry) => entry.link_id === forged.evidence.link_id);
    providerSource.supports = [...new Set([...(providerSource.supports || []), "provider_identity"])];
    forged.plans[0].display_name = "FORGED_PLAN";
    forged.plans[0].evidence.content_hash_kind = "source_body_utf8_lf";
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
      if (path.resolve(String(filePath)) === target) return JSON.stringify(forged);
      return originalReadFileSync.call(this, filePath, ...args);
    };
    const errors = [];
    console.error = (...args) => errors.push(args.join(" "));
    const result = require("./src/lib/token-plan-catalog")
      .getProviderCatalog("codex", { now: new Date("2026-08-20T00:00:00.000Z") });
    if (result?.plans?.some((plan) => plan.display_name === "FORGED_PLAN")) {
      process.stderr.write("production loader exposed forged normalized claim");
      process.exit(2);
    }
    if (!errors.some((message) => /hash kind|normalized/i.test(message))) {
      process.stderr.write(errors.join("\n") || "missing hash-kind diagnostic");
      process.exit(3);
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("catalog claim hashes replay normalized extracted fields and unverified claims keep a null hash", () => {
  for (const fileName of CATALOG_FILES) {
    const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, fileName), "utf8"));
    for (const claim of [catalog, ...(catalog.plans || [])]) {
      const evidence = claim.evidence;
      assert.ok(evidence, `${fileName} claim needs evidence`);
      if (!evidence.verified) {
        assert.equal(evidence.content_sha256, null, `${fileName} unverified claim must not invent a hash`);
        continue;
      }
      if (evidence.content_hash_kind === "normalized_extracted_fields_v1") {
        assert.equal(evidence.content_sha256, replayNormalizedHash(claim), `${fileName} hash must replay`);
      } else {
        assert.equal(evidence.content_hash_kind, "source_body_utf8_lf");
        assert.match(evidence.content_sha256, /^[a-f0-9]{64}$/);
      }
    }
  }
});

test("catalog normalized hashes bind supports and exclude fields the evidence does not support", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, "codex.catalog.json"), "utf8"));
  const plan = catalog.plans[0];
  assert.equal(replayNormalizedHash(plan), plan.evidence.content_sha256);

  const expanded = structuredClone(plan);
  expanded.evidence.supports.push("quota");
  assert.notEqual(replayNormalizedHash(expanded), plan.evidence.content_sha256);

  const unsupportedMutation = structuredClone(plan);
  unsupportedMutation.quota.display = "unsupported field mutation";
  assert.equal(replayNormalizedHash(unsupportedMutation), plan.evidence.content_sha256);
});

test("token-plan catalog rejects an invalid injected now instead of reading the wall clock", () => {
  const { getProviderCatalog } = require("../src/lib/token-plan-catalog");
  for (const now of [null, "not-a-date", new Date(Number.NaN)]) {
    assert.throws(() => getProviderCatalog("glm", { now }), /now must be a valid date/i);
  }
});

test("token-plan catalog recomputes provenance freshness on every read across the TTL boundary", () => {
  const { getProviderCatalog } = require("../src/lib/token-plan-catalog");
  const seed = getProviderCatalog("glm", { now: new Date("2026-08-20T00:00:00.000Z") });
  const evidence = seed?.plans?.[0]?.evidence;

  assert.ok(evidence, "projected plans must expose provenance evidence");
  assert.match(String(evidence.link_id || ""), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(Array.isArray(evidence.supports) && evidence.supports.includes("quota"));
  assert.equal(evidence.verified, true);
  assert.match(String(evidence.content_sha256 || ""), /^[a-f0-9]{64}$/);
  assert.equal(Number.isFinite(Number(evidence.stale_after_seconds)), true);
  assert.match(seed.plans[0].official_evidence_url, /^https:\/\//);

  const deadline = Date.parse(`${evidence.fetched_at}T00:00:00.000Z`)
    + Number(evidence.stale_after_seconds) * 1000;
  const justFresh = getProviderCatalog("glm", { now: new Date(deadline - 1) });
  const justStale = getProviderCatalog("glm", { now: new Date(deadline + 1) });

  assert.equal(justFresh.plans[0].evidence.is_stale, false, "TTL - 1ms must remain fresh");
  assert.equal(justStale.plans[0].evidence.is_stale, true, "TTL + 1ms must be stale");
  assert.match(justFresh.plans[0].entitlement_windows[0].source_url, /^https:\/\//);
  assert.equal(justFresh.plans[0].entitlement_windows[0].link_id, evidence.link_id);
  assert.equal(justStale.plans[0].entitlement_windows[0].is_stale, true);
});
