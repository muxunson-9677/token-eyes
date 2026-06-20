import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";
import { getLocalSettings, setLocalSettings, selectLocalDirectory } from "../../lib/api";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";
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

let _requestCounter = 0;

export function DataDirectoriesSection() {
  const [draft, setDraft] = useState(EMPTY_DIRS);
  const [saved, setSaved] = useState(EMPTY_DIRS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState(false);
  const [unsupportedHint, setUnsupportedHint] = useState("");
  const [browsing, setBrowsing] = useState("");
  const pendingRef = useRef(null);

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

  // WebView2: listen for folderSelected responses from the host.
  // Host→web messages arrive on window.chrome.webview's 'message' event.
  useEffect(() => {
    if (!isNativeWindowsApp()) return;
    const wv = window.chrome?.webview;
    if (!wv) return;
    function handleMessage(event) {
      const data = event.data;
      if (!data || data.type !== "folderSelected") return;
      const pending = pendingRef.current;
      if (!pending || data.requestId !== pending.requestId) return;
      pendingRef.current = null;
      setBrowsing("");
      if (!data.cancelled && data.path) {
        setDraft((current) => ({ ...current, [pending.key]: data.path }));
        setSavedNotice(false);
        setUnsupportedHint("");
      }
    }
    wv.addEventListener("message", handleMessage);
    return () => wv.removeEventListener("message", handleMessage);
  }, []);

  const selectFolder = useCallback(async (key) => {
    setUnsupportedHint("");
    setError("");

    // WebView2: use native folder picker via host bridge.
    if (isNativeWindowsApp()) {
      const requestId = `folder-${++_requestCounter}-${Date.now()}`;
      pendingRef.current = { requestId, key };
      setBrowsing(key);
      try {
        window.chrome.webview.postMessage({
          type: "selectFolder",
          requestId,
        });
      } catch {
        pendingRef.current = null;
        setBrowsing("");
        setError("WebView2 通信失败");
      }
      return;
    }

    // Browser fallback: call CLI host API.
    setBrowsing(key);
    try {
      const result = await selectLocalDirectory();
      if (result?.unsupported) {
        setUnsupportedHint(
          result.message || "当前环境不支持直接选择本机目录，请手动输入路径。",
        );
      } else if (!result?.cancelled && result?.path) {
        setDraft((current) => ({ ...current, [key]: result.path }));
        setSavedNotice(false);
        setUnsupportedHint("");
      }
    } catch (err) {
      setError(err?.message || "选择目录失败");
    } finally {
      setBrowsing("");
    }
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
        onBrowse={() => selectFolder("claude")}
        browsing={browsing === "claude"}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.codex")}
        hint={copy("settings.data_dirs.codex_hint")}
        value={draft.codex}
        onChange={updateField("codex")}
        onBrowse={() => selectFolder("codex")}
        browsing={browsing === "codex"}
        disabled={loading || saving}
      />
      <DirectoryInput
        label={copy("settings.data_dirs.hermes")}
        hint={copy("settings.data_dirs.hermes_hint")}
        value={draft.hermes}
        onChange={updateField("hermes")}
        onBrowse={() => selectFolder("hermes")}
        browsing={browsing === "hermes"}
        disabled={loading || saving}
      />
      {(error || savedNotice || unsupportedHint) && (
        <div className="py-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : unsupportedHint ? (
            <span className="text-amber-600 dark:text-amber-400">{unsupportedHint}</span>
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

function DirectoryInput({ label, hint, value, onChange, onBrowse, browsing, disabled }) {
  return (
    <label className="block py-3">
      <span className="block text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</span>
      <span className="mt-0.5 block text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</span>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={copy("settings.data_dirs.placeholder")}
          className={cn(
            "h-9 flex-1 rounded-md border border-oai-gray-200 bg-white px-3 font-mono text-xs text-oai-gray-900 outline-none transition-colors",
            "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
            "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
          )}
        />
        <button
          type="button"
          onClick={onBrowse}
          disabled={disabled || browsing}
          className={cn(
            "inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-xs font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
          )}
        >
          {browsing ? "…" : "选择文件夹"}
        </button>
      </div>
    </label>
  );
}
