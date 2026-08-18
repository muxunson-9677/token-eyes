import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpendRecord,
  deleteOtherAiSpendGroup,
  deleteSpendRecord,
  getSpendRecords,
  reorderOtherAiSpendGroups,
  reorderOtherAiSpendRecords,
  saveOtherAiSpendGroup,
  updateSpendRecord,
} from "../../lib/api";
import { OtherAiSpendSection, resolveNoteTagTone, resolveSpendRecordDrop } from "./OtherAiSpendSection.jsx";
import { clearCostSettingsSessionCache } from "../../lib/cost-settings-session-cache";

vi.mock("../../lib/api", () => ({
  createSpendRecord: vi.fn(),
  deleteOtherAiSpendGroup: vi.fn(),
  deleteSpendRecord: vi.fn(),
  getSpendRecords: vi.fn(),
  reorderOtherAiSpendGroups: vi.fn(),
  reorderOtherAiSpendRecords: vi.fn(),
  saveOtherAiSpendGroup: vi.fn(),
  updateSpendRecord: vi.fn(),
}));

vi.mock("../../lib/copy", () => ({
  copy: (key) => key,
}));

vi.mock("./Controls.jsx", () => ({
  SectionCard: ({ title, subtitle, action, children, collapsible }) => (
    <section>
      <h2>{title}{collapsible ? <span data-testid="collapsible" /> : null}</h2>
      <p>{subtitle}</p>
      {action}
      {children}
    </section>
  ),
}));

const OTHER_AI_RECORD = {
  id: "other-ai-1",
  source: "other_ai",
  plan_label: "被封账号历史充值",
  amount: 72,
  currency: "CNY",
  billing_cycle: "one_time",
  start_date: "2026-07-10",
  note: "账号被封，余额无法退回",
};

