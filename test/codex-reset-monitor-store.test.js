"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createCodexResetMonitorStore,
  resolveCodexResetMonitorStatePath,
} = require("../src/lib/codex-reset-monitor-store");

test("store remains inside tracker data, writes atomically, and requests private mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-store-"));
  const writes = [];
  const fsImpl = {
    ...fs,
    writeFileSync(file, data, options) {
      writes.push({ file, options });
      return fs.writeFileSync(file, data, options);
    },
  };
  try {
    const store = createCodexResetMonitorStore({ trackerDataDir: root, fsImpl });
    const statePath = resolveCodexResetMonitorStatePath(root);
    assert.equal(path.dirname(statePath), root);

    store.save({ version: 1, events: [], acknowledgedEventIds: [] });
    assert.equal(fs.existsSync(statePath), true);
    assert.equal(
      fs.readdirSync(root).some((name) => name.includes(".tmp.")),
      false,
    );
    assert.equal(writes[0].options.mode, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("corrupt state is quarantined and replaced by an empty state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-corrupt-"));
  try {
    const statePath = resolveCodexResetMonitorStatePath(root);
    fs.writeFileSync(statePath, "{broken", { mode: 0o600 });
    const store = createCodexResetMonitorStore({
      trackerDataDir: root,
      now: () => Date.parse("2026-07-20T08:00:00.000Z"),
    });
    const state = store.load();
    assert.equal(state.version, 1);
    assert.deepEqual(state.events, []);
    assert.equal(fs.existsSync(statePath), false);
    assert.equal(
      fs.readdirSync(root).some((name) => name.includes(".corrupt.2026-07-20T08-00-00-000Z")),
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
