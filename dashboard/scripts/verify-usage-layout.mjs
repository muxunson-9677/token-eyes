import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createScreenshotThemeSetup } from "./visual-baseline-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(__dirname, "..");
const FAILURE_DIR = path.join(DASHBOARD_DIR, "tmp", "usage-layout");
const VIEWPORT = { width: 390, height: 844 };
const THEMES = ["light", "dark"];
const MOCK_PARAMS = {
  screenshot: "1",
  mock: "1",
  mock_seed: "usage-layout",
  mock_today: "2025-12-31",
  mock_now: "2025-12-31T12:00:00Z",
};

const CURRENT_TOTALS = {
  api_usd: 999_999_999.99,
  api_cny: 7_199_999_999.93,
  subscription_usd: 888_888_888.88,
  subscription_cny: 6_399_999_999.94,
  other_ai_usd: 0,
  other_ai_cny: 0,
  combined_usd: 1_888_888_888.87,
  combined_cny: 13_599_999_999.87,
  lifetime_combined_usd: 9_999_999_999.99,
  lifetime_combined_cny: 71_999_999_999.93,
  usd_to_cny: 7.2,
};

const PREVIOUS_TOTALS = {
  api_usd: 0.01,
  api_cny: 0.07,
  subscription_usd: 0.02,
  subscription_cny: 0.14,
  other_ai_usd: 0,
  other_ai_cny: 0,
  combined_usd: 0.03,
  combined_cny: 0.21,
  lifetime_combined_usd: 0.03,
  lifetime_combined_cny: 0.21,
  usd_to_cny: 7.2,
};

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function usageUrl(baseUrl, theme) {
  const url = new URL("/spend/usage", baseUrl);
  for (const [key, value] of Object.entries(MOCK_PARAMS)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("theme", theme);
  return url.toString();
}

async function installLongCostResponses(page) {
  const thisMonth = currentMonthKey();
  await page.route("**/tokentracker-spend-records**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const requestUrl = new URL(route.request().url());
    const from = requestUrl.searchParams.get("from") || "";
    const totals = from.startsWith(thisMonth) ? CURRENT_TOTALS : PREVIOUS_TOTALS;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ records: [], totals }),
    });
  });
}

async function inspectUsageLayout(page) {
  const summary = page.getByTestId("usage-cost-summary");
  await summary.waitFor({ state: "visible", timeout: 20_000 });

  const usd = page.getByTestId("usage-cost-usd");
  const cny = page.getByTestId("usage-cost-cny");
  const comparisons = page.getByTestId("monthly-cost-comparison");
  const counts = {
    usd: await usd.count(),
    cny: await cny.count(),
    comparisons: await comparisons.count(),
  };
  if (counts.usd !== 4 || counts.cny !== 4 || counts.comparisons !== 3) {
    throw new Error(
      `Expected 4 USD values, 4 CNY values and 3 comparisons; received ${JSON.stringify(counts)}`,
    );
  }

  const values = {
    usd: await usd.allTextContents(),
    cny: await cny.allTextContents(),
    comparisons: await comparisons.allTextContents(),
  };
  if (!values.usd.includes("USD 999,999,999.99")) {
    throw new Error(`Long USD fixture did not render: ${JSON.stringify(values.usd)}`);
  }
  if (!values.cny.every((value) => value.trim().length >= 3 && /\d/.test(value))) {
    throw new Error(`Long CNY fixture did not render: ${JSON.stringify(values.cny)}`);
  }
  if (!values.comparisons.every((value) => value.trim().length >= 12 && /\d/.test(value))) {
    throw new Error(`Long comparison fixture did not render: ${JSON.stringify(values.comparisons)}`);
  }

  const geometry = await page.evaluate(() => {
    const metrics = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        testId: node.getAttribute("data-testid"),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        left: rect.left,
        right: rect.right,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    };
    const selectors = [
      '[data-testid="usage-stats-layout"]',
      '[data-testid="usage-cost-summary"]',
      '[data-testid="usage-summary-rail"]',
      '[data-testid="usage-cost-card"]',
    ];
    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      targets: selectors.flatMap((selector) => (
        Array.from(document.querySelectorAll(selector), metrics)
      )),
    };
  });

  if (geometry.documentScrollWidth > geometry.documentClientWidth + 1) {
    throw new Error(
      `Document overflows horizontally: ${geometry.documentScrollWidth} > ${geometry.documentClientWidth}`,
    );
  }
  if (geometry.targets.length !== 7) {
    throw new Error(`Expected 7 critical layout targets, received ${geometry.targets.length}`);
  }
  for (const target of geometry.targets) {
    if (target.scrollWidth > target.clientWidth + 1) {
      throw new Error(
        `${target.testId} overflows horizontally: ${target.scrollWidth} > ${target.clientWidth}`,
      );
    }
    if (target.scrollHeight > target.clientHeight + 1) {
      throw new Error(
        `${target.testId} is vertically clipped: ${target.scrollHeight} > ${target.clientHeight}`,
      );
    }
    if (target.left < -1 || target.right > geometry.viewportWidth + 1) {
      throw new Error(
        `${target.testId} leaves the viewport: left=${target.left}, right=${target.right}`,
      );
    }
  }

  return { counts, values, geometry };
}

async function run() {
  const baseUrl = readArg(
    "--url",
    process.env.TOKENTRACKER_USAGE_LAYOUT_URL || "http://127.0.0.1:4175",
  );
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const theme of THEMES) {
      const targetUrl = usageUrl(baseUrl, theme);
      const themeSetup = createScreenshotThemeSetup(targetUrl);
      const page = await browser.newPage({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        colorScheme: themeSetup?.colorScheme || theme,
      });
      try {
        if (themeSetup) {
          await page.addInitScript((value) => {
            localStorage.setItem("tokentracker-theme", value);
          }, themeSetup.localStorageTheme);
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        await installLongCostResponses(page);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const inspection = await inspectUsageLayout(page);
        results.push({ theme, status: "PASS", ...inspection });
        console.log(
          `PASS ${theme} ${VIEWPORT.width}x${VIEWPORT.height}: ` +
          `document ${inspection.geometry.documentScrollWidth}/${inspection.geometry.documentClientWidth}`,
        );
      } catch (error) {
        await fs.mkdir(FAILURE_DIR, { recursive: true });
        const screenshot = path.join(FAILURE_DIR, `${VIEWPORT.width}-${theme}-FAIL.png`);
        try {
          await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
        } catch {
          // Preserve the primary audit failure.
        }
        results.push({ theme, status: "FAIL", error: String(error), screenshot });
        console.error(`FAIL ${theme} ${VIEWPORT.width}x${VIEWPORT.height}: ${error}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failures = results.filter((result) => result.status !== "PASS");
  if (failures.length > 0) {
    throw new Error(`${failures.length}/${results.length} usage layout audits failed`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
