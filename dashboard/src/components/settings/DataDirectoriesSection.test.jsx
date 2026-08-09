import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
      opencode: "",
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
      opencode: "C:\\Users\\admin\\.local\\share\\opencode",
      openclaw: "",
    },
    detected: {
      claude: { agent: "claude", environment: "win", status: "ready", trackingReady: true },
      codex: { agent: "codex", environment: "win", status: "ready", trackingReady: true },
      cursor: { agent: "cursor", environment: "win", status: "ready", trackingReady: true },
      opencode: { agent: "opencode", environment: "win", status: "ready", trackingReady: true },
    },
  });
  getAgentEnvironment.mockResolvedValue({
    ok: true,
    result: { agent: "codex", environment: "win", status: "not-detected", trackingReady: false },
  });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
  triggerLocalSync.mockResolvedValue({ ok: true });
});

it("keeps the data-directory summary permanently visible without a disclosure control", async () => {
  const { container } = render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  expect(container.querySelector("[aria-expanded]")).not.toBeInTheDocument();
  expect(container.querySelector(".tt-data-directory-compact output")).toBeVisible();
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

it("keeps a manually selected Trae install path and shows the resolved user-data path", async () => {
  getAgentEnvironment.mockResolvedValueOnce({
    ok: true,
    result: {
      agent: "trae",
      environment: "win",
      status: "detected",
      trackingReady: false,
      configuredPath: "E:\\Users\\admin\\AppData\\Local\\Programs\\Trae CN",
      dataPath: "C:\\Users\\admin\\AppData\\Roaming\\Trae CN",
    },
  });
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  await screen.findAllByTestId("data-directory-row");
  const row = document.querySelector('[data-directory-key="trae"]');
  const input = row.querySelector("input");
  await user.type(input, "E:\\Users\\admin\\AppData\\Local\\Programs\\Trae CN");
  const detectButton = within(row).getAllByRole("button").find((button) => (
    button.getAttribute("aria-label")?.includes("Trae") && button.getAttribute("aria-label")?.includes("环境")
  ));
  await user.click(detectButton);

  expect(input).toHaveValue("E:\\Users\\admin\\AppData\\Local\\Programs\\Trae CN");
  expect(within(row).getByText((_, element) => (
    element?.tagName === "SPAN"
      && element.textContent?.includes("C:\\Users\\admin\\AppData\\Roaming\\Trae CN")
  ))).toBeInTheDocument();
});

it("auto-detects evidence-backed paths and persists the merged directory settings", async () => {
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
  expect(screen.getByLabelText("OpenCode 数据目录")).toHaveValue("C:\\Users\\admin\\.local\\share\\opencode");
  expect(screen.getByLabelText("OpenClaw 数据目录")).toHaveValue("");
  expect(screen.getByText("已识别 4 个可采集 Agent 路径，请确认后保存。")).toBeInTheDocument();
  await waitFor(() => expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({
    dataDirectories: expect.objectContaining({
      claude: "C:\\Users\\admin\\.claude",
      codex: "C:\\Users\\admin\\.codex",
    }),
  })));
});

it("auto-detects and persists missing Trae and CodeBuddy paths on desktop load", async () => {
  window.localStorage.setItem("tokentracker_native_app", "1");
  getLocalSettings.mockResolvedValueOnce({
    dataDirectories: { trae: "", codebuddy: "" },
  });
  detectLocalDataDirectories.mockResolvedValueOnce({
    ok: true,
    dataDirectories: {
      trae: "C:\\Users\\admin\\AppData\\Roaming\\Trae CN",
      codebuddy: "C:\\Users\\admin\\AppData\\Roaming\\CodeBuddy CN",
    },
    detected: {
      trae: { agent: "trae", environment: "win", status: "detected", trackingReady: false },
      codebuddy: { agent: "codebuddy", environment: "win", status: "detected", trackingReady: false },
    },
  });

  render(<DataDirectoriesSection />);

  const traeRow = await waitFor(() => document.querySelector('[data-directory-key="trae"]'));
  const codeBuddyRow = document.querySelector('[data-directory-key="codebuddy"]');
  expect(traeRow.querySelector("input")).toHaveValue(
    "C:\\Users\\admin\\AppData\\Roaming\\Trae CN",
  );
  expect(codeBuddyRow.querySelector("input")).toHaveValue(
    "C:\\Users\\admin\\AppData\\Roaming\\CodeBuddy CN",
  );
  await waitFor(() => expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({
    dataDirectories: expect.objectContaining({
      trae: "C:\\Users\\admin\\AppData\\Roaming\\Trae CN",
      codebuddy: "C:\\Users\\admin\\AppData\\Roaming\\CodeBuddy CN",
    }),
  })));
});

it("loads and saves data directory overrides", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  const codexInput = screen.getByLabelText("Codex 数据目录");
  const saveButton = screen.getByRole("button", { name: "保存" });
  expect(screen.getByText("数据目录")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "选择文件夹" })).toHaveLength(10);

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
        cursor: "",
        trae: "",
        codebuddy: "",
        gemini: "",
        hermes: "",
        openclaw: "",
        opencode: "",
        antigravity: "",
      },
      dataDirectoryOrder: [
        "claude", "codex", "cursor", "trae", "codebuddy",
        "gemini", "hermes", "openclaw", "opencode", "antigravity",
      ],
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

  const hermesInput = await screen.findByLabelText("Hermes Agent 数据目录");
  const hermesRow = hermesInput.closest(".block.py-3");
  const selectButton = within(hermesRow).getByRole("button", { name: "选择文件夹" });
  await act(async () => {
    await user.click(selectButton);
  });

  expect(selectLocalDirectory).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"type":"selectFolder"'));
  expect(hermesInput).toHaveValue("D:\\data\\.hermes");
});
