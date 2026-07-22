import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authFixture = vi.hoisted(() => ({
  configured: false,
  client: null,
}));

vi.mock("../../lib/insforge-config", () => ({
  getOrCreateInsforgeClient: async () => authFixture.client,
  isCloudInsforgeConfigured: () => authFixture.configured,
}));

import {
  InsforgeAuthProvider,
  resolveInsforgeClientAccessToken,
  useInsforgeAuth,
} from "../InsforgeAuthContext.jsx";

function makeJwt(expSeconds) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=/g, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: expSeconds })}.sig`;
}

describe("resolveInsforgeClientAccessToken", () => {
  it("refreshes the session when token manager is empty", async () => {
    const accessToken = "restored-token";
    const client = {
      tokenManager: {
        getAccessToken: vi.fn(() => null),
        getSession: vi.fn(() => null),
      },
      auth: {
        refreshSession: vi.fn(async () => ({ data: { accessToken } })),
      },
    };

    await expect(resolveInsforgeClientAccessToken(client)).resolves.toBe(accessToken);
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("returns a fresh in-memory token without refreshing", async () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    const client = {
      tokenManager: {
        getAccessToken: vi.fn(() => accessToken),
        getSession: vi.fn(() => ({ accessToken })),
      },
      auth: {
        refreshSession: vi.fn(async () => ({ data: { accessToken: "should-not-be-used" } })),
      },
    };

    await expect(resolveInsforgeClientAccessToken(client)).resolves.toBe(accessToken);
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes an about-to-expire token", async () => {
    const expiredSoonToken = makeJwt(Math.floor(Date.now() / 1000) + 10);
    const refreshedToken = "fresh-token";
    const client = {
      tokenManager: {
        getAccessToken: vi
          .fn()
          .mockReturnValueOnce(expiredSoonToken)
          .mockReturnValueOnce(refreshedToken),
        getSession: vi.fn(() => null),
      },
      auth: {
        refreshSession: vi.fn(async () => ({ data: { accessToken: refreshedToken } })),
      },
    };

    await expect(resolveInsforgeClientAccessToken(client)).resolves.toBe(refreshedToken);
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("uses access_token from refresh payload when token manager stays empty", async () => {
    const accessToken = "snake-case-token";
    const client = {
      tokenManager: {
        getAccessToken: vi.fn(() => null),
        getSession: vi.fn(() => null),
      },
      auth: {
        refreshSession: vi.fn(async () => ({ data: { access_token: accessToken } })),
      },
    };

    await expect(resolveInsforgeClientAccessToken(client)).resolves.toBe(accessToken);
  });

  it("calls getCurrentUser when refresh does not repopulate token manager", async () => {
    const accessToken = "after-get-user";
    const getAccessToken = vi.fn().mockReturnValue(null);
    const client = {
      tokenManager: {
        getAccessToken,
        getSession: vi.fn(() => null),
      },
      auth: {
        refreshSession: vi.fn(async () => ({ data: {} })),
        getCurrentUser: vi.fn(async () => {
          getAccessToken.mockReturnValue(accessToken);
          return { data: { user: { id: "u1" } }, error: null };
        }),
      },
    };

    await expect(resolveInsforgeClientAccessToken(client)).resolves.toBe(accessToken);
    expect(client.auth.getCurrentUser).toHaveBeenCalledTimes(1);
  });
});

describe("InsforgeAuthProvider email verification", () => {
  beforeEach(() => {
    authFixture.configured = true;
    authFixture.client = {
      auth: {
        getCurrentUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        verifyEmail: vi.fn(async () => ({
          data: { user: { id: "verified-user", email: "person@example.com" }, accessToken: "token" },
          error: null,
        })),
        resendVerificationEmail: vi.fn(async () => ({ data: {}, error: null })),
      },
    };
  });

  it("verifies the six-digit signup code and stores the returned user", async () => {
    const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
    const { result } = renderHook(() => useInsforgeAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.verifyEmail({ email: "person@example.com", otp: "123456" });
    });

    expect(authFixture.client.auth.verifyEmail).toHaveBeenCalledWith({
      email: "person@example.com",
      otp: "123456",
    });
    await waitFor(() => expect(result.current.user?.id).toBe("verified-user"));
  });

  it("resends the signup verification email through InsForge", async () => {
    const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
    const { result } = renderHook(() => useInsforgeAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.resendVerificationEmail({ email: "person@example.com" });

    expect(authFixture.client.auth.resendVerificationEmail).toHaveBeenCalledWith({
      email: "person@example.com",
    });
  });
});
