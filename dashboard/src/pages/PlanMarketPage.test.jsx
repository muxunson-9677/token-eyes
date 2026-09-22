import React from "react";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  PlanMarketPage,
  projectPlanMarketCatalogForDashboard,
} from "./PlanMarketPage.jsx";
import planMarketCatalog from "../../../shared/plan-market-catalog.json";
import providerLinksRegistry from "../../../shared/provider-links.json";

const planMarketCss = fs.readFileSync(
  path.resolve(process.cwd(), "src/ui/foundation/apple-glass.css"),
  "utf8",
);
const rustLibSource = fs.readFileSync(
  path.resolve(process.cwd(), "../src-tauri/src/lib.rs"),
  "utf8",
);
const rustLegacyMiscSource = fs.readFileSync(
  path.resolve(process.cwd(), "../src-tauri/src/commands/misc.rs"),
  "utf8",
);
const copyCsvSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/content/copy.csv"),
  "utf8",
);
const providerLinksById = new Map(
  providerLinksRegistry.links.map((link) => [link.link_id, link]),
);
const nodeRequire = createRequire(import.meta.url);
const { getPlanMarketCatalog } = nodeRequire(
  path.resolve(process.cwd(), "../src/lib/plan-market"),
);

const planMarketApi = vi.hoisted(() => ({
  getPlanMarketState: vi.fn(),
  refreshPlanMarketCatalog: vi.fn(),
}));

vi.mock("../lib/api", () => planMarketApi);

// V2-W1 plan market: static curated catalog rendered directly from
// shared/plan-market-catalog.json (no API round-trip, works on web host too).

vi.mock("../lib/copy", () => ({
  copy: (key, values = {}) => Object.hasOwn(values, "count")
    ? `copy:${key}:${values.count}`
    : `copy:${key}`,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/spend/plans"]}>
      <PlanMarketPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  planMarketApi.getPlanMarketState.mockReset();
  planMarketApi.refreshPlanMarketCatalog.mockReset();
  planMarketApi.getPlanMarketState.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function remoteState({
  lastSuccessfulAt = "2026-08-27T08:05:00.000Z",
  changes = {},
} = {}) {
  return {
    ok: true,
    catalog: projectPlanMarketCatalogForDashboard(planMarketCatalog, {
      now: new Date("2026-08-27T08:05:00.000Z"),
    }),
    refresh: {
      source_url: "https://feeds.tokentracker.cc/v1/plan-market/feed.json",
      source_status: "configured",
      last_checked_at: lastSuccessfulAt,
      last_successful_at: lastSuccessfulAt,
      catalog_version: "2026-08-27.1",
      changes: {
        plans_added: 0,
        plans_changed: 0,
        plans_removed: 0,
        price_changed: 0,
        listed: 0,
        delisted: 0,
        ...changes,
      },
      error_code: null,
    },
  };
}

it("runs manual catalog refresh once with native button loading and exact change results", async () => {
  let resolveRefresh;
  planMarketApi.refreshPlanMarketCatalog.mockReturnValue(new Promise((resolve) => {
    resolveRefresh = resolve;
  }));
  renderPage();

  const button = screen.getByRole("button", { name: "copy:plan_market.refresh.button" });
  expect(button.tagName).toBe("BUTTON");
  expect(button).toHaveClass("tt-pressable", "tt-product-focusable");

  fireEvent.click(button);
  fireEvent.click(button);
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveTextContent("copy:plan_market.refresh.loading");

  await act(async () => {
    resolveRefresh(remoteState({
      changes: { plans_added: 2, plans_changed: 3, listed: 1, delisted: 1, price_changed: 2 },
    }));
  });

  expect(screen.getByRole("status")).toHaveTextContent("copy:plan_market.refresh.success");
  expect(screen.getByTestId("plan-market-refresh-added")).toHaveTextContent("2");
  expect(screen.getByTestId("plan-market-refresh-changed")).toHaveTextContent("3");
  expect(screen.getByTestId("plan-market-refresh-listed")).toHaveTextContent("1");
  expect(screen.getByTestId("plan-market-refresh-delisted")).toHaveTextContent("1");
  expect(screen.getByTestId("plan-market-refresh-price-changed")).toHaveTextContent("2");
  expect(screen.getByTestId("plan-market-last-success")).toHaveAttribute(
    "dateTime",
    "2026-08-27T08:05:00.000Z",
  );
});

it("does not let a stale initial read overwrite a newer manual refresh", async () => {
  let resolveInitial;
  planMarketApi.getPlanMarketState.mockReturnValue(new Promise((resolve) => {
    resolveInitial = resolve;
  }));
  planMarketApi.refreshPlanMarketCatalog.mockResolvedValue(remoteState({
    lastSuccessfulAt: "2026-08-27T09:00:00.000Z",
  }));
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "copy:plan_market.refresh.button" }));
  await waitFor(() => expect(screen.getByTestId("plan-market-last-success")).toHaveAttribute(
    "dateTime",
    "2026-08-27T09:00:00.000Z",
  ));

  await act(async () => {
    resolveInitial(remoteState({ lastSuccessfulAt: "2026-08-27T08:00:00.000Z" }));
  });

  expect(screen.getByTestId("plan-market-last-success")).toHaveAttribute(
    "dateTime",
    "2026-08-27T09:00:00.000Z",
  );
});

