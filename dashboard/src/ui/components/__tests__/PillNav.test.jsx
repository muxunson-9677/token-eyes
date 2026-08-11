import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const motionState = vi.hoisted(() => ({ reduced: false }));

vi.mock("motion/react", () => ({
  LayoutGroup: ({ children }) => children,
  motion: {
    span: ({ layoutId: _layoutId, transition: _transition, ...props }) => (
      <span {...props} />
    ),
  },
  useReducedMotion: () => motionState.reduced,
}));

import { PillNav } from "../PillNav";

const options = [
  { value: "projects", label: "Projects" },
  { value: "limits", label: "Usage limits" },
  { value: "models", label: "Model usage" },
];

describe("PillNav", () => {
  beforeEach(() => {
    motionState.reduced = false;
  });

  it("previews a hovered option, restores the selected option, and requests one change", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <PillNav
        value="projects"
        options={options}
        onValueChange={onValueChange}
        ariaLabel="Information mode"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Information mode" });
    const projects = screen.getByRole("button", { name: "Projects" });
    const limits = screen.getByRole("button", { name: "Usage limits" });
    expect(projects).toHaveAttribute("aria-pressed", "true");
    expect(limits).toHaveAttribute("aria-pressed", "false");
    expect(nav).toHaveAttribute("data-preview-value", "projects");

    await act(async () => user.hover(limits));
    expect(nav).toHaveAttribute("data-preview-value", "limits");
    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => user.unhover(limits));
    expect(nav).toHaveAttribute("data-preview-value", "projects");
    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => user.click(limits));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("limits");
  });

  it("remains controlled until the selected value prop changes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <PillNav
        value="projects"
        options={options}
        onValueChange={onValueChange}
        ariaLabel="Information mode"
      />,
    );

    await act(async () => (
      user.click(screen.getByRole("button", { name: "Usage limits" }))
    ));
    expect(screen.getByRole("button", { name: "Projects" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Usage limits" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(
      <PillNav
        value="limits"
        options={options}
        onValueChange={onValueChange}
        ariaLabel="Information mode"
      />,
    );
    expect(screen.getByRole("navigation", { name: "Information mode" })).toHaveAttribute(
      "data-preview-value",
      "limits",
    );
    expect(screen.getByRole("button", { name: "Usage limits" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("moves focus and preview with arrows without saving, then selects with Enter or Space", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <PillNav
        value="projects"
        options={options}
        onValueChange={onValueChange}
        ariaLabel="Information mode"
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Information mode" });
    const projects = screen.getByRole("button", { name: "Projects" });
    const limits = screen.getByRole("button", { name: "Usage limits" });
    const models = screen.getByRole("button", { name: "Model usage" });

    await act(async () => user.tab());
    expect(projects).toHaveFocus();
    await act(async () => user.keyboard("{ArrowRight}"));
    expect(limits).toHaveFocus();
    expect(nav).toHaveAttribute("data-preview-value", "limits");
    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => user.keyboard("{Enter}"));
    expect(onValueChange).toHaveBeenLastCalledWith("limits");

    onValueChange.mockClear();
    await act(async () => user.keyboard("{ArrowRight}"));
    expect(models).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
    await act(async () => user.keyboard(" "));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("models");

    onValueChange.mockClear();
    await act(async () => user.keyboard("{ArrowRight}"));
    expect(projects).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();

    await act(async () => user.keyboard("{ArrowLeft}"));
    expect(models).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("restores selected preview and roving focus when focus leaves the navigation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PillNav
          value="projects"
          options={options}
          onValueChange={vi.fn()}
          ariaLabel="Information mode"
        />
        <button
          type="button"
          data-testid="outside"
          aria-label={options.map((option) => option.value).join("-")}
        />
      </>,
    );

    const nav = screen.getByRole("navigation", { name: "Information mode" });
    const projects = screen.getByRole("button", { name: "Projects" });
    await act(async () => user.tab());
    expect(projects).toHaveFocus();
    await act(async () => user.keyboard("{ArrowRight}"));
    await act(async () => user.click(screen.getByTestId("outside")));

    expect(nav).toHaveAttribute("data-preview-value", "projects");
    expect(projects).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: "Usage limits" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("keeps the keyboard preview when the pointer leaves until focus leaves the navigation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PillNav
          value="projects"
          options={options}
          onValueChange={vi.fn()}
          ariaLabel="Information mode"
        />
        <button type="button" data-testid="outside" />
      </>,
    );

    const nav = screen.getByRole("navigation", { name: "Information mode" });
    const projects = screen.getByRole("button", { name: "Projects" });
    const limits = screen.getByRole("button", { name: "Usage limits" });
    const models = screen.getByRole("button", { name: "Model usage" });

    await act(async () => user.hover(models));
    expect(nav).toHaveAttribute("data-preview-value", "models");

    await act(async () => user.tab());
    expect(projects).toHaveFocus();
    await act(async () => user.keyboard("{ArrowRight}"));
    expect(limits).toHaveFocus();
    expect(nav).toHaveAttribute("data-preview-value", "limits");

    await act(async () => user.unhover(models));
    expect(limits).toHaveFocus();
    expect(nav).toHaveAttribute("data-preview-value", "limits");

    await act(async () => user.click(screen.getByTestId("outside")));
    expect(nav).toHaveAttribute("data-preview-value", "projects");
  });

  it("removes indicator motion when reduced motion is requested", () => {
    motionState.reduced = true;
    render(
      <PillNav
        value="projects"
        options={options}
        onValueChange={vi.fn()}
        ariaLabel="Information mode"
      />,
    );

    expect(screen.getByTestId("pill-nav-indicator")).toHaveAttribute(
      "data-motion-duration",
      "0",
    );
    expect(screen.getByRole("navigation", { name: "Information mode" })).toHaveAttribute(
      "data-reduced-motion",
      "true",
    );
  });
});
