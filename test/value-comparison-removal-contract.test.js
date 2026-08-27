const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("VC-01 removes the value comparison page, view model, API, and navigation surface", () => {
  for (const relativePath of [
    "dashboard/src/pages/ValueComparisonPage.jsx",
    "dashboard/src/pages/ValueComparisonPage.test.jsx",
    "src/lib/value-comparison-view-model.js",
    "test/value-comparison-view-model.test.js",
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false, `${relativePath} must be deleted`);
  }

  const app = read("dashboard/src/App.jsx");
  assert.doesNotMatch(app, /ValueComparisonPage/u);
  assert.match(app, /isSpendValueComparisonPath[\s\S]*Navigate to="\/spend\/usage" replace/u);

  const sidebar = read("dashboard/src/ui/components/Sidebar.jsx");
  assert.doesNotMatch(sidebar, /spend-value-comparison|nav\.spend\.value_comparison/u);

  const dashboardApi = read("dashboard/src/lib/api.ts");
  assert.doesNotMatch(dashboardApi, /tokentracker-value-comparison|getValueComparison|peekValueComparison|valueComparisonCache/u);
  assert.match(dashboardApi, /tokentracker-realtime-sessions|getRealtimeSessions|peekRealtimeSessions/u);

  const localApi = read("src/lib/local-api.js");
  assert.doesNotMatch(localApi, /value-comparison-view-model|tokentracker-value-comparison|value_comparison_v1|value_comparison_unavailable/u);
  assert.match(localApi, /realtime-session-view-model|tokentracker-realtime-sessions|realtime_sessions_v1/u);

  const stylesheet = read("dashboard/src/pages/value-realtime-pages.css");
  assert.doesNotMatch(stylesheet, /\.vr-page--value|\.vr-value-(?:flow|card|icon|label|number|caption|meta|state|badge)/u);
  assert.match(stylesheet, /\.vr-page--realtime|\.rt-focus|\.vr-evidence-details/u);
});

test("VC-01 removes page-only copy while preserving realtime copy and shared evidence helpers", () => {
  const copy = read("dashboard/src/content/copy.csv");
  assert.doesNotMatch(copy, /^nav\.spend\.value_comparison,/mu);
  assert.doesNotMatch(copy, /^value\./mu);
  assert.match(copy, /^nav\.spend\.realtime_sessions,/mu);
  assert.match(copy, /^value_realtime\./mu);

  const realtimePage = read("dashboard/src/pages/RealtimeSessionsPage.jsx");
  assert.match(realtimePage, /ValueRealtimeEvidence/u);
  assert.match(realtimePage, /getRealtimeSessions/u);
});