describe("OtherAiSpendSection", () => {
  beforeEach(() => {
    clearCostSettingsSessionCache();
    vi.clearAllMocks();
    [
      createSpendRecord,
      deleteOtherAiSpendGroup,
      deleteSpendRecord,
      getSpendRecords,
      reorderOtherAiSpendGroups,
      reorderOtherAiSpendRecords,
      saveOtherAiSpendGroup,
      updateSpendRecord,
    ].forEach((mock) => mock.mockReset());
    getSpendRecords.mockResolvedValue({ records: [] });
    createSpendRecord.mockResolvedValue({ ok: true });
    updateSpendRecord.mockResolvedValue({ ok: true });
    deleteSpendRecord.mockResolvedValue({ ok: true });
    deleteOtherAiSpendGroup.mockResolvedValue({ ok: true });
    reorderOtherAiSpendGroups.mockResolvedValue({ ok: true });
    reorderOtherAiSpendRecords.mockResolvedValue({ ok: true });
    saveOtherAiSpendGroup.mockResolvedValue({ ok: true });
  });

  it("reuses confirmed spend records when the cost page is entered again", async () => {
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD], other_ai_groups: [] });
    const first = render(<OtherAiSpendSection />);
    expect(await screen.findByText("被封账号历史充值")).toBeInTheDocument();
    first.unmount();

    render(React.createElement(OtherAiSpendSection));
    expect(screen.getByText("被封账号历史充值")).toBeInTheDocument();
    expect(getSpendRecords).toHaveBeenCalledTimes(1);
  });

  it("loads only the reserved other_ai source and renders saved notes", async () => {
    getSpendRecords.mockResolvedValue({
      records: [OTHER_AI_RECORD, { ...OTHER_AI_RECORD, id: "wrong", source: "claude" }],
    });

    render(<OtherAiSpendSection />);

    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());
    expect(getSpendRecords.mock.calls[0][0]).toEqual(expect.objectContaining({
      from: "2000-01-01",
      sources: ["other_ai"],
    }));
    expect(await screen.findByText("被封账号历史充值")).toBeInTheDocument();
    expect(screen.getByText("账号被封，余额无法退回")).toBeInTheDocument();
    expect(screen.queryByText("wrong")).not.toBeInTheDocument();
  });

  it("places colored note tags under the spend name", async () => {
    getSpendRecords.mockResolvedValue({
      records: [
        { ...OTHER_AI_RECORD, id: "n1", plan_label: "EqualVPN", note: "静态 US-账号 IP", group_id: "vpn" },
        { ...OTHER_AI_RECORD, id: "n2", plan_label: "DeepSeek", note: "动态不固定 - 广州 IP", group_id: "vpn" },
        { ...OTHER_AI_RECORD, id: "n3", plan_label: "API", note: "API 调用", group_id: "vpn" },
      ],
      other_ai_groups: [{ id: "vpn", name: "VPN", parent_id: "" }],
    });

    render(<OtherAiSpendSection />);

    const noteA = await screen.findByText("静态 US-账号 IP");
    const noteB = screen.getByText("动态不固定 - 广州 IP");
    const noteC = screen.getByText("API 调用");
    expect(noteA).toHaveClass("tt-other-ai-row-note");
    expect(noteA).toHaveAttribute("data-tone", resolveNoteTagTone("静态 US-账号 IP"));
    expect(noteB).toHaveAttribute("data-tone", resolveNoteTagTone("动态不固定 - 广州 IP"));
    expect(noteC).toHaveAttribute("data-tone", resolveNoteTagTone("API 调用"));
    expect(new Set([noteA, noteB, noteC].map((node) => node.getAttribute("data-tone"))).size).toBeGreaterThan(1);
    const main = noteA.closest(".tt-other-ai-row-main");
    expect(main).toBeTruthy();
    expect(main).toHaveClass("tt-pressable", "tt-product-focusable");
    expect(main.querySelector(".tt-other-ai-row-title")).toHaveTextContent("EqualVPN");
    expect(main.querySelector(".tt-other-ai-row-primary")).toBeTruthy();
    expect(noteA.compareDocumentPosition(main.querySelector(".tt-other-ai-row-title")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("maps empty notes to muted tone and distinct remarks to stable tones", () => {
    expect(resolveNoteTagTone("")).toBe("muted");
    expect(resolveNoteTagTone("静态 US-账号 IP")).toBe(resolveNoteTagTone("静态 US-账号 IP"));
    expect(resolveNoteTagTone("静态 US-账号 IP")).not.toBe(resolveNoteTagTone("动态不固定 - 广州 IP"));
  });

  it("creates a one-time other_ai charge with amount, currency, date, and note", async () => {
    render(<OtherAiSpendSection />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.add" }));
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.name_label"), {
      target: { value: "历史充值损失" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.amount_label"), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.currency_label"), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.date_label"), {
      target: { value: "2026-07-12" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.note_label"), {
      target: { value: "旧账号已封禁" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));
    });

    await waitFor(() => expect(createSpendRecord).toHaveBeenCalledTimes(1));
    expect(createSpendRecord).toHaveBeenCalledWith({
      source: "other_ai",
      plan_label: "历史充值损失",
      amount: 120,
      currency: "USD",
      billing_cycle: "one_time",
      start_date: "2026-07-12",
      note: "旧账号已封禁",
    });
    expect(updateSpendRecord).not.toHaveBeenCalled();
  });

  it("requires name, positive amount, and spend date before saving", async () => {
    render(<OtherAiSpendSection />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.add" }));
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.name_label"), {
      target: { value: "历史充值" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.amount_label"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.date_label"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));

    expect(await screen.findByText("settings.cost.other_ai.error_required")).toBeInTheDocument();
    expect(createSpendRecord).not.toHaveBeenCalled();
  });

  it("edits an existing record without changing its reserved accounting type", async () => {
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD] });
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.edit" }));
    const nameInput = screen.getByLabelText("settings.cost.other_ai.name_label");
    fireEvent.change(nameInput, { target: { value: "修正后的充值记录" } });
    const amountInput = screen.getByLabelText("settings.cost.other_ai.amount_label");
    fireEvent.change(amountInput, { target: { value: "144" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));
    });

    await waitFor(() => expect(updateSpendRecord).toHaveBeenCalledTimes(1));
    expect(updateSpendRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: "other-ai-1",
      source: "other_ai",
      plan_label: "修正后的充值记录",
      amount: 144,
      billing_cycle: "one_time",
    }));
    expect(createSpendRecord).not.toHaveBeenCalled();
  });

  it("renders the editor directly below the record that was clicked", async () => {
    getSpendRecords.mockResolvedValue({
      records: [
        OTHER_AI_RECORD,
        { ...OTHER_AI_RECORD, id: "other-ai-2", plan_label: "第二条花销" },
      ],
    });
    render(<OtherAiSpendSection />);

    const editButtons = await screen.findAllByRole("button", { name: "settings.cost.other_ai.edit" });
    fireEvent.click(editButtons[1]);

    const secondRow = screen.getByText("第二条花销").closest("li");
    const editor = screen.getByLabelText("settings.cost.other_ai.name_label").closest("form");
    expect(secondRow).not.toBeNull();
    expect(editor).not.toBeNull();
    expect(secondRow.contains(editor)).toBe(true);
  });

  it("renders two-level groups with independent disclosure controls", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [
        { id: "learning", name: "AI 学习", parent_id: "", sort_order: 0 },
        { id: "courses", name: "课程", parent_id: "learning", sort_order: 0 },
      ],
      records: [{ ...OTHER_AI_RECORD, group_id: "courses" }],
    });
    render(<OtherAiSpendSection />);

    expect(await screen.findByText("AI 学习")).toBeInTheDocument();
    expect(screen.getByText("课程")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.other_ai.collapse_group AI 学习" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "settings.cost.other_ai.collapse_group 课程" })).toHaveAttribute("aria-expanded", "true");
  });

  it("resolves a drag onto a group as an in-group move", () => {
    const records = [
      { ...OTHER_AI_RECORD, id: "one", group_id: "" },
      { ...OTHER_AI_RECORD, id: "two", group_id: "learning" },
    ];
    const result = resolveSpendRecordDrop(records, "one", "group:learning");

    expect(result.groupId).toBe("learning");
    expect(result.records.map((record) => record.id)).toEqual(["two", "one"]);
    expect(result.records.find((record) => record.id === "one").group_id).toBe("learning");
  });

  it("lets a new group choose an existing root as its parent", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [{ id: "learning", name: "AI learning", parent_id: "", sort_order: 0 }],
      records: [],
    });
    saveOtherAiSpendGroup.mockResolvedValue({
      ok: true,
      group: { id: "courses", name: "Courses", parent_id: "learning", sort_order: 1 },
    });
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.add_group" }));
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.group_name"), { target: { value: "Courses" } });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.parent_group"), { target: { value: "learning" } });
    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save_group" }));

    await waitFor(() => expect(saveOtherAiSpendGroup).toHaveBeenCalledWith({ name: "Courses", parent_id: "learning" }));
  });

  it("creates a child group directly from its root group header", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [{ id: "learning", name: "AI learning", parent_id: "", sort_order: 0 }],
      records: [{ ...OTHER_AI_RECORD, group_id: "learning" }],
    });
    saveOtherAiSpendGroup.mockResolvedValue({
      ok: true,
      group: { id: "courses", name: "Courses", parent_id: "learning", sort_order: 0 },
    });
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.add_subgroup AI learning" }));
    const root = screen.getByTestId("other-ai-group-learning");
    expect(within(root).getByLabelText("settings.cost.other_ai.parent_group")).toHaveValue("learning");
    fireEvent.change(within(root).getByLabelText("settings.cost.other_ai.group_name"), { target: { value: "Courses" } });
    fireEvent.click(within(root).getByRole("button", { name: "settings.cost.other_ai.save_group" }));

    await waitFor(() => expect(saveOtherAiSpendGroup).toHaveBeenCalledWith({ name: "Courses", parent_id: "learning" }));
  });

  it("keeps an empty root group visible so its child-group editor opens in place", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [{ id: "learning", name: "AI learning", parent_id: "", sort_order: 0 }],
      records: [],
    });
    render(<OtherAiSpendSection />);

    const root = await screen.findByTestId("other-ai-group-learning");
    fireEvent.click(within(root).getByRole("button", { name: "settings.cost.other_ai.add_subgroup AI learning" }));

    expect(within(root).getByLabelText("settings.cost.other_ai.group_name")).toBeInTheDocument();
    expect(within(root).getByLabelText("settings.cost.other_ai.parent_group")).toHaveValue("learning");
  });

  it("lets a child group create its own child group in place", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [
        { id: "learning", name: "AI learning", parent_id: "", sort_order: 0 },
        { id: "courses", name: "Courses", parent_id: "learning", sort_order: 0 },
      ],
      records: [{ ...OTHER_AI_RECORD, group_id: "courses" }],
    });
    render(<OtherAiSpendSection />);

    const child = await screen.findByTestId("other-ai-group-courses");
    fireEvent.click(within(child).getByRole("button", { name: "settings.cost.other_ai.add_subgroup Courses" }));

    expect(within(child).getByLabelText("settings.cost.other_ai.parent_group")).toHaveValue("courses");
  });

  it("lets a child group be renamed and favorited in place", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [
        { id: "learning", name: "AI learning", parent_id: "", sort_order: 0 },
        { id: "courses", name: "Courses", parent_id: "learning", sort_order: 0, favorite: false },
      ],
      records: [{ ...OTHER_AI_RECORD, group_id: "courses" }],
    });
    saveOtherAiSpendGroup.mockImplementation(async (payload) => ({ ok: true, group: { ...payload, parent_id: "learning" } }));
    render(<OtherAiSpendSection />);

    const child = await screen.findByTestId("other-ai-group-courses");
    fireEvent.click(within(child).getByRole("button", { name: "settings.cost.other_ai.favorite_group Courses" }));
    await waitFor(() => expect(saveOtherAiSpendGroup).toHaveBeenCalledWith(expect.objectContaining({ id: "courses", favorite: true })));

    fireEvent.click(within(child).getByRole("button", { name: "settings.cost.other_ai.edit_group Courses" }));
    fireEvent.change(within(child).getByLabelText("settings.cost.other_ai.group_name"), { target: { value: "Advanced courses" } });
    fireEvent.click(within(child).getByRole("button", { name: "settings.cost.other_ai.save_group" }));
    await waitFor(() => expect(saveOtherAiSpendGroup).toHaveBeenCalledWith(expect.objectContaining({ id: "courses", name: "Advanced courses" })));
  });

  it("deletes a confirmed record and reloads the list", async () => {
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OtherAiSpendSection />);

    const deleteButton = await screen.findByRole("button", { name: "settings.cost.other_ai.delete" });
    fireEvent.click(deleteButton);

    await waitFor(() => expect(deleteSpendRecord).toHaveBeenCalledWith("other-ai-1"));
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalledTimes(2));
    confirmSpy.mockRestore();
  });

  it("shows a real error when deletion fails instead of pretending the record disappeared", async () => {
    getSpendRecords.mockResolvedValue({ records: [OTHER_AI_RECORD] });
    deleteSpendRecord.mockResolvedValue({ ok: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OtherAiSpendSection />);

    const deleteButton = await screen.findByRole("button", { name: "settings.cost.other_ai.delete" });
    fireEvent.click(deleteButton);

    expect(await screen.findByText("settings.cost.other_ai.error_delete")).toBeInTheDocument();
    expect(getSpendRecords).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("keeps the confirmed local state and shows an error when a refresh fails", async () => {
    getSpendRecords
      .mockResolvedValueOnce({ records: [OTHER_AI_RECORD] })
      .mockRejectedValueOnce(new Error("offline"));
    deleteSpendRecord.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.delete" }));

    expect(await screen.findByText("settings.cost.other_ai.error_load")).toBeInTheDocument();
    expect(screen.queryByText("settings.cost.other_ai.empty")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("keeps the saved record visible when the post-save refresh fails", async () => {
    getSpendRecords
      .mockResolvedValueOnce({ records: [OTHER_AI_RECORD] })
      .mockRejectedValueOnce(new Error("offline"));
    createSpendRecord.mockResolvedValue({
      ok: true,
      record: {
        ...OTHER_AI_RECORD,
        id: "other-ai-2",
        plan_label: "新充值",
        amount: 100,
      },
    });
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.add" }));
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.name_label"), {
      target: { value: "新充值" },
    });
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.amount_label"), {
      target: { value: "100" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save" }));
    });

    expect(await screen.findByText("新充值")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.other_ai.error_load")).toBeInTheDocument();
  });

  it("is a collapsible first-level section and renders numbered grouped rows", async () => {
    getSpendRecords.mockResolvedValue({
      other_ai_groups: [{ id: "learning", name: "AI learning", sort_order: 0 }],
      records: [
        { ...OTHER_AI_RECORD, id: "row-1", group_id: "learning", favorite: true },
        { ...OTHER_AI_RECORD, id: "row-2", plan_label: "Second", group_id: "learning", favorite: false },
      ],
    });
    render(<OtherAiSpendSection />);

    expect(await screen.findByText("AI learning")).toBeInTheDocument();
    expect(screen.getByTestId("collapsible")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "settings.cost.other_ai.unfavorite" })).toBeInTheDocument();
  });

  it("creates a custom group and can assign a charge to it", async () => {
    saveOtherAiSpendGroup.mockResolvedValue({
      ok: true,
      group: { id: "learning", name: "AI learning", sort_order: 0 },
    });
    render(<OtherAiSpendSection />);
    await waitFor(() => expect(getSpendRecords).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.add_group" }));
    fireEvent.change(screen.getByLabelText("settings.cost.other_ai.group_name"), {
      target: { value: "AI learning" },
    });
    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.save_group" }));
    await waitFor(() => expect(saveOtherAiSpendGroup).toHaveBeenCalledWith({ name: "AI learning" }));

    fireEvent.click(screen.getByRole("button", { name: "settings.cost.other_ai.add" }));
    expect(screen.getByLabelText("settings.cost.other_ai.group_label")).toBeInTheDocument();
  });

  it("toggles the favorite flag without changing the accounting fields", async () => {
    getSpendRecords.mockResolvedValue({ records: [{ ...OTHER_AI_RECORD, favorite: false }] });
    updateSpendRecord.mockResolvedValue({ ok: true, record: { ...OTHER_AI_RECORD, favorite: true } });
    render(<OtherAiSpendSection />);

    fireEvent.click(await screen.findByRole("button", { name: "settings.cost.other_ai.favorite" }));
    await waitFor(() => expect(updateSpendRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: OTHER_AI_RECORD.id,
      favorite: true,
      source: "other_ai",
      amount: OTHER_AI_RECORD.amount,
    })));
  });
});
