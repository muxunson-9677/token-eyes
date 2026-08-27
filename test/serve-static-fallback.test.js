"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { serveDashboardRequest } = require("../src/commands/serve");

async function withServer(dashboardDir, run) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    serveDashboardRequest(dashboardDir, url.pathname, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("missing hashed assets return a hard 404 instead of SPA HTML", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-static-fallback-"));
  try {
    await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Token Eyes</title>", "utf8");
    await withServer(root, async (origin) => {
      const missingCss = await fetch(`${origin}/assets/value-realtime-pages-missing.css`);
      assert.equal(missingCss.status, 404);
      assert.match(missingCss.headers.get("content-type") || "", /^text\/plain/u);
      assert.doesNotMatch(await missingCss.text(), /<!doctype html>/iu);

      const route = await fetch(`${origin}/arbitrary-client-route`);
      assert.equal(route.status, 200);
      assert.match(route.headers.get("content-type") || "", /^text\/html/u);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a hashed asset request waits for an in-progress dashboard publication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-static-publish-"));
  try {
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Token Eyes</title>", "utf8");
    await withServer(root, async (origin) => {
      const assetPath = path.join(root, "assets", "value-realtime-pages-publishing.css");
      const publication = new Promise((resolve, reject) => {
        setTimeout(() => {
          fs.writeFile(assetPath, ".rt-focus { display: grid; }\n", "utf8").then(resolve, reject);
        }, 60);
      });
      const response = await fetch(`${origin}/assets/value-realtime-pages-publishing.css`);
      await publication;
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /^text\/css/u);
      assert.equal(await response.text(), ".rt-focus { display: grid; }\n");
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a hashed asset request does not serve an empty file while it is being replaced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-static-replace-"));
  try {
    const assetsDir = path.join(root, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const assetPath = path.join(assetsDir, "value-realtime-pages-replacing.css");
    await fs.writeFile(assetPath, "", "utf8");
    await withServer(root, async (origin) => {
      const publication = new Promise((resolve, reject) => {
        setTimeout(() => {
          fs.writeFile(assetPath, ".rt-focus { min-height: 240px; }\n", "utf8").then(resolve, reject);
        }, 60);
      });
      const response = await fetch(`${origin}/assets/value-realtime-pages-replacing.css`);
      await publication;
      assert.equal(response.status, 200);
      assert.equal(await response.text(), ".rt-focus { min-height: 240px; }\n");
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
