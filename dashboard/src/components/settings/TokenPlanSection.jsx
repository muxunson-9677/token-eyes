import React, { useEffect, useState } from "react";
import { Save, RefreshCw } from "lucide-react";
import { getTokenPlans, saveTokenPlan, refreshTokenPlan } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";

const EMPTY_FORM = {
  id: "",
  source: "",
  plan_label: "",
  total_quota: 0,
  used_quota: 0,
  remaining_quota: 0,
  expires_at: "",
  refresh_enabled: false,
  refresh_interval_minutes: 60,
  refresh_method: "manual",
  credential_ref: "",
};

const REFRESH_INTERVAL_OPTIONS = [15, 30, 60, 240, 1440];
const REFRESH_METHOD_OPTIONS = ["manual", "official_api", "cookie_scrape"];

function normalizeRecords(value) {
  return Array.isArray(value) ? value : [];
}

export function TokenPlanSection() {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState("");
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTokenPlans()
      .then((result) => {
        if (cancelled) return;
        setRecords(normalizeRecords(result?.records));
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("settings.token_plan.load_error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({
      ...current,
      [field]: ["total_quota", "used_quota", "remaining_quota", "refresh_interval_minutes"].includes(field)
        ? Number(value || 0)
        : value,
    }));
    setSavedNotice(false);
  };

  const updateCheckbox = (field) => (event) => {
    const checked = event.target.checked;
    setForm((current) => ({
      ...current,
      [field]: checked,
    }));
    setSavedNotice(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      const result = await saveTokenPlan(form);
      setRecords(normalizeRecords(result?.records));
      setForm(EMPTY_FORM);
      setSavedNotice(true);
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async (id) => {
    setRefreshingId(id);
    setError("");
    try {
      const result = await refreshTokenPlan(id);
      setRecords(normalizeRecords(result?.records));
      const plan = result?.plan;
      if (plan?.last_refresh_status === "failed") {
        setError(plan?.last_refresh_error || copy("settings.token_plan.refresh_failed"));
      }
    } catch (err) {
      setError(err?.message || copy("settings.token_plan.refresh_failed"));
    } finally {
      setRefreshingId("");
    }
  };

  const editRecord = (record) => {
    setForm({ ...EMPTY_FORM, ...record });
    setSavedNotice(false);
  };

  const canSave = !loading && !saving && form.source.trim() && form.plan_label.trim();

  return (
    <SectionCard
      title={copy("settings.section.token_plan")}
      subtitle={copy("settings.token_plan.subtitle")}
      action={
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
          {saving ? copy("settings.token_plan.saving") : copy("settings.token_plan.save")}
        </button>
      }
    >
      <div className="grid gap-3 py-3 sm:grid-cols-2">
        <TextInput label={copy("settings.token_plan.source")} value={form.source} onChange={updateField("source")} disabled={loading || saving} />
        <TextInput label={copy("settings.token_plan.plan_label")} value={form.plan_label} onChange={updateField("plan_label")} disabled={loading || saving} />
        <NumberInput label={copy("settings.token_plan.total_quota")} value={form.total_quota} onChange={updateField("total_quota")} disabled={loading || saving} />
        <NumberInput label={copy("settings.token_plan.used_quota")} value={form.used_quota} onChange={updateField("used_quota")} disabled={loading || saving} />
        <NumberInput label={copy("settings.token_plan.remaining_quota")} value={form.remaining_quota} onChange={updateField("remaining_quota")} disabled={loading || saving} />
        <TextInput label={copy("settings.token_plan.expires_at")} value={form.expires_at} onChange={updateField("expires_at")} disabled={loading || saving} placeholder="2026-12-31" />
        <SelectInput
          label={copy("settings.token_plan.refresh_method")}
          value={form.refresh_method}
          onChange={updateField("refresh_method")}
          disabled={loading || saving}
          options={REFRESH_METHOD_OPTIONS.map((m) => ({ value: m, label: copy(`settings.token_plan.refresh_method.${m}`) }))}
        />
        <SelectInput
          label={copy("settings.token_plan.refresh_interval")}
          value={String(form.refresh_interval_minutes)}
          onChange={updateField("refresh_interval_minutes")}
          disabled={loading || saving}
          options={REFRESH_INTERVAL_OPTIONS.map((n) => ({ value: String(n), label: `${n} min` }))}
        />
        <TextInput
          label={copy("settings.token_plan.credential_ref")}
          value={form.credential_ref}
          onChange={updateField("credential_ref")}
          disabled={loading || saving}
          placeholder="codex_auth_json"
        />
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={Boolean(form.refresh_enabled)}
            onChange={updateCheckbox("refresh_enabled")}
            disabled={loading || saving}
            className="h-4 w-4 rounded border-oai-gray-300 text-oai-brand-600 focus:ring-oai-brand-500"
          />
          <span className="text-xs text-oai-gray-700 dark:text-oai-gray-300">
            {copy("settings.token_plan.refresh_enabled")}
          </span>
        </label>
      </div>
      {(error || savedNotice) && (
        <div className="pb-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">{copy("settings.token_plan.saved")}</span>
          )}
        </div>
      )}
      <div className="border-t border-oai-gray-200 py-3 dark:border-oai-gray-800">
        {records.length === 0 ? (
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.token_plan.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {records.map((record) => (
              <div key={record.id} className="flex items-center justify-between gap-3 rounded-md border border-oai-gray-200 px-3 py-2 dark:border-oai-gray-800">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                    {record.source} / {record.plan_label}
                  </div>
                  <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {record.used_quota} / {record.total_quota} - {record.remaining_quota} {copy("settings.token_plan.remaining")}
                  </div>
                  <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("settings.token_plan.refresh_method_label")}: {copy(`settings.token_plan.refresh_method.${record.refresh_method || "manual"}`)}
                    {record.refresh_enabled ? ` · ${record.refresh_interval_minutes}min` : ""}
                    {record.last_refresh_status ? ` · ${copy(`settings.token_plan.last_refresh_status.${record.last_refresh_status}`)}` : ""}
                    {record.last_refresh_error ? ` · ${record.last_refresh_error}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => refresh(record.id)}
                    disabled={refreshingId === record.id}
                    title={copy("settings.token_plan.refresh")}
                    className="text-xs font-medium text-oai-gray-600 hover:text-oai-brand dark:text-oai-gray-300 disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshingId === record.id && "animate-spin")} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => editRecord(record)}
                    className="shrink-0 text-xs font-medium text-oai-brand hover:text-oai-brand-dark"
                  >
                    {copy("settings.token_plan.edit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function TextInput({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClassName}
      />
    </label>
  );
}

function NumberInput({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClassName}
      />
    </label>
  );
}

function SelectInput({ label, value, onChange, disabled, options }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={inputClassName}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

const inputClassName = cn(
  "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 text-xs text-oai-gray-900 outline-none transition-colors",
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
  "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
);
