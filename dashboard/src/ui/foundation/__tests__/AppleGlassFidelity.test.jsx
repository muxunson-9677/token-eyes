import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const glassCss = readFileSync(
  resolve("src/ui/foundation/apple-glass.css"),
  "utf8",
);
const stylesheet = postcss.parse(glassCss);

function declarations(selector) {
  const rule = stylesheet.nodes.find(
    (node) => node.type === "rule" && node.selector === selector,
  );
  return Object.fromEntries(
    (rule?.nodes || [])
      .filter((node) => node.type === "decl")
      .map((node) => [node.prop, node.value]),
  );
}

function declarationsFromSelectorList(selector) {
  const rule = stylesheet.nodes.find(
    (node) => node.type === "rule" && node.selector?.includes(selector),
  );
  return Object.fromEntries(
    (rule?.nodes || [])
      .filter((node) => node.type === "decl")
      .map((node) => [node.prop, node.value]),
  );
}

function mediaDeclarations(params, selector) {
  let result = {};
  stylesheet.walkAtRules("media", (rule) => {
    if (rule.params !== params) return;
    rule.walkRules(selector, (nestedRule) => {
      if (nestedRule.selector !== selector) return;
      result = Object.fromEntries(
        nestedRule.nodes
          .filter((node) => node.type === "decl")
          .map((node) => [node.prop, node.value]),
      );
    });
  });
  return result;
}

