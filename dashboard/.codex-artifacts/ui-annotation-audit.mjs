import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const width = Number(process.argv[2] || 1218);
const height = Number(process.argv[3] || (width <= 900 ? 600 : 803));
const runLabel = String(process.argv[4] || "round1").replace(/[^a-z0-9_-]/gi, "-");
const outDir = `.codex-artifacts/annotation-${width}x${height}-${runLabel}`;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height } });
const result = { viewport: { width, height } };

const load = async (route) => {
  await page.goto(`http://127.0.0.1:5173${route}?native_windows_preview=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1800);
};

const readMaterial = (locator) => locator.evaluate((node) => {
  const style = getComputedStyle(node);
  return {
    borderWidth: style.borderTopWidth,
    backgroundImage: style.backgroundImage,
    boxShadow: style.boxShadow,
    transform: style.transform,
    animationName: style.animationName,
    className: node.className,
  };
});

const exercisePress = async ({ pointerTarget, visualSurface, screenshotPath }) => {
  await visualSurface.scrollIntoViewIfNeeded();
  const normal = await readMaterial(visualSurface);
  const box = await pointerTarget.boundingBox();
  if (!box) throw new Error("Press target is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(55);
  const pressed = await readMaterial(visualSurface);
  await page.screenshot({ path: screenshotPath });
  await page.mouse.up();
  await page.waitForTimeout(105);
  const rebound = await readMaterial(visualSurface);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(190);
  const settled = await readMaterial(visualSurface);
  return {
    normal,
    pressed,
    rebound,
    settled,
    visibleDepth: normal.borderWidth !== "0px"
      && normal.boxShadow !== "none"
      && normal.backgroundImage !== "none",
    pressedVisible: pressed.transform !== "none"
      && pressed.transform !== normal.transform
      && pressed.animationName === "tt-widget-press-rebound",
    settledCleanly: settled.animationName === "none" && settled.transform === "none",
  };
};

try {
  await load("/widgets");
  const toolbarButton = page.locator(".tt-widget-project-toolbar > button:not(:disabled)").first();
  result.toolbarButton = await exercisePress({
    pointerTarget: toolbarButton,
    visualSurface: toolbarButton,
    screenshotPath: `${outDir}/widgets-toolbar-button-pressed.png`,
  });

  const toolbarSelect = page.locator(".tt-widget-project-toolbar .tt-widget-toolbar-select select").first();
  const toolbarSelectSurface = toolbarSelect.locator("xpath=..");
  result.toolbarSelect = await exercisePress({
    pointerTarget: toolbarSelect,
    visualSurface: toolbarSelectSurface,
    screenshotPath: `${outDir}/widgets-toolbar-select-pressed.png`,
  });

  const refreshButton = page.locator(".tt-widget-limits > header > button:not(:disabled)");
  result.refreshButton = await exercisePress({
    pointerTarget: refreshButton,
    visualSurface: refreshButton,
    screenshotPath: `${outDir}/widgets-refresh-pressed.png`,
  });
  result.widgetsNoHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
  );

  await load("/reset-history");
  const resetSelect = page.locator(".tt-reset-effect-control").first();
  result.resetSelect = await exercisePress({
    pointerTarget: resetSelect,
    visualSurface: resetSelect,
    screenshotPath: `${outDir}/reset-effect-select-pressed.png`,
  });

  await load("/dashboard");
  const providerCard = page.locator(".tt-overview-provider-panel .tt-provider-card").first();
  await providerCard.scrollIntoViewIfNeeded();
  await providerCard.click();
  await page.waitForTimeout(450);
  const providerRegion = page.locator(".tt-provider-expanded-region");
  await providerRegion.scrollIntoViewIfNeeded();
  result.provider = await providerRegion.evaluate((region) => {
    const rect = region.getBoundingClientRect();
    const content = region.firstElementChild;
    const contentRect = content.getBoundingClientRect();
    const rows = [...region.querySelectorAll(".space-y-3 > div")];
    const rowRects = rows.map((row) => row.getBoundingClientRect());
    const style = getComputedStyle(region);
    return {
      padding: style.padding,
      overflowX: style.overflowX,
      scrollbarGutter: style.scrollbarGutter,
      leftGap: Math.round(contentRect.left - rect.left),
      rightGap: Math.round(rect.right - contentRect.right),
      noHorizontalOverflow: region.scrollWidth <= region.clientWidth + 1,
      rowsInsideSafeArea: rowRects.every((row) => (
        row.left >= rect.left + 14 && row.right <= rect.right - 14
      )),
      contentVisible: rect.width > 0 && rect.height > 0,
    };
  });
  await page.screenshot({ path: `${outDir}/dashboard-provider-safe-padding.png` });

  const pressChecks = [result.toolbarButton, result.toolbarSelect, result.refreshButton, result.resetSelect];
  result.passed = pressChecks.every((check) => (
    check.visibleDepth && check.pressedVisible && check.settledCleanly
  )) && result.widgetsNoHorizontalOverflow
    && result.provider.padding === "14px 16px 16px"
    && result.provider.overflowX === "hidden"
    && result.provider.leftGap >= 15
    && result.provider.rightGap >= 15
    && result.provider.noHorizontalOverflow
    && result.provider.rowsInsideSafeArea
    && result.provider.contentVisible;

  await writeFile(`${outDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
