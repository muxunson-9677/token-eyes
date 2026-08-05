import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CostAnalysisModal } from "../CostAnalysisModal.jsx";

it("invokes onClose when clicking the backdrop", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const { container } = render(
    <CostAnalysisModal isOpen={true} onClose={onClose} fleetData={[]} />,
  );

  const backdropSelector = '[data-cost-analysis-backdrop="true"]';
  const backdrop = document.querySelector(backdropSelector) ?? container.firstElementChild;

  if (!backdrop) {
    throw new Error(`Expected backdrop element (${backdropSelector}) to exist.`);
  }

  await act(async () => {
    await user.click(backdrop);
  });

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not invent a zero total when no spend data was provided", () => {
  render(
    <CostAnalysisModal isOpen={true} onClose={() => {}} fleetData={[]} />,
  );

  expect(document.body).not.toHaveTextContent("$0.00");
  expect(document.body).not.toHaveTextContent("—");
});

it("renders a real zero cost when usage data explicitly provides it", () => {
  render(
    <CostAnalysisModal
      isOpen={true}
      onClose={() => {}}
      fleetData={[{
        label: "CODEX",
        usd: 0,
        usage: 10,
        models: [{ id: "gpt", name: "GPT", usage: 10, cost: 0 }],
      }]}
    />,
  );

  expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(2);
});
