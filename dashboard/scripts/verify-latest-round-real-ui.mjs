import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.TOKEN_EYES_QA_URL || "http://127.0.0.1:4191";
const outputDir = path.resolve("docs", "screenshots", "latest-round-real-ui");
const query = "theme=light&mock=1&mock_seed=baseline&mock_today=2025-12-31&mock_now=2025-12-31T12%3A00%3A00Z";

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
  colorScheme: "light",
});

await context.addInitScript(() => {
  localStorage.setItem("tokentracker-theme", "light");
  localStorage.setItem(
    "tt.limits.providerOrder",
    JSON.stringify(["deepseek-harness", "codex", "claude", "cursor", "hermes"]),
  );
  localStorage.setItem(
    "tt.limits.providerVisibility",
    JSON.stringify({
      "deepseek-harness": true,
      codex: true,
      claude: true,
      cursor: true,
      hermes: true,
      trae: false,
      codebuddy: false,
      gemini: false,
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
    }),
  );
});

const page = await context.newPage();
page.setDefaultTimeout(12_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

async function open(route) {
  await page.goto(`${baseUrl}${route}?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector(".boot-splash"), null, { timeout: 15_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

const report = {};
try {
  await open("/dashboard");
  console.log("QA: overview loaded");
  const dailyRow = page.locator(".tt-overview-daily-table tbody tr[role='button']").first();
  await dailyRow.waitFor({ state: "visible" });
  const before = await page.evaluate(() => ({
    rows: document.querySelectorAll(".tt-overview-daily-table tbody tr").length,
    tableHeight: document.querySelector(".tt-overview-daily-table tbody")?.getBoundingClientRect().height ?? 0,
  }));
  const rowBox = await dailyRow.boundingBox();
  await dailyRow.locator("td").nth(1).click();
  const overlay = page.getByTestId("daily-breakdown-overlay");
  await overlay.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-testid='daily-breakdown-overlay']");
    return node && !node.textContent?.includes("加载");
  });
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll(".tt-overview-daily-table tbody tr").length,
    tableHeight: document.querySelector(".tt-overview-daily-table tbody")?.getBoundingClientRect().height ?? 0,
    overlayLayout: document.querySelector("[data-testid='daily-breakdown-overlay']")?.getAttribute("data-overlay-layout"),
    agents: document.querySelectorAll(".tt-daily-breakdown-agent").length,
    models: document.querySelectorAll(".tt-daily-breakdown-models > div").length,
  }));
  const overlayBox = await overlay.boundingBox();
  const rowBoxAfter = await dailyRow.boundingBox();
  if (before.rows !== after.rows || Math.abs(before.tableHeight - after.tableHeight) > 1) {
    throw new Error(`Daily overlay changed table layout: ${JSON.stringify({ before, after })}`);
  }
  if (after.overlayLayout !== "cover" || after.agents < 1 || after.models < 1) {
    throw new Error(`Daily overlay lacks real agent/model breakdown: ${JSON.stringify(after)}`);
  }
  if (!rowBoxAfter || !overlayBox || overlayBox.y < rowBoxAfter.y || overlayBox.y > rowBoxAfter.y + rowBoxAfter.height + 2) {
    throw new Error(`Daily overlay is not anchored over the following rows: ${JSON.stringify({ rowBox, rowBoxAfter, overlayBox })}`);
  }
  await page.screenshot({ path: path.join(outputDir, "01-overview-daily-overlay.png"), fullPage: false });
  await dailyRow.locator("td").nth(1).click();
  await overlay.waitFor({ state: "hidden" });
  report.dailyBreakdown = { before, after, rowBox, rowBoxAfter, overlayBox, closesOnSecondClick: true };
  console.log("QA: daily overlay passed");

  await open("/spend/usage");
  console.log("QA: usage loaded");
  const pricingNote = page.getByText("计费统计来源于模型官方标价", { exact: true });
  await pricingNote.waitFor({ state: "visible" });
  const deepSeekFilter = page.getByRole("button", { name: /DeepSeek Harness/u });
  await deepSeekFilter.waitFor({ state: "visible" });
  const visibleAgentLabels = await page.locator(".tt-agent-switcher-card").allInnerTexts();
  const expectedAgentLabels = ["全部", "DeepSeek Harness", "Codex", "Claude Code", "Cursor", "Hermes Agent"];
  if (JSON.stringify(visibleAgentLabels) !== JSON.stringify(expectedAgentLabels)) {
    throw new Error(`Usage agent filters do not match Limits Display: ${JSON.stringify(visibleAgentLabels)}`);
  }
  await page.screenshot({ path: path.join(outputDir, "02-usage-limits-display-agents.png"), fullPage: false });
  await pricingNote.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, "03-request-log-pricing-note.png"), fullPage: false });
  report.usage = {
    pricingNote: await pricingNote.innerText(),
    deepSeekFilterVisible: await deepSeekFilter.isVisible(),
    visibleAgentLabels,
  };
  console.log("QA: usage note and agent passed");

  await open("/settings/basic");
  console.log("QA: settings loaded");
  const harnessLabel = page.getByText("DeepSeek Harness", { exact: true });
  await harnessLabel.waitFor({ state: "visible" });
  const harnessRow = harnessLabel.locator("xpath=ancestor::*[self::li or self::div][.//button or .//input][1]");
  const harnessIcon = page.locator('img[src="/brand-logos/deepseek-harness.svg"]').first();
  await harnessIcon.waitFor({ state: "visible" });
  await harnessRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, "04-settings-deepseek-harness.png"), fullPage: false });
  report.deepSeekHarness = {
    labelVisible: await harnessLabel.isVisible(),
    iconSource: await harnessIcon.getAttribute("src"),
  };
  console.log("QA: DeepSeek Harness icon passed");

  await open("/spend/cost");
  console.log("QA: cost loaded");
  const cashLabel = page.locator(".tt-cost-summary-label", { hasText: "实际现金支出" });
  const equivalentLabel = page.locator(".tt-cost-summary-label", { hasText: "API 标价等价价值" });
  const scopeNote = page.getByTestId("cost-summary-scope-note");
  await cashLabel.waitFor({ state: "visible" });
  await equivalentLabel.waitFor({ state: "visible" });
  await scopeNote.waitFor({ state: "visible" });
  const roiTitle = page.getByText("回本倍数", { exact: true });
  const roiOrEmpty = roiTitle.or(page.getByTestId("subscription-roi-empty-note"));
  await roiOrEmpty.first().waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(outputDir, "05-cost-semantics.png"), fullPage: false });
  report.costSemantics = {
    actualCashVisible: await cashLabel.isVisible(),
    equivalentValueVisible: await equivalentLabel.isVisible(),
    scopeNote: await scopeNote.innerText(),
    roiState: await roiOrEmpty.first().innerText(),
  };

  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  report.status = "PASS";
  await fs.writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", outputDir, report }, null, 2));
} finally {
  await page.close();
  await context.close();
  await browser.close();
}
