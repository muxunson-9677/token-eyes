import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginCard } from "./LoginCard.jsx";
import { copy } from "../lib/copy";

const authMock = vi.hoisted(() => ({
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
  useInsforgeAuth: () => authMock,
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ locale: "en" }),
}));

describe("LoginCard email-only signup verification", () => {
  beforeEach(() => {
    authMock.signedIn = false;
    authMock.refreshUser.mockReset().mockResolvedValue(undefined);
    authMock.signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
    authMock.signUp.mockReset().mockResolvedValue({
      data: { requireEmailVerification: true },
      error: null,
    });
    authMock.verifyEmail.mockReset().mockResolvedValue({
      data: { user: { id: "verified-user" }, accessToken: "token" },
      error: null,
    });
    authMock.resendVerificationEmail.mockReset().mockResolvedValue({ data: {}, error: null });
    authMock.signInWithOAuth.mockReset();
    authMock.getPublicAuthConfig.mockReset().mockResolvedValue({
      data: {
        oAuthProviders: ["github"],
        customOAuthProviders: [],
        passwordMinLength: 6,
        verifyEmailMethod: "code",
      },
      error: null,
    });
  });

  it("shows email immediately and hides OAuth in focused mode", async () => {
    render(<LoginCard emailOnly />);

    expect(await screen.findByLabelText(copy("login.field.email"))).toBeInTheDocument();
    expect(screen.queryByText(copy("login.oauth.continue", { provider: "GitHub" }))).not.toBeInTheDocument();
  });

  it("keeps a new user in the modal to enter the six-digit code", async () => {
    const user = userEvent.setup();
    render(<LoginCard emailOnly />);

    await user.click(await screen.findByRole("button", { name: copy("login.tab.sign_up") }));
    await user.type(screen.getByLabelText(copy("login.field.name")), "New User");
    await user.type(screen.getByLabelText(copy("login.field.email")), "person@example.com");
    await user.type(screen.getByLabelText(copy("login.field.password")), "secret1");
    await user.click(screen.getByRole("button", { name: copy("login.submit.sign_up") }));

    expect(authMock.signUp).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "secret1",
      name: "New User",
    });
    expect(await screen.findByLabelText("验证码")).toBeInTheDocument();
  });

  it("verifies the code and preserves the authenticated session", async () => {
    const user = userEvent.setup();
    render(<LoginCard emailOnly />);

    await user.click(await screen.findByRole("button", { name: copy("login.tab.sign_up") }));
    await user.type(screen.getByLabelText(copy("login.field.email")), "person@example.com");
    await user.type(screen.getByLabelText(copy("login.field.password")), "secret1");
    await user.click(screen.getByRole("button", { name: copy("login.submit.sign_up") }));
    await user.type(await screen.findByLabelText("验证码"), "123456");
    await user.click(screen.getByRole("button", { name: "验证并参与" }));

    expect(authMock.verifyEmail).toHaveBeenCalledWith({
      email: "person@example.com",
      otp: "123456",
    });
    await waitFor(() => expect(authMock.refreshUser).toHaveBeenCalled());
  });

  it("resends the verification code to the registered email", async () => {
    const user = userEvent.setup();
    render(<LoginCard emailOnly />);

    await user.click(await screen.findByRole("button", { name: copy("login.tab.sign_up") }));
    await user.type(screen.getByLabelText(copy("login.field.email")), "person@example.com");
    await user.type(screen.getByLabelText(copy("login.field.password")), "secret1");
    await user.click(screen.getByRole("button", { name: copy("login.submit.sign_up") }));
    await user.click(await screen.findByRole("button", { name: "重新发送验证码" }));

    expect(authMock.resendVerificationEmail).toHaveBeenCalledWith({
      email: "person@example.com",
    });
  });

  it("keeps an invalid code visible so the user can retry", async () => {
    const user = userEvent.setup();
    authMock.verifyEmail.mockResolvedValueOnce({
      data: null,
      error: new Error("Invalid or expired code"),
    });
    render(<LoginCard emailOnly />);

    await user.click(await screen.findByRole("button", { name: copy("login.tab.sign_up") }));
    await user.type(screen.getByLabelText(copy("login.field.email")), "person@example.com");
    await user.type(screen.getByLabelText(copy("login.field.password")), "secret1");
    await user.click(screen.getByRole("button", { name: copy("login.submit.sign_up") }));
    await user.type(await screen.findByLabelText("验证码"), "654321");
    await user.click(screen.getByRole("button", { name: "验证并参与" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid or expired code");
    expect(screen.getByLabelText("验证码")).toHaveValue("654321");
  });

  it("keeps ordinary email and password sign-in available", async () => {
    const user = userEvent.setup();
    render(<LoginCard emailOnly />);

    await user.type(await screen.findByLabelText(copy("login.field.email")), "member@example.com");
    await user.type(screen.getByLabelText(copy("login.field.password")), "secret1");
    await user.click(screen.getByRole("button", { name: copy("login.submit.sign_in") }));

    expect(authMock.signInWithPassword).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "secret1",
    });
  });
});
