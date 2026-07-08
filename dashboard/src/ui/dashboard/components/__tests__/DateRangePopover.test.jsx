import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { setCopyLocale } from "../../../../lib/copy";
import { DateRangePopover } from "../DateRangePopover.jsx";

// Ticket-02 E: DateRangePopover must render the start/end time labels and
// date+time inputs required by ticket E §2 (acceptance criterion §442:
// "日历弹窗自定义日期时间功能完整（日期+时间）"). All copy keys resolve to
// the zh-CN CSV fallback, so we pin zh-CN for determinism.

describe("DateRangePopover", () => {
  beforeEach(() => {
    setCopyLocale("zh-CN");
  });

  it("renders start/end labels and date/time sub-labels", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);

    // Field labels
    expect(screen.getByText("开始时间")).toBeInTheDocument();
    expect(screen.getByText("结束时间")).toBeInTheDocument();
    // Sub-labels (each appears twice — once per column)
    expect(screen.getAllByText("日期").length).toBe(2);
    expect(screen.getAllByText("时间").length).toBe(2);
  });

  it("defaults from time to 00:00 and to time to 23:59 when input has no time component", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);

    const timeInputs = screen.getAllByLabelText(/时间$/);
    // First time input = start, second = end
    expect(timeInputs[0]).toHaveValue("00:00");
    expect(timeInputs[1]).toHaveValue("23:59");
  });

  it("preserves time component when input is an ISO datetime string", () => {
    render(
      <DateRangePopover
        from="2026-06-01T09:30:00"
        to="2026-06-07T18:45:00"
      />,
    );

    const timeInputs = screen.getAllByLabelText(/时间$/);
    expect(timeInputs[0]).toHaveValue("09:30");
    expect(timeInputs[1]).toHaveValue("18:45");
  });

  it("renders date inputs with YYYY/MM/DD text format", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);

    const dateInputs = screen.getAllByLabelText(/日期$/);
    expect(dateInputs[0]).toHaveValue("2026/06/01");
    expect(dateInputs[1]).toHaveValue("2026/06/07");
  });

  it("Apply button is disabled when no date is selected", () => {
    render(<DateRangePopover from={null} to={null} />);
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
  });

  it("onApply receives ISO datetime strings with time components", () => {
    const onApply = vi.fn();
    render(
      <DateRangePopover
        from="2026-06-01"
        to="2026-06-07"
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    // Default times: from=00:00:00, to=23:59:59
    expect(onApply).toHaveBeenCalledWith("2026-06-01T00:00:00", "2026-06-07T23:59:59");
  });

  it("onApply reflects user-edited time inputs", () => {
    const onApply = vi.fn();
    render(
      <DateRangePopover
        from="2026-06-01"
        to="2026-06-07"
        onApply={onApply}
      />,
    );

    const timeInputs = screen.getAllByLabelText(/时间$/);
    // Edit start time to 08:15 and end time to 20:30
    fireEvent.change(timeInputs[0], { target: { value: "08:15" } });
    fireEvent.blur(timeInputs[0]);
    fireEvent.change(timeInputs[1], { target: { value: "20:30" } });
    fireEvent.blur(timeInputs[1]);

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith("2026-06-01T08:15:00", "2026-06-07T20:30:59");
  });

  it("typing a valid date updates the selection and Apply emits the new date", () => {
    const onApply = vi.fn();
    render(
      <DateRangePopover
        from="2026-06-01"
        to="2026-06-07"
        onApply={onApply}
      />,
    );

    const dateInputs = screen.getAllByLabelText(/日期$/);
    // Change start date to 2026/06/03
    fireEvent.change(dateInputs[0], { target: { value: "2026/06/03" } });
    fireEvent.blur(dateInputs[0]);

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith("2026-06-03T00:00:00", "2026-06-07T23:59:59");
  });

  it("typing an invalid date resets the input to the previous value on blur", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);

    const dateInputs = screen.getAllByLabelText(/日期$/);
    // Type an invalid date (Feb 30 rolls over to Mar 2 — should be rejected)
    fireEvent.change(dateInputs[0], { target: { value: "2026/02/30" } });
    fireEvent.blur(dateInputs[0]);
    // Should reset back to the calendar's current value (2026/06/01)
    expect(dateInputs[0]).toHaveValue("2026/06/01");
  });

  it("invalid time input resets to default on blur (start=00:00, end=23:59)", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);

    const timeInputs = screen.getAllByLabelText(/时间$/);
    // Type an invalid time (25:99)
    fireEvent.change(timeInputs[0], { target: { value: "25:99" } });
    fireEvent.blur(timeInputs[0]);
    // Reset to default from time (00:00)
    expect(timeInputs[0]).toHaveValue("00:00");

    // End time invalid → reset to 23:59
    fireEvent.change(timeInputs[1], { target: { value: "99:99" } });
    fireEvent.blur(timeInputs[1]);
    expect(timeInputs[1]).toHaveValue("23:59");
  });

  it("Cancel button invokes onCancel", () => {
    const onCancel = vi.fn();
    render(
      <DateRangePopover
        from="2026-06-01"
        to="2026-06-07"
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the selected range summary when a date is picked", () => {
    render(<DateRangePopover from="2026-06-01" to="2026-06-07" />);
    // The summary span renders "{from} — {to}" with the year in each half.
    // Use a function matcher so the test is robust to locale-specific month
    // formatting (zh-CN renders "2026年6月1日" rather than "Jun 1, 2026").
    const summary = screen.getByText(
      (content, element) =>
        element?.tagName === "SPAN" &&
        content.includes("—") &&
        content.includes("2026"),
    );
    expect(summary).toBeInTheDocument();
  });
});
