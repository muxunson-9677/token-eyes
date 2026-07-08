const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { parseTraeIncremental } = require("../src/lib/rollout");

test("parseTraeIncremental ingests token_usage.jsonl into queue source=trae", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tokentracker-trae-parse-"));
  try {
    const traeRoot = path.join(tmp, "Trae CN");
    const agentDir = path.join(traeRoot, "ModularData", "ai-agent");
    await fs.promises.mkdir(agentDir, { recursive: true });
    const jsonl = path.join(agentDir, "token_usage.jsonl");
    await fs.promises.writeFile(
      jsonl,
      [
        JSON.stringify({
          id: "turn-1",
          created_at: "2026-07-06T10:00:00.000Z",
          context: {
            token_usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              cache_read_input_tokens: 5,
            },
            persist_user_message_context: { model_info: { config_name: "kimi-k2.5" } },
          },
        }),
        JSON.stringify({
          id: "turn-2",
          created_at: "2026-07-06T10:15:00.000Z",
          context: {
            token_usage: {
              prompt_tokens: 50,
              completion_tokens: 10,
            },
            persist_user_message_context: { model_info: { config_name: "kimi-k2.5" } },
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1, files: {}, hourly: { groups: {} } };
    const result = await parseTraeIncremental({
      traeRoots: [traeRoot],
      cursors,
      queuePath,
    });

    assert.equal(result.recordsProcessed, 2);
    assert.ok(result.bucketsQueued >= 1);

    const queueRaw = await fs.promises.readFile(queuePath, "utf8");
    const rows = queueRaw.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(rows.every((row) => row.source === "trae"));
    const total = rows.reduce((sum, row) => sum + row.total_tokens, 0);
    assert.equal(total, 100 + 20 + 5 + 50 + 10);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
