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
  version: 6,
  visible: true,
  x: null,
  y: null,
  width: 352,
  height: 72,
  collapsedHeight: 72,
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
  { name: "01-compact", prefs: basePrefs, height: 72 },
  { name: "02-agent-menu", prefs: basePrefs, height: 260, openAgentMenu: true },
  { name: "03-projects", prefs: { ...basePrefs, expanded: true }, height: 360 },
  { name: "04-limits", prefs: { ...basePrefs, expanded: true, mode: "limits" }, height: 360 },
  { name: "05-models", prefs: { ...basePrefs, expanded: true, mode: "models" }, height: 360 },
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
      { id: "token-eyes", label: "010-Token eye", red: 0, yellow: 0, green: 6, unknown: 0, sessions: [] },
      { id: "text", label: "text", red: 0, yellow: 0, green: 2, unknown: 0, sessions: [] },
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
        viewport: { width: 352, height: scenario.height },
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
      await page.goto(`${baseUrl}/desktop-widget`, { waitUntil: "domcontentloaded" });
      await page.getByTestId("desktop-widget-card").waitFor({ state: "visible" });
      const readyText = scenario.prefs.mode === "limits"
        ? "67%"
        : scenario.prefs.mode === "models" ? "gpt-5.6-sol" : "8";
      try {
        await page.getByText(readyText, { exact: true }).first().waitFor({ state: "visible", timeout: 8_000 });
      } catch {
        throw new Error(`${scenario.name}@${scale}: widget data did not load; requests=${JSON.stringify(widgetRequests)} text=${await page.locator("body").innerText()}`);
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
      if (geometry.card.x < 0 || geometry.card.right > 352 || geometry.rail.right > 352) {
        throw new Error(`${scenario.name}@${scale}: clipped ${JSON.stringify(geometry)}`);
      }
      if (pageErrors.length) throw new Error(`${scenario.name}@${scale}: ${pageErrors.join(" | ")}`);

      const suffix = String(scale).replace(".", "_");
      const screenshotPath = path.join(outputDir, `${scenario.name}-${suffix}x.png`);
      await page.screenshot({ path: screenshotPath, omitBackground: true });
      results.push({ name: scenario.name, scale, screenshotPath, geometry });
      await context.close();
    }
  }

  console.log(JSON.stringify({ status: "PASS", outputDir, scenarioCount: results.length, results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
  process.chdir(originalWorkingDirectory);
}
