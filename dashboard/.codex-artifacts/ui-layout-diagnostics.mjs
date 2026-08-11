import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const viewportWidth = Number(process.argv[2] ?? 900);
const page = await browser.newPage({ viewport: { width: viewportWidth, height: 600 } });

for (const [route, selectors] of [
  ["/dashboard", ["[data-testid='usage-overview-hero']", "[data-testid='usage-overview-hero'] > div"]],
  ["/settings/data", [".tt-reference-route-settings-data .tt-main-work-surface main > .mx-auto", "[data-testid='data-source-summary']", "[data-testid='data-health-toolbar']", "[data-testid='data-ledger-diagnostics']", "[data-testid='data-privacy-boundary']"]],
  ["/spend/usage", [".tt-usage-filter-toolbar", ".tt-usage-source-switcher", ".tt-usage-filter-controls"]],
  ["/widgets", [".tt-widget-manager", ".tt-widget-projects", ".tt-widget-project-toolbar"]],
]) {
  await page.goto(`http://127.0.0.1:5173${route}?native_windows_preview=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(route === "/spend/usage" ? 1_800 : 800);
  const result = await page.evaluate((targets) => Object.fromEntries(targets.map((selector) => {
    const element = document.querySelector(selector);
    if (!element) return [selector, null];
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return [selector, {
      className: element.className,
      display: style.display,
      flexDirection: style.flexDirection,
      flexWrap: style.flexWrap,
      gridTemplateColumns: style.gridTemplateColumns,
      position: style.position,
      overflow: style.overflow,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      children: [...element.children].map((child) => {
        const childStyle = getComputedStyle(child);
        const childRect = child.getBoundingClientRect();
        return {
          tag: child.tagName,
          className: child.className,
          position: childStyle.position,
          left: Math.round(childRect.left),
          right: Math.round(childRect.right),
          width: Math.round(childRect.width),
        };
      }),
    }];
  })), selectors);
  console.log(route, JSON.stringify(result, null, 2));
}

await browser.close();
