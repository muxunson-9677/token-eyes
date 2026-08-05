import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, Save, RefreshCw, CheckCircle, Search, XCircle, GripVertical } from "lucide-react";
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
import { isNativeApp, isNativeWindowsApp } from "../../lib/native-bridge.js";
import { selectDirectoryViaTauri } from "../../lib/tauri-directory.js";

const DIRECTORY_FIELDS = [
  { key: "claude", labelKey: "settings.data_dirs.claude", hintKey: "settings.data_dirs.claude_hint" },
  { key: "codex", labelKey: "settings.data_dirs.codex", hintKey: "settings.data_dirs.codex_hint" },
  { key: "cursor", labelKey: "settings.data_dirs.cursor", hintKey: "settings.data_dirs.cursor_hint" },
  { key: "trae", labelKey: "settings.data_dirs.trae", hintKey: "settings.data_dirs.trae_hint" },
  { key: "codebuddy", labelKey: "settings.data_dirs.codebuddy", hintKey: "settings.data_dirs.codebuddy_hint" },
  { key: "gemini", labelKey: "settings.data_dirs.gemini", hintKey: "settings.data_dirs.gemini_hint" },
  { key: "hermes", labelKey: "settings.data_dirs.hermes", hintKey: "settings.data_dirs.hermes_hint" },
  { key: "openclaw", labelKey: "settings.data_dirs.openclaw", hintKey: "settings.data_dirs.openclaw_hint" },
  { key: "opencode", labelKey: "settings.data_dirs.opencode", hintKey: "settings.data_dirs.opencode_hint" },
  { key: "antigravity", labelKey: "settings.data_dirs.antigravity", hintKey: "settings.data_dirs.antigravity_hint" },
];

const EMPTY_DIRS = Object.fromEntries(DIRECTORY_FIELDS.map((field) => [field.key, ""]));
const DEFAULT_DIRECTORY_ORDER = DIRECTORY_FIELDS.map((field) => field.key);

export function resolveDataDirectoryOrder(value) {
  const known = new Set(DEFAULT_DIRECTORY_ORDER);
  const seen = new Set();
  const preferred = (Array.isArray(value) ? value : [])
    .map((key) => String(key || "").trim().toLowerCase())
    .filter((key) => known.has(key) && !seen.has(key) && seen.add(key));
  return [...preferred, ...DEFAULT_DIRECTORY_ORDER.filter((key) => !seen.has(key))];
}

function SortableDirectoryRow({ fieldKey, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: fieldKey });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="data-directory-row"
      data-directory-key={fieldKey}
      className={cn("flex items-start gap-1", isDragging && "relative z-10 bg-white shadow-lg dark:bg-oai-gray-900")}
    >
      <button type="button" {...attributes} {...listeners} aria-label={copy("settings.data_dirs.drag", { agent: fieldKey })} className="mt-3 inline-flex h-10 w-10 cursor-grab items-center justify-center rounded text-oai-gray-400 hover:bg-oai-gray-100 active:cursor-grabbing dark:hover:bg-oai-gray-800">
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function normalizeDataDirectories(value) {
  const input = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    DIRECTORY_FIELDS.map((field) => [field.key, typeof input[field.key] === "string" ? input[field.key] : ""]),
  );
}

export function mergeDetectedDataDirectories(currentValue, detectedValue) {
  const current = normalizeDataDirectories(currentValue);
  const detected = normalizeDataDirectories(detectedValue);
  return Object.fromEntries(
    DIRECTORY_FIELDS.map(({ key }) => [key, detected[key] || current[key] || ""]),
  );
}

