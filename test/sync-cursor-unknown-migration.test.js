const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  cmdSync,
  migrateCursorUnknownBuckets,
  migrateRolloutCumulativeDeltaBuckets,
  repairGrokQueueFromSessionSnapshots,
  CURSOR_UNKNOWN_MIGRATION_KEY,
  ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY,
  GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY,
} = require("../src/commands/sync");

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-mig-"));
}

describe("migrateCursorUnknownBuckets", () => {
  it("previews unknown history without retracting or advancing migration state", async () => {
    const dir = await makeTempDir();
    try {
      const queuePath = path.join(dir, "queue.jsonl");
      const cursors = {hourly:{buckets:{"cursor|unknown|2026-04-13T05:30:00.000Z":{totals:{total_tokens:58396}},"codex|unknown|2026-04-13T05:30:00.000Z":{totals:{total_tokens:456}}}},cursorApi:{lastRecordTimestamp:"2026-04-16T03:32:33.284Z"}};
      const before=structuredClone(cursors);
      const result=await migrateCursorUnknownBuckets({cursors,queuePath});
      assert.deepEqual(result,[{key:"cursor|unknown|2026-04-13T05:30:00.000Z",previous_tokens:58396,reason:"cursor_legacy_account_unresolved"}]);
      assert.deepEqual(cursors,before);assert.equal(fssync.existsSync(queuePath),false);
      assert.deepEqual(await migrateCursorUnknownBuckets({cursors,queuePath}),result);
      assert.deepEqual(await migrateCursorUnknownBuckets({cursors:{},queuePath}),[]);
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
  });
});

describe("migrateRolloutCumulativeDeltaBuckets", () => {
  it("purges codex and every-code buckets, emits zero retractions, and resets rollout file cursors", async () => {
    const dir = await makeTempDir();
    const queuePath = path.join(dir, "queue.jsonl");
    const codexPath = path.join(dir, ".codex", "sessions", "rollout-codex.jsonl");
    const everyCodePath = path.join(dir, ".code", "sessions", "rollout-every.jsonl");
    const claudePath = path.join(dir, ".claude", "projects", "session.jsonl");
    const cursors = {
      files: {
        [codexPath]: { offset: 100 },
        [everyCodePath]: { offset: 200 },
        [claudePath]: { offset: 300 },
      },
      hourly: {
        groupQueued: {
          "codex|2026-05-01T00:00:00.000Z": "old-codex",
          "every-code|2026-05-01T00:30:00.000Z": "old-every",
          "claude|2026-05-01T00:00:00.000Z": "old-claude",
        },
        buckets: {
          "codex|gpt-5.5|2026-05-01T00:00:00.000Z": {
            totals: { total_tokens: 100, conversation_count: 2 },
          },
          "every-code|gpt-5.5|2026-05-01T00:30:00.000Z": {
            totals: { total_tokens: 50, conversation_count: 1 },
          },
          "claude|opus|2026-05-01T00:00:00.000Z": {
            totals: { total_tokens: 25, conversation_count: 1 },
          },
        },
      },
    };

    await migrateRolloutCumulativeDeltaBuckets({
      cursors,
      queuePath,
      rolloutFiles: [
        { path: codexPath, source: "codex" },
        { path: everyCodePath, source: "every-code" },
      ],
    });

    assert.equal(cursors.files[codexPath], undefined);
    assert.equal(cursors.files[everyCodePath], undefined);
    assert.equal(cursors.files[claudePath].offset, 300);
    assert.equal(cursors.hourly.buckets["codex|gpt-5.5|2026-05-01T00:00:00.000Z"], undefined);
    assert.equal(cursors.hourly.buckets["every-code|gpt-5.5|2026-05-01T00:30:00.000Z"], undefined);
    assert.ok(cursors.hourly.buckets["claude|opus|2026-05-01T00:00:00.000Z"]);
    assert.equal(cursors.hourly.groupQueued["codex|2026-05-01T00:00:00.000Z"], undefined);
    assert.equal(cursors.hourly.groupQueued["every-code|2026-05-01T00:30:00.000Z"], undefined);
    assert.equal(cursors.hourly.groupQueued["claude|2026-05-01T00:00:00.000Z"], "old-claude");
    assert.ok(cursors.migrations[ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY]);

    const rows = (await fs.readFile(queuePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => `${row.source}|${row.model}|${row.total_tokens}`).sort(),
      ["codex|gpt-5.5|0", "every-code|gpt-5.5|0"],
    );

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("repairGrokQueueFromSessionSnapshots", () => {
  it("appends Grok corrections from snapshots, preserves history, backs up files, and is idempotent", async () => {
    const dir = await makeTempDir();
    const queuePath = path.join(dir, "queue.jsonl");
    const queueStatePath = path.join(dir, "queue.state.json");
    const cursors = {
      hourly: {
        groupQueued: {
          "grok|2026-04-05T14:00:00.000Z": "old-grok-group",
          "codex|2026-04-05T14:00:00.000Z": "keep-codex-group",
        },
        buckets: {
          "grok|grok-build|2026-04-05T14:00:00.000Z": {
            totals: { total_tokens: 999, conversation_count: 9 },
            queuedKey: "old-grok-key",
          },
          "codex|gpt-5.5|2026-04-05T14:00:00.000Z": {
            totals: { total_tokens: 123, conversation_count: 1 },
            queuedKey: "keep-codex-key",
          },
        },
      },
      grok: {
        sessionSnapshots: {
          "grok-a": {
            totalTokens: 100,
            messageCount: 2,
            model: "grok-build",
            lastEventTimestamp: "2026-04-05T14:05:00.000Z",
          },
          "grok-b": {
            totalTokens: 50,
            messageCount: 1,
            model: "grok-build",
            lastEventTimestamp: "2026-04-05T14:20:00.000Z",
          },
          "grok-c": {
            totalTokens: 70,
            messageCount: 3,
            model: "grok-build",
            lastEventTimestamp: "2026-04-05T14:40:00.000Z",
          },
          "grok-d": {
            totalTokens: 25,
            messageCount: 4,
            model: "grok-other",
            updatedAt: "2026-04-05T15:01:00.000Z",
          },
          "grok-zero": {
            totalTokens: 0,
            messageCount: 1,
            model: "grok-build",
            lastEventTimestamp: "2026-04-05T15:05:00.000Z",
          },
        },
      },
    };

    await fs.writeFile(
      queuePath,
      [
        JSON.stringify({
          source: "grok",
          model: "grok-build",
          hour_start: "2026-04-05T14:00:00.000Z",
          total_tokens: 999,
        }),
        JSON.stringify({
          source: "codex",
          model: "gpt-5.5",
          hour_start: "2026-04-05T14:00:00.000Z",
          total_tokens: 123,
        }),
        "not-json",
        JSON.stringify({
          source: " Grok ",
          model: "grok-build",
          hour_start: "2026-04-05T14:30:00.000Z",
          total_tokens: 777,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(
      queueStatePath,
      JSON.stringify({ offset: 4096, updatedAt: "2026-04-05T16:00:00.000Z" }),
      "utf8",
    );

    const repaired = await repairGrokQueueFromSessionSnapshots({
      cursors,
      queuePath,
      queueStatePath,
    });
    assert.equal(repaired, true);

    const queueText = await fs.readFile(queuePath, "utf8");
    assert.ok(queueText.includes("not-json"));
    const rows = queueText
      .trim()
      .split("\n")
      .filter((line) => line !== "not-json")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 6);
    const grokRows = rows.filter((row) => String(row.source).trim().toLowerCase() === "grok");
    assert.equal(grokRows.length, 5);
    assert.deepEqual(
      rows
        .map(
          (row) =>
            `${String(row.source).trim().toLowerCase()}|${row.model}|${row.hour_start}|${row.total_tokens}`,
        )
        .sort(),
      [
        "codex|gpt-5.5|2026-04-05T14:00:00.000Z|123",
        "grok|grok-build|2026-04-05T14:00:00.000Z|150",
        "grok|grok-build|2026-04-05T14:00:00.000Z|999",
        "grok|grok-build|2026-04-05T14:30:00.000Z|70",
        "grok|grok-build|2026-04-05T14:30:00.000Z|777",
        "grok|grok-other|2026-04-05T15:00:00.000Z|25",
      ],
    );

    const aggregatedRow = rows.find(
      (row) =>
        row.source === "grok" &&
        row.hour_start === "2026-04-05T14:00:00.000Z" &&
        row.total_tokens === 150,
    );
    assert.equal(aggregatedRow.input_tokens, 120);
    assert.equal(aggregatedRow.output_tokens, 30);
    assert.equal(aggregatedRow.conversation_count, 3);

    const repairedBucket =
      cursors.hourly.buckets["grok|grok-build|2026-04-05T14:00:00.000Z"];
    assert.equal(repairedBucket.totals.total_tokens, 150);
    assert.equal(repairedBucket.totals.input_tokens, 120);
    assert.equal(repairedBucket.totals.output_tokens, 30);
    assert.equal(repairedBucket.totals.conversation_count, 3);
    assert.ok(repairedBucket.queuedKey);
    assert.equal(cursors.hourly.groupQueued["grok|2026-04-05T14:00:00.000Z"], undefined);
    assert.equal(cursors.hourly.groupQueued["codex|2026-04-05T14:00:00.000Z"], "keep-codex-group");
    assert.ok(cursors.hourly.buckets["codex|gpt-5.5|2026-04-05T14:00:00.000Z"]);

    const queueState = JSON.parse(await fs.readFile(queueStatePath, "utf8"));
    assert.equal(queueState.offset, 0);
    assert.equal(queueState.note, "reset_after_grok_append_only_repair_2026_05_v4");
    const migration = cursors.grok.migrations[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY];
    assert.equal(migration.status, "applied");
    assert.equal(migration.existingGrokRows, 2);
    assert.equal(migration.rowsWritten, 3);
    assert.equal(migration.staleRowsRetracted, 0);
    assert.match(migration.queueBackupPath, /queue\.jsonl\.bak\./);
    assert.match(migration.queueStateBackupPath, /queue\.state\.json\.bak\./);
    await fs.stat(migration.queueBackupPath);
    await fs.stat(migration.queueStateBackupPath);

    const queueAfterFirstRepair = await fs.readFile(queuePath, "utf8");
    const secondRepair = await repairGrokQueueFromSessionSnapshots({
      cursors,
      queuePath,
      queueStatePath,
    });
    assert.equal(secondRepair, false);
    assert.equal(await fs.readFile(queuePath, "utf8"), queueAfterFirstRepair);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("records a no-op marker when there are no Grok rows", async () => {
    const dir = await makeTempDir();
    const queuePath = path.join(dir, "queue.jsonl");
    const cursors = {
      grok: {
        sessionSnapshots: {
          "grok-a": {
            totalTokens: 100,
            messageCount: 1,
            model: "grok-build",
            lastEventTimestamp: "2026-04-05T14:05:00.000Z",
          },
        },
      },
    };
    await fs.writeFile(
      queuePath,
      JSON.stringify({
        source: "codex",
        model: "gpt-5.5",
        hour_start: "2026-04-05T14:00:00.000Z",
        total_tokens: 123,
      }) + "\n",
      "utf8",
    );

    const repaired = await repairGrokQueueFromSessionSnapshots({ cursors, queuePath });
    assert.equal(repaired, false);
    assert.equal(cursors.grok.migrations[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY].status, "noop");
    assert.equal(cursors.grok.migrations[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY].existingGrokRows, 0);

    const rows = (await fs.readFile(queuePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "codex");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skips repair without snapshots and leaves queue/state untouched", async () => {
    const dir = await makeTempDir();
    const queuePath = path.join(dir, "queue.jsonl");
    const queueStatePath = path.join(dir, "queue.state.json");
    const cursors = { grok: { sessionSnapshots: {} } };
    const queueText =
      JSON.stringify({
        source: "grok",
        model: "grok-build",
        hour_start: "2026-04-05T14:00:00.000Z",
        total_tokens: 999,
      }) + "\n";
    const stateText = JSON.stringify({ offset: 4096, updatedAt: "2026-04-05T16:00:00.000Z" });
    await fs.writeFile(queuePath, queueText, "utf8");
    await fs.writeFile(queueStatePath, stateText, "utf8");

    const repaired = await repairGrokQueueFromSessionSnapshots({
      cursors,
      queuePath,
      queueStatePath,
    });
    assert.equal(repaired, false);
    assert.equal(await fs.readFile(queuePath, "utf8"), queueText);
    assert.equal(await fs.readFile(queueStatePath, "utf8"), stateText);
    assert.equal(
      cursors.grok.migrations[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY].status,
      "skipped",
    );
    assert.equal(
      cursors.grok.migrations[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY].reason,
      "missing-session-snapshots",
    );

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("regular sync preserves queue-only Codex, Every Code and Grok history without implicit repair", async () => {
    const dir = await makeTempDir();
    const originalHomedir = os.homedir;
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    const prevCodexHome = process.env.CODEX_HOME;
    const prevToken = process.env.TOKENTRACKER_DEVICE_TOKEN;
    const prevGrokHome = process.env.GROK_HOME;
    const prevTrackerGrokHome = process.env.TOKENTRACKER_GROK_HOME;
    try {
      process.env.HOME = dir;
      process.env.USERPROFILE = dir;
      process.env.CODEX_HOME = path.join(dir, ".codex");
      os.homedir = () => dir;
      delete process.env.TOKENTRACKER_DEVICE_TOKEN;
      delete process.env.GROK_HOME;
      process.env.TOKENTRACKER_GROK_HOME = path.join(dir, ".grok");
      const trackerDir = path.join(dir, ".tokentracker", "tracker");
      await fs.mkdir(trackerDir, { recursive: true });
      const queuePath = path.join(trackerDir, "queue.jsonl");
      const cursorsPath = path.join(trackerDir, "cursors.json");
      const queueText =
        JSON.stringify({
          source: "grok",
          model: "grok-build",
          hour_start: "2026-04-05T14:00:00.000Z",
          total_tokens: 999,
        }) + "\n" + ['codex','every-code'].map(source=>JSON.stringify({source,model:'gpt-5',hour_start:'2026-04-05T14:00:00.000Z',total_tokens:123})).join('\n') + '\n';
      await fs.writeFile(queuePath, queueText, "utf8");
      await fs.writeFile(path.join(trackerDir,'collection-status.json'),JSON.stringify({cursor:{status:'ok',last_successful_at:'2026-04-01T00:00:00Z'}}));
      await fs.writeFile(
        cursorsPath,
        JSON.stringify({
          version: 1,
          files: {},
          grok: {
            sessionSnapshots: {
              "grok-a": {
                totalTokens: 100,
                messageCount: 1,
                model: "grok-build",
                lastEventTimestamp: "2026-04-05T14:05:00.000Z",
              },
            },
          },
        }),
        "utf8",
      );

      await cmdSync(["--auto"]);

      const queueAfter = await fs.readFile(queuePath, "utf8");
      assert.equal(queueAfter, queueText);
      const health=JSON.parse(await fs.readFile(path.join(trackerDir,'collection-status.json'),'utf8'));
      assert.equal(health.cursor.status,'missing');assert.equal(health.cursor.last_successful_at,'2026-04-01T00:00:00Z');
      const cursorsAfter = JSON.parse(await fs.readFile(cursorsPath, "utf8"));
      assert.equal(
        cursorsAfter.grok.migrations?.[GROK_APPEND_ONLY_REPAIR_MIGRATION_KEY],
        undefined,
      );
    } finally {
      os.homedir = originalHomedir;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
      if (prevToken === undefined) delete process.env.TOKENTRACKER_DEVICE_TOKEN;
      else process.env.TOKENTRACKER_DEVICE_TOKEN = prevToken;
      if (prevGrokHome === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = prevGrokHome;
      if (prevTrackerGrokHome === undefined) delete process.env.TOKENTRACKER_GROK_HOME;
      else process.env.TOKENTRACKER_GROK_HOME = prevTrackerGrokHome;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
