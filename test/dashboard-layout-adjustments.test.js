const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const containerPath = path.join(__dirname, "..", "dashboard", "src", "pages", "DashboardPage.jsx");
const viewPath = path.join(
  __dirname,
  "..",
  "dashboard",
  "src",
  "ui",
  "dashboard",
  "views",
  "DashboardView.jsx",
);
const copyPath = path.join(__dirname, "..", "dashboard", "src", "content", "copy.csv");
const projectUsagePath = path.join(
  __dirname,
  "..",
  "dashboard",
  "src",
  "ui",
  "dashboard",
  "components",
  "ProjectUsagePanel.jsx",
);
const installStatusPath = path.join(
  __dirname,
  "..",
  "dashboard",
  "src",
  "lib",
  "install-status.js",
);
const spendPath = path.join(__dirname, "..", "dashboard", "src", "pages", "SpendPage.jsx");
const sidebarPath = path.join(__dirname, "..", "dashboard", "src", "ui", "components", "Sidebar.jsx");
const cardPath = path.join(__dirname, "..", "dashboard", "src", "ui", "components", "Card.jsx");
const usageOverviewPath = path.join(__dirname, "..", "dashboard", "src", "ui", "dashboard", "components", "UsageOverview.jsx");
const costAccumulationPath = path.join(__dirname, "..", "dashboard", "src", "ui", "dashboard", "components", "CostAccumulation.jsx");
const appleGlassPath = path.join(__dirname, "..", "dashboard", "src", "ui", "foundation", "apple-glass.css");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("DashboardPage keeps trend and model usage in the left column (heatmap removed)", () => {
  const src = readFile(viewPath);
  const leftStart = src.indexOf("lg:col-span-4");
  const rightStart = src.indexOf("lg:col-span-8", leftStart + 1);
  assert.ok(leftStart !== -1, "expected left column markup");
  assert.ok(rightStart !== -1, "expected right column markup");

  const leftColumn = src.slice(leftStart, rightStart);
  const trendIndex = leftColumn.indexOf("<TrendMonitor");
  const donutIndex = leftColumn.indexOf("<ModelUsageDonut");
  assert.ok(leftColumn.includes("<StatsPanel"), "expected StatsPanel in the left column");
  assert.ok(trendIndex !== -1, "expected TrendMonitor in the left column");
  assert.ok(donutIndex !== -1, "expected ModelUsageDonut in the left column");
  assert.ok(trendIndex < donutIndex, "expected ModelUsageDonut directly after TrendMonitor");
  // Heatmap block was removed in v2.0 — assert it no longer exists
  assert.ok(
    !src.includes("activityHeatmapBlock"),
    "expected heatmap block to be removed from DashboardView",
  );
});

test("DashboardPage right column contains UsageOverview", () => {
  const src = readFile(viewPath);
  const leftStart = src.indexOf("lg:col-span-4");
  const rightStart = src.indexOf("lg:col-span-8", leftStart + 1);
  assert.ok(leftStart !== -1, "expected left column markup");
  assert.ok(rightStart !== -1, "expected right column markup");

  const rightColumn = src.slice(rightStart);
  assert.ok(rightColumn.includes("<UsageOverview"), "expected UsageOverview in right column");
});

test("ProjectUsagePanel lays out cards in responsive grid", () => {
  const src = readFile(projectUsagePath);
  assert.ok(src.includes("grid-cols-1"), "expected project usage grid to start with one column");
  assert.ok(
    src.includes("md:grid-cols-2"),
    "expected project usage grid to use two columns on medium screens",
  );
  assert.ok(
    src.includes("lg:grid-cols-3"),
    "expected project usage grid to use three columns on large screens",
  );
});

test("ProjectUsagePanel does not render star values (stars removed)", () => {
  const src = readFile(projectUsagePath);
  assert.ok(
    !src.includes("starsCompact"),
    "expected project usage panel to NOT contain stars (removed in v2.0)",
  );
  assert.ok(
    !src.includes("formatCompactNumber(starsRaw"),
    "expected project usage panel to NOT format star values",
  );
});

