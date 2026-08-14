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
const spendPath = path.join(__dirname, "..", "dashboard", "src", "pages", "SpendPage.jsx");
const sidebarPath = path.join(__dirname, "..", "dashboard", "src", "ui", "components", "Sidebar.jsx");
const cardPath = path.join(__dirname, "..", "dashboard", "src", "ui", "components", "Card.jsx");
const usageOverviewPath = path.join(__dirname, "..", "dashboard", "src", "ui", "dashboard", "components", "UsageOverview.jsx");
const costAccumulationPath = path.join(__dirname, "..", "dashboard", "src", "ui", "dashboard", "components", "CostAccumulation.jsx");
const appleGlassPath = path.join(__dirname, "..", "dashboard", "src", "ui", "foundation", "apple-glass.css");
const dashboardSkeletonPath = path.join(__dirname, "..", "dashboard", "src", "components", "DashboardSkeleton.jsx");
const usageStatsPath = path.join(
  __dirname,
  "..",
  "dashboard",
  "src",
  "ui",
  "dashboard",
  "components",
  "UsageStatsPanel.jsx",
);
const settingsPath = path.join(__dirname, "..", "dashboard", "src", "pages", "SettingsPage.jsx");
const resetHistoryPath = path.join(__dirname, "..", "dashboard", "src", "pages", "ResetHistoryPage.tsx");

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("DashboardPage keeps approved secondary analytics in the normal overview", () => {
  const src = readFile(viewPath);
  const secondaryIndex = src.indexOf('data-testid="dashboard-secondary-context"');
  const statsIndex = src.indexOf("<StatsPanel");
  const trendIndex = src.indexOf("<TrendMonitor", statsIndex);
  const detailGridIndex = src.indexOf('data-testid="dashboard-detail-grid"');
  const donutIndex = src.indexOf("<ModelUsageDonut", detailGridIndex);
  const detailsIndex = src.indexOf("<DataDetails", detailGridIndex);

  assert.ok(secondaryIndex !== -1, "expected the compact secondary overview column");
  assert.ok(statsIndex > secondaryIndex, "expected StatsPanel in the secondary overview column");
  assert.ok(trendIndex > statsIndex, "expected the original compact TrendMonitor after StatsPanel");
  assert.ok(detailGridIndex > trendIndex, "expected detail grid after TrendMonitor");
  assert.ok(donutIndex > detailGridIndex, "expected ModelUsageDonut in the detail grid");
  assert.ok(detailsIndex > donutIndex, "expected DataDetails beside ModelUsageDonut");
  assert.ok(!src.includes("activityHeatmapBlock"), "expected heatmap block to remain removed");
});

test("DashboardPage keeps its primary usage panel separate from the eight-column data details panel", () => {
  const src = readFile(viewPath);
  const workspaceStart = src.indexOf('data-testid="dashboard-primary-workspace"');
  const overviewIndex = src.indexOf("<UsageOverview", workspaceStart);
  const detailGridIndex = src.indexOf('data-testid="dashboard-detail-grid"');
  const detailsIndex = src.indexOf("<DataDetails", detailGridIndex);
  assert.ok(workspaceStart !== -1, "expected primary workspace markup");
  assert.ok(overviewIndex > workspaceStart, "expected UsageOverview in the primary workspace");
  assert.ok(detailGridIndex > overviewIndex, "expected the dedicated detail grid after the primary workspace");
  assert.ok(src.slice(detailGridIndex, detailsIndex).includes("lg:col-span-8"), "expected eight-column data details panel");
  assert.ok(detailsIndex > detailGridIndex, "expected DataDetails in the dedicated details panel");
});

test("Dashboard refreshes primary data before secondary analytics without failing the whole overview", () => {
  const src = readFile(containerPath);
  const refreshStart = src.indexOf("const refreshAll = useCallback");
  const refreshEnd = src.indexOf("const handleUsageRefresh", refreshStart);
  const refreshBlock = src.slice(refreshStart, refreshEnd);
  const primaryRefresh = refreshBlock.indexOf("await Promise.all([refreshUsage({ background }), refreshUsageLimits()])");
  const secondaryRefresh = refreshBlock.indexOf("await Promise.allSettled([");

  assert.ok(primaryRefresh !== -1, "expected primary usage and quota refresh first");
  assert.ok(secondaryRefresh > primaryRefresh, "expected secondary analytics after the primary summary");
  assert.ok(refreshBlock.includes("refreshTrend()"), "expected trend refresh");
  assert.ok(refreshBlock.includes("refreshModelBreakdown()"), "expected model refresh");
  assert.ok(refreshBlock.includes("refreshProjectUsage()"), "expected project refresh");
  assert.ok(refreshBlock.includes("refreshDailyBreakdown({ background })"), "expected daily refresh");
  assert.ok(!refreshBlock.includes("if (!screenshotMode)"), "expected normal mode to refresh secondary analytics");
});

test("Dashboard skeleton mirrors the restored two-column overview", () => {
  const src = readFile(dashboardSkeletonPath);
  assert.ok(src.includes("grid-cols-1"), "expected a responsive skeleton grid");
  assert.ok(src.includes("lg:col-span-4"), "expected a secondary-column skeleton");
  assert.ok(src.includes("lg:col-span-8"), "expected a primary-column skeleton");
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
  assert.ok(src.includes("formatCompactNumber(tokens"), "expected project usage card to show tokens");
  assert.ok(src.includes("costDisplay") || src.includes("cost_usd"), "expected project usage card to show cost");
  assert.ok(src.includes("pricing_coverage") || src.includes("pricingCoverage"), "expected project usage card to show pricing coverage");
  assert.ok(src.includes("project_path") || src.includes("projectPath"), "expected project usage card to show project path");
});

