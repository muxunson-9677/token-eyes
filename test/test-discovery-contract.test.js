const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
const DASHBOARD_PACKAGE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "dashboard", "package.json"), "utf8"));
const DASHBOARD_VITEST_CONFIG = fs.readFileSync(
  path.join(REPO_ROOT, "dashboard", "vitest.config.ts"),
  "utf8",
);
const RUNTIME_TEST_OWNERS = new Map([
  ["test/windows-bundled-runtime-smoke.test.cjs", "tauri:verify-runtime"],
  ["test/windows-installed-runtime-smoke.test.cjs", "tauri:verify-installer"],
]);
const CANONICAL_CI_LOCAL_COMMANDS = [
  "npm run agents:check",
  "npm --prefix dashboard run lint",
  "npm --prefix dashboard run typecheck",
  "npm --prefix dashboard run test",
  "npm --prefix dashboard run build",
  "npm --prefix dashboard run verify:data-display-policy",
  "npm test",
  "npm run validate:copy",
  "npm run validate:ui-hardcode",
  "npm run validate:guardrails",
];
const REQUIRED_ROOT_SCRIPT_TARGETS = new Map([
  ["agents:check", "node scripts/generate-agent-dashboard-registry.cjs --check"],
  ["test", "node --test test/*.test.js"],
  ["validate:copy", "node scripts/validate-copy-registry.cjs"],
  ["validate:ui-hardcode", "node scripts/ops/validate-ui-hardcode.cjs"],
  ["validate:guardrails", "node scripts/validate-architecture-guardrails.cjs"],
]);
const REQUIRED_DASHBOARD_SCRIPT_TARGETS = new Map([
  ["lint", "eslint \"src/**/*.{js,jsx,ts,tsx}\""],
  ["typecheck", "tsc --noEmit"],
  ["test", "vitest run"],
  ["build", "vite build"],
  ["verify:data-display-policy", "node scripts/verify-data-display-policy.mjs"],
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function discoverTests(relativeRoot, pattern, ignoredDirectories = new Set()) {
  const absoluteRoot = path.join(REPO_ROOT, relativeRoot);
  const discovered = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        discovered.push(toPosix(path.relative(REPO_ROOT, absolutePath)));
      }
    }
  };
  visit(absoluteRoot);
  return discovered.sort();
}

function rootNodeOwners(relativePath) {
  const owners = [];
  if (/^test\/[^/]+\.test\.js$/u.test(relativePath)) owners.push("root:npm-test");
  const runtimeOwner = RUNTIME_TEST_OWNERS.get(relativePath);
  if (runtimeOwner) owners.push(runtimeOwner);
  return owners;
}

function ciLocalCommands(rootPackage = ROOT_PACKAGE) {
  return String(rootPackage.scripts?.["ci:local"] || "")
    .split(/\s*&&\s*/u)
    .map((command) => command.trim())
    .filter(Boolean);
}

function packageWithCiLocalCommands(commands) {
  const rootPackage = JSON.parse(JSON.stringify(ROOT_PACKAGE));
  rootPackage.scripts["ci:local"] = commands.join(" && ");
  return rootPackage;
}

