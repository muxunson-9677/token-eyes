import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeWindowBar } from "../NativeWindowBar.jsx";

const {
  close,
  getCurrentWindow,
  minimize,
  toggleMaximize,
} = vi.hoisted(() => ({
  close: vi.fn(),
  getCurrentWindow: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow }));

vi.mock("../../../lib/copy", () => ({
  copy: (key, params) => params?.when ? `copy:${key}:${params.when}` : `copy:${key}`,
}));

describe("NativeWindowBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentWindow.mockReturnValue({ close, minimize, toggleMaximize });
  });

  it("renders only the desktop identity and window controls", () => {
    render(<NativeWindowBar />);

    expect(screen.getByRole("img", { name: "copy:shared.app_name" }))
      .toHaveAttribute("src", "/app-icon.png");
    expect(screen.getByText("copy:shared.app_name")).toBeInTheDocument();
    expect(screen.queryByText("copy:native.window.status.label")).not.toBeInTheDocument();
    expect(screen.queryByText("copy:native.window.status.connected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "copy:native.window.refresh_local_data" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("copy:native.window.sync.recent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("copy:native.window.notifications")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("copy:settings.appearance.theme.label")).not.toBeInTheDocument();
  });

  it("uses the Tauri window actions", async () => {
    const user = userEvent.setup();
    render(<NativeWindowBar />);

    await user.click(screen.getByRole("button", { name: "copy:native.window.minimize" }));
    await user.click(screen.getByRole("button", { name: "copy:native.window.maximize" }));
    await user.click(screen.getByRole("button", { name: "copy:native.window.close" }));

    expect(minimize).toHaveBeenCalledTimes(1);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
