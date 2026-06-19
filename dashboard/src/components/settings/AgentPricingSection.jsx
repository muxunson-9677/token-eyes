import React, { useEffect, useMemo, useState } from "react";
import { DollarSign } from "lucide-react";
import { getLocalSettings, setLocalSettings } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";

const AGENTS = [
  { key: "claude", labelKey: "settings.agent_pricing.claude" },
  { key: "codex", labelKey: "settings.agent_pricing.codex" },
  { key: "hermes", labelKey: "settings.agent_pricing.hermes" },
];

const EMPTY_PRICING = {
  claude: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
  codex: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
  hermes: { inputUsdPer1M: 0, outputUsdPer1M: 0 },
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

export function AgentPricingSection() {
  const [draft, setDraft] = useState(EMPTY_PRICING);
  const [saved, setSaved] = useState(EMPTY_PRICING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLocalSettings()
      .then((settings) => {
        if (cancelled) return;
        const pricing = normalizeAgentDefaultPricing(settings?.agentDefaultPricing);
        setDraft(pricing);
        setSaved(pricing);
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

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const updateField = (agent, field) => (event) => {
    const value = event.target.value;
    setDraft((current) => ({
      ...current,
      [agent]: {
        ...current[agent],
        [field]: value === "" ? 0 : Number(value),
      },
    }));
    setSavedNotice(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      const normalized = normalizeAgentDefaultPricing(draft);
      const result = await setLocalSettings({ agentDefaultPricing: normalized });
      const pricing = normalizeAgentDefaultPricing(result?.agentDefaultPricing);
      setDraft(pricing);
      setSaved(pricing);
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
      <div className="space-y-3 py-3">
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
              value={draft[agent.key]?.inputUsdPer1M ?? 0}
              onChange={updateField(agent.key, "inputUsdPer1M")}
              disabled={loading || saving}
            />
            <PriceInput
              label={copy("settings.agent_pricing.output")}
              value={draft[agent.key]?.outputUsdPer1M ?? 0}
              onChange={updateField(agent.key, "outputUsdPer1M")}
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

function PriceInput({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <span className="block text-xs text-oai-gray-500 dark:text-oai-gray-400">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
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
