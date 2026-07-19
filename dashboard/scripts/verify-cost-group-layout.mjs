/**
 * Visual/layout check for Other AI compact cost group cards.
 *
 * Prefers a self-contained fixture that reuses the built dashboard CSS
 * (same Tailwind utilities as CostAccumulation OtherAiGroupCostSection).
 * Optional: set COST_GROUP_LAYOUT_URL to hit a live /spend page instead.
 *
 * Usage (from repo root):
 *   npm --prefix dashboard run build
 *   node dashboard/scripts/verify-cost-group-layout.mjs
 */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DIST_DIR = path.join(ROOT_DIR, "dashboard", "dist");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "artifacts", "cost-group-layout");
const WIDTHS = [1280, 1440, 1920];
const LIVE_URL = process.env.COST_GROUP_LAYOUT_URL || "";

const SAMPLE_GROUPS = [
  {
    id: "learning",
    name: "AI learning",
    count: 3,
    monthUsd: "USD 105.56",
    monthCny: "CNY 760.00",
    yearUsd: "USD 105.56",
    yearCny: "CNY 760.00",
    lifetimeUsd: "USD 1,234.56",
    lifetimeCny: "CNY 8,888.83",
  },
  {
    id: "long-name",
    name: "Very Long Custom Group Name That May Truncate In The Title",
    count: 12,
    monthUsd: "USD 99.99",
    monthCny: "CNY 719.93",
    yearUsd: "USD 999.99",
    yearCny: "CNY 7,199.93",
    lifetimeUsd: "USD 9,999.99",
    lifetimeCny: "CNY 71,999.93",
  },
];

function mimeFor(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

async function findBuiltCssHref() {
  const assetsDir = path.join(DIST_DIR, "assets");
  let entries;
  try {
    entries = await fs.readdir(assetsDir);
  } catch {
    throw new Error(
      `Missing ${assetsDir}. Run \`npm --prefix dashboard run build\` first.`,
    );
  }
  const css = entries.find((name) => name.endsWith(".css"));
  if (!css) {
    throw new Error("No CSS bundle found under dashboard/dist/assets.");
  }
  return `/assets/${css}`;
}

function periodCell(label, usd, cny) {
  return `
    <div class="min-w-0 px-1 py-0.5">
      <div class="text-[10px] text-oai-gray-500 dark:text-oai-gray-400">${label}</div>
      <div data-testid="compact-cost-group-amount" class="text-[11px] font-semibold leading-snug break-words">
        <div class="flex flex-col">
          <span class="tabular-nums">${usd}</span>
          <span class="text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">${cny}</span>
        </div>
      </div>
    </div>`;
}

function groupCard(group) {
  return `
    <article
      data-testid="compact-cost-group-${group.id}"
      data-layout="compact-cost-group"
      data-density="ultra-compact"
      class="rounded-md border border-oai-gray-200 bg-white px-2 py-1.5 shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900"
    >
      <div class="mb-1 flex items-center justify-between gap-2">
        <h4 class="truncate text-xs font-semibold text-oai-gray-900 dark:text-oai-gray-100">${group.name}</h4>
        <span class="rounded-full bg-oai-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-oai-gray-500 dark:bg-oai-gray-800">${group.count}</span>
      </div>
      <div class="grid grid-cols-3 divide-x divide-oai-gray-100 dark:divide-oai-gray-800">
        ${periodCell("Month", group.monthUsd, group.monthCny)}
        ${periodCell("Year", group.yearUsd, group.yearCny)}
        ${periodCell("Lifetime", group.lifetimeUsd, group.lifetimeCny)}
      </div>
    </article>`;
}

function buildFixtureHtml(cssHref) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cost group layout fixture</title>
  <link rel="stylesheet" href="${cssHref}" />
  <style>
    body { margin: 0; padding: 24px; background: #f7f7f8; font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body>
  <section>
    <h3 style="margin:0 0 12px;font-size:14px;">Other AI group costs (layout fixture)</h3>
    <div
      data-testid="compact-cost-group-grid"
      class="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]"
    >
      ${SAMPLE_GROUPS.map(groupCard).join("\n")}
    </div>
  </section>
</body>
</html>`;
}

async function startDistServer(fixtureHtml) {
  const fixtureRel = "/cost-group-layout-fixture.html";
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === fixtureRel || urlPath === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fixtureHtml);
        return;
      }
      const safePath = path
        .normalize(urlPath)
        .replace(/^(\.\.[/\\])+/, "")
        .replace(/^[/\\]+/, "");
      const filePath = path.join(DIST_DIR, safePath);
      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const data = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": mimeFor(filePath) });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${fixtureRel}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function assertAmountsReadable(page, width) {
  const grid = page.getByTestId("compact-cost-group-grid");
  await grid.waitFor({ state: "visible", timeout: 10_000 });

  const amountLocators = page.locator('[data-testid="compact-cost-group-amount"]');
  const count = await amountLocators.count();
  if (count < 1) {
    throw new Error(`[${width}] No amount elements found`);
  }

  for (let i = 0; i < count; i += 1) {
    const el = amountLocators.nth(i);
    const className = (await el.getAttribute("class")) || "";
    if (/\btruncate\b/.test(className) || /\boverflow-hidden\b/.test(className) || /\bwhitespace-nowrap\b/.test(className)) {
      throw new Error(`[${width}] Amount #${i} has forbidden clip class: ${className}`);
    }

    const metrics = await el.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        text: (node.innerText || "").replace(/\s+/g, " ").trim(),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
      };
    });

    if (metrics.textOverflow === "ellipsis") {
      throw new Error(`[${width}] Amount ellipsis forbidden: ${metrics.text}`);
    }
    if (/\bnowrap\b/.test(metrics.whiteSpace) && metrics.scrollWidth > metrics.clientWidth + 1) {
      throw new Error(
        `[${width}] Amount clipped (nowrap overflow): ${metrics.text} ` +
          `(scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth})`,
      );
    }

    const fitsHorizontally = metrics.scrollWidth <= metrics.clientWidth + 1;
    const hasReadableHeight = metrics.scrollHeight >= 8 && metrics.clientHeight >= 8;
    // Wrapping is allowed: block boxes with wrap keep scrollWidth ~= clientWidth
    // while growing scrollHeight to fit full text.
    if (!fitsHorizontally || !hasReadableHeight) {
      throw new Error(
        `[${width}] Amount not fully readable: ${metrics.text} ` +
          `(scroll=${metrics.scrollWidth}x${metrics.scrollHeight}, ` +
          `client=${metrics.clientWidth}x${metrics.clientHeight})`,
      );
    }

    if (!/USD/.test(metrics.text) || !/CNY/.test(metrics.text)) {
      throw new Error(`[${width}] Amount missing USD/CNY lines: ${metrics.text}`);
    }
  }
}

