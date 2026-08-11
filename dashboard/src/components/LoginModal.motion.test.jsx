import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal.jsx";
import { copy } from "../lib/copy";

const motionFixture = vi.hoisted(() => ({
  reduced: true,
}));

vi.mock("motion/react", async () => {
  const ReactModule = await import("react");
  const MotionDiv = ReactModule.forwardRef(function MotionDiv(
    { initial, animate, exit, transition, children, ...props },
    ref,
  ) {
    return ReactModule.createElement(
      "div",
      {
        ...props,
        ref,
        "data-motion-initial": JSON.stringify(initial ?? null),
        "data-motion-animate": JSON.stringify(animate ?? null),
        "data-motion-exit": JSON.stringify(exit ?? null),
        "data-motion-transition": JSON.stringify(transition ?? null),
      },
      children,
    );
  });

  return {
    AnimatePresence: ({ children }) => children,
    motion: { div: MotionDiv },
    useReducedMotion: () => motionFixture.reduced,
  };
});

vi.mock("./LoginCard.jsx", () => ({
  LoginCard: () => <div data-testid="login-card" />,
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({ enabled: true }),
}));

vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({
    isOpen: true,
    options: { emailOnly: true },
    closeLoginModal: vi.fn(),
  }),
}));

function motionState(element, attribute) {
  return JSON.parse(element.getAttribute(`data-motion-${attribute}`));
}

function getMotionLayers() {
  const card = screen.getByRole("dialog", { name: copy("login.title") });
  const outer = card.parentElement;
  const backdrop = outer.querySelector(".tt-modal-backdrop");
  return { outer, backdrop, card };
}

it("removes JavaScript timing and transforms from every modal layer under reduced motion", () => {
  motionFixture.reduced = true;
  render(<LoginModal />);

  const layers = getMotionLayers();
  for (const layer of Object.values(layers)) {
    expect(motionState(layer, "transition")).toEqual({ duration: 0 });
    expect(motionState(layer, "initial")).not.toHaveProperty("scale");
    expect(motionState(layer, "initial")).not.toHaveProperty("y");
    expect(motionState(layer, "exit")).not.toHaveProperty("scale");
    expect(motionState(layer, "exit")).not.toHaveProperty("y");
  }
});

it("keeps the normal 0.2 second modal timing and card transform", () => {
  motionFixture.reduced = false;
  render(<LoginModal />);

  const layers = getMotionLayers();
  for (const layer of Object.values(layers)) {
    expect(motionState(layer, "transition")).toEqual({ duration: 0.2 });
  }
  expect(motionState(layers.card, "initial")).toMatchObject({
    opacity: 0,
    scale: 0.95,
    y: 10,
  });
  expect(motionState(layers.card, "exit")).toMatchObject({
    opacity: 0,
    scale: 0.95,
    y: 10,
  });
});
