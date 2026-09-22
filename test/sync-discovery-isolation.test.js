const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { cmdSync } = require("../src/commands/sync");
const { listDataDirectoryAdapterKeys } = require("../src/lib/agent-adapters");
const { readQueueData } = require("../src/lib/local-api");

for (const source of ["codex", "every-code", "claude", "gemini", "openclaw", "opencode", "deepseek-harness"]) {
  test(`sync isolates ${source} discovery errors and preserves independent usage across recovery`, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-discovery-sync-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const tracker = path.join(dir, ".tokentracker", "tracker");
    await fs.mkdir(tracker, { recursive: true });
    const dataDirectories = Object.fromEntries(listDataDirectoryAdapterKeys().map(key => [key, path.join(dir, "sources", key)]));
    const extra = { CODE_HOME: path.join(dir, "sources", "every-code"), TOKENTRACKER_DSH_HOME: path.join(dir, "sources", "deepseek-harness") };
    const previousEnv = Object.fromEntries(Object.keys(extra).map(key => [key, process.env[key]]));
    Object.assign(process.env, extra);
    t.after(() => { for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    await fs.writeFile(path.join(tracker, "config.json"), JSON.stringify({ dataDirectories, uploadEnabled: false }));
    const oldQueue = JSON.stringify({ source: "codex", model: "gpt-5", hour_start: "2026-09-22T00:00:00Z", input_tokens: 100, total_tokens: 100 }) + "\n";
    const queue = path.join(tracker, "queue.jsonl");
    await fs.writeFile(queue, oldQueue);
    await fs.writeFile(path.join(tracker, "collection-status.json"), JSON.stringify({ [source]: { status: "ok", last_successful_at: "previous" } }));
    const blockedRoot = dataDirectories[source] || extra[source === "every-code" ? "CODE_HOME" : "TOKENTRACKER_DSH_HOME"];
    // An unaffected source on either side of OpenCode in the real sync sequence.
    const independent = source === "opencode" ? "claude" : "opencode";
    const file = independent === "claude"
      ? path.join(dataDirectories.claude, "projects", "fixture", "session.jsonl")
      : path.join(dataDirectories.opencode, "storage", "message", "session", "msg_independent.json");
    const record = independent === "claude"
      ? { type: "assistant", timestamp: "2026-09-22T01:00:00Z", message: { id: "independent", model: "fixture", usage: { input_tokens: 25, output_tokens: 0 } } }
      : { id: "independent", sessionID: "s", modelID: "fixture", time: { created: Date.parse("2026-09-22T01:00:00Z") }, tokens: { input: 25, output: 0 } };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(record) + "\n");
    const homedir = os.homedir, readdir = fs.readdir;
    os.homedir = () => dir;
    let blocked = true, failureReads = 0;
    fs.readdir = async (target, ...args) => {
      if (blocked && String(target).startsWith(blockedRoot + path.sep)) {
        failureReads++;
        throw Object.assign(new Error("isolated discovery failure"), { code: "EACCES" });
      }
      return readdir(target, ...args);
    };
    try {
      await cmdSync(["--auto"]);
      assert.ok(failureReads > 0, "the actual source discovery path must be exercised");
      const health = JSON.parse(await fs.readFile(path.join(tracker, "collection-status.json"), "utf8"));
      assert.equal(health[source].status, "error");
      assert.equal(health[source].error_code, "EACCES");
      assert.equal(health[source].last_successful_at, "previous");
      assert.equal(health.tracker, undefined);
      assert.equal(readQueueData(queue).filter(row => row.source === independent).reduce((sum, row) => sum + row.total_tokens, 0), 25);
      const afterFailure = await fs.readFile(queue, "utf8");
      assert.ok(afterFailure.startsWith(oldQueue));
      blocked = false;
      const recoveredFile = {
        codex: path.join(blockedRoot, "sessions", "2026", "09", "22", "rollout-recovered.jsonl"),
        "every-code": path.join(blockedRoot, "sessions", "2026", "09", "22", "rollout-recovered.jsonl"),
        claude: path.join(blockedRoot, "projects", "fixture", "session.jsonl"),
        gemini: path.join(blockedRoot, "tmp", "fixture", "chats", "session-recovered.json"),
        openclaw: path.join(blockedRoot, "agents", "fixture", "sessions", "session.jsonl"),
        opencode: path.join(blockedRoot, "storage", "message", "session", "msg_recovered.json"),
        "deepseek-harness": path.join(blockedRoot, "sessions", "fixture", "session.jsonl"),
      }[source];
      const timestamp = "2026-09-22T02:00:00Z";
      const usage = { input_tokens: 40, output_tokens: 0, total_tokens: 40 };
      const recoveredRecord = {
        codex: { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
        "every-code": { type: "event_msg", timestamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
        claude: { type: "assistant", timestamp, message: { id: "recovered", model: "fixture", usage } },
        gemini: { sessionId: "recovered", messages: [{ id: "message", type: "gemini", timestamp, model: "fixture", tokens: { input: 40, output: 0, total: 40 } }] },
        openclaw: { type: "message", timestamp, message: { role: "assistant", id: "recovered", model: "fixture", usage: { input: 40, output: 0, totalTokens: 40 } } },
        opencode: { id: "recovered", sessionID: "s", modelID: "fixture", time: { created: Date.parse(timestamp) }, tokens: { input: 40, output: 0 } },
        "deepseek-harness": { type: "assistant/message", time: timestamp, data: { turn: 1, step: 1, usage: { inputTokens: 40 } } },
      }[source];
      await fs.mkdir(path.dirname(recoveredFile), { recursive: true });
      await fs.writeFile(recoveredFile, JSON.stringify(recoveredRecord) + "\n");
      await cmdSync(["--auto"]);
      const recoveredQueue = await fs.readFile(queue, "utf8");
      assert.ok(recoveredQueue.startsWith(afterFailure));
      assert.equal(readQueueData(queue).filter(row => row.source === source).reduce((sum, row) => sum + row.total_tokens, 0), source === "codex" ? 140 : 40);
      await cmdSync(["--auto"]);
      const recovered = JSON.parse(await fs.readFile(path.join(tracker, "collection-status.json"), "utf8"));
      assert.equal(recovered[source].status, "ok");
      assert.notEqual(recovered[source].last_successful_at, "previous");
      assert.equal(await fs.readFile(queue, "utf8"), recoveredQueue);
    } finally { os.homedir = homedir; fs.readdir = readdir; }
  });
}
