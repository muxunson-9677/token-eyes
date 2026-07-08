import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MacAppBanner } from "../MacAppBanner.jsx";

vi.mock("../../../../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));

vi.mock("../../../../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({ signedIn: false }),
}));

vi.mock("../../../../hooks/useClawdState.js", () => ({
  useClawdState: () => "idle",
}));

vi.mock("../../../foundation/ClawdAnimated.jsx", () => ({
  ClawdAnimated: () => <div data-testid="clawd" />,
}));

describe("MacAppBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("does not render the download CTA outside the native app shell", () => {
    render(<MacAppBanner />);

    expect(screen.queryByText("Try the Menu Bar App")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download/i })).not.toBeInTheDocument();
  });
});
