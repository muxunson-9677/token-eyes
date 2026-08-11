import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:5173";
const viewportWidth = Number(process.argv[2] ?? 1220);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: viewportWidth, height: viewportWidth <= 900 ? 600 : 912 } });
const page = await context.newPage();
const results = {};

const resetScroll = () => page.evaluate(() => {
  window.scrollTo(0, 0);
  for (const element of document.querySelectorAll("*")) {
    if (element.scrollTop) element.scrollTop = 0;
    if (element.scrollLeft) element.scrollLeft = 0;
  }
});

try {
  await page.goto(`${baseUrl}/dashboard?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_500);
  await page.locator(".tt-overview-provider-panel .tt-provider-card").first()
    .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  await resetScroll();
  results.overview = await page.evaluate(() => {
    const statCards = [...document.querySelectorAll(".tt-overview-stat-card")];
    const panel = document.querySelector(".tt-overview-provider-panel");
    const providerCards = [...document.querySelectorAll(".tt-overview-provider-panel .tt-provider-card")];
    const panelRect = panel?.getBoundingClientRect();
    return {
      documentHasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      statCardCount: statCards.length,
      statCardsFit: statCards.every((card) => card.scrollWidth <= card.clientWidth + 2 && card.scrollHeight <= card.clientHeight + 2),
      statCardSizes: statCards.map((card) => {
        const rect = card.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      }),
      providerCardCount: providerCards.length,
      providerCardsFitPanel: !panelRect || providerCards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= panelRect.left - 1 && rect.right <= panelRect.right + 1;
      }),
    };
  });

  await page.goto(`${baseUrl}/reset-history?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);
  await resetScroll();
  results.resetHistory = await page.evaluate(() => {
    const group = document.querySelector(".tt-reset-activity-data--right-aligned");
    const parent = group?.parentElement;
    const heatmap = group?.querySelector(".tt-reset-heatmap");
    const groupRect = group?.getBoundingClientRect();
    const parentRect = parent?.getBoundingClientRect();
    const cells = [...(group?.querySelectorAll(".tt-reset-heatmap-cells span") ?? [])];
    const labels = [...(group?.querySelectorAll(".tt-reset-heatmap-label") ?? [])];
    const labelRects = labels.map((label) => label.getBoundingClientRect());
    return {
      exists: Boolean(group && heatmap),
      rightGap: groupRect && parentRect ? Math.round(parentRect.right - groupRect.right) : null,
      heatmapWidth: heatmap ? Math.round(heatmap.getBoundingClientRect().width) : null,
      uniformCells: new Set(cells.map((cell) => `${cell.clientWidth}x${cell.clientHeight}`)).size <= 1,
      labelsDoNotOverlap: labelRects.every((rect, index) => (
        index === labelRects.length - 1 || rect.right <= labelRects[index + 1].left + 1
      )),
      labelsFitColumns: labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
    };
  });

  await page.goto(`${baseUrl}/widgets?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await resetScroll();
  const pressButton = page.getByRole("button", { name: /显示桌面小组件/ }).first();
  const beforeTransform = await pressButton.evaluate((element) => getComputedStyle(element).transform);
  const bounds = await pressButton.boundingBox();
  if (!bounds) throw new Error("Widget action button is not visible");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const pressedTransform = await pressButton.evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.up();
  const releasedTransform = await pressButton.evaluate((element) => getComputedStyle(element).transform);
  results.widgets = {
    beforeTransform,
    pressedTransform,
    releasedTransform,
    pressFeedbackWorked: pressedTransform !== beforeTransform && pressedTransform !== "none",
    documentHasHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2),
  };

  await page.goto(`${baseUrl}/spend/usage?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4_000);
  await resetScroll();
  const tabs = page.getByRole("tab");
  const providerStart = performance.now();
  await tabs.nth(1).click();
  await page.locator("[data-testid='usage-tabpanel-provider']:not([hidden])").waitFor({ state: "visible" });
  const providerSwitchMs = performance.now() - providerStart;
  const providerSpinnerCount = await page.locator("[data-testid='usage-tabpanel-provider'] .animate-spin").count();
  const modelStart = performance.now();
  await tabs.nth(2).click();
  await page.locator("[data-testid='usage-tabpanel-model']:not([hidden])").waitFor({ state: "visible" });
  const modelSwitchMs = performance.now() - modelStart;
  const modelSpinnerCount = await page.locator("[data-testid='usage-tabpanel-model'] .animate-spin").count();
  results.usage = {
    providerSwitchMs: Math.round(providerSwitchMs),
    modelSwitchMs: Math.round(modelSwitchMs),
    providerSpinnerCount,
    modelSpinnerCount,
    instantSwitch: providerSwitchMs < 250 && modelSwitchMs < 250,
    chartExists: await page.locator("[data-testid='usage-trend-plot']").count() > 0,
    serviceListExists: await page.locator("[data-testid='token-service-list']").count() > 0,
    documentHasHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2),
  };

  await page.goto(`${baseUrl}/settings/data?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  await resetScroll();
  results.diagnostics = await page.evaluate(() => {
    const targets = [
      document.querySelector("[data-testid='data-source-summary']"),
      document.querySelector("[data-testid='data-ledger-diagnostics']"),
      document.querySelector("[data-testid='data-privacy-boundary']"),
    ].filter(Boolean);
    return {
      targetCount: targets.length,
      cardsFit: targets.every((element) => element.scrollWidth <= element.clientWidth + 2),
      documentHasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      principleItemsReadable: [...document.querySelectorAll(".tt-data-privacy-badges > span > span")]
        .every((element) => getComputedStyle(element).display === "block" && element.clientWidth >= 80),
    };
  });

  const failures = [
    results.overview.documentHasHorizontalOverflow || !results.overview.statCardsFit
      || results.overview.providerCardCount < 1 || !results.overview.providerCardsFitPanel,
    !results.resetHistory.exists || Math.abs(results.resetHistory.rightGap ?? 999) > 24
      || !results.resetHistory.uniformCells || !results.resetHistory.labelsDoNotOverlap
      || !results.resetHistory.labelsFitColumns,
    !results.widgets.pressFeedbackWorked || results.widgets.documentHasHorizontalOverflow,
    !results.usage.instantSwitch || !results.usage.chartExists || !results.usage.serviceListExists || results.usage.documentHasHorizontalOverflow,
    !results.diagnostics.cardsFit || results.diagnostics.documentHasHorizontalOverflow || !results.diagnostics.principleItemsReadable,
  ];
  results.passed = failures.every((failed) => !failed);
  await writeFile(`.codex-artifacts/ui-runtime-audit-${viewportWidth}.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
  if (!results.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
