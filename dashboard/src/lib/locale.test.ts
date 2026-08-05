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

describe("resolvePreferredLocale", () => {
  it("resolves English and Simplified Chinese from the system language", () => {
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["zh-Hans-CN", "en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["zh-TW"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["ja-JP"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["ko-KR"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, ["en-US", "zh-Hans-CN"])).toBe(EN_LOCALE);
    expect(resolvePreferredLocale(SYSTEM_LOCALE, [])).toBe(ZH_CN_LOCALE);
  });

  it("preserves explicit English and Chinese preferences", () => {
    expect(resolvePreferredLocale("en", ["zh-CN"])).toBe(EN_LOCALE);
    expect(resolvePreferredLocale("zh-CN", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("zh-TW", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("ja", ["en-US"])).toBe(ZH_CN_LOCALE);
    expect(resolvePreferredLocale("ko", ["en-US"])).toBe(ZH_CN_LOCALE);
  });
});

describe("normalizeResolvedLocale", () => {
  it("keeps unsupported locale constants as Simplified Chinese compatibility aliases", () => {
    expect(EN_LOCALE).toBe("en");
    expect(ZH_TW_LOCALE).toBe(ZH_CN_LOCALE);
    expect(JA_LOCALE).toBe(ZH_CN_LOCALE);
    expect(KO_LOCALE).toBe(ZH_CN_LOCALE);
  });

  it("supports English and falls back unsupported locales to Simplified Chinese", () => {
    expect(normalizeResolvedLocale("zh-CN")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("zh-TW")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("zh-Hant")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("ja-JP")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("ko")).toBe(ZH_CN_LOCALE);
    expect(normalizeResolvedLocale("en")).toBe(EN_LOCALE);
    expect(normalizeResolvedLocale("en-US")).toBe(EN_LOCALE);
    expect(normalizeResolvedLocale(null)).toBe(ZH_CN_LOCALE);
  });
});

describe("normalizeLocalePreference", () => {
  it("preserves system and English while mapping unsupported choices to Simplified Chinese", () => {
    expect(normalizeLocalePreference(SYSTEM_LOCALE)).toBe(SYSTEM_LOCALE);
    expect(normalizeLocalePreference("en")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference("zh-TW")).toBe(ZH_CN_LOCALE);
    expect(normalizeLocalePreference("ja")).toBe(ZH_CN_LOCALE);
    expect(normalizeLocalePreference("ko")).toBe(ZH_CN_LOCALE);
  });
});
