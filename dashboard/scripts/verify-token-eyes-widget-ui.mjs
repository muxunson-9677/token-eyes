import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import {
  createTemporaryDashboardServerConfig,
  getEphemeralPort,
} from "./visual-baseline-runtime.js";

const hostname = "127.0.0.1";
const dashboardRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(dashboardRoot, "..");
const outputDir = path.join(repoRoot, "docs", "screenshots", "token-eyes-widget-ui");
const reportPath = path.join(outputDir, "widget-visual-audit-report.json");
const buildTime = new Date().toISOString();
const route = "/desktop-widget";

function gitValue(command) {
  return execFileSync("git", command.split(" "), {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

const provenance = {
  buildTime,
  worktree: gitValue("rev-parse --show-toplevel"),
  branch: gitValue("branch --show-current"),
  head: gitValue("rev-parse HEAD"),
  route,
};
const port = await getEphemeralPort(hostname);
const originalWorkingDirectory = process.cwd();
process.chdir(dashboardRoot);
const server = await createServer(createTemporaryDashboardServerConfig({
  dashboardRoot,
  hostname,
  port,
}));

const basePrefs = {
  version: 11,
  visible: true,
  x: null,
  y: null,
  width: 352,
  height: 76,
  collapsedHeight: 76,
  expandedHeight: 360,
  scaleFactor: 1,
  selectedAgent: "codex",
  mode: "projects",
  expanded: false,
  material: "frost",
  opacity: 0.72,
  alwaysOnTop: true,
  activeSessionWindow: "1h",
  selectedProjectIds: [],
  selectedLimitIds: null,
  selectedProjects: [],
};

const scenarios = [
  { name: "01-compact", prefs: basePrefs, height: 76, expectedCardHeight: 66 },
  { name: "02-agent-menu", prefs: basePrefs, height: 280, expectedCardHeight: 66, openAgentMenu: true },
  { name: "03-projects", prefs: { ...basePrefs, expanded: true }, height: 360, expectedCardHeight: 350 },
  { name: "04-limits", prefs: { ...basePrefs, expanded: true, mode: "limits" }, height: 360, expectedCardHeight: 350 },
  { name: "05-models", prefs: { ...basePrefs, expanded: true, mode: "models" }, height: 360, expectedCardHeight: 350 },
  { name: "06-celebration", prefs: basePrefs, width: 632, height: 356, expectedCardHeight: 66, openCelebration: true },
];

const viewModel = {
  agents: ["all", "claude", "codex", "cursor", "hermes", "deepseek-harness", "workbuddy"],
  selectedAgent: "codex",
  projectStatus: {
    red: 0,
    yellow: 2,
    green: 6,
    unknown: 0,
    projects: [
      {
        id: "token-eyes",
        label: "010-Token eye",
        red: 0,
        yellow: 2,
        green: 4,
        unknown: 0,
        sessions: [
          { id: "token-eyes-active", label: "Token Eyes UI", status: "yellow", state: "running", updatedAt: "2026-08-17T06:00:00.000Z" },
          { id: "token-eyes-review", label: "Merge review", status: "yellow", state: "running", updatedAt: "2026-08-17T05:30:00.000Z" },
          { id: "token-eyes-tests", label: "Widget tests", status: "green", state: "completed", updatedAt: "2026-08-17T05:00:00.000Z" },
          { id: "token-eyes-visual", label: "Visual audit", status: "green", state: "completed", updatedAt: "2026-08-17T04:30:00.000Z" },
          { id: "token-eyes-runtime", label: "Runtime smoke", status: "green", state: "completed", updatedAt: "2026-08-17T04:00:00.000Z" },
          { id: "token-eyes-build", label: "Production build", status: "green", state: "completed", updatedAt: "2026-08-17T03:30:00.000Z" },
          { id: "token-eyes-handoff", label: "Release handoff", status: "green", state: "completed", updatedAt: "2026-08-17T03:00:00.000Z" },
        ],
      },
      { id: "text", label: "text", red: 0, yellow: 0, green: 2, unknown: 0, sessions: [{ id: "text-active", label: "Codex settings", status: "green", state: "active", updatedAt: "2026-08-17T06:00:00.000Z" }] },
    ],
  },
  limits: Array.from({ length: 10 }, (_, planIndex) => (
    ["5h", "1w", "GPT 5.3 Codex Spark Weekly"].map((window, windowIndex) => ({
      id: `codex:pro-${planIndex + 1}:window-${windowIndex}`,
      planId: `codex:pro-${planIndex + 1}`,
      agent: "codex",
      provider: "Codex",
      planLabel: `Pro ${planIndex + 1}`,
      accountLabel: `account-${planIndex + 1}@example.com`,
      window,
      usedPercent: 42 + planIndex + windowIndex,
      resetAt: planIndex >= 8 ? null : "2026-08-20T12:03:00.000Z",
      expiresAt: planIndex === 9 ? null : "2026-08-30T22:24:00.000Z",
      error: null,
      notes: null,
    }))
  )).flat(),
  totals: {
    tokens: 7_237_147_164,
    costUsd: 24_866.9,
    models: [
      { name: "gpt-5.6-sol", tokens: 4_499_590_201, share: 62.2, costUsd: 16_800 },
      { name: "gpt-5.5", tokens: 1_794_428_303, share: 24.8, costUsd: 5_440 },
      { name: "gpt-5.6-terra", tokens: 432_180_333, share: 6, costUsd: 1_240 },
      { name: "gpt-5.4", tokens: 425_202_349, share: 5.9, costUsd: 1_120 },
      { name: "codex-auto-review", tokens: 45_282_649, share: 0.6, costUsd: 180 },
      { name: "gpt-5.4-mini", tokens: 40_098_352, share: 0.6, costUsd: 86.9 },
      { name: "gpt-5.6-luna", tokens: 100_000, share: 0, costUsd: 0 },
      { name: "gpt-5.3-codex-spark", tokens: 120_000, share: 0, costUsd: 0 },
      { name: "gpt-5.3-codex", tokens: 100_000, share: 0, costUsd: 0 },
      { name: "gpt-4.1-mini", tokens: 44_977, share: 0, costUsd: 0 },
    ],
  },
  pendingReset: null,
};

function jsonResponse(body) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

async function wheelToEnd(page, locator) {
  const scrollMetricsBefore = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  const scrollTopBefore = await locator.evaluate((element) => element.scrollTop);
  await locator.hover();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(20);
    const reachedEnd = await locator.evaluate(
      (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
    );
    if (reachedEnd) break;
  }
  const scrollMetricsAfter = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  const scrollTopAfter = scrollMetricsAfter.scrollTop;
  const scrollable = scrollMetricsBefore.scrollHeight > scrollMetricsBefore.clientHeight + 1;
  if (!scrollable) {
    throw new Error(`wheel audit fixture did not overflow: ${JSON.stringify(scrollMetricsBefore)}`);
  }
  if (!(scrollTopAfter > scrollTopBefore)) {
    throw new Error(`wheel input did not scroll content: ${scrollTopBefore} -> ${scrollTopAfter}`);
  }
  const reachedEnd = scrollTopAfter + scrollMetricsAfter.clientHeight >= scrollMetricsAfter.scrollHeight - 1;
  if (!reachedEnd) {
    throw new Error(`wheel input did not reach the end: ${JSON.stringify(scrollMetricsAfter)}`);
  }
  return { ...scrollMetricsBefore, scrollable, scrollTopBefore, scrollTopAfter, reachedEnd };
}

async function installFixture(page, prefs) {
  await page.addInitScript((initialPrefs) => {
    window.__TOKEN_EYES_WIDGET_PREFS__ = initialPrefs;
    window.localStorage.setItem("tokentracker-locale", "zh-CN");
    window.localStorage.setItem(
      "tt.limits.providerOrder",
      JSON.stringify(["claude", "codex", "cursor", "hermes"]),
    );
    window.localStorage.setItem(
      "tt.limits.providerVisibility",
      JSON.stringify({
        claude: true,
        codex: true,
        cursor: true,
        trae: false,
        codebuddy: false,
        gemini: false,
        hermes: true,
        openclaw: false,
        opencode: false,
        antigravity: false,
        zed: false,
        workbuddy: true,
        kimi: false,
        "kimi-code": false,
        pi: false,
        grok: false,
        copilot: false,
        "deepseek-harness": true,
      }),
    );
    window.__TAURI__ = {
      core: {
        invoke: async (command, args) => {
          if (command === "local_server_status") {
            return { running: true, url: window.location.origin };
          }
          if (command === "get_desktop_widget_prefs") return window.__TOKEN_EYES_WIDGET_PREFS__;
          if (command === "set_desktop_widget_prefs") {
            window.__TOKEN_EYES_WIDGET_PREFS__ = args.prefs;
          }
          return null;
        },
      },
    };
  }, prefs);
  await page.route("**/api/local-auth", (route) => route.fulfill(jsonResponse({
    token: "widget-reference-token",
    protocol_version: 2,
    capabilities: ["spend_usage_v2", "provider_model_stats", "request_usage_records", "provider_api_balance", "desktop_widget"],
  })));
  await page.route("**/functions/**", (route) => {
    const url = new URL(route.request().url());
    const response = url.pathname.includes("tokentracker-desktop-widget") ? viewModel : {};
    return route.fulfill(jsonResponse(response));
  });
}

async function cardRect(page) {
  return page.getByTestId("desktop-widget-card").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

function rectIsStable(before, after, tolerance = 0.5) {
  return ["x", "y", "right", "bottom", "width", "height"]
    .every((key) => Math.abs(before[key] - after[key]) <= tolerance);
}

async function captureFixedGeometry(page) {
  return page.evaluate(() => {
    const card = document.querySelector("[data-testid='desktop-widget-card']");
    const toolbar = document.querySelector(".widget-toolbar");
    const rail = document.querySelector("[data-testid='widget-mode-rail']");
    const scroll = document.querySelector("[data-widget-scroll-region]");
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        x: value.x,
        y: value.y,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const cardRect = rect(card);
    const toolbarRect = rect(toolbar);
    const railRect = rect(rail);
    const scrollRect = scroll ? rect(scroll) : null;
    return {
      card: cardRect,
      toolbar: toolbarRect,
      rail: railRect,
      scroll: scrollRect,
      fixedToolbarVisible: (
        toolbarRect.x >= cardRect.x - 1
        && toolbarRect.right <= cardRect.right + 1
        && toolbarRect.y >= cardRect.y - 1
        && toolbarRect.bottom <= cardRect.bottom + 1
      ),
      fixedRegionOutsideScroll: !scroll || (
        !scroll.contains(toolbar)
        && toolbarRect.bottom <= scrollRect.y + 1
      ),
    };
  });
}

async function runInteractionAudit(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 352, height: 76 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  try {
    await installFixture(page, basePrefs);
    await page.goto(`${baseUrl}/desktop-widget`, { waitUntil: "domcontentloaded" });
    await page.getByText("6", { exact: true }).first().waitFor({ state: "visible" });

    const arrow = page.locator(".widget-agent-arrow");
    const blankSurface = page.getByTestId("widget-drag-surface");
    await arrow.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await blankSurface.click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await arrow.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    await arrow.click();
    await page.getByRole("menu").waitFor({ state: "hidden" });

    await arrow.click();
    await page.getByRole("menu").waitFor({ state: "visible" });
    const modeButtons = page.locator(".pill-nav__item");
    await modeButtons.nth(0).click();
    await page.getByRole("menu").waitFor({ state: "hidden" });
    for (let index = 0; index < 3; index += 1) {
      await modeButtons.nth(index).click();
      await page.waitForFunction((buttonIndex) => (
        document.querySelectorAll(".pill-nav__item")[buttonIndex]?.getAttribute("aria-pressed") === "true"
      ), index);
    }

    const expandButton = page.locator(".widget-agent-main");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expandButton.click();
      await page.setViewportSize({ width: 352, height: 360 });
      await page.waitForFunction(() => document.querySelector("[data-testid='desktop-widget-card']")?.classList.contains("is-expanded"));
      await expandButton.click();
      await page.setViewportSize({ width: 352, height: 76 });
      await page.waitForFunction(() => !document.querySelector("[data-testid='desktop-widget-card']")?.classList.contains("is-expanded"));
    }

    const beforeCelebration = await cardRect(page);
    await page.setViewportSize({ width: 632, height: 356 });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("token-eyes:desktop-widget-celebration", {
        detail: { eventId: "interaction-audit-reset", effectId: "meteors" },
      }));
    });
    await page.getByTestId("widget-reset-celebration").waitFor({ state: "visible" });
    const duringCelebration = await cardRect(page);
    if (
      Math.abs(duringCelebration.x - beforeCelebration.x - 140) > 1
      || Math.abs(duringCelebration.y - beforeCelebration.y - 140) > 1
      || Math.abs(duringCelebration.width - beforeCelebration.width) > 1
      || Math.abs(duringCelebration.height - beforeCelebration.height) > 1
    ) {
      throw new Error(`celebration changed the capsule geometry: ${JSON.stringify({ beforeCelebration, duringCelebration })}`);
    }
    await page.locator(".widget-reset-celebration__dismiss").click();
    await page.getByTestId("widget-reset-celebration").waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 352, height: 76 });
    const afterCelebration = await cardRect(page);
    if (JSON.stringify(afterCelebration) !== JSON.stringify(beforeCelebration)) {
      throw new Error(`celebration dismissal moved the capsule: ${JSON.stringify({ beforeCelebration, afterCelebration })}`);
    }

    return {
      agentMenuBlankDismissed: true,
      agentMenuRepeatedToggle: true,
      menuClosedOnModeChange: true,
      modeSwitches: 3,
      expandCollapseCycles: 2,
      celebrationDismissedWithoutCapsuleJump: true,
    };
  } finally {
    await context.close();
  }
}

