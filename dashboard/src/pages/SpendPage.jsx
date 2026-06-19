import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { createSpendRecord, deleteSpendRecord, getSpendRecords } from "../lib/api";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";

const EMPTY_FORM = {
  source: "",
  plan_label: "",
  amount: 0,
  currency: "USD",
  note: "",
};

function formatAmount(value, currency) {
  const numberValue = Number(value || 0);
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function SpendPage() {
  const [records, setRecords] = useState([]);
  const [totals, setTotals] = useState({ total_usd: 0, total_cny: 0 });
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyResult = (result) => {
    setRecords(Array.isArray(result?.records) ? result.records : []);
    setTotals(result?.totals || { total_usd: 0, total_cny: 0 });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSpendRecords()
      .then((result) => {
        if (cancelled) return;
        applyResult(result);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("spend.load_error"));
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
      [field]: field === "amount" ? Number(value || 0) : value,
    }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await createSpendRecord(form);
      applyResult(result);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err?.message || copy("spend.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setSaving(true);
    setError("");
    try {
      const result = await deleteSpendRecord(id);
      applyResult(result);
    } catch (err) {
      setError(err?.message || copy("spend.delete_error"));
    } finally {
      setSaving(false);
    }
  };

  const canSave = !loading && !saving && form.source.trim() && form.plan_label.trim() && Number(form.amount) > 0;

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
              {copy("spend.page.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("spend.page.subtitle")}
            </p>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <SummaryTile label={copy("spend.total_usd")} value={formatAmount(totals.total_usd, "USD")} />
            <SummaryTile label={copy("spend.total_cny")} value={formatAmount(totals.total_cny, "CNY")} />
          </div>

          <form onSubmit={save} className="mb-6 rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TextInput label={copy("spend.source")} value={form.source} onChange={updateField("source")} disabled={saving} />
              <TextInput label={copy("spend.plan_label")} value={form.plan_label} onChange={updateField("plan_label")} disabled={saving} />
              <NumberInput label={copy("spend.amount")} value={form.amount} onChange={updateField("amount")} disabled={saving} />
              <label className="block">
                <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.currency")}</span>
                <select value={form.currency} onChange={updateField("currency")} disabled={saving} className={inputClassName}>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
              </label>
              <TextInput label={copy("spend.note")} value={form.note} onChange={updateField("note")} disabled={saving} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : <span />}
              <button
                type="submit"
                disabled={!canSave}
                className="inline-flex h-9 items-center rounded-md border border-oai-gray-200 px-4 text-sm font-medium text-oai-gray-800 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
              >
                {saving ? copy("spend.saving") : copy("spend.add")}
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {records.length === 0 ? (
              <div className="rounded-lg border border-oai-gray-200 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
                {copy("spend.empty")}
              </div>
            ) : (
              records.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-4 rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                      {record.source} / {record.plan_label}
                    </div>
                    <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {formatAmount(record.amount, record.currency)}{record.note ? ` - ${record.note}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(record.id)}
                    disabled={saving}
                    aria-label={copy("spend.delete")}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-oai-gray-500 hover:bg-oai-gray-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-oai-gray-800"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SummaryTile({ label, value }) {
  return (
    <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
      <div className="text-xs uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">{value}</div>
    </div>
  );
}

function TextInput({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input type="text" value={value} onChange={onChange} disabled={disabled} className={inputClassName} />
    </label>
  );
}

function NumberInput({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input type="number" min="0" step="0.01" value={value} onChange={onChange} disabled={disabled} className={inputClassName} />
    </label>
  );
}

const inputClassName = cn(
  "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 text-xs text-oai-gray-900 outline-none transition-colors",
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
  "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
);
