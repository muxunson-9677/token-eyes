import React from "react";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
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
      "ticket04.request.pricing_evidence_note": "Pricing source and freshness are shown per record",
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
      "spend.usage.pagination.records": `${vars.total} records`,
      "spend.usage.pagination.previous": "Previous",
      "spend.usage.pagination.next": "Next",
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
      "pricing.provenance.official_api": "Official price",
      "pricing.provenance.curated": "Curated rate",
      "pricing.provenance.third_party": "Third-party catalog",
      "pricing.provenance.user_override": "User configured",
      "pricing.provenance.mixed": "Mixed sources",
      "pricing.provenance.unpriced": "Unpriced",
      "pricing.provenance.estimated": "Estimated",
      "pricing.provenance.inferred": "Inferred match",
      "pricing.provenance.stale": "Stale price",
      "pricing.provenance.composition": `${vars.sources}`,
      "pricing.provenance.tooltip": `Source: ${vars.source}; matched model: ${vars.model}; updated: ${vars.updated}`,
      "ticket04.request.column.source": "Source",
      "ticket04.request.sort_aria": `Sort by ${vars.column}`,
      "ticket04.request.status_error_aria": "Error status",
      "ticket04.request.status_success_aria": "Success status",
      "ticket04.request.status_unsampled": "No sample",
      "usage.request_log.totals": "Total",
      "usage.request_log.metric.requests": "Requests",
      "usage.request_log.metric.success_rate": "Success rate",
      "usage.request_log.metric.avg_latency": "Average latency",
      "usage.request_log.metric.requests_detail": `${vars.count} requests recorded`,
      "usage.request_log.metric.success_detail": `${vars.success} succeeded / ${vars.failed} failed`,
      "usage.request_log.metric.success_detail_with_interrupted": `${vars.success} succeeded / ${vars.interrupted} interrupted / ${vars.failed} failed`,
      "usage.request_log.metric.latency_detail": "Based on recorded requests",
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
  it("does not advertise pricing-provenance labels in the request-log header", () => {
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.queryByText("Pricing source and freshness are shown per record")).not.toBeInTheDocument();
    expect(screen.queryByText("Billing statistics use official model list prices")).not.toBeInTheDocument();
  });

  it("uses nested glass metric summaries without changing the request data", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      totals: {
        request_count: 7,
        success_rate: 100,
        avg_latency_ms: 42,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const metrics = screen.getByTestId("request-log-metrics");
    for (const metric of Array.from(metrics.children)) {
      expect(metric).toHaveClass("tt-surface-nested");
      expect(metric).toHaveClass("tt-request-log-metric");
      expect(metric).toHaveClass("tt-request-log-metric--raised");
      expect(within(metric).getByTestId("request-log-metric-icon")).toBeInTheDocument();
    }
    expect(within(metrics).getByText("7")).toBeInTheDocument();
  });

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

  it("uses compact rows without truncating provider or model facts", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ model: "provider/model-with-a-long-exact-name" })],
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const row = screen.getByTestId("request-log-row-0");
    for (const cell of row.querySelectorAll("td")) expect(cell).toHaveClass("py-1.5");
    expect(screen.getByText("provider/model-with-a-long-exact-name")).not.toHaveClass("truncate");
    expect(within(row).getByText("Codex")).not.toHaveClass("truncate");
  });

  it("keeps a long origin fully visible in the source column", () => {
    const origin = "local-runtime/request-capture/provider-account-with-a-long-stable-identifier";
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ request_source: null, origin })],
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    const chip = screen.getByTestId("request-source-chip");
    expect(chip).toHaveTextContent(origin);
    expect(chip).toHaveAttribute("title", origin);
  });

  it("keeps pricing provenance in the data layer without rendering noisy provenance labels", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [
        makeRecord({
          id: "curated",
          source_kind: "curated",
          pricing_source: "curated:exact",
          source_url: "https://example.test/curated",
          source_updated_at: "2026-08-01T00:00:00.000Z",
          estimated: true,
          match_kind: "exact",
          matched_model: "gpt-5",
        }),
        makeRecord({
          id: "inferred",
          source_kind: "third_party",
          pricing_source: "litellm:prefix-strip",
          estimated: true,
          match_kind: "inferred",
          matched_model: "provider/gpt-5",
        }),
        makeRecord({
          id: "stale-unpriced",
          cost_usd: null,
          pricing_coverage: "unpriced",
          source_kind: "unpriced",
          is_stale: true,
          note_code: "pricing_source_stale",
        }),
      ],
      totals: {
        request_count: 3,
        cost_usd: 0.02,
        pricing_coverage: "partial",
        source_kind: "mixed",
        pricing_components: [
          { source_kind: "curated", priced_tokens: 150 },
          { source_kind: "user_override", priced_tokens: 150 },
        ],
      },
      total: 3,
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.queryByTestId("request-pricing-provenance-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("request-pricing-provenance-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("request-pricing-provenance-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("request-pricing-provenance-total")).not.toBeInTheDocument();
    expect(screen.queryByText("Curated rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Third-party catalog")).not.toBeInTheDocument();
    expect(screen.queryByText("User configured")).not.toBeInTheDocument();
    expect(screen.queryByText("Mixed sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated")).not.toBeInTheDocument();
    expect(screen.queryByText("Inferred match")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale price")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("request-log-row-2")).queryByText("$0")).not.toBeInTheDocument();
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

  it("does not label a non-2xx redirect as a successful request", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ status: 302 })],
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    const statusEl = screen.getByText("302");
    expect(statusEl).toHaveClass("text-red-600");
    expect(statusEl).toHaveAttribute("aria-label", "Error status");
  });

  it("renders each sampled status verbatim and labels a missing status as unsampled", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [
        makeRecord({ id: "ok", status: 200 }),
        makeRecord({ id: "limited", status: 429 }),
        makeRecord({ id: "failed", status: 500 }),
        makeRecord({ id: "unsampled", status: null }),
      ],
      total: 4,
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(within(screen.getByTestId("request-log-row-0")).getByText("200")).toBeInTheDocument();
    expect(within(screen.getByTestId("request-log-row-1")).getByText("429")).toBeInTheDocument();
    expect(within(screen.getByTestId("request-log-row-2")).getByText("500")).toBeInTheDocument();
    expect(within(screen.getByTestId("request-log-row-3")).getByText("No sample")).toBeInTheDocument();
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
    expect(screen.getByTestId("request-log-metric-requests")).toHaveTextContent("25 requests recorded");
    expect(screen.getByTestId("request-log-metric-success-rate")).toHaveTextContent("24 succeeded / 1 failed");
    expect(screen.getByTestId("request-log-metric-avg-latency")).toHaveTextContent("Based on recorded requests");
  });

  it("does not count records without a measured status as failed requests", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      totals: {
        request_count: 1_000,
        status_sample_count: 19,
        success_count: 18,
        success_rate: 94.74,
        avg_latency_ms: null,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-metric-success-rate"))
      .toHaveTextContent("18 succeeded / 1 failed");
    expect(screen.getByTestId("request-log-metric-success-rate"))
      .not.toHaveTextContent("982 failed");
  });

  it("reports interrupted Codex turns separately from provider failures", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ status: 499 })],
      totals: {
        request_count: 1_000,
        status_sample_count: 20,
        success_count: 19,
        interrupted_count: 1,
        failure_count: 0,
        success_rate: 100,
        avg_latency_ms: null,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-metric-success-rate"))
      .toHaveTextContent("19 succeeded / 1 interrupted / 0 failed");
  });

  it("uses reference chips, row emphasis, total band, and a truthful record-count fallback", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      totals: {
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.01,
        request_count: 1,
        success_count: 1,
        success_rate: 100,
        avg_latency_ms: 830,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-row-0")).toHaveClass("tt-request-log-row--featured");
    expect(screen.getByTestId("request-provider-chip")).toHaveClass("tt-request-provider-chip");
    expect(screen.getByTestId("request-status-chip")).toHaveClass("tt-request-status-chip");
    expect(screen.getByTestId("request-source-chip")).toHaveClass("tt-request-source-chip");
    expect(screen.getByTestId("request-log-total-row")).toHaveClass("tt-request-log-total-row");
    expect(screen.getByText("1 records")).toBeInTheDocument();
  });

  it("hides unavailable summary metrics instead of rendering placeholder dashes", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord()],
      totals: {
        request_count: 0,
        success_rate: null,
        avg_latency_ms: undefined,
      },
    });

    const { container } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-metric-requests")).toHaveTextContent("0");
    expect(screen.queryByTestId("request-log-metric-success-rate")).not.toBeInTheDocument();
    expect(screen.queryByTestId("request-log-metric-avg-latency")).not.toBeInTheDocument();
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("ticket06.metric.unavailable");
  });

  it("shows exact zero values and labels a missing row status as unsampled", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({
        status: null,
        request_source: null,
        origin: null,
        latency_ms: 0,
        first_token_ms: 0,
      })],
      totals: {
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
        request_count: 0,
        success_rate: 0,
        avg_latency_ms: 0,
      },
    });

    const { container } = render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByTestId("request-log-metric-success-rate")).toHaveTextContent("0.0%");
    expect(screen.getByTestId("request-log-metric-avg-latency")).toHaveTextContent("0ms");
    expect(container.textContent).toContain("0ms / 0ms");
    expect(container.textContent).toContain("No sample");
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("ticket06.metric.unavailable");
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

    expect(screen.getByText("60 records")).toBeInTheDocument();
    // Should show page number 1 as active
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  });

  it("uses the request summary total when cached page metadata only describes the visible page", () => {
    const records = Array.from({ length: 10 }, (_, i) => makeRecord({ id: `cached-${i}` }));
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records,
      total: 10,
      totalPages: 1,
      totals: {
        request_count: 33,
        success_count: 33,
        success_rate: 100,
        avg_latency_ms: 830,
      },
    });

    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    expect(screen.getByText("33 records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Jump" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");

    rerender(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });

  // Note: Frontend sorting is removed, so "sorting resets to page 1" test is obsolete.
  // Server-side sorting doesn't reset pagination - it's handled by the backend.

  it("marks the selected page when clicking a page number", () => {
    const records = Array.from({ length: 60 }, (_, i) =>
      makeRecord({ id: `rec-${i}`, timestamp: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`, model: `model-${i}` }),
    );
    // Need proper pagination metadata for pagination controls to show
    useRequestUsageRecords.mockReturnValue({ ...HOOK_DEFAULTS, records, total: 60, totalPages: 6 });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
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

// The record-kind filter remains available, but the row itself keeps the
// source column compact instead of repeating record-granularity badges.
describe("RequestUsageLog record granularity (V2-W3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRequestUsageRecords.mockReturnValue(HOOK_DEFAULTS);
  });

  it("keeps raw sources while hiding request-event and aggregate noise badges", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [
        makeRecord({ id: "r1", record_kind: "request_event" }),
        makeRecord({
          id: "r2",
          source: "claude",
          source_display_name: "Claude",
          record_kind: "aggregate_bucket",
          request_source: "queue_aggregate",
        }),
      ],
      total: 2,
    });
    render(
      <RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex", "claude"]} />,
    );
    expect(screen.getByText("queue_aggregate")).toBeInTheDocument();
    expect(screen.queryByText("ticket04.request.kind.request_event")).not.toBeInTheDocument();
    expect(screen.queryByText("ticket04.request.kind.aggregate")).not.toBeInTheDocument();
  });

  it("treats records without record_kind as request events (server heuristic)", () => {
    useRequestUsageRecords.mockReturnValue({
      ...HOOK_DEFAULTS,
      records: [makeRecord({ id: "r1" })],
      total: 1,
    });
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    expect(screen.queryByText("ticket04.request.kind.request_event")).not.toBeInTheDocument();
    expect(screen.queryByText("ticket04.request.kind.aggregate")).not.toBeInTheDocument();
  });

  it("toggling the request-event filter refetches with recordKind and resets the page", () => {
    render(<RequestUsageLog from="2026-06-01" to="2026-06-30" visibleProviderIds={["codex"]} />);
    const toggle = screen.getByRole("checkbox", { name: "ticket04.request.kind_filter" });
    fireEvent.click(toggle);
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ recordKind: "request_event", page: 1 }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "ticket04.request.kind_filter" }));
    expect(useRequestUsageRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ recordKind: "" }),
    );
  });
});
