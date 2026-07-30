import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
  it.each(["primary", "secondary", "ghost"])(
    "keeps the %s variant tactile and caller classes additive",
    (variant) => {
      render(
        <Button variant={variant} size="sm" className="custom-button">
          {variant}
        </Button>,
      );

      expect(screen.getByRole("button", { name: variant })).toHaveClass(
        "tt-pressable",
        "rounded-[var(--tt-control-radius)]",
        "h-8",
        "custom-button",
      );
      expect(screen.getByRole("button", { name: variant })).not.toHaveClass(
        "active:scale-[0.98]",
      );
    },
  );

  it("uses native disabled semantics without adding motion classes", () => {
    render(<Button disabled>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("tt-pressable");
    expect(button).not.toHaveClass("active:scale-[0.98]");
  });

  it("makes a disabled polymorphic link inert", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button as="a" href="/settings" disabled onClick={onClick}>
        Settings
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(link).not.toHaveAttribute("disabled");

    await user.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("preserves caller-provided selected state", () => {
    render(<Button aria-pressed="true">Selected</Button>);

    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