async function run() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  let closeServer = async () => {};
  let targetUrl = LIVE_URL;
  let mode = "live";

  if (!targetUrl) {
    const cssHref = await findBuiltCssHref();
    const fixtureHtml = buildFixtureHtml(cssHref);
    const server = await startDistServer(fixtureHtml);
    targetUrl = server.url;
    closeServer = server.close;
    mode = "fixture+built-css";
  }

  const browser = await chromium.launch();
  const results = [];

  try {
    for (const width of WIDTHS) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      try {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30_000 });
        await assertAmountsReadable(page, width);

        const shotPath = path.join(ARTIFACTS_DIR, `cost-group-${width}.png`);
        const grid = page.getByTestId("compact-cost-group-grid");
        await grid.screenshot({ path: shotPath, animations: "disabled" });
        results.push({ width, status: "PASS", screenshot: shotPath });
        console.log(`PASS width=${width} screenshot=${shotPath}`);
      } catch (error) {
        const shotPath = path.join(ARTIFACTS_DIR, `cost-group-${width}-FAIL.png`);
        try {
          await page.screenshot({ path: shotPath, fullPage: true });
        } catch {
          // ignore secondary screenshot failures
        }
        results.push({ width, status: "FAIL", error: String(error), screenshot: shotPath });
        console.error(`FAIL width=${width}:`, error);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await closeServer();
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(
    JSON.stringify(
      {
        mode,
        url: targetUrl,
        artifactsDir: ARTIFACTS_DIR,
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length) {
    process.exitCode = 1;
    throw new Error(`${failed.length}/${results.length} viewport checks failed`);
  }
  console.log(`OK: cost group layout readable at ${WIDTHS.join(", ")} (${mode})`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
