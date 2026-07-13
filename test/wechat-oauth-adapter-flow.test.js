const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const EDGE_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-wechat-oauth.ts",
);

function base64UrlSha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function createMemoryDatabase() {
  const tables = new Map();
  const rowsFor = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  class Query {
    constructor(name) {
      this.rows = rowsFor(name);
      this.filters = [];
      this.updateValues = null;
      this.columns = null;
      this.maxRows = Infinity;
    }

    insert(rows) {
      this.rows.push(...rows.map((row) => ({ ...row })));
      return Promise.resolve({ data: null, error: null });
    }

    update(values) {
      this.updateValues = values;
      return this;
    }

    select(columns) {
      this.columns = String(columns)
        .split(",")
        .map((column) => column.trim());
      return this;
    }

    eq(column, value) {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    is(column, value) {
      this.filters.push((row) => (row[column] ?? null) === value);
      return this;
    }

    gt(column, value) {
      this.filters.push((row) => row[column] > value);
      return this;
    }

    limit(value) {
      this.maxRows = value;
      return this;
    }

    async maybeSingle() {
      let matched = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
      matched = matched.slice(0, this.maxRows);
      if (this.updateValues) {
        matched.forEach((row) => Object.assign(row, this.updateValues));
      }
      const row = matched[0];
      if (!row) return { data: null, error: null };
      if (!this.columns) return { data: { ...row }, error: null };
      return {
        data: Object.fromEntries(this.columns.map((column) => [column, row[column]])),
        error: null,
      };
    }
  }

  return {
    tables,
    client: {
      database: {
        from: (name) => new Query(name),
        rpc: async (name) => {
          if (name !== "tokentracker_prune_wechat_oauth") {
            return { data: null, error: new Error("unknown rpc") };
          }
          let deleted = 0;
          const now = new Date().toISOString();
          for (const tableName of [
            "tokentracker_wechat_oauth_flows",
            "tokentracker_wechat_oauth_codes",
            "tokentracker_wechat_oauth_tokens",
          ]) {
            const rows = rowsFor(tableName);
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (rows[index].expires_at <= now) {
                rows.splice(index, 1);
                deleted += 1;
              }
            }
          }
          return { data: deleted, error: null };
        },
      },
    },
  };
}

async function loadAdapter({ env, client, fetchImpl }) {
  const output = (await esbuild.build({
    entryPoints: [EDGE_PATH],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "neutral",
    target: "es2022",
    plugins: [
      {
        name: "mock-insforge",
        setup(build) {
          build.onResolve({ filter: /^npm:@insforge\/sdk$/ }, () => ({
            path: "insforge-sdk",
            namespace: "mock",
          }));
          build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const createClient = () => globalThis.__insforgeClient;",
            loader: "js",
          }));
        },
      },
    ],
  })).outputFiles[0].text;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    __insforgeClient: client,
    Deno: { env: { get: (key) => env[key] } },
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    crypto: globalThis.crypto,
    btoa,
    atob,
    fetch: fetchImpl,
  };
  vm.runInNewContext(output, context);
  return module.exports.default;
}

