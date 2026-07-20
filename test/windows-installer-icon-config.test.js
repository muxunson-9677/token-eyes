const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");

const APPROVED_ICON_HASHES = {
  "src-tauri/icons/token-eyes-orange/icon.ico":
    "ACB8C06AAF10C6239972D9B6B63AB87214C219067F43F4417D8CFDA29C74A0D5",
  "src-tauri/icons/token-eyes-orange/32x32.png":
    "37EB5809C3EC370734410DF67C055DAE6019428DF81CC160F4645500FD556F44",
  "src-tauri/icons/token-eyes-orange/128x128.png":
    "3D92409028B853831E140BC60B410E4A07CE2BEEB6324F09945EDE12C67EC6A3",
  "src-tauri/icons/token-eyes-orange/128x128@2x.png":
    "F5C75AEEF89D55627799CD81E8D9ED44ECA80EC5146E4BACEE4E70A00D9F315D",
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
  assert.equal(tauri.bundle.windows.nsis.installerIcon, "icons/token-eyes-orange/icon.ico");
  assert.equal(tauri.bundle.windows.nsis.uninstallerIcon, "icons/token-eyes-orange/icon.ico");
});
