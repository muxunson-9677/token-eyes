const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const bundlerPath = path.join(repoRoot, "src-tauri", "scripts", "bundle-runtime.ps1");

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout || "").trim();
}

function createBundlerFixture(t, { cargoVersion = "0.54.44", tauriVersion = cargoVersion, git = true } = {}) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-bundler-identity-"));
  const tauriDir = path.join(fixtureRoot, "src-tauri");
  const scriptsDir = path.join(tauriDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(bundlerPath, path.join(scriptsDir, "bundle-runtime.ps1"));
  fs.writeFileSync(path.join(tauriDir, "Cargo.toml"), `[package]\nname = "token-eyes-fixture"\nversion = "${cargoVersion}"\n`, "utf8");
  fs.writeFileSync(path.join(tauriDir, "tauri.conf.json"), `${JSON.stringify({ version: tauriVersion })}\n`, "utf8");
  let headSha = null;
  if (git) {
    runChecked("git", ["init", "--quiet"], { cwd: fixtureRoot });
    fs.writeFileSync(path.join(fixtureRoot, "fixture.txt"), "synthetic fixture\n", "utf8");
    runChecked("git", ["add", "fixture.txt"], { cwd: fixtureRoot });
    runChecked("git", ["-c", "user.name=Token Eyes Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: fixtureRoot });
    headSha = runChecked("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot });
  }
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, headSha, scriptPath: path.join(scriptsDir, "bundle-runtime.ps1") };
}

function runBundlerIdentityProbe(fixture, environment = {}) {
  const env = { ...process.env, ...environment };
  for (const name of ["TOKEN_EYES_GIT_SHA", "TOKEN_EYES_ISOLATED_INSTALLER_SMOKE"]) {
    if (environment[name] === null) delete env[name];
  }
  return spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", fixture.scriptPath,
    "-Clean",
  ], {
    cwd: fixture.fixtureRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("local Tauri build does not silently install the app", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.ok(
    !pkg.scripts["tauri:build"].includes("tauri:verify-installer"),
    "tauri:build must not run the installed-runtime smoke test because NSIS mutates the user's install registration",
  );
});

test("Windows release keeps installed-runtime verification explicit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release-windows.yml"),
    "utf8",
  );

  assert.match(
    pkg.scripts["tauri:build:ci"] || "",
    /tauri:verify-installer/,
    "tauri:build:ci must retain installed-runtime verification",
  );
  assert.match(
    workflow,
    /npm run tauri:build:ci/,
    "release-windows.yml must use the explicit CI build path",
  );
});

