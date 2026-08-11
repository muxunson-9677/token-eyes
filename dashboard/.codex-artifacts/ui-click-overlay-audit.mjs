import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const width = Number(process.argv[2] || 1329);
const height = Number(process.argv[3] || (width <= 900 ? 600 : 912));
const label = String(process.argv[4] || "check").replace(/[^a-z0-9_-]/gi, "-");
const outDir = `.codex-artifacts/click-overlay-${width}x${height}-${label}`;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height } });
const result = { viewport: { width, height } };

const load = async (route) => {
  await page.goto(`http://127.0.0.1:5173${route}?native_windows_preview=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2200);
};

try {
  await load("/widgets");
  const widgetButton = page.locator(".tt-widgets-heading button:not(:disabled)").first();
  await widgetButton.scrollIntoViewIfNeeded();
  const box = await widgetButton.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(18);
  await page.mouse.up();
  await page.waitForTimeout(62);
  const pressedFrame = await widgetButton.evaluate((node) => ({
    classActive: node.classList.contains("tt-widget-click-bounce"),
    transform: getComputedStyle(node).transform,
    animationName: getComputedStyle(node).animationName,
  }));
  await page.waitForTimeout(70);
  const reboundFrame = await widgetButton.evaluate((node) => ({
    classActive: node.classList.contains("tt-widget-click-bounce"),
    transform: getComputedStyle(node).transform,
    animationName: getComputedStyle(node).animationName,
  }));
  await page.screenshot({ path: `${outDir}/widget-click-pressed-frame.png` });
  await page.waitForTimeout(170);
  const settledFrame = await widgetButton.evaluate((node) => ({
    classActive: node.classList.contains("tt-widget-click-bounce"),
    transform: getComputedStyle(node).transform,
    animationName: getComputedStyle(node).animationName,
  }));
  result.widgetClick = {
    pressedFrame,
    reboundFrame,
    settledFrame,
    fullCycleVisible: pressedFrame.classActive
      && pressedFrame.animationName === "tt-widget-press-rebound"
      && reboundFrame.classActive
      && !settledFrame.classActive,
  };

  await load("/dashboard");
  const providerPanel = page.getByTestId("usage-overview-providers");
  const providerCard = providerPanel.locator(".tt-provider-card").first();
  const lowerGrid = page.getByTestId("dashboard-detail-grid");
  await providerCard.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="usage-overview-providers"]');
    const lower = document.querySelector('[data-testid="dashboard-detail-grid"]');
    const panelRect = panel.getBoundingClientRect();
    const lowerRect = lower.getBoundingClientRect();
    return { panelHeight: panelRect.height, lowerTop: lowerRect.top };
  });
  await providerCard.click();
  await page.waitForTimeout(500);
  const overlay = page.locator(".tt-provider-expanded-region");
  const after = await overlay.evaluate((region) => {
    const panel = region.closest('[data-testid="usage-overview-providers"]');
    const lower = document.querySelector('[data-testid="dashboard-detail-grid"]');
    const panelRect = panel.getBoundingClientRect();
    const lowerRect = lower.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();
    const style = getComputedStyle(region);
    return {
      panelHeight: panelRect.height,
      lowerTop: lowerRect.top,
      regionTop: regionRect.top,
      regionBottom: regionRect.bottom,
      position: style.position,
      zIndex: style.zIndex,
      overlayCoversLowerGrid: regionRect.top < lowerRect.bottom && regionRect.bottom > lowerRect.top,
      insideViewportWidth: regionRect.left >= 0 && regionRect.right <= innerWidth + 1,
    };
  });
  result.providerOverlay = {
    before,
    after,
    panelHeightStable: Math.abs(before.panelHeight - after.panelHeight) < 0.5,
    lowerGridStable: Math.abs(before.lowerTop - after.lowerTop) < 0.5,
    absoluteOverlay: after.position === "absolute" && Number(after.zIndex) >= 40,
  };
  await overlay.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${outDir}/provider-overlay.png` });

  result.noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );
  result.passed = result.widgetClick.fullCycleVisible
    && result.providerOverlay.panelHeightStable
    && result.providerOverlay.lowerGridStable
    && result.providerOverlay.absoluteOverlay
    && result.providerOverlay.after.overlayCoversLowerGrid
    && result.providerOverlay.after.insideViewportWidth
    && result.noHorizontalOverflow;

  await writeFile(`${outDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
