import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { build } from "vite";

const DASHBOARD_DIR = path.resolve(import.meta.dirname, "..");
const REPO_DIR = path.resolve(DASHBOARD_DIR, "..");
const require = createRequire(import.meta.url);
const { buildSignedLeaderboardStaticSnapshot } = require(
  path.join(REPO_DIR, "src", "lib", "leaderboard-static-snapshot.js"),
);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function leaderboardRows(period, metric, source) {
  return Array.from({ length: 50 }, (_, index) => {
    const rank = index + 1;
    const totalTokens = 9_000_000 - index * 81_337;
    return {
      rank,
      participant_count: 137,
      public_entry_id: `browser-${period}-${metric}-${source}-${rank}`,
      display_name: `Static User ${String(rank).padStart(2, "0")}`,
      avatar_url: null,
      github_url: rank === 1 ? "https://github.com/token-eyes" : null,
      total_tokens: String(totalTokens),
      estimated_cost_usd: Number((totalTokens / 1_000_000 * 4.25).toFixed(4)),
      actual_cost_usd: metric === "actual_cost"
        ? Number((50 - index / 2).toFixed(2))
        : null,
      source_breakdown: [{
        source: source === "all" ? "codex" : source,
        total_tokens: String(totalTokens),
        estimated_cost_usd: Number((totalTokens / 1_000_000 * 4.25).toFixed(4)),
        unpriced_tokens: "0",
      }],
      pricing_version: "browser-acceptance-v1",
      from_day: period === "total" ? null : "2026-08-24",
      to_day: period === "total" ? null : "2026-08-30",
    };
  });
}

function tamperEnvelope(envelope) {
  const first = envelope.signature_b64.at(0);
  return {
    ...envelope,
    signature_b64: `${first === "A" ? "B" : "A"}${envelope.signature_b64.slice(1)}`,
  };
}

async function createServer({ distDir, privateKey, state }) {
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    state.requests.push({ method: request.method, pathname: requestUrl.pathname });

    const match = requestUrl.pathname.match(
      /^\/v1\/leaderboard\/(today|week|30d|month|total)\/(tokens|estimated_spend|actual_cost)\/([a-z0-9_-]+)\.json$/u,
    );
    if (match) {
      const [, period, metric, source] = match;
      const envelope = buildSignedLeaderboardStaticSnapshot({
        period,
        metric,
        source,
        rows: leaderboardRows(period, metric, source),
        privateKey,
        keyId: "browser-acceptance-key",
        generatedAt: new Date().toISOString(),
      });
      response.statusCode = 200;
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", MIME_TYPES.get(".json"));
      response.end(JSON.stringify(state.tamper ? tamperEnvelope(envelope) : envelope));
      return;
    }

    if (requestUrl.pathname.startsWith("/api/auth/")) {
      response.statusCode = 200;
      response.setHeader("Content-Type", MIME_TYPES.get(".json"));
      response.end(JSON.stringify({
        data: {
          user: null,
          oAuthProviders: [],
          customOAuthProviders: [],
          passwordMinLength: 8,
          verifyEmailMethod: "code",
        },
        error: null,
      }));
      return;
    }

    const relativePath = requestUrl.pathname === "/"
      ? "index.html"
      : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    let filePath = path.resolve(distDir, relativePath);
    if (!filePath.startsWith(`${path.resolve(distDir)}${path.sep}`)) {
      response.statusCode = 400;
      response.end("Bad request");
      return;
    }
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) throw new Error("directory");
    } catch {
      filePath = path.join(distDir, "index.html");
    }
    const body = await fs.readFile(filePath);
    response.statusCode = 200;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream");
    response.end(request.method === "HEAD" ? undefined : body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(state.port, "127.0.0.1", resolve);
  });
  return server;
}

function feedRequests(state) {
  return state.requests.filter((request) => request.pathname.startsWith("/v1/leaderboard/"));
}

