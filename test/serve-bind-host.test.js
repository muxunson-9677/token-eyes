require("./helpers/home-shim.cjs");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");

const {
  createServeRequestListener,
  LOCAL_BIND_HOST,
  getLocalServerUrl,
} = require("../src/commands/serve");

test("serve binds to loopback and advertises the loopback URL", () => {
  assert.equal(LOCAL_BIND_HOST, "127.0.0.1");
  assert.equal(getLocalServerUrl(7680), "http://127.0.0.1:7680");
});

test("serve startup does not persistently rewrite config.json", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "commands", "serve.js"), "utf8");
  assert.doesNotMatch(source, /writeJson\s*\(\s*cfgPath/);
  assert.doesNotMatch(source, /cfg\.baseUrl\s*=/);
});

test("serve request entry validates Host before constructing a request URL", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "commands", "serve.js"), "utf8");
  assert.match(source, /validateLocalApiRequest/);
  assert.doesNotMatch(
    source,
    /new URL\(req\.url \|\| "\/", `http:\/\/\$\{req\.headers\.host \|\| "localhost"\}`\)/,
  );
});

test("a real loopback HTTP server rejects a rebinding Host before handling local auth", async (t) => {
  let port = 7680;
  let handledRequests = 0;
  const listener = createServeRequestListener({
    handleApi: async (_req, res) => {
      handledRequests += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    },
    dashboardDir: path.join(process.cwd(), ".tmp", "r2-empty-dashboard"),
    getPort: () => port,
  });
  const server = http.createServer(listener);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOCAL_BIND_HOST, resolve);
  });
  port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await new Promise((resolve, reject) => {
    const req = http.request({
      host: LOCAL_BIND_HOST,
      port,
      path: "/api/local-auth",
      headers: { Host: `127.0.0.1.attacker.example:${port}` },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "Forbidden" });
  assert.equal(handledRequests, 0);

  const legalResponse = await new Promise((resolve, reject) => {
    const req = http.request({
      host: LOCAL_BIND_HOST,
      port,
      path: "/api/test",
      headers: { Host: `127.0.0.1:${port}` },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(legalResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(legalResponse.body), { ok: true });
  assert.equal(handledRequests, 1);
});

test("serve listener destroys a partial response when a handler throws after headers are sent", async () => {
  const error = new Error("handler failed after headers");
  let destroyedWith = null;
  let ended = false;
  const listener = createServeRequestListener({
    handleApi: async (_req, res) => {
      res.headersSent = true;
      throw error;
    },
    dashboardDir: path.join(process.cwd(), ".tmp", "r2-empty-dashboard"),
    getPort: () => 7680,
  });
  const req = {
    method: "GET",
    url: "/api/test",
    headers: { host: "127.0.0.1:7680" },
  };
  const res = {
    headersSent: false,
    writableEnded: false,
    destroy(err) {
      destroyedWith = err;
    },
    end() {
      ended = true;
    },
  };

  await listener(req, res);

  assert.equal(destroyedWith, error);
  assert.equal(ended, false);
});
