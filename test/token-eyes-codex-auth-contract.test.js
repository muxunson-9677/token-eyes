const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractRustFunctionBody(source, functionName) {
  const declarations = source.matchAll(new RegExp(
    `^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+${functionName}\\s*\\(`,
    "gm",
  ));
  let foundDeclaration = false;
  for (const declaration of declarations) {
    foundDeclaration = true;
    const openingParen = source.indexOf("(", declaration.index);
    let parenDepth = 0;
    let closingParen = -1;
    for (let index = openingParen; index < source.length; index += 1) {
      if (source[index] === "(") parenDepth += 1;
      if (source[index] === ")") parenDepth -= 1;
      if (parenDepth === 0) {
        closingParen = index;
        break;
      }
    }
    assert.notEqual(closingParen, -1, `Rust function ${functionName} has invalid parameters`);
    let openingBrace = -1;
    for (let index = closingParen + 1; index < source.length; index += 1) {
      if (source[index] === ";") break;
      if (source[index] === "{") {
        openingBrace = index;
        break;
      }
    }
    if (openingBrace === -1) continue;
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
    assert.fail(`Rust function ${functionName} has an unterminated body`);
  }
  assert.ok(foundDeclaration, `Rust function ${functionName} must exist`);
  assert.fail(`Rust function ${functionName} must have a body`);
}

function rustRawStringEnd(source, start) {
  let cursor = start;
  if (source[cursor] === "b" && source[cursor + 1] === "r") {
    cursor += 2;
  } else if (source[cursor] === "r") {
    cursor += 1;
  } else {
    return -1;
  }
  let hashes = 0;
  while (source[cursor] === "#") {
    hashes += 1;
    cursor += 1;
  }
  if (source[cursor] !== '"') return -1;
  const terminator = `"${"#".repeat(hashes)}`;
  const closing = source.indexOf(terminator, cursor + 1);
  return closing === -1 ? source.length - 1 : closing + terminator.length - 1;
}

function rustCharLiteralEnd(source, start) {
  if (source[start] !== "'") return -1;
  let cursor = start + 1;
  if (source[cursor] === "\\") {
    cursor += 1;
    if (source[cursor] === "u" && source[cursor + 1] === "{") {
      const closingBrace = source.indexOf("}", cursor + 2);
      if (closingBrace === -1) return -1;
      cursor = closingBrace + 1;
    } else if (source[cursor] === "x") {
      cursor += 3;
    } else {
      cursor += 1;
    }
  } else {
    const codePoint = source.codePointAt(cursor);
    if (codePoint === undefined) return -1;
    cursor += codePoint > 0xffff ? 2 : 1;
  }
  return source[cursor] === "'" ? cursor : -1;
}

function* rustCodeIndices(source, start = 0) {
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const rawStringEnd = rustRawStringEnd(source, index);
    if (rawStringEnd !== -1) {
      index = rawStringEnd;
      continue;
    }
    if (character === '"') {
      let escaped = false;
      for (index += 1; index < source.length; index += 1) {
        if (escaped) {
          escaped = false;
        } else if (source[index] === "\\") {
          escaped = true;
        } else if (source[index] === '"') {
          break;
        }
      }
      continue;
    }
    const charLiteralEnd = rustCharLiteralEnd(source, index);
    if (charLiteralEnd !== -1) {
      index = charLiteralEnd;
      continue;
    }
    if (character === "/" && next === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline;
      continue;
    }
    if (character === "/" && next === "*") {
      let depth = 1;
      for (index += 2; index < source.length && depth > 0; index += 1) {
        if (source[index] === "/" && source[index + 1] === "*") {
          depth += 1;
          index += 1;
        } else if (source[index] === "*" && source[index + 1] === "/") {
          depth -= 1;
          index += 1;
        }
      }
      index -= 1;
      continue;
    }
    yield index;
  }
}

function findRustCallOpeningParen(source, callName) {
  const identifier = /[A-Za-z0-9_]/u;
  for (const index of rustCodeIndices(source)) {
    if (!source.startsWith(callName, index)) continue;
    const before = source[index - 1] || "";
    const after = source[index + callName.length] || "";
    if (identifier.test(before) || identifier.test(after)) continue;
    let cursor = index + callName.length;
    while (/\s/u.test(source[cursor] || "")) cursor += 1;
    if (source[cursor] === "(") return cursor;
  }
  assert.fail(`Rust call ${callName}(...) must exist`);
}

