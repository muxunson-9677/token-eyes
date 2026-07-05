const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const WORKFLOW_PATH = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "release-windows.yml"
);

function loadWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

const RUNTIME_VERIFIER_PATH = path.join(
  __dirname,
  "..",
  "scripts",
  "release",
  "verify-runtime-manifest.ps1"
);

function writeFixtureFile(root, relativePath, content = "fixture") {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function runRuntimeVerifierFixture({ includeLicense = true, invalidMsi = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-runtime-verifier-"));
  const embeddedServer = path.join(root, "EmbeddedServer");
  const releaseRoot = path.join(root, "release");
  const nodeBytes = Buffer.from("fixture-node-executable");
  const nodeHash = crypto.createHash("sha256").update(nodeBytes).digest("hex");

  writeFixtureFile(embeddedServer, "node.exe", nodeBytes);
  writeFixtureFile(embeddedServer, "LICENSE.node");
  if (includeLicense) writeFixtureFile(embeddedServer, "LICENSE");
  writeFixtureFile(embeddedServer, path.join("tokentracker", "bin", "tracker.js"));
  writeFixtureFile(embeddedServer, path.join("tokentracker", "package.json"), "{}");
  writeFixtureFile(embeddedServer, path.join("tokentracker", "package-lock.json"), "{}");
  writeFixtureFile(
    embeddedServer,
    path.join("tokentracker", "dashboard", "dist", "index.html")
  );
  writeFixtureFile(
    embeddedServer,
    "runtime-manifest.json",
    JSON.stringify({
      app_version: "0.54.0",
      node_version: "22.22.2",
      node: {
        version: "22.22.2",
        sha256: "a".repeat(64),
        official_sha256: "a".repeat(64),
        exe_sha256: nodeHash,
      },
      head_sha: "fixture-head",
      file_count: 8,
    })
  );

  writeFixtureFile(releaseRoot, path.join("bundle", "msi", "Token Eyes_0.54.0_x64_en-US.msi"));
  writeFixtureFile(releaseRoot, path.join("bundle", "nsis", "Token Eyes_0.54.0_x64-setup.exe"));

  const fakeBin = path.join(root, "bin");
  const fakeSevenZipLog = path.join(root, "fake-7z.log");
  const fakeMsiExecLog = path.join(root, "fake-msiexec.log");
  writeFixtureFile(
    fakeBin,
    "7z.cmd",
    [
      "@echo off",
      '>>"%FAKE_7Z_LOG%" echo %~2',
      "echo EmbeddedServer\\runtime-manifest.json",
      "echo EmbeddedServer\\node.exe",
      "echo EmbeddedServer\\LICENSE",
      "echo EmbeddedServer\\LICENSE.node",
      "echo EmbeddedServer\\tokentracker\\bin\\tracker.js",
      "echo EmbeddedServer\\tokentracker\\dashboard\\dist\\index.html",
      "exit /b 0",
      "",
    ].join("\r\n")
  );
  const fakeMsiExec = writeFixtureFile(
    fakeBin,
    "fake-msiexec.cmd",
    [
      "@echo off",
      "setlocal EnableDelayedExpansion",
      '>>"%FAKE_MSIEXEC_LOG%" echo %*',
      'if "%FAKE_MSI_INVALID%"=="1" exit /b 0',
      'set "all=%*"',
      'set "target=!all:*TARGETDIR==!"',
      'set "target=!target:~2!"',
      'set "target=!target:"=!"',
      'xcopy "%FAKE_MSI_SOURCE%" "!target!\\PFiles\\Token Eyes\\EmbeddedServer\\" /E /I /Y >nul',
      "exit /b %errorlevel%",
      "",
    ].join("\r\n")
  );

  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  env[pathKey] = `${fakeBin};${env[pathKey] || ""}`;
  env.FAKE_7Z_LOG = fakeSevenZipLog;
  env.FAKE_MSIEXEC_LOG = fakeMsiExecLog;
  env.FAKE_MSI_SOURCE = embeddedServer;
  env.FAKE_MSI_INVALID = invalidMsi ? "1" : "0";

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      RUNTIME_VERIFIER_PATH,
      "-ReleaseRoot",
      releaseRoot,
      "-EmbeddedServer",
      embeddedServer,
      "-MsiExecPath",
      fakeMsiExec,
    ],
    { encoding: "utf8", env }
  );

  return {
    root,
    result,
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
    sevenZipCalls: fs.existsSync(fakeSevenZipLog)
      ? fs.readFileSync(fakeSevenZipLog, "utf8")
      : "",
    msiExecCalls: fs.existsSync(fakeMsiExecLog)
      ? fs.readFileSync(fakeMsiExecLog, "utf8")
      : "",
  };
}

