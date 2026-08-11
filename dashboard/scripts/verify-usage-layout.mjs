import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createScreenshotThemeSetup } from "./visual-baseline-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(__dirname, "..");
const VITE_CLI = path.join(DASHBOARD_DIR, "node_modules", "vite", "bin", "vite.js");
const FAILURE_DIR = path.join(DASHBOARD_DIR, "tmp", "usage-layout");
const THEMES = ["light", "dark"];
const VIEWPORTS = [
  { name: "desktop", width: 1512, height: 997 },
  { name: "compact", width: 1180, height: 760 },
  { name: "mobile", width: 390, height: 844 },
];
const SCENARIOS = ["long", "empty", "loading", "error", "zero"];
const MOCK_PARAMS = {
  screenshot: "1",
  mock: "0",
};

const USAGE_TOTALS = {
  total_tokens: 643_308_077,
  input_tokens: 55_193_000,
  output_tokens: 2_358_000,
  cache_creation_input_tokens: 1_200,
  cached_input_tokens: 586_000_000,
  request_count: 5_634,
  cost_usd: 228.0715,
  cache_hit_rate: 0.914,
  pricing_coverage: "complete",
};

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function selectNamed(items, name, label) {
  if (!name) return items;
  const selected = items.filter((item) => (
    typeof item === "string" ? item === name : item.name === name
  ));
  if (selected.length === 0) {
    const names = items.map((item) => (
      typeof item === "string" ? item : item.name
    ));
    throw new Error(`Unknown ${label} "${name}". Expected one of: ${names.join(", ")}`);
  }
  return selected;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("Failed to allocate a local Vite port"));
      });
    });
  });
}

