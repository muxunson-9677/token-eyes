import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { enabled: true, signedIn: true, loading: false },
  local: vi.fn(() => true),
}));

vi.mock("./InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => mocks.auth,
}));
vi.mock("../lib/cloud-sync-prefs", () => ({
  isLocalDashboardHost: mocks.local,
}));

import { AccountViewProvider, useAccountView } from "./AccountViewContext.jsx";

function Probe() {
  const value = useAccountView();
  return (
    <output>
      {JSON.stringify({
        accountView: value.accountView,
        localHost: value.localHost,
        resolving: value.resolving,
      })}
    </output>
  );
}

function renderValue() {
  render(
    <AccountViewProvider>
      <Probe />
    </AccountViewProvider>,
  );
  return JSON.parse(screen.getByRole("status").textContent || "{}");
}

describe("local-first account view", () => {
  beforeEach(() => {
    mocks.auth.enabled = true;
    mocks.auth.signedIn = true;
    mocks.auth.loading = false;
    mocks.local.mockReturnValue(true);
  });

  it("keeps localhost and Tauri-style local hosts on local usage when signed in", () => {
    expect(renderValue()).toMatchObject({
      accountView: false,
      localHost: true,
      resolving: false,
    });
  });

  it("retains cloud account view for an authenticated public web dashboard", () => {
    mocks.local.mockReturnValue(false);
    expect(renderValue()).toMatchObject({
      accountView: true,
      localHost: false,
      resolving: false,
    });
  });

  it("only resolves auth for a non-local cloud view", () => {
    mocks.local.mockReturnValue(false);
    mocks.auth.signedIn = false;
    mocks.auth.loading = true;
    expect(renderValue()).toMatchObject({
      accountView: false,
      resolving: true,
    });
  });
});