// ── Workflow structure ──────────────────────────────────────────────────────

test("release-windows workflow file exists", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH));
});

test("workflow triggers on workflow_dispatch with version input", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("workflow_dispatch:"));
  assert.ok(content.includes("version:"));
});

test("workflow uses Windows runner", () => {
  const content = loadWorkflow();
  assert.ok(
    /runs-on:\s*windows-/.test(content),
    "should use a Windows runner for Tauri build"
  );
});

// ── Tauri stack (not .NET) ──────────────────────────────────────────────────
// Per CLAUDE.md: "For Token Eyes TE-NEXT/V01 work, Windows verification follows
// the Tauri stack: Rust toolchain + Node.js + WebView2 Runtime. Do not require
// .NET SDK or .NET 8 SDK as a Token Eyes prerequisite."

test("workflow does NOT set up .NET SDK", () => {
  const content = loadWorkflow();
  assert.ok(
    !content.includes("setup-dotnet"),
    "must not use setup-dotnet — Token Eyes Windows uses Tauri, not .NET"
  );
  assert.ok(
    !/dotnet-version/.test(content),
    "must not pin a .NET SDK version"
  );
});

test("workflow sets up Rust toolchain", () => {
  const content = loadWorkflow();
  assert.ok(
    /rust-toolchain|rustup|actions-rs\/toolchain/.test(content),
    "must set up Rust toolchain for Tauri build"
  );
});

test("workflow does NOT use dotnet publish", () => {
  const content = loadWorkflow();
  assert.ok(
    !content.includes("dotnet publish"),
    "must not use dotnet publish — Token Eyes Windows uses Tauri, not .NET"
  );
  assert.ok(
    !content.includes("TokenTrackerWin.csproj"),
    "must not build legacy TokenTrackerWin.csproj as Token Eyes deliverable"
  );
});

// ── Version gate ────────────────────────────────────────────────────────────

test("F8: workflow verifies version matches package.json AND tauri.conf.json", () => {
  const content = loadWorkflow();
  const verifyStepMatch = content.match(
    /name:\s*Verify version[\s\S]*?(?=\n\s*-\s*name:|\n\s*\n\s{2}\w+:|$)/
  );
  assert.ok(verifyStepMatch, "must have a 'Verify version' step");
  const verifyStep = verifyStepMatch[0];
  assert.ok(
    /package\.json/.test(verifyStep),
    "Verify version step must check package.json"
  );
  assert.ok(
    /tauri\.conf\.json/.test(verifyStep),
    "Verify version step must ALSO check tauri.conf.json — installer metadata reads from it"
  );
  assert.ok(
    /inputs\.version/.test(verifyStep),
    "Verify version step must compare against inputs.version"
  );
});

// ── Quality gates (fail-closed) ─────────────────────────────────────────────
// R2: ci:local, dashboard typecheck/lint/test, Rust fmt/test must all run
// before any artifact is built or uploaded. Each step is fail-closed —
// a non-zero exit blocks the upload.

test("R2: workflow runs ci:local (root tests + validations) before build", () => {
  const content = loadWorkflow();
  const ciLocalIdx = content.indexOf("npm run ci:local");
  assert.ok(ciLocalIdx > 0, "must run 'npm run ci:local'");
  const uploadIdx = content.indexOf("gh release upload");
  assert.ok(ciLocalIdx < uploadIdx, "ci:local must run before upload");
});

