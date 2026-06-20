import React, { useEffect, useMemo, useState } from "react";
import { DollarSign, Plus, Pencil, Trash2 } from "lucide-react";
import { getLocalSettings, setLocalSettings } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";

const AGENTS = [
  { key: "claude", labelKey: "settings.agent_pricing.claude" },
  { key: "codex", labelKey: "settings.agent_pricing.codex" },
  { key: "hermes", labelKey: "settings.agent_pricing.hermes" },
];

const CURRENCIES = ["USD", "CNY"];

const EMPTY_PRICING = {
  claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
  codex: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
  hermes: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
};

const EMPTY_RULE_DRAFT = {
  id: "",
  source: "codex",
  model: "",
  inputPricePer1M: 0,
  outputPricePer1M: 0,
  currency: "USD",
};

function normalizeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeAgentDefaultPricing(value) {
  const input = value && typeof value === "object" ? value : {};
  const next = {};
  for (const agent of AGENTS) {
    const entry = input[agent.key] && typeof input[agent.key] === "object" ? input[agent.key] : {};
    next[agent.key] = {
      inputUsdPer1M: normalizeNumber(entry.inputUsdPer1M),
      outputUsdPer1M: normalizeNumber(entry.outputUsdPer1M),
    };
  }
  return next;
}

// Normalize a raw pricing rule from the API into the editable shape. Prices
// are kept as numbers; empty/invalid → 0 so inputs render cleanly.
function normalizePricingRule(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const source = typeof input.source === "string" ? input.source.trim().toLowerCase() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  return {
    id: typeof input.id === "string" ? input.id : source && model ? `${source}:${model}` : "",
    source: source || "codex",
    model,
    inputPricePer1M: normalizeNumber(input.inputPricePer1M),
    outputPricePer1M: normalizeNumber(input.outputPricePer1M),
    currency: CURRENCIES.includes(input.currency) ? input.currency : "USD",
    updated_at: typeof input.updated_at === "string" ? input.updated_at : "",
  };
}

function normalizePricingRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePricingRule);
}

function ruleId(source, model) {
  const s = String(source || "").trim().toLowerCase();
  const m = String(model || "").trim();
  return s && m ? `${s}:${m}` : "";
}

