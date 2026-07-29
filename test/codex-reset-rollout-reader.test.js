"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const MODULE_PATH = path.resolve(__dirname, "../src/lib/codex-reset-rollout-reader.js");

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("extracts direct and nested rate-limit snapshots without message content", async () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, "rollout reset reader must exist");
  const { collectCodexResetSnapshots } = require(MODULE_PATH);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-rollout-"));
  try {
    writeJsonl(path.join(home, "sessions", "2026", "07", "29", "rollout-a.jsonl"), [
      {
        timestamp: "2026-07-29T04:19:11.000Z",
        payload: {
          type: "token_count",
          rate_limits: {
            limit_id: "codex",
            primary: {
              used_percent: 21,
              window_minutes: 10080,
              resets_at: 1785814743,
            },
          },
          user_message: "must never be returned",
          tool_arguments: { command: "must never be returned" },
        },
      },
      {
        timestamp: "2026-07-29T04:19:12.000Z",
        payload: {
          msg: {
            type: "token_count",
            rate_limits: {
              limit_id: "codex",
              primary: {
                used_percent: 0,
                window_minutes: 300,
                resets_at: 1785903549,
              },
            },
          },
          response_text: "must never be returned",
        },
      },
    ]);

    const result = await collectCodexResetSnapshots({
      codexHomes: [home],
      sinceMs: Date.parse("2026-06-29T00:00:00.000Z"),
    });
    assert.deepEqual(
      result.snapshots.map(({ window, usedPercent }) => ({ window, usedPercent })),
      [
        { window: "rolling_weekly", usedPercent: 21 },
        { window: "rolling_5_hour", usedPercent: 0 },
      ],
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /must never be returned|user_message|response_text|tool_arguments/u,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("uses hashed incremental cursors and scans archived sessions without raw paths", async () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, "rollout reset reader must exist");
  const { collectCodexResetSnapshots } = require(MODULE_PATH);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-reset-cursor-"));
  try {
    writeJsonl(path.join(home, "archived_sessions", "rollout-b.jsonl"), [{
      timestamp: "2026-07-29T05:00:00.000Z",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: {
            used_percent: 8,
            window_minutes: 300,
            resets_at: 1785903549,
          },
        },
      },
    }]);
    const first = await collectCodexResetSnapshots({
      codexHomes: [home],
      sinceMs: Date.parse("2026-06-29T00:00:00.000Z"),
    });
    assert.equal(first.snapshots.length, 1);
    assert.ok(Object.keys(first.cursor.files).every((key) => /^[a-f0-9]{32}$/u.test(key)));
    assert.doesNotMatch(JSON.stringify(first.cursor), /sessions|rollout|Users|AgentData/u);

    const second = await collectCodexResetSnapshots({
      codexHomes: [home],
      sinceMs: Date.parse("2026-06-29T00:00:00.000Z"),
      cursor: first.cursor,
    });
    assert.equal(second.snapshots.length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