test("R2: workflow runs dashboard typecheck, lint, and test before build", () => {
  const content = loadWorkflow();
  for (const gate of [
    "npm --prefix dashboard run typecheck",
    "npm --prefix dashboard run lint",
    "npm --prefix dashboard run test",
  ]) {
    const idx = content.indexOf(gate);
    assert.ok(idx > 0, `must run '${gate}'`);
    const uploadIdx = content.indexOf("gh release upload");
    assert.ok(idx < uploadIdx, `'${gate}' must run before upload`);
  }
});

test("R2: workflow runs Rust fmt check and cargo test before build", () => {
  const content = loadWorkflow();
  const fmtIdx = content.indexOf("cargo fmt --manifest-path src-tauri/Cargo.toml -- --check");
  assert.ok(fmtIdx > 0, "must run cargo fmt check");
  const testIdx = content.indexOf("cargo test --manifest-path src-tauri/Cargo.toml");
  assert.ok(testIdx > 0, "must run cargo test");
  const uploadIdx = content.indexOf("gh release upload");
  assert.ok(fmtIdx < uploadIdx, "cargo fmt must run before upload");
  assert.ok(testIdx < uploadIdx, "cargo test must run before upload");
});

// ── Security audit gates (fail-closed) ──────────────────────────────────────
// R2/B4: root production audit, dashboard production audit, and cargo audit
// must all pass before upload. Any high/critical vulnerability blocks release.

test("R2/B4: workflow installs cargo-audit and runs production audits before upload", () => {
  const content = loadWorkflow();
  assert.ok(
    /cargo install cargo-audit/.test(content),
    "must install cargo-audit"
  );
  assert.ok(
    content.includes("run-production-audit.ps1"),
    "must call run-production-audit.ps1 to run npm + cargo audits"
  );
  const auditIdx = content.indexOf("run-production-audit.ps1");
  const uploadIdx = content.indexOf("gh release upload");
  assert.ok(auditIdx > 0 && auditIdx < uploadIdx, "audits must run before upload");
});

test("R2/B4: run-production-audit.ps1 runs both root and dashboard npm audit with --omit=dev --audit-level=high", () => {
  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "release",
    "run-production-audit.ps1"
  );
  assert.ok(fs.existsSync(scriptPath), "run-production-audit.ps1 must exist");
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.ok(
    /npm.*audit.*--omit=dev.*--audit-level=high/.test(script),
    "must run npm audit --omit=dev --audit-level=high for root"
  );
  assert.ok(
    /cargo audit/.test(script),
    "must run cargo audit"
  );
});

// ── Two-step build: compile → sign EXE → bundle ────────────────────────────
// R3/B5: the inner token-eyes.exe must be signed after Tauri patches it with
// per-bundle metadata. Use bundle.windows.signCommand; do not sign a
// pre-bundle `--no-bundle` EXE that the bundle phase can overwrite.

test("R3/B5: workflow signs Windows binaries with Tauri bundle.windows.signCommand", () => {
  const content = loadWorkflow();
  assert.doesNotMatch(
    content,
    /tauri build --no-bundle/,
    "signing after --no-bundle is unsafe because the bundle build can overwrite token-eyes.exe"
  );
  assert.match(
    content,
    /signCommand/,
    "must inject Tauri bundle.windows.signCommand so signing happens after Tauri patches binaries"
  );
  assert.match(
    content,
    /sign-windows-artifacts\.ps1[\s\S]*%1|%1[\s\S]*sign-windows-artifacts\.ps1/,
    "signCommand must call sign-windows-artifacts.ps1 with Tauri's %1 binary placeholder"
  );
  assert.match(
    content,
    /tauri build --bundles msi,nsis --config/,
    "bundle build must use the signing config that contains signCommand"
  );
});

test("R3/B5: workflow does not use the unsafe --no-bundle signing sequence", () => {
  const content = loadWorkflow();
  assert.doesNotMatch(
    content,
    /tauri build --no-bundle/,
    "must not sign a pre-bundle EXE that Tauri can patch/overwrite during bundling"
  );
  assert.match(content, /tauri build --bundles msi,nsis --config/);
});