it("shows a safe failure state and retries from the same real button", async () => {
  planMarketApi.refreshPlanMarketCatalog
    .mockRejectedValueOnce(new Error("private upstream token should never render"))
    .mockResolvedValueOnce(remoteState());
  renderPage();

  fireEvent.click(screen.getByRole("button", { name: "copy:plan_market.refresh.button" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("copy:plan_market.refresh.failure"));
  expect(document.body).not.toHaveTextContent("private upstream token");

  fireEvent.click(screen.getByRole("button", { name: "copy:plan_market.refresh.retry" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("copy:plan_market.refresh.success"));
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(2);
});

it("persists a low-frequency automatic cadence and pauses due checks while the page is hidden", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T15:30:00.000Z"));
  window.localStorage.setItem("tt.planMarketRefreshCadence.v1", "6h");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  planMarketApi.getPlanMarketState.mockResolvedValue(remoteState({
    lastSuccessfulAt: "2026-08-27T08:00:00.000Z",
  }));
  planMarketApi.refreshPlanMarketCatalog.mockResolvedValue(remoteState({
    lastSuccessfulAt: "2026-08-27T15:30:00.000Z",
  }));

  renderPage();
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByLabelText("copy:plan_market.refresh.cadence_label")).toHaveValue("6h");
  expect(planMarketApi.refreshPlanMarketCatalog).not.toHaveBeenCalled();

  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(1);

  fireEvent.change(screen.getByLabelText("copy:plan_market.refresh.cadence_label"), {
    target: { value: "24h" },
  });
  expect(window.localStorage.getItem("tt.planMarketRefreshCadence.v1")).toBe("24h");
});

it("throttles failed automatic checks for the selected cadence instead of retrying on every visibility change", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T15:30:00.000Z"));
  window.localStorage.setItem("tt.planMarketRefreshCadence.v1", "6h");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  planMarketApi.getPlanMarketState.mockResolvedValue(remoteState({
    lastSuccessfulAt: "2026-08-27T08:00:00.000Z",
  }));
  planMarketApi.refreshPlanMarketCatalog.mockRejectedValue(new Error("offline"));

  renderPage();
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(1);

  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  });
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(2);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
  });
  expect(planMarketApi.refreshPlanMarketCatalog).toHaveBeenCalledTimes(3);
});

