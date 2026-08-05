import React, { useEffect, useState } from "react";
import { Check, Info, Languages, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme.js";
import { useLocale } from "../../hooks/useLocale.js";
import { useCurrency } from "../../hooks/useCurrency.js";
import { EN_LOCALE, SYSTEM_LOCALE, ZH_CN_LOCALE } from "../../lib/locale";
import { CURRENCY_USD, getSupportedCurrencies } from "../../lib/currency";
import { copy } from "../../lib/copy";
import { Select } from "../../ui/components";
import { SectionCard, SegmentedControl, SettingsRow } from "./Controls.jsx";
import { getLocalSettings, setLocalSettings } from "../../lib/api";
import { cn } from "../../lib/cn";

function buildThemeOptions() {
  return [
    { value: "light", label: copy("settings.appearance.theme.light"), Icon: Sun },
    { value: "dark", label: copy("settings.appearance.theme.dark"), Icon: Moon },
    { value: "system", label: copy("settings.appearance.theme.system"), Icon: Monitor },
  ];
}

function buildLanguageOptions() {
  return [
    { value: SYSTEM_LOCALE, label: copy("settings.appearance.language.system") },
    { value: ZH_CN_LOCALE, label: copy("settings.appearance.language.chinese") },
    { value: EN_LOCALE, label: copy("settings.appearance.language.english") },
  ];
}

function formatUpdatedAt(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  } catch {
    return null;
  }
}

function buildSourceTooltip(rateSource, rateFetchedAt) {
  const source = copy(`settings.appearance.currency.rate_source.${rateSource}`);
  const updatedAt = formatUpdatedAt(rateFetchedAt);
  const when = updatedAt
    ? copy("settings.appearance.currency.rate_updated", { when: updatedAt })
    : copy("settings.appearance.currency.rate_never");
  return `${source} · ${when}`;
}

function LanguageDropdown({ locale, setLocale }) {
  const options = buildLanguageOptions();
  return (
    <Select
      value={locale}
      onValueChange={setLocale}
      options={options}
      ariaLabel={copy("settings.appearance.language.label")}
      className="px-2.5 py-1.5 text-xs font-medium"
      leadingIcon={
        <Languages
          className="h-3.5 w-3.5 text-oai-gray-500 dark:text-oai-gray-400"
          aria-hidden
        />
      }
    />
  );
}

function CurrencyDropdown({ currency, setCurrency }) {
  const options = getSupportedCurrencies().map((opt) => ({
    value: opt.code,
    label: copy(opt.labelKey),
  }));
  return (
    <Select
      value={currency}
      onValueChange={setCurrency}
      options={options}
      ariaLabel={copy("settings.appearance.currency.label")}
      className="px-3 py-1.5 text-xs font-medium"
    />
  );
}

function CurrencyHint({ currency, rate, rateSource, rateFetchedAt }) {
  if (currency === CURRENCY_USD) {
    return <>{copy("settings.appearance.currency.hint")}</>;
  }
  const tooltip = buildSourceTooltip(rateSource, rateFetchedAt);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{`1 USD = ${rate.toFixed(4)} ${currency}`}</span>
      <span
        role="img"
        aria-label={tooltip}
        title={tooltip}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center text-oai-gray-400 hover:text-oai-gray-600 dark:text-oai-gray-500 dark:hover:text-oai-gray-300"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </span>
    </span>
  );
}

function UsdCnyRateInput({ onRefreshRates }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getLocalSettings();
        if (cancelled) return;
        const rate = Number(settings?.currencySettings?.usdToCny);
        if (Number.isFinite(rate) && rate > 0) {
          setValue(String(rate));
        } else {
          setValue("7.2");
        }
      } catch {
        if (!cancelled) setValue("7.2");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      setError(copy("settings.appearance.usd_cny.save_error"));
      return;
    }
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      await setLocalSettings({ currencySettings: { usdToCny: num } });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch {
      setError(copy("settings.appearance.usd_cny.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    if (typeof onRefreshRates !== "function") return;
    setRefreshing(true);
    setError("");
    setSavedNotice(false);
    try {
      const result = await onRefreshRates({ throwOnError: true });
      const nextRate = Number(result?.rates?.CNY);
      if (!Number.isFinite(nextRate) || nextRate <= 0) {
        throw new Error("Invalid CNY exchange rate");
      }
      setValue(String(nextRate));
      await setLocalSettings({ currencySettings: { usdToCny: nextRate } });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch {
      setError(copy("settings.appearance.usd_cny.save_error"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsRow
      label={copy("settings.appearance.usd_cny.label")}
      hint={copy("settings.appearance.usd_cny.hint")}
      control={
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving || refreshing}
            className={cn(
              "h-10 w-28 rounded-md border border-oai-gray-200 bg-white px-3 text-xs text-oai-gray-900 outline-none transition-colors",
              "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
              "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
            )}
          />
          <span className="tt-exchange-rate-preview whitespace-nowrap text-xs text-oai-gray-500">1 USD = {value || "—"} CNY</span>
          <button
            type="button"
            onClick={refresh}
            disabled={saving || refreshing}
            className="inline-flex h-10 items-center gap-1 rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-800 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
            {copy("usage.button.refresh")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || refreshing}
            className="tt-exchange-rate-save inline-flex h-10 items-center gap-1 rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-800 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
          >
            {savedNotice ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
                {copy("settings.appearance.usd_cny.saved")}
              </>
            ) : (
              copy("settings.account.save")
            )}
          </button>
          {error ? (
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          ) : null}
        </div>
      }
    />
  );
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const { currency, rate, rateSource, rateFetchedAt, setCurrency, refreshRates } = useCurrency();

  return (
    <SectionCard className="tt-settings-appearance-card" title={copy("settings.section.appearance")} icon={Monitor} iconTone="blue">
      <SettingsRow
        label={copy("settings.appearance.theme.label")}
        hint={copy("settings.appearance.theme.hint")}
        control={<SegmentedControl options={buildThemeOptions()} value={theme} onChange={setTheme} />}
      />
      <SettingsRow
        label={copy("settings.appearance.language.label")}
        hint={copy("settings.appearance.language.hint")}
        control={<LanguageDropdown locale={locale} setLocale={setLocale} />}
      />
      <SettingsRow
        label={copy("settings.appearance.currency.label")}
        hint={
          <CurrencyHint
            currency={currency}
            rate={rate}
            rateSource={rateSource}
            rateFetchedAt={rateFetchedAt}
          />
        }
        control={<CurrencyDropdown currency={currency} setCurrency={setCurrency} />}
      />
      <UsdCnyRateInput onRefreshRates={refreshRates} />
    </SectionCard>
  );
}
