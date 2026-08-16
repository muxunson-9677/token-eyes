import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LimitsSettingsPanel } from "./LimitsSettingsPanel.jsx";

it("owns sorting from an accessible handle and keeps the visibility switch independent", () => {
  const moveToward = vi.fn();
  const toggle = vi.fn();
  render(<LimitsSettingsPanel prefs={{
    order: ["claude", "codex"],
    visibility: { claude: true, codex: true },
    moveToward,
    toggle,
  }} />);

  const handle = screen.getByRole("button", { name: "拖拽排序：Claude" });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(moveToward).toHaveBeenCalledWith("claude", "codex");

  fireEvent.click(screen.getByRole("switch", { name: /Claude/ }));
  expect(toggle).toHaveBeenCalledWith("claude");
  expect(moveToward).toHaveBeenCalledTimes(1);
});
