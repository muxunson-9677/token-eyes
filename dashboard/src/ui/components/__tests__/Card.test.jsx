import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "../Card";

describe("Card", () => {
  it("uses the default glass surface without changing its content contract", () => {
    const { container } = render(
      <Card
        title="Usage"
        subtitle="Last 30 days"
        className="custom-card"
        bodyClassName="custom-body"
      >
        <span>42 tokens</span>
      </Card>,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass(
      "tt-surface",
      "rounded-[var(--tt-card-radius)]",
      "transition-colors",
      "duration-200",
      "custom-card",
    );
    expect(root).not.toHaveClass(
      "bg-white",
      "border-oai-gray-200",
      "rounded-xl",
    );
    expect(screen.getByRole("heading", { name: "Usage" })).toHaveClass(
      "text-sm",
    );
    expect(screen.getByText("Last 30 days")).toHaveClass("text-sm", "mt-1");
    expect(screen.getByText("42 tokens").parentElement).toHaveClass(
      "p-5",
      "custom-body",
    );
  });

  it("uses the nested glass surface only for the explicit nested variant", () => {
    const { container } = render(<Card variant="nested">Nested content</Card>);

    const root = container.firstElementChild;
    expect(root).toHaveClass(
      "tt-surface-nested",
      "rounded-[var(--tt-card-radius)]",
    );
    expect(root).not.toHaveClass("tt-surface");
  });
});
