import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    pricingRules: [],
  });
  setLocalSettings.mockImplementation(async (payload) => ({
    ok: true,
    agentDefaultPricing: payload.agentDefaultPricing,
    pricingRules: payload.pricingRules ?? [],
  }));
});

it("loads and saves per-agent default pricing", async () => {
  const user = userEvent.setup();
  render(<AgentPricingSection />);

  await screen.findByDisplayValue("3");
  expect(screen.getByText("Agent 计费规则")).toBeInTheDocument();
  // Default pricing section still renders its three input/output pairs.
  expect(screen.getAllByText("输入")).toHaveLength(3);
  expect(screen.getAllByText("输出")).toHaveLength(3);
  const saveButton = screen.getByRole("button", { name: "保存" });
  expect(saveButton).toBeDisabled();

  // The default-pricing inputs are the number spinbuttons. Find the codex
  // output (3rd agent's output = index 3 in the grid order claude-in/out,
  // codex-in/out).
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
      pricingRules: [],
    });
  });
  expect(await screen.findByText("已保存到本地。刷新或同步用量后成本会更新。")).toBeInTheDocument();
});

it("shows the empty-state hint when no rules exist", async () => {
  render(<AgentPricingSection />);
  expect(await screen.findByText("暂无规则，点击下方按钮新增。")).toBeInTheDocument();
});

it("renders existing pricing rules in the table", async () => {
  getLocalSettings.mockResolvedValue({
    agentDefaultPricing: {
      claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      codex: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      hermes: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
    },
    pricingRules: [
      {
        id: "codex:gpt-5.2-codex",
        source: "codex",
        model: "gpt-5.2-codex",
        inputPricePer1M: 1.75,
        outputPricePer1M: 14,
        currency: "USD",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
    ],
  });
  render(<AgentPricingSection />);
  expect(await screen.findByText("gpt-5.2-codex")).toBeInTheDocument();
  expect(screen.getByText("1.75")).toBeInTheDocument();
  expect(screen.getByText("14")).toBeInTheDocument();
  expect(screen.getByText("USD")).toBeInTheDocument();
  expect(screen.getByText("2026-06-20")).toBeInTheDocument();
});

it("adds a new pricing rule via the form and saves it", async () => {
  const user = userEvent.setup();
  render(<AgentPricingSection />);
  await screen.findByDisplayValue("3");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "新增规则" }));
  });

  // The model field is a text input; fill it.
  const modelInput = screen.getByRole("textbox");
  await act(async () => {
    await user.type(modelInput, "gpt-5.2-codex");
  });

  // The rule editor renders two price spinbuttons labeled "输入 / 1M" and
  // "输出 / 1M". They are distinct from the default-pricing inputs (labeled
  // "输入" / "输出"), so query by their full label text.
  const ruleInputPrice = screen.getByLabelText("输入 / 1M");
  const ruleOutputPrice = screen.getByLabelText("输出 / 1M");
  await act(async () => {
    await user.clear(ruleInputPrice);
    await user.type(ruleInputPrice, "1.75");
    await user.clear(ruleOutputPrice);
    await user.type(ruleOutputPrice, "14");
  });

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存规则" }));
  });

  // The rule should now appear in the table.
  expect(await screen.findByText("gpt-5.2-codex")).toBeInTheDocument();

  // Save all changes.
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "保存" }));
  });

  await waitFor(() => {
    const call = setLocalSettings.mock.calls.at(-1)?.[0];
    expect(call?.pricingRules).toHaveLength(1);
    expect(call?.pricingRules[0]).toMatchObject({
      source: "codex",
      model: "gpt-5.2-codex",
      inputPricePer1M: 1.75,
      outputPricePer1M: 14,
      currency: "USD",
    });
  });
});

it("deletes a pricing rule from the table", async () => {
  const user = userEvent.setup();
  getLocalSettings.mockResolvedValue({
    agentDefaultPricing: {
      claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      codex: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
      hermes: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
    },
    pricingRules: [
      {
        id: "codex:gpt-5.2-codex",
        source: "codex",
        model: "gpt-5.2-codex",
        inputPricePer1M: 1.75,
        outputPricePer1M: 14,
        currency: "USD",
        updated_at: "2026-06-20T00:00:00.000Z",
      },
    ],
  });
  render(<AgentPricingSection />);
  expect(await screen.findByText("gpt-5.2-codex")).toBeInTheDocument();

  // window.confirm is stubbed to auto-accept.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () => {
    await user.click(screen.getByRole("button", { name: "删除" }));
  });

  expect(screen.queryByText("gpt-5.2-codex")).not.toBeInTheDocument();
});
