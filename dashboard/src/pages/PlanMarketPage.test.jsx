import React from "react";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(provider.display_name)).toBeInTheDocument();
  }
  // GLM Lite monthly list price from the seeded catalog.
  expect(screen.getAllByText(/¥118/).length).toBeGreaterThan(0);
  // Claude Max 20x monthly list price.
  expect(screen.getAllByText(/\$200/).length).toBeGreaterThan(0);
});

it("links every provider to its official sources safely", () => {
  renderPage();
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

it("shows the data disclaimer", () => {
  renderPage();
  expect(screen.getByText("copy:plan_market.disclaimer")).toBeInTheDocument();
});