// ── Signing gates (fail-closed) ─────────────────────────────────────────────
// R2/B5: EXE, MSI, and NSIS must all carry trusted Authenticode signatures.
// Self-signed certificates are explicitly rejected.

test("R3/B5: workflow wires the signing script through Tauri signCommand", () => {
  const content = loadWorkflow();
  const configIdx = content.indexOf("signCommand");
  assert.ok(configIdx > 0, "must configure Tauri signCommand");
  assert.ok(
    content.includes("sign-windows-artifacts.ps1"),
    "must call sign-windows-artifacts.ps1"
  );
  const bundlesIdx = content.indexOf("tauri build --bundles msi,nsis");
  assert.ok(
    configIdx < bundlesIdx,
    "signCommand config must be written before the Tauri bundle build starts"
  );
});

test("R3/B5: workflow relies on Tauri signCommand instead of a post-bundle MSI/NSIS signing step", () => {
  const content = loadWorkflow();
  assert.doesNotMatch(
    content,
    /name:\s*Sign MSI and NSIS/,
    "post-bundle signing must not replace Tauri signCommand because inner EXE signing must occur inside bundling"
  );
  assert.match(content, /signCommand/);
});

test("R2/B5: workflow references cert secrets (not hardcoded cert values)", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("WINDOWS_CERT_PFX_BASE64"),
    "must reference WINDOWS_CERT_PFX_BASE64 secret"
  );
  assert.ok(
    content.includes("WINDOWS_CERT_PASSWORD"),
    "must reference WINDOWS_CERT_PASSWORD secret"
  );
  assert.ok(
    /secrets\.WINDOWS_CERT_PFX_BASE64/.test(content),
    "must read cert from GitHub secrets, not from a committed file"
  );
});

test("R2/B5: sign-windows-artifacts.ps1 rejects self-signed certificates", () => {
  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "release",
    "sign-windows-artifacts.ps1"
  );
  assert.ok(fs.existsSync(scriptPath), "sign-windows-artifacts.ps1 must exist");
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.ok(
    /self-?signed/i.test(script),
    "must explicitly reject self-signed certificates"
  );
  assert.ok(
    /Subject.*Issuer/.test(script) || /Subject -eq.*Issuer/.test(script),
    "must check Subject == Issuer to detect self-signed"
  );
  assert.ok(
    /SHA256|SHA-256/.test(script),
    "must use SHA-256 digest algorithm"
  );
  assert.ok(
    /timestamp|TimestampServer|td|tr/.test(script),
    "must use a trusted timestamp server (RFC 3161)"
  );
});

// ── Signature verification + SHA256SUMS (fail-closed) ───────────────────────
// R2/B5: all three artifacts must have Status=Valid. SHA256SUMS is generated
// AFTER signing so hashes cover the signed artifacts.

test("R2/B5: workflow verifies signatures Valid and generates SHA256SUMS before upload", () => {
  const content = loadWorkflow();
  const verifyIdx = content.indexOf("Verify signatures and generate SHA256SUMS");
  assert.ok(verifyIdx > 0, "must have a signature verification + SHA256SUMS step");
  assert.ok(
    content.includes("verify-windows-signatures.ps1"),
    "must call verify-windows-signatures.ps1"
  );
  assert.ok(
    content.includes("SHA256SUMS"),
    "must generate SHA256SUMS"
  );
  const uploadIdx = content.indexOf("gh release upload");
  assert.ok(verifyIdx < uploadIdx, "signature verification must happen before upload");
});

