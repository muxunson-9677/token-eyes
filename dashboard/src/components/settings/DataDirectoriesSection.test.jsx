import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
import {
  detectLocalDataDirectories,
  getAgentEnvironment,
  getLocalSettings,
  selectLocalDirectory,
  setLocalSettings,
  triggerLocalSync,
} from "../../lib/api";

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
  window.localStorage.removeItem("tokentracker_native_app");
  delete window.chrome;
  getLocalSettings.mockResolvedValue({
    dataDirectories: {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "",
      hermes: "",
      cursor: "",
      openclaw: "",
    },
  });
  selectLocalDirectory.mockResolvedValue({ ok: true, cancelled: true });
  detectLocalDataDirectories.mockResolvedValue({
    ok: true,
    dataDirectories: {
      claude: "C:\\Users\\admin\\.claude",
      codex: "C:\\Users\\admin\\.codex",
      hermes: "",
      cursor: "C:\\Users\\admin\\.cursor",
      openclaw: "",
    },
    detected: {
      claude: { agent: "claude", environment: "win", status: "ready", trackingReady: true },
      codex: { agent: "codex", environment: "win", status: "ready", trackingReady: true },
      cursor: { agent: "cursor", environment: "win", status: "ready", trackingReady: true },
    },
  });
  getAgentEnvironment.mockResolvedValue({
    ok: true,
    result: { agent: "codex", environment: "win", status: "not-detected", trackingReady: false },
  });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
  triggerLocalSync.mockResolvedValue({ ok: true });
});

it("re-detects the current unsaved path and clears the stale result after editing", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const codexInput = screen.getByLabelText("Codex 数据目录");
  const detectButton = screen.getByRole("button", { name: "检测 Codex 数据目录 运行环境" });
  await act(async () => user.click(detectButton));
  expect(getAgentEnvironment).toHaveBeenLastCalledWith("codex", "");

  await act(async () => user.type(codexInput, "E:\\AgentData\\Codex"));
  getAgentEnvironment.mockResolvedValueOnce({
    ok: true,
    result: { agent: "codex", environment: "win", status: "ready", trackingReady: true },
  });
  await act(async () => user.click(detectButton));

  expect(getAgentEnvironment).toHaveBeenLastCalledWith("codex", "E:\\AgentData\\Codex");
  expect(screen.getAllByText("已就绪").length).toBeGreaterThan(0);
});

it("auto-detects evidence-backed data directories and clears missing agents", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "自动检测路径" }));
  });

  await waitFor(() => expect(detectLocalDataDirectories).toHaveBeenCalledTimes(1));
  expect(claudeInput).toHaveValue("C:\\Users\\admin\\.claude");
  expect(screen.getByLabelText("Codex 数据目录")).toHaveValue("C:\\Users\\admin\\.codex");
  expect(screen.getByLabelText("Cursor 数据目录")).toHaveValue("C:\\Users\\admin\\.cursor");
  expect(screen.getByLabelText("OpenClaw 数据目录")).toHaveValue("");
  expect(screen.getByText("已识别 3 个可采集 Agent 路径，请确认后保存。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
});

it("loads and saves data directory overrides", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  const codexInput = screen.getByLabelText("Codex 数据目录");
  const saveButton = screen.getByRole("button", { name: "保存" });
  expect(screen.getByText("数据目录")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "选择文件夹" })).toHaveLength(5);

  expect(saveButton).toBeEnabled();

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
        cursor: "",
        openclaw: "",
      },
    });
  });
  await waitFor(() => expect(triggerLocalSync).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("button", { name: "已保存" })).toBeEnabled();
  expect(await screen.findByText("路径已保存，并已启动 Token 数据同步。")).toBeInTheDocument();
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

it("handles C# PostWebMessageAsJson response as JSON string (real WebView2 behavior)", async () => {
  const listeners = new Map();
  const postMessage = vi.fn((message) => {
    expect(typeof message).toBe("string");
    const payload = JSON.parse(message);
    expect(payload.type).toBe("selectFolder");
    const handler = listeners.get("message");
    handler?.({
      data: JSON.stringify({
        type: "folderSelected",
        requestId: payload.requestId,
        path: "D:\\data\\.hermes",
      }),
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
    await user.click(buttons[2]);
  });

  expect(selectLocalDirectory).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"type":"selectFolder"'));
  expect(screen.getByLabelText("Hermes Agent 数据目录")).toHaveValue("D:\\data\\.hermes");
});
