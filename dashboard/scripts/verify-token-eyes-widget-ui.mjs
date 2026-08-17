import fs from "node:fs/promises";
import path from "node:path";
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
const port = await getEphemeralPort(hostname);
const originalWorkingDirectory = process.cwd();
process.chdir(dashboardRoot);
const server = await createServer(createTemporaryDashboardServerConfig({
  dashboardRoot,
  hostname,
  port,
}));

const basePrefs = {
  version: 10,
  visible: true,
  x: null,
  y: null,
  width: 632,
  height: 144,
  collapsedHeight: 144,
  expandedHeight: 356,
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
  { name: "01-compact", prefs: basePrefs, height: 144 },
  { name: "02-agent-menu", prefs: basePrefs, height: 472, openAgentMenu: true },
  { name: "03-projects", prefs: { ...basePrefs, expanded: true, expandedHeight: 356 }, height: 356 },
  { name: "04-limits", prefs: { ...basePrefs, expanded: true, mode: "limits", expandedHeight: 426 }, height: 426 },
  { name: "05-models", prefs: { ...basePrefs, expanded: true, mode: "models", expandedHeight: 412 }, height: 412 },
  { name: "06-celebration", prefs: basePrefs, width: 912, height: 424, openCelebration: true },
];

const viewModel = {
  agents: ["all", "claude", "codex", "cursor", "hermes"],
  selectedAgent: "codex",
  projectStatus: {
    red: 0,
    yellow: 0,
    green: 8,
    unknown: 0,
    projects: [
      { id: "token-eyes", label: "010-Token eye", red: 0, yellow: 0, green: 6, unknown: 0, sessions: [{ id: "token-eyes-active", label: "Token Eyes UI", status: "green", state: "active", updatedAt: "2026-08-17T06:00:00.000Z" }] },
      { id: "text", label: "text", red: 0, yellow: 0, green: 2, unknown: 0, sessions: [{ id: "text-active", label: "Codex settings", status: "green", state: "active", updatedAt: "2026-08-17T06:00:00.000Z" }] },
    ],
  },
  limits: [
    { id: "codex:alfalfa:5h", agent: "codex", provider: "Codex", accountLabel: "Plus", window: "5h", usedPercent: 67, resetAt: null, error: null, notes: "alfalfa" },
    { id: "codex:twiddly:5h", agent: "codex", provider: "Codex", accountLabel: "Plus", window: "5h", usedPercent: 100, resetAt: null, error: null, notes: "twiddly" },
    { id: "codex:quantum:5h", agent: "codex", provider: "Codex", accountLabel: "Plus", window: "5h", usedPercent: 98, resetAt: null, error: null, notes: "quantum" },
  ],
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
      { name: "gpt-5.6-luna", tokens: 364_977, share: 0, costUsd: 0 },
    ],
  },
  pendingReset: null,
};

function jsonResponse(body) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

async function installFixture(page, prefs) {
  await page.addInitScript((initialPrefs) => {
    window.__TOKEN_EYES_WIDGET_PREFS__ = initialPrefs;
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
        workbuddy: false,
        kimi: false,
        "kimi-code": false,
        pi: false,
        grok: false,
        copilot: false,
        "deepseek-harness": false,
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
        viewport: { width: scenario.width ?? 632, height: scenario.height },
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
      await page.goto(`${baseUrl}/desktop-widget${scenario.query ?? ""}`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("desktop-widget-card").waitFor({ state: "visible" });
      const readyText = scenario.prefs.mode === "limits"
        ? "67%"
        : scenario.prefs.mode === "models" ? "gpt-5.6-sol" : "8";
      try {
        await page.getByText(readyText, { exact: true }).first().waitFor({ state: "visible", timeout: 8_000 });
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
      const expectedCardHeight = ["01-compact", "02-agent-menu", "06-celebration"].includes(scenario.name)
        ? 138
        : scenario.height - 6;
      if (Math.abs(geometry.card.height - expectedCardHeight) > 1) {
        throw new Error(`${scenario.name}@${scale}: wrong card height ${JSON.stringify(geometry)}`);
      }
      const viewportWidth = scenario.width ?? 632;
      if (geometry.card.x < 0 || geometry.card.right > viewportWidth || geometry.rail.right > viewportWidth) {
        throw new Error(`${scenario.name}@${scale}: clipped ${JSON.stringify(geometry)}`);
      }
      const stateAudit = await page.evaluate((scenarioName) => {
        const scroll = document.querySelector("[data-widget-scroll-region]");
        const rows = scenarioName === "03-projects"
          ? [...document.querySelectorAll(".widget-project")]
          : scenarioName === "04-limits"
            ? [...document.querySelectorAll(".widget-limit-row")]
            : scenarioName === "05-models"
              ? [...document.querySelectorAll(".widget-model-row")]
              : [];
        const menu = scenarioName === "02-agent-menu" ? document.querySelector("[role='menu']") : null;
        const dismiss = scenarioName === "06-celebration"
          ? document.querySelector(".widget-reset-celebration__dismiss")
          : null;
        const card = document.querySelector("[data-testid='desktop-widget-card']");
        const dismissRect = dismiss?.getBoundingClientRect();
        const stateCardRect = card?.getBoundingClientRect();
        const last = rows.at(-1);
        return {
          rowCount: rows.length,
          lastRowVisible: !last || !scroll
            ? true
            : last.getBoundingClientRect().bottom <= scroll.getBoundingClientRect().bottom + 1,
          menuItemCount: menu?.querySelectorAll("[role='menuitemradio']").length ?? 0,
          menuVisible: !menu || menu.getBoundingClientRect().bottom <= window.innerHeight + 1,
          celebrationDismissVisible: !dismiss || (
            dismissRect.width > 0
            && dismissRect.height > 0
            && Math.abs(dismissRect.left - stateCardRect.right) <= 6
            && Math.abs(dismissRect.top - stateCardRect.top) <= 12
          ),
          celebrationGeometry: dismissRect && stateCardRect ? {
            dismiss: { left: dismissRect.left, top: dismissRect.top, right: dismissRect.right, bottom: dismissRect.bottom },
            card: { left: stateCardRect.left, top: stateCardRect.top, right: stateCardRect.right, bottom: stateCardRect.bottom },
          } : null,
        };
      }, scenario.name);
      const expectedRows = scenario.name === "03-projects" ? 2
        : scenario.name === "04-limits" ? 3
          : scenario.name === "05-models" ? 7 : 0;
      if (expectedRows && (stateAudit.rowCount !== expectedRows || !stateAudit.lastRowVisible)) {
        throw new Error(`${scenario.name}@${scale}: incomplete expanded content ${JSON.stringify(stateAudit)}`);
      }
      if (scenario.name === "02-agent-menu" && (stateAudit.menuItemCount !== 5 || !stateAudit.menuVisible)) {
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
      results.push({ name: scenario.name, scale, screenshotPath, geometry, stateAudit, celebrationDismissed });
      await context.close();
    }
  }

  console.log(JSON.stringify({ status: "PASS", outputDir, scenarioCount: results.length, results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
  process.chdir(originalWorkingDirectory);
}
