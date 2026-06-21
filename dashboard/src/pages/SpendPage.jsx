import React, { useEffect, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { createSpendRecord, deleteSpendRecord, getSpendRecords, updateSpendRecord } from "../lib/api";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";

const EMPTY_FORM = {
  source: "",
  plan_label: "",
  amount: 0,
  currency: "USD",
  billing_cycle: "monthly",
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  note: "",
};

function formatAmount(value, currency) {
  const numberValue = Number(value || 0);
  return `${currency} ${numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDualAmount(usd, cny) {
  return (
    <div className="flex flex-col">
      <span className="tabular-nums">{formatAmount(usd, "USD")}</span>
      <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">{formatAmount(cny, "CNY")}</span>
    </div>
  );
}

export function SpendPage() {
  const [records, setRecords] = useState([]);
  const [totals, setTotals] = useState(null);
  const [bySource, setBySource] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const applyResult = (result) => {
    setRecords(Array.isArray(result?.records) ? result.records : []);
    setTotals(result?.totals || null);
    setBySource(Array.isArray(result?.by_source) ? result.by_source : []);
  };

  const fetchRecords = () => {
    setLoading(true);
    getSpendRecords()
      .then((result) => {
        applyResult(result);
        setError("");
      })
      .catch((err) => {
        setError(err?.message || copy("spend.load_error"));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecords();
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
      const result = editingId
        ? await updateSpendRecord({ ...form, id: editingId })
        : await createSpendRecord(form);
      applyResult(result);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch (err) {
      setError(err?.message || copy("spend.save_error"));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (record) => {
    setEditingId(record.id);
    setForm({
      source: record.source || "",
      plan_label: record.plan_label || "",
      amount: record.amount || 0,
      currency: record.currency || "USD",
      billing_cycle: record.billing_cycle || "monthly",
      start_date: record.start_date || new Date().toISOString().slice(0, 10),
      end_date: record.end_date || "",
      note: record.note || "",
    });
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
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

          {/* Summary Cards */}
          {totals && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryTile label={copy("spend.monthly_api")} value={formatDualAmount(totals.api_usd, totals.api_cny)} />
              <SummaryTile label={copy("spend.monthly_subscription")} value={formatDualAmount(totals.subscription_usd, totals.subscription_cny)} />
              <SummaryTile label={copy("spend.monthly_combined")} value={formatDualAmount(totals.combined_usd, totals.combined_cny)} />
              <SummaryTile label={copy("spend.lifetime_combined")} value={formatDualAmount(totals.lifetime_combined_usd, totals.lifetime_combined_cny)} />
            </div>
          )}

          {/* By Source Breakdown */}
          {bySource.length > 0 && (
            <div className="mb-6 rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
              <h2 className="mb-3 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
                {copy("spend.by_source_title")}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-oai-gray-200 dark:border-oai-gray-800">
                      <th className="py-2 text-left font-medium text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.source")}</th>
                      <th className="py-2 text-right font-medium text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.subscription_cost")}</th>
                      <th className="py-2 text-right font-medium text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.api_cost")}</th>
                      <th className="py-2 text-right font-medium text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.combined_cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySource.map((src) => (
                      <tr key={src.source} className="border-b border-oai-gray-100 last:border-0 dark:border-oai-gray-900">
                        <td className="py-2 font-medium text-oai-gray-800 dark:text-oai-gray-200 capitalize">{src.source}</td>
                        <td className="py-2 text-right tabular-nums">
                          <div>{formatAmount(src.subscription_usd, "USD")}</div>
                          <div className="text-oai-gray-400 dark:text-oai-gray-600">{formatAmount(src.subscription_cny, "CNY")}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          <div>{formatAmount(src.api_usd, "USD")}</div>
                          <div className="text-oai-gray-400 dark:text-oai-gray-600">{formatAmount(src.api_cny, "CNY")}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          <div>{formatAmount(src.combined_usd, "USD")}</div>
                          <div className="text-oai-gray-400 dark:text-oai-gray-600">{formatAmount(src.combined_cny, "CNY")}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Add/Edit Form */}
          <form onSubmit={save} className="mb-6 rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
            <h2 className="mb-3 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
              {editingId ? copy("spend.edit_record") : copy("spend.add_record")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TextInput label={copy("spend.source")} value={form.source} onChange={updateField("source")} disabled={saving} placeholder={copy("spend.source_placeholder")} />
              <TextInput label={copy("spend.plan_label")} value={form.plan_label} onChange={updateField("plan_label")} disabled={saving} placeholder={copy("spend.plan_label_placeholder")} />
              <NumberInput label={copy("spend.amount")} value={form.amount} onChange={updateField("amount")} disabled={saving} />
              <label className="block">
                <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.currency")}</span>
                <select value={form.currency} onChange={updateField("currency")} disabled={saving} className={inputClassName}>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{copy("spend.billing_cycle")}</span>
                <select value={form.billing_cycle} onChange={updateField("billing_cycle")} disabled={saving} className={inputClassName}>
                  <option value="monthly">{copy("spend.cycle_monthly")}</option>
                  <option value="yearly">{copy("spend.cycle_yearly")}</option>
                  <option value="one_time">{copy("spend.cycle_one_time")}</option>
                </select>
              </label>
              <TextInput label={copy("spend.start_date")} value={form.start_date} onChange={updateField("start_date")} disabled={saving} placeholder="YYYY-MM-DD" />
              <TextInput label={copy("spend.end_date")} value={form.end_date} onChange={updateField("end_date")} disabled={saving} placeholder={copy("spend.end_date_placeholder")} />
              <TextInput label={copy("spend.note")} value={form.note} onChange={updateField("note")} disabled={saving} placeholder={copy("spend.note_placeholder")} />
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : <span />}
              <div className="flex gap-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="inline-flex h-9 items-center rounded-md border border-oai-gray-200 px-3 text-sm font-medium text-oai-gray-600 hover:bg-oai-gray-100 disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800"
                  >
                    {copy("spend.cancel")}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!canSave}
                  className="inline-flex h-9 items-center rounded-md border border-oai-gray-200 px-4 text-sm font-medium text-oai-gray-800 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
                >
                  {saving ? copy("spend.saving") : (editingId ? copy("spend.save_edit") : copy("spend.add"))}
                </button>
              </div>
            </div>
          </form>

          {/* Records List */}
          <div className="space-y-2">
            {loading ? (
              <div className="rounded-lg border border-oai-gray-200 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
                {copy("spend.loading")}
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-lg border border-oai-gray-200 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
                {copy("spend.empty")}
              </div>
            ) : (
              records.map((record) => (
                <div key={record.id} className="flex items-center justify-between gap-4 rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                        {record.source} / {record.plan_label}
                      </span>
                      <span className="shrink-0 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                        {record.billing_cycle === "monthly" ? copy("spend.cycle_monthly_short") :
                         record.billing_cycle === "yearly" ? copy("spend.cycle_yearly_short") :
                         copy("spend.cycle_one_time_short")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      <span>{formatAmount(record.amount, record.currency)}</span>
                      <span>{record.start_date}{record.end_date ? ` ~ ${record.end_date}` : ""}</span>
                      {record.note ? <span className="truncate max-w-[200px]">{record.note}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(record)}
                      disabled={saving}
                      aria-label={copy("spend.edit")}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-oai-gray-500 hover:bg-oai-gray-100 hover:text-oai-brand-500 disabled:opacity-50 dark:hover:bg-oai-gray-800"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
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
      <div className="mt-2 text-2xl font-semibold text-oai-gray-900 dark:text-oai-gray-100">{value}</div>
    </div>
  );
}

function TextInput({ label, value, onChange, disabled, placeholder }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input type="text" value={value} onChange={onChange} disabled={disabled} placeholder={placeholder} className={inputClassName} />
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
