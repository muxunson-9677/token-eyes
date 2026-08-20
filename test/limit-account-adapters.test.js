const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach, afterEach } = require("node:test");

require("./helpers/home-shim.cjs");

const {
  buildLimitAccountV2,
  buildLimitWindowV2,
  LIMIT_ACCOUNT_STATUS,
  LIMIT_WINDOW_KINDS,
  computeAccountKey,
  resetLimitAccountsCache,
} = require("../src/lib/limit-accounts");
const { resetUsageLimitsCache } = require("../src/lib/usage-limits");
const { getDefaultAdapters } = require("../src/lib/limit-account-adapters");
const { statusFromProviderEntry, windowWithEvidence } = require("../src/lib/limit-account-adapters/_shared");

// Build a fake usage-limits payload that adapters will see when getUsageLimits
// resolves. Mirrors the shape returned by usage-limits.js: each provider has
// { configured, error, plan_label, evidence, ...windows }.
function buildFakeLimits() {
  const evidence = {
    source_kind: "official_api",
    accuracy: "exact",
    coverage: "complete",
    observed_at: new Date().toISOString(),
    source_updated_at: null,
    stale_after_seconds: 300,
    is_stale: false,
    pricing_source: null,
    pricing_version: null,
    note_code: null,
  };
  return {
    fetched_at: new Date().toISOString(),
    claude: {
      configured: true,
      error: null,
      plan_label: "Pro",
      evidence,
      five_hour: { used_percent: 30, reset_at: "2026-07-26T05:00:00.000Z" },
      seven_day: { used_percent: 55, reset_at: "2026-08-01T00:00:00.000Z" },
    },
    codex: {
      configured: true,
      error: null,
      plan_label: "Plus",
      evidence,
      primary_window: { used_percent: 12, reset_at: 1_800_000_000, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 30, reset_at: 1_800_604_800, limit_window_seconds: 604800 },
    },
    cursor: {
      configured: true,
      error: null,
      plan_label: "Pro",
      evidence,
      primary_window: { used_percent: 50, reset_at: "2026-07-26T10:00:00.000Z" },
    },
    kimi: {
      configured: true,
      error: null,
      plan_label: null,
      evidence,
      primary_window: { used_percent: 64, reset_at: "2026-07-26T06:00:00.000Z" },
    },
    gemini: {
      configured: true,
      error: null,
      plan_label: "Pro",
      evidence,
      account_email: "user@example.com",
      primary_window: { used_percent: 20, reset_at: "2026-07-26T12:00:00.000Z" },
    },
    kiro: {
      configured: true,
      error: null,
      plan_label: "Free",
      evidence,
      primary_window: { used_percent: 10, reset_at: "2026-07-26T15:00:00.000Z" },
    },
    antigravity: {
      configured: true,
      error: null,
      plan_label: "Pro",
      evidence,
      account_email: "agent@example.com",
      primary_window: { used_percent: 5, reset_at: "2026-07-26T18:00:00.000Z" },
    },
    copilot: {
      configured: true,
      error: null,
      plan_label: "Business",
      evidence,
      primary_window: { used_percent: 8, reset_at: "2026-07-26T20:00:00.000Z" },
    },
    grok: {
      configured: true,
      error: null,
      plan_label: null,
      evidence,
      primary_window: { used_percent: 15, reset_at: "2026-07-26T22:00:00.000Z" },
    },
  };
}

// Inject a fake getUsageLimits into usage-limits.js cache so adapters that
// call getUsageLimits() pick up our fixture without touching the network.
function installFakeUsageLimits(payload) {
  resetUsageLimitsCache();
  // Adapters call getUsageLimits({ home, env, ... }) which reads from the
  // in-memory cache after the first fetch. We prime the cache by calling the
  // real getUsageLimits with a forced fetch override. The simplest hermetic
  // approach is to monkey-patch the module's getUsageLimits export for the
  // duration of the test.
  const usageLimits = require("../src/lib/usage-limits");
  const original = usageLimits.getUsageLimits;
  usageLimits.getUsageLimits = async () => payload;
  return () => {
    usageLimits.getUsageLimits = original;
  };
}

