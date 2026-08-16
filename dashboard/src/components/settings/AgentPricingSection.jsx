import React, { useEffect, useMemo, useState } from "react";
import { DollarSign, FolderOpen, Plus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { getLocalSettings, getUsageModelBreakdown, setLocalSettings, verifyOfficialModelPricing } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard, ToggleSwitch } from "./Controls.jsx";

const AGENTS = [
  { key: "claude", labelKey: "settings.agent_pricing.claude" },
  { key: "codex", labelKey: "settings.agent_pricing.codex" },
  { key: "hermes", labelKey: "settings.agent_pricing.hermes" },
];

const CURRENCIES = ["USD", "CNY"];

export const VERIFIED_MODEL_PRICES = [
  { model: "GPT-5.6 Sol", modelId: "gpt-5.6-sol", currency: "USD", input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25, verification: "reference" },
  { model: "GPT-5.6 Terra", modelId: "gpt-5.6-terra", currency: "USD", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125, verification: "reference" },
  { model: "GPT-5.6 Luna", modelId: "gpt-5.6-luna", currency: "USD", input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25, verification: "reference" },
  { model: "GPT-5.5", currency: "USD", input: 5, output: 30, cacheRead: 0.5, cacheWrite: null, sourceUrl: "https://developers.openai.com/api/docs/models/compare" },
  { model: "GPT-5.4", currency: "USD", input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null, sourceUrl: "https://developers.openai.com/api/docs/models/compare" },
  { model: "GPT-5 Mini", modelId: "gpt-5-mini", currency: "USD", input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25, sourceUrl: "https://openai.com/api/pricing/" },
  { model: "Claude Opus 4.8", modelId: "claude-opus-4-8", currency: "USD", input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, verification: "reference" },
  { model: "Claude Fable 5", modelId: "claude-fable-5", currency: "USD", input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, verification: "reference" },
  { model: "Claude Sonnet 5", modelId: "claude-sonnet-5", currency: "USD", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, verification: "reference" },
  { model: "Claude Opus 4.6", currency: "USD", input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing" },
  { model: "Claude Sonnet 4.6", currency: "USD", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, sourceUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing" },
  { model: "Claude Haiku 4.5", modelId: "claude-haiku-4-5", currency: "USD", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, verification: "reference" },
  { model: "Gemini 3.1 Pro", modelId: "gemini-3.1-pro-preview", currency: "USD", input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2, verification: "reference" },
  { model: "GLM-5.2", modelId: "glm-5.2", currency: "USD", input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4, verification: "reference" },
  { model: "GLM-5.1", modelId: "glm-5.1", currency: "USD", input: 1.05, output: 3.5, cacheRead: 0.525, cacheWrite: 0, verification: "reference" },
  { model: "DeepSeek V4 Pro", modelId: "deepseek-v4-pro", currency: "USD", input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0, verification: "reference" },
  { model: "DeepSeek V4 Flash", modelId: "deepseek-v4-flash", currency: "USD", input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0, verification: "reference" },
  { model: "DeepSeek Chat", currency: "USD", input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: null, sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing-details-usd" },
  { model: "MiniMax M3", modelId: "minimax-m3", currency: "USD", input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.3, verification: "reference" },
  { model: "MiniMax-M2.7", currency: "CNY", input: 2.1, output: 8.4, cacheRead: 0.42, cacheWrite: 2.625, sourceUrl: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
  { model: "MiniMax-M2.7-highspeed", currency: "CNY", input: 4.2, output: 16.8, cacheRead: 0.42, cacheWrite: 2.625, sourceUrl: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
  { model: "Kimi K2.7 Code", modelId: "kimi-k2.7-code", currency: "USD", input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0.95, verification: "reference" },
  { model: "Kimi K2.6", modelId: "moonshot/kimi-k2.6", currency: "USD", input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0.95, verification: "reference" },
  { model: "MiMo v2.5 Pro", modelId: "mimo-v2.5-pro", currency: "USD", input: 1, output: 3, cacheRead: 0.2, cacheWrite: 0, verification: "reference" },
  { model: "MiMo v2.5", modelId: "mimo-v2.5", currency: "USD", input: 0.4, output: 2, cacheRead: 0.08, cacheWrite: 0, verification: "reference" },
  { model: "Grok 4 Fast", modelId: "azure_ai/grok-4-fast-reasoning", currency: "USD", input: 0.2, output: 0.5, cacheRead: 0.2, cacheWrite: 0.2, verification: "reference" },
  { model: "Qwen3.7 Max", currency: "CNY", input: 12, output: 36, cacheRead: null, cacheWrite: null, sourceUrl: "https://help.aliyun.com/zh/model-studio/model-pricing" },
];

const MODEL_PRICE_VERIFIED_AT = "2026-07-14";

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

export function AgentPricingSection({ onSummaryChange }) {
  const [defaultDraft, setDefaultDraft] = useState(EMPTY_PRICING);
  const [defaultSaved, setDefaultSaved] = useState(EMPTY_PRICING);
  const [rules, setRules] = useState([]);
  const [rulesSaved, setRulesSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [observedModels, setObservedModels] = useState([]);
  const [verifyingModel, setVerifyingModel] = useState("");
  const [verificationNotice, setVerificationNotice] = useState(null);
  const [officialSnapshots, setOfficialSnapshots] = useState({});
  const [automaticComparison, setAutomaticComparison] = useState(true);

  // Rule editor state. `editorMode` is "idle" | "add" | "edit". When "add" or
  // "edit" the form is visible; `editingId` holds the id being edited (null
  // for add mode). `ruleDraft` is the working copy.
  const [editorMode, setEditorMode] = useState("idle");
  const [editingId, setEditingId] = useState(null);
  const [ruleDraft, setRuleDraft] = useState({ ...EMPTY_RULE_DRAFT });
  const [ruleFormError, setRuleFormError] = useState("");

  useEffect(() => {
    onSummaryChange?.({ configuredCount: VERIFIED_MODEL_PRICES.length, customCount: rules.length });
  }, [onSummaryChange, rules.length]);

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

  useEffect(() => {
    let cancelled = false;
    getUsageModelBreakdown({ from: "2000-01-01", to: new Date().toISOString().slice(0, 10) })
      .then((result) => {
        if (cancelled) return;
        const models = (Array.isArray(result?.sources) ? result.sources : [])
          .flatMap((source) => (Array.isArray(source?.models) ? source.models : [])
            .map((model) => ({
              source: String(source?.source || "").trim().toLowerCase(),
              model: String(model?.model || model?.model_id || "").trim(),
            })))
          .filter((entry) => entry.source && entry.model);
        setObservedModels(Array.from(
          new Map(models.map((entry) => [`${entry.source}:${entry.model}`, entry])).values(),
        ));
      })
      .catch(() => {
        if (!cancelled) setObservedModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const uncataloguedModels = useMemo(() => {
    const known = new Set(VERIFIED_MODEL_PRICES.flatMap((price) => [price.model, price.modelId].filter(Boolean).map((value) => value.toLowerCase())));
    return observedModels.filter((entry) => !known.has(entry.model.toLowerCase()));
  }, [observedModels]);

  const autoVerifyModel = async ({ source, model, modelId = "", currency = "USD" }) => {
    const verificationKey = `${source}:${model}`;
    setVerifyingModel(verificationKey);
    setVerificationNotice(null);
    setError("");
    try {
      const result = await verifyOfficialModelPricing({
        model,
        model_id: modelId || model,
        source,
      });
      if (!result?.ok || !result?.pricing) {
        setVerificationNotice({ kind: "error", message: result?.error || copy("settings.agent_pricing.catalog.auto_failed") });
        return;
      }
      const normalizedRule = normalizePricingRule({
        source,
        model: modelId || model,
        inputPricePer1M: result.pricing.input,
        outputPricePer1M: result.pricing.output,
        currency: result.pricing.currency || currency,
        updated_at: result.verified_at || new Date().toISOString(),
      });
      const nextRules = normalizePricingRules([
        ...rules.filter((rule) => rule.id !== normalizedRule.id),
        normalizedRule,
      ]);
      const normalizedDefault = normalizeAgentDefaultPricing(defaultDraft);
      const saved = await setLocalSettings({
        agentDefaultPricing: normalizedDefault,
        pricingRules: nextRules,
      });
      const savedRules = normalizePricingRules(saved?.pricingRules || nextRules);
      setRules(savedRules);
      setRulesSaved(savedRules);
      setDefaultDraft(normalizedDefault);
      setDefaultSaved(normalizedDefault);
      setOfficialSnapshots((current) => ({
        ...current,
        [model]: {
          ...result.pricing,
          sourceUrl: result.source_url,
          verifiedAt: result.verified_at,
        },
      }));
      setVerificationNotice({ kind: "success", message: copy("settings.agent_pricing.catalog.auto_success") });
    } catch (err) {
      setVerificationNotice({ kind: "error", message: err?.message || copy("settings.agent_pricing.catalog.auto_failed") });
    } finally {
      setVerifyingModel("");
    }
  };

  const defaultDirty = useMemo(
    () => JSON.stringify(defaultDraft) !== JSON.stringify(defaultSaved),
    [defaultDraft, defaultSaved],
  );
  const rulesDirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(rulesSaved),
    [rules, rulesSaved],
  );
  const dirty = defaultDirty || rulesDirty;

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
      subtitle={copy("settings.agent_pricing.reference_subtitle")}
      icon={DollarSign}
      iconTone="green"
      collapsible
      defaultOpen={false}
      storageKey="cost.agent-pricing"
      collapsedSummary={copy("settings.agent_pricing.collapsed_summary", { count: VERIFIED_MODEL_PRICES.length })}
      collapsedSummaryTone="green"
      action={
        <div className="tt-pricing-header-actions flex items-center gap-2">
          <a
            className="tt-agent-pricing-help"
            href="#model-pricing-catalog"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("model-pricing-catalog")?.scrollIntoView({ block: "nearest" });
            }}
          >
            {copy("settings.agent_pricing.how_pricing")}
          </a>
          <button
            type="button"
            onClick={() => document.getElementById("model-pricing-catalog")?.scrollIntoView({ block: "nearest" })}
            className="tt-pricing-source-directory inline-flex h-8 items-center gap-1.5 rounded-md border border-oai-gray-200 px-3 text-xs font-medium text-oai-gray-700 dark:border-oai-gray-800 dark:text-oai-gray-300"
          >
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            {copy("settings.agent_pricing.source_directory")}
          </button>
          <span className="tt-pricing-auto-compare inline-flex items-center gap-1.5 text-xs text-oai-gray-700 dark:text-oai-gray-300">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {copy("settings.agent_pricing.auto_compare")}
            <ToggleSwitch checked={automaticComparison} onChange={() => setAutomaticComparison((value) => !value)} ariaLabel={copy("settings.agent_pricing.auto_compare")} />
          </span>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving || !dirty}
            className="tt-pricing-save inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed"
          >
            {saving ? copy("settings.agent_pricing.saving") : copy("settings.agent_pricing.save_changes")}
          </button>
        </div>
      }
    >
      <div className="space-y-3 py-3">
        <div>
          <div className="text-sm font-medium text-oai-gray-900 dark:text-oai-gray-200">
            {copy("settings.agent_pricing.catalog.title")}
          </div>
          <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("settings.agent_pricing.catalog.subtitle")}
          </div>
        </div>
        <div id="model-pricing-catalog" className="overflow-hidden rounded-xl border border-oai-gray-200 bg-white shadow-sm shadow-black/[0.03] dark:border-oai-gray-800 dark:bg-oai-gray-950">
          <table data-testid="model-pricing-table" className="w-full table-fixed text-[11px] sm:text-xs">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[34%]" />
            </colgroup>
            <thead className="bg-oai-gray-50 text-left text-oai-gray-500 dark:bg-oai-gray-900 dark:text-oai-gray-400">
              <tr>
                <th className="px-2 py-2.5 font-medium">{copy("settings.agent_pricing.catalog.model")}</th>
                <th className="px-1 py-2.5 text-right font-medium">{copy("settings.agent_pricing.catalog.input")}</th>
                <th className="px-1 py-2.5 text-right font-medium">{copy("settings.agent_pricing.catalog.output")}</th>
                <th className="px-1 py-2.5 text-right font-medium">{copy("settings.agent_pricing.catalog.cache_read")}</th>
                <th className="px-1 py-2.5 text-right font-medium">{copy("settings.agent_pricing.catalog.cache_write")}</th>
                <th className="px-2 py-2.5 text-right font-medium">{copy("settings.agent_pricing.catalog.source")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
              {VERIFIED_MODEL_PRICES.map((price) => {
                const snapshot = officialSnapshots[price.model];
                const displayPrice = snapshot ? { ...price, ...snapshot } : price;
                const source = /^claude/i.test(price.model) ? "claude" : /^(gpt|o\d)/i.test(price.model) ? "codex" : "hermes";
                const verificationKey = `${source}:${price.model}`;
                return (
                <tr key={price.model} className="text-oai-gray-700 dark:text-oai-gray-300">
                  <td className="break-words px-2 py-2.5 font-medium text-oai-gray-900 dark:text-oai-gray-100">
                    <span>{price.model}</span>
                    {price.peakMultiplier === 2 ? (
                      <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        {copy("settings.agent_pricing.catalog.peak_double")}
                      </span>
                    ) : null}
                  </td>
                  <PriceCell value={displayPrice.input} currency={displayPrice.currency} />
                  <PriceCell value={displayPrice.output} currency={displayPrice.currency} />
                  <PriceCell value={displayPrice.cacheRead} currency={displayPrice.currency} />
                  <PriceCell value={displayPrice.cacheWrite} currency={displayPrice.currency} />
                  <td className="break-words px-2 py-2.5 text-right leading-5">
                    {displayPrice.sourceUrl ? (
                      <a className="tt-pricing-source-badge" data-tone="official" href={displayPrice.sourceUrl} target="_blank" rel="noreferrer">
                        {copy("settings.agent_pricing.catalog.official")}
                      </a>
                    ) : (
                      <span className="tt-pricing-source-badge" data-tone="pending">{copy("settings.agent_pricing.catalog.pending_verification")}</span>
                    )}
                    <button
                      type="button"
                      aria-label={copy("settings.agent_pricing.catalog.auto_verify_model", { model: price.model })}
                      onClick={() => autoVerifyModel({ source, model: price.model, modelId: price.modelId, currency: price.currency })}
                      disabled={Boolean(verifyingModel)}
                      className={cn("tt-pricing-row-auto ml-2 font-medium text-oai-brand-600 hover:underline disabled:opacity-50 dark:text-oai-brand-400", !automaticComparison && "hidden")}
                    >
                      {verifyingModel === verificationKey
                        ? copy("settings.agent_pricing.catalog.verifying")
                        : copy("settings.agent_pricing.catalog.auto_verify")}
                    </button>
                  </td>
                </tr>
              );})}
              {uncataloguedModels.map((entry) => (
                <tr key={`observed:${entry.source}:${entry.model}`} className="bg-amber-50/40 text-oai-gray-700 dark:bg-amber-950/10 dark:text-oai-gray-300">
                  <td className="break-words px-2 py-2.5 font-medium text-oai-gray-900 dark:text-oai-gray-100">{entry.model}</td>
                  <PriceCell value={null} currency="USD" />
                  <PriceCell value={null} currency="USD" />
                  <PriceCell value={null} currency="USD" />
                  <PriceCell value={null} currency="USD" />
                  <td className="break-words px-2 py-2.5 text-right font-medium leading-5 text-amber-600 dark:text-amber-300">
                    <span>{copy("settings.agent_pricing.catalog.new_model")}</span>
                    <button
                      type="button"
                      aria-label={copy("settings.agent_pricing.catalog.auto_verify_model", { model: entry.model })}
                      onClick={() => autoVerifyModel({ source: entry.source, model: entry.model, modelId: entry.model })}
                      disabled={Boolean(verifyingModel)}
                      className="ml-2 text-oai-brand-600 hover:underline disabled:opacity-50 dark:text-oai-brand-400"
                    >
                      {verifyingModel === `${entry.source}:${entry.model}`
                        ? copy("settings.agent_pricing.catalog.verifying")
                        : copy("settings.agent_pricing.catalog.auto_verify")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-oai-gray-400 dark:text-oai-gray-500">
          {copy("settings.agent_pricing.catalog.updated", { date: MODEL_PRICE_VERIFIED_AT })}
        </div>
        {verificationNotice && (
          <div className={cn(
            "text-xs",
            verificationNotice.kind === "success" ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-300",
          )}>
            {verificationNotice.message}
          </div>
        )}
      </div>

      {/* ── Agent + Model rules list ─────────────────────────────────────── */}
      <div className="space-y-3 border-t border-oai-gray-100 py-3 dark:border-oai-gray-800">
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

function PriceCell({ value, currency }) {
  const number = Number(value);
  const decimals = Number.isFinite(number) && String(number).includes(".")
    ? String(number).split(".")[1].length
    : 0;
  const formatted = Number.isFinite(number)
    ? number.toFixed(Math.max(2, decimals))
    : null;
  return (
    <td className="px-1 py-2.5 text-right font-mono tabular-nums">
      {value == null ? "—" : `${currency === "CNY" ? "¥" : "$"}${formatted}`}
    </td>
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