function extractRustCallArgument(source, callName) {
  const openingParen = findRustCallOpeningParen(source, callName);
  let depth = 0;
  for (const index of rustCodeIndices(source, openingParen)) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openingParen + 1, index);
    }
  }
  assert.fail(`Rust call ${callName}(...) has unbalanced parentheses`);
}

function findBlockingFlowOpeningParen(source, flowName) {
  const blockingArgument = extractRustCallArgument(source, "spawn_blocking");
  return findRustCallOpeningParen(blockingArgument, flowName);
}

function productionRust(source) {
  return source.split(/#\[cfg\(test\)\]\s*mod\s+tests\s*\{/u, 1)[0];
}

const session = productionRust(read("src-tauri/src/codex_session.rs"));
const appServer = productionRust(read("src-tauri/src/codex_app_server.rs"));
const lib = read("src-tauri/src/lib.rs");
const cancelCommand = "cancel_codex_console_login";

test("Rust function extraction skips trait declarations without a body", () => {
  const fixture = `
trait AppServerOps {
  fn cancel_login(&mut self, login_id: &str) -> Result<(), String>;
}
impl AppServerClient {
  fn cancel_login(&mut self, login_id: &str) -> Result<(), String> {
    self.request(LOGIN_CANCEL_METHOD, login_id)
  }
}`;
  assert.match(extractRustFunctionBody(fixture, "cancel_login"), /LOGIN_CANCEL_METHOD/);
});

test("Rust call extraction keeps nested calls inside spawn_blocking", () => {
  const fixture = `
before_flow();
spawn_blocking(move || {
  let marker = ")";
  /* ignored(close)) */
  expected_flow(alpha(beta("still inside)")));
});
after_flow();`;
  const argument = extractRustCallArgument(fixture, "spawn_blocking");
  assert.match(argument, /expected_flow\s*\(/u);
  assert.doesNotMatch(argument, /before_flow|after_flow/u);
});

test("Rust call extraction rejects comment and string decoys", () => {
  const fixture = `
// spawn_blocking(move || comment_flow());
let normal = "spawn_blocking(move || string_flow())";
let raw = r###"spawn_blocking(move || raw_flow())"###;
let byte_raw = br#"spawn_blocking(move || byte_raw_flow())"#;
let character = '(';
let lifetime: &'static str = "still only a decoy";
/* outer spawn_blocking(fake()) /* nested spawn_blocking(fake()) */ */`;
  assert.throws(
    () => extractRustCallArgument(fixture, "spawn_blocking"),
    /Rust call spawn_blocking\(\.\.\.\) must exist/u,
  );
});

test("Rust call extraction skips leading decoys and selects the real call", () => {
  const fixture = `
let decoy = r#"spawn_blocking(move || decoy_flow())"#;
/* spawn_blocking(move || comment_flow()) */
spawn_blocking(move || real_flow(nested_call()));`;
  const argument = extractRustCallArgument(fixture, "spawn_blocking");
  assert.match(argument, /real_flow\s*\(/u);
  assert.doesNotMatch(argument, /decoy_flow|comment_flow/u);
});

test("blocking flow extraction rejects comment and raw-string decoys", () => {
  const fixture = `
spawn_blocking(move || {
  // expected_flow(comment_decoy());
  let marker = r###"expected_flow(raw_string_decoy())"###;
});`;
  assert.throws(
    () => findBlockingFlowOpeningParen(fixture, "expected_flow"),
    /Rust call expected_flow\(\.\.\.\) must exist/u,
  );
});

test("blocking flow extraction selects the real call after decoys", () => {
  const fixture = `
spawn_blocking(move || {
  /* expected_flow(comment_decoy()); */
  let marker = r#"expected_flow(raw_string_decoy())"#;
  expected_flow(nested_call());
});`;
  const blockingArgument = extractRustCallArgument(fixture, "spawn_blocking");
  const openingParen = findBlockingFlowOpeningParen(fixture, "expected_flow");
  assert.equal(
    openingParen,
    findRustCallOpeningParen(blockingArgument, "expected_flow"),
  );
});

test("Task 12 Codex Token Plans use built-in Cockpit-style OAuth without Codex CLI", () => {
  const oauthPath = path.join(repoRoot, "src-tauri/src/codex_oauth.rs");
  assert.equal(fs.existsSync(oauthPath), true, "built-in Codex OAuth module must exist");
  const oauth = fs.readFileSync(oauthPath, "utf8");
  assert.match(oauth, /https:\/\/auth\.openai\.com\/oauth\/authorize/u);
  assert.match(oauth, /https:\/\/auth\.openai\.com\/oauth\/token/u);
  assert.match(oauth, /app_EMoamEEZ73f0CkXaXp7hrann/u);
  assert.match(oauth, /openid profile email offline_access/u);
  assert.match(oauth, /OAUTH_ORIGINATOR\s*:\s*&str\s*=\s*"codex_vscode"/u);
  assert.match(oauth, /append_pair\(\s*"originator"\s*,\s*OAUTH_ORIGINATOR\s*\)/u);
  assert.match(oauth, /code_challenge_method[\s\S]*S256/u);
  assert.match(oauth, /http:\/\/localhost:1455\/auth\/callback/u);
  assert.match(oauth, /expected_state/u);
  assert.match(lib, /mod codex_oauth;/u);
  assert.match(session, /crate::codex_oauth/u);

  for (const command of [
    "open_codex_console_login",
    "reauthorize_codex_console_login",
    "verify_codex_console_session",
    "sync_codex_console_quota",
  ]) {
    const body = extractRustFunctionBody(session, command);
    assert.doesNotMatch(body, /AppServerClient|app-server|codex\.(?:exe|cmd)/iu);
  }
});

for (const [command, flow] of [
  ["open_codex_console_login", "start_direct_oauth"],
  ["reauthorize_codex_console_login", "start_direct_oauth"],
  ["verify_codex_console_session", "verify_direct_oauth"],
  ["sync_codex_console_quota", "sync_direct_oauth"],
  [cancelCommand, "cancel_direct_oauth"],
]) {
  test(`${command} routes its own command body through built-in OAuth`, () => {
    const body = extractRustFunctionBody(session, command);
    assert.match(body, new RegExp(`\\b${flow}\\s*\\(`));
    assert.doesNotMatch(body, /AppServerClient|app-server|codex\.(?:exe|cmd)/iu);
  });
}

test("built-in OAuth owns browser authorization and official quota reads", () => {
  const oauth = read("src-tauri/src/codex_oauth.rs");
  assert.match(oauth, /start_oauth_listener/u);
  assert.match(oauth, /complete_oauth/u);
  assert.match(oauth, /backend-api\/wham\/usage/u);
  assert.match(oauth, /http:\/\/localhost:1455\/auth\/callback/u);
  assert.match(oauth, /Codex 授权已完成/u);
  assert.doesNotMatch(oauth, /AppServerClient|account\/login\/start/u);
});

test("native Codex cancellation accepts only a typed reason and returns the status DTO", () => {
  assert.match(
    session,
    /pub\s+enum\s+CodexCancelReason\s*\{[\s\S]*?UserCancelled[\s\S]*?Timeout[\s\S]*?\}/u,
  );
  assert.doesNotMatch(session, /#\[serde\(other\)\]/u);
  assert.match(
    session,
    /unsupported Codex cancellation reason/u,
  );
  assert.match(
    session,
    /pub\s+async\s+fn\s+cancel_codex_console_login\s*\([\s\S]*?reason\s*:\s*CodexCancelReason[\s\S]*?\)\s*->\s*Result\s*<\s*CodexSessionStatus\s*,\s*String\s*>/u,
  );
  assert.doesNotMatch(session, /pub\s+async\s+fn\s+discard_codex_pending_session\s*\(/u);
  const body = extractRustFunctionBody(session, "cancel_codex_console_login");
  const blockingArgument = extractRustCallArgument(body, "spawn_blocking");
  assert.match(
    blockingArgument,
    /cancel_direct_oauth\s*\(\s*&app\s*,\s*&session_ref\s*,\s*reason\s*\)/u,
  );
});

test("lib.rs registers the reason-aware Codex cancellation command", () => {
  assert.match(lib, /codex_session::cancel_codex_console_login\s*,/u);
  assert.doesNotMatch(lib, /codex_session::discard_codex_pending_session\s*,/u);
});

test("native Codex reopen returns the status DTO through its blocking flow", () => {
  assert.match(
    session,
    /pub\s+async\s+fn\s+reopen_codex_console_login\s*\([\s\S]*?\)\s*->\s*Result\s*<\s*CodexSessionStatus\s*,\s*String\s*>/u,
  );
  const body = extractRustFunctionBody(session, "reopen_codex_console_login");
  const blockingArgument = extractRustCallArgument(body, "spawn_blocking");
  assert.match(
    blockingArgument,
    /reopen_direct_oauth\s*\(\s*&app\s*,\s*&session_ref\s*\)/u,
  );
  const flowBody = extractRustFunctionBody(session, "reopen_direct_oauth");
  assert.match(flowBody, /app\s*\.\s*opener\s*\(\s*\)/u);
  assert.match(flowBody, /\.\s*open_url\s*\(/u);
  assert.match(flowBody, /PendingCodexOAuth::authorize_url/u);
});

test("lib.rs registers the native Codex reopen command", () => {
  assert.match(lib, /codex_session::reopen_codex_console_login\s*,/u);
});

test("lib.rs registers the explicit Codex reauthorization command", () => {
  assert.match(lib, /codex_session::reauthorize_codex_console_login\s*,/u);
});

test("the direct OAuth module owns account identity and rate-limit reads", () => {
  const oauth = read("src-tauri/src/codex_oauth.rs");
  assert.match(oauth, /account_id_from_id_token/u);
  assert.match(oauth, /backend-api\/wham\/usage/u);
  assert.match(read("dashboard/src/lib/api.ts"), /syncCodexConsoleQuota/);
  assert.doesNotMatch(`${oauth}\n${session}`, /WebviewWindowBuilder/);
  assert.doesNotMatch(`${oauth}\n${session}`, /document\.cookie|localStorage|sessionStorage/);
});

test("Codex verification has no alternate account-updated authorization channel", () => {
  assert.doesNotMatch(
    `${appServer}\n${session}`,
    /account\/updated|poll_account_update|AccountUpdated/u,
  );
});

test("Codex disconnect returns the native session status DTO", () => {
  assert.match(
    session,
    /pub\s+async\s+fn\s+delete_codex_console_session\s*\([\s\S]*?\)\s*->\s*Result\s*<\s*CodexSessionStatus\s*,\s*String\s*>/u,
  );
  const body = extractRustFunctionBody(session, "delete_codex_console_session");
  findBlockingFlowOpeningParen(body, "disconnect_flow");
  assert.doesNotMatch(body, /\.map\s*\(\s*\|_\|\s*\(\s*\)\s*\)/u);
});

test("legacy Codex cleanup is a dedicated native status command", () => {
  assert.match(
    session,
    /#\[tauri::command\]\s*pub\s+async\s+fn\s+cleanup_legacy_codex_auth_file\s*\([\s\S]*?\)\s*->\s*Result\s*<\s*CodexSessionStatus\s*,\s*String\s*>/u,
  );
});

test("legacy Codex cleanup routes through its blocking native flow", () => {
  const body = extractRustFunctionBody(session, "cleanup_legacy_codex_auth_file");
  findBlockingFlowOpeningParen(body, "cleanup_legacy_codex_auth_file_flow");
});

test("lib.rs registers the dedicated legacy Codex cleanup command", () => {
  assert.match(
    lib,
    /codex_session::cleanup_legacy_codex_auth_file\s*,/u,
  );
});

test("lib.rs compiles the Token Plan direct OAuth module", () => {
  assert.match(lib, /mod codex_app_server;/);
  assert.match(lib, /mod codex_oauth;/);
  assert.match(session, /crate::codex_oauth/);
});

test("the Token Plan direct OAuth source file is present", () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, "src-tauri/src/codex_oauth.rs")),
    true,
  );
});
