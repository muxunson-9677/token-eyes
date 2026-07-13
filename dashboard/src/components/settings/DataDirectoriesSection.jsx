import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Save, RefreshCw, CheckCircle, Search, XCircle } from "lucide-react";
import {
  detectLocalDataDirectories,
  getAgentEnvironment,
  getLocalSettings,
  selectLocalDirectory,
  setLocalSettings,
  triggerLocalSync,
} from "../../lib/api";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { SectionCard } from "./Controls.jsx";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";
import { selectDirectoryViaTauri } from "../../lib/tauri-directory.js";

const DIRECTORY_FIELDS = [
  { key: "claude", labelKey: "settings.data_dirs.claude", hintKey: "settings.data_dirs.claude_hint" },
  { key: "codex", labelKey: "settings.data_dirs.codex", hintKey: "settings.data_dirs.codex_hint" },
  { key: "hermes", labelKey: "settings.data_dirs.hermes", hintKey: "settings.data_dirs.hermes_hint" },
  { key: "cursor", labelKey: "settings.data_dirs.cursor", hintKey: "settings.data_dirs.cursor_hint" },
  { key: "opencode", labelKey: "settings.data_dirs.opencode", hintKey: "settings.data_dirs.opencode_hint" },
  { key: "openclaw", labelKey: "settings.data_dirs.openclaw", hintKey: "settings.data_dirs.openclaw_hint" },
];

const EMPTY_DIRS = Object.fromEntries(DIRECTORY_FIELDS.map((field) => [field.key, ""]));

