import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal.jsx";

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

it("does not render the cloud login modal inside the local Tauri desktop app", () => {
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke: vi.fn() } },
  });

  render(<LoginModal />);

  expect(screen.queryByTestId("login-card")).not.toBeInTheDocument();
});
