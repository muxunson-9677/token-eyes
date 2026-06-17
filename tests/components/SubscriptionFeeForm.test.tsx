import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { SubscriptionFeeForm } from "@/components/usage/SubscriptionFeeForm";
import type { SubscriptionFee } from "@/types/subscriptionFees";

// --- Mocks ---

const mockMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();

vi.mock("@/lib/query/subscriptionFees", () => ({
  useSubscriptionFeeList: () => ({ data: mockFees, isLoading: false }),
  useCreateSubscriptionFee: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useUpdateSubscriptionFee: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
  useDeleteSubscriptionFee: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-delete" onClick={onConfirm}>
          confirm
        </button>
        <button data-testid="cancel-delete" onClick={onCancel}>
          cancel
        </button>
      </div>
    ) : null,
}));

// --- Data ---

const mockFees: SubscriptionFee[] = [
  {
    id: 1,
    agentType: "claude",
    planLabel: "Pro",
    monthlyFee: "20.00",
    currency: "USD",
    billingDay: 15,
    effectiveFrom: 1700000000, // 2023-11-14
    effectiveTo: null,
    note: null,
  },
  {
    id: 2,
    agentType: "codex",
    planLabel: "Plus",
    monthlyFee: "10.50",
    currency: "USD",
    billingDay: 1,
    effectiveFrom: 1700000000,
    effectiveTo: 1730000000,
    note: "test note",
  },
];

// --- Helpers ---

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWithProviders(ui: ReactElement) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );
}

// The add button is the small outline button with Plus icon in the header
function getAddButton() {
  return screen.getByRole("button", { name: /新增/ });
}

// --- Tests ---

describe("SubscriptionFeeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockDeleteMutateAsync.mockResolvedValue(undefined);
  });

  it("renders the fee list", () => {
    renderWithProviders(<SubscriptionFeeForm />);
    // List items show "{agentType} — {planLabel}"
    expect(screen.getByText(/claude — Pro/)).toBeTruthy();
    expect(screen.getByText(/codex — Plus/)).toBeTruthy();
  });

  it("shows form when Add is clicked", () => {
    renderWithProviders(<SubscriptionFeeForm />);
    fireEvent.click(getAddButton());
    expect(screen.getByLabelText(/Agent 类型/)).toBeTruthy();
  });

  it("rejects empty required fields", async () => {
    renderWithProviders(<SubscriptionFeeForm />);
    fireEvent.click(getAddButton());

    // Submit form with empty planLabel
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  it("rejects invalid monthlyFee format", async () => {
    renderWithProviders(<SubscriptionFeeForm />);
    fireEvent.click(getAddButton());

    fireEvent.change(screen.getByLabelText(/套餐名称/), {
      target: { value: "Test Plan" },
    });
    fireEvent.change(screen.getByLabelText(/月费/), {
      target: { value: "abc" },
    });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  it("submits correct payload with date converted to Unix seconds", async () => {
    renderWithProviders(<SubscriptionFeeForm />);
    fireEvent.click(getAddButton());

    fireEvent.change(screen.getByLabelText(/套餐名称/), {
      target: { value: "My Plan" },
    });
    fireEvent.change(screen.getByLabelText(/月费/), {
      target: { value: "25.50" },
    });
    fireEvent.change(screen.getByLabelText(/账单日/), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText(/生效日期/), {
      target: { value: "2024-06-01" },
    });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsync.mock.calls[0][0];
    expect(payload.planLabel).toBe("My Plan");
    expect(payload.monthlyFee).toBe("25.50");
    expect(payload.billingDay).toBe(15);
    expect(payload.effectiveFrom).toBe(
      Math.floor(new Date("2024-06-01T00:00:00Z").getTime() / 1000),
    );
    expect(payload.effectiveTo).toBeNull();
    expect(payload.currency).toBe("USD");
  });

  it("converts effectiveToDate to Unix seconds when provided", async () => {
    renderWithProviders(<SubscriptionFeeForm />);
    fireEvent.click(getAddButton());

    fireEvent.change(screen.getByLabelText(/套餐名称/), {
      target: { value: "Plan" },
    });
    fireEvent.change(screen.getByLabelText(/月费/), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText(/生效日期/), {
      target: { value: "2024-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/失效日期/), {
      target: { value: "2024-12-31" },
    });

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsync.mock.calls[0][0];
    expect(payload.effectiveTo).toBe(
      Math.floor(new Date("2024-12-31T00:00:00Z").getTime() / 1000),
    );
  });

  it("calls delete_subscription_fee when deleting", async () => {
    renderWithProviders(<SubscriptionFeeForm />);

    // Find all icon buttons (edit + delete per row + header add button)
    const iconButtons = screen.getAllByRole("button").filter((btn) => {
      return btn.querySelector("svg") !== null;
    });
    // iconButtons[0] = add button (Plus icon), iconButtons[1] = edit for row 1, iconButtons[2] = delete for row 1
    fireEvent.click(iconButtons[2]);

    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("confirm-delete"));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(1);
    });
  });
});
