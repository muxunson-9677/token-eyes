/**
 * H04 Rework — Verify that createLocalApiHandler() exposes the token plan
 * scheduler hooks so that serve.js can call startTokenPlanScheduler /
 * stopTokenPlanScheduler / runTokenPlanDueRefresh without a TypeError.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createLocalApiHandler } = require("../src/lib/local-api");

describe("serve startup token plan scheduler hooks", () => {
  let handler;

  // Create a real handler with defaults that won't touch the filesystem.
  it("createLocalApiHandler returns a handler object with scheduler hooks", () => {
    handler = createLocalApiHandler({
      dataDir: undefined,          // won't try to mkdir
      trackerConfigPath: undefined,
      tokenTrackerDir: undefined,
      logDir: undefined,
      queueDir: undefined,
      localAuthToken: "test-token",
      corsOrigin: "",
      allowedInsforgeBaseUrl: "",
      deviceName: "test-device",
      workspaceDir: process.cwd(),
    });
    assert.ok(handler, "handler must not be null/undefined");
    assert.strictEqual(typeof handler, "function", "handler must be a function (async http handler)");
  });

  it("exposes startTokenPlanScheduler as a function", () => {
    assert.strictEqual(typeof handler.startTokenPlanScheduler, "function");
  });

  it("exposes stopTokenPlanScheduler as a function", () => {
    assert.strictEqual(typeof handler.stopTokenPlanScheduler, "function");
  });

  it("exposes runTokenPlanDueRefresh as a function", () => {
    assert.strictEqual(typeof handler.runTokenPlanDueRefresh, "function");
  });

  it("exposes runTokenPlanRefreshById as a function", () => {
    assert.strictEqual(typeof handler.runTokenPlanRefreshById, "function");
  });

  it("startTokenPlanScheduler() can be called without throwing", () => {
    assert.doesNotThrow(() => {
      handler.startTokenPlanScheduler();
    });
  });

  it("stopTokenPlanScheduler() can be called without throwing", () => {
    assert.doesNotThrow(() => {
      handler.stopTokenPlanScheduler();
    });
  });
});
