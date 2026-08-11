import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import {
  createTemporaryDashboardServerConfig,
  getEphemeralPort,
} from "./visual-baseline-runtime.js";

const hostname = "127.0.0.1";
const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const externalBaseUrl = process.env.TOKENTRACKER_DASHBOARD_BASE_URL?.replace(/\/+$/u, "") || null;
const port = externalBaseUrl ? null : await getEphemeralPort(hostname);
const server = externalBaseUrl ? null : await createServer(createTemporaryDashboardServerConfig({
  dashboardRoot,
  hostname,
  port,
}));

let browser;

function roundedBox(box) {
  if (!box) return null;
  return Object.fromEntries(
    Object.entries(box).map(([key, value]) => [key, Math.round(value * 10) / 10]),
  );
}

try {
  await server?.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("theme-journey-seeded")) return;
    localStorage.setItem("tokentracker-theme", "light");
    sessionStorage.setItem("theme-journey-seeded", "true");
  });

  const baseUrl = externalBaseUrl || `http://${hostname}:${port}`;
  const dataParams = externalBaseUrl
    ? ""
    : "&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12:00:00Z";
  const url = `${baseUrl}/dashboard?screenshot=1${dataParams}`;
  const startedAt = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="dashboard-primary-workspace"]', { state: "visible" });
  const initialReadyMs = Date.now() - startedAt;

  const trigger = page.locator(".tt-theme-trigger");
  const lightLabel = (await trigger.textContent())?.trim();
  if (!lightLabel) throw new Error("The expanded sidebar theme trigger has no visible label.");

  const layoutBefore = {
    sidebar: roundedBox(await page.locator(".tt-sidebar-material").first().boundingBox()),
    workspace: roundedBox(await page.locator('[data-testid="dashboard-primary-workspace"]').boundingBox()),
  };

  await trigger.click();
  const themeItems = page.locator('[role="menu"] button');
  if (await themeItems.count() !== 3) throw new Error("The light, dark, and system theme options are not all present.");
  await themeItems.nth(1).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));

  const storedTheme = await page.evaluate(() => localStorage.getItem("tokentracker-theme"));
  if (storedTheme !== "dark") throw new Error(`Dark theme was not persisted: ${storedTheme}`);
  const darkLabel = (await trigger.textContent())?.trim();
  if (!darkLabel || darkLabel === lightLabel) throw new Error("The visible theme label did not update after switching to dark.");

  const layoutAfter = {
    sidebar: roundedBox(await page.locator(".tt-sidebar-material").first().boundingBox()),
    workspace: roundedBox(await page.locator('[data-testid="dashboard-primary-workspace"]').boundingBox()),
  };
  if (JSON.stringify(layoutAfter) !== JSON.stringify(layoutBefore)) {
    throw new Error(`Theme switching changed layout geometry: ${JSON.stringify({ layoutBefore, layoutAfter })}`);
  }

  const reloadAt = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="dashboard-primary-workspace"]', { state: "visible" });
  const reloadReadyMs = Date.now() - reloadAt;
  if (!await page.locator("html").evaluate((element) => element.classList.contains("dark"))) {
    throw new Error("Dark theme was lost after reload.");
  }
  const reloadedLabel = (await page.locator(".tt-theme-trigger").textContent())?.trim();
  if (reloadedLabel !== darkLabel) throw new Error("The visible dark label was lost after reload.");

  console.log(JSON.stringify({
    status: "PASS",
    initialReadyMs,
    reloadReadyMs,
    storedTheme,
    lightLabel,
    darkLabel,
    layout: layoutAfter,
  }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}