it("registers the production Rust link_id resolver and removes the legacy arbitrary-URL opener", () => {
  expect(rustLibSource).toContain('include_str!("../../shared/provider-links.json")');
  expect(rustLibSource).toMatch(/fn resolve_provider_link_url\s*\(/);
  expect(rustLibSource).toMatch(/async fn open_external_link\s*\(/);
  expect(rustLibSource).toMatch(/open_external_link,\s*\n/);
  expect(rustLegacyMiscSource).toMatch(/crate::open_external_link\s*\(app,\s*link_id\)/);
  expect(rustLegacyMiscSource).not.toMatch(/url\.starts_with\("http:\/\/"\)/);
  expect(rustLegacyMiscSource).not.toMatch(/format!\("https:\/\/\{url\}"\)/);
});

it("renders every catalog provider with plan prices", () => {
  renderPage();
  for (const provider of planMarketCatalog.providers) {
    expect(screen.getAllByText(provider.display_name).length).toBeGreaterThan(0);
  }
  // GLM Lite monthly list price from the seeded catalog.
  expect(screen.getAllByText(/¥118/).length).toBeGreaterThan(0);
  // Compact rows retain each provider's lowest starting price.
  expect(screen.getAllByText(/\$20/).length).toBeGreaterThan(0);
});

it("uses the official Xiaomi MiMo site icon in its provider row", () => {
  renderPage();

  const xiaomiMiMo = screen.getByTestId("plan-market-provider-xiaomi-mimo");
  expect(xiaomiMiMo.querySelector(".tt-plan-market-provider-icon img")).toHaveAttribute(
    "src",
    "/plan-market-icons/xiaomi-mimo.png",
  );
});

it("binds the market-only Microsoft Copilot id to the Microsoft image instead of the GitHub provider icon", () => {
  renderPage();

  const microsoftCopilot = screen.getByTestId("plan-market-provider-microsoft-copilot");
  expect(microsoftCopilot.querySelector(".tt-plan-market-provider-icon img")).toHaveAttribute(
    "src",
    "/plan-market-icons/copilot.png",
  );
  expect(screen.queryByTestId("plan-market-provider-copilot")).not.toBeInTheDocument();
});

it("renders an explicit price or official price status for every expanded plan tier", () => {
  renderPage();
  for (const provider of planMarketCatalog.providers) {
    fireEvent.click(screen.getByTestId(`plan-market-toggle-${provider.id}`));
  }

  const planCards = document.querySelectorAll(".tt-plan-market-plan-card");
  expect(planCards).toHaveLength(planMarketCatalog.providers.flatMap((provider) => provider.plans).length);
  for (const planCard of planCards) {
    expect(planCard.querySelector(".tt-plan-market-plan-price")?.textContent?.trim()).toBeTruthy();
  }
});

it("preserves every catalog title, quota, highlight, and alternate-price note", () => {
  renderPage();
  const projected = projectPlanMarketCatalogForDashboard(planMarketCatalog, { now: new Date() });
  for (const provider of projected.providers) {
    const providerCard = screen.getByTestId(`plan-market-provider-${provider.id}`);
    fireEvent.click(within(providerCard).getByTestId(`plan-market-toggle-${provider.id}`));
    for (const plan of provider.plans) {
      const planCard = within(providerCard).getByText(plan.display_name).closest("article");
      expect(planCard).not.toBeNull();
      expect(planCard).toHaveTextContent(plan.quota_summary);
      for (const highlight of plan.highlights || []) expect(planCard).toHaveTextContent(highlight);
      for (const alternate of plan.alt_prices || []) {
        if (alternate.note) expect(planCard).toHaveTextContent(alternate.note);
      }
    }
  }
});

it("uses the cost-card depth with restrained type and compact risk badges", () => {
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-stat\s*\{[^}]*min-height:\s*176px;[^}]*padding:\s*20px;[^}]*border-radius:\s*12px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-stat-icon\s*\{[^}]*width:\s*42px;[^}]*height:\s*42px;[^}]*box-shadow:\s*none;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-provider-summary\s*\{[^}]*min-height:\s*64px;[^}]*padding:\s*10px 14px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-access,[\s\S]*?\.tt-plan-market-risk\s*\{[^}]*padding:\s*3px 5px;[^}]*font-size:\s*10px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-plan-count,[\s\S]*?\.tt-plan-market-starting-price\s*\{[^}]*font-size:\s*14px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-plan-grid\s*\{[^}]*gap:\s*12px;[^}]*grid-auto-rows:\s*auto;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-plan-card\s*\{[^}]*min-height:\s*0;[^}]*gap:\s*8px;[^}]*padding:\s*12px;[^}]*border-radius:\s*8px;/s);
});

