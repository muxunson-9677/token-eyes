import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:5173";
const outputDir = ".codex-artifacts/ui-repair-baseline";
const routes = [
  ["overview", "/dashboard"],
  ["reset", "/reset-history"],
  ["widgets", "/widgets"],
  ["usage", "/spend/usage"],
  ["diagnostics", "/settings/data"],
];
const viewports = [
  ["normal", { width: 1220, height: 912 }],
  ["minimum", { width: 900, height: 600 }],
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const [sizeName, viewport] of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("theme", selectedTheme);
        localStorage.setItem("tt.theme", selectedTheme);
      }, theme);
      for (const [routeName, route] of routes) {
        const startedAt = Date.now();
        await page.goto(`${baseUrl}${route}?native_windows_preview=1`, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.waitForTimeout(routeName === "usage" ? 1800 : 700);
        await page.evaluate(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
          for (const element of document.querySelectorAll("*")) {
            if (element.scrollTop) element.scrollTop = 0;
            if (element.scrollLeft) element.scrollLeft = 0;
          }
        });
        const metrics = await page.evaluate(() => {
          const shell = document.querySelector(".tt-app-shell");
          const main = document.querySelector("main");
          const selectors = [
            ".tt-overview-stat-card",
            "[data-testid='usage-chart-token-services-layout']",
            "[data-testid='usage-trend-plot']",
            "[data-testid='token-service-list']",
            "[data-testid='data-ledger-diagnostics']",
            "[data-testid='data-privacy-boundary']",
            ".tt-reset-activity-data--right-aligned",
          ];
          const boxes = Object.fromEntries(selectors.map((selector) => [selector, [...document.querySelectorAll(selector)].map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              scrollWidth: element.scrollWidth,
              scrollHeight: element.scrollHeight,
              clientWidth: element.clientWidth,
              clientHeight: element.clientHeight,
            };
          })]));
          const overflow = [...document.querySelectorAll("main article, main section, main [data-testid], main .tt-surface, main .tt-surface-nested")]
            .filter((element) => element.clientWidth > 0 && element.clientHeight > 0)
            .filter((element) => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
            .slice(0, 40)
            .map((element) => ({
              testId: element.getAttribute("data-testid"),
              className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
              client: [element.clientWidth, element.clientHeight],
              scroll: [element.scrollWidth, element.scrollHeight],
            }));
          return {
            document: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
            main: main ? [main.scrollWidth, main.clientWidth, main.scrollHeight, main.clientHeight] : null,
            shell: shell ? [shell.scrollWidth, shell.clientWidth, shell.scrollHeight, shell.clientHeight] : null,
            boxes,
            overflow,
          };
        });
        const fileName = `${sizeName}-${theme}-${routeName}.png`;
        await page.screenshot({ path: `${outputDir}/${fileName}`, fullPage: false });
        results.push({ sizeName, viewport, theme, route, loadMs: Date.now() - startedAt, fileName, metrics });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(`${outputDir}/metrics.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results.map(({ sizeName, theme, route, loadMs, metrics }) => ({
  sizeName,
  theme,
  route,
  loadMs,
  document: metrics.document,
  main: metrics.main,
  overflowCount: metrics.overflow.length,
  overflow: metrics.overflow.slice(0, 8),
})), null, 2));
