"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  attributeUsage,
  computeUnattributedDelta,
  sumTokenTotals,
  GROUP_BY_FIELDS,
} = require("../src/lib/usage-attribution");

const FIXTURES_DIR = path.join(__dirname, "fixtures", "token-observability-v2");
const SNAPSHOTS = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "attribution-snapshots.json"), "utf8"),
).snapshots;

// Fixture totals (must match attribution-snapshots.json):
//   device-a/native:host-a/claude/claude-opus-4-6: 185 + 45 = 230
//   device-a/wsl:ubuntu/codex/gpt-5:              120
//   device-b/ssh:host-b/claude/claude-sonnet-4-5:  80
//   unknown/unknown/codex/gpt-5:                    30
// Total: 460
const EXPECTED_TOTAL = 460;

describe("usage-attribution", () => {
  describe("sumTokenTotals", () => {
    it("sums every token field across snapshots without rounding", () => {
      const totals = sumTokenTotals(SNAPSHOTS);
      assert.equal(totals.total_tokens, EXPECTED_TOTAL);
      assert.equal(totals.input_tokens, 280);
      assert.equal(totals.output_tokens, 140);
      assert.equal(totals.cached_input_tokens, 15);
      assert.equal(totals.cache_creation_input_tokens, 5);
      assert.equal(totals.reasoning_output_tokens, 20);
      assert.equal(totals.conversation_count, 6);
    });

    it("returns zeros for empty input", () => {
      const totals = sumTokenTotals([]);
      assert.equal(totals.total_tokens, 0);
      assert.equal(totals.conversation_count, 0);
    });
  });

  describe("attributeUsage invariants", () => {
    it("exposes the supported group-by fields", () => {
      assert.deepEqual(GROUP_BY_FIELDS, ["device", "environment", "agent", "project", "model"]);
    });

    it("sum of all agent groups equals the unfiltered total", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "agent" });
      const groupSum = result.groups.reduce(
        (acc, g) => acc + g.tokens.total_tokens,
        0,
      );
      assert.equal(groupSum, result.total_tokens);
      assert.equal(result.total_tokens, EXPECTED_TOTAL);
    });

    it("sum of all environment groups equals the unfiltered total", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "environment" });
      const groupSum = result.groups.reduce(
        (acc, g) => acc + g.tokens.total_tokens,
        0,
      );
      assert.equal(groupSum, result.total_tokens);
    });

    it("sum of all device groups equals the unfiltered total", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "device" });
      const groupSum = result.groups.reduce(
        (acc, g) => acc + g.tokens.total_tokens,
        0,
      );
      assert.equal(groupSum, result.total_tokens);
    });

    it("sum of environments within a device filter equals the device total", () => {
      const deviceResult = attributeUsage(SNAPSHOTS, {
        groupBy: "device",
        filter: { device_id: "device-a" },
      });
      const deviceTotal = deviceResult.total_tokens;

      const envResult = attributeUsage(SNAPSHOTS, {
        groupBy: "environment",
        filter: { device_id: "device-a" },
      });
      const envSum = envResult.groups.reduce(
        (acc, g) => acc + g.tokens.total_tokens,
        0,
      );

      assert.equal(envSum, deviceTotal);
      // device-a has both native:host-a (230) and wsl:ubuntu (120) -> 350
      assert.equal(deviceTotal, 350);
    });

    it("sum of agents within an environment filter equals the environment total", () => {
      const envResult = attributeUsage(SNAPSHOTS, {
        groupBy: "environment",
        filter: { device_id: "device-a" },
      });

      for (const envGroup of envResult.groups) {
        const agentResult = attributeUsage(SNAPSHOTS, {
          groupBy: "agent",
          filter: {
            device_id: "device-a",
            environment_id: envGroup.dimensions.environment_id,
          },
        });
        assert.equal(agentResult.total_tokens, envGroup.tokens.total_tokens);
      }
    });

    it("returns stable group order keyed by stable dimension value", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "agent" });
      assert.deepEqual(
        result.groups.map((g) => g.dimensions.agent_id).sort(),
        ["claude", "codex"],
      );
    });
  });

  describe("attributeUsage grouping correctness", () => {
    it("groups by agent and includes the canonical token fields", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "agent" });
      const claude = result.groups.find((g) => g.dimensions.agent_id === "claude");
      const codex = result.groups.find((g) => g.dimensions.agent_id === "codex");

      // claude: 185 (native hour 0) + 45 (native hour 1) + 80 (ssh) = 310
      assert.equal(claude.tokens.total_tokens, 310);
      // codex: 120 (wsl) + 30 (unknown) = 150
      assert.equal(codex.tokens.total_tokens, 150);
    });

    it("groups by environment with kind metadata", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "environment" });
      const native = result.groups.find((g) => g.dimensions.environment_kind === "native");
      const wsl = result.groups.find((g) => g.dimensions.environment_kind === "wsl");
      const unknown = result.groups.find((g) => g.dimensions.environment_kind === "unknown");

      assert.equal(native.tokens.total_tokens, 230);
      assert.equal(wsl.tokens.total_tokens, 120);
      assert.ok(unknown);
      assert.equal(unknown.tokens.total_tokens, 30);
    });

    it("groups by model", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "model" });
      const gpt5 = result.groups.find((g) => g.dimensions.model_id === "gpt-5");
      assert.equal(gpt5.tokens.total_tokens, 150);
    });

    it("groups unknown/null project_key under a stable bucket", () => {
      const result = attributeUsage(SNAPSHOTS, { groupBy: "project" });
      const unknownProject = result.groups.find((g) => g.dimensions.project_key === null);
      assert.equal(unknownProject.tokens.total_tokens, 30);
    });
  });

  describe("attributeUsage filter application", () => {
    it("applies the filter before grouping", () => {
      const result = attributeUsage(SNAPSHOTS, {
        groupBy: "agent",
        filter: { device_id: "device-a" },
      });
      const groupSum = result.groups.reduce(
        (acc, g) => acc + g.tokens.total_tokens,
        0,
      );
      assert.equal(groupSum, 350);
    });

    it("returns an empty groups array when filter matches nothing", () => {
      const result = attributeUsage(SNAPSHOTS, {
        groupBy: "agent",
        filter: { device_id: "nope" },
      });
      assert.equal(result.groups.length, 0);
      assert.equal(result.total_tokens, 0);
    });
  });

  describe("same-hour two-environment non-collision", () => {
    it("keeps native and wsl buckets distinct within the same hour", () => {
      // Both fixtures share hour_start = 2026-07-26T00:00:00.000Z but live in
      // different environments. They must NOT collapse into one bucket.
      const result = attributeUsage(
        SNAPSHOTS.filter((s) => s.hour_start === "2026-07-26T00:00:00.000Z"),
        { groupBy: "environment" },
      );
      const envIds = result.groups.map((g) => g.dimensions.environment_id).sort();
      assert.deepEqual(envIds, ["native:host-a", "ssh:host-b", "wsl:ubuntu"]);
    });
  });

  describe("legacy unknown bucket does not change total", () => {
    it("keeps the unknown row inside the total without inflating", () => {
      const known = SNAPSHOTS.filter(
        (s) => s.dimensions.environment_kind !== "unknown",
      );
      const unknown = SNAPSHOTS.filter(
        (s) => s.dimensions.environment_kind === "unknown",
      );

      const knownTotal = sumTokenTotals(known).total_tokens;
      const unknownTotal = sumTokenTotals(unknown).total_tokens;

      assert.equal(knownTotal + unknownTotal, EXPECTED_TOTAL);
    });
  });

  describe("computeUnattributedDelta", () => {
    it("returns the official delta minus the locally observed total", () => {
      const result = computeUnattributedDelta({
        officialDeltaTokens: 100,
        attributedTotalTokens: 70,
      });
      assert.equal(result.unattributed_tokens, 30);
      assert.equal(result.evidence.source_kind, "estimated");
      assert.equal(result.evidence.accuracy, "estimated");
      assert.equal(result.evidence.coverage, "partial");
    });

    it("clamps to zero when local attribution exceeds official delta", () => {
      const result = computeUnattributedDelta({
        officialDeltaTokens: 70,
        attributedTotalTokens: 100,
      });
      assert.equal(result.unattributed_tokens, 0);
      assert.equal(result.evidence.note_code, "local_exceeds_official");
    });

    it("returns the full delta when nothing is attributed", () => {
      const result = computeUnattributedDelta({
        officialDeltaTokens: 100,
        attributedTotalTokens: 0,
      });
      assert.equal(result.unattributed_tokens, 100);
      assert.equal(result.evidence.note_code, "no_local_attribution");
    });

    it("treats null official delta as zero attribution difference", () => {
      const result = computeUnattributedDelta({
        officialDeltaTokens: null,
        attributedTotalTokens: 50,
      });
      assert.equal(result.unattributed_tokens, 0);
      assert.equal(result.evidence.note_code, "official_unavailable");
      assert.equal(result.evidence.coverage, "unavailable");
    });

    it("rejects negative or non-integer inputs", () => {
      assert.throws(
        () =>
          computeUnattributedDelta({
            officialDeltaTokens: -10,
            attributedTotalTokens: 0,
          }),
        /officialDeltaTokens/,
      );
      assert.throws(
        () =>
          computeUnattributedDelta({
            officialDeltaTokens: 10,
            attributedTotalTokens: -5,
          }),
        /attributedTotalTokens/,
      );
    });
  });
});
