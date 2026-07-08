"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  parseCodexUsageBody,
  CodexTokenPlanError,
  mapCodexErrorCode,
} = require("../src/lib/codex-token-plan");

const whamPayload = {
  rate_limit: {
    primary_window: {
      used_percent: 30,
      limit_window_seconds: 18000,
      reset_at: 1_700_000_000,
    },
    secondary_window: {
      used_percent: 55,
      limit_window_seconds: 604800,
      reset_at: "2026-07-10T00:00:00.000Z",
    },
  },
};

test("parseCodexUsageBody returns 5-hour and weekly percent windows", () => {
  const result = parseCodexUsageBody(whamPayload);
  assert.equal(result.quota_windows.length, 2);
  assert.equal(result.quota_windows[0].kind, "rolling_5_hour");
  assert.equal(result.quota_windows[0].used, 30);
  assert.equal(result.quota_windows[1].kind, "rolling_weekly");
  assert.equal(result.quota_windows[1].used, 55);
  assert.equal(result.remaining_quota, 45);
});

test("parseCodexUsageBody rejects missing windows", () => {
  assert.throws(
    () => parseCodexUsageBody({ rate_limit: {} }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_NO_QUOTA_WINDOWS",
  );
});

test("mapCodexErrorCode maps Codex errors to sync statuses", () => {
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_REAUTH_REQUIRED", "x")), "reauth_required");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_CONSOLE_SYNC_REQUIRED", "x")), "not_configured");
  assert.equal(mapCodexErrorCode(new CodexTokenPlanError("CODEX_NO_QUOTA_WINDOWS", "x")), "unsupported");
});

test("codex provider adapter skips CLI when official_account detection is configured", async () => {
  const { createCodexProviderAdapter } = require("../src/lib/codex-token-plan");
  const adapter = createCodexProviderAdapter();
  await assert.rejects(
    () => adapter({ detection_method: "official_account", provider_id: "codex" }),
    (error) => error instanceof CodexTokenPlanError && error.code === "CODEX_CONSOLE_SYNC_REQUIRED",
  );
});
