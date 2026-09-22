const assert = require("node:assert/strict");
const { test } = require("node:test");
const { collectCursorAccountUsage } = require("../src/lib/cursor-config");

const csv = count => `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-09-22T00:00:00Z,gpt-5,${count},${count},0,0,${count},0\n`;
test("Cursor combines distinct accounts once and rejects a partial account fetch", async () => {
  let calls = 0;
  const options = { homes: ["a", "a-copy", "b"], isInstalled: () => true,
    readAuth: ({appDir}) => ({userId: appDir.startsWith("a") ? "a" : "b", cookie: appDir}),
    fetchCsv: async ({cookie}) => { calls++; return csv(cookie === "b" ? 200 : 100); } };
  const result = await collectCursorAccountUsage(options);
  assert.equal(calls, 2);
  assert.equal(result.records.reduce((sum, row) => sum + row.inputTokens, 0), 300);
  assert.equal(result.accountKeys.length, 2);
  await assert.rejects(collectCursorAccountUsage({...options, fetchCsv: async ({cookie}) => { if(cookie === "b") throw new Error("offline"); return csv(100); }}), /offline/);
  await assert.rejects(collectCursorAccountUsage({...options, homes:["a"],previousAccountKeys: result.accountKeys}), /account coverage/);
});
