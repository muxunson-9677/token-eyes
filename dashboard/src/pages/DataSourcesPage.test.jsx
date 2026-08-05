import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { DataSourcesPage } from "./DataSourcesPage.jsx";
import { clearLocalData, getAllAgentEnvironments, getUsageSummary, triggerLocalSync } from "../lib/api";
import { setCopyLocale } from "../lib/copy";
import { safeWriteClipboard } from "../lib/safe-browser";

vi.mock("../lib/api", () => ({
  getAllAgentEnvironments: vi.fn(),
  getUsageSummary: vi.fn(),
  clearLocalData: vi.fn(),
  triggerLocalSync: vi.fn(),
}));
vi.mock("../lib/safe-browser", async (importOriginal) => ({
  ...await importOriginal(),
  safeWriteClipboard: vi.fn(),
}));
vi.mock("../components/settings/DataDirectoriesSection.jsx", () => ({
  DataDirectoriesSection: () => <section data-testid="manual-path-settings" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setCopyLocale("zh-CN");
  getAllAgentEnvironments.mockResolvedValue({
    ok: true,
    results: [
      { agent: "codex", agent_name: "Codex", status: "ready", trackingReady: true, evidenceCount: 4, latestActivityAt: "2026-08-01T01:00:00.000Z", configuredPath: "C:\\secret\\.codex" },
      { agent: "claude", agent_name: "Claude Code", status: "detected", trackingReady: false, evidenceCount: 0 },
      { agent: "cursor", agent_name: "Cursor", status: "not-detected", trackingReady: false, evidenceCount: 0 },
    ],
  });
  triggerLocalSync.mockResolvedValue({ ok: true });
  getUsageSummary.mockResolvedValue({
    totals: { total_tokens: 1000, unpriced_tokens: 120, unattributed_tokens: 80 },
    data_integrity: {
      raw_records: 20,
      visible_records: 16,
      duplicate_records: 3,
      malformed_records: 1,
      token_delta: 0,
      component_token_delta: 20155,
      component_mismatch_records: 2,
      updated_at: "2026-08-01T01:00:00.000Z",
    },
  });
  safeWriteClipboard.mockResolvedValue(true);
  clearLocalData.mockResolvedValue({ ok: true, removed: ["queue.jsonl", "cursors.json"] });
});

it("shows source health without treating installation as valid synchronized data", async () => {
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(await screen.findByTestId("data-source-codex")).toHaveAttribute("data-health", "ready");
  expect(screen.getByTestId("data-source-claude")).toHaveAttribute("data-health", "no-logs");
  expect(screen.getByTestId("data-source-cursor")).toHaveAttribute("data-health", "unavailable");
  expect(screen.getByTestId("data-source-codex")).toHaveTextContent("4");
  expect(screen.getByTestId("data-privacy-boundary")).toBeInTheDocument();
  expect(screen.getByTestId("data-storage-location")).toBeInTheDocument();
  expect(screen.getByTestId("data-ledger-diagnostics")).toHaveTextContent("20");
  expect(screen.getByTestId("data-ledger-diagnostics")).not.toHaveTextContent("20,155");
  expect(screen.getByTestId("data-ledger-diagnostics")).toHaveTextContent("12.0%");
  expect(screen.getByTestId("data-ledger-diagnostics")).toHaveTextContent("8.0%");
  expect(screen.queryByTestId("manual-path-settings")).not.toBeInTheDocument();
});

it("explains protected Trae and CodeBuddy stores without calling them empty logs", async () => {
  getAllAgentEnvironments.mockResolvedValue({
    ok: true,
    results: [
      { agent: "trae", agent_name: "TRAE", status: "detected", trackingReady: false, evidence: "encrypted_database", evidenceCount: 0, latestActivityAt: "2026-08-02T12:00:00.000Z", environment: "win" },
      { agent: "codebuddy", agent_name: "CodeBuddy", status: "detected", trackingReady: false, evidence: "session_database", evidenceCount: 0, latestActivityAt: "2026-08-02T11:00:00.000Z", environment: "win" },
    ],
  });

  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(await screen.findByTestId("data-source-trae")).toHaveTextContent("已安装 · 数据暂不可读取");
  expect(screen.getByTestId("data-source-trae")).toHaveTextContent("供应商加密存储，Token Eyes 暂无法读取精确 Token 字段");
  expect(screen.getByTestId("data-source-codebuddy")).toHaveTextContent("已安装 · 暂无精确 Token 日志");
  expect(screen.getByTestId("data-source-codebuddy")).toHaveTextContent("检测到应用数据，但当前版本未提供可读取的精确 Token 日志");
  expect(screen.getByTestId("data-source-trae")).not.toHaveTextContent("证据文件 0");
});

  it("shows the local Token Eyes ledger path from the reference UI", async () => {
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  const location = await screen.findByTestId("data-storage-location");
    expect(location).toHaveTextContent("%USERPROFILE%\\.tokentracker\\tracker");
});

it("restores the last source health immediately and refreshes it silently in the background", async () => {
  const first = render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  await screen.findByTestId("data-source-codex");
  await waitFor(() => expect(window.localStorage.length).toBeGreaterThan(0));
  first.unmount();

  getAllAgentEnvironments.mockReturnValue(new Promise(() => {}));
  getUsageSummary.mockReturnValue(new Promise(() => {}));

  const second = render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(screen.getByTestId("data-source-codex")).toHaveAttribute("data-health", "ready");
  expect(screen.queryByText("正在检查数据源健康状态…")).not.toBeInTheDocument();
  expect(getAllAgentEnvironments).toHaveBeenCalledTimes(2);
  expect(getUsageSummary).toHaveBeenCalledTimes(2);

  second.unmount();
});

it("uses the shared dimensional surfaces for sections and nested data cards", async () => {
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  expect(await screen.findByTestId("data-source-summary")).toHaveClass("tt-surface");
  expect(screen.getByTestId("data-ledger-diagnostics")).toHaveClass("tt-surface");
  expect(screen.getByTestId("data-privacy-boundary")).toHaveClass("tt-surface");
  expect(screen.getByTestId("data-source-codex")).toHaveClass("tt-surface-nested");
  expect(screen.getByTestId("data-ledger-metric-raw")).toHaveClass("tt-surface-nested");
});

it("exports redacted diagnostics and refreshes health after a manual sync", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  await screen.findByTestId("data-source-codex");

  await act(async () => user.click(screen.getByRole("button", { name: "复制脱敏诊断" })));
  const diagnosticPayload = String(safeWriteClipboard.mock.calls[0][0]);
  expect(diagnosticPayload).toContain('"agent": "codex"');
  expect(diagnosticPayload).not.toContain("C:\\secret");

  await act(async () => user.click(screen.getByRole("button", { name: "重新扫描所有来源" })));
  await waitFor(() => expect(triggerLocalSync).toHaveBeenCalledTimes(1));
  expect(getAllAgentEnvironments).toHaveBeenCalledTimes(2);
  expect(getUsageSummary).toHaveBeenCalledTimes(2);
});

