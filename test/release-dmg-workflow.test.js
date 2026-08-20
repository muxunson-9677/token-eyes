const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "release-dmg.yml"
);

function loadWorkflow() {
  // 归一化 CRLF → LF：Windows checkout 下 YAML 文件可能是 CRLF 行尾，
  // 多行正则（.*\n）中的 . 不匹配 \r，会导致 build job 的 runs-on 解析假性失败。
  // 归一化不削弱任何断言 —— 仍精确校验 macos-26 / Homebrew repo。
  return fs.readFileSync(WORKFLOW_PATH, "utf8").replace(/\r\n/g, "\n");
}

function assertReleaseCommandsUseVPrefixedTags(content) {
  const steps = content.split(/(?=^ {6}- (?:name:|uses:|run:))/m);
  const releaseCommands = [...content.matchAll(
    /^\s*(?:run:\s*)?gh release (create|upload|edit)\s+("[^"]+"|'[^']+'|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\S+)/gm,
  )];
  assert.ok(releaseCommands.length >= 3, "should have create, upload, and edit steps");

  for (const command of releaseCommands) {
    const commandLine = command[0].trim();
    const tagArgument = command[2].replace(/^["']|["']$/g, "");
    if (/^v\$\{\{\s*inputs\.version\s*\}\}$/.test(tagArgument)) continue;

    const variableMatch = tagArgument.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    assert.ok(variableMatch, `release tag must be a v-prefixed version or local variable: ${commandLine}`);
    const variableName = variableMatch[1];
    const step = steps.find((candidate) => candidate.includes(command[0]));
    assert.ok(step, `release command must belong to one workflow step: ${commandLine}`);
    const assignmentPattern = new RegExp(
      `^\\s*${variableName}=["']v\\$\\{\\{\\s*inputs\\.version\\s*\\}\\}["']\\s*$`,
      "m",
    );
    const assignmentIndex = step.search(assignmentPattern);
    const commandIndex = step.indexOf(command[0]);
    assert.ok(
      assignmentIndex >= 0 && assignmentIndex < commandIndex,
      `${variableName} must be assigned v-prefixed inputs.version in the same step before: ${commandLine}`,
    );
  }
}

test("release-dmg workflow file exists", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH));
});

test("workflow display name is 'release (macOS + Windows)'", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("name: release (macOS + Windows)"),
    "display name must be 'release (macOS + Windows)' per CLAUDE.md release command"
  );
});

test("workflow triggers on workflow_dispatch with version input", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("workflow_dispatch:"));
  assert.ok(content.includes("version:"));
});

test("F8: workflow uses macos-26 runner (not macos-latest)", () => {
  const content = loadWorkflow();
  // 精确解析 build job 的 runs-on，拒绝 macos-latest。
  // CLAUDE.md: "CI uses macos-26 runners" (Icon Composer / Xcode 26)。
  // 旧宽松正则 /runs-on:\s*macos-/ 会让 macos-latest 假绿通过。
  const buildJobMatch = content.match(
    /^\s{2}build:\s*\n(?:(?:\s{4}.*\n)+?)\s{4}runs-on:\s*(\S+)/m
  );
  assert.ok(buildJobMatch, "build job must declare runs-on");
  const runner = buildJobMatch[1];
  assert.equal(
    runner,
    "macos-26",
    `macOS build job must run on macos-26 (Icon Composer/Xcode 26), got: ${runner}`
  );
  assert.ok(
    !/runs-on:\s*macos-latest/.test(content),
    "macos-latest is forbidden — it does not guarantee Xcode 26 / Icon Composer"
  );
});

test("workflow uses v-prefixed tag for all gh release commands", () => {
  const content = loadWorkflow();
  assertReleaseCommandsUseVPrefixedTags(content);

  const withoutPrefix = content.replace(
    'TAG="v${{ inputs.version }}"',
    'TAG="${{ inputs.version }}"',
  );
  assert.throws(
    () => assertReleaseCommandsUseVPrefixedTags(withoutPrefix),
    /TAG must be assigned v-prefixed inputs\.version in the same step/,
    "dropping the v prefix from a local release tag variable must fail the contract",
  );
});

test("workflow verifies version matches package.json", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("Verify version"),
    "should have a version verification step"
  );
});

test("workflow builds dashboard before bundling", () => {
  const content = loadWorkflow();
  const dashBuild = content.indexOf("dashboard:build");
  const bundle = content.indexOf("bundle-node.sh");
  assert.ok(dashBuild > 0, "should build dashboard");
  assert.ok(bundle > 0, "should bundle EmbeddedServer");
  assert.ok(
    dashBuild < bundle,
    "dashboard build must come before EmbeddedServer bundle"
  );
});

test("workflow bundles EmbeddedServer via bundle-node.sh", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("bundle-node.sh"));
});

test("workflow installs xcodegen", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("brew install xcodegen"));
});

test("workflow installs Homebrew create-dmg for CI headless DMG layout", () => {
  const content = loadWorkflow();
  assert.ok(
    content.includes("brew install create-dmg"),
    "create-dmg.sh requires Homebrew create-dmg tool in CI mode"
  );
});

