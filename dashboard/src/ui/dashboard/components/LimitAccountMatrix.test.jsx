import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LimitAccountMatrix } from "./LimitAccountMatrix.jsx";

const evidence = { source_kind: "official_api", accuracy: "exact", coverage: "complete", observed_at: "2026-07-27T00:00:00.000Z", source_updated_at: null, stale_after_seconds: 300, is_stale: false, pricing_source: null, pricing_version: null, note_code: null };

it("shows one account row and an estimated exhaustion warning without inventing another account", () => {
  render(<LimitAccountMatrix accounts={[{ provider_id: "codex", account_key: "hashed-work", account_label: "Work", status: "ok", windows: [{ kind: "five_hour", label: "5h", used_percent: 80, evidence }] }]} forecasts={[{ account_key: "hashed-work", window_kind: "five_hour", window_label: "5h", advice: "danger", exhausts_before_reset: true, exhaust_at: "2026-07-27T03:00:00.000Z" }]} />);
  expect(screen.getAllByTestId("limit-account-row")).toHaveLength(1);
  expect(screen.getByText("Work")).toBeInTheDocument();
  expect(screen.getByText(/预计将在重置前耗尽/)).toBeInTheDocument();
});
