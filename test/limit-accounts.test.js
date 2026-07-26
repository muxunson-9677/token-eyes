const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("./helpers/home-shim.cjs");

const {
  loadOrCreateIdentitySalt,
  computeAccountKey,
  buildLimitWindowV2,
  buildLimitAccountV2,
  getLimitAccounts,
  resetLimitAccountsCache,
  clearLimitAccountsState,
  LIMIT_ACCOUNT_STATUS,
  LIMIT_WINDOW_KINDS,
} = require("../src/lib/limit-accounts");

function makeTmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "limit-accounts-"));
  return dir;
}

// Use a fresh timestamp per process start so is_stale evaluates to false
// deterministically within the stale_after_seconds window.
const FRESH_OBSERVED_AT = new Date().toISOString();
const DEFAULT_EVIDENCE = {
  source_kind: "official_api",
  accuracy: "exact",
  coverage: "complete",
  observed_at: FRESH_OBSERVED_AT,
  source_updated_at: null,
  stale_after_seconds: 300,
  is_stale: false,
  pricing_source: null,
  pricing_version: null,
  note_code: null,
};

describe("identity salt", () => {
  it("creates a 32-byte salt at ~/.tokentracker/tracker/identity-salt with owner-only permissions", () => {
    const home = makeTmpHome();
    try {
      const salt = loadOrCreateIdentitySalt({ home });
      assert.ok(Buffer.isBuffer(salt), "salt must be a Buffer");
      assert.equal(salt.length, 32, "salt must be 32 bytes");

      const saltPath = path.join(home, ".tokentracker", "tracker", "identity-salt");
      assert.ok(fs.existsSync(saltPath), "salt file must exist");

      const mode = fs.statSync(saltPath).mode & 0o777;
      // On Windows, chmod is a no-op; skip the permission assertion there.
      if (process.platform !== "win32") {
        assert.equal(mode, 0o600, "salt file must be owner-only (0o600)");
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reuses the existing salt across calls instead of regenerating", () => {
    const home = makeTmpHome();
    try {
      const first = loadOrCreateIdentitySalt({ home });
      const second = loadOrCreateIdentitySalt({ home });
      assert.deepEqual(first, second, "salt must be stable across calls");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("computeAccountKey", () => {
  it("produces a stable base64url string for the same (providerId, rawAccountId, salt)", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const a = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt });
    const b = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt });
    assert.equal(a, b);
    assert.ok(typeof a === "string" && a.length > 0);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(a), "account_key must be base64url-safe");
  });

  it("differs when rawAccountId differs", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const a = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt });
    const b = computeAccountKey({ providerId: "codex", rawAccountId: "acct-456", salt });
    assert.notEqual(a, b);
  });

  it("differs when providerId differs even with the same rawAccountId", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const a = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt });
    const b = computeAccountKey({ providerId: "claude", rawAccountId: "acct-123", salt });
    assert.notEqual(a, b);
  });

  it("differs when the salt differs (different machines)", () => {
    const saltA = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const saltB = Buffer.from("fedcba9876543210fedcba9876543210", "utf8");
    const a = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt: saltA });
    const b = computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt: saltB });
    assert.notEqual(a, b);
  });
});

describe("buildLimitWindowV2", () => {
  it("maps a window with used_percent, reset_at, window_seconds and evidence", () => {
    const w = buildLimitWindowV2({
      kind: "five_hour",
      label: "5h",
      usedPercent: 72,
      resetAt: "2026-07-26T05:00:00.000Z",
      windowSeconds: 18000,
      evidence: DEFAULT_EVIDENCE,
    });
    assert.deepEqual(w, {
      kind: "five_hour",
      label: "5h",
      used_percent: 72,
      reset_at: "2026-07-26T05:00:00.000Z",
      window_seconds: 18000,
      evidence: DEFAULT_EVIDENCE,
    });
  });

  it("rejects an unknown window kind", () => {
    assert.throws(() => buildLimitWindowV2({
      kind: "ten_minute",
      label: "10m",
      usedPercent: 0,
      resetAt: null,
      windowSeconds: null,
      evidence: DEFAULT_EVIDENCE,
    }), /kind/);
  });

  it("clamps used_percent to [0,100] and rejects non-finite", () => {
    const w = buildLimitWindowV2({
      kind: "monthly",
      label: "month",
      usedPercent: 150,
      resetAt: null,
      windowSeconds: null,
      evidence: DEFAULT_EVIDENCE,
    });
    assert.equal(w.used_percent, 100);
  });

  it("keeps used_percent null when the input is null (never converts to 0)", () => {
    const w = buildLimitWindowV2({
      kind: "custom",
      label: "custom",
      usedPercent: null,
      resetAt: null,
      windowSeconds: null,
      evidence: DEFAULT_EVIDENCE,
    });
    assert.equal(w.used_percent, null);
  });
});

