import React from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before importing TrendMonitorZoomModal to avoid resolution issues
vi.mock("../../../hooks/useCurrency.js", () => ({
  useCurrency: () => ({ currency: "USD", rate: 1 }),
}));

vi.mock("../../../hooks/use-trend-data.js", () => ({
  useTrendData: () => ({ rows: [], from: null, to: null, loading: false }),
}));

vi.mock("@base-ui/react/popover", () => ({
  Popover: {
    Root: ({ children }) => <div>{children}</div>,
    Trigger: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
    Portal: ({ children }) => <div>{children}</div>,
    Positioner: ({ children }) => <div>{children}</div>,
    Popup: ({ children }) => <div>{children}</div>,
  },
}));

import { TrendMonitorZoomModal } from "../TrendMonitorZoomModal.jsx";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe("TrendMonitorZoomModal", () => {
  const defaultProps = {
    zoomConfig: { timeZone: "UTC", tzOffsetMinutes: 0, now: new Date("2026-06-24T00:00:00Z") },
    period: "month",
    from: "2026-06-01",
    to: "2026-06-30",
    timeZoneLabel: "UTC",
    renderChart: () => <div>Chart</div>,
  };

  it("closes via X button without relying on animationend", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<TrendMonitorZoomModal {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: "关闭" });
    await act(async () => {
      await user.click(closeBtn);
    });

    // Advance timers past the 220ms fallback timeout
    act(() => vi.advanceTimersByTime(250));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via backdrop click without relying on animationend", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<TrendMonitorZoomModal {...defaultProps} onClose={onClose} />);

    // Click the backdrop (the outermost fixed overlay div)
    // It has onClick that calls handleClose when e.target === e.currentTarget
    const overlay = document.querySelector(".fixed.inset-0");
    await act(async () => {
      await user.click(overlay);
    });

    // Advance timers past the 220ms fallback timeout
    act(() => vi.advanceTimersByTime(250));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via Escape key without relying on animationend", async () => {
    const onClose = vi.fn();

    render(<TrendMonitorZoomModal {...defaultProps} onClose={onClose} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    // Advance timers past the 220ms fallback timeout
    act(() => vi.advanceTimersByTime(250));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose twice when animationend also fires", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<TrendMonitorZoomModal {...defaultProps} onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: "关闭" });
    await act(async () => {
      await user.click(closeBtn);
    });

    // Trigger animationend on the root overlay (simulating browser animation)
    const overlay = document.querySelector(".fixed.inset-0");
    act(() => {
      overlay.dispatchEvent(new Event("animationend", { bubbles: false }));
    });

    // Advance timers past the 220ms fallback
    act(() => vi.advanceTimersByTime(250));

    // Should only call once even though both animationend and timeout fire
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