describe("approved M/N material fidelity", () => {
  it("keeps widget plan cards clean, content-height, equal within a row, and free of duplicated elevation", () => {
    const grid = ".tt-widget-plan-list > .tt-token-plan-grid";
    const card = ".tt-widget-plan-card";
    const header = ".tt-widget-plan-card__top";
    const check = ".tt-widget-plan-card .tt-widget-check";

    expect(declarations(grid)["align-items"]).toBe("stretch");
    expect(declarations(grid)["grid-template-columns"]).toBe("repeat(auto-fill, 264px)");
    expect(declarations(grid)["grid-auto-rows"]).toBe("auto");
    expect(declarations(card).height).toBe("100%");
    expect(declarations(card).outline).toBe("none");
    expect(declarations(card)["box-shadow"]).not.toContain("0 7px");
    expect(declarations(card).overflow).toBe("hidden");
    expect(declarations(header)["grid-template-columns"])
      .toBe("16px 30px minmax(0, 1fr) 20px");
    expect(declarations(check)["justify-self"]).toBe("end");
  });

  it("keeps widget summary cards readable in a narrow desktop window", () => {
    const summary = ".tt-widget-summary";
    const card = ".tt-widget-summary article";
    const content = ".tt-widget-summary article > div";

    expect(mediaDeclarations("(max-width: 1150px)", summary)["grid-template-columns"])
      .toBe("repeat(2, minmax(0, 1fr))");
    expect(mediaDeclarations("(max-width: 1150px)", summary).height).toBe("auto");
    expect(mediaDeclarations("(max-width: 1150px)", card)["min-width"]).toBe("0");
    expect(mediaDeclarations("(max-width: 1150px)", content)["min-width"]).toBe("0");
    expect(mediaDeclarations("(max-width: 820px)", summary)["grid-template-columns"])
      .toBe("minmax(0, 1fr)");
    expect(declarations(card)["box-shadow"]).toContain("0 18px 36px");
    expect(declarations(".tt-widget-projects")["box-shadow"]).toContain("0 18px 36px");
  });

  it("keeps the reference overview readable across desktop window widths", () => {
    const selector = ".tt-reference-route-dashboard .tt-overview-locked .tt-reference-overview-grid";
    const detailSelector = '.tt-reference-route-dashboard [data-testid="dashboard-detail-grid"]';
    const detailColumnSelector = `${detailSelector} > div`;

    expect(mediaDeclarations("(min-width: 1500px)", selector)["grid-template-columns"])
      .toBe("minmax(0, 1fr) minmax(0, 2fr)");
    expect(mediaDeclarations("(min-width: 1081px) and (max-width: 1499px)", selector)["grid-template-columns"])
      .toBe("minmax(400px, .95fr) minmax(0, 1.2fr)");
    expect(mediaDeclarations("(min-width: 1081px) and (max-width: 1499px)", detailSelector)["grid-template-columns"])
      .toBe("minmax(400px, .95fr) minmax(0, 1.2fr)");
    expect(mediaDeclarations("(min-width: 1081px) and (max-width: 1499px)", detailColumnSelector)["grid-column"])
      .toBe("auto");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1080px)", detailSelector)["grid-template-columns"])
      .toBe("minmax(0, 1fr)");
  });

  it("keeps overview model data complete with one functional scrollbar", () => {
    const stats = ".tt-reference-route-dashboard .tt-overview-stats";
    const ranking = ".tt-reference-route-dashboard .tt-overview-model-ranking";
    const rankingList = `${ranking} [data-testid="overview-model-list"]`;
    const fakeScrollbar = `${ranking}::after`;
    const modelLayout = '.tt-reference-route-dashboard [data-testid="model-usage-layout"]';
    const modelVisuals = '.tt-reference-route-dashboard [data-testid="model-usage-visuals"]';
    const compactRows = '.tt-reference-route-dashboard [data-testid="model-usage-table-head"],\n  .tt-reference-route-dashboard [data-model-rank-row="true"]';
    const compactProgress = '.tt-reference-route-dashboard [data-model-rank-row="true"] > span:nth-child(3) > span:last-child';
    const compactRadar = '.tt-reference-route-dashboard [data-testid="model-radar-panel"] > svg';
    const rankingName = '.tt-reference-route-dashboard [data-testid="overview-model-row"] .break-words';
    const distributionName = '.tt-reference-route-dashboard [data-model-rank-row="true"] .break-words';

    expect(declarations(stats).overflow).toBe("visible");
    expect(Object.keys(declarations(fakeScrollbar))).toHaveLength(0);
    expect(declarations(rankingList)["padding-left"]).toBe("5px");
    expect(declarations(rankingList)["padding-right"]).toBe("5px");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", modelLayout)["grid-template-columns"])
      .toBe("minmax(0, 1fr)");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", modelVisuals)["grid-template-columns"])
      .toBe("104px minmax(0, 1fr)");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", compactRows)["grid-template-columns"])
      .toBe("26px minmax(0, 1fr) 82px 42px");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", compactProgress).display)
      .toBeUndefined();
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", compactRadar).height)
      .toBe("104px");
    expect(mediaDeclarations("(min-width: 900px) and (max-width: 1500px)", compactRadar).width)
      .toBe("auto");
    expect(declarations(rankingName)["white-space"]).toBe("normal");
    expect(declarations(distributionName)["white-space"]).toBe("normal");
  });

  it("matches the Token reference with balanced evidence columns and a visible wave", () => {
    const route = ".tt-reference-route-dashboard";
    const hero = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero";
    const heroInner = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div";
    const summary = '.tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero [data-testid="usage-overview-summary-card"]';
    const toolbar = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div > div:first-child";
    const toolbarTab = '.tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero [role="tab"]';
    const toolbarControl = '.tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div > div:first-child > div:last-child button,\n.tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div > div:first-child > div:last-child select';
    const toolbarControlWide = '.tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div > div:first-child > div:last-child button,\n  .tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero > div > div:first-child > div:last-child select';
    const details = '.tt-reference-route-dashboard [data-testid="usage-summary-details"]';
    const detailsHeading = `${details} > div > div:first-child`;
    const detailsBody = `${details} > div > div:last-child`;
    const value = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-primary-total > div:nth-of-type(2)";
    const valueParts = '.tt-reference-route-dashboard .tt-overview-locked .tt-overview-primary-total > [data-testid="usage-summary-value"]';
    const number = `${valueParts} .tt-overview-total-number`;
    const unit = `${valueParts} .tt-overview-total-unit`;
    const primary = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-primary-total";
    const wave = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-token-wave-stage";
    const metrics = '.tt-reference-route-dashboard .tt-overview-locked [data-testid="usage-overview-metrics"]';
    const metric = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-mini-metric";
    const provider = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-provider-panel";
    const providerCard = ".tt-reference-route-dashboard .tt-overview-provider-panel .tt-provider-card";
    const providerGrid = ".tt-reference-route-dashboard .tt-overview-provider-panel .grid.grid-cols-2";
    const alignedStack = ".tt-reference-route-dashboard .tt-overview-locked .tt-overview-aligned-stack";
    const costHeading = '.tt-reference-route-dashboard [data-testid="usage-cost-summary-heading"]';

    expect(declarations(route)["--tt-card-radius"]).toBe("18px");
    expect(declarations(route)["--tt-surface-shadow"]).toContain("0 18px 38px rgba(31, 43, 56, 0.14)");
    expect(declarations(hero).height).toBe("620px");
    expect(declarations(heroInner)["padding-bottom"]).toBe("0");
    expect(declarations(summary).height).toBe("auto");
    expect(declarations(summary).flex).toBe("1 1 0");
    expect(declarations(toolbar)["margin-bottom"]).toBe("14px");
    expect(declarations(toolbarTab)["font-size"]).toBe("11px");
    expect(declarations(toolbarTab).padding).toBe("0 5px");
    expect(declarations(toolbarControl)["font-size"]).toBe("11px");
    expect(declarations(toolbarControl)["padding-right"]).toBe("6px");
    expect(declarations(toolbarControl)["padding-left"]).toBe("6px");
    expect(mediaDeclarations("(min-width: 1500px)", toolbarTab)["min-height"]).toBe("40px");
    expect(mediaDeclarations("(min-width: 1500px)", toolbarTab).padding).toBe("0 10px");
    expect(mediaDeclarations("(min-width: 1500px)", toolbarTab)["font-size"]).toBe("13px");
    expect(mediaDeclarations("(min-width: 1500px)", toolbarControlWide).height).toBe("40px");
    expect(mediaDeclarations("(min-width: 1500px)", toolbarControlWide)["font-size"]).toBe("12px");
    expect(declarations(details)["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");
    expect(declarations(details).margin).toBe("0");
    expect(declarations(details).border).toBe("0");
    expect(declarations(details)["border-top"]).toBe("1px solid rgba(31, 43, 56, 0.07)");
    expect(declarations(details)["border-radius"]).toBe("0 0 var(--tt-card-radius) var(--tt-card-radius)");
    expect(declarations(details).flex).toBe("1 1 auto");
    expect(declarations(details)["align-items"]).toBe("center");
    expect(declarations(details).transform).toBe("none");
    expect(declarations(detailsHeading)["font-size"]).toBe("11px");
    expect(declarations(detailsBody)["font-size"]).toBe("11px");
    expect(mediaDeclarations("(min-width: 1500px)", detailsHeading)["font-size"]).toBe("13px");
    expect(mediaDeclarations("(min-width: 1500px)", detailsBody)["font-size"]).toBe("12px");
    expect(declarations(value)["font-size"]).toBe("clamp(76px, 7vw, 92px)");
    expect(declarations(number)["letter-spacing"]).toBe("-0.055em");
    expect(declarations(unit)["letter-spacing"]).toBe("-0.01em");
    expect(declarations(primary).height).toBe("448px");
    expect(declarations(primary)["padding-top"]).toBe("60px");
    expect(declarations(wave).top).toBe("75px");
    expect(declarations(wave).height).toBe("230px");
    expect(declarations(wave).opacity).toBe("0.94");
    expect(declarations(metrics)["margin-top"]).toBe("115px");
    expect(declarations(metrics)["column-gap"]).toBe("35px");
    expect(declarations(metric).width).toBe("min(94px, 100%)");
    expect(declarations(provider).height).toBe("auto");
    // V4 item-4: auto-fill keeps card width identical across billing filter
    // tabs (auto-fit stretched the last sparse row's cards wider).
    expect(declarations(providerGrid)["grid-template-columns"])
      .toBe("repeat(auto-fill, minmax(122px, 1fr))");
    expect(mediaDeclarations("(min-width: 1200px)", alignedStack)["grid-template-rows"])
      .toBe("minmax(0, 620px) minmax(257px, auto)");
    expect(Object.keys(mediaDeclarations("(min-width: 1081px) and (max-width: 1199px)", providerGrid)))
      .toHaveLength(0);
    expect(Object.keys(mediaDeclarations("(min-width: 1081px) and (max-width: 1199px)", providerCard)))
      .toHaveLength(0);
    expect(declarations(costHeading)["font-size"]).toBe("11px");
  });

  it("keeps the reset heatmap right-aligned and makes widget presses unmistakable", () => {
    const resetData = ".tt-reference-route-reset-history .tt-reset-activity-data--right-aligned";
    const widgetPress = ".tt-reference-route-widgets button:not(:disabled):active,\n.tt-reference-route-widgets select:not(:disabled):active,\n.tt-reference-route-widgets [role=\"button\"]:not([aria-disabled=\"true\"]):active";
    const widgetRebound = ".tt-reference-route-widgets .tt-widget-click-bounce";

    expect(declarations(resetData)["justify-self"]).toBe("end");
    expect(declarations(resetData).width).toBe("100%");
    expect(declarations(resetData)["max-width"]).toBe("100%");
    expect(declarations(resetData)["min-width"]).toBe("0");
    expect(declarations(`${resetData} .tt-reset-heatmap`)["justify-content"]).toBe("flex-end");
    expect(declarations(`${resetData} .tt-reset-heatmap`)["max-width"]).toBe("100%");
    expect(declarations(widgetPress).transform).toBe("translateY(2px) scale(0.94)");
    expect(declarations(widgetRebound).animation).toContain("tt-widget-press-rebound");
    expect(declarations(widgetRebound).animation).toContain("300ms");
    expect(declarations(".tt-raised-control")["box-shadow"]).toContain("inset 0 1px 0");
    expect(declarations(".tt-raised-control").background).toContain("linear-gradient");
  });

  it("gives the reset celebration controls the same visible depth and rebound", () => {
    const resetControl = ".tt-reference-route-reset-history .tt-reset-effect-control";
    const resetRebound = ".tt-reference-route-reset-history .tt-reset-control-click-bounce";

    expect(declarations(resetControl)["box-shadow"]).toContain("inset 0 1px 0");
    expect(declarations(resetRebound).animation).toContain("tt-widget-press-rebound");
  });

  it("matches plan market cards to the accepted cost section material", () => {
    const reference = declarations('.tt-reference-route-spend-cost [data-cost-section][data-open="false"]');
    const stat = declarations(".tt-reference-route-spend-plans .tt-plan-market-stat");
    const provider = declarations(".tt-reference-route-spend-plans .tt-plan-market-provider");
    const plan = declarations(".tt-reference-route-spend-plans .tt-plan-market-plan-card");
    const separator = declarations(".tt-reference-route-spend-plans .tt-plan-market-metadata-separator");
    const referenceSeparator = declarations(".tt-reference-route-spend-cost .tt-cost-row-metric::before");
    const statIcon = declarations(".tt-reference-route-spend-plans .tt-plan-market-stat-icon");
    const providerName = declarations(".tt-reference-route-spend-plans .tt-plan-market-provider-name");
    const official = declarations(".tt-reference-route-spend-plans .tt-plan-market-official");
    const planCount = declarations(".tt-reference-route-spend-plans .tt-plan-market-plan-count,\n.tt-reference-route-spend-plans .tt-plan-market-starting-price");
    const darkCards = [
      declarations(":root.dark .tt-reference-route-spend-plans .tt-plan-market-stat"),
      declarations(":root.dark .tt-reference-route-spend-plans .tt-plan-market-provider"),
      declarations(":root.dark .tt-reference-route-spend-plans .tt-plan-market-plan-card"),
    ];

    for (const card of [stat, provider, plan]) {
      expect(card.background).toBe(reference.background);
      expect(card["border-color"]).toBe(reference["border-color"]);
      expect(card["box-shadow"]).toBe(reference["box-shadow"]);
      expect(card["box-shadow"]).not.toContain("0 3px 0");
    }
    expect(separator.width).toBe("1px");
    expect(separator.background).toBe(referenceSeparator.background);
    expect(separator["box-shadow"]).toBe("none");
    expect(statIcon["box-shadow"]).toBe("none");
    expect(providerName["font-size"]).toBe("16px");
    expect(providerName["font-weight"]).toBe("600");
    expect(official["font-size"]).toBe("10px");
    expect(planCount["font-size"]).toBe("14px");
    for (const card of darkCards) expect(card["box-shadow"]).not.toContain("0 3px 0");
  });

  it("uses one coherent dark surface system across the requested routes", () => {
    const darkRoot = declarations(":root.dark");
    const lightRoot = declarations(":root");
    for (const token of ["--tt-page-canvas", "--tt-page-surface", "--tt-page-ink"]) {
      expect(darkRoot[token]).toBeTruthy();
      expect(darkRoot[token]).not.toBe(lightRoot[token]);
    }

    const darkSelectors = [
      ":root.dark .tt-token-service-card",
      ":root.dark.tt-reference-route-reset-history .tt-reset-activity",
      ":root.dark.tt-reference-route-reset-history .tt-reset-stat-card",
      ":root.dark.tt-reference-route-reset-history .tt-reset-history-card",
      ":root.dark.tt-reference-route-reset-history .tt-reset-history-empty",
      ":root.dark .tt-reference-route-spend-plans .tt-plan-market-provider",
      ":root.dark .tt-reference-route-spend-plans .tt-plan-market-plan-card",
      ":root.dark .tt-reference-route-dashboard .tt-overview-locked .tt-overview-usage-hero",
      ":root.dark .tt-reference-route-dashboard .tt-overview-locked .tt-overview-mini-metric",
    ];
    for (const selector of darkSelectors) {
      const background = declarationsFromSelectorList(selector).background || "";
      expect(background, selector).not.toBe("");
      expect(background, selector).not.toBe(lightRoot["--tt-page-surface"]);
    }
  });

  it("renders provider details as a floating overlay without growing the stack", () => {
    const providerPanel = ".tt-reference-route-dashboard .tt-overview-provider-panel--expanded";
    const providerStage = ".tt-reference-route-dashboard .tt-provider-card-stage";
    const providerOverlay = ".tt-reference-route-dashboard .tt-provider-expanded-region";

    expect(declarations(providerPanel)["z-index"]).toBe("40");
    expect(declarations(providerStage).position).toBe("relative");
    expect(declarations(providerOverlay).position).toBe("absolute");
    expect(declarations(providerOverlay).top).toBe("calc(100% + 8px)");
    expect(declarations(providerOverlay).padding).toBe("14px 16px 16px");
    expect(declarations(providerOverlay)["overflow-x"]).toBe("hidden");
    expect(declarations(providerOverlay)["scrollbar-gutter"]).toBe("stable");
  });

  it("defines the component-level materials from the approved prototypes", () => {
    const light = declarations(":root");
    const dark = declarations(":root.dark");

    for (const property of [
      "--tt-shell-environment",
      "--tt-sidebar-surface",
      "--tt-control-well",
      "--tt-control-surface",
      "--tt-control-selected",
      "--tt-nested-outline",
      "--tt-nested-shadow",
      "--tt-metric-input-surface",
      "--tt-metric-output-surface",
      "--tt-metric-create-surface",
      "--tt-metric-hit-surface",
      "--tt-service-surface",
      "--tt-service-hover-surface",
    ]) {
      expect(light[property], `light ${property}`).toBeTruthy();
      expect(dark[property], `dark ${property}`).toBeTruthy();
    }

    expect(light["--tt-control-well"]).not.toBe(dark["--tt-control-well"]);
    expect(light["--tt-surface-blur"]).toBe("18px");
    expect(dark["--tt-surface-blur"]).toBe("30px");
  });

  it("maps the approved materials onto real product hooks", () => {
    expect(declarations(".tt-usage-dimension").background)
      .toBe("var(--tt-metric-surface)");
    expect(declarations('.tt-usage-dimension[data-dimension="input"]')?.background)
      .toBe("var(--tt-metric-input-surface)");
    expect(declarations('.tt-usage-dimension[data-dimension="output"]')?.background)
      .toBe("var(--tt-metric-output-surface)");
    expect(declarations('.tt-usage-dimension[data-dimension="cache_create"]')?.background)
      .toBe("var(--tt-metric-create-surface)");
    expect(declarations('.tt-usage-dimension[data-dimension="cache_hit"]')?.background)
      .toBe("var(--tt-metric-hit-surface)");
    expect(declarations(".tt-token-service-card").background)
      .toContain("linear-gradient");
    expect(declarations(".tt-provider-card").background)
      .toBe("var(--tt-service-surface)");
    expect(declarations(".tt-theme-trigger").background)
      .toBe("var(--tt-control-surface)");
  });

  it("connects actual usage components to the fidelity hooks", () => {
    const stats = readFileSync(
      resolve("src/ui/dashboard/components/UsageStatsPanel.jsx"),
      "utf8",
    );
    const overview = readFileSync(
      resolve("src/ui/dashboard/components/UsageOverview.jsx"),
      "utf8",
    );
    const services = readFileSync(
      resolve("src/ui/dashboard/components/TokenServiceList.jsx"),
      "utf8",
    );

    expect(stats).toContain("tt-usage-dimension");
    expect(stats).toContain("data-dimension={card.key}");
    expect(overview).toContain("tt-provider-card");
    expect(services).toContain("tt-token-service-card");
  });
});
