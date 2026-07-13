import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDeveloperLeaderboardLoginEnabled,
  parseDeveloperLeaderboardLoginFlag,
} from "./developer-leaderboard-preview.js";

describe("developer leaderboard preview build gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts only the explicit enabled build values", () => {
    expect(parseDeveloperLeaderboardLoginFlag("1")).toBe(true);
    expect(parseDeveloperLeaderboardLoginFlag("true")).toBe(true);
    expect(parseDeveloperLeaderboardLoginFlag(" TRUE ")).toBe(true);
    expect(parseDeveloperLeaderboardLoginFlag("0")).toBe(false);
    expect(parseDeveloperLeaderboardLoginFlag("yes")).toBe(false);
    expect(parseDeveloperLeaderboardLoginFlag(undefined)).toBe(false);
  });

  it("stays disabled in ordinary builds", () => {
    expect(isDeveloperLeaderboardLoginEnabled()).toBe(false);
  });

  it("enables the preview only when the test build flag is set", () => {
    vi.stubEnv("VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN", "1");
    expect(isDeveloperLeaderboardLoginEnabled()).toBe(true);
  });
});