test("tauri:build:ci generates local release metadata only after installed smoke", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const stages = String(pkg.scripts["tauri:build:ci"] || "").split(/\s*&&\s*/);
  assert.equal(stages.length, 3, "CI build must have exactly build, installed smoke, and local metadata stages");
  assert.equal(stages[0], "npm run tauri:build");
  assert.equal(stages[1], "npm run tauri:verify-installer");

  const metadata = stages[2];
  assert.match(metadata, /^powershell(?:\.exe)?\b/i, "local metadata stage must be one PowerShell command");
  assert.equal(
    (metadata.match(/scripts[\\/]generate-windows-release-metadata\.cjs/g) || []).length,
    1,
    "local stage must call the canonical metadata generator exactly once",
  );
  assert.match(metadata, /msi[\\/]\*\.msi/);
  assert.match(metadata, /nsis[\\/]\*-setup\.exe/);
  assert.match(metadata, /(?:\.Count|\.Length)\s*-eq\s*0/i, "zero installers must fail explicitly");
  assert.match(metadata, /(?:throw|exit\s+1)/i, "zero installers must terminate the build");
  assert.match(metadata, /(?:foreach|ForEach-Object)/i, "each installer path must be appended separately");
  assert.match(metadata, /--artifact\b/);
  assert.match(metadata, /--version\b/);
  assert.match(metadata, /TOKEN_EYES_GIT_SHA/);
  assert.match(metadata, /--run-id[\s'"`]+local\b/);
  assert.match(metadata, /--run-url[\s'"`]+null\b/);
  assert.match(metadata, /--output-dir[\s'"`]+[^\s'"`]*bundle[\\/]local-release-metadata\b/);
  assert.doesNotMatch(metadata, /bundle[\\/]release-metadata\b/);
});

test("runtime bundler rejects a malformed TOKEN_EYES_GIT_SHA before any bundle work", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t);
  for (const invalidSha of ["not-a-40-character-git-sha", "   "]) {
    const result = runBundlerIdentityProbe(fixture, { TOKEN_EYES_GIT_SHA: invalidSha });
    assert.notEqual(result.status, 0, `malformed workflow SHA must fail closed: ${JSON.stringify(invalidSha)}`);
  }
});

test("runtime bundler rejects a supplied SHA that differs from readable git HEAD", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t);
  const differentSha = fixture.headSha === "a".repeat(40) ? "b".repeat(40) : "a".repeat(40);
  const result = runBundlerIdentityProbe(fixture, { TOKEN_EYES_GIT_SHA: differentSha });
  assert.notEqual(result.status, 0, "workflow SHA must match readable repository HEAD");
});

test("runtime bundler rejects unknown build identity in release verification mode", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t, { git: false });
  const result = runBundlerIdentityProbe(fixture, {
    TOKEN_EYES_GIT_SHA: null,
    TOKEN_EYES_ISOLATED_INSTALLER_SMOKE: "1",
  });
  assert.notEqual(result.status, 0, "release verification must never emit head_sha=unknown");
});

test("runtime bundler rejects Cargo and Tauri version drift before naming the runtime", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t, { cargoVersion: "0.54.44", tauriVersion: "9.9.9" });
  const result = runBundlerIdentityProbe(fixture, { TOKEN_EYES_GIT_SHA: fixture.headSha });
  assert.notEqual(result.status, 0, "runtime manifest version must come from the Cargo package version");
});

test("runtime bundler reads version only from the Cargo package section", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t);
  fs.writeFileSync(
    path.join(fixture.fixtureRoot, "src-tauri", "Cargo.toml"),
    `[package]\nname = "missing-package-version"\n\n[dependencies.synthetic]\nversion = "0.54.44"\n`,
    "utf8",
  );
  const result = runBundlerIdentityProbe(fixture, { TOKEN_EYES_GIT_SHA: fixture.headSha });
  assert.notEqual(result.status, 0, "a dependency version must not impersonate CARGO_PKG_VERSION");
});

test("runtime bundler accepts the exact readable HEAD and keeps manifest identity fields canonical", {
  skip: process.platform === "win32" ? false : "requires Windows PowerShell",
}, (t) => {
  const fixture = createBundlerFixture(t);
  const result = runBundlerIdentityProbe(fixture, { TOKEN_EYES_GIT_SHA: fixture.headSha.toUpperCase() });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const source = fs.readFileSync(bundlerPath, "utf8");
  assert.match(source, /app_version\s*=\s*\$cargoVersion/);
  assert.match(source, /head_sha\s*=\s*\$headSha/);
  assert.match(source, /built_at_utc\s*=/);
});

test("Tauri exposes one registered build-info command backed by the runtime manifest", () => {
  const commands = fs.readFileSync(path.join(repoRoot, "src-tauri", "src", "commands.rs"), "utf8");
  const lib = fs.readFileSync(path.join(repoRoot, "src-tauri", "src", "lib.rs"), "utf8");
  const api = fs.readFileSync(path.join(repoRoot, "dashboard", "src", "lib", "api.ts"), "utf8");

  assert.match(commands, /pub\s+(?:async\s+)?fn\s+get_token_eyes_build_info\s*\(/);
  assert.match(commands, /app_version/);
  assert.match(commands, /head_sha/);
  assert.match(commands, /built_at_utc/);
  assert.match(lib, /commands::get_token_eyes_build_info/);
  assert.match(api, /invoke\("get_token_eyes_build_info"\)/);
});