it("derives two supporting statistics for each overview card from the catalog", () => {
  renderPage();
  const projected = projectPlanMarketCatalogForDashboard(planMarketCatalog, { now: new Date() });
  const providers = projected.providers;
  const plans = providers.flatMap((provider) => provider.plans);
  const recentPlans = providers.filter((provider) => provider.is_recent).flatMap((provider) => provider.plans);

  expect(screen.getByTestId("plan-market-stat-catalog-official")).toHaveTextContent(String(projected.official_source_coverage.provider_count));
  expect(screen.getByTestId("plan-market-stat-catalog-custom")).toHaveTextContent(String(providers.length - projected.official_source_coverage.provider_count));
  expect(screen.getByTestId("plan-market-stat-recent-vendors")).toHaveTextContent(String(providers.filter((provider) => provider.is_recent).length));
  expect(screen.getByTestId("plan-market-stat-recent-plans")).toHaveTextContent(String(recentPlans.length));
  expect(screen.getByTestId("plan-market-stat-paid-plans")).toHaveTextContent(String(plans.filter((plan) => Number(plan.price?.amount) > 0 || plan.price?.display).length));
  expect(screen.getByTestId("plan-market-stat-free-plans")).toHaveTextContent(String(plans.filter((plan) => Number(plan.price?.amount) === 0).length));
  expect(screen.getByTestId("plan-market-stat-official-source-plans")).toHaveTextContent(String(projected.official_source_coverage.plan_count));
  expect(screen.getByTestId("plan-market-stat-no-source-plans")).toHaveTextContent(String(plans.length - projected.official_source_coverage.plan_count));
});

it("removes vendor coverage summaries and uses a light quota separator", () => {
  renderPage();

  expect(document.querySelector(".tt-plan-market-provider-description")).toBeNull();
  expect(document.body).not.toHaveTextContent(/覆盖\s/);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-metadata-separator\s*\{[^}]*width:\s*1px;[^}]*background:\s*[^;]+;[^}]*box-shadow:\s*none;/s);
});

it("renders the reference providers plus the researched Volcano Engine, Xiaomi MiMo, Grok, and Antigravity offerings", () => {
  renderPage();

  const providerNames = [...document.querySelectorAll("[data-testid^='plan-market-provider-'][data-open] [role='heading']")]
    .map((node) => node.textContent);

  expect(providerNames).toEqual([
    "智谱 GLM",
    "阿里云百炼",
    "Anthropic Claude（含 Claude Code）",
    "Codex / OpenAI",
    "Cursor",
    "月之暗面 Kimi",
    "Microsoft Copilot",
    "火山引擎 / 豆包",
    "小米 MiMo",
    "xAI Grok",
    "Google Antigravity",
  ]);

  expect(planMarketCatalog.providers.find((provider) => provider.id === "grok").plans.map((plan) => plan.display_name)).toEqual([
    "Free", "SuperGrok Lite", "SuperGrok", "SuperGrok Plus", "SuperGrok Heavy", "Business", "Enterprise",
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "kimi").plans.map((plan) => [plan.display_name, plan.price.amount])).toEqual([
    ["Andante", 49], ["Moderato", 99], ["Allegretto", 199], ["Allegro", 699],
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "xiaomi-mimo").plans.map((plan) => [plan.display_name, plan.price.amount])).toEqual([
    ["Lite", 39], ["Standard", 99], ["Pro", 329], ["Max", 659],
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "grok").plans.slice(0, 6).map((plan) => plan.price.amount)).toEqual([
    0, 10, 30, 100, 300, 30,
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "aliyun-bailian").plans.map((plan) => plan.display_name)).toEqual([
    "Lite 套餐", "Pro 套餐",
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "cursor").plans.map((plan) => plan.display_name)).toEqual([
    "Hobby", "Pro", "Pro+", "Ultra", "Teams Standard", "Teams Premium", "Enterprise",
  ]);
  expect(planMarketCatalog.providers.find((provider) => provider.id === "antigravity").plans.map((plan) => plan.display_name)).toEqual([
    "Individual", "Google AI Pro", "Google AI Ultra（$100 档）", "Google AI Ultra（最高档）", "Organization（Google Cloud）",
  ]);
});

