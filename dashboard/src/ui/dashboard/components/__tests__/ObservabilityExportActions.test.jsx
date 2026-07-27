import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ObservabilityExportActions } from "../ObservabilityExportActions.jsx";
import { getObservabilityExport } from "../../../../lib/api";

vi.mock("../../../../lib/api", () => ({
  getObservabilityExport: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getObservabilityExport.mockResolvedValue({ format: "csv", content: "source,total_tokens\\ncodex,42\\n" });
  URL.createObjectURL = vi.fn(() => "blob:observability-export");
  URL.revokeObjectURL = vi.fn();
});

it("downloads the server-redacted CSV export without rendering its content", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ObservabilityExportActions />);

  fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));

  await waitFor(() => expect(getObservabilityExport).toHaveBeenCalledWith({ format: "csv" }));
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalled();
  expect(screen.queryByText("source,total_tokens")).not.toBeInTheDocument();
});
