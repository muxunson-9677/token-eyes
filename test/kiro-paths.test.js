const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { resolveKiroDbPath, resolveKiroJsonlPath } = require("../src/lib/rollout");

test("Kiro IDE resolves Windows APPDATA and explicit Chinese/space storage paths", () => {
  const options = { platform: "win32", home: "C:/users/test", env: { APPDATA: "C:/users/test/AppData/Roaming" } };
  assert.equal(resolveKiroDbPath(options), path.join(options.env.APPDATA, "Kiro/User/globalStorage/kiro.kiroagent/dev_data/devdata.sqlite"));
  assert.equal(resolveKiroJsonlPath({ ...options, basePath: "D:/项目/自定义 Kiro" }), path.join("D:/项目/自定义 Kiro/dev_data/tokens_generated.jsonl"));
});
