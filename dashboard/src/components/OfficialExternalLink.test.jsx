import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const OPEN_THE_RANK_LINK_ID = "third-party-opentherank-ai-pricing";
const OPEN_THE_RANK_LABEL = "第三方比价（非官方）";
const OPEN_COMPARISON_LABEL = "Open comparison";
const UNSAFE_LABEL = "Unsafe";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

it("renders a registered browser fallback as a real accessible safe anchor", async () => {
  const { OfficialExternalLink } = await import("./OfficialExternalLink.jsx");

  render(
    <OfficialExternalLink linkId={OPEN_THE_RANK_LINK_ID}>
      {OPEN_THE_RANK_LABEL}
    </OfficialExternalLink>,
  );

  const link = screen.getByRole("link", { name: OPEN_THE_RANK_LABEL });
  expect(link).toHaveAttribute("href", "https://opentherank.com/zh/ai-pricing/");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link).toHaveAttribute("data-provider-link-id", OPEN_THE_RANK_LINK_ID);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);
});

it("sends only link_id to the Tauri system opener on mouse activation", async () => {
  const invoke = vi.fn().mockResolvedValue(true);
  window.__TAURI__ = { core: { invoke } };
  const { OfficialExternalLink } = await import("./OfficialExternalLink.jsx");
  render(<OfficialExternalLink linkId={OPEN_THE_RANK_LINK_ID}>{OPEN_COMPARISON_LABEL}</OfficialExternalLink>);

  fireEvent.click(screen.getByRole("link", { name: OPEN_COMPARISON_LABEL }));

  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_external_link", {
    linkId: OPEN_THE_RANK_LINK_ID,
  }));
  expect(invoke.mock.calls[0][1]).not.toHaveProperty("url");
});

it("uses the same safe Tauri opener for keyboard activation", async () => {
  const invoke = vi.fn().mockResolvedValue(true);
  window.__TAURI__ = { core: { invoke } };
  const user = userEvent.setup();
  const { OfficialExternalLink } = await import("./OfficialExternalLink.jsx");
  render(<OfficialExternalLink linkId={OPEN_THE_RANK_LINK_ID}>{OPEN_COMPARISON_LABEL}</OfficialExternalLink>);

  const link = screen.getByRole("link", { name: OPEN_COMPARISON_LABEL });
  link.focus();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_external_link", {
    linkId: OPEN_THE_RANK_LINK_ID,
  }));
});

it("uses the link_id opener when Tauri exposes only its internal invoke bridge", async () => {
  const invoke = vi.fn().mockResolvedValue(true);
  window.__TAURI_INTERNALS__ = { invoke };
  const { OfficialExternalLink } = await import("./OfficialExternalLink.jsx");
  render(<OfficialExternalLink linkId={OPEN_THE_RANK_LINK_ID}>{OPEN_COMPARISON_LABEL}</OfficialExternalLink>);

  fireEvent.click(screen.getByRole("link", { name: OPEN_COMPARISON_LABEL }));

  await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_external_link", {
    linkId: OPEN_THE_RANK_LINK_ID,
  }));
});

it("fails closed without rendering an arbitrary URL for an unknown link_id", async () => {
  const { OfficialExternalLink } = await import("./OfficialExternalLink.jsx");
  render(<OfficialExternalLink linkId="https://evil.example/secret">{UNSAFE_LABEL}</OfficialExternalLink>);

  expect(screen.queryByRole("link", { name: UNSAFE_LABEL })).not.toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain("evil.example");
});
