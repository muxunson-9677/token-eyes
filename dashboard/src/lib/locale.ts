import { safeGetItem, safeSetItem } from "./safe-browser";

export const LOCALE_STORAGE_KEY = "tokentracker-locale";
export const SYSTEM_LOCALE = "system";
export const ZH_CN_LOCALE = "zh-CN";
export const EN_LOCALE = ZH_CN_LOCALE;
export const ZH_TW_LOCALE = ZH_CN_LOCALE;
export const JA_LOCALE = ZH_CN_LOCALE;
export const KO_LOCALE = ZH_CN_LOCALE;

function classifyLanguageTag(tag: string): string | null {
  return tag.trim() ? ZH_CN_LOCALE : null;
}

export function normalizeResolvedLocale(value: any) {
  if (typeof value !== "string") return ZH_CN_LOCALE;
  return classifyLanguageTag(value) || ZH_CN_LOCALE;
}

export function normalizeLocalePreference(value: any) {
  if (value === SYSTEM_LOCALE) return SYSTEM_LOCALE;
  return normalizeResolvedLocale(value);
}

function getBrowserLanguages() {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) {
    return navigator.languages.filter((value) => typeof value === "string");
  }
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

export function resolvePreferredLocale(preference: any, languages = getBrowserLanguages()) {
  const normalized = normalizeLocalePreference(preference);
  if (normalized !== SYSTEM_LOCALE) return ZH_CN_LOCALE;
  const primary = languages
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0);
  return classifyLanguageTag(primary || "") || ZH_CN_LOCALE;
}

export function getInitialLocalePreference() {
  return normalizeLocalePreference(safeGetItem(LOCALE_STORAGE_KEY) || SYSTEM_LOCALE);
}

export function persistLocalePreference(preference: any) {
  return safeSetItem(LOCALE_STORAGE_KEY, normalizeLocalePreference(preference));
}
