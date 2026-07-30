import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal";

it("keeps destructive confirmation keyboard-safe above a restrained glass overlay", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();

  render(
    <ConfirmModal
      open
      title="Remove skill"
      description="This action cannot be undone."
      confirmLabel="Remove"
      cancelLabel="Cancel"
      destructive
      onCancel={onCancel}
      onConfirm={() => {}}
    />,
  );

  const dialog = await screen.findByRole("dialog", { name: "Remove skill" });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  const confirm = screen.getByRole("button", { name: "Remove" });
  expect(dialog).toHaveClass("tt-surface", "tt-modal-popup");
  expect(document.querySelector(".tt-modal-backdrop")).not.toBeNull();
  expect(confirm).toHaveClass("!bg-red-600", "tt-product-focusable");

  await waitFor(() => expect(cancel).toHaveFocus());
  await user.tab();
  expect(confirm).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});
