import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(__dirname, "..");
const VITE_CLI = path.join(DASHBOARD_DIR, "node_modules", "vite", "bin", "vite.js");
const MOCK_QUERY =
  "mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        else reject(new Error("Failed to allocate a preview port"));
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

function startPreviewServer(port) {
  const logs = [];
  const child = spawn(
    process.execPath,
    [
      VITE_CLI,
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
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

async function waitForPreview(baseUrl, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Preview exited before health check (code ${server.child.exitCode}):\n` +
        server.logs.join(""),
      );
    }
    if (await fetchHealthy(`${baseUrl}/`)) {
      console.log(`SERVER READY pid=${server.child.pid} url=${baseUrl}`);
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for preview at ${baseUrl}`);
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopPreviewServer(baseUrl, server) {
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
    throw new Error(`Owned preview still responds after cleanup: ${baseUrl}`);
  }
  console.log(`SERVER STOPPED pid=${child.pid} url=${baseUrl}`);
}

function hasVisibleFocus(style) {
  const outlineVisible =
    style.outlineStyle !== "none" &&
    Number.parseFloat(style.outlineWidth) >= 2 &&
    style.outlineColor !== "rgba(0, 0, 0, 0)";
  const shadowVisible = style.boxShadow !== "none";
  return outlineVisible || shadowVisible;
}

async function tagAuditTargets(page, pageName) {
  return page.evaluate((name) => {
    const targets = [];
    const add = (node, targetName) => {
      if (!node) throw new Error(`Missing audit target ${targetName}`);
      node.setAttribute("data-style-audit", targetName);
      targets.push(targetName);
    };

    if (name === "dashboard") {
      const title = document.querySelector('[data-testid="trend-monitor-title"]');
      const trendRoot = title?.parentElement?.parentElement?.parentElement;
      add(trendRoot?.querySelector("button"), "trend-zoom");
      const dataTabList = document.querySelector('[role="tablist"][aria-label="Data view"]');
      const tabs = [...(dataTabList?.querySelectorAll('button[role="tab"]') ?? [])];
      if (tabs.length !== 2) {
        throw new Error(`Expected two data tabs, received ${tabs.length}`);
      }
      add(tabs[0], "data-tab-daily");
      add(tabs[1], "data-tab-projects");
    } else {
      const toggles = [
        ...document.querySelectorAll("[data-cost-section] button[aria-expanded]"),
      ];
      if (toggles.length < 4) {
        throw new Error(`Expected at least four cost toggles, received ${toggles.length}`);
      }
      toggles.forEach((toggle, index) => add(toggle, `cost-toggle-${index}`));
    }
    return targets;
  }, pageName);
}

async function readKeyboardFocusStyles(page, targetNames) {
  await page.evaluate(() => document.activeElement?.blur());
  const styles = new Map();
  for (let index = 0; index < 200 && styles.size < targetNames.length; index += 1) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const active = document.activeElement;
      const name = active?.getAttribute?.("data-style-audit");
      if (!name) return null;
      const computed = getComputedStyle(active);
      return {
        name,
        hasHook: active.classList.contains("tt-analytics-focusable"),
        focusVisible: active.matches(":focus-visible"),
        outlineColor: computed.outlineColor,
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        boxShadow: computed.boxShadow,
      };
    });
    if (result && !styles.has(result.name)) styles.set(result.name, result);
  }
  return targetNames.map((name) => {
    const result = styles.get(name);
    if (!result) throw new Error(`Keyboard navigation did not reach ${name}`);
    return result;
  });
}

async function readCostBorderStyles(page, theme) {
  return page.evaluate((activeTheme) => {
    const totalIcon = document.querySelector('[data-testid="cost-summary-icon-total"]');
    const total = totalIcon?.closest('[data-testid="cost-summary-card"]');
    const apiIcon = document.querySelector('[data-testid="cost-summary-icon-api"]');
    const api = apiIcon?.closest('[data-testid="cost-summary-card"]');
    if (!total || !api) throw new Error("Missing cost summary cards");

    const probe = document.createElement("span");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(
      activeTheme === "dark" ? "--brand-800" : "--brand-200",
    );
    document.body.appendChild(probe);
    const expectedBrandColor = getComputedStyle(probe).color;
    probe.remove();

    return {
      totalBorderColor: getComputedStyle(total).borderColor,
      apiBorderColor: getComputedStyle(api).borderColor,
      expectedBrandColor,
      totalKeepsNestedSurface: total.classList.contains("tt-surface-nested"),
    };
  }, theme);
}

async function auditPage(browser, baseUrl, pageName, pathName, theme) {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 997 },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  await context.addInitScript((value) => {
    localStorage.setItem("tokentracker-theme", value);
  }, theme);
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}${pathName}?theme=${theme}&${MOCK_QUERY}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(500);
    const targetNames = await tagAuditTargets(page, pageName);
    const focusStyles = await readKeyboardFocusStyles(page, targetNames);
    const failures = [];
    for (const style of focusStyles) {
      console.log(`FOCUS ${pageName} ${theme} ${JSON.stringify(style)}`);
      if (!style.hasHook) failures.push(`${style.name} is missing the analytics focus hook`);
      if (!style.focusVisible) failures.push(`${style.name} did not match :focus-visible`);
      if (!hasVisibleFocus(style)) failures.push(`${style.name} has no visible focus cue`);
    }
    if (pageName === "cost") {
      const borders = await readCostBorderStyles(page, theme);
      console.log(`BORDER cost ${theme} ${JSON.stringify(borders)}`);
      if (!borders.totalKeepsNestedSurface) {
        failures.push("total card lost tt-surface-nested");
      }
      if (borders.totalBorderColor !== borders.expectedBrandColor) {
        failures.push(
          `total border ${borders.totalBorderColor} != brand ${borders.expectedBrandColor}`,
        );
      }
      if (borders.totalBorderColor === borders.apiBorderColor) {
        failures.push("total border is indistinguishable from a standard summary card");
      }
    }
    if (failures.length > 0) {
      throw new Error(`${pageName}/${theme}: ${failures.join("; ")}`);
    }
  } finally {
    await context.close();
  }
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server;
  let browser;
  const failures = [];
  try {
    server = startPreviewServer(port);
    await waitForPreview(baseUrl, server);
    browser = await chromium.launch();
    for (const theme of ["light", "dark"]) {
      for (const [pageName, pathName] of [
        ["dashboard", "/"],
        ["cost", "/spend/cost"],
      ]) {
        try {
          await auditPage(browser, baseUrl, pageName, pathName, theme);
        } catch (error) {
          failures.push(error);
          console.error(`FAIL ${error}`);
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopPreviewServer(baseUrl, server);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length}/4 dashboard/cost style audits failed`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
