"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  AGENT_ADAPTERS,
  getAgentAdapter,
  listAgentAdapters,
  listUsageLimitAdapterIds,
  listDataDirectoryAdapterKeys,
  listAccountLevelSources,
} = require("../src/lib/agent-adapters");

const { isAccountLevelSource } = require("../src/lib/source-metadata");
const { DATA_DIRECTORY_KEYS } = require("../src/lib/data-directories");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ["id", "displayName", "queueSource", "collectionMode"];

/** All source strings that sync.js parses (duplicates removed). */
const SYNC_SOURCES = [
  "codex",
  "every-code",
  "openclaw",
  "claude",
  "gemini",
  "antigravity",
  "opencode",
  "kilo-cli",
  "kilocode",
  "goose",
  "droid",
  "zed",
  "roocode",
  "cursor",
  "kiro",
  "hermes",
  "kiro-cli",
  "kimi",
  "kimi-code",
  "codebuddy",
  "omp",
  "pi",
  "craft",
  "grok",
  "copilot",
];

// ---------------------------------------------------------------------------
// Registry structure
// ---------------------------------------------------------------------------

test("AGENT_ADAPTERS is a non-empty array", () => {
  assert.ok(Array.isArray(AGENT_ADAPTERS), "AGENT_ADAPTERS must be an array");
  assert.ok(AGENT_ADAPTERS.length > 0, "AGENT_ADAPTERS must not be empty");
});

test("registry ids are unique", () => {
  const ids = AGENT_ADAPTERS.map((e) => e.id);
  const unique = new Set(ids);
  assert.equal(
    unique.size,
    ids.length,
    `Duplicate registry ids found: ${ids.filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id)).join(", ")}`,
  );
});

test("every entry has required fields: id, displayName, queueSource, collectionMode", () => {
  for (const entry of AGENT_ADAPTERS) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        field in entry && entry[field] != null && entry[field] !== "",
        `entry "${entry.id}" missing or empty field "${field}"`,
      );
    }
  }
});

test("all ids are lowercase strings", () => {
  for (const entry of AGENT_ADAPTERS) {
    assert.equal(
      entry.id,
      entry.id.toLowerCase(),
      `entry id "${entry.id}" must be lowercase`,
    );
  }
});

// ---------------------------------------------------------------------------
// getAgentAdapter
// ---------------------------------------------------------------------------

test("getAgentAdapter returns null for unknown id", () => {
  assert.equal(getAgentAdapter("nonexistent-source"), null);
  assert.equal(getAgentAdapter(""), null);
  assert.equal(getAgentAdapter(null), null);
});

test("getAgentAdapter is case-insensitive", () => {
  const lower = getAgentAdapter("codex");
  const mixed = getAgentAdapter("CodeX");
  const upper = getAgentAdapter("CODEX");
  assert.ok(lower, "getAgentAdapter('codex') must return an entry");
  assert.ok(mixed, "getAgentAdapter('CodeX') must return an entry");
  assert.ok(upper, "getAgentAdapter('CODEX') must return an entry");
  assert.equal(lower.id, "codex");
  assert.equal(mixed.id, "codex");
  assert.equal(upper.id, "codex");
});

test("getAgentAdapter returns a stable entry with all required fields", () => {
  const entry = getAgentAdapter("codex");
  assert.ok(entry, "getAgentAdapter('codex') must return an entry");
  for (const field of REQUIRED_FIELDS) {
    assert.ok(field in entry && entry[field] != null, `entry.codex missing field "${field}"`);
  }
});

// ---------------------------------------------------------------------------
// listAgentAdapters
// ---------------------------------------------------------------------------

test("listAgentAdapters returns a shallow copy array", () => {
  const listed = listAgentAdapters();
  assert.ok(Array.isArray(listed), "must return an array");
  assert.equal(listed.length, AGENT_ADAPTERS.length);
  // Mutation of the returned array must not affect the original
  listed.push({ id: "fake" });
  assert.equal(AGENT_ADAPTERS.length, listAgentAdapters().length);
});

