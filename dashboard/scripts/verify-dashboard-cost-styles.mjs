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
const AUDIT_TARGET_TIMEOUT_MS = 15_000;

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
    [
      VITE_CLI,
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
  console.log(`SERVER START mode=vite-dev pid=${child.pid} port=${port}`);
  return { child, logs };
}

async function waitForViteServer(baseUrl, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `Vite exited before health check (code ${server.child.exitCode}):\n` +
        server.logs.join(""),
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

function hasVisibleFocus(style) {
  const outlineVisible =
    style.outlineStyle !== "none" &&
    Number.parseFloat(style.outlineWidth) >= 2 &&
    style.outlineColor !== "rgba(0, 0, 0, 0)";
  const shadowVisible = style.boxShadow !== "none";
  return outlineVisible || shadowVisible;
}

async function waitForAuditTargets(page, pageName, theme) {
  const scenario = `${pageName}/${theme}`;
  try {
    const readinessHandle = await page.waitForFunction(
      (name) => {
        const isVisible = (node) => {
          if (!(node instanceof HTMLElement) || node.getClientRects().length === 0) return false;
          const style = getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden";
        };
        const blockingState = [
          ...document.querySelectorAll('[data-state="loading"], [data-state="error"]'),
        ].find(isVisible);

        if (name === "dashboard") {
          const workspace = document.querySelector('[data-testid="dashboard-primary-workspace"]');
          const secondary = document.querySelector('[data-testid="dashboard-secondary-context"]');
          const dataDetails = document.querySelector('[data-testid="dashboard-data-details"]');
          const summaryCard = document.querySelector('[data-testid="usage-overview-summary-card"]');
          const toolbar = summaryCard?.previousElementSibling;
          const coreActions = [
            ...(toolbar?.querySelectorAll('button:not([role="tab"]), select') || []),
          ];
          if (
            blockingState
            || !isVisible(workspace)
            || !isVisible(secondary)
            || !isVisible(dataDetails)
            || coreActions.length !== 3
            || !coreActions.every(isVisible)
          ) {
            return false;
          }
          return {
            primaryWorkspace: 1,
            secondaryContext: 1,
            dataDetails: 1,
            coreActions: coreActions.length,
          };
        }

        const api = document.querySelector('[data-cost-summary-card="api"]');
        const subscription = document.querySelector('[data-cost-summary-card="subscription"]');
        const combinedTotal = document.querySelector('[data-cost-summary-card="total"]');
        const sections = [...document.querySelectorAll("[data-cost-section]")];
        const toggles = sections.map(
          (section) => section.querySelector("button[aria-expanded]"),
        );
        const summaryRegion = document.querySelector('[data-testid="cost-summary-region"]');
        const costError = summaryRegion?.parentElement?.querySelector(
          ":scope > .border-red-200.text-red-600",
        );
        if (
          blockingState
          || isVisible(costError)
          || !isVisible(api)
          || !isVisible(subscription)
          || combinedTotal
          || sections.length < 4
          || toggles.length !== sections.length
          || !toggles.every(isVisible)
        ) {
          return false;
        }
        return { separatedCostCards: 2, foldableToggles: toggles.length };
      },
      pageName,
      { timeout: AUDIT_TARGET_TIMEOUT_MS },
    );
    const readiness = await readinessHandle.jsonValue();
    await readinessHandle.dispose();
    console.log(`READY scenario=${scenario} ${JSON.stringify(readiness)}`);
  } catch (error) {
    throw new Error(
      `Audit targets did not become ready for scenario=${scenario} within ` +
      `${AUDIT_TARGET_TIMEOUT_MS}ms: ${error}`,
    );
  }
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
      const summaryCard = document.querySelector('[data-testid="usage-overview-summary-card"]');
      const toolbar = summaryCard?.previousElementSibling;
      const actions = [
        ...(toolbar?.querySelectorAll('button:not([role="tab"]), select') || []),
      ];
      if (actions.length !== 3) {
        throw new Error(`Expected three dashboard core actions, received ${actions.length}`);
      }
      actions.forEach((action, index) => add(action, `dashboard-core-action-${index}`));
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
        hasHook:
          active.classList.contains("tt-analytics-focusable")
          || active.classList.contains("tt-product-focusable"),
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

async function readCostCardStyles(page) {
  return page.evaluate(() => {
    const apiIcon = document.querySelector('[data-testid="cost-summary-icon-api"]');
    const api = apiIcon?.closest('[data-testid="cost-summary-card"]');
    const subscriptionIcon = document.querySelector('[data-testid="cost-summary-icon-subscription"]');
    const subscription = subscriptionIcon?.closest('[data-testid="cost-summary-card"]');
    const combinedTotal = document.querySelector('[data-cost-summary-card="total"]');
    if (!api || !subscription) throw new Error("Missing separated cost summary cards");

    return {
      cardCount: document.querySelectorAll('[data-testid="cost-summary-card"]').length,
      hasCombinedTotal: Boolean(combinedTotal),
      apiKeepsNestedSurface: api.classList.contains("tt-surface-nested"),
      subscriptionKeepsNestedSurface: subscription.classList.contains("tt-surface-nested"),
      apiTone: apiIcon?.dataset.tone ?? null,
      subscriptionTone: subscriptionIcon?.dataset.tone ?? null,
    };
  });
}

async function auditPage(browser, baseUrl, pageName, pathName, theme) {
  const context = await browser.newContext({
    viewport: { width: 1512, height: 997 },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  await context.addInitScript((value) => {
    localStorage.setItem("tokentracker-theme", value);
    localStorage.setItem("tokentracker.firstRun.completed.v1", "1");
  }, theme);
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}${pathName}?theme=${theme}&${MOCK_QUERY}`, {
      waitUntil: "networkidle",
    });
    await waitForAuditTargets(page, pageName, theme);
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
      const cards = await readCostCardStyles(page);
      console.log(`CARDS cost ${theme} ${JSON.stringify(cards)}`);
      if (cards.cardCount !== 2 || cards.hasCombinedTotal) {
        failures.push("cost cards no longer keep estimated usage and subscription spend separate");
      }
      if (!cards.apiKeepsNestedSurface || !cards.subscriptionKeepsNestedSurface) {
        failures.push("a separated cost card lost tt-surface-nested");
      }
      if (!cards.apiTone || !cards.subscriptionTone || cards.apiTone === cards.subscriptionTone) {
        failures.push("estimated usage and subscription cards lost distinct visual tones");
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
    server = startViteServer(port);
    await waitForViteServer(baseUrl, server);
    browser = await chromium.launch();
    for (const theme of ["light", "dark"]) {
      for (const [pageName, pathName] of [
        ["dashboard", "/dashboard"],
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
    await stopViteServer(baseUrl, server);
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length}/4 dashboard/cost style audits failed`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
