const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  cleanupOldNsisInstallers,
} = require("../scripts/clean-old-tauri-installers.cjs");

const projectRoot = path.resolve(__dirname, "..");

function makeTempNsisDirectory() {
  return fs.mkdtempSync(path.join(projectRoot, ".tmp-clean-old-installers-"));
}

test("keeps the current NSIS installer and removes only older Token Eyes artifacts", () => {
  const nsisDir = makeTempNsisDirectory();
  try {
    const fixtures = [
      "Token Eyes_0.54.15_x64-setup.exe",
      "Token Eyes_0.54.15_installer-icon.png",
      "Token Eyes_0.54.16_installer-icon.png",
      "Token Eyes_0.54.16_x64-setup.exe",
      "notes.txt",
    ];
    for (const name of fixtures) {
      fs.writeFileSync(path.join(nsisDir, name), name);
    }

    const result = cleanupOldNsisInstallers({
      nsisDir,
      currentVersion: "0.54.16",
    });

    assert.deepEqual(result.removed.sort(), [
      "Token Eyes_0.54.15_installer-icon.png",
      "Token Eyes_0.54.15_x64-setup.exe",
      "Token Eyes_0.54.16_installer-icon.png",
    ]);
    assert.deepEqual(fs.readdirSync(nsisDir).sort(), [
      "Token Eyes_0.54.16_x64-setup.exe",
      "notes.txt",
    ]);
  } finally {
    fs.rmSync(nsisDir, { recursive: true, force: true });
  }
});

test("does nothing when the NSIS output directory does not exist", () => {
  const missingDir = path.join(
    projectRoot,
    ".tmp-clean-old-installers-missing",
  );

  assert.deepEqual(
    cleanupOldNsisInstallers({
      nsisDir: missingDir,
      currentVersion: "0.54.16",
    }),
    { removed: [], reclaimedBytes: 0 },
  );
});
