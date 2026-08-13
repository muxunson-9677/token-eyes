const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// The macOS app and the dashboard each keep their own canonical list of
// usage-limits provider ids. The native bridge syncs preference snapshots
// keyed by these ids, so the Swift list must stay a strict prefix of the
// dashboard list — same ids, same default order. The dashboard may append
// web-only providers at the tail (currently "zed"): Swift's normalizedOrder
// drops ids it doesn't know, and the dashboard's normalizeOrder re-appends
// them after a native round-trip, so tail-only additions are safe. A native
// row for such providers requires typed decode + assets in TokenTrackerBar
// before the id moves into the shared prefix.

const repoRoot = path.join(__dirname, "..");

function extractQuotedList(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} literal not found — update the parity test pattern`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("macOS LimitsSettingsStore.allProviders matches dashboard LIMIT_PROVIDER_IDS", () => {
  const swiftSource = fs.readFileSync(
    path.join(repoRoot, "TokenTrackerBar", "TokenTrackerBar", "Models", "LimitsSettingsStore.swift"),
    "utf8",
  );
  const jsSource = fs.readFileSync(
    path.join(repoRoot, "dashboard", "src", "lib", "limits-providers.js"),
    "utf8",
  );

  const swiftIds = extractQuotedList(
    swiftSource,
    /static let allProviders: \[String\] = \[([^\]]+)\]/,
    "LimitsSettingsStore.allProviders",
  );
  const jsIds = extractQuotedList(
    jsSource,
    /export const LIMIT_PROVIDER_IDS = \[([^\]]+)\]/s,
    "LIMIT_PROVIDER_IDS",
  );

  assert.ok(swiftIds.length > 0, "provider lists must not be empty");
  assert.deepEqual(
    jsIds.slice(0, swiftIds.length),
    swiftIds,
    "Swift allProviders must be a strict prefix of dashboard LIMIT_PROVIDER_IDS",
  );
  assert.deepEqual(swiftIds, [
    "claude",
    "codex",
    "cursor",
    "trae",
    "codebuddy",
    "gemini",
    "hermes",
    "openclaw",
    "opencode",
    "antigravity",
  ]);
  // Web-only tail: providers visible in the dashboard but not (yet) in the
  // macOS native popover. V4 item-3a expanded this to every implemented
  // channel; Swift's normalizedOrder drops the ids it doesn't know and the
  // dashboard re-appends them, so tail-only additions stay safe.
  assert.deepEqual(jsIds.slice(swiftIds.length), [
    "zed",
    "workbuddy",
    "every-code",
    "kilo-cli",
    "kilocode",
    "roocode",
    "kiro",
    "kiro-cli",
    "kimi",
    "kimi-code",
    "omp",
    "pi",
    "craft",
    "grok",
    "copilot",
    "goose",
    "droid",
  ]);
});