test("ProjectUsagePanel constrains identity text width", () => {
  const src = readFile(projectUsagePath);
  assert.ok(src.includes("truncate"), "expected truncated identity text");
  assert.ok(src.includes("min-w-0"), "expected min width constraint for identity text");
});

test("DashboardPage does not restore the removed initialization prompt", () => {
  const containerSrc = readFile(containerPath);
  const viewSrc = readFile(viewPath);
  assert.ok(!containerSrc.includes("shouldShowInstallCard"), "removed prompt must not be gated back in");
  assert.ok(!containerSrc.includes("installSyncCommand"), "removed init command must stay out of the container");
  assert.ok(!viewSrc.includes("shouldShowInstall ? ("), "removed prompt must stay out of the view");
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

test("DashboardPage does not expose the removed force_install preview", () => {
  const src = readFile(containerPath);
  assert.ok(!src.includes("force_install"), "removed initialization prompt must not have a preview backdoor");
  assert.ok(!src.includes("forceInstall"), "removed initialization prompt must not be restorable by state");
});

test("overview does not duplicate the request log from usage statistics", () => {
  const src = readFile(viewPath);
  assert.ok(!src.includes("RequestUsageLog"), "expected request log to exist only in usage statistics");
});

test("usage trend uses the approved 3:1 layout beside Token services", () => {
  const src = readFile(spendPath);
  assert.ok(
    src.includes("lg:grid-cols-4"),
    "expected lower usage grid to use four equal tracks for the approved 3:1 layout",
  );
  assert.ok(src.includes("lg:col-span-3"), "expected usage trend to span three tracks");
  assert.ok(src.includes("lg:col-span-1"), "expected Token services to occupy one track");
});

test("overview preserves approved analysis and dedicated next-step actions", () => {
  const src = readFile(viewPath);
  assert.ok(src.includes("onOpenUsageDetails"), "expected a dedicated usage-details action");
  assert.ok(src.includes("onOpenCost"), "expected a dedicated cost-and-quota action");
  assert.ok(src.includes("onOpenDataSources"), "expected a dedicated data-sources action");
  assert.ok(src.includes("<DataDetails"), "expected approved detailed analysis on the overview");
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

  assert.ok(section.includes("tt-cost-group-grid"), "expected responsive cost group grid");
  assert.ok(section.includes("tt-cost-group-card"), "expected responsive cost group cards");
  assert.ok(section.includes("break-words text-sm"), "expected group names to wrap at a readable size");
  assert.ok(section.includes("text-xs text-oai-gray-500"), "expected USD/CNY amounts to stay readable");
  assert.ok(!section.includes('<h4 className="truncate'), "group names must not use ellipsis truncation");
});

test("cost section summaries stay visible and header geometry stays fixed while details expand", () => {
  const src = readFile(costAccumulationPath);
  const css = readFile(appleGlassPath);

  assert.ok(src.includes("{summaryMetrics.length > 0 ? ("), "expected metrics in both collapsed and expanded states");
  assert.ok(!src.includes("{!open && summaryMetrics.length > 0 ? ("), "expanded sections must not remove summary metrics");
  assert.ok(!css.includes('body:has(.tt-reference-route-spend-cost [data-cost-section][data-open="true"])'), "one expanded section must not hide sibling summaries");
  assert.ok(css.includes('[data-cost-section][data-open="false"] > div:first-child'), "expected a closed-state margin override without moving the header content");
  assert.ok(css.includes("transform: none;"), "collapsed and expanded headers must keep the same vertical origin");
  assert.ok(css.includes('[data-cost-section] > div:first-child > button:hover'), "section toggles must not shift their labels on hover");
});

test("cost page can exercise 1280, 1440, and 1920 content widths without a fixed max-width cap", () => {
  const src = readFile(spendPath);
  const costPageStart = src.indexOf("function SpendCostPageInner");
  const costPage = src.slice(costPageStart);

  assert.ok(costPage.includes('className="mx-auto w-full max-w-none px-4 sm:px-6"'));
  assert.ok(!costPage.includes('className="mx-auto max-w-5xl px-4 sm:px-6"'));
});

test("approved overview, usage, settings, diagnostics, and reset-history capabilities cannot be removed", () => {
  const dashboardSrc = readFile(viewPath);
  const usageSrc = readFile(usageStatsPath);
  const settingsSrc = readFile(settingsPath);
  const sidebarSrc = readFile(sidebarPath);
  const resetHistorySrc = readFile(resetHistoryPath);

  assert.ok(dashboardSrc.includes("<StatsPanel"), "expected overview secondary context");
  assert.ok(dashboardSrc.includes("<DataDetails"), "expected overview data details");
  assert.ok(usageSrc.includes('data-testid="usage-cost-summary"'), "expected usage cost summary");
  assert.ok(usageSrc.includes('data-testid="monthly-cost-comparison"'), "expected monthly comparison");
  assert.ok(settingsSrc.includes("<DataDirectoriesSection"), "expected data directories in general settings");
  for (const component of [
    "<AgentPricingSection",
    "<TokenPlanSection",
    "<ProviderApiConfigSection",
    "<OtherAiSpendSection",
  ]) {
    assert.ok(settingsSrc.includes(component), `expected cost settings module ${component}`);
  }
  assert.ok(sidebarSrc.includes('to: "/settings/data"'), "expected settings data diagnostics item");
  assert.ok(!sidebarSrc.includes('to: "/data-sources"'), "legacy data-sources route must not be a primary item");
  assert.ok(resetHistorySrc.includes("triggerResetCelebrationPreview"), "expected reset effect preview");
  assert.ok(resetHistorySrc.includes('data-testid="reset-history-source-index"'), "expected reset source index");
});
