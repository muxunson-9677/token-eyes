import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { RequestUsageLog } from "../RequestUsageLog.jsx";

// Mock the Hook instead of the API so tests stay focused on component rendering /
// interaction. Each test configures the Hook's return value via mockReturnValue.
vi.mock("../../../../hooks/use-request-usage-records", () => ({
  useRequestUsageRecords: vi.fn(),
}));

vi.mock("../../../../hooks/useCurrency", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../../../../lib/copy", () => ({
  copy: (key, vars = {}) => {
    const map = {
      "ticket04.request.title": "Request Token Detail",
      "ticket04.request.subtitle": "Request-level token usage",
      "ticket04.request.loading": "Loading request records",
      "ticket04.request.empty": "No request records",
      "ticket04.request.error": "Failed to load",
      "ticket04.request.retry": "Retry",
      "ticket04.request.latency_none": "-",
      "ticket04.request.cache_read_prefix": "R",
      "ticket04.request.all_sources": "All",
      "ticket04.request.load_more": "Load more",
      "ticket04.request.showing": `Showing ${vars.count} of ${vars.total} records`,
      "ticket04.request.page_loading": `Loading page ${vars.page}`,
      "ticket04.request.page_jump": "Go to page",
      "ticket04.request.page_of": `of ${vars.total} pages`,
      "ticket04.request.page_jump_btn": "Jump",
      "ticket04.request.column.time": "Time",
      "ticket04.request.column.provider": "Provider",
      "ticket04.request.column.model": "Model",
      "ticket04.request.column.input": "Input",
      "ticket04.request.column.output": "Output",
      "ticket04.request.column.cost": "Cost",
      "ticket04.request.column.latency_first": "Latency",
      "ticket04.request.column.status": "Status",
      "observability.request.column.cache_pricing": "Cache / pricing",
      "observability.request.cache.hit": "Hit",
      "observability.request.cache.miss": "Miss",
      "observability.request.cache.unavailable": "Not recorded",
      "observability.request.pricing.complete": "Complete price",
      "observability.request.pricing.partial": "Partial price",
      "observability.request.pricing.unpriced": "Unpriced",
      "ticket04.request.column.source": "Source",
      "ticket04.request.sort_aria": `Sort by ${vars.column}`,
      "ticket04.request.status_error_aria": "Error status",
      "ticket04.request.status_success_aria": "Success status",
      "usage.request_log.totals": "Total",
      "usage.request_log.metric.requests": "Requests",
      "usage.request_log.metric.success_rate": "Success rate",
      "usage.request_log.metric.avg_latency": "Average latency",
      "usage.request_log.source_filter_aria": "Select source",
    };
    return map[key] || key;
  },
  getCopyLocale: () => "en-US",
}));

vi.mock("../../../../lib/limits-providers.js", () => ({
  limitProviderName: (id) => {
    const map = { claude: "Claude", codex: "Codex", hermes: "Hermes" };
    return map[id] || id;
  },
}));

import { useRequestUsageRecords } from "../../../../hooks/use-request-usage-records";

function makeRecord(overrides = {}) {
  return {
    id: "rec-1",
    timestamp: "2026-06-24T01:10:00.000Z",
    source: "codex",
    source_display_name: "Codex",
    model: "gpt-5",
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    cost_usd: 0.01,
    status: 200,
    latency_ms: 830,
    first_token_ms: 200,
    request_source: "session_log",
    ...overrides,
  };
}

const HOOK_DEFAULTS = {
  records: [],
  totals: null,
  source: "edge",
  loading: false,
  error: null,
  refresh: vi.fn(),
  fetchedAt: null,
  page: 1,
  totalPages: 1,
  total: 0,
};