test("ProjectUsagePanel renders token and cost info", () => {
  const src = readFile(projectUsagePath);
  assert.ok(src.includes("tokensCompact"), "expected project usage card to show tokens");
  assert.ok(src.includes("costDisplay") || src.includes("cost_usd"), "expected project usage card to show cost");
  assert.ok(src.includes("pricing_coverage") || src.includes("pricingCoverage"), "expected project usage card to show pricing coverage");
  assert.ok(src.includes("project_path") || src.includes("projectPath"), "expected project usage card to show project path");
});

test("ProjectUsagePanel constrains identity text width", () => {
  const src = readFile(projectUsagePath);
  assert.ok(src.includes("truncate"), "expected truncated identity text");
  assert.ok(src.includes("min-w-0"), "expected min width constraint for identity text");
});

test("DashboardPage wires install panel gating through helper", () => {
  const containerSrc = readFile(containerPath);
  const installStatusSrc = readFile(installStatusPath);
  const viewSrc = readFile(viewPath);
  assert.ok(containerSrc.includes("shouldShowInstallCard"), "expected install status helper usage");
  assert.ok(
    containerSrc.includes("has_active_device_token"),
    "expected snake_case install token field usage",
  );
  assert.ok(containerSrc.includes("hasActiveDeviceToken"), "expected camelCase fallback usage");
  assert.ok(
    containerSrc.includes("const shouldShowInstall =") &&
      containerSrc.includes("shouldShowInstallCard({"),
    "expected helper-based install gate assignment",
  );
  assert.ok(
    installStatusSrc.includes("publicMode || screenshotMode"),
    "expected helper to hide in public/screenshot mode",
  );
  assert.ok(
    installStatusSrc.includes("if (forceInstall) return true"),
    "expected helper to honor forceInstall",
  );
  assert.ok(installStatusSrc.includes("accessEnabled"), "expected helper to check accessEnabled");
  assert.ok(
    installStatusSrc.includes("!heatmapLoading"),
    "expected helper to check heatmapLoading",
  );
  assert.ok(installStatusSrc.includes("activeDays === 0"), "expected helper to gate on activeDays");
  assert.ok(
    installStatusSrc.includes("!hasActiveDeviceToken"),
    "expected helper to hide card for active device token",
  );
  assert.ok(
    viewSrc.includes("shouldShowInstall ? ("),
    "expected install panel to use shouldShowInstall",
  );
});

test("DashboardPage removes heatmap range label", () => {
  const src = readFile(viewPath);
  assert.ok(!src.includes("dashboard.activity.range"), "expected heatmap range label removed");
});

test("copy registry removes unused install steps and range label", () => {
  const csv = readFile(copyPath);
  const removed = [
    "dashboard.install.headline",
    "dashboard.install.step1",
    "dashboard.install.step2",
    "dashboard.install.step3",
    "dashboard.activity.range",
  ];
  for (const key of removed) {
    assert.ok(!csv.includes(key), `expected copy key removed: ${key}`);
  }
});

test("DashboardPage lets TrendMonitor auto-size", () => {
  const src = readFile(viewPath);
  assert.ok(!src.includes('className="min-h-[240px]"'), "expected TrendMonitor min height removed");
  assert.ok(src.includes("<TrendMonitor"), "expected TrendMonitor to be rendered");
});

test("TrendMonitor root does not force full height", () => {
  const src = readFile(
    path.join(
      __dirname,
      "..",
      "dashboard",
      "src",
      "ui",
      "dashboard",
      "components",
      "TrendMonitor.jsx",
    ),
  );
  assert.ok(src.includes("export function TrendMonitor"), "expected TrendMonitor component");
  assert.ok(
    src.includes('"tt-surface rounded-[var(--tt-card-radius)] p-5"'),
    "expected TrendMonitor to use the shared surface without forcing full height",
  );
  assert.ok(
    src.includes('isZoom && "flex h-full flex-col"'),
    "expected full height to remain limited to the zoom presentation",
  );
});

test("DashboardPage supports force_install preview", () => {
  const src = readFile(containerPath);
  assert.ok(src.includes("force_install"), "expected force_install query param support");
  assert.ok(
    src.includes("isProductionHost"),
    "expected force_install gated by production host check",
  );
  assert.ok(
    src.includes("forceInstall"),
    "expected forceInstall flag to influence install visibility",
  );
});

