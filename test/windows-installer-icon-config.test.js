const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");

const APPROVED_ICON_HASHES = {
  "src-tauri/icons/icon.ico":
    "44732AF1CE6075322EFB989408522D7F97B02D5A72ED83F582A1C26C491C4BC0",
  "src-tauri/icons/32x32.png":
    "6F128A4232CF973E5F0812DC06123D39716606244B059BBF5911374D46A9A3F0",
  "src-tauri/icons/128x128.png":
    "81F0D63B1B523A76FECB7DC519DCDBB23C88237FC3A5132960EE40BE22C44EA7",
  "src-tauri/icons/128x128@2x.png":
    "A9D86D7CB92067EF14CDC00FBA12E2547AA849884276E202D875DBEB9F2B28FF",
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function sha256(relPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relPath)))
    .digest("hex")
    .toUpperCase();
}

test("approved Token Eyes icon assets do not drift", () => {
  for (const [relPath, expectedHash] of Object.entries(APPROVED_ICON_HASHES)) {
    assert.equal(sha256(relPath), expectedHash, `${relPath} hash drifted`);
  }
});

test("NSIS installer and uninstaller use the approved app icon", () => {
  const tauri = readJson("src-tauri/tauri.conf.json");
  assert.equal(tauri.bundle.windows.nsis.installerIcon, "icons/icon.ico");
  assert.equal(tauri.bundle.windows.nsis.uninstallerIcon, "icons/icon.ico");
});
