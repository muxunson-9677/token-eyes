import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentPricingSection } from "./AgentPricingSection.jsx";
import { getLocalSettings, getUsageModelBreakdown, setLocalSettings, verifyOfficialModelPricing } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  getUsageModelBreakdown: vi.fn(),
  setLocalSettings: vi.fn(),
  verifyOfficialModelPricing: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(
    "token-eyes.settings.disclosure.cost.agent-pricing.v1",
    "1",
  );
  getUsageModelBreakdown.mockResolvedValue({ sources: [] });
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
  verifyOfficialModelPricing.mockResolvedValue({
    ok: false,
    status: "manual_required",
    error: "未能自动核价",
  });
});

it("removes default fallback price inputs and keeps user-defined rules", async () => {
  render(<AgentPricingSection />);

  expect(await screen.findByText("模型定价表")).toBeInTheDocument();
  expect(screen.queryByText("默认计费（回退）")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "新增规则" })).toBeInTheDocument();
  expect(screen.queryByLabelText("输入")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("输出")).not.toBeInTheDocument();
});

it("uses a compact fixed pricing table without a forced 720px overflow width", async () => {
  const { container } = render(<AgentPricingSection />);
  expect(await screen.findByText("公开价目")).toBeInTheDocument();

  const catalogTable = container.querySelector('[data-testid="model-pricing-table"]');
  expect(catalogTable).toHaveClass("table-fixed");
  expect(catalogTable).not.toHaveClass("min-w-[720px]");
});

it("renders the verified public model price table with official sources", async () => {
  render(<AgentPricingSection />);

  expect(await screen.findByText("公开价目")).toBeInTheDocument();
  expect(screen.getByText("GPT-5.5")).toBeInTheDocument();
  expect(screen.getByText("MiniMax-M2.7")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "官网" }).length).toBeGreaterThan(0);
  expect(screen.getByText("价格核验于 2026-07-14")).toBeInTheDocument();
});

it("keeps the pricing help action outside the disclosure and stable across collapsed and expanded states", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(
    "token-eyes.settings.disclosure.cost.agent-pricing.v1",
    "0",
  );
  render(<AgentPricingSection />);

  const disclosure = screen.getByRole("button", { name: "模型定价表" });
  expect(disclosure).toHaveAttribute("aria-expanded", "false");
  const help = screen.getByRole("link", { name: "如何定价?" });
  expect(help).toBeVisible();
  expect(disclosure).not.toContainElement(help);

  await user.click(disclosure);
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
  expect(disclosure).not.toContainElement(help);

  const catalog = document.getElementById("model-pricing-catalog");
  catalog.scrollIntoView = vi.fn();
  await user.click(help);
  expect(catalog.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  expect(disclosure).toHaveAttribute("aria-expanded", "true");
});

it("covers the requested model catalog and flags newly observed models", async () => {
  getUsageModelBreakdown.mockResolvedValue({
    sources: [{ source: "trae", models: [{ model: "brand-new-model-2026" }] }],
  });
  render(<AgentPricingSection />);

  for (const label of [
    "GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.6 Luna", "GPT-5 Mini",
    "Claude Opus 4.8", "Claude Fable 5", "Claude Sonnet 5", "Claude Haiku 4.5",
    "Gemini 3.1 Pro", "GLM-5.2", "GLM-5.1", "DeepSeek V4 Pro",
    "DeepSeek V4 Flash", "MiniMax M3", "Kimi K2.7 Code", "Kimi K2.6",
    "MiMo v2.5 Pro", "MiMo v2.5", "Grok 4 Fast",
  ]) {
    expect(await screen.findByText(label)).toBeInTheDocument();
  }
  expect(await screen.findByText("brand-new-model-2026")).toBeInTheDocument();
  expect(screen.getByText("新检测模型 · 待核价")).toBeInTheDocument();
});

it("automatically verifies a newly observed model against official data and saves the rule", async () => {
  const user = userEvent.setup();
  getUsageModelBreakdown.mockResolvedValue({
    sources: [{ source: "trae", models: [{ model: "gpt-5" }] }],
  });
  verifyOfficialModelPricing.mockResolvedValue({
    ok: true,
    status: "verified",
    source: "trae",
    source_url: "https://developers.openai.com/api/docs/models/gpt-5",
    verified_at: "2026-07-15T00:00:00.000Z",
    pricing: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: null, currency: "USD" },
  });

  render(<AgentPricingSection />);
  await user.click(await screen.findByRole("button", { name: "自动核价 gpt-5" }));

  await waitFor(() => expect(verifyOfficialModelPricing).toHaveBeenCalledWith({
    model: "gpt-5",
    model_id: "gpt-5",
    source: "trae",
  }));
  await waitFor(() => expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({
    pricingRules: expect.arrayContaining([expect.objectContaining({
      source: "trae",
      model: "gpt-5",
      inputPricePer1M: 1.25,
      outputPricePer1M: 10,
      currency: "USD",
    })]),
  })));
  expect(await screen.findByText("官网自动核价成功")).toBeInTheDocument();
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
  await screen.findByRole("button", { name: "新增规则" });

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
    await user.click(screen.getByRole("button", { name: "保存更改" }));
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
