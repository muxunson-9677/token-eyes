import React, { useEffect, useMemo, useState } from "react";
import { FolderOpen, Save } from "lucide-react";
import { getLocalSettings, selectLocalDirectory, setLocalSettings } from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";
import { selectDirectoryViaTauri } from "../../lib/tauri-directory.js";

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
  const [selectingField, setSelectingField] = useState("");
  const [error, setError] = useState("");
  const [selectNotice, setSelectNotice] = useState(null);
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
    setSelectNotice(null);
    setSavedNotice(false);
  };

  const chooseDirectory = async (field) => {
    setSelectingField(field);
    setSelectNotice(null);
    setSavedNotice(false);
    try {
      // 1. Tauri (primary for Token Eyes Windows desktop)
      const tauriPath = await selectDirectoryViaTauri();
      if (tauriPath) {
        setDraft((current) => ({ ...current, [field]: tauriPath }));
        return;
      }

      // 2. WebView2 native bridge (legacy TokenTrackerWin)
      const nativePath = await selectDirectoryWithNativeBridge();
      if (nativePath) {
        setDraft((current) => ({ ...current, [field]: nativePath }));
        return;
      }

      // 3. Local API fallback (browser / PowerShell dialog)
      const result = await selectLocalDirectory();
      if (result?.path) {
        setDraft((current) => ({ ...current, [field]: result.path }));
        return;
      }
      if (!result?.cancelled) {
        setSelectNotice({ field, message: copy("settings.data_dirs.select_folder_unsupported") });
      }
    } catch {
      setSelectNotice({ field, message: copy("settings.data_dirs.select_folder_unsupported") });
    } finally {
      setSelectingField("");
    }
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
        onSelect={() => chooseDirectory("claude")}
        selecting={selectingField === "claude"}
        notice={selectNotice?.field === "claude" ? selectNotice.message : ""}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.codex")}
        hint={copy("settings.data_dirs.codex_hint")}
        value={draft.codex}
        onChange={updateField("codex")}
        onSelect={() => chooseDirectory("codex")}
        selecting={selectingField === "codex"}
        notice={selectNotice?.field === "codex" ? selectNotice.message : ""}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.hermes")}
        hint={copy("settings.data_dirs.hermes_hint")}
        value={draft.hermes}
        onChange={updateField("hermes")}
        onSelect={() => chooseDirectory("hermes")}
        selecting={selectingField === "hermes"}
        notice={selectNotice?.field === "hermes" ? selectNotice.message : ""}
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

function selectDirectoryWithNativeBridge() {
  if (!isNativeWindowsApp() || typeof window === "undefined" || !window.chrome?.webview) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const requestId = `select-folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const webview = window.chrome.webview;
    let timer;

    const cleanup = () => {
      if (timer) window.clearTimeout(timer);
      try {
        webview.removeEventListener("message", handler);
      } catch {
        // ignore bridge cleanup failures
      }
    };

    const handler = (event) => {
      const data = normalizeWebViewMessage(event.data);
      if (data?.type !== "folderSelected" || data.requestId !== requestId) return;
      cleanup();
      resolve(typeof data.path === "string" && data.path.trim() ? data.path : null);
    };

    try {
      webview.addEventListener("message", handler);
      timer = window.setTimeout(() => {
        cleanup();
        resolve(null);
      }, 60_000);
      webview.postMessage(JSON.stringify({ type: "selectFolder", requestId }));
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

function normalizeWebViewMessage(data) {
  if (data && typeof data === "object") return data;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function DirectoryInput({ label, hint, value, onChange, onSelect, selecting, notice, disabled }) {
  return (
    <div className="block py-3">
      <span className="block text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</span>
      <span className="mt-0.5 block text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</span>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          aria-label={label}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={copy("settings.data_dirs.placeholder")}
          className={cn(
            "h-9 min-w-0 flex-1 rounded-md border border-oai-gray-200 bg-white px-3 font-mono text-xs text-oai-gray-900 outline-none transition-colors",
            "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
            "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
          )}
        />
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || selecting}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          {selecting ? copy("settings.data_dirs.selecting_folder") : copy("settings.data_dirs.select_folder")}
        </button>
      </div>
      {notice ? (
        <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{notice}</span>
      ) : null}
    </div>
  );
}
