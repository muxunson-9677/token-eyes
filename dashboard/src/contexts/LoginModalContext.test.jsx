import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { LoginModalProvider, useLoginModal } from "./LoginModalContext.jsx";

function Probe() {
  const { isOpen, openLoginModal, closeLoginModal, options } = useLoginModal();
  return (
    <div>
      <output data-testid="modal-state">{`${isOpen}:${Boolean(options?.emailOnly)}:${Boolean(options?.leaderboardParticipation)}`}</output>
      <button data-testid="open-email" onClick={() => openLoginModal({ emailOnly: true, leaderboardParticipation: true })} />
      <button data-testid="close" onClick={closeLoginModal} />
      <button data-testid="open-default" onClick={() => openLoginModal()} />
    </div>
  );
}

it("stores email-only options for one opening and resets them on close", async () => {
  const user = userEvent.setup();
  render(<LoginModalProvider><Probe /></LoginModalProvider>);

  expect(screen.getByTestId("modal-state")).toHaveTextContent("false:false:false");
  await user.click(screen.getByTestId("open-email"));
  expect(screen.getByTestId("modal-state")).toHaveTextContent("true:true:true");
  await user.click(screen.getByTestId("close"));
  await user.click(screen.getByTestId("open-default"));
  expect(screen.getByTestId("modal-state")).toHaveTextContent("true:false:false");
});
