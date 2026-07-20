import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection, resolveDataDirectoryOrder } from "./DataDirectoriesSection.jsx";
import { getLocalSettings, selectLocalDirectory, setLocalSettings } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  detectLocalDataDirectories: vi.fn(),
  getAgentEnvironment: vi.fn(),
  getLocalSettings: vi.fn(),
  selectLocalDirectory: vi.fn(),
  setLocalSettings: vi.fn(),
  triggerLocalSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLocalSettings.mockResolvedValue({ dataDirectories: {} });
  selectLocalDirectory.mockResolvedValue({ ok: true, cancelled: true });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
});

it("normalizes a saved custom directory order and appends missing agents", () => {
  const order = resolveDataDirectoryOrder(["trae", "codebuddy", "trae", "unknown"]);
  expect(order.slice(0, 2)).toEqual(["trae", "codebuddy"]);
  expect(new Set(order).size).toBe(10);
  expect(order).toContain("codex");
});

it("renders the saved custom directory order", async () => {
  getLocalSettings.mockResolvedValue({ dataDirectories: {}, dataDirectoryOrder: ["trae", "codebuddy"] });
  render(<DataDirectoriesSection />);

  await screen.findAllByTestId("data-directory-row");
  await waitFor(() => expect(screen.getAllByTestId("data-directory-row")[0]).toHaveAttribute("data-directory-key", "trae"));
  expect(screen.getAllByTestId("data-directory-row")[1]).toHaveAttribute("data-directory-key", "codebuddy");
});

it("renders every limits agent directory and folds all secondary fields from the section header", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  expect(await screen.findByLabelText("Claude Code 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Codex 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Hermes Agent 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Cursor 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Trae 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("CodeBuddy 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Gemini CLI 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("OpenCode 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("OpenClaw 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Antigravity 数据目录")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "选择文件夹" })).toHaveLength(10);

  const sectionToggle = screen.getByRole("button", { name: "数据目录" });
  expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
  await user.click(sectionToggle);
  expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("Claude Code 数据目录")).not.toBeInTheDocument();
  await user.click(sectionToggle);
  expect(await screen.findByLabelText("Claude Code 数据目录")).toBeInTheDocument();
});
