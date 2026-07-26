"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHourlyBucketKey,
  buildDimensionGroupKey,
  filterByDimensions,
  GROUP_BY_FIELDS,
} = require("../src/lib/usage-dimension-key");

const SNAPSHOT_NATIVE_CLAUDE = {
  schema_version: "token-observability/v2",
  hour_start: "2026-07-26T00:00:00.000Z",
  dimensions: {
    device_id: "device-a",
    environment_id: "native:host-a",
    environment_kind: "native",
    agent_id: "claude",
    account_scope: null,
    project_key: "c:\\app",
    session_key: "session-1",
    model_id: "claude-opus-4-6",
  },
  tokens: { total_tokens: 100 },
};

const SNAPSHOT_WSL_CODEX = {
  ...SNAPSHOT_NATIVE_CLAUDE,
  dimensions: {
    ...SNAPSHOT_NATIVE_CLAUDE.dimensions,
    device_id: "device-a",
    environment_id: "wsl:ubuntu",
    environment_kind: "wsl",
    agent_id: "codex",
    project_key: "/home/user/app",
    session_key: "session-2",
    model_id: "gpt-5",
  },
};

describe("usage-dimension-key", () => {
  describe("buildHourlyBucketKey (re-exported from O0 contract)", () => {
    it("excludes session_key from the bucket key", () => {
      const withSession = {
        ...SNAPSHOT_NATIVE_CLAUDE,
        dimensions: { ...SNAPSHOT_NATIVE_CLAUDE.dimensions, session_key: "session-a" },
      };
      const otherSession = {
        ...SNAPSHOT_NATIVE_CLAUDE,
        dimensions: { ...SNAPSHOT_NATIVE_CLAUDE.dimensions, session_key: "session-b" },
      };
      assert.equal(
        buildHourlyBucketKey(withSession),
        buildHourlyBucketKey(otherSession),
      );
    });

    it("distinguishes snapshots by environment_id", () => {
      assert.notEqual(
        buildHourlyBucketKey(SNAPSHOT_NATIVE_CLAUDE),
        buildHourlyBucketKey(SNAPSHOT_WSL_CODEX),
      );
    });
  });

  describe("buildDimensionGroupKey", () => {
    it("groups by device_id", () => {
      assert.equal(
        buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "device"),
        "device-a",
      );
    });

    it("groups by environment_id", () => {
      assert.equal(
        buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "environment"),
        "native:host-a",
      );
    });

    it("groups by agent_id", () => {
      assert.equal(
        buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "agent"),
        "claude",
      );
    });

    it("groups by project_key", () => {
      assert.equal(
        buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "project"),
        "c:\\app",
      );
    });

    it("groups by model_id", () => {
      assert.equal(
        buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "model"),
        "claude-opus-4-6",
      );
    });

    it("returns null project as a stable 'unknown' bucket", () => {
      const dims = { ...SNAPSHOT_NATIVE_CLAUDE.dimensions, project_key: null };
      assert.equal(buildDimensionGroupKey(dims, "project"), "__unknown__");
    });

    it("returns null model_id as a stable 'unknown' bucket", () => {
      const dims = { ...SNAPSHOT_NATIVE_CLAUDE.dimensions, model_id: null };
      assert.equal(buildDimensionGroupKey(dims, "model"), "__unknown__");
    });

    it("exposes the supported group-by fields", () => {
      assert.deepEqual(GROUP_BY_FIELDS, ["device", "environment", "agent", "project", "model"]);
    });

    it("throws on unsupported group-by", () => {
      assert.throws(
        () => buildDimensionGroupKey(SNAPSHOT_NATIVE_CLAUDE.dimensions, "session"),
        /unsupported group-by/i,
      );
    });
  });

  describe("filterByDimensions", () => {
    const snapshots = [SNAPSHOT_NATIVE_CLAUDE, SNAPSHOT_WSL_CODEX];

    it("returns all snapshots when filter is empty", () => {
      assert.equal(filterByDimensions(snapshots, {}).length, 2);
    });

    it("filters by agent_id", () => {
      const filtered = filterByDimensions(snapshots, { agent_id: "claude" });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].dimensions.agent_id, "claude");
    });

    it("filters by environment_id", () => {
      const filtered = filterByDimensions(snapshots, { environment_id: "wsl:ubuntu" });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].dimensions.environment_id, "wsl:ubuntu");
    });

    it("filters by device_id", () => {
      const filtered = filterByDimensions(snapshots, { device_id: "device-a" });
      assert.equal(filtered.length, 2);
    });

    it("filters by model_id", () => {
      const filtered = filterByDimensions(snapshots, { model_id: "gpt-5" });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].dimensions.model_id, "gpt-5");
    });

    it("combines multiple filters with AND", () => {
      const filtered = filterByDimensions(snapshots, {
        device_id: "device-a",
        agent_id: "codex",
      });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].dimensions.agent_id, "codex");
    });

    it("returns empty array when no snapshot matches", () => {
      const filtered = filterByDimensions(snapshots, { agent_id: "nonexistent" });
      assert.equal(filtered.length, 0);
    });

    it("does not filter by session_key (privacy + dedup invariant)", () => {
      const filtered = filterByDimensions(snapshots, { session_key: "session-1" });
      assert.equal(filtered.length, 2);
    });
  });
});
