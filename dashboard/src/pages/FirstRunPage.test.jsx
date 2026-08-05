import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { FirstRunPage } from "./FirstRunPage.jsx";
import {
  detectLocalDataDirectories,
  getLocalSettings,
  setLocalSettings,
  triggerLocalSync,
} from "../lib/api";

vi.mock("../lib/api", () => ({
  detectLocalDataDirectories: vi.fn(),
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
  triggerLocalSync: vi.fn(),
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/first-run"]}>
      <FirstRunPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getLocalSettings.mockResolvedValue({ dataDirectories: {} });
  setLocalSettings.mockImplementation(async (payload) => payload);
  triggerLocalSync.mockResolvedValue({ ok: true });
});

it("automatically detects sources, explains privacy, syncs, and leads to real usage", async () => {
  let finishDetection;
  detectLocalDataDirectories.mockImplementation(() => new Promise((resolve) => {
    finishDetection = resolve;
  }));
  const user = userEvent.setup();
  renderPage();

  expect(screen.getByTestId("first-run-phase")).toHaveAttribute("data-phase", "detecting");
  expect(screen.getByTestId("first-run-privacy")).toBeInTheDocument();

  await act(async () => {
    finishDetection({
      dataDirectories: { codex: "C:\\Users\\dev\\.codex", cursor: "C:\\Users\\dev\\.cursor" },
      detected: {
        codex: { status: "ready", trackingReady: true, environment: "win" },
        claude: { status: "not-detected", trackingReady: false, environment: "not-detected" },
        cursor: { status: "detected", trackingReady: false, environment: "win" },
      },
    });
  });

  await waitFor(() => expect(triggerLocalSync).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("first-run-source-codex")).toHaveAttribute("data-source-state", "ready");
  expect(screen.getByTestId("first-run-source-claude")).toHaveAttribute("data-source-state", "not-detected");
  expect(screen.getByTestId("first-run-source-cursor")).toHaveAttribute("data-source-state", "no-logs");
  expect(screen.queryByTestId("first-run-fix-codex")).not.toBeInTheDocument();
  expect(screen.getByTestId("first-run-fix-claude")).toHaveAttribute(
    "href",
    "/settings/basic#data-directories",
  );
  expect(screen.getByRole("link", { name: "查看存储与删除方式" })).toHaveAttribute(
    "href",
    "/settings/data#privacy-data",
  );

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "查看我的用量" }));
  });
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/dashboard"));
  expect(window.localStorage.getItem("tokentracker.firstRun.completed.v1")).toBe("1");
});

it("shows a bounded failure state with retry and manual recovery", async () => {
  detectLocalDataDirectories.mockRejectedValue(new Error("scanner offline"));
  renderPage();

  await waitFor(() => expect(screen.getByTestId("first-run-phase")).toHaveAttribute("data-phase", "error"));
  expect(screen.getByText("scanner offline")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新检测" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "手动配置数据源" })).toHaveAttribute(
    "href",
    "/settings/basic#data-directories",
  );
});
