const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("runtime and dashboard sources no longer reference the retired InsForge project", () => {
  const files = [
    "src/lib/runtime-config.js",
    "src/commands/device-login.js",
    "dashboard/src/lib/insforge-config.ts",
    "dashboard/src/pages/DevicePage.jsx",
  ];
  const source = files
    .map((file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /a62b9nf2|anon_13e8a5d/u);
  assert.match(source, /wm59q8gm\.ap-southeast\.insforge\.app/u);
});