it("clears only derived local data after explicit confirmation", async () => {
  const user = userEvent.setup();
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  await screen.findByTestId("data-source-codex");

  await act(async () => user.click(screen.getByRole("button", { name: "清除本地导入数据" })));

  expect(confirmSpy).toHaveBeenCalledTimes(1);
  expect(clearLocalData).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(getAllAgentEnvironments).toHaveBeenCalledTimes(2));
  confirmSpy.mockRestore();
});

it("hides missing ledger metrics instead of rendering placeholder cards or invented zeroes", async () => {
  getUsageSummary.mockResolvedValue({
    totals: { total_tokens: 1000, unpriced_tokens: 0, unattributed_tokens: null },
    data_integrity: {},
  });
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  const diagnostics = await screen.findByTestId("data-ledger-diagnostics");
  expect(diagnostics).toHaveTextContent("未计价 Token：0（0.0%）");
  expect(diagnostics).not.toHaveTextContent("未归因 Token");
  expect(diagnostics).not.toHaveTextContent("未提供字段");
  expect(diagnostics.querySelectorAll('[data-testid^="data-ledger-metric-"]')).toHaveLength(0);
});

it("turns a local service connection failure into a localized recovery path", async () => {
  getAllAgentEnvironments.mockRejectedValue(new Error(
    "Local CLI not reachable on :7680 — start it with: node bin/tracker.js serve --no-sync --no-open",
  ));
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("无法连接本地数据服务");
  expect(alert).toHaveTextContent("重新启动 Token Eyes");
  expect(alert).not.toHaveTextContent("Local CLI not reachable");
});