async function fetchHealthy(url, timeoutMs = 750) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function startViteServer(port) {
  const logs = [];
  const child = spawn(
    process.execPath,
    [VITE_CLI, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: DASHBOARD_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  console.log(`SERVER START pid=${child.pid} port=${port}`);
  return { child, logs };
}

async function waitForViteServer(baseUrl, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Vite exited before health check (code ${server.child.exitCode}):\n${server.logs.join("")}`,
      );
    }
    if (await fetchHealthy(`${baseUrl}/`)) {
      console.log(`SERVER READY pid=${server.child.pid} url=${baseUrl}`);
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Vite at ${baseUrl}\n${server.logs.join("")}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopViteServer(baseUrl, server) {
  if (!server) return;
  const { child } = server;
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    if (!(await waitForChildExit(child, 5_000)) && child.exitCode === null) {
      child.kill("SIGKILL");
      await waitForChildExit(child, 5_000);
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && await fetchHealthy(`${baseUrl}/`, 250)) {
    await delay(100);
  }
  if (await fetchHealthy(`${baseUrl}/`, 250)) {
    throw new Error(`Owned Vite server still responds after cleanup: ${baseUrl}`);
  }
  console.log(`SERVER STOPPED pid=${child.pid} url=${baseUrl}`);
}

function usageUrl(baseUrl, theme) {
  const url = new URL("/spend/usage", baseUrl);
  for (const [key, value] of Object.entries(MOCK_PARAMS)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("theme", theme);
  return url.toString();
}

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function usageSummaryFor(scenario) {
  if (scenario === "empty") return { totals: null };
  if (scenario === "zero") {
    return {
      totals: {
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cached_input_tokens: 0,
        request_count: 0,
        cost_usd: 0,
        cache_hit_rate: 0,
        pricing_coverage: "complete",
      },
    };
  }
  return { totals: USAGE_TOTALS };
}

async function installApiScenario(page, scenario) {
  const loadingGate = createDeferred();
  let refreshFailureEnabled = false;
  const requests = new Map();
  const fulfilled = new Map();
  const count = (slug) => requests.set(slug, (requests.get(slug) || 0) + 1);
  const countFulfilled = (slug) => fulfilled.set(slug, (fulfilled.get(slug) || 0) + 1);

  await page.route("**/api/local-auth", async (route) => {
    await route.fulfill(jsonResponse({
      token: "usage-layout-token",
      protocol_version: 2,
      capabilities: [
        "spend_usage_v2",
        "provider_model_stats",
        "request_usage_records",
        "provider_api_balance",
      ],
    }));
  });

  await page.route("**/functions/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const slug = requestUrl.pathname.split("/").filter(Boolean).at(-1) || "";
    count(slug);

    if (slug === "tokentracker-usage-summary") {
      if (scenario === "loading") {
        await loadingGate.promise;
      }
      if (scenario === "error" && refreshFailureEnabled) {
        await route.fulfill(jsonResponse({ error: "Synthetic refresh failure" }, 503));
        countFulfilled(slug);
        return;
      }
      await route.fulfill(jsonResponse(usageSummaryFor(scenario)));
      countFulfilled(slug);
      return;
    }

    if (slug === "tokentracker-spend-records") {
      const requestNumber = requests.get(slug) || 0;
      const isPreviousMonth = requestNumber % 2 === 0;
      const currentTotals = scenario === "zero"
        ? {
          api_usd: 0,
          subscription_usd: 0,
          combined_usd: 0,
          lifetime_combined_usd: 0,
        }
        : {
          api_usd: 8.25,
          subscription_usd: 20,
          combined_usd: 28.25,
          lifetime_combined_usd: 138.4,
        };
      const previousTotals = scenario === "zero"
        ? { api_usd: 0, subscription_usd: 0, combined_usd: 0 }
        : { api_usd: 7.36, subscription_usd: 20, combined_usd: 29.43 };
      await route.fulfill(jsonResponse({
        records: [],
        totals: isPreviousMonth ? previousTotals : currentTotals,
        by_source: [],
      }));
      countFulfilled(slug);
      return;
    }

    const responses = {
      "tokentracker-usage-bounds": { from: "2025-01-01", to: "2026-07-30" },
      "tokentracker-provider-stats": {
        providers: [{ source: "codex", source_display_name: "Codex" }],
      },
      "tokentracker-model-stats": {
        models: [{ source: "codex", model: "gpt-5", total_tokens: 1 }],
      },
      "tokentracker-local-settings": { dashboardRefresh: { interval: "1m" } },
      "tokentracker-token-plans": { records: [] },
      "tokentracker-codex-reset-events": {
        ok: true,
        status: {
          enabled: false,
          configured: false,
          running: false,
          unread_count: 0,
        },
        events: [],
        tray_events: [],
        widget_events: [],
        notification_events: [],
        history: [],
      },
      "tokentracker-usage-daily": { data: [] },
      "tokentracker-usage-hourly": { data: [] },
      "tokentracker-usage-monthly": { data: [] },
      "tokentracker-request-usage-records": {
        records: [],
        total: 0,
        totals: { request_count: 0, success_rate: null, avg_latency_ms: null },
      },
    };
    await route.fulfill(jsonResponse(responses[slug] || {}));
  });

  return {
    requests,
    fulfilled,
    failRefresh: () => {
      refreshFailureEnabled = true;
    },
    releaseLoading: () => loadingGate.resolve(),
  };
}

async function waitForScenario(page, scenario, api, runtimeErrors) {
  const target = scenario === "long" || scenario === "zero"
    ? page.getByTestId("usage-stats-layout")
    : scenario === "error"
      ? page.getByRole("status")
      : page.locator(`[data-testid="usage-stats-state"][data-state="${scenario}"]`);
  const deadline = Date.now() + 8_000;
  let visibleSince = null;
  while (Date.now() < deadline) {
    const summaryRequested = (api.requests.get("tokentracker-usage-summary") || 0) >= 1;
    const fulfilledCount = api.fulfilled.get("tokentracker-usage-summary") || 0;
    const summarySettled = scenario === "loading"
      ? summaryRequested
      : scenario === "error"
        ? fulfilledCount >= 2
        : fulfilledCount >= 1;
    const financialSettled = scenario === "long" || scenario === "zero"
      ? (api.fulfilled.get("tokentracker-spend-records") || 0) >= 2
      : true;
    if (summarySettled && financialSettled && await target.isVisible().catch(() => false)) {
      visibleSince ??= Date.now();
      if (Date.now() - visibleSince >= 250) {
        if (scenario === "long" || scenario === "zero") {
          await page.getByTestId("usage-summary-rail").waitFor({
            state: "visible",
            timeout: 8_000,
          });
        }
        return;
      }
    } else {
      visibleSince = null;
    }
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (bodyText.includes("Cannot read properties") || runtimeErrors.length > 0) {
      throw new Error(
        `Application failed before ${scenario} rendered: ${runtimeErrors.join("\n") || bodyText}`,
      );
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${scenario} state` +
    (runtimeErrors.length ? `:\n${runtimeErrors.join("\n")}` : ""),
  );
}

async function assertScenarioRendered(page, scenario, requests) {
  if ((requests.get("tokentracker-usage-summary") || 0) < 1) {
    throw new Error(`${scenario} did not exercise the usage-summary API mock`);
  }
  if (
    scenario === "error"
    && (requests.get("tokentracker-usage-summary") || 0) < 2
  ) {
    throw new Error("Refresh-error scenario did not make a second usage-summary request");
  }

  if (scenario === "long") {
    const dimensions = await page.getByTestId("usage-dimension-card").allTextContents();
    const requests = await page.getByTestId("usage-request-value").textContent();
    const cacheHit = await page.getByTestId("usage-cache-hit-summary").textContent();
    if (dimensions.length !== 4 || !dimensions.every((value) => /\d/u.test(value))) {
      throw new Error(`Token dimensions did not render: ${JSON.stringify(dimensions)}`);
    }
    if (!requests?.includes("5,634")) {
      throw new Error(`Request total did not render: ${JSON.stringify(requests)}`);
    }
    if (!cacheHit?.includes("91.4%")) {
      throw new Error(`Cache hit rate did not render: ${JSON.stringify(cacheHit)}`);
    }
    const costCards = await page.getByTestId("usage-cost-card").allTextContents();
    const comparisons = await page.getByTestId("monthly-cost-comparison").allTextContents();
    if (costCards.length !== 4 || comparisons.length !== 3) {
      throw new Error(`Restored financial summary is incomplete: ${JSON.stringify({ costCards, comparisons })}`);
    }
    if (!costCards.some((value) => value.includes("USD 138.40"))) {
      throw new Error(`Lifetime financial total did not render: ${JSON.stringify(costCards)}`);
    }
    return;
  }

  if (scenario === "zero") {
    const dimensions = await page.getByTestId("usage-dimension-card").allTextContents();
    const requests = await page.getByTestId("usage-request-value").textContent();
    const cacheHit = await page.getByTestId("usage-cache-hit-summary").textContent();
    if (dimensions.length !== 4 || !dimensions.every((value) => value.includes("0"))) {
      throw new Error(`Real-zero Token dimensions are incorrect: ${JSON.stringify(dimensions)}`);
    }
    if (!requests?.includes("0") || !cacheHit?.includes("0.0%")) {
      throw new Error(`Real-zero usage summaries are incorrect: ${JSON.stringify({ requests, cacheHit })}`);
    }
    const costCards = await page.getByTestId("usage-cost-card").allTextContents();
    const comparisons = await page.getByTestId("monthly-cost-comparison").allTextContents();
    if (costCards.length !== 4 || !costCards.every((value) => value.includes("USD 0.00"))) {
      throw new Error(`Real-zero financial cards are incorrect: ${JSON.stringify(costCards)}`);
    }
    if (comparisons.length !== 3 || !comparisons.every((value) => value.includes("持平"))) {
      throw new Error(`Real-zero month comparisons are incorrect: ${JSON.stringify(comparisons)}`);
    }
    return;
  }

  if (scenario === "error") {
    const staleData = page.getByTestId("usage-stats-layout");
    const status = page.getByRole("status");
    if (!await staleData.isVisible() || !await status.isVisible()) {
      throw new Error("Refresh error did not preserve the last successful usage data");
    }
    if (!(await status.textContent()).includes("Synthetic refresh failure")) {
      throw new Error("Refresh error did not explain the failed API request");
    }
    return;
  }

  const state = page.locator(
    `[data-testid="usage-stats-state"][data-state="${scenario}"]`,
  );
  if (!await state.isVisible()) {
    throw new Error(`Expected a visible ${scenario} state`);
  }
}

async function inspectGeometry(page) {
  const geometry = await page.evaluate(() => {
    const metrics = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.getAttribute("data-testid") || node.getAttribute("role") || node.className,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        left: rect.left,
        right: rect.right,
      };
    };
    const stateAnchor = document.querySelector(
      '[data-testid="usage-stats-layout"], [data-testid="usage-stats-state"]',
    );
    const candidates = [
      document.querySelector('[role="toolbar"]'),
      stateAnchor?.closest(".tt-surface"),
      stateAnchor,
      document.querySelector('[data-testid="usage-summary-rail"]'),
    ].filter(Boolean);
    const targets = Array.from(new Set(candidates));
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      targets: targets.map(metrics),
    };
  });

  if (geometry.documentScrollWidth > geometry.documentClientWidth + 1) {
    throw new Error(
      `Document overflows horizontally: ${geometry.documentScrollWidth} > ${geometry.documentClientWidth}`,
    );
  }
  if (geometry.bodyScrollWidth > geometry.bodyClientWidth + 1) {
    throw new Error(
      `Body overflows horizontally: ${geometry.bodyScrollWidth} > ${geometry.bodyClientWidth}`,
    );
  }
  if (geometry.targets.length < 3) {
    throw new Error(`Expected at least 3 critical usage targets, received ${geometry.targets.length}`);
  }
  for (const target of geometry.targets) {
    if (target.scrollWidth > target.clientWidth + 1) {
      throw new Error(
        `${target.label} overflows horizontally: ${target.scrollWidth} > ${target.clientWidth}`,
      );
    }
    if (target.scrollHeight > target.clientHeight + 1) {
      throw new Error(
        `${target.label} is vertically clipped: ${target.scrollHeight} > ${target.clientHeight}`,
      );
    }
    if (target.left < -1 || target.right > geometry.viewportWidth + 1) {
      throw new Error(
        `${target.label} leaves the viewport: left=${target.left}, right=${target.right}`,
      );
    }
  }
  return geometry;
}

