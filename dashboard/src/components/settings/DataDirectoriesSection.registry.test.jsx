import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
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

it("renders configurable data directories including OpenCode", async () => {
  render(<DataDirectoriesSection />);

  expect(await screen.findByLabelText("Claude Code 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Codex 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Hermes Agent 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("Cursor 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("OpenCode 数据目录")).toBeInTheDocument();
  expect(screen.getByLabelText("OpenClaw 数据目录")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "选择文件夹" })).toHaveLength(6);
});