test("listAgentAdapters resolverExports elements are copied (defensive)", () => {
  const listed = listAgentAdapters();
  const entry = listed.find((e) => e.id === "codex");
  assert.ok(entry, "codex must be in listAgentAdapters()");
  const before = entry.resolverExports.length;
  entry.resolverExports.push("fakeResolver");
  const again = listAgentAdapters().find((e) => e.id === "codex");
  assert.equal(again.resolverExports.length, before);
});

// ---------------------------------------------------------------------------
// listAccountLevelSources
// ---------------------------------------------------------------------------

test("listAccountLevelSources includes cursor", () => {
  const accountSources = listAccountLevelSources();
  assert.ok(accountSources.includes("cursor"), `cursor must be account-level; got: ${JSON.stringify(accountSources)}`);
});

test("listAccountLevelSources excludes codex and claude", () => {
  const accountSources = listAccountLevelSources();
  assert.ok(!accountSources.includes("codex"), "codex must NOT be account-level");
  assert.ok(!accountSources.includes("claude"), "claude must NOT be account-level");
});

test("cursor is identified as account-level by source-metadata", () => {
  assert.ok(isAccountLevelSource("cursor"), "cursor must be account-level per isAccountLevelSource");
  assert.ok(isAccountLevelSource("CURSOR"), "isAccountLevelSource must be case-insensitive");
});

test("codex and claude are NOT account-level per source-metadata", () => {
  assert.ok(!isAccountLevelSource("codex"), "codex must NOT be account-level");
  assert.ok(!isAccountLevelSource("claude"), "claude must NOT be account-level");
  assert.ok(!isAccountLevelSource("gemini"), "gemini must NOT be account-level");
});

// ---------------------------------------------------------------------------
// listDataDirectoryAdapterKeys + DATA_DIRECTORY_KEYS
// ---------------------------------------------------------------------------

test("listDataDirectoryAdapterKeys returns every configurable desktop source", () => {
  const keys = listDataDirectoryAdapterKeys();
  for (const key of ["claude", "codex", "cursor", "trae", "codebuddy", "gemini", "hermes", "openclaw", "opencode", "antigravity"]) {
    assert.ok(keys.includes(key), `${key} must be in path override keys; got: ${JSON.stringify(keys)}`);
  }
});

test("DATA_DIRECTORY_KEYS equals the registry-backed configurable directory keys", () => {
  const expected = ["claude", "codex", "cursor", "trae", "codebuddy", "gemini", "hermes", "openclaw", "opencode", "antigravity"];
  assert.deepEqual(
    DATA_DIRECTORY_KEYS.sort(),
    expected.sort(),
    `DATA_DIRECTORY_KEYS must expose configurable desktop sources. Got: ${JSON.stringify(DATA_DIRECTORY_KEYS.sort())}`,
  );
});

// ---------------------------------------------------------------------------
// listUsageLimitAdapterIds
// ---------------------------------------------------------------------------

test("listUsageLimitAdapterIds is a non-empty array", () => {
  const ids = listUsageLimitAdapterIds();
  assert.ok(Array.isArray(ids), "must return an array");
  assert.ok(ids.length > 0, "usage limits adapters must not be empty");
});

test("listUsageLimitAdapterIds matches the supported limits display sources", () => {
  const ids = listUsageLimitAdapterIds();
  assert.deepEqual(ids, [
    "claude",
    "codex",
    "cursor",
    "trae",
    "gemini",
    "hermes",
    "openclaw",
    "opencode",
    "antigravity",
  ]);
});

// ---------------------------------------------------------------------------
// sync.js source parity
// ---------------------------------------------------------------------------

test("every source in sync.js has a registry entry", () => {
  const missing = [];
  for (const source of SYNC_SOURCES) {
    if (!getAgentAdapter(source)) {
      missing.push(source);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `The following sync.js sources are not in the registry: ${missing.join(", ")}. ` +
      "Add them to src/lib/agent-adapters.js per the agent-adapter-spec.md checklist.",
  );
});
