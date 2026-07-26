const assert = require("node:assert/strict");
const { test } = require("node:test");
const { exportRows } = require("../src/lib/observability-export");
test("observability export redacts content, session identifiers, account scope, and CSV formulas", () => {
  const json = exportRows([{ hour_start: "2026-07-27T00:00:00Z", source: "codex", prompt: "secret", session_key: "session", project_key: "C:\\work\\private-project", dimensions: { session_key: "session", account_scope: "account", project_key: "C:\\work\\private-project" } }]);
  assert.equal(json.includes("secret"), false);
  assert.equal(json.includes('"session"'), false);
  assert.equal(json.includes("private-project"), true);
  const csv = exportRows([{ source: "=danger" }], { format: "csv" });
  assert.equal(csv.includes("'=danger"), true);
});