it("shows one access and risk marker on the collapsed provider, never inside its plan tiers", () => {
  renderPage();

  const claude = screen.getByTestId("plan-market-provider-claude");
  const compactDetails = within(claude).getByTestId("plan-market-compact-details-claude");
  expect(within(compactDetails).queryByTestId("plan-market-provider-description-claude")).not.toBeInTheDocument();
  expect(within(claude).getByTestId("plan-market-provider-access-claude")).toHaveTextContent("copy:plan_market.access.vpn");
  expect(within(claude).getByTestId("plan-market-provider-risk-claude")).toHaveTextContent("copy:plan_market.risk.extreme");

  fireEvent.click(within(claude).getByTestId("plan-market-toggle-claude"));
  expect(within(claude).queryByTestId(/^plan-market-access-/)).not.toBeInTheDocument();
  expect(within(claude).queryByTestId(/^plan-market-risk-/)).not.toBeInTheDocument();
});

it("separates compact tags, plan count, and starting price while showing verified public prices", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T08:05:00.000Z"));
  renderPage();

  const grok = screen.getByTestId("plan-market-provider-grok");
  const metadata = within(grok).getByTestId("plan-market-metadata-grok");
  expect(within(metadata).getByTestId("plan-market-tags-grok")).toHaveTextContent("copy:plan_market.tag.new");
  expect(within(metadata).getByTestId("plan-market-tags-grok")).toHaveTextContent("copy:plan_market.tag.hot");
  expect(within(metadata).getByTestId("plan-market-metadata-separator-grok")).toBeInTheDocument();
  expect(within(metadata).getByTestId("plan-market-plan-count-grok")).toHaveTextContent("copy:plan_market.plan_count");
  expect(within(metadata).getByTestId("plan-market-starting-price-grok")).toHaveTextContent("$0");

  fireEvent.click(within(grok).getByTestId("plan-market-toggle-grok"));
  expect(within(grok).getByText("SuperGrok").closest("article")).toHaveTextContent("$30");
  expect(within(grok).getByText("SuperGrok Plus").closest("article")).toHaveTextContent("$100");

  const cursor = screen.getByTestId("plan-market-provider-cursor");
  fireEvent.click(within(cursor).getByTestId("plan-market-toggle-cursor"));
  expect(within(cursor).getByText("Pro+").closest("article")).toHaveTextContent("$60");

  const openai = screen.getByTestId("plan-market-provider-openai");
  fireEvent.click(within(openai).getByTestId("plan-market-toggle-openai"));
  expect(within(openai).getByText("Business").closest("article")).toHaveTextContent("$30");
  expect(within(openai).getByText("Business").closest("article")).toHaveTextContent("$25");

  const claude = screen.getByTestId("plan-market-provider-claude");
  fireEvent.click(within(claude).getByTestId("plan-market-toggle-claude"));
  expect(within(claude).getByText("Enterprise").closest("article")).toHaveTextContent("$20/席起 + 按量计费");
});

it("links every provider to its official sources safely", () => {
  renderPage();
  for (const provider of planMarketCatalog.providers) {
    fireEvent.click(screen.getByTestId(`plan-market-toggle-${provider.id}`));
  }
  const links = screen.getAllByRole("link");
  for (const provider of planMarketCatalog.providers) {
    for (const source of provider.sources) {
      expect(source).not.toHaveProperty("url");
      const registered = providerLinksById.get(source.link_id);
      expect(registered).toBeDefined();
      const link = links.find((candidate) => (
        candidate.getAttribute("data-provider-link-id") === source.link_id
      ));
      expect(link).toHaveAttribute("href", registered.url);
    }
  }
  for (const link of links) {
    if (String(link.getAttribute("href") || "").startsWith("https://")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel") || "").toMatch(/noopener/);
    }
  }
});