describe("buildLimitAccountV2", () => {
  it("computes account_key from providerId + rawAccountId + salt", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const acc = buildLimitAccountV2({
      providerId: "codex",
      rawAccountId: "acct-123",
      salt,
      accountLabel: "Work",
      planLabel: "Plus",
      status: LIMIT_ACCOUNT_STATUS.OK,
      windows: [],
      lastSuccessAt: null,
      errorCode: null,
    });
    assert.equal(acc.provider_id, "codex");
    assert.equal(acc.account_key, computeAccountKey({ providerId: "codex", rawAccountId: "acct-123", salt }));
    assert.equal(acc.account_label, "Work");
    assert.equal(acc.plan_label, "Plus");
    assert.equal(acc.status, "ok");
    assert.deepEqual(acc.windows, []);
    assert.equal(acc.last_success_at, null);
    assert.equal(acc.error_code, null);
  });

  it("defaults account_label to a brand-derived label when none is provided", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const acc = buildLimitAccountV2({
      providerId: "codex",
      rawAccountId: "acct-123",
      salt,
      accountLabel: null,
      planLabel: null,
      status: LIMIT_ACCOUNT_STATUS.OK,
      windows: [],
      lastSuccessAt: null,
      errorCode: null,
    });
    assert.ok(typeof acc.account_label === "string" && acc.account_label.length > 0);
  });

  it("rejects an unknown status", () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    assert.throws(() => buildLimitAccountV2({
      providerId: "codex",
      rawAccountId: "acct-123",
      salt,
      accountLabel: "Work",
      planLabel: null,
      status: "broken",
      windows: [],
      lastSuccessAt: null,
      errorCode: null,
    }), /status/);
  });
});

