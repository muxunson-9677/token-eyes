const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

async function loadModuleWithStorage(storage) {
  globalThis.localStorage = storage;
  return import("../dashboard/src/lib/cloud-sync-prefs.ts");
}

test("cloud device session stays in memory and clears legacy localStorage", async () => {
  const legacyKey = "tokentracker_cloud_device_session_v1";
  const storage = createStorage({
    [legacyKey]: JSON.stringify({
      token: "persisted-token",
      deviceId: "persisted-device",
      issuedAt: "2026-04-20T00:00:00.000Z",
    }),
  });
  const previous = globalThis.localStorage;

  try {
    const mod = await loadModuleWithStorage(storage);

    assert.equal(mod.getStoredDeviceSession(), null);
    assert.equal(storage.getItem(legacyKey), null);

    const session = {
      token: "memory-token",
      deviceId: "memory-device",
      issuedAt: "2026-04-20T01:00:00.000Z",
    };

    mod.setStoredDeviceSession(session);
    assert.deepEqual(mod.getStoredDeviceSession(), session);
    assert.equal(storage.getItem(legacyKey), null);

    mod.clearCloudDeviceSession();
    assert.equal(mod.getStoredDeviceSession(), null);
  } finally {
    globalThis.localStorage = previous;
  }
});

test("shipped dashboard has no caller for the retired hourly upload path", () => {
  const dashboardRoot = path.join(__dirname, "..", "dashboard", "src");
  const callers = [];

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!/\.[jt]sx?$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) continue;
      if (file.endsWith(path.join("lib", "cloud-sync.ts"))) continue;
      const source = fs.readFileSync(file, "utf8");
      if (/runCloudUsageSync(?:IfDue|Now)|tokentracker-device-token-issue|drain\s*:\s*true/.test(source)) {
        callers.push(path.relative(dashboardRoot, file));
      }
    }
  }

  visit(dashboardRoot);
  assert.deepEqual(callers, []);
});

test("legacy edge uploads are server-gated and reject privacy-forbidden fields", () => {
  const root = path.join(__dirname, "..", "dashboard", "edge-patches");
  for (const name of ["tokentracker-ingest.ts", "tokentracker-device-token-issue.ts"]) {
    const source = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(source, /TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED/);
    assert.match(source, /leaderboard-compact-state-v1/);
    for (const field of ["code", "conversation", "project", "path", "skill", "mcp", "file"]) {
      assert.match(source, new RegExp(`["']${field}["']`, "i"), `${name} must reject ${field}`);
    }
  }
});