test("R2/B5: verify-windows-signatures.ps1 fails on NotSigned/invalid status", () => {
  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "release",
    "verify-windows-signatures.ps1"
  );
  assert.ok(fs.existsSync(scriptPath), "verify-windows-signatures.ps1 must exist");
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.ok(
    /-ne\s*'Valid'/.test(script),
    "must fail-closed when signature Status is not Valid (-ne 'Valid')"
  );
  assert.ok(
    /Get-AuthenticodeSignature/.test(script),
    "must use Get-AuthenticodeSignature to verify"
  );
  assert.ok(
    /TimeStamperCertificate|timestamp/i.test(script),
    "must verify timestamp presence"
  );
  assert.ok(
    /Get-FileHash.*SHA256/.test(script),
    "must compute SHA256 hashes for SHA256SUMS"
  );
});

// ── Runtime manifest verification (fail-closed) ────────────────────────────
// R2/B2: R1's self-contained runtime (node.exe + CLI + dashboard + manifest)
// must be present at source AND embedded inside the MSI/NSIS installers.

test("R2/B2: workflow verifies runtime manifest in EmbeddedServer and installers", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("verify-runtime-manifest.ps1"),
    "must call verify-runtime-manifest.ps1"
  );
  const runtimeIdx = content.indexOf("verify-runtime-manifest.ps1");
  const uploadIdx = content.indexOf("gh release upload");
  assert.ok(runtimeIdx < uploadIdx, "runtime verification must happen before upload");
});

test("R2/B2: verify-runtime-manifest.ps1 checks required runtime files and installer contents", () => {
  const scriptPath = path.join(
    __dirname,
    "..",
    "scripts",
    "release",
    "verify-runtime-manifest.ps1"
  );
  assert.ok(fs.existsSync(scriptPath), "verify-runtime-manifest.ps1 must exist");
  const script = fs.readFileSync(scriptPath, "utf8");
  // Must check for node.exe, runtime-manifest.json, tracker.js, dashboard dist
  assert.ok(script.includes("node.exe"), "must check for node.exe");
  assert.ok(script.includes("runtime-manifest.json"), "must check for runtime-manifest.json");
  assert.ok(script.includes("tracker.js"), "must check for tracker.js");
  assert.ok(script.includes("index.html"), "must check for dashboard dist/index.html");
  // Must verify the downloaded Node archive hash and the extracted node.exe hash.
  assert.ok(
    /node\.sha256[\s\S]*node\.official_sha256/.test(script),
    "must verify the nested R1 node SHA256 matches the official hash"
  );
  assert.ok(
    /node\.exe_sha256/.test(script),
    "must verify node.exe against the nested R1 manifest hash"
  );
  // Must verify installers contain the runtime (via 7-Zip)
  assert.ok(
    /7z|7-Zip/.test(script),
    "must use 7-Zip to verify runtime inside NSIS"
  );
  assert.ok(
    /msiexec/i.test(script) && /TARGETDIR/.test(script),
    "must use an MSI administrative install to verify the installed runtime layout"
  );
});

test("R3/B2: verify-runtime-manifest.ps1 documents MSI admin install and NSIS 7-Zip separately", () => {
  const script = fs.readFileSync(RUNTIME_VERIFIER_PATH, "utf8");
  assert.match(
    script,
    /MSI[\s\S]{0,120}administrative/i,
    "MSI verification must be documented as administrative extraction"
  );
  assert.match(
    script,
    /NSIS[\s\S]{0,120}7-Zip/i,
    "NSIS verification must be documented as 7-Zip inspection"
  );
  assert.doesNotMatch(
    script,
    /MSI\/NSIS[\s\S]{0,120}7-Zip listing/i,
    "must not claim MSI and NSIS are both verified by 7-Zip listing"
  );
});

