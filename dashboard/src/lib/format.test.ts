import { describe, expect, it } from "vitest";
import { formatChineseTokenCount, formatTokenCount, formatUsdCurrency } from "./format";

describe("formatTokenCount", () => {
  it("uses Western compact units in English without leaking Chinese suffixes", () => {
    expect(formatTokenCount(4_716_100, { locale: "en" })).toBe("4.72M");
    expect(formatTokenCount(20_000, { locale: "en" })).toBe("20K");
  });

  it("keeps the established Chinese token vocabulary in Chinese", () => {
    expect(formatTokenCount(4_716_100, { locale: "zh-CN" })).toBe("471.61万");
  });
});

describe("formatChineseTokenCount", () => {
  it.each([
    [0, "0"],
    [9_999, "9,999"],
    [10_000, "1万"],
    [4_156_000, "415.6万"],
    [9_999_999, "1000万"],
    [10_000_000, "1千万"],
    [32_770_000, "3.28千万"],
    [99_999_999, "10千万"],
    [100_000_000, "1亿"],
    [3_315_880_286, "33.16亿"],
    [104_336_606_257, "1043.37亿"],
  ])("formats %s with Chinese Token units", (value, expected) => {
    expect(formatChineseTokenCount(value)).toBe(expected);
  });

  it("supports numeric strings, negative values and invalid values", () => {
    expect(formatChineseTokenCount("18_960_000".replaceAll("_", ""))).toBe("1.9千万");
    expect(formatChineseTokenCount(-15_000)).toBe("-1.5万");
    expect(formatChineseTokenCount(null)).toBe("-");
    expect(formatChineseTokenCount("not-a-number")).toBe("-");
  });

  it("allows a caller to cap decimal precision", () => {
    expect(formatChineseTokenCount(3_315_880_286, { decimals: 1 })).toBe("33.2亿");
    expect(formatChineseTokenCount(3_315_880_286, { decimals: 0 })).toBe("33亿");
  });
});

describe("formatUsdCurrency — null / empty handling", () => {
  it("returns '-' for null", () => {
    expect(formatUsdCurrency(null)).toBe("-");
  });

  it("returns '-' for undefined", () => {
    expect(formatUsdCurrency(undefined)).toBe("-");
  });

  it("returns '-' for empty string", () => {
    // Regression: pre-fix Number("") === 0 made this "$0.00", masking loading states.
    expect(formatUsdCurrency("")).toBe("-");
  });

  it("returns '-' for whitespace-only string", () => {
    expect(formatUsdCurrency("   ")).toBe("-");
  });
});

describe("formatUsdCurrency — numbers", () => {
  it("formats integer USD", () => {
    expect(formatUsdCurrency(0)).toBe("$0.00");
    expect(formatUsdCurrency(5)).toBe("$5.00");
  });

  it("formats decimal USD", () => {
    expect(formatUsdCurrency(1.5)).toBe("$1.50");
    expect(formatUsdCurrency(1.234567)).toBe("$1.23");
  });

  it("formats negative USD", () => {
    expect(formatUsdCurrency(-1.5)).toBe("-$1.50");
  });

  it("formats large USD with thousands separator", () => {
    expect(formatUsdCurrency(1234567.89)).toBe("$1,234,567.89");
  });
});

describe("formatUsdCurrency — string inputs", () => {
  it("formats numeric string", () => {
    expect(formatUsdCurrency("1.50")).toBe("$1.50");
    expect(formatUsdCurrency("1.234567")).toBe("$1.23");
  });

  it("returns the raw string for unparseable input", () => {
    expect(formatUsdCurrency("foo")).toBe("foo");
    expect(formatUsdCurrency("$1.50")).toBe("$1.50");
  });
});

describe("formatUsdCurrency — non-USD conversion", () => {
  it("uses ¥ symbol for CNY and applies rate", () => {
    expect(formatUsdCurrency(1, { currency: "CNY", rate: 7.2 })).toBe("¥7.20");
    expect(formatUsdCurrency(10, { currency: "CNY", rate: 7.18 })).toBe("¥71.80");
  });

  it("uses € for EUR, £ for GBP, ¥ for JPY, HK$ for HKD", () => {
    expect(formatUsdCurrency(1, { currency: "EUR", rate: 0.92 })).toBe("€0.92");
    expect(formatUsdCurrency(1, { currency: "GBP", rate: 0.79 })).toBe("£0.79");
    expect(formatUsdCurrency(1, { currency: "JPY", rate: 155 })).toBe("¥155.00");
    expect(formatUsdCurrency(1, { currency: "HKD", rate: 7.8 })).toBe("HK$7.80");
  });

  it("falls back to no conversion for invalid rate", () => {
    expect(formatUsdCurrency(1.5, { currency: "CNY", rate: 0 })).toBe("¥1.50");
    expect(formatUsdCurrency(1.5, { currency: "EUR", rate: -1 })).toBe("€1.50");
    expect(formatUsdCurrency(1.5, { currency: "GBP", rate: NaN })).toBe("£1.50");
  });

  it("preserves '-' for empty input regardless of currency", () => {
    expect(formatUsdCurrency("", { currency: "CNY", rate: 7.2 })).toBe("-");
  });

  it("falls back to $ for unknown currency codes", () => {
    expect(formatUsdCurrency(1, { currency: "BTC", rate: 0.00002 })).toBe("$0.00");
  });
});

describe("formatUsdCurrency — decimals option", () => {
  it("honors custom decimals", () => {
    expect(formatUsdCurrency(1.23456, { decimals: 4 })).toBe("$1.2345");
  });

  it("clamps decimals to 0-6", () => {
    expect(formatUsdCurrency(1.5, { decimals: 0 })).toBe("$1");
    expect(formatUsdCurrency(1.5, { decimals: 99 })).toBe("$1.500000");
  });
});

describe("formatUsdCurrency — edge cases", () => {
  it("handles bigint", () => {
    expect(formatUsdCurrency(BigInt(42))).toBe("$42.00");
  });

  it("returns a non-empty string for Infinity without throwing", () => {
    // Non-finite numbers fall through to String(value) rather than crashing
    // the row — readable text beats stack trace for one cell.
    const result = formatUsdCurrency(Infinity);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
