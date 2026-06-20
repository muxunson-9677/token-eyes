import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
import { getLocalSettings, selectLocalDirectory, setLocalSettings } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  selectLocalDirectory: vi.fn(),
  setLocalSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem("tokentracker_native_app");
  delete window.chrome;
  getLocalSettings.mockResolvedValue({
    dataDirectories: {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "",
      hermes: "",
    },
  });
  selectLocalDirectory.mockResolvedValue({ ok: true, cancelled: true });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
});

it("loads and saves data directory overrides", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  const codexInput = screen.getByLabelText("Codex 数据目录");
  const saveButton = screen.getByRole("button", { name: "保存" });
  expect(screen.getByText("数据目录")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "选择文件夹" })).toHaveLength(3);

  expect(saveButton).toBeDisabled();

  await act(async () => {
    await user.type(codexInput, "C:\\Users\\admin\\.codex");
  });
  expect(saveButton).toBeEnabled();

  await act(async () => {
    await user.click(saveButton);
  });

  await waitFor(() => {
    expect(setLocalSettings).toHaveBeenCalledWith({
      dataDirectories: {
        claude: claudeInput.value,
        codex: "C:\\Users\\admin\\.codex",
        hermes: "",
      },
    });
  });
  expect(await screen.findByText("已保存到本地。运行同步以应用更改。")).toBeInTheDocument();
});

it("shows a Chinese fallback when direct folder selection is unavailable", async () => {
  selectLocalDirectory.mockResolvedValueOnce({ ok: false, error: "unsupported" });
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const buttons = await screen.findAllByRole("button", { name: "选择文件夹" });
  await act(async () => {
    await user.click(buttons[0]);
  });

  expect(screen.getByText("当前环境不支持直接选择本机目录，请手动输入路径。")).toBeInTheDocument();
});

it("fills the selected local directory", async () => {
  selectLocalDirectory.mockResolvedValueOnce({ ok: true, path: "D:\\logs\\.codex" });
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const buttons = await screen.findAllByRole("button", { name: "选择文件夹" });
  await act(async () => {
    await user.click(buttons[1]);
  });

  expect(screen.getByLabelText("Codex 数据目录")).toHaveValue("D:\\logs\\.codex");
});

it("uses JSON string messages for the Windows WebView2 folder picker bridge", async () => {
  const listeners = new Map();
  const postMessage = vi.fn((message) => {
    expect(typeof message).toBe("string");
    const payload = JSON.parse(message);
    expect(payload.type).toBe("selectFolder");
    const handler = listeners.get("message");
    handler?.({
      data: {
        type: "folderSelected",
        requestId: payload.requestId,
        path: "C:\\Users\\admin\\.claude",
      },
    });
  });
  Object.defineProperty(window, "chrome", {
    configurable: true,
    value: {
      webview: {
        addEventListener: vi.fn((event, handler) => listeners.set(event, handler)),
        removeEventListener: vi.fn((event) => listeners.delete(event)),
        postMessage,
      },
    },
  });
  window.localStorage.setItem("tokentracker_native_app", "1");

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const buttons = await screen.findAllByRole("button", { name: "选择文件夹" });
  await act(async () => {
    await user.click(buttons[0]);
  });

  expect(selectLocalDirectory).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"type":"selectFolder"'));
  expect(screen.getByLabelText("Claude Code 数据目录")).toHaveValue("C:\\Users\\admin\\.claude");
});