test(
  "R3/B2: runtime verifier accepts the R1 nested manifest and checks MSI plus NSIS",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = runRuntimeVerifierFixture();
    try {
      assert.equal(fixture.result.status, 0, fixture.output);
      assert.match(fixture.msiExecCalls, /\.msi/i, "MSI must be administratively extracted");
      assert.doesNotMatch(fixture.sevenZipCalls, /\.msi/i, "7-Zip must not be used for MSI");
      assert.match(fixture.sevenZipCalls, /-setup\.exe/i, "NSIS must be inspected");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "R3/B2: runtime verifier fails when the MSI omits the embedded runtime",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = runRuntimeVerifierFixture({ invalidMsi: true });
    try {
      assert.notEqual(fixture.result.status, 0, fixture.output);
      assert.match(fixture.msiExecCalls, /\.msi/i, "MSI must reach administrative extraction");
      assert.match(fixture.output, /MSI.*missing required runtime/is);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

test(
  "R3/B2: runtime verifier fails when the bundled Token Eyes license is missing",
  { skip: process.platform !== "win32" },
  () => {
    const fixture = runRuntimeVerifierFixture({ includeLicense: false });
    try {
      assert.notEqual(fixture.result.status, 0, fixture.output);
      assert.match(fixture.output, /FAIL: Missing: .*EmbeddedServer[\\/]LICENSE(?:\r?\n|$)/i);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
);

// ── Bundle output verification (fail-closed, precise globs) ─────────────────
// F8: precise globs prevent old 0.1.0 artifacts from mixing in.

test("F8: workflow verifies Tauri bundle output with precise MSI/NSIS globs", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("src-tauri/target/release/bundle"),
    "must verify Tauri bundle output under src-tauri/target/release/bundle"
  );
  assert.ok(
    /msi\/\*\.msi/.test(content),
    "must check precise glob msi/*.msi (Tauri MSI artifact path)"
  );
  assert.ok(
    /nsis\/\*-setup\.exe/.test(content),
    "must check precise glob nsis/*-setup.exe (Tauri NSIS artifact path)"
  );
  assert.ok(
    /No Tauri installer found/.test(content) ||
      /artifacts\.Count\s*-\s*eq\s*0/.test(content),
    "must fail the workflow when no MSI/NSIS artifact is found"
  );
});

// ── Upload gate ─────────────────────────────────────────────────────────────

test("workflow uploads Tauri artifacts + SHA256SUMS to release", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("gh release upload"), "must upload to release");
  assert.ok(
    /v\$\{\{.*version.*\}\}/.test(content),
    "must use v-prefixed tag for release upload"
  );
  assert.ok(
    content.includes("src-tauri/target/release/bundle"),
    "must upload artifacts from Tauri bundle directory"
  );
  assert.ok(
    content.includes("SHA256SUMS"),
    "must upload SHA256SUMS alongside artifacts"
  );
});

test("R2: upload is the LAST step — all gates run before upload", () => {
  const content = loadWorkflow();
  const uploadIdx = content.indexOf("gh release upload");
  const allGates = [
    "npm run ci:local",
    "npm --prefix dashboard run test",
    "cargo test --manifest-path src-tauri/Cargo.toml",
    "run-production-audit.ps1",
    "signCommand",
    "sign-windows-artifacts.ps1",
    "tauri build --bundles msi,nsis --config",
    "verify-runtime-manifest.ps1",
    "verify-windows-signatures.ps1",
  ];
  for (const gate of allGates) {
    const idx = content.lastIndexOf(gate);
    assert.ok(
      idx > 0 && idx < uploadIdx,
      `'${gate}' must run before 'gh release upload'`
    );
  }
});

test("workflow has concurrency guard", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("concurrency:"));
});

test("workflow has write permissions for release creation", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("contents: write"));
});

// ── Legacy Inno Setup installer file tests ──────────────────────────────────
// The legacy TokenTrackerWin .NET + Inno Setup path is retained on disk for
// historical reference but is NOT the Token Eyes Windows deliverable. These
// tests verify the .iss file is still valid if someone builds the legacy path.

const ISS_PATH = path.join(
  __dirname,
  "..",
  "TokenTrackerWin",
  "installer",
  "TokenTracker.iss"
);

function loadIss() {
  return fs.readFileSync(ISS_PATH, "utf8");
}

test("Inno Setup script exists (legacy)", () => {
  assert.ok(fs.existsSync(ISS_PATH));
});

test("installer is per-user (no admin / UAC) (legacy)", () => {
  const iss = loadIss();
  assert.ok(
    /PrivilegesRequired\s*=\s*lowest/.test(iss),
    "must install per-user so it never elevates"
  );
  assert.ok(
    iss.includes("{localappdata}"),
    "should install under %LOCALAPPDATA%"
  );
});