function assertCiLocalContract(
  rootPackage = ROOT_PACKAGE,
  dashboardPackage = DASHBOARD_PACKAGE,
) {
  const commands = ciLocalCommands(rootPackage);
  assert.deepEqual(
    commands,
    CANONICAL_CI_LOCAL_COMMANDS,
    "ci:local must contain the complete canonical gate exactly once and in order",
  );
  assert.deepEqual(
    commands.filter((command) => /^node --test test\//u.test(command)),
    [],
    "flat root tests must be owned only by the npm test discovery step",
  );
  for (const [scriptName, expectedTarget] of REQUIRED_ROOT_SCRIPT_TARGETS) {
    assert.equal(
      rootPackage.scripts?.[scriptName],
      expectedTarget,
      `root ${scriptName} must execute its real canonical target`,
    );
  }
  for (const [scriptName, expectedTarget] of REQUIRED_DASHBOARD_SCRIPT_TARGETS) {
    assert.equal(
      dashboardPackage.scripts?.[scriptName],
      expectedTarget,
      `Dashboard ${scriptName} must execute its real canonical target`,
    );
  }
}

test("every root Node test has exactly one explicit runner owner and src has no co-located tests", () => {
  assert.equal(ROOT_PACKAGE.scripts?.test, "node --test test/*.test.js");
  for (const [relativePath, scriptName] of RUNTIME_TEST_OWNERS) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, relativePath)), true, `${relativePath} must exist`);
    assert.match(
      String(ROOT_PACKAGE.scripts?.[scriptName] || ""),
      new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `${scriptName} must own ${relativePath}`,
    );
  }

  const nodeTests = [
    ...discoverTests("test", /\.test\.(?:js|cjs|mjs)$/u),
    ...discoverTests("src", /\.test\.(?:js|cjs|mjs)$/u),
  ].sort();
  assert.ok(nodeTests.length > 0, "root Node discovery must find tests");

  const invalidOwners = nodeTests
    .map((relativePath) => ({ relativePath, owners: rootNodeOwners(relativePath) }))
    .filter(({ owners }) => owners.length !== 1);
  assert.deepEqual(invalidOwners, []);
  assert.deepEqual(nodeTests.filter((relativePath) => relativePath.startsWith("src/")), []);
});

test("every Dashboard test is recursively owned by the complete Vitest runner", () => {
  assert.equal(DASHBOARD_PACKAGE.scripts?.test, "vitest run");
  assert.match(
    DASHBOARD_VITEST_CONFIG,
    /include:\s*\[\s*["']src\/\*\*\/\*\.test\.\{js,jsx,ts,tsx\}["']\s*\]/u,
  );

  const dashboardTests = discoverTests(
    "dashboard",
    /\.test\.(?:js|jsx|ts|tsx)$/u,
    new Set(["node_modules", "dist", "coverage"]),
  );
  assert.ok(dashboardTests.length > 0, "Dashboard discovery must find tests");
  const invalidOwners = dashboardTests
    .map((relativePath) => ({
      relativePath,
      owners: relativePath.startsWith("dashboard/src/") ? ["dashboard:vitest"] : [],
    }))
    .filter(({ owners }) => owners.length !== 1);
  assert.deepEqual(invalidOwners, []);
});

test("ci:local is the canonical root gate and contains every required real command exactly once", () => {
  assertCiLocalContract();
});

test("ci:local contract rejects deletion of every planned sub-gate", () => {
  const commands = ciLocalCommands();
  for (const [index, command] of commands.entries()) {
    const mutated = commands.filter((_, candidateIndex) => candidateIndex !== index);
    assert.throws(
      () => assertCiLocalContract(packageWithCiLocalCommands(mutated)),
      undefined,
      `deleting '${command}' must fail the canonical gate contract`,
    );
  }
});

test("ci:local contract rejects duplication of every planned sub-gate", () => {
  const commands = ciLocalCommands();
  for (const [index, command] of commands.entries()) {
    const mutated = [...commands];
    mutated.splice(index, 0, command);
    assert.throws(
      () => assertCiLocalContract(packageWithCiLocalCommands(mutated)),
      undefined,
      `duplicating '${command}' must fail the canonical gate contract`,
    );
  }
});

test("ci:local contract rejects substitution of every planned sub-gate", () => {
  const commands = ciLocalCommands();
  for (const [index, command] of commands.entries()) {
    const mutated = [...commands];
    mutated[index] = `node -e \"process.exit(0)\" --synthetic-${index}`;
    assert.throws(
      () => assertCiLocalContract(packageWithCiLocalCommands(mutated)),
      undefined,
      `replacing '${command}' must fail the canonical gate contract`,
    );
  }
});
