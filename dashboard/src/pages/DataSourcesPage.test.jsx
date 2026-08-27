import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { DataSourcesPage } from "./DataSourcesPage.jsx";
import { clearLocalData, getAllAgentEnvironments, getTokenEyesBuildInfo, getUsageSummary, triggerLocalSync } from "../lib/api";
import { setCopyLocale } from "../lib/copy";
import { safeWriteClipboard } from "../lib/safe-browser";
import { LIMIT_PROVIDER_IDS } from "../lib/limits-providers.js";
import { LIMITS_DISPLAY_CHANGE_EVENT } from "../hooks/use-limits-display-prefs.js";
import fs from "node:fs";
import path from "node:path";

const dataSourcesCss = fs.readFileSync(path.resolve(process.cwd(), "src/ui/foundation/apple-glass.css"), "utf8");

function setVisibleAgents(agentIds) {
  const visible = new Set(agentIds);
  window.localStorage.setItem(
    "tt.limits.providerOrder",
    JSON.stringify(LIMIT_PROVIDER_IDS),
  );
  window.localStorage.setItem(
    "tt.limits.providerVisibility",
    JSON.stringify(Object.fromEntries(
      LIMIT_PROVIDER_IDS.map((id) => [id, visible.has(id)]),
    )),
  );
}