it("marks every current discontinued plan and shows verification dates", () => {
  renderPage();
  fireEvent.click(screen.getByTestId("plan-market-toggle-aliyun-bailian"));
  const discontinuedCount = planMarketCatalog.providers
    .flatMap((p) => p.plans)
    .filter((plan) => plan.status === "discontinued").length;
  expect(screen.queryAllByText("copy:plan_market.status.discontinued")).toHaveLength(
    discontinuedCount,
  );
  const dates = new Set(planMarketCatalog.providers.map((p) => p.last_verified));
  for (const date of dates) {
    expect(screen.getAllByText(new RegExp(date)).length).toBeGreaterThan(0);
  }
});

it("keeps the compact reference layout free of an extra disclaimer row", () => {
  renderPage();
  expect(screen.queryByText(/人工核实的套餐行情快照/)).not.toBeInTheDocument();
});

it("starts as a compact market list and reveals the selected provider plan details", () => {
  renderPage();

  expect(screen.getByTestId("plan-market-overview")).toBeInTheDocument();
  expect(screen.getAllByTestId("plan-market-stat")).toHaveLength(4);
  const actualPlanCount = planMarketCatalog.providers.reduce((count, provider) => count + provider.plans.length, 0);
  expect(screen.getByText(`copy:plan_market.stat.plans_value:${actualPlanCount}`)).toBeInTheDocument();

  const glm = screen.getByTestId("plan-market-provider-glm");
  const toggle = within(glm).getByTestId("plan-market-toggle-glm");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveClass("tt-pressable", "tt-product-focusable");
  expect(within(glm).queryByTestId("plan-market-plans-glm")).not.toBeInTheDocument();

  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(glm).getByTestId("plan-market-plans-glm")).toBeInTheDocument();
  expect(within(glm).getByText("Lite")).toBeInTheDocument();
});

it("keeps the page frame stable while expanding and renders every plan detail without truncation", () => {
  renderPage();

  const page = screen.getByTestId("plan-market-page");
  const overview = screen.getByTestId("plan-market-overview");
  const glm = screen.getByTestId("plan-market-provider-glm");
  fireEvent.click(within(glm).getByTestId("plan-market-toggle-glm"));

  expect(page).not.toHaveClass("tt-plan-market--expanded");
  expect(overview).toHaveAttribute("data-layout-stable", "true");

  for (const plan of planMarketCatalog.providers.find((provider) => provider.id === "glm").plans) {
    expect(within(glm).getByText((_, node) => node?.classList?.contains("tt-plan-market-plan-quota") && node.textContent.includes(plan.quota_summary))).toBeInTheDocument();
    for (const highlight of plan.highlights) expect(within(glm).getByText(highlight)).toBeInTheDocument();
    expect(within(glm).queryByTestId(`plan-market-access-${plan.plan_id}`)).not.toBeInTheDocument();
  }

  const claude = screen.getByTestId("plan-market-provider-claude");
  fireEvent.click(within(claude).getByTestId("plan-market-toggle-claude"));
  expect(within(claude).queryByTestId(/^plan-market-risk-/)).not.toBeInTheDocument();
});

it("shows the global regional price comparison at the top of the market", () => {
  renderPage();

  const comparison = screen.getByTestId("plan-market-global-price-comparison");
  expect(comparison).toHaveAttribute("href", "https://opentherank.com/zh/ai-pricing/");
  expect(comparison).toHaveAttribute("target", "_blank");
  expect(comparison).toHaveAttribute(
    "data-provider-link-id",
    "third-party-opentherank-ai-pricing",
  );
  expect(copyCsvSource).toContain(
    'plan_market.global_price_comparison,dashboard,PlanMarketPage,PlanMarketPage,global_price_comparison,"第三方比价（非官方，数据可能滞后）"',
  );
});

