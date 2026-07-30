import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal.jsx";
import { copy } from "../lib/copy";

const modalFixture = vi.hoisted(() => ({
  options: { emailOnly: true },
  close: vi.fn(),
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({ enabled: true }),
}));

vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({
    isOpen: true,
    closeLoginModal: modalFixture.close,
    options: modalFixture.options,
  }),
}));

vi.mock("./LoginCard.jsx", () => ({
  LoginCard: ({ emailOnly }) => <div data-testid="login-card" data-email-only={String(Boolean(emailOnly))} />,
}));

beforeEach(() => {
  modalFixture.close.mockReset();
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

it("renders voluntary leaderboard login inside the local Tauri desktop app", () => {
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke: vi.fn() } },
  });

  render(<LoginModal />);

  expect(screen.getByTestId("login-card")).toBeInTheDocument();
  expect(screen.getByTestId("login-card")).toHaveAttribute("data-email-only", "true");
});

it("discloses automatic leaderboard participation and the upload boundary", () => {
  render(<LoginModal />);

  expect(screen.getByText(copy("login_modal.leaderboard_participation"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.upload_boundary"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.delete_participation"))).toBeInTheDocument();
});

it("keeps keyboard focus inside a layered glass dialog and dismisses on Escape", async () => {
  const user = userEvent.setup();
  render(<LoginModal />);

  const dialog = screen.getByRole("dialog", { name: copy("login.title") });
  const close = screen.getByRole("button", { name: copy("login.dismiss") });
  expect(dialog).toHaveClass("tt-surface", "tt-modal-popup");
  expect(document.querySelector(".tt-modal-backdrop")).not.toBeNull();
  expect(close).toHaveClass("tt-product-focusable");

  await waitFor(() => expect(close).toHaveFocus());
  await user.tab();
  expect(close).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(modalFixture.close).toHaveBeenCalledTimes(1);
});
