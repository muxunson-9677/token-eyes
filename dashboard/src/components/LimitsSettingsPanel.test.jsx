import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LimitsSettingsPanel } from "./LimitsSettingsPanel.jsx";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/LimitsSettingsPanel.jsx"), "utf8");

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

it("keeps the dragged Agent sharp instead of fading a blurry ghost", () => {
  expect(source).not.toContain('isDragging && "relative z-10 opacity-60 shadow-lg"');
  expect(source).toMatch(/isDragging\s*&&\s*"[^"]*opacity-100[^"]*shadow-xl/);
  expect(source).toContain('willChange: isDragging ? "transform" : undefined');
});

it("lets dnd-kit own the live drag transform without a competing motion transform", () => {
  expect(source).not.toContain('from "motion/react"');
  expect(source).not.toContain("<motion.div");
  expect(source).toContain("transform: CSS.Transform.toString(transform)");
});