test("WeChat adapter enforces state, PKCE, expiry and one-time code consumption", async () => {
  const memory = createMemoryDatabase();
  const env = {
    WECHAT_OAUTH_PUBLIC_URL: "https://edge.example/functions/wechat",
    WECHAT_OAUTH_CLIENT_ID: "insforge-wechat",
    WECHAT_OAUTH_CLIENT_SECRET: "oauth-client-secret",
    WECHAT_OAUTH_REDIRECT_URIS: "https://auth.example/oauth/callback",
    WECHAT_OPEN_APP_ID: "wechat-app-id",
    WECHAT_OPEN_APP_SECRET: "wechat-app-secret",
    INSFORGE_BASE_URL: "https://insforge.example",
    INSFORGE_SERVICE_ROLE_KEY: "service-role-key",
  };
  let wechatNetworkAvailable = true;
  const adapter = await loadAdapter({
    env,
    client: memory.client,
    fetchImpl: async (url) => {
      if (!wechatNetworkAvailable) throw new Error("simulated WeChat outage");
      const target = String(url);
      if (target.includes("/sns/oauth2/access_token")) {
        return new Response(
          JSON.stringify({
            access_token: "raw-wechat-access-token",
            openid: "raw-wechat-open-id",
            unionid: "raw-wechat-union-id",
          }),
          { status: 200 },
        );
      }
      if (target.includes("/sns/userinfo")) {
        return new Response(
          JSON.stringify({
            nickname: "测试用户",
            headimgurl: "https://images.example/avatar.png",
            unionid: "raw-wechat-union-id",
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected request: ${target}`);
    },
  });

  const verifier = "A".repeat(43);
  const authorizeUrl = new URL("https://edge.example/functions/wechat");
  authorizeUrl.searchParams.set("action", "authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.WECHAT_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", "https://auth.example/oauth/callback");
  authorizeUrl.searchParams.set("state", "insforge-state");
  authorizeUrl.searchParams.set("code_challenge", base64UrlSha256(verifier));
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const authorizeResponse = await adapter(new Request(authorizeUrl));
  assert.equal(authorizeResponse.status, 302);
  const wechatRedirect = new URL(authorizeResponse.headers.get("location"));
  const adapterState = wechatRedirect.searchParams.get("state");
  assert.equal(wechatRedirect.searchParams.get("scope"), "snsapi_login");
  assert.ok(adapterState);

  const flowRows = memory.tables.get("tokentracker_wechat_oauth_flows");
  assert.equal(flowRows.length, 1);
  assert.notEqual(flowRows[0].state_hash, adapterState);
  assert.equal(Object.hasOwn(flowRows[0], "state"), false);

  const callbackUrl = new URL("https://edge.example/functions/wechat");
  callbackUrl.searchParams.set("action", "callback");
  callbackUrl.searchParams.set("state", adapterState);
  callbackUrl.searchParams.set("code", "raw-wechat-code");
  const callbackResponse = await adapter(new Request(callbackUrl));
  assert.equal(callbackResponse.status, 302);
  const oauthRedirect = new URL(callbackResponse.headers.get("location"));
  const authorizationCode = oauthRedirect.searchParams.get("code");
  assert.equal(oauthRedirect.searchParams.get("state"), "insforge-state");
  assert.ok(authorizationCode);

  const repeatedCallback = await adapter(new Request(callbackUrl));
  assert.equal(repeatedCallback.status, 400);

  const repeatedIdentityAuthorize = await adapter(new Request(authorizeUrl));
  const repeatedIdentityState = new URL(
    repeatedIdentityAuthorize.headers.get("location"),
  ).searchParams.get("state");
  const repeatedIdentityCallbackUrl = new URL("https://edge.example/functions/wechat");
  repeatedIdentityCallbackUrl.searchParams.set("action", "callback");
  repeatedIdentityCallbackUrl.searchParams.set("state", repeatedIdentityState);
  repeatedIdentityCallbackUrl.searchParams.set("code", "second-raw-wechat-code");
  const repeatedIdentityCallback = await adapter(new Request(repeatedIdentityCallbackUrl));
  assert.equal(repeatedIdentityCallback.status, 302);
  const repeatedAuthorizationCode = new URL(
    repeatedIdentityCallback.headers.get("location"),
  ).searchParams.get("code");

  const cancelledAuthorizeResponse = await adapter(new Request(authorizeUrl));
  const cancelledState = new URL(
    cancelledAuthorizeResponse.headers.get("location"),
  ).searchParams.get("state");
  const cancelledCallbackUrl = new URL("https://edge.example/functions/wechat");
  cancelledCallbackUrl.searchParams.set("action", "callback");
  cancelledCallbackUrl.searchParams.set("state", cancelledState);
  const cancelledCallbackResponse = await adapter(new Request(cancelledCallbackUrl));
  assert.equal(cancelledCallbackResponse.status, 302);
  const cancelledRedirect = new URL(cancelledCallbackResponse.headers.get("location"));
  assert.equal(cancelledRedirect.searchParams.get("error"), "access_denied");
  assert.equal(cancelledRedirect.searchParams.get("state"), "insforge-state");
  assert.equal((await adapter(new Request(cancelledCallbackUrl))).status, 400);

  const codeRows = memory.tables.get("tokentracker_wechat_oauth_codes");
  assert.equal(codeRows.length, 2);
  assert.equal(codeRows[0].subject, codeRows[1].subject);
  assert.equal(codeRows[0].internal_email, codeRows[1].internal_email);
  assert.notEqual(codeRows[0].code_hash, authorizationCode);
  assert.equal(JSON.stringify(codeRows).includes("raw-wechat"), false);

  const tokenUrl = "https://edge.example/functions/wechat?action=token";
  const tokenRequest = (candidateVerifier, candidateCode = authorizationCode) =>
    new Request(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: candidateCode,
        redirect_uri: "https://auth.example/oauth/callback",
        client_id: env.WECHAT_OAUTH_CLIENT_ID,
        client_secret: env.WECHAT_OAUTH_CLIENT_SECRET,
        code_verifier: candidateVerifier,
      }),
    });

  const wrongVerifierResponse = await adapter(tokenRequest("B".repeat(43)));
  assert.equal(wrongVerifierResponse.status, 400);
  assert.equal(codeRows[0].consumed_at, undefined);

  codeRows[1].expires_at = "2000-01-01T00:00:00.000Z";
  assert.equal(
    (await adapter(tokenRequest(verifier, repeatedAuthorizationCode))).status,
    400,
  );

  const tokenResponse = await adapter(tokenRequest(verifier));
  assert.equal(tokenResponse.status, 200);
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenBody.token_type, "Bearer");
  assert.ok(tokenBody.access_token);
  assert.ok(codeRows[0].consumed_at);

  const replayResponse = await adapter(tokenRequest(verifier));
  assert.equal(replayResponse.status, 400);

  const tokenRows = memory.tables.get("tokentracker_wechat_oauth_tokens");
  assert.equal(tokenRows.length, 1);
  assert.notEqual(tokenRows[0].token_hash, tokenBody.access_token);
  const userInfoResponse = await adapter(
    new Request("https://edge.example/functions/wechat?action=userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }),
  );
  assert.equal(userInfoResponse.status, 200);
  const userInfo = await userInfoResponse.json();
  assert.match(userInfo.sub, /^wechat_[0-9a-f]{64}$/);
  assert.match(userInfo.email, /^[0-9a-f]{48}@wechat\.invalid$/);
  assert.equal(userInfo.name, "测试用户");
  assert.equal(JSON.stringify(userInfo).includes("raw-wechat"), false);

  tokenRows[0].expires_at = "2000-01-01T00:00:00.000Z";
  const expiredTokenResponse = await adapter(
    new Request("https://edge.example/functions/wechat?action=userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }),
  );
  assert.equal(expiredTokenResponse.status, 401);
  assert.equal(tokenRows.length, 0);

  const expiredFlowAuthorizeResponse = await adapter(new Request(authorizeUrl));
  const expiredFlowState = new URL(
    expiredFlowAuthorizeResponse.headers.get("location"),
  ).searchParams.get("state");
  const flowRowsAfterAuthorize = memory.tables.get("tokentracker_wechat_oauth_flows");
  flowRowsAfterAuthorize.at(-1).expires_at = "2000-01-01T00:00:00.000Z";
  const expiredFlowCallbackUrl = new URL("https://edge.example/functions/wechat");
  expiredFlowCallbackUrl.searchParams.set("action", "callback");
  expiredFlowCallbackUrl.searchParams.set("state", expiredFlowState);
  expiredFlowCallbackUrl.searchParams.set("code", "expired-flow-wechat-code");
  assert.equal((await adapter(new Request(expiredFlowCallbackUrl))).status, 400);

  const outageAuthorizeResponse = await adapter(new Request(authorizeUrl));
  const outageState = new URL(
    outageAuthorizeResponse.headers.get("location"),
  ).searchParams.get("state");
  const outageCallbackUrl = new URL("https://edge.example/functions/wechat");
  outageCallbackUrl.searchParams.set("action", "callback");
  outageCallbackUrl.searchParams.set("state", outageState);
  outageCallbackUrl.searchParams.set("code", "outage-wechat-code");
  wechatNetworkAvailable = false;
  const outageCallbackResponse = await adapter(new Request(outageCallbackUrl));
  assert.equal(outageCallbackResponse.status, 302);
  assert.equal(
    new URL(outageCallbackResponse.headers.get("location")).searchParams.get("error"),
    "server_error",
  );
});
