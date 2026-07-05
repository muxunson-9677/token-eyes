import { describe, expect, it } from "vitest";
import {
  EN_LOCALE,
  JA_LOCALE,
  KO_LOCALE,
  ZH_CN_LOCALE,
  ZH_TW_LOCALE,
  normalizeLocalePreference,
  normalizeResolvedLocale,
  resolvePreferredLocale,
  SYSTEM_LOCALE,
} from "./locale";

describe("resolvePreferredLocale (Chinese-only MVP)", () => {
  it("uses Simplified Chinese for system languages", () => {
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["zh-Hans-CN", "en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["zh-TW"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["ja-JP"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["ko-KR"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["en-US", "zh-Hans-CN"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, [])).toBe(ZH_CN_LOCALE);
  });

  it("normalizes legacy explicit preferences to Simplified Chinese", () => {
    expect(resolvePreferredLocale("en", ["zh-CN"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("zh-CN", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("zh-TW", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("ja", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("ko", ["en-US"])).toBe(ZH_CN_LOCALE);
  });
});

describe("normalizeResolvedLocale", () => {
  it("keeps old locale constants as Simplified Chinese compatibility aliases", () => {
    expect(EN_LOCALE).toBe(ZH_CN_LOCALE);
    expect(ZH_TW_LOCALE).toBe(ZH_CN_LOCALE);
    expect(JA_LOCALE).toBe(ZH_CN_LOCALE);
    expect(KO_LOCALE).toBe(ZH_CN_LOCALE);
  });

  it("maps every resolved locale to Simplified Chinese", () => {
    expect(normalizeResolvedLocale("zh-CN")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("zh-TW")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("zh-Hant")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("ja-JP")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("ko")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("en")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale(null)).toBe(ZH_CN_LOCALE);
  });
});

describe("normalizeLocalePreference", () => {
  it("preserves system and maps stored legacy choices to Simplified Chinese", () => {
    expect(normalizeLocalePreference(SYSTEM_LOCALE)).toBe(SYSTEM_LOCALE);
    expect(normalizeLocalePreference("en")).toBe(ZH_CN_LOCALE);
    expect(normalizeLocalePreference("zh-TW")).toBe(ZH_CN_LOCALE);
    expect(normalizeLocalePreference("ja")).toBe(ZH_CN_LOCALE);
    expect(normalizeLocalePreference("ko")).toBe(ZH_CN_LOCALE);
  });
});
