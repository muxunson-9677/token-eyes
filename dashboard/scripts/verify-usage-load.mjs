import { chromium } from "playwright";

const baseUrl = process.env.TOKENTRACKER_DASHBOARD_BASE_URL?.replace(/\/+$/u, "");
if (!baseUrl) {
  throw new Error("TOKENTRACKER_DASHBOARD_BASE_URL must point at the running installed runtime.");
}

const browser = await chromium.launch();
const runs = [];

try {
  for (let run = 1; run <= 3; run += 1) {
    const page = await browser.newPage({ viewport: { width: 1512, height: 997 } });
    await page.addInitScript(() => localStorage.setItem("tokentracker-theme", "light"));
    const startedAt = Date.now();

    await page.goto(`${baseUrl}/spend/usage`, { waitUntil: "domcontentloaded" });
    const domContentLoadedMs = Date.now() - startedAt;
    await page.waitForSelector('[data-testid="usage-stats-layout"]', {
      state: "visible",
      timeout: 30_000,
    });
    const primaryStatsMs = Date.now() - startedAt;
    await page.waitForSelector('[data-testid="usage-trend-plot"]', {
      state: "visible",
      timeout: 30_000,
    });
    const trendReadyMs = Date.now() - startedAt;
    await page.waitForSelector('[data-testid="token-service-list"]', {
      state: "visible",
      timeout: 30_000,
    });
    const servicesReadyMs = Date.now() - startedAt;

    runs.push({
      run,
      domContentLoadedMs,
      primaryStatsMs,
      trendReadyMs,
      servicesReadyMs,
    });
    await page.close();
  }

  console.log(JSON.stringify({ status: "PASS", runs }, null, 2));
} finally {
  await browser.close();
}