export function AgentPricingSection() {
  const [defaultDraft, setDefaultDraft] = useState(EMPTY_PRICING);
  const [defaultSaved, setDefaultSaved] = useState(EMPTY_PRICING);
  const [rules, setRules] = useState([]);
  const [rulesSaved, setRulesSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  // Rule editor state. `editorMode` is "idle" | "add" | "edit". When "add" or
  // "edit" the form is visible; `editingId` holds the id being edited (null
  // for add mode). `ruleDraft` is the working copy.
  const [editorMode, setEditorMode] = useState("idle");
  const [editingId, setEditingId] = useState(null);
  const [ruleDraft, setRuleDraft] = useState({ ...EMPTY_RULE_DRAFT });
  const [ruleFormError, setRuleFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLocalSettings()
      .then((settings) => {
        if (cancelled) return;
        const pricing = normalizeAgentDefaultPricing(settings?.agentDefaultPricing);
        setDefaultDraft(pricing);
        setDefaultSaved(pricing);
        const ruleList = normalizePricingRules(settings?.pricingRules);
        setRules(ruleList);
        setRulesSaved(ruleList);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("settings.agent_pricing.load_error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultDirty = useMemo(
    () => JSON.stringify(defaultDraft) !== JSON.stringify(defaultSaved),
    [defaultDraft, defaultSaved],
  );
  const rulesDirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(rulesSaved),
    [rules, rulesSaved],
  );
  const dirty = defaultDirty || rulesDirty;

  // ── Default pricing (MVP fallback) field handlers ────────────────────────
  const updateDefaultField = (agent, field) => (event) => {
    const value = event.target.value;
    setDefaultDraft((current) => ({
      ...current,
      [agent]: {
        ...current[agent],
        [field]: value === "" ? 0 : Number(value),
      },
    }));
    setSavedNotice(false);
  };

  // ── Pricing rules CRUD (local, committed on Save) ────────────────────────
  const startAddRule = () => {
    setEditorMode("add");
    setEditingId(null);
    setRuleDraft({ ...EMPTY_RULE_DRAFT });
    setRuleFormError("");
  };

  const startEditRule = (rule) => {
    setEditorMode("edit");
    setEditingId(rule.id);
    setRuleDraft({ ...rule });
    setRuleFormError("");
  };

  const cancelRuleEdit = () => {
    setEditorMode("idle");
    setEditingId(null);
    setRuleDraft({ ...EMPTY_RULE_DRAFT });
    setRuleFormError("");
  };

  const deleteRule = (id) => {
    if (typeof window !== "undefined" && !window.confirm(copy("settings.agent_pricing.rules.delete_confirm"))) {
      return;
    }
    setRules((current) => current.filter((r) => r.id !== id));
    setSavedNotice(false);
    if (editingId === id) cancelRuleEdit();
  };

  const commitRuleDraft = () => {
    const source = String(ruleDraft.source || "").trim().toLowerCase();
    const model = String(ruleDraft.model || "").trim();
    if (!source || !model) {
      setRuleFormError(copy("settings.agent_pricing.rules.invalid"));
      return;
    }
    const id = ruleId(source, model);
    // Duplicate check: another rule with the same id (not the one being edited).
    const conflict = rules.some((r) => r.id === id && r.id !== editingId);
    if (conflict) {
      setRuleFormError(copy("settings.agent_pricing.rules.duplicate"));
      return;
    }
    const normalized = {
      id,
      source,
      model,
      inputPricePer1M: normalizeNumber(ruleDraft.inputPricePer1M),
      outputPricePer1M: normalizeNumber(ruleDraft.outputPricePer1M),
      currency: CURRENCIES.includes(ruleDraft.currency) ? ruleDraft.currency : "USD",
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      setRules((current) => current.map((r) => (r.id === editingId ? normalized : r)));
    } else {
      setRules((current) => [...current, normalized]);
    }
    cancelRuleEdit();
    setSavedNotice(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      const normalizedDefault = normalizeAgentDefaultPricing(defaultDraft);
      const normalizedRules = rules.map((r) => ({
        id: r.id,
        source: r.source,
        model: r.model,
        inputPricePer1M: normalizeNumber(r.inputPricePer1M),
        outputPricePer1M: normalizeNumber(r.outputPricePer1M),
        currency: r.currency,
        updated_at: r.updated_at || new Date().toISOString(),
      }));
      const result = await setLocalSettings({
        agentDefaultPricing: normalizedDefault,
        pricingRules: normalizedRules,
      });
      const pricing = normalizeAgentDefaultPricing(result?.agentDefaultPricing);
      setDefaultDraft(pricing);
      setDefaultSaved(pricing);
      const ruleList = normalizePricingRules(result?.pricingRules);
      setRules(ruleList);
      setRulesSaved(ruleList);
      setSavedNotice(true);
    } catch (err) {
      setError(err?.message || copy("settings.agent_pricing.save_error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={copy("settings.section.agent_pricing")}
      subtitle={copy("settings.agent_pricing.subtitle")}
      action={
        <button
          type="button"
          onClick={save}
          disabled={loading || saving || !dirty}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          <DollarSign className="h-3.5 w-3.5" aria-hidden />
          {saving ? copy("settings.agent_pricing.saving") : copy("settings.agent_pricing.save")}
        </button>
      }
    >
      {/* ── Agent + Model rules list ─────────────────────────────────────── */}
      <div className="space-y-3 py-3">
        <div>
          <div className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-200">
            {copy("settings.agent_pricing.rules.title")}
          </div>
          <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.rules.subtitle")}
          </div>
        </div>

        {rules.length === 0 && editorMode === "idle" ? (
          <div className="rounded-md border border-dashed border-oai-gray-200 px-3 py-4 text-center text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.rules.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-oai-gray-500 dark:text-oai-gray-400">
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.source")}</th>
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.model")}</th>
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.input_price")}</th>
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.output_price")}</th>
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.currency")}</th>
                  <th className="py-1.5 pr-2 font-medium">{copy("settings.agent_pricing.rules.updated")}</th>
                  <th className="py-1.5 pr-2 text-right font-medium">{/* actions */}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-t border-oai-gray-100 dark:border-oai-gray-800"
                  >
                    <td className="py-1.5 pr-2 font-mono text-oai-gray-900 dark:text-oai-gray-100">{rule.source}</td>
                    <td className="py-1.5 pr-2 font-mono text-oai-gray-900 dark:text-oai-gray-100">{rule.model}</td>
                    <td className="py-1.5 pr-2 font-mono text-oai-gray-700 dark:text-oai-gray-300">{rule.inputPricePer1M}</td>
                    <td className="py-1.5 pr-2 font-mono text-oai-gray-700 dark:text-oai-gray-300">{rule.outputPricePer1M}</td>
                    <td className="py-1.5 pr-2 text-oai-gray-700 dark:text-oai-gray-300">{rule.currency}</td>
                    <td className="py-1.5 pr-2 text-oai-gray-500 dark:text-oai-gray-400">
                      {rule.updated_at ? rule.updated_at.slice(0, 10) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <div className="inline-flex gap-1">
                        <IconButton
                          label={copy("settings.agent_pricing.rules.edit")}
                          onClick={() => startEditRule(rule)}
                          disabled={loading || saving}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                        <IconButton
                          label={copy("settings.agent_pricing.rules.delete")}
                          onClick={() => deleteRule(rule.id)}
                          disabled={loading || saving}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Rule editor form (add/edit) ───────────────────────────────── */}
        {editorMode !== "idle" ? (
          <RuleEditor
            draft={ruleDraft}
            onChange={setRuleDraft}
            onCancel={cancelRuleEdit}
            onSubmit={commitRuleDraft}
            error={ruleFormError}
            disabled={loading || saving}
          />
        ) : (
          <button
            type="button"
            onClick={startAddRule}
            disabled={loading || saving}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {copy("settings.agent_pricing.rules.add")}
          </button>
        )}
      </div>

      {/* ── Default pricing (MVP fallback) ──────────────────────────────── */}
      <div className="space-y-3 border-t border-oai-gray-100 py-3 dark:border-oai-gray-800">
        <div>
          <div className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-200">
            {copy("settings.agent_pricing.default.title")}
          </div>
          <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.default.subtitle")}
          </div>
        </div>
        {AGENTS.map((agent) => (
          <div key={agent.key} className="grid gap-2 sm:grid-cols-[120px_1fr_1fr] sm:items-end">
            <div>
              <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">
                {copy(agent.labelKey)}
              </div>
              <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                {copy("settings.agent_pricing.per_1m")}
              </div>
            </div>
            <PriceInput
              label={copy("settings.agent_pricing.input")}
              value={defaultDraft[agent.key]?.inputUsdPer1M ?? 0}
              onChange={updateDefaultField(agent.key, "inputUsdPer1M")}
              disabled={loading || saving}
            />
            <PriceInput
              label={copy("settings.agent_pricing.output")}
              value={defaultDraft[agent.key]?.outputUsdPer1M ?? 0}
              onChange={updateDefaultField(agent.key, "outputUsdPer1M")}
              disabled={loading || saving}
            />
          </div>
        ))}
      </div>

      {(error || savedNotice) && (
        <div className="pb-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.agent_pricing.saved")}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function RuleEditor({ draft, onChange, onCancel, onSubmit, error, disabled }) {
  const update = (field) => (event) => {
    const value = event.target.value;
    onChange({
      ...draft,
      [field]: field === "inputPricePer1M" || field === "outputPricePer1M"
        ? value === "" ? 0 : Number(value)
        : value,
    });
  };
  return (
    <div className="rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
      <div className="grid gap-2 sm:grid-cols-[120px_1fr_1fr_90px] sm:items-end">
        <label className="block">
          <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.rules.source")}
          </span>
          <select
            value={draft.source}
            onChange={update("source")}
            disabled={disabled}
            className={cn(
              "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-2 text-xs text-oai-gray-900 outline-none transition-colors",
              "focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
              "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100",
            )}
          >
            {AGENTS.map((a) => (
              <option key={a.key} value={a.key}>
                {copy(a.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <PriceInput
          label={copy("settings.agent_pricing.rules.model")}
          value={draft.model}
          onChange={(e) => onChange({ ...draft, model: e.target.value })}
          disabled={disabled}
          isText
        />
        <PriceInput
          label={copy("settings.agent_pricing.rules.input_price")}
          value={draft.inputPricePer1M}
          onChange={update("inputPricePer1M")}
          disabled={disabled}
        />
        <PriceInput
          label={copy("settings.agent_pricing.rules.output_price")}
          value={draft.outputPricePer1M}
          onChange={update("outputPricePer1M")}
          disabled={disabled}
        />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[120px_1fr] sm:items-end">
        <label className="block">
          <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.rules.currency")}
          </span>
          <select
            value={draft.currency}
            onChange={update("currency")}
            disabled={disabled}
            className={cn(
              "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-2 text-xs text-oai-gray-900 outline-none transition-colors",
              "focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
              "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100",
            )}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-brand-500 bg-oai-brand-500 text-white hover:bg-oai-brand-600 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {copy("settings.agent_pricing.rules.save_rule")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          {copy("settings.agent_pricing.rules.cancel")}
        </button>
      </div>
    </div>
  );
}

function PriceInput({ label, value, onChange, disabled, isText = false }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type={isText ? "text" : "number"}
        min={isText ? undefined : "0"}
        step={isText ? undefined : "0.01"}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={cn(
          "mt-1 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 font-mono text-xs text-oai-gray-900 outline-none transition-colors",
          "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
          "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
        )}
      />
    </label>
  );
}

function IconButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border text-oai-gray-600 transition-colors",
        "border-oai-gray-200 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
      )}
    >
      {children}
    </button>
  );
}
