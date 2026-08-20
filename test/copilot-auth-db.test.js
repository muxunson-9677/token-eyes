const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  decryptCopilotAuthDbToken,
  describeCopilotCredentialStatus,
  fetchCopilotLimits,
} = require("../src/lib/usage-limits");
const { computeAccountKey } = require("../src/lib/limit-accounts");

// Mirror copilot-language-server's auth.db scheme: AES-256-GCM with the
// ciphertext laid out as iv(12) ‖ ciphertext ‖ authTag(16), key base64-encoded.
function encryptToken(token, keyBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]);
}

function makeAuthDbFixture(token, { authority = "github.com" } = {}) {
  const keyBuf = crypto.randomBytes(32);
  const blob = encryptToken(token, keyBuf);
  return {
    keyBase64: keyBuf.toString("base64"),
    tokenHex: blob.toString("hex"),
    authority,
  };
}

describe("decryptCopilotAuthDbToken", () => {
  it("round-trips an AES-256-GCM token", () => {
    const { keyBase64, tokenHex } = makeAuthDbFixture("ghu_decrypted_example_token");
    assert.equal(decryptCopilotAuthDbToken(keyBase64, tokenHex), "ghu_decrypted_example_token");
  });

  it("returns null when the key is the wrong length (not AES-256)", () => {
    const { tokenHex } = makeAuthDbFixture("ghu_token");
    const shortKey = crypto.randomBytes(16).toString("base64");
    assert.equal(decryptCopilotAuthDbToken(shortKey, tokenHex), null);
  });

  it("returns null when the auth tag does not verify (tampered ciphertext)", () => {
    const { keyBase64, tokenHex } = makeAuthDbFixture("ghu_token");
    const tampered = Buffer.from(tokenHex, "hex");
    tampered[tampered.length - 1] ^= 0xff; // flip a tag byte
    assert.equal(decryptCopilotAuthDbToken(keyBase64, tampered.toString("hex")), null);
  });

  it("returns null on non-string input", () => {
    assert.equal(decryptCopilotAuthDbToken(null, null), null);
    assert.equal(decryptCopilotAuthDbToken(undefined, "00"), null);
  });
});

function writeLegacyToken(home, token) {
  const dir = path.join(home, ".config", "github-copilot");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "apps.json"),
    JSON.stringify({
      "github.com:Iv1.b507a08c87ecfe98": {
        oauth_token: token,
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    }),
  );
}

function okResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      copilot_plan: "business",
      quota_reset_date: "2026-09-01",
      quota_snapshots: {
        premium_interactions: { entitlement: 100, remaining: 75, percent_remaining: 75 },
      },
      ...payload,
    }),
  };
}

function secureFixture(token) {
  const fixture = makeAuthDbFixture(token);
  return {
    fixture,
    securityRunner: () => ({ status: 0, stdout: fixture.keyBase64 }),
    sqliteReader: () => [{
      auth_authority: "github.com",
      token_hex: fixture.tokenHex,
      updated_at: "2026-08-20T10:00:00.000Z",
      last_used_at: "2026-08-20T11:00:00.000Z",
    }],
  };
}

function assertSecretsAbsent(value, secrets) {
  const text = String(value);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, "serialized output must not contain synthetic credentials");
  }
}

