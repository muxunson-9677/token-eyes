const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("Windows NSIS installer preinstall hook stops only Token Eyes bundled node", () => {
  const configPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const hookRel = config.bundle?.windows?.nsis?.installerHooks;

  assert.equal(
    hookRel,
    "windows/nsis-hooks.nsh",
    "NSIS installer must include the Token Eyes process cleanup hooks",
  );

  const hookPath = path.join(repoRoot, "src-tauri", hookRel);
  const hookSource = fs.readFileSync(hookPath, "utf8");

  assert.match(
    hookSource,
    /!macro\s+NSIS_HOOK_PREINSTALL/,
    "hook file must define a preinstall hook",
  );
  assert.match(
    hookSource,
    /"\$INSTDIR"/,
    "preinstall hook must pass the resolved install directory to the cleanup script",
  );
  assert.match(
    hookSource,
    /EmbeddedServer-\*/,
    "cleanup script must target this release's versioned runtime directory",
  );
  assert.match(
    hookSource,
    /Join-Path \$\$_\.FullName 'node\.exe'/,
    "cleanup script must target node.exe inside every installed versioned runtime directory",
  );
  assert.doesNotMatch(
    hookSource,
    /taskkill\s+[^\\r\\n]*(?:\/IM|-im)\s+node\.exe/i,
    "installer must not kill every node.exe on the machine",
  );
});
