import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PlanMarketPage } from "./PlanMarketPage.jsx";
import planMarketCatalog from "../../../shared/plan-market-catalog.json";

const planMarketCss = fs.readFileSync(
  path.resolve(process.cwd(), "src/ui/foundation/apple-glass.css"),
  "utf8",
);

// V2-W1 plan market: static curated catalog rendered directly from
// shared/plan-market-catalog.json (no API round-trip, works on web host too).

vi.mock("../lib/copy", () => ({
  copy: (key, values) => key === "plan_market.stat.plans_value"
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
  for (const provider of planMarketCatalog.providers) {
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

it("uses the compact cost-card density for market summary and plan cards", () => {
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-stat\s*\{[^}]*min-height:\s*96px;[^}]*padding:\s*16px;[^}]*border-radius:\s*10px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-provider-summary\s*\{[^}]*min-height:\s*64px;[^}]*padding:\s*10px 14px;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-plan-grid\s*\{[^}]*gap:\s*12px;[^}]*grid-auto-rows:\s*auto;/s);
  expect(planMarketCss).toMatch(/\.tt-reference-route-spend-plans \.tt-plan-market-plan-card\s*\{[^}]*min-height:\s*0;[^}]*gap:\s*8px;[^}]*padding:\s*12px;[^}]*border-radius:\s*8px;/s);
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
    "Lite 套餐", "Standard 套餐", "Pro 套餐",
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
  expect(within(compactDetails).getByTestId("plan-market-provider-description-claude")).toBeInTheDocument();
  expect(within(claude).getByTestId("plan-market-provider-access-claude")).toHaveTextContent("copy:plan_market.access.vpn");
  expect(within(claude).getByTestId("plan-market-provider-risk-claude")).toHaveTextContent("copy:plan_market.risk.extreme");

  fireEvent.click(within(claude).getByTestId("plan-market-toggle-claude"));
  expect(within(claude).queryByTestId(/^plan-market-access-/)).not.toBeInTheDocument();
  expect(within(claude).queryByTestId(/^plan-market-risk-/)).not.toBeInTheDocument();
});

it("separates compact tags, plan count, and starting price while showing verified public prices", () => {
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
  const hrefs = links.map((a) => a.getAttribute("href"));
  for (const provider of planMarketCatalog.providers) {
    for (const source of provider.sources) {
      expect(hrefs).toContain(source.url);
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
