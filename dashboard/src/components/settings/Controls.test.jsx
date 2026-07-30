import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Palette } from "lucide-react";
import {
  SectionCard,
  SegmentedControl,
  ToggleSwitch,
} from "./Controls.jsx";

describe("SectionCard visual identity", () => {
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
    );
    expect(screen.getAllByRole("button", { pressed: true })[0]).toHaveClass(
      "tt-pressable",
      "tt-product-focusable",
    );
  });
});