it("uses the real system time to include a promotion through valid_until day and hide it afterward", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-15T23:59:59.999Z"));
  const beforeExpiry = renderPage();
  const beforeGlm = screen.getByTestId("plan-market-provider-glm");
  fireEvent.click(within(beforeGlm).getByTestId("plan-market-toggle-glm"));
  expect(beforeGlm).toHaveTextContent(/7 折|8 折/);
  beforeExpiry.unmount();

  vi.setSystemTime(new Date("2026-08-16T00:00:00.000Z"));
  renderPage();
  const afterGlm = screen.getByTestId("plan-market-provider-glm");
  fireEvent.click(within(afterGlm).getByTestId("plan-market-toggle-glm"));
  expect(afterGlm).toHaveTextContent("Lite");
  expect(afterGlm).not.toHaveTextContent(/7 折|8 折|限时/);
});

it("keeps stale base plans visible as needing review and removes freshness badges", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  renderPage();

  expect(screen.queryAllByText("copy:plan_market.tag.hot")).toHaveLength(0);
  expect(screen.queryAllByText("copy:plan_market.tag.new")).toHaveLength(0);
  const recentStat = screen.getAllByTestId("plan-market-stat")[1];
  expect(within(recentStat).getByText("copy:plan_market.stat.providers_value:0")).toBeInTheDocument();
  expect(screen.getByTestId("plan-market-stat-recent-vendors")).toHaveTextContent("0");
  expect(screen.getByTestId("plan-market-stat-recent-plans")).toHaveTextContent("0");
  const glm = screen.getByTestId("plan-market-provider-glm");
  fireEvent.click(within(glm).getByTestId("plan-market-toggle-glm"));
  const lite = within(glm).getByText("Lite").closest("article");
  expect(lite).toHaveTextContent("¥118");
  expect(lite).toHaveTextContent("copy:plan_market.status.needs_review");
  expect(copyCsvSource).toContain(
    'plan_market.status.needs_review,dashboard,PlanMarketPage,PlanMarketPage,status_needs_review,"待复核"',
  );
});

it("never labels an unverified provider as official and exposes its review state", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
  renderPage();

  const volcengine = screen.getByTestId("plan-market-provider-volcengine-doubao");
  expect(within(volcengine).queryByText("copy:plan_market.official")).not.toBeInTheDocument();
  expect(within(volcengine).getByText("copy:plan_market.status.needs_review")).toBeInTheDocument();

  const cursor = screen.getByTestId("plan-market-provider-cursor");
  expect(within(cursor).getByText("copy:plan_market.official")).toBeInTheDocument();
});

it("uses the provider claim evidence itself for official-source coverage", async () => {
  const { hasOfficialProviderSource } = await import("./PlanMarketPage.jsx");
  expect(typeof hasOfficialProviderSource).toBe("function");
  expect(hasOfficialProviderSource({
    evidence: { verified: true, source_type: "third_party_comparison" },
    sources: [{ link_id: "market-cursor-pricing" }],
  })).toBe(false);
  expect(hasOfficialProviderSource({
    evidence: { verified: true, source_type: "official_pricing" },
    sources: [{ link_id: "third-party-opentherank-ai-pricing" }],
  })).toBe(true);
  expect(hasOfficialProviderSource({
    evidence: { verified: false, source_type: "official_pricing" },
    sources: [{ link_id: "market-cursor-pricing" }],
  })).toBe(false);
});

it("rejects invalid injected time instead of falling back to the wall clock", () => {
  for (const now of [null, "not-a-date", new Date(Number.NaN)]) {
    expect(() => projectPlanMarketCatalogForDashboard(planMarketCatalog, { now }))
      .toThrowError(new TypeError("now must be a valid date"));
  }
});

it("rejects forged supported evidence just like the canonical projector", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  forgedCatalog.providers.find((provider) => provider.id === "glm").plans.pop();
  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-20T12:00:00.000Z"),
  })).toThrow(/evidence hash mismatch/i);
});