describe("fetchCopilotLimits credential candidate policy", () => {
  it("uses a valid secure auth.db candidate once and never sends stale legacy plaintext", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-secure-first-"));
    try {
      const secureToken = "synthetic-secure-valid";
      const legacyToken = "synthetic-legacy-stale";
      writeLegacyToken(tmp, legacyToken);
      const secure = secureFixture(secureToken);
      const authorization = [];

      const result = await fetchCopilotLimits({
        home: tmp,
        platform: "darwin",
        securityRunner: secure.securityRunner,
        sqliteReader: secure.sqliteReader,
        fetchImpl: async (_url, options) => {
          authorization.push(options.headers.Authorization);
          return okResponse();
        },
      });

      assert.equal(result.error, null);
      assert.deepEqual(authorization, [`token ${secureToken}`]);
      const serialized = JSON.stringify(result);
      assertSecretsAbsent(serialized, [secureToken, legacyToken, secure.fixture.keyBase64, secure.fixture.tokenHex]);
      assert.doesNotMatch(serialized, /"(?:credential_source|authority|updated_at|last_used_at)":/);
      assert.deepEqual(result[Symbol.for("tokentracker.copilot.credential-identity")], {
        identity: `sha256:${crypto.createHash("sha256").update(secureToken).digest("hex")}`,
        credential_source: "secure_auth_db_macos",
        authority: "github.com",
        updated_at: "2026-08-20T10:00:00.000Z",
        last_used_at: "2026-08-20T11:00:00.000Z",
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  for (const authStatus of [401, 403]) {
    it(`falls back exactly once after secure ${authStatus} and binds the account to the legacy winner`, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-auth-fallback-"));
      try {
        const secureToken = `synthetic-secure-stale-${authStatus}`;
        const legacyToken = `synthetic-legacy-valid-${authStatus}`;
        writeLegacyToken(tmp, legacyToken);
        const secure = secureFixture(secureToken);
        const authorization = [];

        const result = await fetchCopilotLimits({
          home: tmp,
          platform: "darwin",
          securityRunner: secure.securityRunner,
          sqliteReader: secure.sqliteReader,
          fetchImpl: async (_url, options) => {
            authorization.push(options.headers.Authorization);
            if (options.headers.Authorization === `token ${secureToken}`) {
              return { ok: false, status: authStatus, json: async () => ({}) };
            }
            return okResponse();
          },
        });

        assert.equal(result.error, null);
        assert.deepEqual(authorization, [`token ${secureToken}`, `token ${legacyToken}`]);
        const context = result[Symbol.for("tokentracker.copilot.credential-identity")];
        assert.equal(context.credential_source, "legacy_plaintext");
        assert.equal(context.authority, "github.com");
        assert.equal(context.updated_at, "2026-07-01T00:00:00.000Z");
        assert.equal(context.last_used_at, null);

        const usageLimits = require("../src/lib/usage-limits");
        const originalGetUsageLimits = usageLimits.getUsageLimits;
        usageLimits.getUsageLimits = async () => ({ copilot: result });
        try {
          const copilotAdapter = require("../src/lib/limit-account-adapters/copilot");
          const salt = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
          const [account] = await copilotAdapter({ salt, home: tmp, env: {} });
          const winnerIdentity = `sha256:${crypto.createHash("sha256").update(legacyToken).digest("hex")}`;
          assert.equal(
            account.account_key,
            computeAccountKey({ providerId: "copilot", rawAccountId: winnerIdentity, salt }),
          );
          assertSecretsAbsent(JSON.stringify(account), [secureToken, legacyToken]);
        } finally {
          usageLimits.getUsageLimits = originalGetUsageLimits;
        }

        const serialized = JSON.stringify(result);
        assertSecretsAbsent(serialized, [secureToken, legacyToken, secure.fixture.keyBase64, secure.fixture.tokenHex]);
        assert.doesNotMatch(serialized, /"(?:credential_source|authority|updated_at|last_used_at)":/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  for (const status of [500, 503]) {
    it(`does not switch to legacy plaintext when the secure candidate receives HTTP ${status}`, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-no-5xx-fallback-"));
      try {
        const secureToken = `synthetic-secure-${status}`;
        const legacyToken = `synthetic-legacy-${status}`;
        writeLegacyToken(tmp, legacyToken);
        const secure = secureFixture(secureToken);
        const authorization = [];

        const result = await fetchCopilotLimits({
          home: tmp,
          platform: "darwin",
          securityRunner: secure.securityRunner,
          sqliteReader: secure.sqliteReader,
          fetchImpl: async (_url, options) => {
            authorization.push(options.headers.Authorization);
            if (options.headers.Authorization === `token ${secureToken}`) {
              return { ok: false, status, json: async () => ({}) };
            }
            return okResponse();
          },
        });

        assert.deepEqual(authorization, [`token ${secureToken}`]);
        assert.equal(result.error_code, "upstream_error");
        assert.doesNotMatch(JSON.stringify(result), new RegExp(`${secureToken}|${legacyToken}`));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("does not switch candidates on a network failure and redacts the thrown secret", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-no-network-fallback-"));
    try {
      const secureToken = "synthetic-secure-network";
      const legacyToken = "synthetic-legacy-network";
      writeLegacyToken(tmp, legacyToken);
      const secure = secureFixture(secureToken);
      const authorization = [];
      let stderr = "";
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = (chunk) => {
        stderr += String(chunk);
        return true;
      };

      let result;
      try {
        result = await fetchCopilotLimits({
          home: tmp,
          platform: "darwin",
          securityRunner: secure.securityRunner,
          sqliteReader: secure.sqliteReader,
          fetchImpl: async (_url, options) => {
            authorization.push(options.headers.Authorization);
            if (options.headers.Authorization === `token ${secureToken}`) {
              throw new Error(`socket failed ${secureToken} ${secure.fixture.keyBase64} ${secure.fixture.tokenHex}`);
            }
            return okResponse();
          },
        });
      } finally {
        process.stderr.write = originalStderrWrite;
      }

      assert.deepEqual(authorization, [`token ${secureToken}`]);
      assert.equal(result.error_code, "network_error");
      assertSecretsAbsent(JSON.stringify(result), [secureToken, legacyToken, secure.fixture.keyBase64, secure.fixture.tokenHex]);
      assertSecretsAbsent(stderr, [secureToken, legacyToken, secure.fixture.keyBase64, secure.fixture.tokenHex]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("redacts credentials when parsing a successful upstream response fails", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-response-error-"));
    try {
      const secureToken = "synthetic-secure-response";
      const secure = secureFixture(secureToken);
      const result = await fetchCopilotLimits({
        home: tmp,
        platform: "darwin",
        securityRunner: secure.securityRunner,
        sqliteReader: secure.sqliteReader,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error(`${secureToken} ${secure.fixture.keyBase64} ${secure.fixture.tokenHex}`);
          },
        }),
      });

      assert.equal(result.error_code, "response_error");
      assertSecretsAbsent(JSON.stringify(result), [secureToken, secure.fixture.keyBase64, secure.fixture.tokenHex]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns secure_store_unsupported for a Windows auth.db fixture without guessing Credential Manager rules", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-win-unsupported-"));
    try {
      const dir = path.join(tmp, ".config", "github-copilot");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "auth.db"), "synthetic-fixture-placeholder");
      writeLegacyToken(tmp, "synthetic-stale-windows-plaintext");
      let requests = 0;

      const result = await fetchCopilotLimits({
        home: tmp,
        platform: "win32",
        fetchImpl: async () => {
          requests += 1;
          return okResponse();
        },
      });

      assert.equal(result.configured, true);
      assert.equal(result.error_code, "secure_store_unsupported");
      assert.equal(requests, 0);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-stale-windows-plaintext/);

      const status = describeCopilotCredentialStatus({ home: tmp, platform: "win32" });
      assert.deepEqual(status, {
        configured: true,
        status: "secure_store_unsupported",
        credential_source: null,
        authority: null,
      });
      assert.doesNotMatch(JSON.stringify(status), /synthetic-stale-windows-plaintext|oauth_token/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

it("status consumes non-secret Copilot credential status instead of a token value", () => {
  const statusSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "commands", "status.js"),
    "utf8",
  );
  assert.match(statusSource, /describeCopilotCredentialStatus/);
  assert.doesNotMatch(statusSource, /readCopilotOauthToken|copilotToken/);
});
