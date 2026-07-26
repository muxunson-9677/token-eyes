"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const pkg = require("../package.json");

test("ci:local fail-closed gate covers every current product layer", () => {
  const script = pkg.scripts["ci:local"];
  const required = [
    "npm test",
    "dashboard run typecheck",
    "dashboard run lint",
    "dashboard test",
    "dashboard run build",
    "cargo test --manifest-path src-tauri/Cargo.toml --lib",
    "cargo test --manifest-path src-tauri/Cargo.toml --test current_product",
    "validate:copy",
    "validate:ui-hardcode",
    "validate:guardrails",
    "providers:check",
    "audit:tokens:fixture",
  ];
  for (const command of required) {
    assert.ok(script.includes(command), `ci:local is missing: ${command}`);
  }
  assert.ok(script.includes(" && "), "ci:local must use fail-closed command chaining");
});

test("fixture audit never falls back to a real user home queue", () => {
  const script = pkg.scripts["audit:tokens:fixture"];
  assert.match(script, /--strict/);
  assert.match(script, /--input test\/fixtures\/token-audit\/queue\.jsonl/);
});