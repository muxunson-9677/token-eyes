import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal.jsx";
import { copy } from "../lib/copy";

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({ enabled: true }),
}));

vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ isOpen: true, closeLoginModal: vi.fn() }),
}));

vi.mock("./LoginCard.jsx", () => ({
  LoginCard: () => <div data-testid="login-card" />,
}));

beforeEach(() => {
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
});

it("discloses automatic leaderboard participation and the upload boundary", () => {
  render(<LoginModal />);

  expect(screen.getByText(copy("login_modal.leaderboard_participation"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.upload_boundary"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.delete_participation"))).toBeInTheDocument();
});
