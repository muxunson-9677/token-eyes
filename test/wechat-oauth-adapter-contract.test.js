const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const EDGE_PATH = path.join(
  ROOT,
  "dashboard/edge-patches/tokentracker-wechat-oauth.ts",
);
const SQL_PATH = path.join(ROOT, "scripts/ops/wechat-oauth-adapter.sql");
const PAGE_PATH = path.join(ROOT, "dashboard/src/pages/LeaderboardPage.jsx");
const DEPLOYMENT_PATH = path.join(ROOT, "docs/dev-notes/wechat-oauth-deployment.md");
const TAURI_COMMANDS_PATH = path.join(ROOT, "src-tauri/src/commands.rs");
const MAC_CONSTANTS_PATH = path.join(
  ROOT,
  "TokenTrackerBar/TokenTrackerBar/Utilities/Constants.swift",
);
const WINDOWS_SERVER_PATH = path.join(ROOT, "TokenTrackerWin/ServerManager.cs");

function read(file) {
  assert.ok(fs.existsSync(file), `missing ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, "utf8");
}

test("WeChat OAuth adapter exposes discovery and an S256 authorization-code flow", () => {
  const source = read(EDGE_PATH);

  assert.match(source, /authorization_endpoint/);
  assert.match(source, /token_endpoint/);
  assert.match(source, /userinfo_endpoint/);
  assert.match(source, /code_challenge_methods_supported:\s*\["S256"\]/);
  assert.match(source, /response_types_supported:\s*\["code"\]/);
  assert.match(source, /\.set\("scope",\s*"snsapi_login"\)/);
  assert.match(source, /https:\/\/open\.weixin\.qq\.com\/connect\/qrconnect/);
  assert.match(source, /https:\/\/api\.weixin\.qq\.com\/sns\/oauth2\/access_token/);
  assert.match(source, /https:\/\/api\.weixin\.qq\.com\/sns\/userinfo/);
});

test("WeChat OAuth adapter rejects tampering, expiry and authorization-code replay", () => {
  const source = read(EDGE_PATH);

  assert.match(source, /WECHAT_OAUTH_REDIRECT_URIS/);
  assert.match(source, /WECHAT_OAUTH_CLIENT_SECRET/);
  assert.match(source, /codeChallengeMethod\s*!==\s*"S256"/);
  assert.match(source, /sha256Base64Url\(codeVerifier\)/);
  assert.match(source, /\.is\("consumed_at",\s*null\)/);
  assert.match(source, /\.gt\("expires_at",\s*now\)/);
  assert.match(source, /state_hash/);
  assert.match(source, /code_hash/);
  assert.match(source, /token_hash/);
  assert.match(source, /\.rpc\(\s*"tokentracker_prune_wechat_oauth"/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
});

test("OAuth persistence stores only digests and never raw WeChat credentials", () => {
  const sql = read(SQL_PATH);

  assert.match(sql, /tokentracker_wechat_oauth_flows/i);
  assert.match(sql, /tokentracker_wechat_oauth_codes/i);
  assert.match(sql, /tokentracker_wechat_oauth_tokens/i);
  assert.match(sql, /state_hash\s+text\s+primary key/i);
  assert.match(sql, /code_hash\s+text\s+primary key/i);
  assert.match(sql, /token_hash\s+text\s+primary key/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION tokentracker_prune_wechat_oauth/i);
  assert.match(sql, /DELETE FROM tokentracker_wechat_oauth_flows[\s\S]*expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /DELETE FROM tokentracker_wechat_oauth_codes[\s\S]*expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /DELETE FROM tokentracker_wechat_oauth_tokens[\s\S]*expires_at\s*<=\s*now\(\)/i);
  assert.doesNotMatch(sql, /\b(?:openid|unionid|wechat_access_token|raw_code)\b/i);
});

test("UserInfo remains compatible while the leaderboard uses email login", () => {
  const source = read(EDGE_PATH);
  const page = read(PAGE_PATH);

  assert.match(source, /email_verified:\s*true/);
  assert.match(source, /@wechat\.invalid/);
  assert.match(source, /subject/);
  assert.doesNotMatch(source, /phone|password/i);
  assert.match(page, /useLoginModal|openLoginModal/);
  assert.match(page, /openLoginModal\(\{\s*emailOnly:\s*true\s*\}\)/);
  assert.doesNotMatch(page, /signInWithOAuth\("wechat",\s*redirectTo\)/);
});

test("deployment distinguishes provider callbacks from app redirect allowlists", () => {
  const deployment = read(DEPLOYMENT_PATH);
  const tauriCommands = read(TAURI_COMMANDS_PATH);
  const macConstants = read(MAC_CONSTANTS_PATH);
  const windowsServer = read(WINDOWS_SERVER_PATH);

  assert.match(tauriCommands, /Origin: http:\/\/tauri\.localhost/);
  assert.match(macConstants, /serverBaseURL\s*=\s*"http:\/\/localhost:7680"/);
  assert.match(windowsServer, /PreferredPort\s*=\s*17680/);
  assert.match(windowsServer, /PickFreeLoopbackPort\(\)/);
  assert.match(deployment, /Allowed Redirect URLs/);
  assert.match(deployment, /<TOKEN_EYES_WEB_ORIGIN>\/leaderboard/);
  assert.match(deployment, /http:\/\/tauri\.localhost\/leaderboard/);
  assert.match(deployment, /http:\/\/localhost:7680\/auth\/callback/);
  assert.match(deployment, /http:\/\/127\.0\.0\.1:17680\/auth\/callback/);
  assert.match(deployment, /动态回退端口无法预先加入/);
  assert.match(deployment, /WECHAT_OAUTH_REDIRECT_URIS/);
  assert.match(deployment, /两层(?:不同的)?白名单/);
});