// Stub credential readers so adapters don't touch the real filesystem.
// Each adapter lazy-requires its credential reader; we inject via the
// module cache so the adapter picks up our stub.
function installFakeCredentials() {
  const subscriptions = require("../src/lib/subscriptions");
  const originalReadCodexAuthBundle = subscriptions.readCodexAuthBundle;
  const originalReadClaudeToken = subscriptions.readClaudeCodeAccessToken;
  subscriptions.readCodexAuthBundle = async () => ({ accountId: "acct-codex-123", accessToken: "fake" });
  subscriptions.readClaudeCodeAccessToken = async () => null;

  const cursorConfig = require("../src/lib/cursor-config");
  const originalIsCursorInstalled = cursorConfig.isCursorInstalled;
  const originalExtractCursorSessionToken = cursorConfig.extractCursorSessionToken;
  cursorConfig.isCursorInstalled = () => true;
  cursorConfig.extractCursorSessionToken = async () => ({ userId: "cursor-user-456", cookie: "fake" });

  const usageLimits = require("../src/lib/usage-limits");
  const originalLoadKimi = usageLimits.loadKimiCredentials;
  usageLimits.loadKimiCredentials = async () => ({ account: "kimi-acct-789" });

  const grokLimits = require("../src/lib/grok-limits");
  const originalReadGrok = grokLimits.readGrokAccessToken;
  grokLimits.readGrokAccessToken = async () => "grok-token";

  return () => {
    subscriptions.readCodexAuthBundle = originalReadCodexAuthBundle;
    subscriptions.readClaudeCodeAccessToken = originalReadClaudeToken;
    cursorConfig.isCursorInstalled = originalIsCursorInstalled;
    cursorConfig.extractCursorSessionToken = originalExtractCursorSessionToken;
    usageLimits.loadKimiCredentials = originalLoadKimi;
    grokLimits.readGrokAccessToken = originalReadGrok;
  };
}

describe("limit-account-adapters shared helpers", () => {
  it("statusFromProviderEntry maps configured+error+401 to auth_error", () => {
    assert.equal(statusFromProviderEntry({ configured: true, error: "Claude token expired" }), LIMIT_ACCOUNT_STATUS.AUTH_ERROR);
    assert.equal(statusFromProviderEntry({ configured: true, error: "Claude API returned 401" }), LIMIT_ACCOUNT_STATUS.AUTH_ERROR);
  });

  it("statusFromProviderEntry maps 429 to rate_limited", () => {
    assert.equal(statusFromProviderEntry({ configured: true, error: "Claude API rate limited (429)" }), LIMIT_ACCOUNT_STATUS.RATE_LIMITED);
  });

  it("statusFromProviderEntry maps generic errors to unavailable", () => {
    assert.equal(statusFromProviderEntry({ configured: true, error: "Network timeout" }), LIMIT_ACCOUNT_STATUS.UNAVAILABLE);
  });

  it("statusFromProviderEntry maps unconfigured to unavailable", () => {
    assert.equal(statusFromProviderEntry({ configured: false }), LIMIT_ACCOUNT_STATUS.UNAVAILABLE);
    assert.equal(statusFromProviderEntry(null), LIMIT_ACCOUNT_STATUS.UNAVAILABLE);
  });

  it("statusFromProviderEntry maps configured+no-error to ok", () => {
    assert.equal(statusFromProviderEntry({ configured: true, error: null }), LIMIT_ACCOUNT_STATUS.OK);
  });

  it("statusFromProviderEntry maps stale entries to stale", () => {
    assert.equal(statusFromProviderEntry({ configured: true, error: null, stale: true }), LIMIT_ACCOUNT_STATUS.STALE);
  });

  it("windowWithEvidence propagates evidence to each window", () => {
    const evidence = {
      source_kind: "official_api",
      accuracy: "exact",
      coverage: "complete",
      observed_at: new Date().toISOString(),
      source_updated_at: null,
      stale_after_seconds: 300,
      is_stale: false,
      pricing_source: null,
      pricing_version: null,
      note_code: null,
    };
    const w = windowWithEvidence({
      kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
      label: "5h",
      window: { used_percent: 42, reset_at: "2026-07-26T05:00:00.000Z" },
      evidence,
    });
    assert.equal(w.kind, "five_hour");
    assert.equal(w.label, "5h");
    assert.equal(w.used_percent, 42);
    assert.equal(w.evidence.source_kind, "official_api");
  });

  it("windowWithEvidence returns null for missing window", () => {
    assert.equal(windowWithEvidence({ kind: LIMIT_WINDOW_KINDS.FIVE_HOUR, label: "5h", window: null, evidence: null }), null);
  });
});

