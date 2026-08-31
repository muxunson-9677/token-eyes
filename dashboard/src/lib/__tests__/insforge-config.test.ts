import { afterEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn((options) => ({ options })));

vi.mock("@insforge/sdk", () => ({
  createClient: createClientMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  createClientMock.mockClear();
});

describe("InsForge public auth configuration", () => {
  it("fails closed before importing the SDK when the public anon key is missing", async () => {
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", "");
    vi.stubEnv("VITE_TOKENTRACKER_BACKEND_ANON_KEY", "");
    const config = await import("../insforge-config");

    expect(config.isCloudInsforgeConfigured()).toBe(false);
    expect(config.getCloudInsforgeDisabledReason()).toBe("missing_public_auth_credential");
    await expect(config.getOrCreateInsforgeClient()).resolves.toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("requires a safe HTTPS remote URL", async () => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "http://auth.example.test");
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", "public-anon-key");
    const config = await import("../insforge-config");

    expect(config.isCloudInsforgeConfigured()).toBe(false);
    expect(config.getCloudInsforgeDisabledReason()).toBe("invalid_auth_base_url");
    await expect(config.getOrCreateInsforgeClient()).resolves.toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates the SDK only with a non-empty public anon key and HTTPS URL", async () => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "https://auth.example.test");
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", "public-anon-key");
    const config = await import("../insforge-config");

    expect(config.isCloudInsforgeConfigured()).toBe(true);
    expect(config.getCloudInsforgeDisabledReason()).toBeNull();
    await expect(config.getOrCreateInsforgeClient()).resolves.toBeTruthy();
    expect(createClientMock).toHaveBeenCalledWith(expect.objectContaining({
      anonKey: "public-anon-key",
    }));
  });
});
