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

function yamlBlock(content, anchor, indentation) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${" ".repeat(indentation)}${anchor}`);
  assert.notEqual(start, -1, `missing YAML anchor: ${anchor}`);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && line.length - line.trimStart().length <= indentation) break;
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function workflowStep(content, command) {
  const steps = content.split(/(?=^ {6}- (?:name:|uses:|run:))/m);
  const step = steps.find((candidate) => candidate.includes(command));
  assert.ok(step, `missing workflow step containing: ${command}`);
  return step;
}

function assertReleaseCreateBindsRemoteTag(step) {
  const lookupIndex = step.indexOf("git ls-remote");
  const createIndex = step.indexOf("gh release create");
  assert.ok(lookupIndex >= 0, "release creation must read the remote tag first");
  assert.ok(createIndex > lookupIndex, "remote tag verification must precede release creation");
  assert.match(step, /refs\/tags\/\$(?:tag|TAG)/);
  assert.match(step, /(?:remoteTagSha|REMOTE_TAG_SHA)/);
  const comparisonIndex = step.search(/(?:-ne|!=)\s+["']?\$(?:expectedSha|EXPECTED_SHA)/);
  assert.ok(
    comparisonIndex > lookupIndex && comparisonIndex < createIndex,
    "an existing remote tag must be compared with the workflow SHA before release creation",
  );
  assert.match(
    step.slice(comparisonIndex, createIndex),
    /exit\s+1/,
    "a mismatched existing tag must fail closed",
  );
  assert.ok(
    /\$LASTEXITCODE[\s\S]*?exit\s+1/.test(step) || /if\s+!\s+[\s\S]*?git ls-remote/.test(step),
    "remote lookup errors must not be treated as an absent tag",
  );
  assert.match(
    step,
    /gh release create[^\r\n]*--target\s+["']?\$\{\{\s*github\.sha\s*\}\}["']?/,
    "a missing tag must be created at the exact workflow SHA",
  );
}

function assertSeparateInstallerGuards(step) {
  for (const [kind, glob] of [
    ["msi", /msi\/\*\.msi/],
    ["nsis", /nsis\/\*-setup\.exe/],
  ]) {
    assert.match(step, new RegExp(`\\$${kind}Artifacts\\s*=\\s*@\\(`, "i"));
    assert.match(step, glob);
    assert.match(
      step,
      new RegExp(
        `if\\s*\\(\\s*\\$${kind}Artifacts\\.Count\\s*-eq\\s*0\\s*\\)\\s*\\{[\\s\\S]*?exit\\s+1[\\s\\S]*?\\}`,
        "i",
      ),
      `${kind.toUpperCase()} must have its own fail-closed missing-artifact guard`,
    );
  }
}

function readWindowsReleaseVersionSnapshot() {
  const root = path.join(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const cargoToml = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
  const cargoLock = fs.readFileSync(path.join(root, "src-tauri", "Cargo.lock"), "utf8");
  const tauri = JSON.parse(fs.readFileSync(
    path.join(root, "src-tauri", "tauri.conf.json"),
    "utf8"
  ));
  const cargoTomlMatch = cargoToml.match(/^\[package\][\s\S]*?^name\s*=\s*"token-eyes"[\s\S]*?^version\s*=\s*"([^"]+)"/m);
  assert.ok(cargoTomlMatch, "Cargo.toml must declare the token-eyes package version");
  const cargoLockPackages = cargoLock
    .split(/(?=^\[\[package\]\]$)/m)
    .filter((block) => /^name\s*=\s*"token-eyes"$/m.test(block));
  assert.equal(cargoLockPackages.length, 1, "Cargo.lock must contain exactly one token-eyes package");
  const cargoLockMatch = cargoLockPackages[0].match(/^version\s*=\s*"([^"]+)"$/m);
  assert.ok(cargoLockMatch, "Cargo.lock token-eyes package must declare a version");
  return {
    packageJsonVersion: packageJson.version,
    packageLockVersion: packageLock.version,
    packageLockRootVersion: packageLock.packages?.[""]?.version,
    cargoTomlVersion: cargoTomlMatch[1],
    cargoLockVersion: cargoLockMatch[1],
    tauriVersion: tauri.version,
    tauriResources: tauri.bundle?.resources,
  };
}

function assertWindowsReleaseVersionSync(snapshot) {
  const canonicalVersion = snapshot.packageJsonVersion;
  assert.match(
    canonicalVersion,
    /^\d+\.\d+\.\d+$/,
    "package.json must declare a semantic release version"
  );
  const versionEntries = [
    ["package-lock.json", snapshot.packageLockVersion],
    ['package-lock.json packages[""]', snapshot.packageLockRootVersion],
    ["src-tauri/Cargo.toml [package]", snapshot.cargoTomlVersion],
    ["src-tauri/Cargo.lock token-eyes", snapshot.cargoLockVersion],
    ["src-tauri/tauri.conf.json", snapshot.tauriVersion],
  ];
  for (const [source, version] of versionEntries) {
    assert.equal(
      version,
      canonicalVersion,
      `Windows release versions must match: ${source}=${version}, package.json=${canonicalVersion}`
    );
  }
  const expectedResource = `EmbeddedServer-${canonicalVersion}/**/*`;
  const embeddedResources = (snapshot.tauriResources || []).filter((resource) =>
    String(resource).startsWith("EmbeddedServer-")
  );
  assert.deepEqual(
    embeddedResources,
    [expectedResource],
    `EmbeddedServer resource must equal ${expectedResource}`
  );
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

test("Task 11 Windows release version sources and EmbeddedServer resource stay in exact lockstep", () => {
  assertWindowsReleaseVersionSync(readWindowsReleaseVersionSnapshot());
});

test("Task 11 Windows release version contract rejects every source and resource drift", () => {
  const snapshot = readWindowsReleaseVersionSnapshot();
  const mutations = [
    (value) => { value.packageJsonVersion = "9.9.9"; },
    (value) => { value.packageLockVersion = "9.9.9"; },
    (value) => { value.packageLockRootVersion = "9.9.9"; },
    (value) => { value.cargoTomlVersion = "9.9.9"; },
    (value) => { value.cargoLockVersion = "9.9.9"; },
    (value) => { value.tauriVersion = "9.9.9"; },
    (value) => { value.tauriResources = ["EmbeddedServer-9.9.9/**/*"]; },
  ];
  for (const mutate of mutations) {
    const drifted = structuredClone(snapshot);
    mutate(drifted);
    assert.throws(
      () => assertWindowsReleaseVersionSync(drifted),
      /Windows release versions must match|EmbeddedServer resource must equal/
    );
  }
});

test("Task 11 workflow runs the canonical local CI gate before Tauri without duplicating its dashboard build", () => {
  const content = loadWorkflow();
  const canonicalGate = content.indexOf("run: npm run ci:local");
  const tauriBuild = content.indexOf("tauri:build");
  assert.ok(canonicalGate > 0, "should run the canonical local CI gate");
  assert.ok(tauriBuild > 0, "should build Tauri release");
  assert.ok(
    canonicalGate < tauriBuild,
    "canonical local CI gate must come before Tauri build"
  );
  assert.doesNotMatch(content, /run:\s*npm run dashboard:build/);
  assert.match(content, /^ {6}- run: npm run ci:local$/m);
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

test("Task 11 Windows release fails before metadata when either MSI or NSIS is missing", () => {
  const content = loadWorkflow();
  const verifyStep = workflowStep(content, "Verify Tauri bundle output");
  assertSeparateInstallerGuards(verifyStep);

  const metadataIndex = content.indexOf("Generate Windows checksums and provenance");
  const releaseIndex = content.indexOf("Upload installers and provenance to the authorized release");
  assert.ok(metadataIndex > content.indexOf(verifyStep));
  assert.ok(releaseIndex > metadataIndex);

  for (const kind of ["msi", "nsis"]) {
    const guard = new RegExp(
      `if\\s*\\(\\s*\\$${kind}Artifacts\\.Count\\s*-eq\\s*0\\s*\\)\\s*\\{[\\s\\S]*?\\}`,
      "i",
    );
    const withoutGuard = verifyStep.replace(guard, "");
    assert.throws(
      () => assertSeparateInstallerGuards(withoutGuard),
      new RegExp(kind, "i"),
      `${kind.toUpperCase()}-only/absent mutations must not satisfy the artifact contract`,
    );
  }
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

test("workflow orders canonical gate → Tauri → verification → metadata → private artifact → release upload", () => {
  const content = loadWorkflow();
  const steps = [
    "npm run ci:local",
    "tauri:build",
    "src-tauri/target/release/bundle",
    "generate-windows-release-metadata.cjs",
    "actions/upload-artifact@v4",
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

test("Task 11 workflow_call and workflow_dispatch keep publish opt-in and reusable upload opt-in", () => {
  const content = loadWorkflow();
  const callBlock = yamlBlock(content, "workflow_call:", 2);
  const dispatchBlock = yamlBlock(content, "workflow_dispatch:", 2);
  const callPublish = yamlBlock(callBlock, "publish:", 6);
  const dispatchPublish = yamlBlock(dispatchBlock, "publish:", 6);
  const reusableUpload = yamlBlock(callBlock, "upload_release_assets:", 6);

  assert.match(callPublish, /default:\s*false/);
  assert.match(dispatchPublish, /default:\s*false/);
  assert.match(reusableUpload, /type:\s*boolean/);
  assert.match(reusableUpload, /default:\s*false/);
  assert.doesNotMatch(dispatchBlock, /upload_release_assets:/);
});

test("Task 11 private Windows validation uploads v4 artifacts without touching a GitHub release", () => {
  const content = loadWorkflow();
  assert.match(content, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(content, /checksums-v\$\{\{\s*inputs\.version\s*\}\}\.txt/);
  assert.match(content, /build-provenance-v\$\{\{\s*inputs\.version\s*\}\}\.json/);

  const createStep = workflowStep(content, "gh release create");
  const uploadStep = workflowStep(content, "gh release upload");
  const publishStep = workflowStep(content, "gh release edit");
  assert.match(createStep, /if:\s*\$\{\{\s*inputs\.publish\s*\}\}/);
  assert.match(uploadStep, /if:\s*\$\{\{[^\n]*inputs\.upload_release_assets[^\n]*inputs\.publish[^\n]*\}\}/);
  assert.match(publishStep, /if:\s*\$\{\{\s*inputs\.publish\s*\}\}/);
});

test("Task 11 Windows workflow binds installer smoke and metadata to the workflow SHA", () => {
  const content = loadWorkflow();
  const buildStep = workflowStep(content, "npm run tauri:build:ci");
  assert.match(buildStep, /TOKEN_EYES_GIT_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
  assert.match(buildStep, /TOKEN_EYES_ISOLATED_INSTALLER_SMOKE:\s*['"]?1['"]?/);

  const metadataStep = workflowStep(content, "generate-windows-release-metadata.cjs");
  for (const argument of [
    "--artifact",
    "--version",
    "--head-sha",
    "--run-id",
    "--run-url",
    "--output-dir",
  ]) {
    assert.ok(metadataStep.includes(argument), `metadata generator must receive ${argument}`);
  }
  assert.match(metadataStep, /github\.sha/);
  assert.match(metadataStep, /github\.run_id/);
  assert.match(metadataStep, /actions\/runs/);
});

test("Task 11 release assets include installers and provenance and never overwrite an existing asset", () => {
  const content = loadWorkflow();
  const uploadStep = workflowStep(content, "gh release upload");
  assert.match(uploadStep, /msi\/\*\.msi/);
  assert.match(uploadStep, /nsis\/\*-setup\.exe/);
  assert.match(uploadStep, /checksums-v/);
  assert.match(uploadStep, /build-provenance-v/);
  assert.doesNotMatch(content, /--clobber/);
  assert.match(workflowStep(content, "gh release create"), /already exists|release view/i);
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

test("Task 11 Windows and combined releases bind the remote tag to github.sha before creation", () => {
  const windowsStep = workflowStep(loadWorkflow(), "gh release create");
  const dmg = fs.readFileSync(DMG_WORKFLOW_PATH, "utf8");
  const dmgStep = workflowStep(dmg, "gh release create");

  for (const [name, step] of [["Windows", windowsStep], ["combined", dmgStep]]) {
    assertReleaseCreateBindsRemoteTag(step);
    for (const mutate of [
      (value) => value.replace(/git ls-remote/g, "git remote show"),
      (value) => value.replace(/--target\s+[^\s]+/g, ""),
      (value) => value.replace(/(?:-ne|!=)\s+["']?\$(?:expectedSha|EXPECTED_SHA)/, "-eq $expectedSha"),
    ]) {
      assert.throws(
        () => assertReleaseCreateBindsRemoteTag(mutate(step)),
        undefined,
        `${name} tag-binding mutations must fail the workflow contract`,
      );
    }
  }
});

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
  const windowsJob = yamlBlock(dmg, "windows:", 2);
  assert.match(windowsJob, /upload_release_assets:\s*true/);
  assert.match(windowsJob, /publish:\s*false/);
  assert.doesNotMatch(dmg, /--clobber/);
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