function transitionHasDuration(value) {
  return value.split(",").some((duration) => Number.parseFloat(duration) > 0);
}

async function inspectFilterInteractions(page) {
  const issues = [];
  const toolbar = page.locator('[role="toolbar"]');
  const trigger = toolbar.locator('button[aria-haspopup="dialog"]').first();
  const selectedAgent = toolbar.locator('button[aria-pressed="true"]').first();
  await trigger.waitFor({ state: "visible" });

  const selectedShadowBefore = await selectedAgent.evaluate(
    (node) => getComputedStyle(node).boxShadow,
  );
  await trigger.focus();
  if (!await trigger.evaluate((node) => node.matches(":focus-visible"))) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
  }
  const focus = await trigger.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      focusVisible: node.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    };
  });
  const hasOutline = focus.outlineStyle !== "none"
    && Number.parseFloat(focus.outlineWidth) >= 2
    && !focus.outlineColor.includes("rgba(0, 0, 0, 0)");
  const hasShadow = focus.boxShadow !== "none"
    && !focus.boxShadow.includes("rgba(0, 0, 0, 0)");
  if (!focus.focusVisible || (!hasOutline && !hasShadow)) {
    issues.push(`Toolbar focus is not visible: ${JSON.stringify(focus)}`);
  }
  const selectedShadowAfter = await selectedAgent.evaluate(
    (node) => getComputedStyle(node).boxShadow,
  );
  if (selectedShadowAfter !== selectedShadowBefore) {
    issues.push("Focusing an unselected filter changed the selected Agent styling");
  }

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await trigger.click();
  await page.waitForFunction(
    (node) => node.hasAttribute("data-popup-open"),
    await trigger.elementHandle(),
  );
  await page.waitForTimeout(180);
  const normal = await trigger.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  });
  if (normal.transform === "none" || !transitionHasDuration(normal.transitionDuration)) {
    issues.push(`Normal motion lost open feedback: ${JSON.stringify(normal)}`);
  }
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  await page.waitForFunction(
    (node) => node.hasAttribute("data-popup-open"),
    await trigger.elementHandle(),
  );
  const reduced = await trigger.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      transform: style.transform,
      transitionDuration: style.transitionDuration,
    };
  });
  if (reduced.transform !== "none" || transitionHasDuration(reduced.transitionDuration)) {
    issues.push(`Reduced motion still animates or translates: ${JSON.stringify(reduced)}`);
  }
  await page.keyboard.press("Escape");
  if (issues.length > 0) {
    throw new Error(issues.join(" | "));
  }
  return { focus, normal, reduced };
}

