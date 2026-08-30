const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("retired cloud sync source is a network-free compatibility surface", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "dashboard/src/lib/cloud-sync.ts"),
    "utf8",
  );

  assert.match(src, /runCloudUsageSyncIfDue[\s\S]*void getAccessToken/);
  assert.match(src, /runCloudUsageSyncNow[\s\S]*void getAccessToken/);
  for (const retiredCapability of [
    "DEVICE_TOKEN_ROTATE_AFTER_MS",
    "shouldRotateStoredDeviceSession",
    "clearCloudDeviceSession",
    "postLocalUsageSync",
    "syncCloudUsageWithRecovery",
    "tokentracker-device-token-issue",
    "tokentracker-leaderboard-refresh",
  ]) {
    assert.doesNotMatch(src, new RegExp(retiredCapability));
  }
  assert.doesNotMatch(src, /\bfetch\s*\(/);
});

test("local auth helper caches the per-process token in memory", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, _init) => {
    calls.push(1);
    return new Response(JSON.stringify({ token: "local-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const { loadDashboardModule } = require("./helpers/load-dashboard-module");
    const mod = await loadDashboardModule("dashboard/src/lib/local-api-auth.ts");
    mod.clearLocalApiAuthToken();

    const first = await mod.getLocalApiAuthHeaders(globalThis.fetch);
    const second = await mod.getLocalApiAuthHeaders(globalThis.fetch);

    assert.deepEqual(first, { "x-tokentracker-local-auth": "local-token" });
    assert.deepEqual(second, { "x-tokentracker-local-auth": "local-token" });
    assert.equal(calls.length, 1);

    mod.clearLocalApiAuthToken();
  } finally {
    globalThis.fetch = previousFetch;
  }
});
