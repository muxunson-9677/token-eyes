export function toDisplayNumber(value: any) {
  if (value == null) return "-";
  try {
    if (typeof value === "bigint") return new Intl.NumberFormat().format(value);
    if (typeof value === "number") return new Intl.NumberFormat().format(value);
    const s = String(value).trim();
    if (/^[0-9]+$/.test(s)) return new Intl.NumberFormat().format(BigInt(s));
    return s;
  } catch (_e) {
    return String(value);
  }
}

export function formatCompactNumber(
  value: any,
  {
    thousandSuffix = "K",
    millionSuffix = "M",
    billionSuffix = "B",
    decimals = 1,
  }: {
    thousandSuffix?: string;
    millionSuffix?: string;
    billionSuffix?: string;
    decimals?: number;
  } = {},
) {
  const n = Number(String(value));
  if (!Number.isFinite(n)) return "-";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const safeDecimals = Math.max(0, Math.min(6, Math.floor(decimals)));

  if (abs < 1000) return `${sign}${String(abs)}`;

  const formatWithSuffix = (val: number, suffix: string) => {
    const fixed = val.toFixed(safeDecimals);
    const normalized = Number(fixed).toString();
    return `${sign}${normalized}${suffix}`;
  };

  const formatWithCarry = (val: number, suffix: string, nextSuffix?: string) => {
    const fixed = val.toFixed(safeDecimals);
    const normalized = Number(fixed);
    if (nextSuffix && normalized >= 1000) {
      return formatWithSuffix(normalized / 1000, nextSuffix);
    }
    return `${sign}${normalized.toString()}${suffix}`;
  };

  if (abs >= 1000000000) {
    return formatWithSuffix(abs / 1000000000, billionSuffix);
  }

  if (abs >= 1000000) {
    return formatWithCarry(abs / 1000000, millionSuffix, billionSuffix);
  }

  const kValue = abs / 1000;
  const roundedK = Number(kValue.toFixed(safeDecimals));
  if (roundedK >= 1000) {
    return formatWithSuffix(roundedK / 1000, millionSuffix);
  }
  return formatWithSuffix(roundedK, thousandSuffix);
}

/**
 * Format Token counts with the product's Chinese magnitude vocabulary.
 * This is intentionally token-specific: money, request counts, ranks and
 * participant counts must keep their own formatting semantics.
 */
export function formatChineseTokenCount(
  value: any,
  { decimals = 2 }: { decimals?: number } = {},
) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";

  const safeDecimals = Math.max(0, Math.min(4, Math.floor(decimals)));
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const formatScaled = (divisor: number, suffix: string) => {
    const rounded = Number((absolute / divisor).toFixed(safeDecimals));
    return `${sign}${rounded}${suffix}`;
  };

  if (absolute >= 100_000_000) return formatScaled(100_000_000, "亿");
  if (absolute >= 10_000_000) return formatScaled(10_000_000, "千万");
  if (absolute >= 10_000) return formatScaled(10_000, "万");
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: safeDecimals }).format(number);
}

/**
 * Format Token counts using the active product locale. Chinese keeps the
 * established 万/千万/亿 vocabulary; English uses K/M/B compact suffixes.
 */
export function formatTokenCount(
  value: any,
  { locale = "zh-CN", decimals = 2 }: { locale?: string; decimals?: number } = {},
) {
  if (!String(locale).toLowerCase().startsWith("en")) {
    return formatChineseTokenCount(value, { decimals });
  }
  if (value == null || (typeof value === "string" && value.trim() === "")) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) < 1000) {
    return new Intl.NumberFormat("en", {
      maximumFractionDigits: Math.max(0, Math.min(4, Math.floor(decimals))),
    }).format(number);
  }
  return formatCompactNumber(number, { decimals });
}

export function toFiniteNumber(value: any) {
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

import { getCurrencySymbol } from "./currency";

interface FormatUsdCurrencyOptions {
  decimals?: number;
  currency?: string;
  rate?: number;
}

/**
 * Format a USD value as currency. Pure function — accepts currency and rate
 * via options so React components can drive presentation via `useCurrency()`
 * and pure utilities (share cards, screenshots) can pass values explicitly.
 *
 * Returns "-" for null/undefined/empty/whitespace inputs and the raw string
 * for unparseable non-numeric inputs. Returns "$0.00" only for genuine 0/"0".
 */
export function formatUsdCurrency(value: any, options: FormatUsdCurrencyOptions = {}) {
  const { decimals = 2, currency = "USD", rate = 1 } = options;

  if (value == null) return "-";

  // Empty / whitespace must NOT coerce to 0 — that's a loading state, not "$0.00".
  if (typeof value === "string" && value.trim() === "") return "-";

  let numVal: number;
  if (typeof value === "number") {
    numVal = value;
  } else if (typeof value === "bigint") {
    numVal = Number(value);
  } else {
    const raw = String(value).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return raw;
    numVal = parsed;
  }

  if (!Number.isFinite(numVal)) return String(value);

  const symbol = getCurrencySymbol(currency);
  if (currency !== "USD" && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
    numVal = numVal * rate;
  }

  const fixed = numVal.toFixed(6);
  const match = fixed.match(/^(-?\d+)(?:\.(\d+))?$/);
  if (!match) return `${symbol}${String(numVal)}`;
  const intPart = match[1];
  const fracPart = match[2] || "";
  let formattedInt = intPart;
  try {
    formattedInt = new Intl.NumberFormat().format(BigInt(intPart));
  } catch (_e) {
    formattedInt = intPart;
  }
  const normalizedDecimals = Math.max(0, Math.min(6, Math.floor(decimals)));
  const decimalPart = normalizedDecimals
    ? fracPart.slice(0, normalizedDecimals).padEnd(normalizedDecimals, "0")
    : "";
  const sign = intPart.startsWith("-") ? "-" : "";
  const valuePart = normalizedDecimals
    ? `${formattedInt.replace("-", "")}.${decimalPart}`
    : formattedInt.replace("-", "");
  return `${sign}${symbol}${valuePart}`;
}
