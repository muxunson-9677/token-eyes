import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderIcon } from "../ProviderIcon.jsx";

describe("ProviderIcon", () => {
  it("renders TRAE from the bundled project asset", () => {
    const { container } = render(<ProviderIcon provider="trae" size={20} />);

    const icon = container.querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "/brand-logos/trae.svg");
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
  });

  it("renders DeepSeek Harness from the bundled official Harness repository asset", () => {
    const { container } = render(<ProviderIcon provider="deepseek-harness" size={20} />);

    const icon = container.querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("src", "/brand-logos/deepseek-harness.svg");
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
  });

  it.each([
    ["openai", "/plan-market-icons/openai.png"],
    ["anthropic", "/plan-market-icons/claude.png"],
    ["aliyun_bailian", "/plan-market-icons/aliyun-bailian.png"],
    ["aliyun_bss", "/plan-market-icons/aliyun-bailian.png"],
    ["glm", "/plan-market-icons/glm.png"],
    ["minimax", "/brand-logos/minimax.svg"],
    ["moonshot", "/plan-market-icons/kimi.png"],
    ["volcengine_billing", "/brand-logos/doubao.svg"],
    ["xiaomi_mimo", "/plan-market-icons/xiaomi-mimo.png"],
    ["zcode", "/plan-market-icons/glm.png"],
  ])("renders the official API Provider asset for %s", (provider, src) => {
    const { container } = render(<ProviderIcon provider={provider} size={20} />);
    const icon = container.querySelector("img");
    expect(icon).toHaveAttribute("src", src);
    expect(icon?.getAttribute("src")).not.toMatch(/^https?:/);
  });

  it("falls back to a bundled placeholder when a bundled Provider logo fails", () => {
    const { container } = render(<ProviderIcon provider="volcengine_billing" size={20} />);
    fireEvent.error(container.querySelector("img"));

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
