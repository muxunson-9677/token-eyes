import { chromium } from "../dashboard/node_modules/playwright/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = "http://127.0.0.1:5173";
const viewportWidth = Number(process.env.AUDIT_WIDTH || 875);
const viewportHeight = Number(process.env.AUDIT_HEIGHT || 805);
const outputName = viewportWidth === 875 && viewportHeight === 805
  ? "widget-control-visual-audit"
  : `widget-control-visual-audit-${viewportWidth}x${viewportHeight}`;
const outputDir = path.resolve(`.codex-artifacts/${outputName}`);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

const styleOf = (locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return {
    tag: element.tagName,
    role: element.getAttribute("role"),
    classes: element.className,
    width: box.width,
    height: box.height,
    border: style.border,
    borderRadius: style.borderRadius,
    background: style.background,
    boxShadow: style.boxShadow,
    transform: style.transform,
    transition: style.transition,
  };
});

await page.goto(`${baseUrl}/settings/basic`, { waitUntil: "networkidle" });
const settingsCard = page.locator("#settings-appearance");
await settingsCard.waitFor({ state: "visible" });
const settingsLanguage = page.locator(".tt-settings-language-select");
const settingsCurrency = page.locator(".tt-settings-currency-select");
await settingsCard.screenshot({ path: path.join(outputDir, "reference-basic-settings.png") });
const settingsStyles = {
  settingsLanguage: await styleOf(settingsLanguage),
  settingsCurrency: await styleOf(settingsCurrency),
};

await page.goto(`${baseUrl}/widgets`, { waitUntil: "networkidle" });
const manager = page.getByTestId("widget-manager");
await manager.waitFor({ state: "visible" });
const chooseFolder = page.locator(".tt-widget-project-add");
const status = page.locator(".tt-widget-toolbar-select").first();
const refresh = page.locator(".tt-widget-limits > header > button");
const toolbar = page.locator(".tt-widget-project-toolbar");

await manager.screenshot({ path: path.join(outputDir, "widgets-resting.png") });
await toolbar.screenshot({ path: path.join(outputDir, "widgets-toolbar-resting.png") });
const normal = {
  ...settingsStyles,
  chooseFolder: await styleOf(chooseFolder),
  status: await styleOf(status),
  refresh: await styleOf(refresh),
};

const box = await chooseFolder.boundingBox();
if (!box) throw new Error("Choose-folder control is not visible");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(90);
const pressed = await styleOf(chooseFolder);
await manager.screenshot({ path: path.join(outputDir, "widgets-pressed.png") });
await toolbar.screenshot({ path: path.join(outputDir, "widgets-toolbar-pressed.png") });
await page.mouse.up();
await page.waitForTimeout(150);
const rebound = await styleOf(chooseFolder);
await manager.screenshot({ path: path.join(outputDir, "widgets-rebound.png") });
await page.waitForTimeout(240);
const settled = await styleOf(chooseFolder);

await status.click();
const statusList = page.getByRole("listbox", { name: /状态：全部|Status/ });
await statusList.waitFor({ state: "visible" });
const statusOption = statusList.getByRole("option").nth(1);
const chosenStatusText = await statusOption.textContent();
await page.screenshot({ path: path.join(outputDir, "widgets-status-open.png") });
await statusOption.click();

const refreshBox = await refresh.boundingBox();
if (!refreshBox) throw new Error("Refresh control is not visible");
await page.mouse.move(refreshBox.x + refreshBox.width / 2, refreshBox.y + refreshBox.height / 2);
await page.mouse.down();
await page.waitForTimeout(90);
const refreshPressed = await styleOf(refresh);
await page.mouse.up();
await page.waitForTimeout(360);
const refreshSettled = await styleOf(refresh);

const report = {
  viewport: { width: viewportWidth, height: viewportHeight },
  normal,
  pressed,
  rebound,
  settled,
  dropdown: { chosenStatusText, valueAfterSelection: await status.textContent() },
  refreshPressed,
  refreshSettled,
  consoleErrors,
};
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
