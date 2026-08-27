import { describe, expect, it } from "vitest";
import {
  isTokenPlanExpired,
  tokenPlanExpiryTimestamp,
  tokenPlanExpiryValue,
} from "./token-plan-validity.js";

describe("tokenPlanExpiryValue", () => {
  it.each([
    [undefined, null],
    [null, null],
    [{}, null],
    [{ subscription_end_date: "  ", expires_at: "\t" }, null],
  ])("returns null when no expiry value is present", (record, expected) => {
    expect(tokenPlanExpiryValue(record)).toBe(expected);
  });

  it("prefers a trimmed non-empty subscription end date", () => {
    expect(
      tokenPlanExpiryValue({
        subscription_end_date: "  2026-08-27T10:20:30.456Z  ",
        expires_at: "2027-01-01T00:00:00.000Z",
      }),
    ).toBe("2026-08-27T10:20:30.456Z");
  });

  it("does not fall back when the preferred field is non-empty but invalid", () => {
    expect(
      tokenPlanExpiryValue({
        subscription_end_date: " invalid ",
        expires_at: "2027-01-01T00:00:00.000Z",
      }),
    ).toBe("invalid");
  });

  it("uses and trims expires_at when the preferred field is empty", () => {
    expect(
      tokenPlanExpiryValue({
        subscription_end_date: " ",
        expires_at: " 2027-01-01T00:00:00.000Z ",
      }),
    ).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("tokenPlanExpiryTimestamp", () => {
  it.each([
    null,
    undefined,
    "",
    "   ",
    "not-a-date",
    "123456789",
    "12345678901",
    -1735689600,
    123456789,
    12345678901,
    123.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("returns null for a missing or invalid value: %s", (value) => {
    expect(tokenPlanExpiryTimestamp(value)).toBeNull();
  });

  it.each([
    ["1735689600", 1735689600000],
    [1735689600, 1735689600000],
    ["1735689600000", 1735689600000],
    [1735689600000, 1735689600000],
  ])("normalizes 10-digit seconds and 13-digit milliseconds", (value, expected) => {
    expect(tokenPlanExpiryTimestamp(value)).toBe(expected);
  });

  it("treats a date-only value as the final local millisecond of that day", () => {
    const expected = new Date(2026, 7, 27, 23, 59, 59, 999).getTime();
    expect(tokenPlanExpiryTimestamp("2026-08-27")).toBe(expected);
  });

  it("parses an ISO timestamp with an explicit offset", () => {
    const value = "2026-08-27T18:20:30.456+08:00";
    expect(tokenPlanExpiryTimestamp(value)).toBe(Date.parse(value));
  });

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-02-30",
    "08/27/2026",
    "2026-08-27T10:20:30",
    "2026-08-27T25:00:00Z",
    "2026-08-27T10:20:30+25:00",
  ])("rejects expiry text outside the strict provider date contract: %s", (value) => {
    expect(tokenPlanExpiryTimestamp(value)).toBeNull();
  });
});

describe("isTokenPlanExpired", () => {
  it("keeps a date-only plan valid through the final local millisecond", () => {
    const endOfDay = new Date(2026, 7, 27, 23, 59, 59, 999).getTime();
    const record = { expires_at: "2026-08-27" };

    expect(isTokenPlanExpired(record, endOfDay)).toBe(false);
    expect(isTokenPlanExpired(record, endOfDay + 1)).toBe(true);
  });

  it("uses a strict boundary for ISO expiry timestamps", () => {
    const expiresAt = "2026-08-27T10:20:30.456Z";
    const expiryMs = Date.parse(expiresAt);
    const record = { expires_at: expiresAt };

    expect(isTokenPlanExpired(record, new Date(expiryMs))).toBe(false);
    expect(isTokenPlanExpired(record, expiryMs + 1)).toBe(true);
  });

  it("accepts numeric expiry values selected from a record", () => {
    expect(isTokenPlanExpired({ expires_at: 1735689600 }, 1735689600001)).toBe(true);
    expect(isTokenPlanExpired({ expires_at: 1735689600000 }, 1735689600000)).toBe(false);
  });

  it.each([
    new Date("invalid"),
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "2026-08-27T10:20:30.456Z",
  ])("returns false for an invalid now value: %s", (now) => {
    expect(isTokenPlanExpired({ expires_at: "2020-01-01T00:00:00.000Z" }, now)).toBe(false);
  });

  it.each([
    undefined,
    null,
    {},
    { expires_at: "invalid" },
  ])("returns false when the record has no valid expiry: %s", (record) => {
    expect(isTokenPlanExpired(record, Date.now())).toBe(false);
  });
});
