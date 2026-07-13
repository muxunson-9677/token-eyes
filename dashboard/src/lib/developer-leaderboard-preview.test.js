import { describe, expect, it } from "vitest";
import {
  isDeveloperLeaderboardLoginEnabled,
  parseDeveloperLeaderboardLoginFlag,
} from "./developer-leaderboard-preview.js";

describe("developer leaderboard preview build gate", () => {
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
});
