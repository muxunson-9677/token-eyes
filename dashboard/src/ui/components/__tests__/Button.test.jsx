import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
    const onAuxClick = vi.fn();
    render(
      <Button
        as="a"
        href="/settings"
        disabled
        onClick={onClick}
        onAuxClick={onAuxClick}
      >
        Settings
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).not.toHaveAttribute("href");
    expect(link).toHaveAttribute("role", "link");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(link).not.toHaveAttribute("disabled");

    await user.click(link);
    fireEvent(
      link,
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    );
    expect(onClick).not.toHaveBeenCalled();
    expect(onAuxClick).not.toHaveBeenCalled();
  });

  it("removes navigation from a disabled custom component with href", () => {
    function CustomAnchor(props) {
      return <a {...props} />;
    }

    render(
      <Button as={CustomAnchor} href="/docs" disabled>
        Documentation
      </Button>,
    );

    const anchor = screen.getByRole("link", { name: "Documentation" });
    expect(anchor).not.toHaveAttribute("href");
    expect(anchor).not.toHaveAttribute("disabled");
    expect(anchor).toHaveAttribute("role", "link");
    expect(anchor).toHaveAttribute("aria-disabled", "true");
    expect(anchor).toHaveAttribute("tabindex", "-1");
  });

  it("passes disabled through to a custom button component", () => {
    function CustomButton(props) {
      return <button {...props} />;
    }

    render(
      <Button as={CustomButton} disabled>
        Custom save
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Custom save" })).toBeDisabled();
  });

  it("preserves caller-provided selected state", () => {
    render(<Button aria-pressed="true">Selected</Button>);

    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