test("overview does not duplicate the request log from usage statistics", () => {
  const src = readFile(viewPath);
  assert.ok(!src.includes("RequestUsageLog"), "expected request log to exist only in usage statistics");
});

test("usage trend expands beside the readable 17rem Token service column", () => {
  const src = readFile(spendPath);
  assert.ok(
    src.includes("lg:grid-cols-[minmax(0,1fr)_17rem]"),
    "expected lower usage grid to reserve a readable 17rem Token service column",
  );
  assert.ok(!src.includes("lg:grid-cols-[minmax(0,1fr)_13rem]"), "expected the cramped 13rem Token service column removed");
});

test("overview places a model usage donut directly below the trend card in the left column", () => {
  const src = readFile(viewPath);
  const leftColumnIndex = src.indexOf("lg:col-span-4");
  const rightColumnIndex = src.indexOf("lg:col-span-8");
  const trendIndex = src.indexOf("<TrendMonitor");
  const donutIndex = src.indexOf("<ModelUsageDonut", trendIndex);

  assert.ok(leftColumnIndex !== -1, "expected left overview column");
  assert.ok(rightColumnIndex !== -1, "expected wider primary column");
  assert.ok(trendIndex !== -1, "expected usage trend");
  assert.ok(trendIndex > leftColumnIndex, "expected usage trend after the left column starts");
  assert.ok(donutIndex > trendIndex, "expected model donut after usage trend");
  assert.ok(donutIndex < rightColumnIndex, "expected model donut before the right column starts");
});

test("workspace and cards expose the approved layered surface hierarchy", () => {
  const sidebarSrc = readFile(sidebarPath);
  const cardSrc = readFile(cardPath);
  const overviewSrc = readFile(usageOverviewPath);
  const costSrc = readFile(costAccumulationPath);
  const appleGlassSrc = readFile(appleGlassPath);

  assert.ok(sidebarSrc.includes("bg-oai-gray-100/80"), "expected a visible workspace wash");
  assert.ok(sidebarSrc.includes("tt-main-work-surface"), "expected the main surface to float above the workspace");
  assert.ok(cardSrc.includes("rounded-[var(--tt-card-radius)]"), "expected cards to use the shared radius");
  assert.ok(cardSrc.includes('"tt-surface"'), "expected shared cards to use the glass surface");
  assert.ok(appleGlassSrc.includes("box-shadow: var(--tt-surface-shadow)"), "expected glass surfaces to have material depth");
  assert.ok(overviewSrc.includes("ring-2 ring-oai-brand-200"), "expected provider selection to have a strong selected state");
  assert.ok(costSrc.includes("tt-surface-nested"), "expected cost cards to use the nested surface depth");
});

test("custom spend group cards wrap names and preserve readable responsive amount columns", () => {
  const src = readFile(costAccumulationPath);
  const sectionStart = src.indexOf("function OtherAiGroupCostSection");
  const sectionEnd = src.indexOf("function TokenPackageSection", sectionStart);
  const section = src.slice(sectionStart, sectionEnd);

  assert.ok(section.includes("minmax(300px,1fr)"), "expected compact responsive card columns");
  assert.ok(section.includes("minmax(108px,1fr)"), "expected amount columns to wrap below their readable minimum");
  assert.ok(section.includes("break-words text-sm"), "expected group names to wrap at a readable size");
  assert.ok(section.includes("break-words text-xs"), "expected USD/CNY amounts to stay readable");
  assert.ok(!section.includes('<h4 className="truncate'), "group names must not use ellipsis truncation");
});

test("cost page can exercise 1280, 1440, and 1920 content widths without a fixed max-width cap", () => {
  const src = readFile(spendPath);
  const costPageStart = src.indexOf("function SpendCostPageInner");
  const costPage = src.slice(costPageStart);

  assert.ok(costPage.includes('className="mx-auto w-full max-w-none px-4 sm:px-6"'));
  assert.ok(!costPage.includes('className="mx-auto max-w-5xl px-4 sm:px-6"'));
});
