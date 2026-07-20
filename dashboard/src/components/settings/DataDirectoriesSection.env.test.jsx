import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
import {
  getAgentEnvironment,
  getLocalSettings,
  selectLocalDirectory,
  setLocalSettings,
} from "../../lib/api";

vi.mock("../../lib/api", () => ({
  detectLocalDataDirectories: vi.fn(),
  getLocalSettings: vi.fn(),
  selectLocalDirectory: vi.fn(),
  setLocalSettings: vi.fn(),
  getAgentEnvironment: vi.fn(),
  getAllAgentEnvironments: vi.fn(),
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
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
  getAgentEnvironment.mockResolvedValue({
    ok: true,
    result: {
      agent: "claude",
      agent_name: "Claude Code",
      environment: "wsl-ubuntu",
      status: "ready",
      currentVersion: "0.900.0",
      executablePath: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
    },
  });
});

function getDetectButtons() {
  return screen.getAllByRole("button", { name: /检测.*运行环境/ });
}

it("renders detect environment buttons for each agent", async () => {
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  expect(detectButtons).toHaveLength(10);
});

it("shows ready status when environment detection succeeds", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  await act(async () => {
    await user.click(detectButtons[0]);
  });

  await waitFor(() => {
    expect(getAgentEnvironment).toHaveBeenCalledWith("claude", "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  });

  expect(screen.getAllByText("已就绪").length).toBeGreaterThan(0);
  expect(screen.getByText(/WSL Ubuntu/)).toBeInTheDocument();
});

it("shows not-detected status when environment not found", async () => {
  getAgentEnvironment.mockResolvedValueOnce({
    ok: true,
    result: {
      agent: "codex",
      agent_name: "Codex",
      environment: "not-detected",
      status: "not-detected",
    },
  });

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  await act(async () => {
    await user.click(detectButtons[1]);
  });

  await waitFor(() => {
    expect(getAgentEnvironment).toHaveBeenCalledWith("codex", "");
  });

  expect(screen.getAllByText("未检测到").length).toBeGreaterThan(0);
  expect(screen.getByText(/路径不存在或未配置/)).toBeInTheDocument();
});

it("shows loading state while detecting environment", async () => {
  let resolveDetect;
  getAgentEnvironment.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDetect = resolve;
      }),
  );

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  await act(async () => {
    await user.click(detectButtons[0]);
  });

  expect(screen.getAllByText("检测中").length).toBeGreaterThan(0);

  await act(async () => {
    resolveDetect({
      ok: true,
      result: {
        agent: "claude",
        environment: "win",
        status: "ready",
      },
    });
  });

  await waitFor(() => {
    expect(screen.getAllByText("已就绪").length).toBeGreaterThan(0);
  });
});

it("shows current version when available", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  await act(async () => {
    await user.click(detectButtons[0]);
  });

  await waitFor(() => {
    expect(getAgentEnvironment).toHaveBeenCalledWith("claude", "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  });

  expect(screen.getByText(/当前版本：0.900.0/)).toBeInTheDocument();
});

it("handles environment detection error gracefully", async () => {
  getAgentEnvironment.mockRejectedValueOnce(new Error("Network error"));

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const detectButtons = getDetectButtons();
  await act(async () => {
    await user.click(detectButtons[0]);
  });

  await waitFor(() => {
    expect(getAgentEnvironment).toHaveBeenCalledWith("claude", "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  });

  expect(screen.getAllByText("未检测到").length).toBeGreaterThan(0);
});