function authRequests(state) {
  return [
    ...state.requests.filter((request) => request.pathname.startsWith("/api/auth/")),
    ...state.externalRequests.filter((request) => new URL(request.url).pathname.startsWith("/api/auth/")),
  ];
}

async function waitForFeedPath(page, state, expectedPath) {
  const deadline = Date.now() + 10_000;
  while (feedRequests(state).at(-1)?.pathname !== expectedPath) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${expectedPath}; last=${feedRequests(state).at(-1)?.pathname}`);
    }
    await page.waitForTimeout(25);
  }
}

async function assertFiftyRows(page) {
  await page.locator("[data-testid='leaderboard-list-surface'] [data-entry-index]").first().waitFor();
  await page.waitForFunction(() => (
    document.querySelectorAll("[data-testid='leaderboard-list-surface'] [data-entry-index]").length === 50
  ));
  assert.equal(
    await page.locator("[data-testid='leaderboard-list-surface'] [data-entry-index]").count(),
    50,
  );
}

async function assertNoHorizontalOverflow(page) {
  const measurements = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    toolbarRight: document.querySelector("[data-testid='leaderboard-filter-toolbar']")?.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(measurements.scrollWidth <= measurements.clientWidth + 1, JSON.stringify(measurements));
  assert.ok(measurements.toolbarRight <= measurements.viewportWidth + 1, JSON.stringify(measurements));
}

async function run() {
  const runName = process.argv.includes("--run")
    ? process.argv[process.argv.indexOf("--run") + 1]
    : "local";
  assert.match(runName, /^[a-z0-9_-]+$/u);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "token-eyes-leaderboard-ui-"));
  const distDir = path.join(tempDir, "dist");
  const artifactsDir = path.join(REPO_DIR, ".tmp", "acceptance-05449", runName);
  await fs.mkdir(artifactsDir, { recursive: true });
  const port = await getFreePort();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const state = { port, requests: [], externalRequests: [], tamper: false };
  const environmentBackup = new Map();
  const buildEnvironment = {
    VITE_LEADERBOARD_PUBLIC_BASE_URL: `http://127.0.0.1:${port}/v1`,
    VITE_STATIC_FEED_PUBLIC_KEY_SPKI_BASE64: publicKeySpkiBase64,
  };
  for (const [key, value] of Object.entries(buildEnvironment)) {
    environmentBackup.set(key, process.env[key]);
    process.env[key] = value;
  }

  let server;
  let browser;
  try {
    await build({
      root: DASHBOARD_DIR,
      configFile: path.join(DASHBOARD_DIR, "vite.config.js"),
      mode: "production",
      logLevel: "warn",
      build: { outDir: distDir, emptyOutDir: true },
    });
    server = await createServer({ distDir, privateKey, state });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" && url.pathname.startsWith("/_vercel/")) {
        await route.fulfill({ status: 204, contentType: "text/javascript; charset=utf-8", body: "" });
        return;
      }
      if (url.hostname !== "127.0.0.1") {
        state.externalRequests.push({ method: route.request().method(), url: url.toString() });
        if (url.pathname.startsWith("/api/auth/")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify({ data: { user: null }, error: null }),
          });
          return;
        }
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    await page.goto(`http://127.0.0.1:${port}/leaderboard`, { waitUntil: "networkidle" });
    try {
      await assertFiftyRows(page);
    } catch (error) {
      const diagnostics = {
        url: page.url(),
        secureContext: await page.evaluate(() => window.isSecureContext),
        hasSubtleCrypto: await page.evaluate(() => Boolean(globalThis.crypto?.subtle)),
        text: (await page.locator("body").innerText()).slice(0, 1_000),
        feedRequests: feedRequests(state),
        authRequests: authRequests(state),
        externalRequests: state.externalRequests,
        browserErrors,
      };
      await page.screenshot({ path: path.join(artifactsDir, "initial-failure.png"), fullPage: true });
      await fs.writeFile(path.join(artifactsDir, "initial-failure.json"), JSON.stringify(diagnostics, null, 2));
      console.error(JSON.stringify(diagnostics, null, 2));
      throw error;
    }
    assert.equal(feedRequests(state).length, 1, JSON.stringify(feedRequests(state)));
    assert.equal(authRequests(state).length, 0, JSON.stringify(authRequests(state)));
    assert.equal(await page.locator("[data-testid='leaderboard-generated-at']").count(), 1);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(artifactsDir, "leaderboard-1440x1000.png"), fullPage: true });

    const initialReadCount = feedRequests(state).length;
    await page.waitForTimeout(125_000);
    assert.equal(feedRequests(state).length, initialReadCount, "leaderboard polled in the background");

    await page.locator("[data-testid='leaderboard-period-control'] [role='tab']").nth(1).click();
    await page.waitForFunction(() => window.location.search.includes("period=week"));
    await waitForFeedPath(page, state, "/v1/leaderboard/week/tokens/all.json");
    await assertFiftyRows(page);

    await page.locator("#leaderboard-source-control").click();
    await page.getByRole("option", { name: "Codex" }).click();
    await waitForFeedPath(page, state, "/v1/leaderboard/week/tokens/codex.json");
    await assertFiftyRows(page);

    await page.locator("[data-testid='leaderboard-metric-control'] [role='tab']").nth(2).click();
    await page.waitForFunction(() => window.location.search.includes("metric=actual_cost"));
    await waitForFeedPath(page, state, "/v1/leaderboard/week/actual_cost/all.json");
    await assertFiftyRows(page);
    assert.equal(await page.locator("#leaderboard-source-control").isDisabled(), true);

    const beforeManualRefresh = feedRequests(state).length;
    await page.locator("[data-testid='leaderboard-manual-refresh']").click();
    await page.waitForFunction(
      (count) => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/v1/leaderboard/")).length > count,
      beforeManualRefresh,
    );
    assert.equal(feedRequests(state).length, beforeManualRefresh + 1);

    state.tamper = true;
    const beforeInvalidRefresh = feedRequests(state).length;
    await page.locator("[data-testid='leaderboard-manual-refresh']").click();
    while (feedRequests(state).length === beforeInvalidRefresh) await page.waitForTimeout(25);
    await page.locator("[data-testid='leaderboard-list-error']").waitFor();
    assert.ok((await page.locator("[data-testid='leaderboard-list-error']").innerText()).trim());
    await assertFiftyRows(page);
    state.tamper = false;

    await page.setViewportSize({ width: 1100, height: 760 });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(artifactsDir, "leaderboard-1100x760.png"), fullPage: true });

    assert.equal(authRequests(state).length, 0, JSON.stringify(authRequests(state)));
    assert.deepEqual(browserErrors, [], JSON.stringify(browserErrors, null, 2));
    await page.locator(".tt-leaderboard-signin-prompt button").click();
    await page.locator("[role='dialog']").waitFor();
    while (authRequests(state).length === 0) await page.waitForTimeout(25);
    assert.ok(authRequests(state).length > 0, "explicit login did not activate InsForge Auth");
    await page.waitForTimeout(250);
    assert.deepEqual(browserErrors, [], JSON.stringify(browserErrors, null, 2));

    await fs.writeFile(path.join(artifactsDir, "result.json"), JSON.stringify({
      runName,
      checkedAt: new Date().toISOString(),
      feedRequests: feedRequests(state),
      authRequests: authRequests(state),
      externalRequests: state.externalRequests,
      browserErrors,
    }, null, 2));
    console.log(`PASS leaderboard static UI acceptance (${runName})`);
    console.log(`Evidence: ${artifactsDir}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    await fs.rm(tempDir, { recursive: true, force: true });
    for (const [key, value] of environmentBackup) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

await run();