function normalizeDataDirectories(value) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    DIRECTORY_FIELDS.map((field) => [field.key, typeof input[field.key] === "string" ? input[field.key] : ""]),
  );
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
  const [envStatuses, setEnvStatuses] = useState({});
  const [detectingField, setDetectingField] = useState("");
  const [detectingPaths, setDetectingPaths] = useState(false);
  const [detectNotice, setDetectNotice] = useState(null);
  const [syncState, setSyncState] = useState("idle");

  const detectEnvironment = useCallback(async (field, dataPath) => {
    setDetectingField(field);
    try {
      const result = await getAgentEnvironment(field, dataPath);
      if (result?.ok && result?.result) {
        setEnvStatuses((prev) => ({ ...prev, [field]: result.result }));
      }
    } catch {
      setEnvStatuses((prev) => ({
        ...prev,
        [field]: {
          agent: field,
          environment: "not-detected",
          status: "not-detected",
        },
      }));
    } finally {
      setDetectingField("");
    }
  }, []);

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
    setEnvStatuses((current) => ({ ...current, [field]: null }));
    setSelectNotice(null);
    setSavedNotice(false);
    setSyncState("idle");
  };

  const applySelectedPath = (field, selectedPath) => {
    setDraft((current) => ({ ...current, [field]: selectedPath }));
    setEnvStatuses((current) => ({ ...current, [field]: null }));
  };

  const chooseDirectory = async (field) => {
    setSelectingField(field);
    setSelectNotice(null);
    setSavedNotice(false);
    try {
      const tauriPath = await selectDirectoryViaTauri(draft[field]);
      if (tauriPath) {
        applySelectedPath(field, tauriPath);
        return;
      }

      const nativePath = await selectDirectoryWithNativeBridge();
      if (nativePath) {
        applySelectedPath(field, nativePath);
        return;
      }

      const result = await selectLocalDirectory();
      if (result?.path) {
        applySelectedPath(field, result.path);
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
    setSyncState("idle");
    try {
      const result = await setLocalSettings({ dataDirectories: draft });
      const dirs = normalizeDataDirectories(result?.dataDirectories);
      setDraft(dirs);
      setSaved(dirs);
      setSavedNotice(true);
      setSaving(false);
      setSyncState("syncing");
      try {
        await triggerLocalSync();
        setSyncState("success");
      } catch {
        setSyncState("error");
      }
    } catch (err) {
      setError(err?.message || copy("settings.data_dirs.save_error"));
      setSaving(false);
    }
  };

  const detectPaths = async () => {
    setDetectingPaths(true);
    setDetectNotice(null);
    setSelectNotice(null);
    setSavedNotice(false);
    setError("");
    try {
      const result = await detectLocalDataDirectories();
      const discovered = normalizeDataDirectories(result?.dataDirectories);
      const count = Object.values(discovered).filter(Boolean).length;
      setDraft(discovered);
      setEnvStatuses(Object.fromEntries(
        DIRECTORY_FIELDS.map((field) => [field.key, result?.detected?.[field.key] || null]),
      ));
      setDetectNotice({
        error: false,
        message: count > 0
          ? copy("settings.data_dirs.auto_detect_success", { count })
          : copy("settings.data_dirs.auto_detect_none"),
      });
    } catch {
      setDetectNotice({ error: true, message: copy("settings.data_dirs.auto_detect_error") });
    } finally {
      setDetectingPaths(false);
    }
  };

  return (
    <SectionCard
      title={copy("settings.section.data_dirs")}
      subtitle={copy("settings.data_dirs.subtitle")}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={detectPaths}
            disabled={loading || saving || detectingPaths}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
            )}
          >
            {detectingPaths ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden />
            )}
            {detectingPaths
              ? copy("settings.data_dirs.auto_detecting")
              : copy("settings.data_dirs.auto_detect")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving || detectingPaths}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              "border-oai-gray-200 text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
            )}
          >
            {savedNotice && !dirty ? (
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden />
            )}
            {saving
              ? copy("settings.data_dirs.saving")
              : savedNotice && !dirty
                ? copy("settings.data_dirs.saved_button")
                : copy("settings.data_dirs.save")}
          </button>
        </div>
      }
    >
      {DIRECTORY_FIELDS.map((field) => (
        <DirectoryInput
          key={field.key}
          label={copy(field.labelKey)}
          hint={copy(field.hintKey)}
          value={draft[field.key]}
          onChange={updateField(field.key)}
          onSelect={() => chooseDirectory(field.key)}
          selecting={selectingField === field.key}
          notice={selectNotice?.field === field.key ? selectNotice.message : ""}
          disabled={loading || saving || detectingPaths}
          envStatus={envStatuses[field.key] || null}
          detecting={detectingField === field.key}
          onDetect={() => detectEnvironment(field.key, draft[field.key])}
        />
      ))}
      {(error || savedNotice || detectNotice) && (
        <div className="py-3 text-xs">
          {error ? (
            <span className="text-red-600 dark:text-red-400">{error}</span>
          ) : detectNotice ? (
            <span className={detectNotice.error
              ? "text-red-600 dark:text-red-400"
              : "text-oai-gray-500 dark:text-oai-gray-400"}
            >
              {detectNotice.message}
            </span>
          ) : (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">
              {syncState === "syncing"
                ? copy("settings.data_dirs.syncing")
                : syncState === "error"
                  ? copy("settings.data_dirs.sync_error")
                  : copy("settings.data_dirs.saved")}
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

function DirectoryInput({
  label,
  hint,
  value,
  onChange,
  onSelect,
  selecting,
  notice,
  disabled,
  envStatus,
  detecting,
  onDetect,
}) {
  const isReady = envStatus?.status === "ready";
  const isDetected = envStatus?.status === "detected";
  const isNotDetected = envStatus && envStatus.status === "not-detected";
  const envLabel = envStatus?.environment === "win"
    ? copy("settings.data_dirs.env.win")
    : envStatus?.environment === "wsl-ubuntu"
      ? copy("settings.data_dirs.env.wsl_ubuntu")
      : copy("settings.data_dirs.env.unknown");

  return (
    <div className="block py-3">
      <div className="flex items-center justify-between">
        <span className="block text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</span>
        <button
          type="button"
          onClick={onDetect}
          disabled={disabled || detecting}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
            "border-oai-gray-200 text-oai-gray-600 hover:bg-oai-gray-50 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-oai-gray-800 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800",
          )}
          aria-label={copy("settings.data_dirs.detect_env_aria", { agent: label })}
        >
          {detecting ? (
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
          ) : isReady ? (
            <CheckCircle className="h-3 w-3 text-emerald-500 dark:text-emerald-400" aria-hidden />
          ) : isDetected ? (
            <CheckCircle className="h-3 w-3 text-amber-500 dark:text-amber-400" aria-hidden />
          ) : isNotDetected ? (
            <XCircle className="h-3 w-3 text-oai-gray-400 dark:text-oai-gray-500" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          {detecting
            ? copy("settings.data_dirs.detecting")
            : isReady
              ? copy("settings.data_dirs.ready")
              : isDetected
                ? copy("settings.data_dirs.installed_no_data")
              : isNotDetected
                ? copy("settings.data_dirs.not_detected")
                : copy("settings.data_dirs.detect_env")}
        </button>
      </div>
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
      {envStatus && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {isReady ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-3 w-3" aria-hidden />
              {copy("settings.data_dirs.ready")}
              {envLabel && (
                <span className="text-oai-gray-500 dark:text-oai-gray-400">
                  ({envLabel})
                </span>
              )}
            </span>
          ) : isDetected ? (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <CheckCircle className="h-3 w-3" aria-hidden />
              {copy("settings.data_dirs.installed_no_data")}
              <span className="text-oai-gray-500 dark:text-oai-gray-400">({envLabel})</span>
            </span>
          ) : isNotDetected ? (
            <span className="inline-flex items-center gap-1 text-oai-gray-500 dark:text-oai-gray-400">
              <XCircle className="h-3 w-3" aria-hidden />
              {copy("settings.data_dirs.not_detected")}
              {envStatus.environment === "not-detected" && (
                <span className="text-oai-gray-400 dark:text-oai-gray-500">
                  ({copy("settings.data_dirs.not_detected_reason")})
                </span>
              )}
            </span>
          ) : null}
          {envStatus?.currentVersion && (
            <span className="text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.data_dirs.version_current", { version: envStatus.currentVersion })}
            </span>
          )}
        </div>
      )}
      {notice ? (
        <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{notice}</span>
      ) : null}
    </div>
  );
}
