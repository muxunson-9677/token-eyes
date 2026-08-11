import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const width = Number(process.argv[2] || 1329);
const height = Number(process.argv[3] || (width <= 900 ? 600 : 912));
const runLabel = String(process.argv[4] || "final").replace(/[^a-z0-9_-]/gi, "-");
const baseUrl = "http://127.0.0.1:5173";
const outDir = `.codex-artifacts/followup-${width}x${height}-${runLabel}`;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height } });
const result = { viewport: { width, height } };

const load = async (route) => {
  await page.goto(`${baseUrl}${route}?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
};

try {
  await load("/reset-history");
  const heatmap = page.locator(".tt-reset-activity-data--right-aligned");
  await heatmap.scrollIntoViewIfNeeded();
  result.heatmap = await heatmap.evaluate((group) => {
    const parent = group.parentElement;
    const rect = group.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const copy = parent.querySelector(".tt-reset-activity-copy") || parent.firstElementChild;
    const copyRect = copy?.getBoundingClientRect();
    const labels = [...group.querySelectorAll(".tt-reset-heatmap-label")].map((node) => node.getBoundingClientRect());
    return {
      display: getComputedStyle(group).display,
      rightGap: Math.round(parentRect.right - rect.right),
      sameRowAsCopy: !copyRect || Math.abs(copyRect.top - rect.top) < Math.max(copyRect.height, rect.height),
      fitsParent: rect.left >= parentRect.left && rect.right <= parentRect.right + 1,
      labelsDoNotOverlap: labels.every((item, index) => index === labels.length - 1 || item.right <= labels[index + 1].left + 1),
      group: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  });
  await page.screenshot({ path: `${outDir}/reset-heatmap.png` });

  await load("/dashboard");
  const granularity = page.getByTestId("trend-granularity");
  result.trendBefore = await granularity.evaluate((node) => ({ tag: node.tagName, disabled: node.disabled, expanded: node.getAttribute("aria-expanded") }));
  await granularity.click();
  await page.waitForTimeout(250);
  result.trendAfter = {
    expanded: await granularity.getAttribute("aria-expanded"),
    dialogVisible: await page.locator('[role="dialog"]').count() > 0,
    dialogFitsViewport: await page.locator('[role="dialog"]').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    }),
  };
  await page.screenshot({ path: `${outDir}/trend-granularity-open.png` });
  await page.keyboard.press("Escape");

  const providerCard = page.locator(".tt-overview-provider-panel .tt-provider-card").first();
  await providerCard.scrollIntoViewIfNeeded();
  await providerCard.click();
  await page.waitForTimeout(700);
  const providerRegion = page.locator(".tt-provider-expanded-region");
  result.provider = await providerRegion.evaluate((region) => {
    const panel = region.closest(".tt-overview-provider-panel");
    const regionRect = region.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const modelRows = [...region.querySelectorAll(".space-y-3 > div")];
    const rowRects = modelRows.map((row) => row.getBoundingClientRect());
    return {
      visible: regionRect.height > 0,
      panelContainsRegion: regionRect.bottom <= panelRect.bottom + 1,
      panelScrollFits: panel.scrollHeight <= panel.clientHeight + 2,
      rowsDoNotOverlap: rowRects.every((row, index) => index === rowRects.length - 1 || row.bottom <= rowRects[index + 1].top + 1),
      regionHeight: Math.round(regionRect.height),
      panelHeight: Math.round(panelRect.height),
    };
  });
  await providerRegion.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outDir}/provider-expanded.png` });

  const projectsTab = page.getByRole("tab", { name: /项目用量/ });
  await projectsTab.click();
  const projectViewport = page.getByTestId("project-scroll-viewport");
  const projectToggle = page.locator(".tt-overview-project-toggle").first();
  await projectViewport.scrollIntoViewIfNeeded();
  const projectBefore = await projectViewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, width: rect.width, height: rect.height, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop };
  });
  await projectToggle.click();
  await page.waitForTimeout(300);
  const projectAfter = await projectViewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, width: rect.width, height: rect.height, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop };
  });
  result.projects = {
    before: projectBefore,
    after: projectAfter,
    trackPositionStable: Math.abs(projectBefore.x - projectAfter.x) < 0.5 && Math.abs(projectBefore.width - projectAfter.width) < 0.5,
    viewportStable: Math.abs(projectBefore.height - projectAfter.height) < 0.5,
    scrollExtentStable: Math.abs(projectBefore.scrollHeight - projectAfter.scrollHeight) <= 1,
    scrollPositionStable: Math.abs(projectBefore.scrollTop - projectAfter.scrollTop) <= 1,
    cardsDoNotOverlap: await page.locator('[data-testid="project-usage-grid"]').evaluate((grid) => {
      const cards = [...grid.querySelectorAll('[data-testid="project-usage-card"]')].map((card) => card.getBoundingClientRect());
      return cards.every((first, index) => cards.slice(index + 1).every((second) => (
        first.right <= second.left + 1 || second.right <= first.left + 1 || first.bottom <= second.top + 1 || second.bottom <= first.top + 1
      )));
    }),
  };
  await page.screenshot({ path: `${outDir}/projects-expanded.png` });

  await load("/widgets");
  const widgetButton = page.locator("button:not(:disabled)").filter({ hasText: /显示桌面小组件/ }).first();
  await widgetButton.scrollIntoViewIfNeeded();
  const box = await widgetButton.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const normal = await widgetButton.evaluate((node) => ({ transform: getComputedStyle(node).transform, filter: getComputedStyle(node).filter, shadow: getComputedStyle(node).boxShadow }));
  await page.mouse.down();
  await page.waitForTimeout(100);
  const pressed = await widgetButton.evaluate((node) => ({ transform: getComputedStyle(node).transform, filter: getComputedStyle(node).filter, shadow: getComputedStyle(node).boxShadow }));
  await page.screenshot({ path: `${outDir}/widget-button-pressed.png` });
  await page.mouse.up();
  result.widgetPress = { normal, pressed, changed: JSON.stringify(normal) !== JSON.stringify(pressed) };

  result.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  result.passed = result.heatmap.sameRowAsCopy && result.heatmap.fitsParent && result.heatmap.labelsDoNotOverlap
    && result.trendAfter.dialogVisible && result.trendAfter.dialogFitsViewport && result.provider.visible && result.provider.panelContainsRegion
    && result.provider.rowsDoNotOverlap && result.projects.trackPositionStable && result.projects.viewportStable
    && result.projects.scrollExtentStable && result.projects.scrollPositionStable && result.projects.cardsDoNotOverlap && result.widgetPress.changed
    && result.noHorizontalOverflow;
  await writeFile(`${outDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