it("Task 10 Dashboard rejects a normalized market claim forged as source-body evidence", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  forgedCatalog.providers.find((provider) => provider.id === "glm")
    .plans[0].evidence.content_hash_kind = "source_body_utf8_lf";

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/hash kind|normalized/i);
});

it("rejects a forged GLM alt price that no longer matches its promotion offer", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  forgedCatalog.providers.find((provider) => provider.id === "glm")
    .plans[0].alt_prices[0].amount = 1;

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/promotion offer mismatch/i);
});

it("rejects an orphan GLM promotion price before projection", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  forgedCatalog.providers.find((provider) => provider.id === "glm")
    .plans[0].alt_prices[0].promotion_id = "orphan-promotion";

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/orphan promotion price/i);
});

it("Task 10 Dashboard rejects duplicate promotion prices sharing one offer", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  const plan = forgedCatalog.providers.find((provider) => provider.id === "glm").plans[0];
  plan.alt_prices.push(structuredClone(plan.alt_prices[0]));
  plan.evidence.verified = false;
  plan.evidence.content_sha256 = null;

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/duplicate promotion price|one-to-one/i);
});

it("Task 10 Dashboard rejects a promotion offer left after its alt price is removed", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  const plan = forgedCatalog.providers.find((provider) => provider.id === "glm").plans[0];
  plan.alt_prices = [];
  plan.evidence.verified = false;
  plan.evidence.content_sha256 = null;

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/orphan promotion offer|one-to-one/i);
});

it("Task 10 Dashboard rejects a promotion offer for an unknown plan", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  const promotion = forgedCatalog.providers.find((provider) => provider.id === "glm").promotions[0];
  promotion.offers.push({
    ...structuredClone(promotion.offers[0]),
    plan_id: "unknown-plan",
  });
  promotion.evidence.verified = false;
  promotion.evidence.content_sha256 = null;

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-15T12:00:00.000Z"),
  })).toThrow(/unknown plan|orphan promotion offer|one-to-one/i);
});

it("rejects verified claim supports absent from its exact evidence source", () => {
  const forgedCatalog = structuredClone(planMarketCatalog);
  const glm = forgedCatalog.providers.find((provider) => provider.id === "glm");
  const source = glm.sources.find((candidate) => candidate.link_id === glm.evidence.link_id);
  source.supports = source.supports.filter((support) => support !== "plan_inventory");

  expect(() => projectPlanMarketCatalogForDashboard(forgedCatalog, {
    now: new Date("2026-08-20T12:00:00.000Z"),
  })).toThrow(/does not support plan_inventory/i);
});

it("keeps the dashboard projection byte-for-byte aligned with the canonical Node projection", () => {
  for (const now of [
    new Date("2026-08-15T23:59:59.999Z"),
    new Date("2026-08-16T00:00:00.000Z"),
    new Date("2030-01-01T00:00:00.000Z"),
  ]) {
    expect(projectPlanMarketCatalogForDashboard(planMarketCatalog, { now })).toEqual(
      getPlanMarketCatalog({ now }),
    );
  }
});

it("filters and sorts compact provider rows without altering the catalog", () => {
  renderPage();

  const filter = screen.getByTestId("plan-market-provider-filter");
  const sort = screen.getByTestId("plan-market-sort");

  fireEvent.change(filter, { target: { value: "claude" } });
  expect(screen.getByTestId("plan-market-provider-claude")).toBeInTheDocument();
  expect(screen.queryByTestId("plan-market-provider-glm")).not.toBeInTheDocument();

  fireEvent.change(filter, { target: { value: "all" } });
  fireEvent.change(sort, { target: { value: "plan-count-asc" } });
  const visibleProviderIds = [...document.querySelectorAll("[data-testid^='plan-market-provider-'][data-open]")]
    .map((node) => node.dataset.testid.replace("plan-market-provider-", ""));
  const expectedFirstProvider = [...planMarketCatalog.providers]
    .sort((left, right) => left.plans.length - right.plans.length || left.display_name.localeCompare(right.display_name))[0];
  expect(visibleProviderIds[0]).toBe(expectedFirstProvider.id);
});
