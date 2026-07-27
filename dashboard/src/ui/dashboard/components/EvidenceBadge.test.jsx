import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { copy } from "../../../lib/copy";
import { EvidenceBadge } from "./EvidenceBadge.jsx";

describe("EvidenceBadge", () => {
  it("labels a stale cached value without turning it into an unavailable value", () => {
    render(
      <EvidenceBadge
        evidence={{
          source_kind: "cache",
          accuracy: "exact",
          coverage: "complete",
          observed_at: "2026-07-26T00:00:00.000Z",
          source_updated_at: "2026-07-26T00:00:00.000Z",
          stale_after_seconds: 300,
          is_stale: true,
          pricing_source: null,
          pricing_version: null,
          note_code: "last_successful_value",
        }}
      />,
    );

    expect(screen.getByText(copy("observability.evidence.cached"))).toBeInTheDocument();
    expect(screen.getByTitle((title) => title.includes(copy("observability.evidence.stale_tooltip")))).toBeInTheDocument();
  });

  it("labels partial coverage instead of a complete price", () => {
    render(
      <EvidenceBadge
        evidence={{
          source_kind: "estimated",
          accuracy: "estimated",
          coverage: "partial",
          observed_at: "2026-07-26T00:00:00.000Z",
          source_updated_at: null,
          stale_after_seconds: 300,
          is_stale: false,
          pricing_source: "curated-overrides",
          pricing_version: "2026-07-26",
          note_code: null,
        }}
      />,
    );

    expect(screen.getByText(copy("observability.evidence.partial"))).toBeInTheDocument();
  });

  it("exposes source, confidence, observation time, and freshness for each evidenced number", () => {
    render(
      <EvidenceBadge
        evidence={{
          source_kind: "official_api",
          accuracy: "exact",
          coverage: "complete",
          observed_at: "2026-07-27T00:00:00.000Z",
          source_updated_at: null,
          stale_after_seconds: 300,
          is_stale: false,
          pricing_source: "provider-official",
          pricing_version: "2026-07-27",
          note_code: null,
        }}
      />,
    );

    const badge = screen.getByText(copy("observability.evidence.official"));
    expect(badge.title).toContain("official_api");
    expect(badge.title).toContain("exact");
    expect(badge.title).toContain("2026-07-27T00:00:00.000Z");
    expect(badge.title).toContain("provider-official");
  });
});
