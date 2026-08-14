import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PlanMarketPage } from "./PlanMarketPage.jsx";
import planMarketCatalog from "../../../shared/plan-market-catalog.json";

// V2-W1 plan market: static curated catalog rendered directly from
// shared/plan-market-catalog.json (no API round-trip, works on web host too).

vi.mock("../lib/copy", () => ({
  copy: (key) => `copy:${key}`,
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

it("marks discontinued plans and shows verification dates", () => {
  renderPage();
  fireEvent.click(screen.getByTestId("plan-market-toggle-aliyun-bailian"));
  const discontinuedCount = planMarketCatalog.providers
    .flatMap((p) => p.plans)
    .filter((plan) => plan.status === "discontinued").length;
  expect(screen.getAllByText("copy:plan_market.status.discontinued").length).toBe(
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

  const glm = screen.getByTestId("plan-market-provider-glm");
  const toggle = within(glm).getByTestId("plan-market-toggle-glm");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(glm).queryByTestId("plan-market-plans-glm")).not.toBeInTheDocument();

  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(within(glm).getByTestId("plan-market-plans-glm")).toBeInTheDocument();
  expect(within(glm).getByText("Lite")).toBeInTheDocument();
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
  expect(visibleProviderIds[0]).toBe("aliyun-bailian");
});
