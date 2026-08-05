import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copy } from "../../../../lib/copy";
import { DataConfidenceBadge } from "../DataConfidenceBadge.jsx";

describe("DataConfidenceBadge", () => {
  it.each([
    ["exact", "data.confidence.exact"],
    ["estimated", "data.confidence.estimated"],
    ["partial", "data.confidence.partial"],
    ["stale", "data.confidence.stale"],
    ["unavailable", "data.confidence.unavailable"],
    ["unattributed", "data.confidence.unattributed"],
  ])("renders the %s state as visible text", (state, label) => {
    render(<DataConfidenceBadge confidence={{ state, states: [state] }} />);
    expect(screen.getByText(copy(label))).toBeVisible();
  });

  it("shows freshness and source evidence without relying on a tooltip", () => {
    render(<DataConfidenceBadge confidence={{
      state: "exact",
      states: ["exact"],
      sourceLabel: "Codex session logs",
      observedAt: "2026-08-01T01:00:00.000Z",
    }} />);

    expect(screen.getByText(/Codex session logs/)).toBeVisible();
    expect(screen.getByText(/2026/)).toBeVisible();
  });

  it("shows unattributed quantity, share, impact, and a diagnostic action", () => {
    const openDiagnostics = vi.fn();
    render(<DataConfidenceBadge confidence={{
      state: "unattributed",
      states: ["unattributed"],
      unattributedTokens: 80,
      unattributedPercent: 8,
    }} onOpenDiagnostics={openDiagnostics} />);

    expect(screen.getByText(copy("data.confidence.unattributed_detail", { tokens: 80, percent: 8 }))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: copy("data.confidence.open_diagnostics") }));
    expect(openDiagnostics).toHaveBeenCalledTimes(1);
  });
});
