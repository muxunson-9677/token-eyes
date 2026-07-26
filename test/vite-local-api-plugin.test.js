"use strict";
require("./helpers/home-shim.cjs");

const assert = require("node:assert/strict");
const { test } = require("node:test");

test("Vite dev proxies the local-auth handshake to the local CLI", async () => {
  const { localDataApiPlugin } = await import("../dashboard/vite.config.js");
  const originalFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return new Response(JSON.stringify({ token: "dev-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  };
  let middleware = null;
  localDataApiPlugin().configureServer({
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });

  try {
    const headers = {};
    const body = await new Promise((resolve, reject) => {
      const req = {
        url: "/api/local-auth",
        method: "GET",
        headers: { host: "localhost:5173", origin: "http://localhost:5173" },
      };
      const res = {
        statusCode: 0,
        setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
        end(value) { resolve(Buffer.from(value || []).toString("utf8")); },
      };
      const next = (error) => reject(error || new Error("request unexpectedly fell through"));
      middleware(req, res, next);
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0][0], "http://127.0.0.1:7680/api/local-auth");
    assert.equal(fetchCalls[0][1].method, "GET");
    assert.deepEqual(JSON.parse(body), { token: "dev-token" });
    assert.equal(headers["cache-control"], "no-store");
  } finally {
    global.fetch = originalFetch;
  }
});