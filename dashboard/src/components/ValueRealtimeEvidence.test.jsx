import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { copy } from "../lib/copy";
import { ValueRealtimeEvidence } from "./ValueRealtimeEvidence.jsx";

describe("ValueRealtimeEvidence", () => {
  it("does not fabricate a zero record count when no evidence object exists", async () => {
    const user = userEvent.setup();
    render(<ValueRealtimeEvidence evidence={null} />);
    await user.click(screen.getByText(copy("value.details.evidence")));
    const recordLabel = screen.getByText(copy("value_realtime.evidence.records"));
    expect(recordLabel.nextElementSibling).toHaveTextContent(copy("value_realtime.evidence.unavailable"));
    expect(recordLabel.nextElementSibling).not.toHaveTextContent(/^0$/);
  });

  it("keeps an explicit zero record count when the evidence object reports it", async () => {
    const user = userEvent.setup();
    render(<ValueRealtimeEvidence evidence={{ source_kind: "unavailable", record_count: 0, safe_record_refs: [] }} />);
    await user.click(screen.getByText(copy("value.details.evidence")));
    const recordLabel = screen.getByText(copy("value_realtime.evidence.records"));
    expect(recordLabel.nextElementSibling).toHaveTextContent(/^0$/);
  });
});
