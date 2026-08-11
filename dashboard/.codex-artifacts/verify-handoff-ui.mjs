import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const baseUrl = "http://127.0.0.1:5173";
const routes = [
  "/dashboard",
  "/leaderboard",
  "/reset-history",
  "/widgets",
  "/spend/usage",
  "/spend/cost",
  "/settings/basic",
  "/settings/cost",
  "/settings/data",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1220, height: 912 } });
const page = await context.newPage();
const widget = await context.newPage();

try {
  await page.goto(`${baseUrl}/dashboard?native_windows_preview=1`, { waitUntil: "networkidle" });
  await page.locator(".tt-desktop-sidebar").waitFor({ state: "visible" });

  const statusCheck = await page.evaluate(() => {
    const headerStatus = document.querySelectorAll(".tt-native-window-bar .tt-native-status-pill").length;
    const sidebarStatus = document.querySelector(".tt-desktop-sidebar .tt-system-status-control");
    const theme = document.querySelector(".tt-desktop-sidebar .tt-theme-trigger:not(.tt-system-status-control)");
    if (!sidebarStatus || !theme) throw new Error("Sidebar utility controls are missing");
    const statusStyle = getComputedStyle(sidebarStatus);
    const themeStyle = getComputedStyle(theme);
    const statusRect = sidebarStatus.getBoundingClientRect();
    const refreshRect = sidebarStatus.querySelector("button").getBoundingClientRect();
    return {
      headerStatus,
      sidebarStatusCount: document.querySelectorAll(".tt-desktop-sidebar .tt-system-status-control").length,
      sidebarText: sidebarStatus.textContent.replace(/\s+/g, " ").trim(),
      refreshCount: sidebarStatus.querySelectorAll("button").length,
      refreshContained: refreshRect.left >= statusRect.left && refreshRect.right <= statusRect.right,
      sharedStyle: {
        height: [statusStyle.height, themeStyle.height],
        borderRadius: [statusStyle.borderRadius, themeStyle.borderRadius],
        borderColor: [statusStyle.borderColor, themeStyle.borderColor],
        backgroundColor: [statusStyle.backgroundColor, themeStyle.backgroundColor],
        boxShadow: [statusStyle.boxShadow, themeStyle.boxShadow],
      },
    };
  });

  await page.screenshot({
    path: "./.codex-artifacts/dashboard-native-status.png",
    type: "png",
  });

  const measurements = [];
  for (const route of routes) {
    if (new URL(page.url()).pathname !== route) {
      await page.locator(`.tt-desktop-sidebar a[href="${route}"]`).first().click();
      await page.waitForURL((url) => url.pathname === route);
    }
    await page.waitForTimeout(150);
    measurements.push(await page.evaluate((currentRoute) => {
      const sidebar = document.querySelector(".tt-desktop-sidebar");
      const nav = sidebar.querySelector("nav");
      const firstItem = nav.querySelector(".tt-sidebar-item");
      const rect = sidebar.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const firstItemRect = firstItem.getBoundingClientRect();
      const style = getComputedStyle(sidebar);
      return {
        route: currentRoute,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        cssWidth: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        flexBasis: style.flexBasis,
        navLeft: navRect.left,
        navRight: navRect.right,
        navWidth: navRect.width,
        firstItemLeft: firstItemRect.left,
        firstItemRight: firstItemRect.right,
        firstItemWidth: firstItemRect.width,
      };
    }, route));
  }

  await widget.setViewportSize({ width: 520, height: 420 });
  await widget.goto(`${baseUrl}/desktop-widget?preview=1`, { waitUntil: "networkidle" });
  await widget.locator("[data-testid='desktop-widget-card']").waitFor({ state: "visible" });

  await page.locator(".tt-desktop-sidebar a[href='/reset-history']").first().click();
  await page.waitForURL((url) => url.pathname === "/reset-history");
  await page.locator("select").filter({ has: page.locator("option[value='fireworks']") }).selectOption("fireworks");
  await page.locator("[data-testid='reset-history-preview-icon']").locator("..").click();

  await Promise.all([
    page.locator(".tt-reset-celebration[data-effect-id='fireworks']").waitFor({ state: "visible" }),
    widget.locator(".widget-reset-celebration[data-effect-id='fireworks']").waitFor({ state: "visible" }),
  ]);
  await widget.waitForTimeout(350);

  await page.screenshot({
    path: "./.codex-artifacts/reset-history-fireworks.png",
    type: "png",
  });
  await widget.screenshot({
    path: "./.codex-artifacts/desktop-widget-fireworks.png",
    type: "png",
  });

  const mainEffectId = await page.locator(".tt-reset-celebration").getAttribute("data-effect-id");
  await widget.waitForTimeout(6_500);
  const widgetEffectPersisted = await widget.locator(".widget-reset-celebration[data-effect-id='fireworks']").isVisible();
  await widget.locator(".widget-reset-celebration__dismiss").click();
  await widget.locator(".widget-reset-celebration").waitFor({ state: "detached" });

  const uniqueBounds = new Set(measurements.map(({ left, right, width }) => `${left}:${right}:${width}`));
  const uniqueNavGeometry = new Set(measurements.map((measurement) => [
    measurement.navLeft,
    measurement.navRight,
    measurement.navWidth,
    measurement.firstItemLeft,
    measurement.firstItemRight,
    measurement.firstItemWidth,
  ].join(":")));
  const result = {
    statusCheck,
    measurements,
    uniqueBounds: [...uniqueBounds],
    uniqueNavGeometry: [...uniqueNavGeometry],
    synchronizedEffect: {
      main: mainEffectId,
      widget: "fireworks",
      persistedUntilClick: widgetEffectPersisted,
      dismissedByEffectClick: await widget.locator(".widget-reset-celebration").count() === 0,
    },
  };
  await writeFile("./.codex-artifacts/verify-handoff-ui.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (statusCheck.headerStatus !== 0 || statusCheck.sidebarStatusCount !== 1 || statusCheck.refreshCount !== 1) {
    throw new Error("System status placement failed");
  }
  if (!statusCheck.refreshContained) throw new Error("Refresh button overflows the system status control");
  if (Object.values(statusCheck.sharedStyle).some(([statusValue, themeValue]) => statusValue !== themeValue)) {
    throw new Error("System status and theme controls do not share the same material shape");
  }
  if (uniqueBounds.size !== 1) throw new Error("Sidebar bounds changed between routes");
  if (uniqueNavGeometry.size !== 1) throw new Error("Sidebar navigation geometry changed between routes");
  if (
    result.synchronizedEffect.main !== "fireworks"
    || result.synchronizedEffect.widget !== "fireworks"
    || !result.synchronizedEffect.persistedUntilClick
    || !result.synchronizedEffect.dismissedByEffectClick
  ) {
    throw new Error("Celebration effect did not synchronize");
  }
} finally {
  await context.close();
  await browser.close();
}