async function runJob(browser, baseUrl, scenario, viewport, theme) {
  const targetUrl = usageUrl(baseUrl, theme);
  const themeSetup = createScreenshotThemeSetup(targetUrl);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: themeSetup?.colorScheme || theme,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.stack || error.message);
  });
  const api = await installApiScenario(page, scenario);
  try {
    if (themeSetup) {
      await page.addInitScript((value) => {
        localStorage.clear();
        localStorage.setItem("tokentracker-theme", value);
      }, themeSetup.localStorageTheme);
    }
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (scenario === "error") {
      await page.getByTestId("usage-stats-layout").waitFor({
        state: "visible",
        timeout: 8_000,
      });
      await page.evaluate(() => {
        for (let index = localStorage.length - 1; index >= 0; index -= 1) {
          const key = localStorage.key(index);
          if (key?.startsWith("tokentracker.usageSummary.")) {
            localStorage.removeItem(key);
          }
        }
      });
      api.failRefresh();
      await page.locator(
        '[role="toolbar"] button:has(svg.lucide-refresh-cw)',
      ).click();
    }
    await waitForScenario(page, scenario, api, runtimeErrors);
    await assertScenarioRendered(page, scenario, api.requests);
    const geometry = await inspectGeometry(page);
    const interactions = scenario === "long" && viewport.name === "mobile"
      ? await inspectFilterInteractions(page)
      : null;
    console.log(
      `PASS scenario=${scenario} viewport=${viewport.width}x${viewport.height} ` +
      `theme=${theme} document=${geometry.documentScrollWidth}/${geometry.documentClientWidth}`,
    );
    return { scenario, viewport, theme, geometry, interactions };
  } catch (error) {
    await fs.mkdir(FAILURE_DIR, { recursive: true });
    const screenshot = path.join(
      FAILURE_DIR,
      `${scenario}-${viewport.width}x${viewport.height}-${theme}-FAIL.png`,
    );
    try {
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
    } catch {
      // Preserve the primary audit failure.
    }
    throw new Error(
      `scenario=${scenario} viewport=${viewport.width}x${viewport.height} theme=${theme}: ${error}`,
    );
  } finally {
    api.releaseLoading();
    await context.close();
  }
}

