import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { SectionCard } from "./Controls.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import {
  getSpendRecords,
  createSpendRecord,
  updateSpendRecord,
  deleteSpendRecord,
} from "../../lib/api";

/**
 * 成本设置第三项：【其他 AI 花销】。
 *
 * 记录未被自动统计覆盖的 AI 花销（例如已封禁账号的历史充值），支持备注与
 * 自定义金额。数据复用后端 spendRecords 存储，固定 source="other_ai" +
 * billing_cycle="one_time"，因此不会被「使用统计 / 成本累积」按来源过滤的
 * 总成本重复计入 —— 是一份独立、可查的手工花销清单。
 */

const SOURCE = "other_ai";
const CURRENCIES = ["CNY", "USD"];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const EMPTY_FORM = {
  id: null,
  plan_label: "",
  amount: "",
  currency: "CNY",
  start_date: todayStr(),
  note: "",
};

function formatMoney(amount, currency) {
  const n = Number(amount || 0);
  const symbol = String(currency).toUpperCase() === "CNY" ? "¥" : "$";
  return `${symbol}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const inputClass =
  "w-full rounded-lg border border-oai-gray-200 bg-white px-3 py-2 text-sm text-oai-gray-900 " +
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-oai-brand-500 focus-visible:ring-inset dark:border-oai-gray-700 dark:bg-oai-gray-900 " +
  "dark:text-oai-gray-100";

export function OtherAiSpendSection() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpendRecords({ from: "2000-01-01", to: todayStr(), sources: [SOURCE] });
      const rows = Array.isArray(result?.records) ? result.records : [];
      // Defensive: only keep our own manual entries even if the backend
      // contract changes to ignore the sources filter.
      setRecords(rows.filter((r) => String(r.source || "").toLowerCase() === SOURCE));
    } catch (err) {
      console.warn("[OtherAiSpendSection] failed to load records:", err);
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
    setForm({ ...EMPTY_FORM, start_date: todayStr() });
    setFormOpen(true);
  };

  const openEdit = (record) => {
    setError(null);
    setForm({
      id: record.id,
      plan_label: record.plan_label || "",
      amount: record.amount != null ? String(record.amount) : "",
      currency: String(record.currency || "CNY").toUpperCase() === "USD" ? "USD" : "CNY",
      start_date: record.start_date || todayStr(),
      note: record.note || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setError(null);
    setSaving(false);
  };

  const handleSave = async () => {
    const amountNum = Number(form.amount);
    if (!form.plan_label.trim() || !Number.isFinite(amountNum) || amountNum <= 0) {
      setError(copy("settings.cost.other_ai.error_required"));
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      ...(form.id ? { id: form.id } : {}),
      source: SOURCE,
      plan_label: form.plan_label.trim(),
      amount: amountNum,
      currency: form.currency,
      billing_cycle: "one_time",
      start_date: form.start_date || todayStr(),
      note: form.note.trim(),
    };
    try {
      const result = form.id ? await updateSpendRecord(payload) : await createSpendRecord(payload);
      if (result?.ok === false) {
        setError(result?.error || copy("settings.cost.other_ai.error_save"));
        setSaving(false);
        return;
      }
      closeForm();
      await reload();
    } catch (err) {
      setError(err?.message || copy("settings.cost.other_ai.error_save"));
      setSaving(false);
    }
  };

  const handleDelete = async (record) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.cost.other_ai.confirm_delete"))) return;
    try {
      await deleteSpendRecord(record.id);
      await reload();
    } catch (err) {
      console.error("[OtherAiSpendSection] delete failed:", err);
    }
  };

  const subtotalText = useMemo(() => {
    const acc = {};
    for (const r of records) {
      const cur = String(r.currency || "CNY").toUpperCase();
      acc[cur] = (acc[cur] || 0) + Number(r.amount || 0);
    }
    return Object.entries(acc)
      .filter(([, v]) => v > 0)
      .map(([cur, v]) => formatMoney(v, cur))
      .join("  +  ");
  }, [records]);

  const addButton = (
    <button
      type="button"
      onClick={openNew}
      className="inline-flex items-center gap-1.5 rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-oai-brand-600"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {copy("settings.cost.other_ai.add")}
    </button>
  );

  return (
    <SectionCard
      title={copy("settings.cost.other_ai.title")}
      subtitle={copy("settings.cost.other_ai.subtitle")}
      action={addButton}
    >
      {formOpen && (
        <div className="mb-4 rounded-lg border border-oai-gray-200 p-3 dark:border-oai-gray-800">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.name_label")}
              </span>
              <input
                type="text"
                value={form.plan_label}
                onChange={(e) => setForm((f) => ({ ...f, plan_label: e.target.value }))}
                placeholder={copy("settings.cost.other_ai.name_placeholder")}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.date_label")}
              </span>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.amount_label")}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("settings.cost.other_ai.currency_label")}
              </span>
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className={inputClass}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
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
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder={copy("settings.cost.other_ai.note_placeholder")}
              className={cn(inputClass, "resize-y")}
            />
          </label>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
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
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-oai-brand-600 disabled:opacity-50"
            >
              {saving ? copy("settings.cost.other_ai.saving") : copy("settings.cost.other_ai.save")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-4 text-center text-sm text-oai-gray-400">
          {copy("settings.cost.other_ai.loading")}
        </div>
      ) : records.length === 0 ? (
        !formOpen && (
          <div className="py-4 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.cost.other_ai.empty")}
          </div>
        )
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
            {records.map((record) => (
              <li key={record.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">
                      {record.plan_label || "—"}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                      {formatMoney(record.amount, record.currency)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {record.start_date && <span className="tabular-nums">{record.start_date}</span>}
                    {record.note && (
                      <>
                        {record.start_date && <span aria-hidden="true">·</span>}
                        <span className="truncate">{record.note}</span>
                      </>
                    )}
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
                    onClick={() => handleDelete(record)}
                    aria-label={copy("settings.cost.other_ai.delete")}
                    className="rounded-md p-1.5 text-oai-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {subtotalText && (
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-oai-gray-100 pt-2 text-sm dark:border-oai-gray-800">
              <span className="text-oai-gray-500 dark:text-oai-gray-400">
                {copy("settings.cost.other_ai.subtotal")}
              </span>
              <span className="font-semibold tabular-nums text-oai-gray-900 dark:text-oai-gray-100">
                {subtotalText}
              </span>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
