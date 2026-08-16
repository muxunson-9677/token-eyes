import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { beforeEach, describe, expect, it } from "vitest";
import { Palette } from "lucide-react";
import {
  SectionCard,
  SegmentedControl,
  ToggleSwitch,
} from "./Controls.jsx";

beforeEach(() => {
  window.localStorage.clear();
});

describe("SectionCard visual identity", () => {
  it("defaults closed and restores each persisted disclosure independently", async () => {
    const user = userEvent.setup();
    const sectionContent = "content";
    const { unmount } = render(
      <SectionCard
        title="Provider API"
        collapsible
        defaultOpen={false}
        storageKey="cost.provider-api"
      >
        <div>{sectionContent}</div>
      </SectionCard>,
    );

    const trigger = screen.getByRole("button", { name: "Provider API" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("content")).not.toBeInTheDocument();

    await act(async () => {
      await user.click(trigger);
    });
    expect(window.localStorage.getItem("token-eyes.settings.disclosure.cost.provider-api.v1"))
      .toBe("1");
    expect(screen.getByText("content")).toBeInTheDocument();

    unmount();
    render(
      <SectionCard
        title="Provider API"
        collapsible
        defaultOpen={false}
        storageKey="cost.provider-api"
      >
        <div>{sectionContent}</div>
      </SectionCard>,
    );
    expect(screen.getByRole("button", { name: "Provider API" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem("token-eyes.settings.disclosure.cost.other-ai.v1"))
      .toBeNull();
  });

  it("renders an optional semantic icon without changing iconless cards", () => {
    const { rerender } = render(
      <SectionCard title="外观" icon={Palette} iconTone="blue">
        <div>内容</div>
      </SectionCard>,
    );

    expect(screen.getByTestId("settings-section-icon")).toHaveAttribute("data-tone", "blue");
    expect(screen.getByTestId("settings-section-icon").querySelector("svg")).not.toBeNull();

    rerender(
      <SectionCard title="普通">
        <div>内容</div>
      </SectionCard>,
    );

    expect(screen.queryByTestId("settings-section-icon")).toBeNull();
  });

  it("renders a real collapsed summary badge from live data (not CSS content hacks)", () => {
    const hiddenBody = "hidden body";
    render(
      <SectionCard
        title="Token plans"
        collapsible
        defaultOpen={false}
        storageKey="cost.token-plans"
        collapsedSummary="6 plans"
        collapsedSummaryTone="violet"
      >
        <div>{hiddenBody}</div>
      </SectionCard>,
    );

    const badge = screen.getByTestId("settings-section-collapsed-summary");
    expect(badge).toHaveTextContent("6 plans");
    expect(badge).toHaveAttribute("data-tone", "violet");
    expect(screen.queryByText(hiddenBody)).not.toBeInTheDocument();
  });

  it("keeps header actions and the live summary visible while a section is collapsed", () => {
    const actionLabel = "How pricing works?";
    const detailsText = "expanded-only details";
    render(
      <SectionCard
        title="Model pricing"
        collapsible
        defaultOpen={false}
        collapsedSummary="3 configured"
        action={<button type="button">{actionLabel}</button>}
      >
        <div>{detailsText}</div>
      </SectionCard>,
    );

    expect(screen.getByRole("button", { name: actionLabel })).toBeVisible();
    expect(screen.getByTestId("settings-section-collapsed-summary")).toHaveTextContent("3 configured");
    expect(screen.queryByText(detailsText)).not.toBeInTheDocument();
  });

  it("keeps the exact same header action and summary while section details open", async () => {
    const user = userEvent.setup();
    const actionLabel = "How pricing works?";
    const detailsText = ["expanded", "only", "details"].join("-");
    render(
      <SectionCard
        title="Model pricing"
        collapsible
        defaultOpen={false}
        collapsedSummary="3 configured"
        action={<button type="button">{actionLabel}</button>}
      >
        <div>{detailsText}</div>
      </SectionCard>,
    );

    await user.click(screen.getByRole("button", { name: "Model pricing" }));

    expect(screen.getByRole("button", { name: actionLabel })).toBeVisible();
    expect(screen.getByTestId("settings-section-collapsed-summary")).toHaveTextContent("3 configured");
    expect(screen.getByText(detailsText)).toBeVisible();
    expect(screen.getByText(detailsText).parentElement).toHaveClass("tt-section-card-body");
  });

  it("uses the shared glass hierarchy and visible keyboard focus for settings controls", () => {
    render(
      <SectionCard title="Limits" collapsible>
        <ToggleSwitch checked onChange={() => {}} ariaLabel="Usage limits" />
        <SegmentedControl
          value="used"
          onChange={() => {}}
          options={[
            { value: "used", label: "Used" },
            { value: "remaining", label: "Remaining" },
          ]}
        />
      </SectionCard>,
    );

    expect(screen.getByRole("heading", { name: "Limits" }).closest(".tt-surface")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Limits" })).toHaveClass(
      "tt-product-focusable",
    );
    expect(screen.getByRole("switch", { name: "Usage limits" })).toHaveClass(
      "tt-pressable",
      "tt-product-focusable",
      "h-10",
      "w-10",
    );
    expect(screen.getAllByRole("button", { pressed: true })[0]).toHaveClass(
      "tt-pressable",
      "tt-product-focusable",
      "min-h-10",
    );
  });
});

describe("product focus token contract", () => {
  it("keeps every interactive element visibly focused without a blanket suppression rule", () => {
    const stylesheet = postcss.parse(readFileSync(resolve("src/styles.css"), "utf8"));
    const rules = stylesheet.nodes.filter((node) => node.type === "rule");
    const blanketSuppression = rules.find((rule) =>
      rule.selector
        .split(",")
        .map((selector) => selector.trim())
        .includes("*:focus-visible") &&
      rule.nodes.some((node) => node.prop === "outline" && node.value === "none"),
    );
    const interactiveFocusRule = rules.find(
      (node) =>
        node.selector ===
        ':is(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])):focus-visible',
    );
    const baseFocusRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ".tt-product-focusable:focus-visible",
    );
    const darkFocusRule = stylesheet.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ":root.dark .tt-product-focusable:focus-visible",
    );

    expect(blanketSuppression).toBeUndefined();
    expect(
      interactiveFocusRule.nodes.find((node) => node.prop === "outline")?.value,
    ).toBe("2px solid var(--oai-black)");
    expect(
      baseFocusRule.nodes.find((node) => node.prop === "outline")?.value,
    ).toBe("2px solid var(--oai-black)");
    expect(
      darkFocusRule.nodes.find((node) => node.prop === "outline-color")?.value,
    ).toBe("var(--oai-black)");
  });
});
