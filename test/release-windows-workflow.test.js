const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

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
const README_PATH = path.join(__dirname, "..", "README.md");

test("README points Windows users to the current MSI/NSIS release assets", () => {
  const readme = fs.readFileSync(README_PATH, "utf8");
  assert.match(readme, /releases\/latest/);
  assert.match(readme, /Tauri `\.msi` or `\*-setup\.exe` installer/);
  assert.doesNotMatch(readme, /TokenTracker-Setup\.exe/);
  assert.doesNotMatch(readme, /Portable zip/);
});

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

test("F8: workflow verifies version matches package.json AND tauri.conf.json", () => {
  const content = loadWorkflow();
  // 03 工单: Windows workflow 同时校验 package.json 与 tauri.conf.json。
  // 旧测试只断言 "Verify version" + "package.json" 字符串存在，无法发现
  // tauri.conf.json 版本未校验的盲区（F7 的 MSI/NSIS 元数据 0.1.0 即由此而来）。
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
  // 确认两处版本都被读取并比较到 inputs.version
  assert.ok(
    /inputs\.version/.test(verifyStep),
    "Verify version step must compare against inputs.version"
  );
});

test("workflow builds dashboard before Tauri build", () => {
  const content = loadWorkflow();
  const dashBuild = content.indexOf("dashboard:build");
  const tauriBuild = content.indexOf("tauri:build");
  assert.ok(dashBuild > 0, "should build dashboard");
  assert.ok(tauriBuild > 0, "should build Tauri release");
  assert.ok(
    dashBuild < tauriBuild,
    "dashboard build must come before Tauri build"
  );
});

test("workflow builds Tauri release", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("tauri:build") || content.includes("tauri build"),
    "must run Tauri build (npm run tauri:build or cargo tauri build)"
  );
});

test("F8: workflow verifies Tauri bundle output with precise MSI/NSIS globs", () => {
  const content = loadWorkflow();
  // 03 工单: 缺少 MSI/NSIS artifact 时测试失败。
  // 旧宽松 /msi|nsis/ 正则会让只写 "msi" 或 "nsis" 字样的 workflow 假绿通过。
  // 必须断言精确 glob: msi/*.msi 和 nsis/*-setup.exe。
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
  // 确认存在失败分支：无 artifact 时 exit 1
  assert.ok(
    /No Tauri installer found/.test(content) ||
      /artifacts\.Count\s*-\s*eq\s*0/.test(content),
    "must fail the workflow when no MSI/NSIS artifact is found"
  );
});

test("workflow uploads Tauri artifacts to release", () => {
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
});

test("workflow has correct step order: dashboard → tauri → verify → upload", () => {
  const content = loadWorkflow();
  const steps = [
    "dashboard:build",
    "tauri:build",
    "src-tauri/target/release/bundle",
    "gh release upload",
  ];
  let lastIndex = -1;
  for (const step of steps) {
    const idx = content.indexOf(step);
    assert.ok(idx > lastIndex, `"${step}" should come after the previous step`);
    lastIndex = idx;
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

test("workflow validates Cargo version and runs the complete local CI gate", () => {
  const content = loadWorkflow();
  assert.match(content, /src-tauri\/Cargo\.toml/);
  assert.match(content, /npm run ci:local/);
  assert.match(content, /Validate version input/);
  assert.match(content, /Version must be X\.Y\.Z/);
});

test("standalone dispatch publishes while reusable invocation leaves publishing to the caller", () => {
  const content = loadWorkflow();
  assert.match(content, /workflow_call:[\s\S]*?publish:[\s\S]*?default:\s*false/);
  assert.match(content, /workflow_dispatch:[\s\S]*?publish:[\s\S]*?default:\s*true/);
  assert.match(content, /gh release view[\s\S]*?gh release create[\s\S]*?gh release upload/);
  assert.match(content, /if:\s*\$\{\{\s*inputs\.publish\s*\}\}[\s\S]*?gh release edit[^\n]*--draft=false/);
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

test("standalone release creation uses the required release notes input", () => {
  const content = loadWorkflow();
  assert.match(content, /workflow_call:[\s\S]*?notes:[\s\S]*?required:\s*true/);
  assert.match(content, /workflow_dispatch:[\s\S]*?notes:[\s\S]*?required:\s*true/);
  assert.match(content, /RELEASE_NOTES:\s*\$\{\{\s*inputs\.notes\s*\}\}/);
  assert.match(content, /gh release create[^\n]*--notes "\$env:RELEASE_NOTES"/);
  assert.doesNotMatch(content, /--notes\s+""/);
});

test("Windows release note input is validated as one non-empty ASCII line", () => {
  const content = loadWorkflow();
  assert.match(content, /IsNullOrWhiteSpace/);
  assert.match(content, /\[\\r\\n\]/);
  assert.match(content, /Release notes must be one non-empty English\/ASCII line/);
});
