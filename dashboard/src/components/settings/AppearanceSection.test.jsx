import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./AppearanceSection.jsx";
import { getLocalSettings, setLocalSettings } from "../../lib/api";
import { useCurrency } from "../../hooks/useCurrency.js";
import { useLocale } from "../../hooks/useLocale.js";
import { useTheme } from "../../hooks/useTheme.js";
import { setCopyLocale } from "../../lib/copy";

vi.mock("../../lib/api", () => ({
  getLocalSettings: vi.fn(),
  setLocalSettings: vi.fn(),
}));

vi.mock("../../hooks/useCurrency.js", () => ({
  useCurrency: vi.fn(),
}));

vi.mock("../../hooks/useLocale.js", () => ({
  useLocale: vi.fn(),
}));

vi.mock("../../hooks/useTheme.js", () => ({
  useTheme: vi.fn(),
}));

describe("AppearanceSection", () => {
  const refreshRates = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setCopyLocale("zh-CN");
    getLocalSettings.mockResolvedValue({ currencySettings: { usdToCny: 7.2 } });
    setLocalSettings.mockResolvedValue({ ok: true });
    refreshRates.mockResolvedValue({
      rates: { USD: 1, CNY: 7.31 },
      fetchedAt: 1783188000000,
    });
    useCurrency.mockReturnValue({
      currency: "USD",
      rate: 1,
      rateSource: "default",
      rateFetchedAt: null,
      setCurrency: vi.fn(),
      refreshRates,
    });
    useLocale.mockReturnValue({ locale: "zh-CN", setLocale: vi.fn() });
    useTheme.mockReturnValue({ theme: "system", setTheme: vi.fn() });
  });

  it("refreshes the current USD/CNY rate and persists the fetched value", async () => {
    const user = userEvent.setup();

    render(<AppearanceSection />);

    await waitFor(() => expect(screen.getByDisplayValue("7.2")).toBeInTheDocument());
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "刷新" }));
    });

    await waitFor(() =>
      expect(refreshRates).toHaveBeenCalledWith({ throwOnError: true }),
    );
    await waitFor(() =>
      expect(setLocalSettings).toHaveBeenCalledWith({
        currencySettings: { usdToCny: 7.31 },
      }),
    );
    expect(screen.getByDisplayValue("7.31")).toBeInTheDocument();
  });

  it("marks only the selected theme option as pressed", async () => {
    render(<AppearanceSection />);

    await waitFor(() =>
      expect(screen.getByDisplayValue("7.2")).toBeInTheDocument(),
    );
    const themeButtons = screen
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-pressed"));
    expect(themeButtons).toHaveLength(3);
    expect(themeButtons.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(themeButtons.filter((button) => button.getAttribute("aria-pressed") === "false")).toHaveLength(2);
  });
});
