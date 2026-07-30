import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Palette } from "lucide-react";
import { SectionCard } from "./Controls.jsx";

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
});
