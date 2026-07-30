import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { beforeEach, expect, it, vi } from "vitest";
import { LoginModal } from "./LoginModal.jsx";
import {
  LoginModalProvider,
  useLoginModal,
} from "../contexts/LoginModalContext.jsx";
import { copy } from "../lib/copy";

const authFixture = vi.hoisted(() => ({
  enabled: true,
  signedIn: false,
  refreshUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  sendResetPasswordEmail: vi.fn(),
  exchangeResetPasswordToken: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => authFixture,
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ locale: "en" }),
}));

function LoginModalHarness() {
  const { openLoginModal } = useLoginModal();

  return (
    <>
      <button type="button" onClick={() => openLoginModal({ emailOnly: true })}>
        Open login
      </button>
      <LoginModal />
    </>
  );
}

function renderLoginModal() {
  return render(
    <LoginModalProvider>
      <LoginModalHarness />
    </LoginModalProvider>,
  );
}

async function openLoginModal(user) {
  renderLoginModal();
  const opener = screen.getByRole("button", { name: "Open login" });
  await user.click(opener);
  const dialog = await screen.findByRole("dialog", { name: copy("login.title") });
  return { dialog, opener };
}

beforeEach(() => {
  authFixture.signedIn = false;
  authFixture.refreshUser.mockReset().mockResolvedValue(undefined);
  authFixture.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.signUp.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.verifyEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.resendVerificationEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.signInWithOAuth.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.getPublicAuthConfig.mockReset().mockResolvedValue({
    data: {
      oAuthProviders: [],
      customOAuthProviders: [],
      passwordMinLength: 8,
      verifyEmailMethod: "link",
    },
    error: null,
  });
  authFixture.sendResetPasswordEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.exchangeResetPasswordToken.mockReset().mockResolvedValue({ data: {}, error: null });
  authFixture.resetPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  Reflect.deleteProperty(window, "__TAURI__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

it("renders voluntary email-only leaderboard login inside the local Tauri desktop app", async () => {
  const user = userEvent.setup();
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { core: { invoke: vi.fn() } },
  });
  await openLoginModal(user);

  expect(await screen.findByLabelText(copy("login.field.email"))).toBeInTheDocument();
  expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
  expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument();
});

it("discloses automatic leaderboard participation and the upload boundary", async () => {
  const user = userEvent.setup();
  await openLoginModal(user);

  expect(screen.getByText(copy("login_modal.leaderboard_participation"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.upload_boundary"))).toBeInTheDocument();
  expect(screen.getByText(copy("login_modal.delete_participation"))).toBeInTheDocument();
});

it("keeps the real email login controls inside the scoped keyboard loop and restores the opener", async () => {
  const user = userEvent.setup();
  const { dialog, opener } = await openLoginModal(user);
  const close = within(dialog).getByRole("button", { name: copy("login.dismiss") });
  const signInTab = within(dialog).getByRole("button", { name: copy("login.tab.sign_in") });
  const signUpTab = within(dialog).getByRole("button", { name: copy("login.tab.sign_up") });
  const email = within(dialog).getByRole("textbox", { name: copy("login.field.email") });
  const password = within(dialog).getByLabelText(copy("login.field.password"));
  const forgotPassword = within(dialog).getByRole("button", {
    name: copy("login.forgot_password"),
  });
  const submit = within(dialog).getByRole("button", { name: copy("login.submit.sign_in") });
  const focusTargets = [
    close,
    signInTab,
    signUpTab,
    email,
    password,
    forgotPassword,
    submit,
  ];

  expect(dialog).toHaveClass("tt-surface", "tt-modal-popup", "tt-login-focus-scope");
  expect(within(dialog).getAllByRole("button")).toHaveLength(5);
  expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
  expect(password).toHaveAttribute("type", "password");
  expect(focusTargets).toHaveLength(7);

  await waitFor(() => expect(close).toHaveFocus());
  for (const target of focusTargets.slice(1)) {
    await user.tab();
    expect(target).toHaveFocus();
  }

  await user.tab();
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(submit).toHaveFocus();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

it("uses the theme-aware foreground token for dark scoped focus outlines", () => {
  const stylesheet = postcss.parse(readFileSync(resolve("src/styles.css"), "utf8"));
  const darkFocusRule = stylesheet.nodes.find(
    (node) =>
      node.type === "rule" &&
      node.selector.includes(":root.dark") &&
      node.selector.includes(".tt-login-focus-scope"),
  );

  expect(
    darkFocusRule.nodes.find((node) => node.prop === "outline-color")?.value,
  ).toBe("var(--oai-black)");
});
