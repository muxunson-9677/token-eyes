import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { UsageAttributionPanel } from "./UsageAttributionPanel.jsx";

it("keeps same-hour native and WSL usage as separate environment rows", () => {
  render(
    <UsageAttributionPanel
      snapshots={[
        { dimensions: { environment_id: "native" }, tokens: { total_tokens: 40, conversation_count: 1 } },
        { dimensions: { environment_id: "wsl:Ubuntu" }, tokens: { total_tokens: 60, conversation_count: 1 } },
      ]}
    />,
  );

  expect(screen.getByRole("cell", { name: "native" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "wsl:Ubuntu" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "60" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "40" })).toBeInTheDocument();
});
