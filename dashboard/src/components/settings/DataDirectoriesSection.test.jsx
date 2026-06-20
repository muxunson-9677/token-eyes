import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { DataDirectoriesSection } from "./DataDirectoriesSection.jsx";
import { getLocalSettings, setLocalSettings, selectLocalDirectory } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
  selectLocalDirectory: vi.fn(),
}));

vi.mock("../../lib/native-bridge.js", () => ({
  isNativeWindowsApp: vi.fn(() => false),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // Reset to non-WebView2 by default
  const { isNativeWindowsApp } = await import("../../lib/native-bridge.js");
  isNativeWindowsApp.mockReturnValue(false);

  getLocalSettings.mockResolvedValue({
    dataDirectories: {
      claude: "\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude",
      codex: "",
      hermes: "",
    },
  });
  setLocalSettings.mockImplementation(async ({ dataDirectories }) => ({ ok: true, dataDirectories }));
  selectLocalDirectory.mockResolvedValue({ ok: true, path: "C:\\Users\\admin\\.codex", cancelled: false });
});

it("loads and saves data directory overrides", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);

  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");
  const codexInput = screen.getByLabelText(/Codex data directory/i);
  const saveButton = screen.getByRole("button", { name: /Save/i });

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
  expect(await screen.findByText(/Saved locally/i)).toBeInTheDocument();
});

it("shows browse buttons for each directory input", async () => {
  render(<DataDirectoriesSection />);
  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const browseButtons = screen.getAllByRole("button", { name: "选择文件夹" });
  expect(browseButtons).toHaveLength(3);
});

it("fills path via browser fallback when browse button is clicked", async () => {
  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const browseButtons = screen.getAllByRole("button", { name: "选择文件夹" });

  await act(async () => {
    await user.click(browseButtons[1]); // Codex row
  });

  expect(selectLocalDirectory).toHaveBeenCalled();

  await waitFor(() => {
    const codexInput = screen.getByLabelText(/Codex data directory/i);
    expect(codexInput.value).toBe("C:\\Users\\admin\\.codex");
  });
});

it("shows unsupported hint when platform does not support folder picker", async () => {
  selectLocalDirectory.mockResolvedValue({
    ok: false,
    unsupported: true,
    message: "当前环境不支持直接选择本机目录，请手动输入路径。",
  });

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const browseButtons = screen.getAllByRole("button", { name: "选择文件夹" });

  await act(async () => {
    await user.click(browseButtons[0]); // Claude row
  });

  expect(await screen.findByText(/当前环境不支持/)).toBeInTheDocument();
});

it("preserves existing values when folder picker is cancelled", async () => {
  selectLocalDirectory.mockResolvedValue({ ok: true, path: null, cancelled: true });

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  const claudeInput = await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const originalValue = claudeInput.value;
  const browseButtons = screen.getAllByRole("button", { name: "选择文件夹" });

  await act(async () => {
    await user.click(browseButtons[0]); // Claude row — will cancel
  });

  await waitFor(() => {
    expect(selectLocalDirectory).toHaveBeenCalled();
  });

  // Value should remain unchanged
  expect(claudeInput.value).toBe(originalValue);
});

it("uses WebView2 bridge when running in native Windows app", async () => {
  const { isNativeWindowsApp } = await import("../../lib/native-bridge.js");
  isNativeWindowsApp.mockReturnValue(true);

  const postMessage = vi.fn();
  Object.defineProperty(window, "chrome", {
    value: { webview: { postMessage, addEventListener: vi.fn(), removeEventListener: vi.fn() } },
    writable: true,
    configurable: true,
  });

  const user = userEvent.setup();
  render(<DataDirectoriesSection />);
  await screen.findByDisplayValue("\\\\wsl.localhost\\Ubuntu\\home\\agent\\.claude");

  const browseButtons = screen.getAllByRole("button", { name: "选择文件夹" });

  await act(async () => {
    await user.click(browseButtons[0]);
  });

  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "selectFolder", requestId: expect.any(String) }),
  );
  // Should NOT call the HTTP fallback
  expect(selectLocalDirectory).not.toHaveBeenCalled();

  // Cleanup
  delete window.chrome;
});
