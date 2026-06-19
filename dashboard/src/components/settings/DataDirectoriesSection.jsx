import React, { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { getLocalSettings, setLocalSettings } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";

const EMPTY_DIRS = { claude: "", codex: "", hermes: "" };

function normalizeDataDirectories(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    claude: typeof input.claude === "string" ? input.claude : "",
    codex: typeof input.codex === "string" ? input.codex : "",
    hermes: typeof input.hermes === "string" ? input.hermes : "",
  };
}

export function DataDirectoriesSection() {
  const [draft, setDraft] = useState(EMPTY_DIRS);
  const [saved, setSaved] = useState(EMPTY_DIRS);
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
        const dirs = normalizeDataDirectories(settings?.dataDirectories);
        setDraft(dirs);
        setSaved(dirs);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || copy("settings.data_dirs.load_error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  const updateField = (field) => (event) => {
    setDraft((current) => ({ ...current, [field]: event.target.value }));
    setSavedNotice(false);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNotice(false);
    try {
      const result = await setLocalSettings({ dataDirectories: draft });
      const dirs = normalizeDataDirectories(result?.dataDirectories);
      setDraft(dirs);
      setSaved(dirs);
      setSavedNotice(true);
    } catch (err) {
      setError(err?.message || copy("settings.data_dirs.save_error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={copy("settings.section.data_dirs")}
      subtitle={copy("settings.data_dirs.subtitle")}
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
          <Save className="h-3.5 w-3.5" aria-hidden />
          {saving ? copy("settings.data_dirs.saving") : copy("settings.data_dirs.save")}
        </button>
      }
    >
      <DirectoryInput
        label={copy("settings.data_dirs.claude")}
        hint={copy("settings.data_dirs.claude_hint")}
        value={draft.claude}
        onChange={updateField("claude")}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.codex")}
        hint={copy("settings.data_dirs.codex_hint")}
        value={draft.codex}
        onChange={updateField("codex")}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.hermes")}
        hint={copy("settings.data_dirs.hermes_hint")}
        value={draft.hermes}
        onChange={updateField("hermes")}
        disabled={loading || saving}
      />
      {(error || savedNotice) && (
        <div className="py-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.data_dirs.saved")}
            </span>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function DirectoryInput({ label, hint, value, onChange, disabled }) {
  return (
    <label className="block py-3">
      <span className="block text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</span>
      <span className="mt-0.5 block text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</span>
      <input
        type="text"
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={copy("settings.data_dirs.placeholder")}
        className={cn(
          "mt-2 h-9 w-full rounded-md border border-oai-gray-200 bg-white px-3 font-mono text-xs text-oai-gray-900 outline-none transition-colors",
          "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
          "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
        )}
      />
    </label>
  );
}