let browser;
const results = [];
try {
  await fs.mkdir(outputDir, { recursive: true });
  await server.listen();
  browser = await chromium.launch();
  const baseUrl = `http://${hostname}:${port}`;

  for (const scale of [1, 1.25, 1.5, 2]) {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: scenario.width ?? 352, height: scenario.height },
        deviceScaleFactor: scale,
        colorScheme: "dark",
      });
      const page = await context.newPage();
      const pageErrors = [];
      const widgetRequests = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("desktop-widget")) widgetRequests.push(request.url());
      });
      await installFixture(page, { ...scenario.prefs, height: scenario.height, scaleFactor: scale });
      await page.goto(`${baseUrl}${route}${scenario.query ?? ""}`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("desktop-widget-card").waitFor({ state: "visible" });
      try {
        if (scenario.prefs.mode === "limits") {
          await page.waitForFunction(({ planCount, rowCount }) => (
            document.querySelectorAll("[data-testid='widget-expanded-limit-plan']").length === planCount
            && document.querySelectorAll(".widget-limit-row").length === rowCount
          ), { planCount: 10, rowCount: 30 }, { timeout: 8_000 });
          await page.getByText("重置时间不可用", { exact: true }).first()
            .waitFor({ state: "visible", timeout: 8_000 });
        } else {
          const readyText = scenario.prefs.mode === "models" ? "gpt-5.6-sol" : "6";
          await page.getByText(readyText, { exact: true }).first().waitFor({ state: "visible", timeout: 8_000 });
        }
      } catch {
        throw new Error(`${scenario.name}@${scale}: widget data did not load; requests=${JSON.stringify(widgetRequests)} text=${await page.locator("body").innerText()}`);
      }
      if (scenario.openCelebration) {
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent("token-eyes:desktop-widget-celebration", {
            detail: { eventId: "visual-audit-reset", effectId: "meteors" },
          }));
        });
        await page.getByTestId("widget-reset-celebration").waitFor({ state: "visible" });
      }
      if (scenario.openAgentMenu) {
        await page.locator(".widget-agent-arrow").click();
        await page.getByRole("menu").waitFor({ state: "visible" });
      }
      if (scenario.name === "03-projects") {
        await page.locator(".widget-project__button").first().click();
        await page.locator(".widget-project__button").first().waitFor({ state: "visible" });
      }
      await page.waitForTimeout(150);

      const geometry = await page.evaluate(() => {
        const root = document.querySelector(".desktop-widget-root");
        const card = document.querySelector("[data-testid='desktop-widget-card']");
        const rail = document.querySelector("[data-testid='widget-mode-rail']");
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
        };
        return {
          root: rect(root),
          card: rect(card),
          rail: rect(rail),
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          overflowY: document.documentElement.scrollHeight - window.innerHeight,
        };
      });
      if (geometry.overflowX > 1 || geometry.overflowY > 1) {
        throw new Error(`${scenario.name}@${scale}: overflow ${JSON.stringify(geometry)}`);
      }
      if (Math.abs(geometry.card.height - scenario.expectedCardHeight) > 1) {
        throw new Error(`${scenario.name}@${scale}: wrong card height ${JSON.stringify(geometry)}`);
      }
      if (Math.abs(geometry.card.width - 325) > 1) {
        throw new Error(`${scenario.name}@${scale}: wrong card width ${JSON.stringify(geometry)}`);
      }
      const viewportWidth = scenario.width ?? 352;
      if (geometry.card.x < 0 || geometry.card.right > viewportWidth || geometry.rail.right > viewportWidth) {
        throw new Error(`${scenario.name}@${scale}: clipped ${JSON.stringify(geometry)}`);
      }
      const fixedGeometryBefore = await captureFixedGeometry(page);
      if (!fixedGeometryBefore.fixedToolbarVisible || !fixedGeometryBefore.fixedRegionOutsideScroll) {
        throw new Error(`${scenario.name}@${scale}: fixed region is clipped or overlaps the scroll region ${JSON.stringify(fixedGeometryBefore)}`);
      }
      let wheelAudit = null;
      if (["03-projects", "04-limits", "05-models"].includes(scenario.name)) {
        wheelAudit = await wheelToEnd(page, page.locator("[data-widget-scroll-region]"));
      }
      if (scenario.name === "02-agent-menu") {
        wheelAudit = await wheelToEnd(page, page.locator(".widget-menu__items"));
      }
      const fixedGeometryAfter = await captureFixedGeometry(page);
      const fixedGeometryStable = (
        rectIsStable(fixedGeometryBefore.toolbar, fixedGeometryAfter.toolbar)
        && rectIsStable(fixedGeometryBefore.rail, fixedGeometryAfter.rail)
      );
      if (!fixedGeometryStable) {
        throw new Error(`${scenario.name}@${scale}: internal scrolling moved fixed widget controls ${JSON.stringify({ fixedGeometryBefore, fixedGeometryAfter })}`);
      }
      const stateAudit = await page.evaluate((scenarioName) => {
        const scroll = document.querySelector("[data-widget-scroll-region]");
        const rows = scenarioName === "03-projects"
          ? [...document.querySelectorAll(".widget-project, .widget-session")]
          : scenarioName === "04-limits"
            ? [...document.querySelectorAll(".widget-limit-row")]
            : scenarioName === "05-models"
              ? [...document.querySelectorAll(".widget-model-row")]
              : [];
        const menu = scenarioName === "02-agent-menu" ? document.querySelector("[role='menu']") : null;
        const menuScroll = menu?.querySelector(".widget-menu__items") ?? null;
        const menuItems = menu ? [...menu.querySelectorAll("[role='menuitemradio']")] : [];
        const lastMenuItem = menuItems.at(-1);
        const dismiss = scenarioName === "06-celebration"
          ? document.querySelector(".widget-reset-celebration__dismiss")
          : null;
        const card = document.querySelector("[data-testid='desktop-widget-card']");
        const dismissRect = dismiss?.getBoundingClientRect();
        const stateCardRect = card?.getBoundingClientRect();
        const last = rows.at(-1);
        const limitPlans = scenarioName === "04-limits"
          ? [...document.querySelectorAll("[data-testid='widget-expanded-limit-plan']")]
          : [];
        const missingResetText = "重置时间不可用";
        const missingResetCount = limitPlans.reduce((count, plan) => (
          count + [...plan.querySelectorAll(".widget-limit-row__reset")]
            .filter((label) => label.textContent?.trim() === missingResetText).length
        ), 0);
        const expiryOnlyPlan = limitPlans.at(8);
        const neitherPlan = limitPlans.at(9);
        const expiryOnlyText = expiryOnlyPlan
          ?.querySelector(".widget-limit-plan__validity")?.textContent?.trim() || "";
        return {
          rowCount: rows.length,
          planCount: scenarioName === "04-limits"
            ? document.querySelectorAll("[data-testid='widget-expanded-limit-plan']").length
            : 0,
          missingResetCount,
          expiryOnlyFactsValid: !expiryOnlyPlan || (
            expiryOnlyPlan.querySelectorAll(".widget-limit-row__reset").length === 3
            && [...expiryOnlyPlan.querySelectorAll(".widget-limit-row__reset")]
              .every((label) => label.textContent?.trim() === missingResetText)
            && expiryOnlyText.startsWith("有效期 ")
            && expiryOnlyText.includes(" · ")
          ),
          neitherFactsValid: !neitherPlan || (
            neitherPlan.querySelectorAll(".widget-limit-row__reset").length === 3
            && [...neitherPlan.querySelectorAll(".widget-limit-row__reset")]
              .every((label) => label.textContent?.trim() === missingResetText)
            && !neitherPlan.querySelector(".widget-limit-plan__validity")
          ),
          lastRowVisible: !last || !scroll
            ? true
            : (
              last.getBoundingClientRect().top >= scroll.getBoundingClientRect().top - 1
              && last.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 1
            ),
          menuItemCount: menuItems.length,
          menuVisible: !menu || menu.getBoundingClientRect().bottom <= window.innerHeight + 1,
          lastMenuItemVisible: !menuScroll || !lastMenuItem
            ? true
            : lastMenuItem.getBoundingClientRect().bottom <= menuScroll.getBoundingClientRect().bottom + 1,
          celebrationDismissVisible: !dismiss || (
            dismissRect.width > 0
            && dismissRect.height > 0
            && Math.abs(dismissRect.right - stateCardRect.right) <= 14
            && Math.abs(dismissRect.top - stateCardRect.top) <= 12
          ),
          celebrationGeometry: dismissRect && stateCardRect ? {
            dismiss: { left: dismissRect.left, top: dismissRect.top, right: dismissRect.right, bottom: dismissRect.bottom },
            card: { left: stateCardRect.left, top: stateCardRect.top, right: stateCardRect.right, bottom: stateCardRect.bottom },
          } : null,
        };
      }, scenario.name);
      const expectedRows = scenario.name === "03-projects" ? 9
        : scenario.name === "04-limits" ? 30
          : scenario.name === "05-models" ? 10 : 0;
      if (expectedRows && (stateAudit.rowCount !== expectedRows || !stateAudit.lastRowVisible)) {
        throw new Error(`${scenario.name}@${scale}: incomplete expanded content ${JSON.stringify(stateAudit)}`);
      }
      if (scenario.name === "04-limits" && (
        stateAudit.planCount !== 10
        || stateAudit.missingResetCount !== 6
        || !stateAudit.expiryOnlyFactsValid
        || !stateAudit.neitherFactsValid
      )) {
        throw new Error(`${scenario.name}@${scale}: quota facts were incomplete or misgrouped ${JSON.stringify(stateAudit)}`);
      }
      if (scenario.name === "02-agent-menu" && (
        stateAudit.menuItemCount !== 7
        || !stateAudit.menuVisible
        || !stateAudit.lastMenuItemVisible
      )) {
        throw new Error(`${scenario.name}@${scale}: incomplete agent menu ${JSON.stringify(stateAudit)}`);
      }
      if (scenario.name === "06-celebration" && !stateAudit.celebrationDismissVisible) {
        throw new Error(`${scenario.name}@${scale}: effect dismiss control is detached from the widget ${JSON.stringify(stateAudit)}`);
      }
      if (pageErrors.length) throw new Error(`${scenario.name}@${scale}: ${pageErrors.join(" | ")}`);

      const suffix = String(scale).replace(".", "_");
      const screenshotPath = path.join(outputDir, `${scenario.name}-${suffix}x.png`);
      await page.screenshot({ path: screenshotPath, omitBackground: true });
      let celebrationDismissed = null;
      if (scenario.openCelebration) {
        await page.locator(".widget-reset-celebration__dismiss").click();
        await page.getByTestId("widget-reset-celebration").waitFor({ state: "hidden" });
        celebrationDismissed = true;
      }
      results.push({
        name: scenario.name,
        scale,
        route,
        viewport: { width: viewportWidth, height: scenario.height },
        screenshotPath,
        geometry,
        fixedGeometryBefore,
        fixedGeometryAfter,
        fixedGeometryStable,
        wheelAudit,
        stateAudit,
        celebrationDismissed,
      });
      await context.close();
    }
  }

  const interactionAudit = await runInteractionAudit(browser, baseUrl);
  const expectedScenarioCount = scenarios.length * 4;
  if (results.length !== expectedScenarioCount) {
    throw new Error(`incomplete visual audit: ${results.length}/${expectedScenarioCount}`);
  }
  const visualAuditStatus = `PASS_${results.length}_SCENARIOS`;
  if (visualAuditStatus !== "PASS_24_SCENARIOS") {
    throw new Error(`unexpected visual audit status: ${visualAuditStatus}`);
  }
  const report = {
    status: "PASS",
    auditedAt: new Date().toISOString(),
    provenance,
    outputDir,
    scenarioCount: results.length,
    fixture: {
      id: "embedded-widget-reference-v1",
      selectedAgent: viewModel.selectedAgent,
      agents: viewModel.agents.length,
      projectsAndSessions: 9,
      quotaPlans: 10,
      quotaRows: 30,
      models: viewModel.totals.models.length,
      missingResetRows: 6,
    },
    interactionAudit,
    results,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("WIDGET_INTERACTION_AUDIT=PASS");
  console.log(`WIDGET_VISUAL_AUDIT=${visualAuditStatus}`);
} finally {
  await browser?.close();
  await server.close();
  process.chdir(originalWorkingDirectory);
}
