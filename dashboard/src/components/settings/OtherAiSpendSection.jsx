import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Atom, ChevronDown, ChevronUp, GripVertical, MoreVertical, Pencil, Plus, Star, Trash2, WalletCards } from "lucide-react";
import {
  createSpendRecord,
  deleteOtherAiSpendGroup,
  deleteSpendRecord,
  getSpendRecords,
  reorderOtherAiSpendRecords,
  saveOtherAiSpendGroup,
  updateSpendRecord,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { copy } from "../../lib/copy";
import { SectionCard } from "./Controls.jsx";

const SOURCE = "other_ai";
const BILLING_CYCLE = "one_time";
const CURRENCIES = ["CNY", "USD"];
const UNGROUPED_ID = "";
const GROUP_DROP_PREFIX = "group:";

export function resolveSpendRecordDrop(records, activeId, overId) {
  const active = records.find((record) => record.id === activeId);
  if (!active) return null;
  const overKey = String(overId || "");
  const target = records.find((record) => record.id === overKey);
  const groupId = overKey.startsWith(GROUP_DROP_PREFIX)
    ? overKey.slice(GROUP_DROP_PREFIX.length)
    : String(target?.group_id || "");
  const moved = { ...active, group_id: groupId };
  const remaining = records.filter((record) => record.id !== activeId);
  let insertAt = remaining.length;
  if (target) {
    insertAt = Math.max(0, remaining.findIndex((record) => record.id === target.id));
  } else {
    const lastInGroup = remaining.reduce((last, record, index) => (
      String(record.group_id || "") === groupId ? index : last
    ), -1);
    if (lastInGroup >= 0) insertAt = lastInGroup + 1;
  }
  const next = [...remaining];
  next.splice(insertAt, 0, moved);
  return { records: next, groupId };
}

function GroupDropZone({ groupId, children, className, ...props }) {
  const { isOver, setNodeRef } = useDroppable({ id: `${GROUP_DROP_PREFIX}${groupId}` });
  return (
    <section ref={setNodeRef} className={cn(className, isOver && "ring-2 ring-oai-brand-400/50")} {...props}>
      {children}
    </section>
  );
}

function todayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyForm() {
  return { id: null, plan_label: "", amount: "", currency: "CNY", start_date: todayString(), note: "", group_id: "" };
}

function formatMoney(amount, currency) {
  const symbol = String(currency).toUpperCase() === "CNY" ? "¥" : "$";
  return `${symbol}${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputClass =
  "w-full rounded-lg border border-oai-gray-200 bg-white px-3 py-2 text-sm text-oai-gray-900 " +
  "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-inset focus-visible:ring-oai-brand-500 dark:border-oai-gray-700 " +
  "dark:bg-oai-gray-900 dark:text-oai-gray-100";

function SortableSpendRow({ record, number, expanded, onToggle, onEdit, onDelete, onFavorite, editor }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: record.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-oai-gray-100 bg-white shadow-sm transition dark:border-oai-gray-800 dark:bg-oai-gray-900",
        isDragging && "z-10 shadow-lg ring-2 ring-oai-brand-400/40",
      )}
    >
      <div className="tt-other-ai-row flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={copy("settings.cost.other_ai.drag")}
          className="cursor-grab rounded-md p-1 text-oai-gray-400 hover:bg-oai-gray-100 active:cursor-grabbing dark:hover:bg-oai-gray-800"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-oai-gray-100 px-1.5 text-xs font-semibold tabular-nums text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-300">
          {number}
        </span>
        <button type="button" onClick={onToggle} className="tt-other-ai-row-main min-w-0 flex-1 text-left">
          <div className="tt-other-ai-row-primary flex items-center gap-2">
            <span className="tt-other-ai-row-title truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-100">{record.plan_label}</span>
            <span className="tt-other-ai-row-cost shrink-0 text-sm font-semibold tabular-nums text-emerald-600">
              {formatMoney(record.amount, record.currency)}
            </span>
          </div>
          <div className="tt-other-ai-row-note mt-0.5 truncate text-xs text-oai-gray-400">{record.note || "—"}</div>
        </button>
        <time className="tt-other-ai-row-date shrink-0 text-xs tabular-nums text-oai-gray-500" dateTime={record.start_date}>{record.start_date || "—"}</time>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={copy(record.favorite ? "settings.cost.other_ai.unfavorite" : "settings.cost.other_ai.favorite")}
          className={cn("rounded-md p-1.5", record.favorite ? "text-amber-500" : "text-oai-gray-300 hover:text-amber-500")}
        >
          <Star className={cn("h-4 w-4", record.favorite && "fill-current")} aria-hidden="true" />
        </button>
        <button type="button" onClick={onEdit} aria-label={copy("settings.cost.other_ai.edit")} className="rounded-md p-1.5 text-oai-gray-400 hover:bg-oai-gray-100 hover:text-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onDelete} aria-label={copy("settings.cost.other_ai.delete")} className="rounded-md p-1.5 text-oai-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={onToggle} aria-label={copy("settings.cost.other_ai.details")} className="rounded-md p-1.5 text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-oai-gray-100 px-3 py-2 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="tabular-nums">{record.start_date || "—"}</span>
            <span>{record.note || copy("settings.cost.other_ai.no_note")}</span>
          </div>
        </div>
      ) : null}
      {editor}
    </li>
  );
}

export function OtherAiSpendSection() {
  const [records, setRecords] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupParentId, setGroupParentId] = useState("");
  const [groupEditingId, setGroupEditingId] = useState("");
  const [groupFormInline, setGroupFormInline] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(() => new Set());
  const [openGroupMenuId, setOpenGroupMenuId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpendRecords({ from: "2000-01-01", to: todayString(), sources: [SOURCE] });
      const loaded = Array.isArray(result?.records) ? result.records : [];
      setRecords(loaded.filter((record) => String(record.source || "").toLowerCase() === SOURCE));
      setGroups(Array.isArray(result?.other_ai_groups) ? result.other_ai_groups : []);
      setError(null);
    } catch (loadError) {
      console.warn("[OtherAiSpendSection] failed to load records:", loadError);
      setError(copy("settings.cost.other_ai.error_load"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openNew = () => { setError(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (record) => {
    setError(null);
    setForm({
      id: record.id,
      plan_label: record.plan_label || "",
      amount: record.amount == null ? "" : String(record.amount),
      currency: String(record.currency || "CNY").toUpperCase() === "USD" ? "USD" : "CNY",
      start_date: record.start_date || todayString(),
      note: record.note || "",
      group_id: record.group_id || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); setSaving(false); setError(null); };

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.plan_label.trim() || !Number.isFinite(amount) || amount <= 0 || !form.start_date) {
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
      ...(form.group_id ? { group_id: form.group_id } : {}),
    };
    try {
      const result = form.id ? await updateSpendRecord(payload) : await createSpendRecord(payload);
      if (result?.ok === false) throw new Error(result.error || copy("settings.cost.other_ai.error_save"));
      if (result?.record) setRecords((current) => [result.record, ...current.filter((record) => record.id !== result.record.id)]);
      setFormOpen(false);
      setSaving(false);
      await reload();
    } catch (saveError) {
      setError(saveError?.message || copy("settings.cost.other_ai.error_save"));
      setSaving(false);
    }
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    try {
      const result = await saveOtherAiSpendGroup({
        ...(groupEditingId ? { id: groupEditingId } : {}),
        name,
        ...(groupParentId ? { parent_id: groupParentId } : {}),
      });
      if (result?.ok === false) throw new Error(result.error);
      if (result?.group) setGroups((current) => groupEditingId
        ? current.map((group) => group.id === groupEditingId ? result.group : group)
        : [...current, result.group]);
      setGroupName("");
      setGroupParentId("");
      setGroupEditingId("");
      setGroupFormInline(false);
      setGroupFormOpen(false);
    } catch (groupError) {
      setError(groupError?.message || copy("settings.cost.other_ai.error_group"));
    }
  };

  const openGroupForm = (parentId = "", group = null) => {
    setGroupParentId(parentId || group?.parent_id || "");
    setGroupName(group?.name || "");
    setGroupEditingId(group?.id || "");
    setGroupFormInline(Boolean(parentId || group));
    setGroupFormOpen(true);
  };

  const closeGroupForm = () => {
    setGroupFormOpen(false);
    setGroupName("");
    setGroupParentId("");
    setGroupEditingId("");
    setGroupFormInline(false);
  };

  const toggleGroupFavorite = async (group) => {
    const next = { ...group, favorite: !group.favorite };
    setGroups((current) => current.map((item) => item.id === group.id ? next : item));
    try {
      const result = await saveOtherAiSpendGroup(next);
      if (result?.ok === false) throw new Error(result.error);
    } catch (favoriteError) {
      setGroups((current) => current.map((item) => item.id === group.id ? group : item));
      setError(favoriteError?.message || copy("settings.cost.other_ai.error_group"));
    }
  };

  const removeGroup = async (group) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.cost.other_ai.confirm_delete_group"))) return;
    try {
      await deleteOtherAiSpendGroup(group.id);
      const removedIds = new Set([group.id, ...groups.filter((item) => item.parent_id === group.id).map((item) => item.id)]);
      setGroups((current) => current.filter((item) => !removedIds.has(item.id)));
      setRecords((current) => current.map((record) => removedIds.has(record.group_id) ? { ...record, group_id: "" } : record));
    } catch (groupError) {
      setError(groupError?.message || copy("settings.cost.other_ai.error_group"));
    }
  };

  const remove = async (record) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(copy("settings.cost.other_ai.confirm_delete"))) return;
    setError(null);
    try {
      const result = await deleteSpendRecord(record.id);
      if (result?.ok === false) throw new Error(result.error || copy("settings.cost.other_ai.error_delete"));
      setRecords((current) => current.filter((item) => item.id !== record.id));
      await reload();
    } catch (deleteError) {
      console.error("[OtherAiSpendSection] delete failed:", deleteError);
      setError(deleteError?.message || copy("settings.cost.other_ai.error_delete"));
    }
  };

  const toggleFavorite = async (record) => {
    const next = { ...record, favorite: !record.favorite };
    setRecords((current) => current.map((item) => item.id === record.id ? next : item));
    try {
      const result = await updateSpendRecord(next);
      if (result?.ok === false) throw new Error(result.error);
    } catch (favoriteError) {
      setRecords((current) => current.map((item) => item.id === record.id ? record : item));
      setError(favoriteError?.message || copy("settings.cost.other_ai.error_save"));
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const resolved = resolveSpendRecordDrop(records, active.id, over.id);
    if (!resolved) return;
    const previous = records;
    const next = resolved.records;
    setRecords(next);
    try {
      await reorderOtherAiSpendRecords(next.map((record) => record.id), {
        moved_id: String(active.id),
        group_id: resolved.groupId,
      });
    } catch (reorderError) {
      setRecords(previous);
      setError(reorderError?.message || copy("settings.cost.other_ai.error_reorder"));
    }
  };

  const subtotals = useMemo(() => {
    const byCurrency = new Map();
    for (const record of records) {
      const currency = String(record.currency || "CNY").toUpperCase();
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + Number(record.amount || 0));
    }
    return [...byCurrency.entries()].filter(([, amount]) => amount > 0).map(([currency, amount]) => formatMoney(amount, currency)).join(" + ");
  }, [records]);
  const currentMonthTotal = useMemo(() => {
    const month = todayString().slice(0, 7);
    return records.reduce((total, record) => (
      String(record.start_date || "").startsWith(month) ? total + Number(record.amount || 0) : total
    ), 0);
  }, [records]);

  const rootGroups = useMemo(() => [
    ...groups.filter((group) => !group.parent_id),
    { id: UNGROUPED_ID, name: copy("settings.cost.other_ai.ungrouped"), parent_id: null, sort_order: Number.MAX_SAFE_INTEGER },
  ], [groups]);
  const numberById = useMemo(
    () => new Map(records.map(function numberRecord(record, index) {
      return [record.id, index + 1];
    })),
    [records],
  );

  const renderEditor = () => (
    <form noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="m-2 rounded-xl border border-oai-gray-200 bg-oai-gray-50/70 p-3 dark:border-oai-gray-800 dark:bg-oai-gray-900/60">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.name_label")}</span><input type="text" value={form.plan_label} onChange={(event) => setForm((current) => ({ ...current, plan_label: event.target.value }))} placeholder={copy("settings.cost.other_ai.name_placeholder")} className={inputClass} required /></label>
        <label><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.date_label")}</span><input type="date" value={form.start_date} onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))} className={inputClass} required /></label>
        <label><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.amount_label")}</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder={copy("settings.cost.other_ai.amount_placeholder")} className={inputClass} required /></label>
        <label><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.currency_label")}</span><select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} className={inputClass}>{CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.group_label")}</span><select value={form.group_id} onChange={(event) => setForm((current) => ({ ...current, group_id: event.target.value }))} className={inputClass}><option value="">{copy("settings.cost.other_ai.ungrouped")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.parent_id ? "↳ " : ""}{group.name}</option>)}</select></label>
      </div>
      <label className="mt-3 block"><span className="mb-1 block text-xs font-medium">{copy("settings.cost.other_ai.note_label")}</span><textarea rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder={copy("settings.cost.other_ai.note_placeholder")} className={cn(inputClass, "resize-y")} /></label>
      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={closeForm} className="rounded-lg border border-oai-gray-200 px-3 py-1.5 text-xs dark:border-oai-gray-700">{copy("settings.cost.other_ai.cancel")}</button><button type="submit" disabled={saving} className="rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{saving ? copy("settings.cost.other_ai.saving") : copy("settings.cost.other_ai.save")}</button></div>
    </form>
  );

  const renderGroupEditor = () => (
    <div className="mb-3 grid grid-cols-1 items-end gap-2 rounded-xl border border-oai-gray-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto_auto] dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">{copy("settings.cost.other_ai.group_name")}</span>
        <input value={groupName} onChange={(event) => setGroupName(event.target.value)} className={inputClass} />
      </label>
      <label className="min-w-0">
        <span className="mb-1 block text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">{copy("settings.cost.other_ai.parent_group")}</span>
        <select value={groupParentId} onChange={(event) => setGroupParentId(event.target.value)} disabled={Boolean(groupParentId)} className={inputClass}>
          <option value="">{copy("settings.cost.other_ai.root_group")}</option>
          {groups.filter((group) => (
            group.id !== groupEditingId && (!group.parent_id || group.id === groupParentId)
          )).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={saveGroup} className="rounded-lg bg-oai-brand-500 px-3 py-2 text-xs font-medium text-white">{copy("settings.cost.other_ai.save_group")}</button>
      <button type="button" onClick={closeGroupForm} className="rounded-lg border border-oai-gray-200 px-3 py-2 text-xs dark:border-oai-gray-700">{copy("settings.cost.other_ai.cancel")}</button>
    </div>
  );

  const renderGroup = (group, depth = 0) => {
    const groupRecords = records.filter((record) => (record.group_id || "") === group.id);
    const groupSubtotal = groupRecords.reduce((total, record) => total + Number(record.amount || 0), 0);
    const children = group.id ? groups.filter((candidate) => candidate.parent_id === group.id) : [];
    if (!groupRecords.length && !children.length && group.id === UNGROUPED_ID) return null;
    const collapsed = collapsedGroupIds.has(group.id || "ungrouped");
    const disclosureLabel = `${copy(collapsed ? "settings.cost.other_ai.expand_group" : "settings.cost.other_ai.collapse_group")} ${group.name}`;
    let recordList = null;
    if (groupRecords.length) {
      recordList = (
        <ul className="space-y-2">
          {groupRecords.map((record) => <SortableSpendRow key={record.id} record={record} number={numberById.get(record.id)} expanded={expandedId === record.id} onToggle={() => setExpandedId((current) => current === record.id ? null : record.id)} onEdit={() => openEdit(record)} onDelete={() => remove(record)} onFavorite={() => toggleFavorite(record)} editor={formOpen && form.id === record.id ? renderEditor() : null} />)}
        </ul>
      );
    } else if (!children.length) {
      recordList = (
        <div className="py-3 text-center text-xs text-oai-gray-400">{copy("settings.cost.other_ai.group_empty")}</div>
      );
    }
    return (
      <GroupDropZone key={group.id || "ungrouped"} groupId={group.id} className={cn("rounded-xl bg-oai-gray-50/60 p-2.5 transition dark:bg-oai-gray-950/30", depth > 0 && "ml-5 border-l-2 border-oai-gray-200 dark:border-oai-gray-700")} data-testid={`other-ai-group-${group.id || "ungrouped"}`}>
        <div className="mb-2 flex items-center justify-between px-1">
          <button type="button" aria-label={disclosureLabel} aria-expanded={!collapsed} onClick={() => setCollapsedGroupIds((current) => { const next = new Set(current); const id = group.id || "ungrouped"; if (next.has(id)) next.delete(id); else next.add(id); return next; })} className="flex min-w-0 items-center gap-2 text-left">
            {collapsed ? <ChevronDown className="h-4 w-4 text-oai-gray-400" /> : <ChevronUp className="h-4 w-4 text-oai-gray-400" />}
            <h3 className="truncate text-sm font-semibold text-oai-gray-800 dark:text-oai-gray-100">{group.name}</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-oai-gray-400 shadow-sm dark:bg-oai-gray-900">{groupRecords.length}</span>
            <span className="tt-other-ai-group-subtotal text-xs text-oai-gray-500">小计 {formatMoney(groupSubtotal, "CNY")}</span>
          </button>
          {group.id ? (
            <div className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={() => openGroupForm(group.id)}
                aria-label={`${copy("settings.cost.other_ai.add_subgroup")} ${group.name}`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-oai-gray-500 hover:bg-white hover:text-oai-brand-600 dark:hover:bg-oai-gray-900"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {copy("settings.cost.other_ai.add_subgroup")}
              </button>
              <span className="tt-other-ai-direct-group-actions contents">
                <button type="button" onClick={() => toggleGroupFavorite(group)} aria-label={`${copy(group.favorite ? "settings.cost.other_ai.unfavorite_group" : "settings.cost.other_ai.favorite_group")} ${group.name}`} className={cn("rounded-md p-1", group.favorite ? "text-amber-500" : "text-oai-gray-400 hover:text-amber-500")}><Star className={cn("h-4 w-4", group.favorite && "fill-current")} /></button>
                <button type="button" onClick={() => openGroupForm(group.parent_id || "", group)} aria-label={`${copy("settings.cost.other_ai.edit_group")} ${group.name}`} className="rounded-md p-1 text-oai-gray-400 hover:bg-white hover:text-oai-brand-600 dark:hover:bg-oai-gray-900"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => removeGroup(group)} aria-label={copy("settings.cost.other_ai.delete_group")} className="rounded-md p-1 text-oai-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </span>
              <button type="button" onClick={() => setOpenGroupMenuId((current) => current === group.id ? null : group.id)} aria-label={`${group.name} 分组操作`} className="tt-other-ai-group-menu-trigger hidden rounded-md p-1 text-oai-gray-500 hover:bg-white"><MoreVertical className="h-4 w-4" /></button>
              {openGroupMenuId === group.id ? (
                <div className="tt-other-ai-group-menu absolute right-0 top-7 z-20 grid min-w-28 gap-1 rounded-lg border border-oai-gray-200 bg-white p-1 text-xs shadow-lg">
                  <button type="button" onClick={() => { toggleGroupFavorite(group); setOpenGroupMenuId(null); }} className="rounded px-2 py-1.5 text-left hover:bg-oai-gray-50">{copy(group.favorite ? "settings.cost.other_ai.unfavorite_group" : "settings.cost.other_ai.favorite_group")}</button>
                  <button type="button" onClick={() => { openGroupForm(group.parent_id || "", group); setOpenGroupMenuId(null); }} className="rounded px-2 py-1.5 text-left hover:bg-oai-gray-50">{copy("settings.cost.other_ai.edit_group")}</button>
                  <button type="button" onClick={() => { removeGroup(group); setOpenGroupMenuId(null); }} className="rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50">{copy("settings.cost.other_ai.delete_group")}</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {!collapsed ? (
          <>
            {groupFormOpen && groupFormInline && ((groupParentId && group.id === groupParentId && !groupEditingId) || groupEditingId === group.id) ? renderGroupEditor() : null}
            {recordList}
            {children.length ? <div className="mt-2 space-y-2">{children.map((child) => renderGroup(child, depth + 1))}</div> : null}
          </>
        ) : null}
      </GroupDropZone>
    );
  };

  return (
    <SectionCard
      title={copy("settings.cost.other_ai.title")}
      subtitle={copy("settings.cost.other_ai.subtitle")}
      icon={Atom}
      iconTone="rose"
      collapsible
      defaultOpen={false}
      storageKey="cost.other-ai"
      collapsedSummary={`${groups.length} 个分组`}
      action={(
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => openGroupForm()} className="rounded-lg border border-oai-gray-200 px-3 py-1.5 text-xs font-medium text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800">
            {copy("settings.cost.other_ai.add_group")}
          </button>
          <button type="button" onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-oai-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-oai-brand-600">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {copy("settings.cost.other_ai.add")}
          </button>
        </div>
      )}
    >
      {groupFormOpen && !groupFormInline ? renderGroupEditor() : null}

      {formOpen && !form.id ? renderEditor() : null}

      {!formOpen && error ? <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? <div className="py-4 text-center text-sm text-oai-gray-400">{copy("settings.cost.other_ai.loading")}</div> : null}
      {!loading && records.length === 0 && groups.length === 0 && !formOpen && !error ? <div className="py-4 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("settings.cost.other_ai.empty")}</div> : null}
      {!loading && (records.length || groups.length) ? (
        <>
          <div className="tt-other-ai-summary flex items-center gap-5 rounded-xl border border-oai-gray-200 bg-white px-4 py-3 text-sm dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
            <span>共 {groups.length} 个分组 · {records.length} 笔花销</span>
            <span className="h-5 w-px bg-oai-gray-200 dark:bg-oai-gray-700" aria-hidden="true" />
            <span>{copy("settings.cost.other_ai.month_spend")} <strong className="ml-1 text-emerald-600">{formatMoney(currentMonthTotal, "CNY")}</strong></span>
            <span className="h-5 w-px bg-oai-gray-200 dark:bg-oai-gray-700" aria-hidden="true" />
            <span>{copy("settings.cost.other_ai.lifetime_spend")} <strong className="ml-1 text-emerald-600">{subtotals || formatMoney(0, "CNY")}</strong></span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={records.map((record) => record.id)} strategy={verticalListSortingStrategy}>
              <div className="tt-other-ai-groups space-y-4">
                {rootGroups.map((group) => renderGroup(group))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      ) : null}
      {subtotals ? <div className="mt-3 flex justify-end gap-2 border-t border-oai-gray-100 pt-2 text-sm dark:border-oai-gray-800"><span className="text-oai-gray-500">{copy("settings.cost.other_ai.subtotal")}</span><span className="font-semibold tabular-nums">{subtotals}</span></div> : null}
    </SectionCard>
  );
}
