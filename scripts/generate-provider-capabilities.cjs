"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const { PROVIDER_CAPABILITIES } = require(path.join(repoRoot, "src", "lib", "provider-capabilities"));
const swiftPath = path.join(
  repoRoot,
  "TokenTrackerBar",
  "TokenTrackerBar",
  "Models",
  "LimitsSettingsStore.swift",
);
const beginMarker = "    // BEGIN GENERATED PROVIDER CAPABILITIES — run npm run providers:generate";
const endMarker = "    // END GENERATED PROVIDER CAPABILITIES";

function swiftString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function generatedBlock(eol) {
  const providers = PROVIDER_CAPABILITIES.filter((provider) => provider.desktop_visibility);
  const ids = providers.map((provider) => swiftString(provider.id)).join(", ");
  const names = providers
    .map((provider) => `        ${swiftString(provider.id)}: ${swiftString(provider.display_name)},`)
    .join(eol);
  return `${beginMarker}${eol}` +
    `    static let allProviders: [String] = [${ids}]${eol}${eol}` +
    `    static let displayNames: [String: String] = [${eol}${names}${eol}    ]${eol}` +
    endMarker;
}

const source = fs.readFileSync(swiftPath, "utf8");
const crlfCount = (source.match(/\r\n/g) || []).length;
const loneLfCount = (source.match(/(?<!\r)\n/g) || []).length;
const eol = crlfCount > loneLfCount ? "\r\n" : "\n";
const generated = generatedBlock(eol);
const markedPattern = new RegExp(
  `${beginMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
);
const legacyPattern = /    static let allProviders: \[String\] = \[[^\n]+\]\r?\n\r?\n    static let displayNames: \[String: String\] = \[[\s\S]*?\r?\n    \]/;
let updated;
if (markedPattern.test(source)) {
  updated = source.replace(markedPattern, generated);
} else if (legacyPattern.test(source)) {
  updated = source.replace(legacyPattern, generated);
} else {
  throw new Error("LimitsSettingsStore provider constant block was not found");
}

if (process.argv.includes("--check")) {
  if (updated !== source) {
    console.error("Generated Swift provider constants are stale. Run npm run providers:generate.");
    process.exitCode = 1;
  }
} else if (updated !== source) {
  fs.writeFileSync(swiftPath, updated, "utf8");
  console.log(`Updated ${path.relative(repoRoot, swiftPath)}`);
}