describe("getDefaultAdapters", () => {
  it("returns one adapter per supported provider", () => {
    const adapters = getDefaultAdapters();
    const providerIds = Object.keys(adapters).sort();
    assert.deepEqual(providerIds, [
      "antigravity",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "gemini",
      "grok",
      "kimi",
      "kiro",
      "zed",
    ]);
    for (const id of providerIds) {
      assert.equal(typeof adapters[id], "function", `${id} adapter must be a function`);
    }
  });
});

describe("adapter mapping (hermetic)", () => {
  let restoreLimits;
  let restoreCreds;

  beforeEach(() => {
    resetUsageLimitsCache();
    resetLimitAccountsCache();
    restoreLimits = installFakeUsageLimits(buildFakeLimits());
    restoreCreds = installFakeCredentials();
  });

  afterEach(() => {
    restoreLimits();
    restoreCreds();
    resetUsageLimitsCache();
    resetLimitAccountsCache();
  });

  it("codex adapter maps primary+secondary windows and produces one account", async () => {
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.codex({ salt, home: "/tmp/fake", env: {} });
    assert.equal(accounts.length, 1);
    const acc = accounts[0];
    assert.equal(acc.provider_id, "codex");
    assert.equal(acc.status, "ok");
    assert.equal(acc.plan_label, "Plus");
    assert.equal(acc.windows.length, 2);
    assert.equal(acc.windows[0].kind, "five_hour");
    assert.equal(acc.windows[0].label, "5h");
    assert.equal(acc.windows[0].used_percent, 12);
    assert.equal(acc.windows[1].kind, "seven_day");
    assert.equal(acc.windows[1].label, "7d");
    assert.equal(acc.windows[1].used_percent, 30);
    // Raw account id must never appear in the serialized output.
    assert.ok(!JSON.stringify(acc).includes("acct-codex-123"));
  });

  it("Task 8 Codex account adapter preserves the canonical 401/403 reauth error code", async () => {
    restoreLimits();
    restoreCreds();
    resetUsageLimitsCache();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-codex-adapter-401-"));
    try {
      const codexHome = path.join(home, ".codex");
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        path.join(codexHome, "auth.json"),
        JSON.stringify({ tokens: { access_token: "opaque-token" } }),
      );

      for (const status of [401, 403]) {
        resetUsageLimitsCache();
        const adapters = getDefaultAdapters();
        const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
        const accounts = await adapters.codex({
          salt,
          home,
          env: {},
          platform: "linux",
          providerTimeoutMs: 100,
          securityRunner() {
            return { status: 1, stdout: "" };
          },
          commandRunner() {
            return { status: 1, stdout: "" };
          },
          fetchImpl(url) {
            if (typeof url === "string" && url.includes("chatgpt.com/backend-api/wham/usage")) {
              return Promise.resolve({ ok: false, status, json: async () => ({}) });
            }
            return new Promise(() => {});
          },
        });

        assert.equal(accounts.length, 1, status);
        assert.equal(accounts[0].status, "auth_error", status);
        assert.equal(accounts[0].error_code, "auth_required", status);
        assert.deepEqual(accounts[0].windows, [], status);
        assert.doesNotMatch(JSON.stringify(accounts[0]), /opaque-token/i);
      }
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("claude adapter maps five_hour + seven_day windows", async () => {
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.claude({ salt, home: "/tmp/fake", env: {} });
    assert.equal(accounts.length, 1);
    const acc = accounts[0];
    assert.equal(acc.provider_id, "claude");
    assert.equal(acc.status, "ok");
    assert.equal(acc.plan_label, "Pro");
    assert.equal(acc.windows.length, 2);
    assert.equal(acc.windows[0].kind, "five_hour");
    assert.equal(acc.windows[0].used_percent, 30);
    assert.equal(acc.windows[1].kind, "seven_day");
    assert.equal(acc.windows[1].used_percent, 55);
  });

  it("cursor adapter maps primary window", async () => {
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.cursor({ salt, home: "/tmp/fake", env: {} });
    assert.equal(accounts.length, 1);
    const acc = accounts[0];
    assert.equal(acc.provider_id, "cursor");
    assert.equal(acc.status, "ok");
    assert.equal(acc.windows.length, 1);
    assert.equal(acc.windows[0].used_percent, 50);
    assert.ok(!JSON.stringify(acc).includes("cursor-user-456"));
  });

  it("gemini adapter uses account_email as rawAccountId (hashed)", async () => {
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.gemini({ salt, home: "/tmp/fake", env: {} });
    assert.equal(accounts.length, 1);
    const acc = accounts[0];
    assert.equal(acc.provider_id, "gemini");
    assert.equal(acc.status, "ok");
    // The raw email must never appear in the serialized output.
    assert.ok(!JSON.stringify(acc).includes("user@example.com"));
  });

  it("copilot adapter hashes the exact credential identity selected by the quota request", async () => {
    const limits = buildFakeLimits();
    const selectedIdentity = "sha256:synthetic-selected-candidate";
    limits.copilot[Symbol.for("tokentracker.copilot.credential-identity")] = selectedIdentity;
    restoreLimits();
    restoreLimits = installFakeUsageLimits(limits);

    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.copilot({ salt, home: "/tmp/fake", env: {} });

    assert.equal(accounts.length, 1);
    assert.equal(
      accounts[0].account_key,
      computeAccountKey({ providerId: "copilot", rawAccountId: selectedIdentity, salt }),
    );
    assert.doesNotMatch(JSON.stringify(accounts[0]), /synthetic-selected-candidate|copilot-token/);
  });

  it("copilot adapter preserves a detected Windows secure-store unsupported state", async () => {
    const limits = buildFakeLimits();
    limits.copilot = {
      configured: true,
      error: "secure_store_unsupported",
      error_code: "secure_store_unsupported",
      plan_label: null,
      evidence: null,
    };
    restoreLimits();
    restoreLimits = installFakeUsageLimits(limits);

    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.copilot({ salt, home: "/tmp/fake", env: {} });

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].status, "unavailable");
    assert.equal(accounts[0].error_code, "secure_store_unsupported");
  });

  it("all adapters return [] when the provider is not configured", async () => {
    const unconfigured = {
      fetched_at: new Date().toISOString(),
      claude: { configured: false },
      codex: { configured: false },
      cursor: { configured: false },
      kimi: { configured: false },
      gemini: { configured: false },
      kiro: { configured: false },
      antigravity: { configured: false },
      copilot: { configured: false },
      grok: { configured: false },
    };
    restoreLimits();
    restoreLimits = installFakeUsageLimits(unconfigured);
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    for (const [id, adapter] of Object.entries(adapters)) {
      const accounts = await adapter({ salt, home: "/tmp/fake", env: {} });
      assert.deepEqual(accounts, [], `${id} adapter must return [] when unconfigured`);
    }
  });

  it("an adapter whose provider entry has an auth error surfaces auth_error status", async () => {
    const errored = {
      fetched_at: new Date().toISOString(),
      claude: { configured: true, error: "Claude token expired — run `claude` once to refresh.", plan_label: null, evidence: null },
      codex: { configured: false },
      cursor: { configured: false },
      kimi: { configured: false },
      gemini: { configured: false },
      kiro: { configured: false },
      antigravity: { configured: false },
      copilot: { configured: false },
      grok: { configured: false },
    };
    restoreLimits();
    restoreLimits = installFakeUsageLimits(errored);
    const adapters = getDefaultAdapters();
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const accounts = await adapters.claude({ salt, home: "/tmp/fake", env: {} });
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].status, "auth_error");
    assert.equal(accounts[0].error_code, "auth_error");
    assert.deepEqual(accounts[0].windows, []);
  });
});