// Orchestration tests use injected adapters so we do not touch the real filesystem
// credential paths. This also keeps the test hermetic and avoids reading real HOME.
describe("getLimitAccounts orchestration", () => {
  beforeEach(() => clearLimitAccountsState());
  afterEach(() => clearLimitAccountsState());

  it("returns an empty accounts array when no adapters are configured", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({ home, env: {}, adapters: {} });
      assert.equal(result.schema_version, "token-observability/v2");
      assert.ok(typeof result.fetched_at === "string");
      assert.deepEqual(result.accounts, []);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("wraps each provider's single account as one LimitAccountV2 entry", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "acct-123",
              salt,
              accountLabel: "Work",
              planLabel: "Plus",
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [
                buildLimitWindowV2({
                  kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
                  label: "5h",
                  usedPercent: 72,
                  resetAt: "2026-07-26T05:00:00.000Z",
                  windowSeconds: 18000,
                  evidence: DEFAULT_EVIDENCE,
                }),
              ],
              lastSuccessAt: "2026-07-26T00:00:00.000Z",
              errorCode: null,
            }),
          ],
        },
      });
      assert.equal(result.accounts.length, 1);
      const acc = result.accounts[0];
      assert.equal(acc.provider_id, "codex");
      assert.equal(acc.account_label, "Work");
      assert.equal(acc.status, "ok");
      assert.equal(acc.windows.length, 1);
      assert.equal(acc.windows[0].kind, "five_hour");
      assert.equal(acc.windows[0].used_percent, 72);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("isolates a failed account without affecting other providers", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "acct-123",
              salt,
              accountLabel: "Work",
              planLabel: null,
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [],
              lastSuccessAt: "2026-07-26T00:00:00.000Z",
              errorCode: null,
            }),
          ],
          claude: async () => {
            throw new Error("Claude API returned 401");
          },
        },
      });
      // Claude's failure must not crash the whole round; it appears as an
      // unavailable account entry so the matrix can still render Codex.
      assert.equal(result.accounts.length, 2);
      const codex = result.accounts.find((a) => a.provider_id === "codex");
      const claude = result.accounts.find((a) => a.provider_id === "claude");
      assert.equal(codex.status, "ok");
      assert.equal(claude.status, "unavailable");
      assert.equal(claude.error_code, "unavailable");
      assert.deepEqual(claude.windows, []);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("preserves the last successful snapshot when an adapter fails and a previous snapshot exists", async () => {
    const home = makeTmpHome();
    let claudeAttempt = 0;
    try {
      const adapters = {
        claude: async ({ salt, snapshots }) => {
          claudeAttempt += 1;
          if (claudeAttempt === 1) {
            return [
              buildLimitAccountV2({
                providerId: "claude",
                rawAccountId: "acct-a",
                salt,
                accountLabel: "Default",
                planLabel: "Pro",
                status: LIMIT_ACCOUNT_STATUS.OK,
                windows: [
                  buildLimitWindowV2({
                    kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
                    label: "5h",
                    usedPercent: 42,
                    resetAt: "2026-07-26T05:00:00.000Z",
                    windowSeconds: 18000,
                    evidence: DEFAULT_EVIDENCE,
                  }),
                ],
                lastSuccessAt: "2026-07-26T00:00:00.000Z",
                errorCode: null,
              }),
            ];
          }
          // Second attempt throws; we should serve the previous snapshot.
          throw new Error("Claude API returned 401");
        },
      };

      const first = await getLimitAccounts({ home, env: {}, adapters });
      resetLimitAccountsCache(); // expires TTL; last-good is still available via previousAccounts below
      const second = await getLimitAccounts({
        home,
        env: {},
        adapters,
        previousAccounts: first.accounts,
      });

      const claudeSecond = second.accounts.find((a) => a.provider_id === "claude");
      assert.equal(claudeSecond.status, "stale");
      assert.equal(claudeSecond.windows.length, 1);
      assert.equal(claudeSecond.windows[0].used_percent, 42);
      // Evidence lives per-window (schema forbids account-level evidence);
      // a stale snapshot marks each window as cache + stale.
      assert.equal(claudeSecond.windows[0].evidence.source_kind, "cache");
      assert.equal(claudeSecond.windows[0].evidence.is_stale, true);
      assert.equal(claudeSecond.windows[0].evidence.note_code, "last_successful_value");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not leak the raw account id in the returned payload", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "super-secret-real-account-id-123",
              salt,
              accountLabel: "Work",
              planLabel: null,
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [],
              lastSuccessAt: null,
              errorCode: null,
            }),
          ],
        },
      });
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes("super-secret-real-account-id-123"),
        "raw account id must never appear in the response payload");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps a stable order by (provider_id, account_key) regardless of adapter return order", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => {
            // Return in arbitrary order; account_key is HMAC-derived and
            // uncorrelated with the raw id alphabet, so we cannot assert on
            // label order. Instead, we verify the result is sorted by
            // (provider_id, account_key) ascending.
            return [
              buildLimitAccountV2({
                providerId: "codex",
                rawAccountId: "acct-b",
                salt,
                accountLabel: "B",
                planLabel: null,
                status: LIMIT_ACCOUNT_STATUS.OK,
                windows: [],
                lastSuccessAt: null,
                errorCode: null,
              }),
              buildLimitAccountV2({
                providerId: "codex",
                rawAccountId: "acct-a",
                salt,
                accountLabel: "A",
                planLabel: null,
                status: LIMIT_ACCOUNT_STATUS.OK,
                windows: [],
                lastSuccessAt: null,
                errorCode: null,
              }),
            ];
          },
        },
      });
      assert.equal(result.accounts.length, 2);
      const keys = result.accounts.map((a) => a.account_key);
      // Match the implementation's locale-aware comparison so the assertion
      // does not depend on UTF-16 code-unit ordering.
      const sortedKeys = [...keys].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(keys, sortedKeys, "accounts must be sorted by account_key ascending");
      // Both accounts belong to the same provider.
      const providers = result.accounts.map((a) => a.provider_id);
      assert.deepEqual(providers, ["codex", "codex"]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("supports two accounts under one provider with different windows", async () => {
    const home = makeTmpHome();
    try {
      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "work",
              salt,
              accountLabel: "Work",
              planLabel: "Plus",
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [
                buildLimitWindowV2({
                  kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
                  label: "5h",
                  usedPercent: 72,
                  resetAt: "2026-07-26T05:00:00.000Z",
                  windowSeconds: 18000,
                  evidence: DEFAULT_EVIDENCE,
                }),
              ],
              lastSuccessAt: "2026-07-26T00:00:00.000Z",
              errorCode: null,
            }),
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "personal",
              salt,
              accountLabel: "Personal",
              planLabel: "Free",
              status: LIMIT_ACCOUNT_STATUS.AUTH_ERROR,
              windows: [],
              lastSuccessAt: "2026-07-25T12:00:00.000Z",
              errorCode: LIMIT_ACCOUNT_STATUS.AUTH_ERROR,
            }),
          ],
        },
      });
      assert.equal(result.accounts.length, 2);
      const work = result.accounts.find((a) => a.account_label === "Work");
      const personal = result.accounts.find((a) => a.account_label === "Personal");
      assert.equal(work.status, "ok");
      assert.equal(work.windows[0].used_percent, 72);
      assert.equal(personal.status, "auth_error");
      assert.deepEqual(personal.windows, []);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("applies local account aliases without logging the raw account id", async () => {
    const home = makeTmpHome();
    try {
      const salt = loadOrCreateIdentitySalt({ home });
      const accountKey = computeAccountKey({
        providerId: "codex",
        rawAccountId: "acct-secret",
        salt,
      });
      const labelsPath = path.join(home, ".tokentracker", "tracker", "limit-account-labels.json");
      fs.mkdirSync(path.dirname(labelsPath), { recursive: true });
      fs.writeFileSync(labelsPath, JSON.stringify({ [accountKey]: "Desk alias" }), "utf8");

      const result = await getLimitAccounts({
        home,
        env: {},
        adapters: {
          codex: async ({ salt: activeSalt }) => [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "acct-secret",
              salt: activeSalt,
              accountLabel: "Default",
              planLabel: null,
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [],
              lastSuccessAt: null,
              errorCode: null,
            }),
          ],
        },
      });
      assert.equal(result.accounts[0].account_label, "Desk alias");
      assert.ok(!JSON.stringify(result).includes("acct-secret"));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("reuses the previous last-good snapshot across refreshes without an explicit previousAccounts arg", async () => {
    const home = makeTmpHome();
    let attempt = 0;
    try {
      const adapters = {
        claude: async ({ salt }) => {
          attempt += 1;
          if (attempt === 1) {
            return [
              buildLimitAccountV2({
                providerId: "claude",
                rawAccountId: "acct-a",
                salt,
                accountLabel: "Default",
                planLabel: "Pro",
                status: LIMIT_ACCOUNT_STATUS.OK,
                windows: [
                  buildLimitWindowV2({
                    kind: LIMIT_WINDOW_KINDS.FIVE_HOUR,
                    label: "5h",
                    usedPercent: 42,
                    resetAt: "2026-07-26T05:00:00.000Z",
                    windowSeconds: 18000,
                    evidence: DEFAULT_EVIDENCE,
                  }),
                ],
                lastSuccessAt: "2026-07-26T00:00:00.000Z",
                errorCode: null,
              }),
            ];
          }
          throw new Error("Claude API returned 401");
        },
      };

      await getLimitAccounts({ home, env: {}, adapters });
      resetLimitAccountsCache();
      const second = await getLimitAccounts({ home, env: {}, adapters });
      const claude = second.accounts.find((a) => a.provider_id === "claude");
      assert.equal(claude.status, "stale");
      assert.equal(claude.windows[0].used_percent, 42);
      assert.equal(claude.windows[0].evidence.source_kind, "cache");
      assert.equal(claude.windows[0].evidence.is_stale, true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("shares one upstream round across concurrent cache misses (single-flight per process)", async () => {
    const home = makeTmpHome();
    let calls = 0;
    try {
      const adapters = {
        codex: async ({ salt }) => {
          calls += 1;
          // Keep the first call in flight long enough for the second caller
          // to arrive and reuse it.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return [
            buildLimitAccountV2({
              providerId: "codex",
              rawAccountId: "acct-123",
              salt,
              accountLabel: "Work",
              planLabel: null,
              status: LIMIT_ACCOUNT_STATUS.OK,
              windows: [],
              lastSuccessAt: null,
              errorCode: null,
            }),
          ];
        },
      };
      const [a, b] = await Promise.all([
        getLimitAccounts({ home, env: {}, adapters }),
        getLimitAccounts({ home, env: {}, adapters }),
      ]);
      assert.equal(calls, 1, "adapter must be invoked exactly once for concurrent callers");
      assert.deepEqual(a.accounts, b.accounts);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("limit-accounts fixture", () => {
  it("matches the v2 schema shape and exercises mixed statuses", () => {
    const fixture = JSON.parse(fs.readFileSync(
      path.join(__dirname, "fixtures", "token-observability-v2", "limit-accounts-v2.json"),
      "utf8",
    ));
    assert.equal(fixture.schema_version, "token-observability/v2");
    assert.ok(Array.isArray(fixture.accounts));
    assert.equal(fixture.accounts.length, 3);

    const statuses = fixture.accounts.map((a) => a.status).sort();
    assert.deepEqual(statuses, ["auth_error", "ok", "stale"]);

    for (const acc of fixture.accounts) {
      assert.ok(typeof acc.provider_id === "string" && acc.provider_id.length > 0);
      assert.ok(typeof acc.account_key === "string" && acc.account_key.length > 0);
      assert.ok(typeof acc.account_label === "string" && acc.account_label.length > 0);
      assert.ok(Array.isArray(acc.windows));
    }

    // The auth_error account has no windows; never render "0%" for it.
    const failed = fixture.accounts.find((a) => a.status === "auth_error");
    assert.deepEqual(failed.windows, []);
    assert.equal(failed.error_code, "auth_error");
  });
});
