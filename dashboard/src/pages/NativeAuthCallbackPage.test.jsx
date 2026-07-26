import React from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const { fetchAuthenticatedLocalApiMock, navigateMock } = vi.hoisted(() => ({
  fetchAuthenticatedLocalApiMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({ loading: true, signedIn: false }),
}));
vi.mock("../hooks/useLocale.js", () => ({ useLocale: vi.fn() }));
vi.mock("../lib/copy", () => ({ copy: (key) => key }));
vi.mock("../lib/local-api-fetch", () => ({
  fetchAuthenticatedLocalApi: fetchAuthenticatedLocalApiMock,
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  fetchAuthenticatedLocalApiMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ native: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  navigateMock.mockReset();
  window.history.replaceState({}, "", "/auth/callback?insforge_code=test-code");
});

it("authenticates the one-time native verifier read", async () => {
  const { NativeAuthCallbackPage } = await import("./NativeAuthCallbackPage.jsx");
  render(<NativeAuthCallbackPage />);

  await waitFor(() => {
    expect(fetchAuthenticatedLocalApiMock).toHaveBeenCalledWith(
      "/api/auth-bridge/verifier",
    );
  });
});
it("does not consume a native verifier body from a non-2xx response", async () => {
  const jsonMock = vi.fn(async () => ({ native: true }));
  fetchAuthenticatedLocalApiMock.mockResolvedValue({
    ok: false,
    status: 401,
    json: jsonMock,
  });
  const { NativeAuthCallbackPage } = await import("./NativeAuthCallbackPage.jsx");
  render(<NativeAuthCallbackPage />);

  await waitFor(() => {
    expect(fetchAuthenticatedLocalApiMock).toHaveBeenCalled();
  });
  expect(jsonMock).not.toHaveBeenCalled();
});