vi.mock("../lib/api", () => ({
  getAllAgentEnvironments: vi.fn(),
  getTokenEyesBuildInfo: vi.fn(),
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
      { agent: "codex", agent_name: "Codex", status: "ready", trackingReady: true, evidenceCount: 4, latestActivityAt: "2026-08-01T01:00:00.000Z", environment: "win", configuredPath: "C:\\secret\\.codex" },
      { agent: "claude", agent_name: "Claude Code", status: "detected", trackingReady: false, evidenceCount: 0, environment: "wsl" },
      { agent: "cursor", agent_name: "Cursor", status: "not-detected", trackingReady: false, evidenceCount: 0, environment: "win" },
    ],
  });
  getTokenEyesBuildInfo.mockResolvedValue({
    app_version: "0.54.44",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    built_at_utc: "2026-08-21T01:02:03.000Z",
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

it("filters cached Agent sources and summary counts by limits visibility before page filters", async () => {
  const cachedSources = [
    { agent: " CODEX ", agent_name: "Cached Codex", status: "ready", trackingReady: true, evidenceCount: 4, environment: "win" },
    { agent: "claude", agent_name: "Hidden Claude", status: "detected", trackingReady: false, evidenceCount: 0, environment: "wsl" },
    { agent: "cursor", agent_name: "Hidden Cursor", status: "not-detected", trackingReady: false, evidenceCount: 0, environment: "win" },
    { agent: "unknown-cache", agent_name: "Unknown Cache", status: "ready", trackingReady: true, evidenceCount: 1, environment: "win" },
  ];
  setVisibleAgents(["codex"]);
  window.localStorage.setItem("token-eyes:data-source-health:v1", JSON.stringify({
    sources: cachedSources,
    ledgerSummary: null,
    updatedAt: "2026-08-27T01:00:00.000Z",
  }));
  getAllAgentEnvironments.mockImplementation(() => new Promise(() => {}));
  getUsageSummary.mockImplementation(() => new Promise(() => {}));

  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(screen.getByText("Cached Codex")).toBeInTheDocument();
  expect(screen.queryByText("Hidden Claude")).not.toBeInTheDocument();
  expect(screen.queryByText("Hidden Cursor")).not.toBeInTheDocument();
  expect(screen.queryByText("Unknown Cache")).not.toBeInTheDocument();
  expect(screen.getByTestId("data-health-summary-ready")).toHaveTextContent("1");
  expect(screen.getByTestId("data-health-summary-ready")).toHaveTextContent("100%");
  expect(screen.getByTestId("data-health-summary-no-logs")).toHaveTextContent("0");
  expect(screen.getByTestId("data-health-summary-unavailable")).toHaveTextContent("0");
  await screen.findByTestId("token-eyes-build-info");

  act(() => {
    setVisibleAgents(["claude"]);
    window.dispatchEvent(new CustomEvent(LIMITS_DISPLAY_CHANGE_EVENT));
  });

  expect(screen.queryByText("Cached Codex")).not.toBeInTheDocument();
  expect(screen.getByText("Hidden Claude")).toBeInTheDocument();
  expect(screen.getByTestId("data-health-summary-ready")).toHaveTextContent("0");
  expect(screen.getByTestId("data-health-summary-no-logs")).toHaveTextContent("1");

  act(() => {
    setVisibleAgents([]);
    window.dispatchEvent(new CustomEvent(LIMITS_DISPLAY_CHANGE_EVENT));
  });

  expect(screen.getByTestId("data-health-grid").querySelectorAll("article")).toHaveLength(0);
  expect(screen.getByTestId("data-health-summary-no-logs")).toHaveTextContent("0");
});

it("resets a hidden environment filter when limits visibility changes", async () => {
  const user = userEvent.setup();
  setVisibleAgents(["codex", "claude"]);
  window.localStorage.setItem("token-eyes:data-source-health:v1", JSON.stringify({
    sources: [
      { agent: "codex", agent_name: "Cached Codex", status: "ready", trackingReady: true, evidenceCount: 4, environment: "win" },
      { agent: "claude", agent_name: "Cached Claude", status: "detected", trackingReady: false, evidenceCount: 0, environment: "wsl" },
    ],
    ledgerSummary: null,
    updatedAt: "2026-08-27T01:00:00.000Z",
  }));
  getAllAgentEnvironments.mockImplementation(() => new Promise(() => {}));
  getUsageSummary.mockImplementation(() => new Promise(() => {}));

  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(screen.getByText("Cached Codex")).toBeInTheDocument();
  expect(screen.getByText("Cached Claude")).toBeInTheDocument();
  await screen.findByTestId("token-eyes-build-info");

  const environmentSelect = screen.getByTestId("data-health-environment");
  await act(async () => user.selectOptions(environmentSelect, "wsl"));
  expect(environmentSelect).toHaveValue("wsl");
  expect(screen.queryByText("Cached Codex")).not.toBeInTheDocument();
  expect(screen.getByText("Cached Claude")).toBeInTheDocument();

  act(() => {
    setVisibleAgents(["codex"]);
    window.dispatchEvent(new CustomEvent(LIMITS_DISPLAY_CHANGE_EVENT));
  });

  await waitFor(() => {
    expect(environmentSelect).toHaveValue("all");
    expect(screen.getByText("Cached Codex")).toBeInTheDocument();
    expect(screen.queryByText("Cached Claude")).not.toBeInTheDocument();
  });
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

it("shows a health summary and a compact source workspace", async () => {
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(await screen.findByTestId("data-health-summary")).toBeInTheDocument();
  expect(screen.getByTestId("data-health-summary")).toHaveClass("col-span-full");
  expect(screen.getByTestId("data-health-summary-ready")).toHaveTextContent("1");
  expect(screen.getByTestId("data-health-summary-ready")).toHaveTextContent("33%");
  expect(screen.getByTestId("data-health-summary-no-logs")).toHaveTextContent("1");
  expect(screen.getByTestId("data-health-summary-unavailable")).toHaveTextContent("1");
  expect(screen.getByTestId("data-health-grid")).toHaveAttribute("data-layout", "grid");
  expect(screen.getByTestId("data-health-toolbar")).toBeInTheDocument();
  expect(screen.getByTestId("data-source-summary").parentElement).toHaveClass("max-w-[1600px]");
  expect(screen.getByTestId("data-source-codex")).toHaveClass("min-h-[88px]", "border");
  expect(screen.getByTestId("data-source-summary")).toHaveClass("tt-pressable-group");
  expect(screen.getByTestId("data-ledger-diagnostics")).toHaveClass("tt-pressable-group");
  expect(screen.getByTestId("data-privacy-boundary")).toHaveClass("tt-pressable-group");
  expect(screen.getByTestId("data-source-codex").querySelector("dl")).toHaveClass("grid-cols-1");
  for (const detail of screen.getByTestId("data-source-codex").querySelectorAll("dd")) {
    expect(detail).not.toHaveClass("truncate");
  }
  expect(screen.getByTestId("data-source-codex").querySelectorAll("dd")[1]).toHaveClass("break-words");
  expect(screen.getByTestId("data-source-cursor")).toHaveTextContent("未检测到");
  expect(screen.getByTestId("data-source-codex").querySelector("h3")).toHaveClass("flex", "leading-5");
  expect(screen.getByTestId("data-ledger-diagnostics").parentElement).toHaveClass("col-span-full", "items-stretch", "lg:grid-cols-[430px_minmax(0,1fr)]", "xl:grid-cols-[500px_minmax(0,1fr)]");
  expect(screen.getByTestId("data-privacy-boundary").querySelector("p")).toHaveClass("leading-5");
  expect(screen.queryByTestId("data-danger-zone")).not.toBeInTheDocument();
  expect(screen.getByTestId("data-privacy-boundary")).toContainElement(
    screen.getByRole("button", { name: "清除本地导入数据" }),
  );
  expect(screen.getByTestId("data-privacy-principles")).toHaveClass("ml-auto", "max-w-[25rem]");

  const nativeSelectorMatches = [...document.querySelectorAll('[data-testid^="data-source-"]')];
  expect(nativeSelectorMatches.every((element) => (
    element.dataset.testid === "data-source-summary" || element.tagName === "ARTICLE"
  ))).toBe(true);
});

it("lets dense source and ledger content expand without fixed-height overlap", async () => {
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  await screen.findByTestId("data-source-summary");

  expect(dataSourcesCss).toMatch(/\[data-testid="data-source-summary"\]\s*\{[^}]*height:\s*auto;/s);
  expect(dataSourcesCss).toMatch(/\[data-testid="data-ledger-diagnostics"\],[\s\S]*?\[data-testid="data-privacy-boundary"\]\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*288px;/s);
  expect(dataSourcesCss).toMatch(/\.tt-data-ledger-overflow-copy\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  expect(dataSourcesCss).toMatch(/\[data-testid\^="data-source-"\]:not\(\[data-testid="data-source-summary"\]\)\s*\{[^}]*min-height:\s*104px;[^}]*padding:\s*10px 12px;/s);
  expect(dataSourcesCss).toMatch(/\[data-testid\^="data-source-"\] dl\s*\{[^}]*margin-top:\s*4px;[^}]*margin-left:\s*0;/s);
});

it("filters, searches, sorts, and switches the source workspace view", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);
  await screen.findByTestId("data-health-grid");

  await act(async () => user.click(screen.getByTestId("data-health-filter-no-logs")));
  expect(screen.getByTestId("data-source-claude")).toBeInTheDocument();
  expect(screen.queryByTestId("data-source-codex")).not.toBeInTheDocument();

  await act(async () => user.click(screen.getByTestId("data-health-filter-all")));
  await act(async () => user.type(screen.getByTestId("data-health-search"), "codex"));
  expect(screen.getByTestId("data-source-codex")).toBeInTheDocument();
  expect(screen.queryByTestId("data-source-claude")).not.toBeInTheDocument();

  await act(async () => user.clear(screen.getByTestId("data-health-search")));
  await act(async () => user.selectOptions(screen.getByTestId("data-health-environment"), "wsl"));
  expect(screen.getByTestId("data-source-claude")).toBeInTheDocument();
  expect(screen.queryByTestId("data-source-codex")).not.toBeInTheDocument();

  await act(async () => user.selectOptions(screen.getByTestId("data-health-environment"), "all"));
  await act(async () => user.selectOptions(screen.getByTestId("data-health-sort"), "name"));
  expect([...screen.getByTestId("data-health-grid").querySelectorAll("article")].map((article) => article.dataset.testid)).toEqual([
    "data-source-claude",
    "data-source-codex",
    "data-source-cursor",
  ]);

  await act(async () => user.click(screen.getByTestId("data-health-view-list")));
  expect(screen.getByTestId("data-health-grid")).toHaveAttribute("data-layout", "list");
  expect(screen.getByTestId("data-health-grid")).toHaveStyle({ gridTemplateColumns: "minmax(0, 1fr)" });
  expect(screen.getByTestId("data-source-summary")).toHaveStyle({ height: "auto" });
  expect(screen.getByTestId("data-source-codex")).toHaveStyle({ height: "auto", padding: "8px 12px" });
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
  expect(screen.getByTestId("data-source-trae")).toHaveAttribute("data-health", "no-logs");
  expect(screen.getByText("已安装 · 数据暂不可读取")).toHaveAttribute("title", "供应商加密存储，Token Eyes 暂无法读取精确 Token 字段");
  expect(screen.getByText("已安装 · 数据暂不可读取")).toHaveAttribute("tabindex", "0");
  expect(screen.getByText("已安装 · 数据暂不可读取")).toHaveAccessibleDescription("供应商加密存储，Token Eyes 暂无法读取精确 Token 字段");
  expect(screen.getByTestId("data-source-codebuddy")).toHaveTextContent("已安装 · 暂无精确 Token 日志");
  expect(screen.getByText("已安装 · 暂无精确 Token 日志")).toHaveAttribute("title", "检测到应用数据，但当前版本未提供可读取的精确 Token 日志");
  expect(screen.getByText("已安装 · 暂无精确 Token 日志")).toHaveAccessibleDescription("检测到应用数据，但当前版本未提供可读取的精确 Token 日志");
  expect(screen.getByTestId("data-source-trae")).toHaveTextContent("证据文件0");
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

it("shows and exports the full native build identity without a Vite fallback", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  const buildIdentity = await screen.findByTestId("token-eyes-build-info");
  expect(buildIdentity).toHaveTextContent("0.54.44");
  expect(buildIdentity).toHaveTextContent("0123456789abcdef0123456789abcdef01234567");
  expect(getTokenEyesBuildInfo).toHaveBeenCalledTimes(1);

  await act(async () => user.click(screen.getByRole("button", { name: "复制脱敏诊断" })));
  const diagnostic = JSON.parse(String(safeWriteClipboard.mock.calls.at(-1)[0]));
  expect(diagnostic.build_info).toEqual({
    app_version: "0.54.44",
    head_sha: "0123456789abcdef0123456789abcdef01234567",
    built_at_utc: "2026-08-21T01:02:03.000Z",
  });
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
  expect(screen.queryByTestId("data-ledger-integrity-rate")).not.toBeInTheDocument();
});

it("does not show an integrity result when ledger diagnostics fail", async () => {
  getUsageSummary.mockRejectedValue(new Error("ledger unavailable"));
  render(<MemoryRouter><DataSourcesPage /></MemoryRouter>);

  expect(await screen.findByText("ledger unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("data-ledger-integrity-rate")).not.toBeInTheDocument();
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