test("installer bundles the self-contained publish output (legacy)", () => {
  const iss = loadIss();
  assert.ok(
    /Source:\s*"\.\.\\publish\\\*"/.test(iss),
    "should pack ..\\publish\\* (exe + runtime + EmbeddedServer)"
  );
});

test("installer output is parameterized by version (legacy)", () => {
  const iss = loadIss();
  assert.ok(iss.includes("MyAppVersion"), "version must be passed in via /D");
  assert.ok(
    iss.includes("TokenTracker-Setup-v"),
    "output filename should carry the version"
  );
});

test("installer offers English + Simplified + Traditional Chinese (legacy)", () => {
  const iss = loadIss();
  assert.ok(/MessagesFile:\s*"compiler:Default\.isl"/.test(iss), "English");
  assert.ok(iss.includes("ChineseSimplified.isl"), "Simplified Chinese");
  assert.ok(iss.includes("ChineseTraditional.isl"), "Traditional Chinese");
});

test("bundled Chinese language files exist as UTF-8 with BOM (legacy)", () => {
  const installerDir = path.join(__dirname, "..", "TokenTrackerWin", "installer");
  for (const name of ["ChineseSimplified.isl", "ChineseTraditional.isl"]) {
    const p = path.join(installerDir, name);
    assert.ok(fs.existsSync(p), `${name} must be committed (Inno does not ship it)`);
    const buf = fs.readFileSync(p);
    assert.ok(
      buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf,
      `${name} must start with a UTF-8 BOM so Inno renders Chinese, not mojibake`
    );
  }
});

// ── Linked release: one DMG dispatch ships BOTH platforms ──────────────────
// release-windows is a reusable workflow (workflow_call) that the macOS DMG
// workflow invokes, so `gh workflow run "release (macOS + Windows)"` fans out
// to Windows too.

const DMG_WORKFLOW_PATH = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "release-dmg.yml"
);

test("release-windows is callable as a reusable workflow", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("workflow_call:"),
    "must expose workflow_call so the DMG workflow can invoke it"
  );
});

test("release-dmg invokes release-windows so one dispatch ships both platforms", () => {
  const dmg = fs.readFileSync(DMG_WORKFLOW_PATH, "utf8");
  assert.ok(
    /uses:\s*\.\/\.github\/workflows\/release-windows\.yml/.test(dmg),
    "DMG workflow must call the Windows reusable workflow"
  );
  assert.ok(
    /version:\s*\$\{\{\s*inputs\.version\s*\}\}/.test(dmg),
    "DMG workflow must pass its version input through to Windows"
  );
});

test("macOS + Windows build in parallel off a shared create-release job", () => {
  const dmg = fs.readFileSync(DMG_WORKFLOW_PATH, "utf8");
  assert.ok(/^\s{2}create-release:/m.test(dmg), "must have a create-release job");
  assert.ok(
    /windows:\s*\n\s*needs:\s*create-release/.test(dmg),
    "windows job must declare `needs: create-release` (parallel, not serial)"
  );
  assert.ok(
    /build:\s*\n\s*needs:\s*create-release/.test(dmg),
    "macOS build job must also depend on create-release"
  );
});

test("R2: release-dmg publish job needs BOTH build and windows (fail-closed)", () => {
  const dmg = fs.readFileSync(DMG_WORKFLOW_PATH, "utf8");
  // publish must depend on both build (macOS) and windows — either failure
  // keeps the release as a draft.
  assert.ok(
    /publish:\s*\n\s*needs:\s*\[build,\s*windows\]/.test(dmg) ||
      /publish:\s*\n\s*needs:\s*\[build, windows\]/.test(dmg),
    "publish job must needs: [build, windows] so either failure blocks publishing"
  );
  assert.ok(
    /--draft=false/.test(dmg),
    "publish must flip draft to false (release stays draft until publish)"
  );
});
