import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createScreenshotThemeSetup } from "./visual-baseline-config.js";
import {
  createStandaloneScreenshotTarget,
  createTemporaryDashboardServerConfig,
  getEphemeralPort,
} from "./visual-baseline-runtime.js";

function readArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return fallback;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function toNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const explicitUrl = readArg("--url", process.env.TOKENTRACKER_SCREENSHOT_URL) || "";
const out =
  readArg("--out", path.resolve("docs", "screenshots", "dashboard-screenshot.png")) ||
  path.resolve("docs", "screenshots", "dashboard-screenshot.png");
const width = toNumber(readArg("--width", "1512"), 1512);
const height = toNumber(readArg("--height", "997"), 997);
const dpr = toNumber(readArg("--dpr", "2"), 2);
const waitMs = toNumber(readArg("--wait", "0"), 0);
const readyTimeoutMs = toNumber(readArg("--ready-timeout", "15000"), 15000);
const explicitReadySelector = readArg("--ready-selector", "");
const fullPage = !hasFlag("--no-full-page");

const resolvedOut = path.isAbsolute(out) ? out : path.resolve(out);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(__dirname, "..");

async function startTemporaryDashboardServer() {
  const { createServer } = await import("vite");
  const hostname = "127.0.0.1";
  const port = await getEphemeralPort(hostname);
  let server = null;
  try {
    server = await createServer(createTemporaryDashboardServerConfig({
      dashboardRoot,
      hostname,
      port,
    }));
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      throw new Error("Temporary dashboard server did not expose a TCP port.");
    }
    return {
      server,
      baseUrl: `http://${hostname}:${address.port}`,
    };
  } catch (error) {
    await server?.close();
    throw error;
  }
}

async function run() {
  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });

  let temporaryServer = null;
  let browser = null;
  let page = null;

  try {
    let url = explicitUrl;
    let readySelector = explicitReadySelector;
    if (!url) {
      temporaryServer = await startTemporaryDashboardServer();
      const target = createStandaloneScreenshotTarget(temporaryServer.baseUrl);
      url = target.url;
      readySelector ||= target.readySelector;
      console.log(`Started temporary dashboard server: ${temporaryServer.baseUrl}`);
    }

    const themeSetup = createScreenshotThemeSetup(url);
    browser = await chromium.launch();
    page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      ...(themeSetup ? { colorScheme: themeSetup.colorScheme } : {}),
    });
    if (themeSetup) {
      await page.addInitScript((theme) => {
        localStorage.setItem("tokentracker-theme", theme);
      }, themeSetup.localStorageTheme);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({
      content: `
        html, body { background: #050505 !important; }
        [data-screenshot-exclude="true"] { display: none !important; }
      `,
    });
    await page.evaluate(() => {
      document.documentElement.classList.add("screenshot-capture");
      document.body?.classList.add("screenshot-capture");
    });
    await page.waitForFunction(
      () => !document.querySelector(".boot-splash"),
      null,
      { timeout: readyTimeoutMs },
    );
    if (readySelector) {
      await page.waitForSelector(readySelector, {
        state: "visible",
        timeout: readyTimeoutMs,
      });
    }
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    await page.screenshot({
      path: resolvedOut,
      fullPage,
      animations: "disabled",
    });

    console.log(`Saved screenshot: ${resolvedOut}`);
  } finally {
    await page?.close();
    await browser?.close();
    await temporaryServer?.server.close();
  }
}

run().catch((error) => {
  console.error("Failed to capture screenshot", error);
  process.exitCode = 1;
});
