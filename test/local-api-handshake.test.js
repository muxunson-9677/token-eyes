require("./helpers/home-shim.cjs");

const assert = require("node:assert");
const { describe, it } = require("node:test");
const { createLocalApiHandler } = require("../src/lib/local-api");

describe("local-api handshake", () => {
  it("returns protocol_version and capabilities in local-auth response", async () => {
    const handler = createLocalApiHandler({ queuePath: "", listeningPort: 7680 });
    
    let responseBody = null;
    let statusCode = null;
    let headers = {};
    
    await new Promise((resolve) => {
      const url = new URL("/api/local-auth", "http://localhost:7680");
      const req = {
        method: "GET",
        headers: {
          host: "127.0.0.1:7680",
          origin: "http://tauri.localhost",
        },
        url,
      };
      const res = {
        writeHead: (code, h) => {
          statusCode = code;
          headers = h;
        },
        end: (body) => {
          responseBody = body;
          resolve();
        },
      };
      handler(req, res, url);
    });
    
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(headers["Content-Type"], "application/json");
    assert.strictEqual(headers["Cache-Control"], "no-store");
    assert.strictEqual(headers["Access-Control-Allow-Origin"], "http://tauri.localhost");
    assert.match(headers.Vary, /(?:^|,\s*)Origin(?:,|$)/);
    
    const body = JSON.parse(responseBody);
    assert.strictEqual(body.protocol_version, 2);
    assert.ok(Array.isArray(body.capabilities));
    assert.ok(body.capabilities.includes("spend_usage_v2"));
    assert.ok(body.capabilities.includes("provider_model_stats"));
    assert.ok(body.capabilities.includes("request_usage_records"));
    assert.strictEqual(typeof body.token, "string");
    assert.ok(body.token.length > 0);
  });
});