export function DataDirectoriesSection() {
  const [draft, setDraft] = useState(EMPTY_DIRS);
  const [saved, setSaved] = useState(EMPTY_DIRS);
  const [fieldOrder, setFieldOrder] = useState(DEFAULT_DIRECTORY_ORDER);
  const [savedFieldOrder, setSavedFieldOrder] = useState(DEFAULT_DIRECTORY_ORDER);
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      .then(async (settings) => {
        if (cancelled) return;
        let dirs = normalizeDataDirectories(settings?.dataDirectories);
        const order = resolveDataDirectoryOrder(settings?.dataDirectoryOrder);
        if (isNativeApp() && (!dirs.trae || !dirs.codebuddy)) {
          try {
            const detectedResult = await detectLocalDataDirectories();
            if (cancelled) return;
            dirs = mergeDetectedDataDirectories(dirs, detectedResult?.dataDirectories);
            const persisted = await setLocalSettings({
              dataDirectories: dirs,
              dataDirectoryOrder: order,
            });
            if (cancelled) return;
            dirs = mergeDetectedDataDirectories(dirs, persisted?.dataDirectories);
            setEnvStatuses(Object.fromEntries(
              DIRECTORY_FIELDS.map((field) => [field.key, detectedResult?.detected?.[field.key] || null]),
            ));
          } catch {
            // Keep the settings page usable when background discovery is unavailable.
          }
        }
        setDraft(dirs);
        setSaved(dirs);
        setFieldOrder(order);
        setSavedFieldOrder(order);
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

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved) || JSON.stringify(fieldOrder) !== JSON.stringify(savedFieldOrder),
    [draft, fieldOrder, saved, savedFieldOrder],
  );

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
      const result = await setLocalSettings({ dataDirectories: draft, dataDirectoryOrder: fieldOrder });
      const dirs = normalizeDataDirectories(result?.dataDirectories);
      const order = resolveDataDirectoryOrder(result?.dataDirectoryOrder || fieldOrder);
      setDraft(dirs);
      setSaved(dirs);
      setFieldOrder(order);
      setSavedFieldOrder(order);
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

  const handleDirectoryDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setFieldOrder((current) => {
      const from = current.indexOf(String(active.id));
      const to = current.indexOf(String(over.id));
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
    setSavedNotice(false);
  };

  const detectPaths = async () => {
    setDetectingPaths(true);
    setDetectNotice(null);
    setSelectNotice(null);
    setSavedNotice(false);
    setError("");
    try {
      const result = await detectLocalDataDirectories();
      const discovered = mergeDetectedDataDirectories(draft, result?.dataDirectories);
      const count = Object.values(discovered).filter(Boolean).length;
      setDraft(discovered);
      const persisted = await setLocalSettings({
        dataDirectories: discovered,
        dataDirectoryOrder: fieldOrder,
      });
      const persistedDirectories = mergeDetectedDataDirectories(discovered, persisted?.dataDirectories);
      setDraft(persistedDirectories);
      setSaved(persistedDirectories);
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

  const orderedFields = useMemo(
    () => {
      return fieldOrder
        .map(function resolveField(fieldKey) {
          return DIRECTORY_FIELDS.find(function matchesField(candidate) {
            return candidate.key === fieldKey;
          });
        })
        .filter(Boolean);
    },
    [fieldOrder],
  );

  return (
    <SectionCard
      className="tt-settings-data-directory-card"
      title={copy("settings.section.data_dirs")}
      subtitle={copy("settings.data_dirs.subtitle")}
      icon={FolderOpen}
      iconTone="green"
      collapsible
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={detectPaths}
            disabled={loading || saving || detectingPaths}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
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
              "inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
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
      <div className="tt-data-directory-compact">
        <output>{draft.codex || draft.claude || copy("settings.data_dirs.placeholder")}</output>
        <button type="button" onClick={() => chooseDirectory("codex")} disabled={loading || saving || selectingField === "codex"}>
          <FolderOpen aria-hidden />
          {copy("settings.data_dirs.change_directory")}
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDirectoryDragEnd}>
        <SortableContext items={fieldOrder} strategy={verticalListSortingStrategy}>
          {orderedFields.map((field) => (
              <SortableDirectoryRow key={field.key} fieldKey={field.key}>
                <DirectoryInput
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
              </SortableDirectoryRow>
          ))}
        </SortableContext>
      </DndContext>
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
            "inline-flex h-10 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
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
            <CheckCircle className="h-3 w-3 text-emerald-500 dark:text-emerald-400" aria-hidden />
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
            "h-10 min-w-0 flex-1 rounded-md border border-oai-gray-200 bg-white px-3 font-mono text-xs text-oai-gray-900 outline-none transition-colors",
            "placeholder:text-oai-gray-400 focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 disabled:opacity-60",
            "dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-600",
          )}
        />
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled || selecting}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
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
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
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
      {envStatus?.dataPath && envStatus.dataPath !== value ? (
        <span className="mt-1 block break-all font-mono text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.data_dirs.resolved_data_path", { path: envStatus.dataPath })}
        </span>
      ) : null}
      {notice ? (
        <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{notice}</span>
      ) : null}
    </div>
  );
}
