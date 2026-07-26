"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  mapQueueRowToUsageSnapshot,
  attachDimensionsToQueueRow,
  resolveEnqueueDimensionsContext,
} = require("../src/lib/queue-usage-snapshot");
const { buildHourlyBucketKey } = require("../src/lib/usage-dimension-key");
const { attributeUsage } = require("../src/lib/usage-attribution");

describe("queue-usage-snapshot", () => {
  describe("mapQueueRowToUsageSnapshot", () => {
    it("maps legacy rows into the unknown environment bucket", () => {
      const snapshot = mapQueueRowToUsageSnapshot({
        hour_start: "2026-07-26T00:00:00.000Z",
        source: "claude",
        model: "claude-opus-4-6",
        input_tokens: 10,
        output_tokens: 5,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 15,
        conversation_count: 1,
      });
      assert.equal(snapshot.dimensions.device_id, "unknown");
      assert.equal(snapshot.dimensions.environment_id, "unknown");
      assert.equal(snapshot.dimensions.environment_kind, "unknown");
      assert.equal(snapshot.dimensions.agent_id, "claude");
      assert.equal(snapshot.dimensions.model_id, "claude-opus-4-6");
      assert.equal(snapshot.tokens.total_tokens, 15);
    });

    it("prefers an attached dimensions object over legacy defaults", () => {
      const snapshot = mapQueueRowToUsageSnapshot({
        hour_start: "2026-07-26T00:00:00.000Z",
        source: "claude",
        model: "claude-opus-4-6",
        total_tokens: 20,
        dimensions: {
          device_id: "device-a",
          environment_id: "wsl:ubuntu",
          environment_kind: "wsl",
          agent_id: "claude",
          account_scope: null,
          project_key: "c:\\app",
          session_key: "session-1",
          model_id: "claude-opus-4-6",
        },
      });
      assert.equal(snapshot.dimensions.environment_kind, "wsl");
      assert.equal(snapshot.dimensions.environment_id, "wsl:ubuntu");
      assert.equal(snapshot.dimensions.session_key, "session-1");
    });

    it("carries project_key from project.queue rows without dimensions", () => {
      const snapshot = mapQueueRowToUsageSnapshot({
        hour_start: "2026-07-26T00:00:00.000Z",
        source: "codex",
        model: "gpt-5",
        project_key: "C:\\Users\\Admin\\App",
        total_tokens: 9,
      });
      assert.equal(snapshot.dimensions.project_key, "c:\\users\\admin\\app");
      assert.equal(snapshot.dimensions.environment_kind, "unknown");
    });
  });

  describe("attachDimensionsToQueueRow", () => {
    it("adds dimensions without rewriting legacy fields", () => {
      const row = {
        source: "claude",
        model: "claude-opus-4-6",
        hour_start: "2026-07-26T00:00:00.000Z",
        total_tokens: 12,
      };
      const enriched = attachDimensionsToQueueRow(
        row,
        {
          machineId: "stable-device",
          environment: { kind: "native", id: "native:host-a" },
        },
      );
      assert.equal(enriched.source, "claude");
      assert.equal(enriched.model, "claude-opus-4-6");
      assert.equal(enriched.dimensions.device_id, "stable-device");
      assert.equal(enriched.dimensions.environment_kind, "native");
      assert.equal(enriched.dimensions.agent_id, "claude");
      assert.equal(row.dimensions, undefined);
    });

    it("keeps session_key out of the hourly bucket key", () => {
      const base = {
        source: "claude",
        model: "claude-opus-4-6",
        hour_start: "2026-07-26T00:00:00.000Z",
        total_tokens: 12,
      };
      const a = attachDimensionsToQueueRow(
        base,
        {
          machineId: "stable-device",
          environment: { kind: "native", id: "native:host-a" },
        },
        { sessionId: "session-a" },
      );
      const b = attachDimensionsToQueueRow(
        base,
        {
          machineId: "stable-device",
          environment: { kind: "native", id: "native:host-a" },
        },
        { sessionId: "session-b" },
      );
      assert.equal(
        buildHourlyBucketKey(mapQueueRowToUsageSnapshot(a)),
        buildHourlyBucketKey(mapQueueRowToUsageSnapshot(b)),
      );
      assert.notEqual(a.dimensions.session_key, b.dimensions.session_key);
    });
  });

  describe("same-hour two-environment non-collision via enriched rows", () => {
    it("does not let native and wsl snapshots overwrite each other", () => {
      const hour = "2026-07-26T00:00:00.000Z";
      const native = mapQueueRowToUsageSnapshot(
        attachDimensionsToQueueRow(
          {
            source: "claude",
            model: "claude-opus-4-6",
            hour_start: hour,
            total_tokens: 100,
            input_tokens: 60,
            output_tokens: 40,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 0,
            conversation_count: 1,
          },
          {
            machineId: "device-a",
            environment: { kind: "native", id: "native:host-a" },
          },
        ),
      );
      const wsl = mapQueueRowToUsageSnapshot(
        attachDimensionsToQueueRow(
          {
            source: "codex",
            model: "gpt-5",
            hour_start: hour,
            total_tokens: 50,
            input_tokens: 30,
            output_tokens: 20,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 0,
            conversation_count: 1,
          },
          {
            machineId: "device-a",
            environment: { kind: "wsl", id: "wsl:ubuntu" },
          },
        ),
      );

      assert.notEqual(buildHourlyBucketKey(native), buildHourlyBucketKey(wsl));
      const result = attributeUsage([native, wsl], { groupBy: "environment" });
      assert.equal(result.total_tokens, 150);
      assert.equal(result.groups.length, 2);
    });
  });

  describe("resolveEnqueueDimensionsContext", () => {
    it("uses injected machine id and environment", () => {
      const ctx = resolveEnqueueDimensionsContext({
        machineId: "injected",
        environment: { kind: "ssh", id: "ssh:host-b" },
      });
      assert.equal(ctx.machineId, "injected");
      assert.equal(ctx.environment.kind, "ssh");
    });

    it("falls back through getMachineId when machineId is omitted", () => {
      const ctx = resolveEnqueueDimensionsContext({
        queuePath: "/tmp/queue.jsonl",
        getMachineId: () => "from-getter",
        environment: { kind: "native", id: "native:host" },
      });
      assert.equal(ctx.machineId, "from-getter");
    });
  });
});
