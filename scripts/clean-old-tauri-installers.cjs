const fs = require("node:fs");
const path = require("node:path");

const INSTALLER_PATTERN =
  /^Token Eyes_(\d+\.\d+\.\d+)_(?:x64|arm64|aarch64)-setup\.exe$/;
const GENERATED_ICON_PATTERN =
  /^Token Eyes_(\d+\.\d+\.\d+)_installer-icon\.png$/;

function cleanupOldNsisInstallers({ nsisDir, currentVersion }) {
  if (!fs.existsSync(nsisDir)) {
    return { removed: [], reclaimedBytes: 0 };
  }

  const removed = [];
  let reclaimedBytes = 0;
  for (const entry of fs.readdirSync(nsisDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const installerMatch = entry.name.match(INSTALLER_PATTERN);
    const generatedIconMatch = entry.name.match(GENERATED_ICON_PATTERN);
    if (!installerMatch && !generatedIconMatch) continue;
    if (installerMatch?.[1] === currentVersion) continue;

    const target = path.join(nsisDir, entry.name);
    reclaimedBytes += fs.statSync(target).size;
    fs.unlinkSync(target);
    removed.push(entry.name);
  }

  return { removed, reclaimedBytes };
}

function assertInsideProject(projectRoot, targetDirectory) {
  const relative = path.relative(projectRoot, targetDirectory);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to clean outside the project: ${targetDirectory}`);
  }
}

function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const packageJson = require(path.join(projectRoot, "package.json"));
  const nsisDir = path.join(
    projectRoot,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
  );
  assertInsideProject(projectRoot, nsisDir);

  const result = cleanupOldNsisInstallers({
    nsisDir,
    currentVersion: packageJson.version,
  });
  const reclaimedMiB = (result.reclaimedBytes / 1024 / 1024).toFixed(2);
  console.log(
    `Kept Token Eyes ${packageJson.version}; removed ${result.removed.length} old NSIS artifact(s), reclaimed ${reclaimedMiB} MiB.`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  cleanupOldNsisInstallers,
};
