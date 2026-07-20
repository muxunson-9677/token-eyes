/**
 * Installed-page acceptance for Other AI custom spend group cards.
 *
 * This script intentionally has no fixture fallback. It must inspect the
 * formal Token Eyes page backed by the user's real local ledger.
 *
 * Usage (from repo root):
 *   node dashboard/scripts/verify-cost-group-layout.mjs
 *   COST_GROUP_LAYOUT_URL=http://127.0.0.1:7681/spend/cost node dashboard/scripts/verify-cost-group-layout.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ARTIFACTS_DIR = path.join(ROOT_DIR, "artifacts", "rework", "spend-cards");
const CONTENT_WIDTHS = [1280, 1440, 1920];
const LIVE_URL = process.env.COST_GROUP_LAYOUT_URL || "http://127.0.0.1:7681/spend/cost";

function assertInstalledUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/spend/cost")) {
    throw new Error(`Expected installed local /spend/cost URL, received: ${rawUrl}`);
  }
}

async function inspectInstalledCards(page, targetContentWidth) {
  const grid = page.getByTestId("compact-cost-group-grid");
  await grid.waitFor({ state: "visible", timeout: 20_000 });

  const result = await grid.evaluate((gridNode) => {
    const px = (value) => Number.parseFloat(value || "0");
    const elementMetrics = (node) => {
      const style = getComputedStyle(node);
      return {
        className: node.getAttribute("class") || "",
        text: (node.innerText || "").replace(/\s+/g, " ").trim(),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        fontSize: px(style.fontSize),
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    };

    const cards = [...gridNode.querySelectorAll('[data-layout="compact-cost-group"]')];
    return {
      contentWidth: Math.round(gridNode.getBoundingClientRect().width),
      cardCount: cards.length,
      cards: cards.map((card) => {
        const title = card.querySelector("h4");
        const amountNodes = [...card.querySelectorAll('[data-testid="compact-cost-group-amount"]')];
        const periodGrid = amountNodes[0]?.parentElement?.parentElement;
        return {
          id: card.getAttribute("data-testid"),
          title: title ? elementMetrics(title) : null,
          amounts: amountNodes.map(elementMetrics),
          periodColumns: periodGrid ? getComputedStyle(periodGrid).gridTemplateColumns : "",
        };
      }),
    };
  });

  if (result.cardCount < 1) {
    throw new Error(`[content ${targetContentWidth}] No real custom spend group cards found`);
  }
  if (Math.abs(result.contentWidth - targetContentWidth) > 1) {
    throw new Error(
      `[content ${targetContentWidth}] Page width cap prevented the requested content width ` +
      `(actual ${result.contentWidth}px)`,
    );
  }

  for (const card of result.cards) {
    const title = card.title;
    if (!title?.text) throw new Error(`[content ${targetContentWidth}] ${card.id} has no readable group name`);
    if (/\btruncate\b|\boverflow-hidden\b/.test(title.className) || title.textOverflow === "ellipsis") {
      throw new Error(`[content ${targetContentWidth}] ${card.id} group name can be truncated: ${title.text}`);
    }
    if (title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1) {
      throw new Error(`[content ${targetContentWidth}] ${card.id} group name is clipped: ${title.text}`);
    }
    if (title.fontSize < 14) {
      throw new Error(`[content ${targetContentWidth}] ${card.id} group name font is too small: ${title.fontSize}px`);
    }

    if (card.amounts.length !== 3) {
      throw new Error(`[content ${targetContentWidth}] ${card.id} expected 3 period amounts, found ${card.amounts.length}`);
    }
    for (const amount of card.amounts) {
      if (!amount.text.includes("USD ") || !amount.text.includes("CNY ")) {
        throw new Error(`[content ${targetContentWidth}] ${card.id} is missing a USD/CNY line: ${amount.text}`);
      }
      if (/[—…]/.test(amount.text)) {
        throw new Error(`[content ${targetContentWidth}] ${card.id} contains a dash or ellipsis: ${amount.text}`);
      }
      if (/\btruncate\b|\boverflow-hidden\b/.test(amount.className) || amount.textOverflow === "ellipsis") {
        throw new Error(`[content ${targetContentWidth}] ${card.id} amount can be truncated: ${amount.text}`);
      }
      if (amount.scrollWidth > amount.clientWidth + 1 || amount.scrollHeight > amount.clientHeight + 1) {
        throw new Error(`[content ${targetContentWidth}] ${card.id} amount is clipped: ${amount.text}`);
      }
      if (amount.fontSize < 12) {
        throw new Error(`[content ${targetContentWidth}] ${card.id} amount font is too small: ${amount.fontSize}px`);
      }
    }
  }

  return result;
}

async function run() {
  assertInstalledUrl(LIVE_URL);
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const targetContentWidth of CONTENT_WIDTHS) {
      const page = await browser.newPage({
        viewport: { width: targetContentWidth + 400, height: 1000 },
        deviceScaleFactor: 1,
      });
      const spendResponses = [];
      page.on("response", async (response) => {
        if (!response.url().includes("tokentracker-spend-records")) return;
        try {
          const body = await response.json();
          spendResponses.push({
            url: response.url(),
            status: response.status(),
            other_ai_group_totals: body?.other_ai_group_totals || [],
          });
        } catch {
          spendResponses.push({ url: response.url(), status: response.status(), parse_error: true });
        }
      });

      try {
        await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const grid = page.getByTestId("compact-cost-group-grid");
        await grid.waitFor({ state: "visible", timeout: 20_000 });
        const initialContentWidth = Math.round((await grid.boundingBox())?.width || 0);
        const initialViewport = page.viewportSize();
        const surroundingWidth = (initialViewport?.width || 0) - initialContentWidth;
        await page.setViewportSize({ width: targetContentWidth + surroundingWidth, height: 1000 });

        const inspection = await inspectInstalledCards(page, targetContentWidth);
        const viewportWidth = page.viewportSize()?.width || null;
        const screenshot = path.join(ARTIFACTS_DIR, `installed-spend-cards-content-${targetContentWidth}.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
        results.push({ targetContentWidth, viewportWidth, status: "PASS", screenshot, ...inspection, spendResponses });
        console.log(`PASS installed contentWidth=${inspection.contentWidth} viewportWidth=${viewportWidth} cards=${inspection.cardCount}`);
      } catch (error) {
        const screenshot = path.join(ARTIFACTS_DIR, `installed-spend-cards-content-${targetContentWidth}-FAIL.png`);
        try {
          await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
        } catch {
          // Preserve the primary failure.
        }
        results.push({ targetContentWidth, status: "FAIL", screenshot, error: String(error), spendResponses });
        console.error(`FAIL installed contentWidth=${targetContentWidth}: ${error}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    captured_at: new Date().toISOString(),
    mode: "installed-live-data",
    url: LIVE_URL,
    results,
  };
  const reportPath = path.join(ARTIFACTS_DIR, "installed-spend-cards.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  const failed = results.filter((result) => result.status !== "PASS");
  if (failed.length) throw new Error(`${failed.length}/${results.length} installed viewport checks failed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
