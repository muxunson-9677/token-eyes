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

describe("approved M/N material fidelity", () => {
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
      .toBe("var(--tt-service-surface)");
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
