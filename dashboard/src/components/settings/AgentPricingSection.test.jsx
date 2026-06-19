import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentPricingSection } from "./AgentPricingSection.jsx";
import { getLocalSettings, setLocalSettings } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLocalSettings.mockResolvedValue({
    agentDefaultPricing: {
      claude: { inputUsdPer1M: 1, outputUsdPer1M: 2 },
      codex: { inputUsdPer1M: 3, outputUsdPer1M: 4 },
      hermes: { inputUsdPer1M: 5, outputUsdPer1M: 6 },
    },
  });
  setLocalSettings.mockImplementation(async ({ agentDefaultPricing }) => ({
    ok: true,
    agentDefaultPricing,
  }));
});

it("loads and saves per-agent default pricing", async () => {
  const user = userEvent.setup();
  render(<AgentPricingSection />);

  await screen.findByDisplayValue("3");
  const saveButton = screen.getByRole("button", { name: /Save/i });
  expect(saveButton).toBeDisabled();

  const inputs = screen.getAllByRole("spinbutton");
  const codexOutput = inputs[3];

  await act(async () => {
    await user.clear(codexOutput);
    await user.type(codexOutput, "8.5");
  });

  expect(saveButton).toBeEnabled();

  await act(async () => {
    await user.click(saveButton);
  });

  await waitFor(() => {
    expect(setLocalSettings).toHaveBeenCalledWith({
      agentDefaultPricing: {
        claude: { inputUsdPer1M: 1, outputUsdPer1M: 2 },
        codex: { inputUsdPer1M: 3, outputUsdPer1M: 8.5 },
        hermes: { inputUsdPer1M: 5, outputUsdPer1M: 6 },
      },
    });
  });
  expect(await screen.findByText(/Saved locally/i)).toBeInTheDocument();
});