test("workflow runs xcodegen in TokenTrackerBar working directory", () => {
  const content = loadWorkflow();
  assert.ok(
    /working-directory:\s*TokenTrackerBar/.test(content),
    "xcodegen and xcodebuild must run in TokenTrackerBar/ directory where project.yml lives"
  );
});

test("workflow generates Xcode project and patches icon", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("xcodegen generate"));
  assert.ok(content.includes("patch-pbxproj-icon.rb"));
});

test("workflow builds with xcodebuild Release config", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("xcodebuild"));
  assert.ok(content.includes("-configuration Release"));
  assert.ok(content.includes("-scheme TokenTrackerBar"));
});

test("workflow ad-hoc signs inner Mach-O and outer .app with entitlements", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("codesign"), "must have codesign step");
  assert.ok(
    /EmbeddedServer\/node/.test(content),
    "must sign inner Mach-O (Resources/EmbeddedServer/node)"
  );
  assert.ok(
    content.includes("TokenTrackerBar.entitlements"),
    "must sign outer .app with entitlements"
  );
  assert.ok(
    /--sign\s*-/.test(content),
    "must use ad-hoc signing (--sign -)"
  );
});

test("workflow creates DMG via create-dmg.sh", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("create-dmg.sh"));
});

test("workflow creates the release up front and uploads the DMG asset", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("gh release create"));
  assert.ok(content.includes("gh release upload"));
  assert.ok(
    content.includes("TokenTrackerBar/build/TokenTrackerBar.dmg"),
    "must upload DMG from TokenTrackerBar/build/ directory (create-dmg.sh output)"
  );
});

test("workflow has correct step order: dashboard → bundle → xcode → sign → dmg → upload", () => {
  const content = loadWorkflow();
  const steps = [
    "dashboard:build",
    "bundle-node.sh",
    "brew install create-dmg",
    "xcodegen generate",
    "patch-pbxproj-icon.rb",
    "xcodebuild",
    "codesign",
    "create-dmg.sh",
    "gh release upload",
  ];
  let lastIndex = -1;
  for (const step of steps) {
    const idx = content.indexOf(step);
    assert.ok(idx > lastIndex, `"${step}" should come after previous step`);
    lastIndex = idx;
  }
});

test("release is created as a draft and only published after both builds", () => {
  const content = loadWorkflow();
  assert.ok(
    /gh release create[^\n]*--draft/.test(content),
    "create-release must create a --draft release"
  );
  assert.ok(/^\s{2}publish:/m.test(content), "must have a publish job");
  assert.ok(
    /publish:\s*\n\s*needs:\s*\[build,\s*windows\]/.test(content),
    "publish must need both build and windows"
  );
  assert.ok(
    /gh release edit[^\n]*--draft=false/.test(content),
    "publish must un-draft the release"
  );
});

test("homebrew tap is notified only after publish (not mid-build)", () => {
  const content = loadWorkflow();
  const undraft = content.indexOf("--draft=false");
  const dispatch = content.indexOf("homebrew-tokentracker");
  assert.ok(undraft > 0 && dispatch > 0, "both un-draft and dispatch must exist");
  assert.ok(dispatch > undraft, "homebrew dispatch must come after un-drafting");
});

test("F8: Homebrew dispatch --repo is exactly mm7894215/homebrew-tokentracker (no /dispatches suffix)", () => {
  const content = loadWorkflow();
  // 精确解析 gh workflow run 行的 --repo 参数值。
  // 旧宽松 includes("homebrew-tokentracker") 会让 --repo mm7894215/homebrew-tokentracker/dispatches 假绿通过。
  // gh workflow run 本身就调用 /dispatches 端点，repo 参数不能再带 /dispatches 尾随。
  const dispatchLine = content
    .split("\n")
    .find((l) => /gh workflow run/.test(l) && /homebrew-tokentracker/.test(l));
  assert.ok(dispatchLine, "must have a gh workflow run line targeting the Homebrew tap");
  const repoMatch = dispatchLine.match(/--repo\s+(\S+)/);
  assert.ok(repoMatch, "gh workflow run must pass --repo <owner/repo>");
  const repo = repoMatch[1];
  assert.equal(
    repo,
    "mm7894215/homebrew-tokentracker",
    `Homebrew --repo must be exactly mm7894215/homebrew-tokentracker, got: ${repo}`
  );
  assert.ok(
    !/\/dispatches/.test(repo),
    "Homebrew --repo must NOT carry a trailing /dispatches (gh workflow run already hits the dispatches endpoint)"
  );
});

test("workflow has concurrency guard", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("concurrency:"));
});

test("workflow has write permissions for release creation", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("contents: write"));
});

test("create-dmg.sh supports CI headless mode", () => {
  const dmgScript = fs.readFileSync(
    path.join(__dirname, "..", "TokenTrackerBar", "scripts", "create-dmg.sh"),
    "utf8"
  );
  assert.ok(
    dmgScript.includes('CI:-}'),
    "create-dmg.sh should check CI env var for headless mode"
  );
});