async function run() {
  await fs.rm(FAILURE_DIR, { recursive: true, force: true });
  console.log(`ARTIFACTS CLEAN path=${FAILURE_DIR}`);

  const requestedPort = Number(readArg("--port", ""));
  const port = Number.isInteger(requestedPort) && requestedPort > 0
    ? requestedPort
    : await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = null;
  let browser = null;
  const failures = [];
  const scenarios = selectNamed(
    SCENARIOS,
    readArg("--scenario", ""),
    "scenario",
  );
  const viewports = selectNamed(
    VIEWPORTS,
    readArg("--viewport", ""),
    "viewport",
  );
  const themes = selectNamed(
    THEMES,
    readArg("--theme", ""),
    "theme",
  );

  try {
    server = startViteServer(port);
    await waitForViteServer(baseUrl, server);
    browser = await chromium.launch();

    for (const scenario of scenarios) {
      for (const viewport of viewports) {
        for (const theme of themes) {
          try {
            await runJob(browser, baseUrl, scenario, viewport, theme);
          } catch (error) {
            failures.push(error);
            console.error(`FAIL ${error}`);
          }
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopViteServer(baseUrl, server);
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${scenarios.length * viewports.length * themes.length} ` +
      `usage layout audits failed`,
    );
  }
  await fs.rm(FAILURE_DIR, { recursive: true, force: true });
  console.log(`ARTIFACTS CLEAN path=${FAILURE_DIR}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