describe("RequestUsageLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRequestUsageRecords.mockReturnValue(HOOK_DEFAULTS);
  });

  it("renders loading state", () => {
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, loading: true });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(screen.getByRole("status", { name: "Loading request records" })).toBeInTheDocument();
  });

  it("renders empty state when no records", () => {
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(screen.getByText("No request records")).toBeInTheDocument();
  });

  it("requests at most the latest 1000 records from the backend", () => {
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it("renders error state with retry button", () => {
    const refresh = vi.fn();
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, error: "network down", refresh });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(screen.getByText("Failed to load")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("renders request diagnostics including cache-hit and pricing basis", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ cached_input_tokens: 40, pricing_coverage: "complete" })],
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    const expectedHeaders = ["Time", "Provider", "Model", "Input", "Output", "Cost", "Latency", "Status", "Cache / pricing", "Source"];
    for (const header of expectedHeaders) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.getByText("Hit")).toBeInTheDocument();
    expect(screen.getByText("Complete price")).toBeInTheDocument();
  });

  it("does not render inert sort controls when request ordering is server-owned", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.queryByRole("button", { name: /Sort by/i })).not.toBeInTheDocument();
  });

  it("keeps existing rows visible while a new server page is loading", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      loading: true,
      total: 60,
      totalPages: 6,
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading page 1" })).toBeInTheDocument();
  });

  it("renders cache read subline with R prefix when cached_input_tokens > 0", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ cached_input_tokens: 40704 })],
    });
    const { container } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    // The R prefix + formatted number appears as a subline text node
    expect(container.textContent).toContain("R40,704");
  });

  it("renders latency/first_token in 0.0s / 830ms format", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ latency_ms: 830, first_token_ms: 200 })],
    });
    const { container } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(container.textContent).toContain("0.8s / 200ms");
  });

  it("renders error status in red for 4xx/5xx", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ status: 500 })],
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    const statusEl = screen.getByText("500");
    expect(statusEl.className).toContain("text-red");
  });

  it("renders success status in green for 2xx", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ status: 200 })],
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    const statusEl = screen.getByText("200");
    expect(statusEl.className).toContain("text-emerald");
  });

  it("renders totals row when totals present", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      totals: {
        total_tokens: 150,
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        cost_usd: 0.01,
        request_count: 1,
        success_count: 1,
        success_rate: 100,
        avg_latency_ms: 830,
        cache_hit_rate: 0,
      },
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    // "Total" label appears in the totals row
    const totalLabels = screen.getAllByText("Total");
    expect(totalLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows request count, success rate, and average latency as summary metrics", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      totals: {
        request_count: 25,
        success_count: 24,
        success_rate: 96,
        avg_latency_ms: 830,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-metric-requests")).toHaveTextContent("25");
    expect(screen.getByTestId("request-log-metric-success-rate")).toHaveTextContent("96.0%");
    expect(screen.getByTestId("request-log-metric-avg-latency")).toHaveTextContent("830ms");
  });

  // Note: Frontend sort is removed because backend doesn't support sort/order parameters.
  // Records are sorted server-side by timestamp desc. Tests for server-side sorting
  // should be in backend integration tests.

  it("paginates at 10 records per page and shows page numbers (server-side pagination)", () => {
    // Generate 60 records for server-side pagination
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Server returns page 1 with 10 records, total=60, totalPages=6
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: records.slice(0, 10),
      total: 60,
      totalPages: 6,
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    // PAGE_SIZE = 10, server reports total=60, so showing 10 / 60
    expect(screen.getByText("Showing 10 of 60 records")).toBeInTheDocument();
    // Should show page number 1 as active
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  });

  it("clicking page 2 triggers server-side pagination", async () => {
    // Generate 60 records for server-side pagination
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Server returns page 1 with 10 records initially
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: records.slice(0, 10),
      total: 60,
      totalPages: 6,
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    // Click page 2 button
    const page2Button = screen.getByRole("button", { name: "2" });
    fireEvent.click(page2Button);

    // Should call hook with page=2 - verify mock was called with new page
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });

  it("keeps the selected page when parent rerenders with equivalent provider ids", async () => {
    const allRecords = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String((i % 30) + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    useRequestUsageRecords.mockImplementation(({ page }) => ({
      ...HOOK_DEFAULTS,
      records: allRecords.slice((page - 1) * 10, page * 10),
      total: 60,
      totalPages: 6,
    }));

    const { rerender } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByLabelText("Go to page")).toHaveValue(2);

    rerender(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Go to page")).toHaveValue(2);
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });

  // Note: Frontend sorting is removed, so "sorting resets to page 1" test is obsolete.
  // Server-side sorting doesn't reset pagination - it's handled by the backend.

  it("page input value syncs when clicking page number button", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 60, totalPages: 6 });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const input = screen.getByLabelText("Go to page");
    expect(input).toHaveValue(1);

    // Click page 2
    fireEvent.click(screen.getByRole("button", { name: "2" }));

    // Input should now show 2
    expect(input).toHaveValue(2);
  });

  it("jumps to a specific page when entering page number and pressing Enter", () => {
    const allRecords = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String((i % 30) + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Mock implementation returns different page based on page parameter
    useRequestUsageRecords.mockImplementation(({ page }) => ({
      ...HOOK_DEFAULTS,
      records: allRecords.slice((page - 1) * 10, page * 10),
      total: 60,
      totalPages: 6,
    }));
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const input = screen.getByLabelText("Go to page");
    expect(input).toHaveValue(1);
    // Initial render shows page 1 with 10 records
    expect(screen.getByText("Showing 10 of 60 records")).toBeInTheDocument();

    // Jump to page 6
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Should now be on page 6
    expect(input).toHaveValue(6);
    expect(screen.getByText("Showing 10 of 60 records")).toBeInTheDocument();
    // Page 6 button should be the active/current page
    const page6Btn = screen.getByRole("button", { name: "6" });
    expect(page6Btn.className).toContain("bg-oai-brand");
  });

  it("clamps page number to valid range when input exceeds total pages", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 60, totalPages: 6 });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const input = screen.getByLabelText("Go to page");
    // Try to go to page 99 (should clamp to 6)
    fireEvent.change(input, { target: { value: "99" } });

    // Should clamp to page 6 (total pages)
    expect(input).toHaveValue(6);
  });

  it("clamps page number to 1 when input is less than 1", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 60, totalPages: 6 });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const input = screen.getByLabelText("Go to page");
    // Try to go to page 0 (should clamp to 1)
    fireEvent.change(input, { target: { value: "0" } });

    // Should clamp to page 1
    expect(input).toHaveValue(1);
  });

  it("has a Jump button for page navigation and clicking it confirms current page", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 60, totalPages: 6 });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    // Jump button must be present
    const jumpBtn = screen.getByRole("button", { name: "Jump" });
    expect(jumpBtn).toBeInTheDocument();

    // Input shows page 1 initially
    const input = screen.getByLabelText("Go to page");
    expect(input).toHaveValue(1);

    // Jump on page 1: clicking should keep page 1 (no-op but button is live)
    fireEvent.click(jumpBtn);
    expect(input).toHaveValue(1);

    // Move to page 2 via button click
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(input).toHaveValue(2);

    // Jump on page 2: clicking should keep page 2
    fireEvent.click(jumpBtn);
    expect(input).toHaveValue(2);

    // Jump on page 6 (via page number button), then Jump again
    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(input).toHaveValue(6);
    fireEvent.click(jumpBtn);
    expect(input).toHaveValue(6);
  });

  it("shows ellipsis in page numbers when there are many pages", () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String((i % 30) + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 100, totalPages: 10 });
    const { container } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    // Should contain ellipsis text in pagination area
    expect(container.textContent).toContain("...");
  });

  it("source dropdown triggers server-side filter for both records and totals", async () => {
    useRequestUsageRecords
      .mockReturnValueOnce({
        ...HOOK_DEFAULTS,
        records: [
          makeRecord({ id: "r1", source: "codex", source_display_name: "Codex", model: "codex-model" }),
          makeRecord({ id: "r2", source: "claude", source_display_name: "Claude", model: "claude-model" }),
        ],
        totals: {
          total_tokens: 300,
          input_tokens: 200,
          output_tokens: 100,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          cost_usd: 0.02,
          request_count: 2,
          success_count: 2,
          success_rate: 100,
          avg_latency_ms: 830,
          cache_hit_rate: 0,
        },
      })
      .mockReturnValueOnce({
        ...HOOK_DEFAULTS,
        records: [
          makeRecord({ id: "r2", source: "claude", source_display_name: "Claude", model: "claude-model" }),
        ],
        totals: {
          total_tokens: 150,
          input_tokens: 100,
          output_tokens: 50,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          cost_usd: 0.01,
          request_count: 1,
          success_count: 1,
          success_rate: 100,
          avg_latency_ms: 830,
          cache_hit_rate: 0,
        },
      });

    const user = userEvent.setup();
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex", "claude"]} />);

    expect(screen.getByText("codex-model")).toBeInTheDocument();
    expect(screen.getByText("claude-model")).toBeInTheDocument();

    const select = screen.getByRole("combobox", { name: "Select source" });
    await user.selectOptions(select, "claude");

    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ visibleProviderIds: ["claude"] }),
    );
    expect(screen.getByText("claude-model")).toBeInTheDocument();
    expect(screen.queryByText("codex-model")).not.toBeInTheDocument();
  });
});
