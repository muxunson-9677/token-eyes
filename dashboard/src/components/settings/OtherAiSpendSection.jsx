import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  createSpendRecord,
  deleteSpendRecord,
  getSpendRecords,
  updateSpendRecord,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { copy } from "../../lib/copy";
import { SectionCard } from "./Controls.jsx";

const SOURCE = "other_ai";
const BILLING_CYCLE = "one_time";
const CURRENCIES = ["CNY", "USD"];

function todayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyForm() {
  return {
    id: null,
    plan_label: "",
    amount: "",
    currency: "CNY",
    start_date: todayString(),
    note: "",
  };
}

function formatMoney(amount, currency) {
  const symbol = String(currency).toUpperCase() === "CNY" ? "¥" : "$";
  return `${symbol}${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const inputClass =
  "w-full rounded-lg border border-oai-gray-200 bg-white px-3 py-2 text-sm text-oai-gray-900 " +
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-inset focus-visible:ring-oai-brand-500 dark:border-oai-gray-700 " +
  "dark:bg-oai-gray-900 dark:text-oai-gray-100";

export function OtherAiSpendSection() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpendRecords({
        from: "2000-01-01",
        to: todayString(),
        sources: [SOURCE],
      });
      const loadedRecords = Array.isArray(result?.records) ? result.records : [];
      setRecords(loadedRecords.filter(
        (record) => String(record.source || "").toLowerCase() === SOURCE,
      ));
    } catch (loadError) {
      console.warn("[OtherAiSpendSection] failed to load records:", loadError);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const openNew = () => {
    setError(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (record) => {
    setError(null);
    setForm({
      id: record.id,
      plan_label: record.plan_label || "",
      amount: record.amount == null ? "" : String(record.amount),
      currency: String(record.currency || "CNY").toUpperCase() === "USD" ? "USD" : "CNY",
      start_date: record.start_date || todayString(),
      note: record.note || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setSaving(false);
    setError(null);
  };

  const save = async () => {
    const amount = Number(form.amount);
    if (
      !form.plan_label.trim()
      || !Number.isFinite(amount)
      || amount <= 0
      || !form.start_date
    ) {
      setError(copy("settings.cost.other_ai.error_required"));
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      ...(form.id ? { id: form.id } : {}),
      source: SOURCE,
      plan_label: form.plan_label.trim(),
      amount,
      currency: form.currency,
      billing_cycle: BILLING_CYCLE,
      start_date: form.start_date,
      note: form.note.trim(),
    };

    try {
      const result = form.id
        ? await updateSpendRecord(payload)
        : await createSpendRecord(payload);
      if (result?.ok === false) {
        setError(result.error || copy("settings.cost.other_ai.error_save"));
        setSaving(false);
        return;
      }
      closeForm();
      await reload();
    } catch (saveError) {
      setError(saveError?.message || copy("settings.cost.other_ai.error_save"));
      setSaving(false);
    }
  };

  const remove = async (record) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.cost.other_ai.confirm_delete"))) return;
    try {
      const result = await deleteSpendRecord(record.id);
      if (result?.ok === false) return;
      await reload();
    } catch (deleteError) {
      console.error("[OtherAiSpendSection] delete failed:", deleteError);
    }
  };

  const subtotals = useMemo(() => {
    const byCurrency = new Map();
    for (const record of records) {
      const currency = String(record.currency || "CNY").toUpperCase();
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + Number(record.amount || 0));
    }
    return [...byCurrency.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([currency, amount]) => formatMoney(amount, currency))
      .join(" + ");
  }, [records]);

  return (
    <SectionCard
      title={copy("settings.cost.other_ai.title")}
      subtitle={copy("settings.cost.other_ai.subtitle")}
      action={(
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-oai-brand-600"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {copy("settings.cost.other_ai.add")}
        </button>
      )}
    >
      {formOpen && (
        <div className="mb-3 rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.name_label")}
              </span>
              <input
                type="text"
                value={form.plan_label}
                onChange={(event) => setForm((current) => ({ ...current, plan_label: event.target.value }))}
                placeholder={copy("settings.cost.other_ai.name_placeholder")}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.date_label")}
              </span>
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.amount_label")}
              </span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                placeholder={copy("settings.cost.other_ai.amount_placeholder")}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.currency_label")}
              </span>
              <select
                value={form.currency}
                onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}
                className={inputClass}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
              {copy("settings.cost.other_ai.note_label")}
            </span>
            <textarea
              rows={2}
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              placeholder={copy("settings.cost.other_ai.note_placeholder")}
              className={cn(inputClass, "resize-y")}
            />
          </label>
          {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-lg border border-oai-gray-200 px-3 py-1.5 text-xs font-medium text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
            >
              {copy("settings.cost.other_ai.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-oai-brand-600 disabled:opacity-50"
            >
              {saving ? copy("settings.cost.other_ai.saving") : copy("settings.cost.other_ai.save")}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="py-4 text-center text-sm text-oai-gray-400">
          {copy("settings.cost.other_ai.loading")}
        </div>
      )}
      {!loading && records.length === 0 && !formOpen && (
        <div className="py-4 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.cost.other_ai.empty")}
        </div>
      )}
      {!loading && records.length !== 0 && (
        <>
          <ul className="flex flex-col divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
            {records.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                      {record.plan_label}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                      {formatMoney(record.amount, record.currency)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {record.start_date ? <span className="tabular-nums">{record.start_date}</span> : null}
                    {record.note ? <span className="truncate">{record.note}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(record)}
                    aria-label={copy("settings.cost.other_ai.edit")}
                    className="rounded-md p-1.5 text-oai-gray-400 hover:bg-oai-gray-100 hover:text-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(record)}
                    aria-label={copy("settings.cost.other_ai.delete")}
                    className="rounded-md p-1.5 text-oai-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {subtotals ? (
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-oai-gray-100 pt-2 text-sm dark:border-oai-gray-800">
              <span className="text-oai-gray-500 dark:text-oai-gray-400">
                {copy("settings.cost.other_ai.subtotal")}
              </span>
              <span className="font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                {subtotals}
              </span>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
