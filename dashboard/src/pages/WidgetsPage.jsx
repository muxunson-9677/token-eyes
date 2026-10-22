import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Download,
  Ellipsis,
  Filter,
  FolderKanban,
  FolderPlus,
  Gauge,
  GripVertical,
  History,
  ListChecks,
  Monitor,
  Package,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import { Select } from "../ui/components";
import { isNativeEmbed, isTauriApp, nativeAction } from "../lib/native-bridge.js";
import { useNativeSettings } from "../hooks/use-native-settings.js";
import {
  FALLBACK_MENU_BAR_ITEMS,
  normalizeMenuBarItems,
} from "../lib/menu-bar-display.js";
import { ToggleSwitch } from "../components/settings/Controls.jsx";
import { FadeIn, StaggerContainer, StaggerItem } from "../ui/foundation/FadeIn.jsx";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import { getDesktopWidgetViewModel, selectLocalDirectory } from "../lib/api.ts";
import { selectDirectoryViaTauri } from "../lib/tauri-directory.js";
import {
  mergeWidgetProjectOptions,
  mergeWidgetStatusProjects,
  migrateWidgetProjectSelectionIds,
  widgetProjectFromPath,
} from "../lib/desktop-widget-projects.ts";
import {
  groupWidgetLimits,
  splitWidgetLimitGroups,
  widgetLimitGroupSelected,
} from "../lib/widget-limit-groups.js";
import {
  tokenPlanExpiryTimestamp,
  tokenPlanStartTimestamp,
} from "../lib/token-plan-validity.js";

const WIDGET_PRESS_TARGET = [
  "button:not(:disabled)",
  "select:not(:disabled)",
  '[role="button"]:not([aria-disabled="true"])',
].join(",");

function startWidgetPressRebound(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const interactiveTarget = event.target instanceof Element
    ? event.target.closest(WIDGET_PRESS_TARGET)
    : null;
  const target = interactiveTarget?.matches("select")
    ? interactiveTarget.closest(".tt-widget-toolbar-select, .tt-widget-window-select") || interactiveTarget
    : interactiveTarget;
  if (!(target instanceof HTMLElement)) return;
  target.classList.remove("tt-widget-click-bounce");
  void target.offsetWidth;
  target.classList.add("tt-widget-click-bounce");
}

function finishWidgetPressRebound(event) {
  if (event.target instanceof HTMLElement && event.target.classList.contains("tt-widget-click-bounce")) {
    event.target.classList.remove("tt-widget-click-bounce");
  }
}

/* ---------- SVG widget illustrations ----------
 * Hand-drawn previews of the real macOS widgets. Pure SVG so they stay
 * crisp at any scale and don't require shipping PNGs.
 *
 * Hardcoded strings ("TODAY", "203.2M", "claude-opus-4-6", etc.)
 * intentionally bypass copy.csv — they mirror the literal Swift string
 * constants in TokenTrackerWidget/Widgets/*.swift which ship English-only
 * in the native app. Keeping them inline makes the preview read as a
 * faithful screenshot.
 */

const WIDGET_W = 264;
const WIDGET_H = 124;
const ROUNDED_FONT = "ui-rounded, -apple-system, system-ui";
const ACTIVE_SESSION_WINDOWS = ["1h", "3h", "5h", "1d", "3d"];
const DEFAULT_ACTIVE_SESSION_WINDOW = "1h";

// Model accent palette — mirrors WidgetTheme.modelDot in
// TokenTrackerBar/TokenTrackerWidget/Views/WidgetTheme.swift
const MODEL_COLORS = ["#5A8CF2", "#9973E6", "#4DB8A6", "#E68C59"];

// Source accent palette — mirrors WidgetTheme.sourceColor (SwiftUI system
// colors, approximated in hex to match rendered appearance)
const SOURCE_COLORS = {
  claude: "#C77DFF", // SwiftUI .purple
  codex: "#34C759",  // SwiftUI .green
  cursor: "#FFCC00", // SwiftUI .yellow
  gemini: "#0A84FF", // SwiftUI .blue
};

// Limit bar fill — mirrors WidgetTheme.limitBarColor
function limitBarFill(fraction) {
  if (fraction >= 0.9) return "#E64D4D"; // red
  if (fraction >= 0.7) return "#D9A633"; // amber
  return "#33B866";                      // green
}

/**
 * PreviewShell — renders a widget tile at the real macOS systemMedium
 * aspect ratio (~2.13:1). `size="lg"` is the hero (up to 560px wide),
 * `size="sm"` is a secondary catalog tile (up to 264px wide). Both scale
 * down responsively on narrow viewports using CSS aspect-ratio.
 *
 * `rounded-[22/32px]` is an intentional deviation from the design system's
 * token radii: it mimics the macOS continuous-corner widget radius so the
 * preview reads as an Apple widget rather than a generic card.
 */
function PreviewShell({ size = "sm", children }) {
  const isHero = size === "lg";
  const maxWidth = isHero ? 560 : 264;
  const radius = isHero ? 32 : 22;
  return (
    <div
      className={cn(
        "tt-surface-nested flex w-full items-center justify-center rounded-[var(--tt-card-radius)]",
        isHero ? "py-10 sm:py-14 px-6" : "py-6 px-4",
      )}
    >
      <div
        className="overflow-hidden bg-white dark:bg-oai-gray-800 shadow-oai-md dark:shadow-[0_2px_4px_rgba(0,0,0,0.4),0_8px_24px_rgba(0,0,0,0.5)]"
        style={{
          width: "100%",
          maxWidth,
          aspectRatio: `${WIDGET_W} / ${WIDGET_H}`,
          borderRadius: radius,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TopModelsWidgetPreview() {
  // Four rows mirroring ModelBar in TopModelsWidget.swift. Bar fill matches
  // the dot color (not a neutral track) — this is intentional per Swift.
  const models = [
    { name: "claude-opus-4-6",            value: "586.4M", pct: 59 },
    { name: "claude-sonnet-4-5-20250929", value: "218.7M", pct: 22 },
    { name: "gpt-5.4",                    value: "80.6M",  pct: 8 },
    { name: "composer-2-fast",            value: "52.1M",  pct: 5 },
  ];
  const rowGap = 22;
  // Vertically centered: content spans ~78px in a 124px tile.
  const rowStart = 28;
  const trackX = 14;
  const trackW = 236;
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        {models.map((m, i) => {
          const y = rowStart + i * rowGap;
          const color = MODEL_COLORS[i % MODEL_COLORS.length];
          return (
            <g key={m.name}>
              <circle cx="18" cy={y - 3} r="2.5" fill={color} />
              <text x="26" y={y} className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="500">{m.name}</text>
              <text x="218" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="9" fontWeight="600" fontFamily={ROUNDED_FONT}>{m.value}</text>
              <text x="250" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="600" fontFamily={ROUNDED_FONT}>{m.pct}%</text>
              <rect x={trackX} y={y + 4} width={trackW} height="2.8" rx="1.4" className="fill-oai-gray-200 dark:fill-oai-gray-700" />
              <rect x={trackX} y={y + 4} width={Math.max(trackW * (m.pct / 100), 4)} height="2.8" rx="1.4" fill={color} />
            </g>
          );
        })}
      </svg>
    </PreviewShell>
  );
}

function UsageLimitsWidgetPreview() {
  // Four rows mirroring LimitRow in UsageLimitsWidget.swift. Bullet color
  // follows the provider source; bar fill follows limitBarColor(fraction).
  const rows = [
    { label: "Claude · 7d",    source: "claude", reset: "in 1d",     pct: 61 },
    { label: "Claude · 5h",    source: "claude", reset: "in 4h 28m", pct: 4 },
    { label: "Cursor",         source: "cursor", reset: "in 25d",    pct: 51 },
    { label: "Codex · weekly", source: "codex",  reset: "in 1d",     pct: 32 },
  ];
  const rowGap = 22;
  const rowStart = 28;
  const trackX = 14;
  const trackW = 236;
  return (
    <PreviewShell>
      <svg viewBox="0 0 264 124" className="h-full w-full" aria-hidden="true">
        {rows.map((r, i) => {
          const y = rowStart + i * rowGap;
          const dot = SOURCE_COLORS[r.source];
          const fill = limitBarFill(r.pct / 100);
          return (
            <g key={r.label}>
              <circle cx="18" cy={y - 3} r="2.5" fill={dot} />
              <text x="26" y={y} className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="500">{r.label}</text>
              <text x="218" y={y} textAnchor="end" className="fill-oai-gray-500 dark:fill-oai-gray-400" fontSize="8" fontWeight="500" fontFamily={ROUNDED_FONT}>{r.reset}</text>
              <text x="250" y={y} textAnchor="end" className="fill-oai-black dark:fill-white" fontSize="9" fontWeight="700" fontFamily={ROUNDED_FONT}>{r.pct}%</text>
              <rect x={trackX} y={y + 4} width={trackW} height="2.8" rx="1.4" className="fill-oai-gray-200 dark:fill-oai-gray-700" />
              <rect x={trackX} y={y + 4} width={Math.max(trackW * (r.pct / 100), 4)} height="2.8" rx="1.4" fill={fill} />
            </g>
          );
        })}
      </svg>
    </PreviewShell>
  );
}

/* ---------- Menu bar display configurator ---------- */

function previewValueFor(item) {
  switch (item.category) {
    case "cost":
      return "$8.42";
    case "limits":
      return "62%";
    default:
      return item.id === "last7dTokens" ? "1.8B" : "203M";
  }
}

function metricLabel(id, fallback) {
  switch (id) {
    case "todayTokens":
      return copy("menubar.metric.today_tokens");
    case "todayCost":
      return copy("menubar.metric.today_cost");
    case "last7dTokens":
      return copy("menubar.metric.last_7d_tokens");
    case "totalTokens":
      return copy("menubar.metric.total_tokens");
    case "totalCost":
      return copy("menubar.metric.total_cost");
    case "claude5h":
      return copy("menubar.metric.claude_5h");
    case "claude7d":
      return copy("menubar.metric.claude_7d");
    case "codex5h":
      return copy("menubar.metric.codex_5h");
    case "codex7d":
      return copy("menubar.metric.codex_7d");
    case "codexSpark5h":
      return copy("menubar.metric.codex_spark_5h");
    case "codexSpark7d":
      return copy("menubar.metric.codex_spark_7d");
    default:
      return fallback;
  }
}

function fillTwoSlots(ids, availableItems) {
  const allowed = new Set(availableItems.map((item) => item.id));
  const filled = ids.filter((id) => allowed.has(id));
  for (const item of availableItems) {
    if (filled.length >= 2) break;
    if (!filled.includes(item.id)) filled.push(item.id);
  }
  return filled.slice(0, 2);
}

/**
 * Compact menu-bar segment mock — sized to the same proportions as a real
 * macOS status item so the preview reads as "this is what your menu bar
 * will look like" rather than "this is a control surface".
 *
 * Dark pill on a neutral wallpaper-style backdrop. When `showStats` is off,
 * only the icon is shown (matches the native fallback behavior).
 */
function MenuBarPreview({ slotConfigs, showStats }) {
  return (
    <div className="flex justify-center rounded-xl bg-gradient-to-b from-oai-gray-100 to-oai-gray-200 px-6 py-8 dark:from-oai-gray-950/80 dark:to-oai-gray-900/80">
      <div
        className="inline-flex items-stretch rounded-md shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/10 dark:ring-white/10 px-3"
        style={{ background: "linear-gradient(180deg, #2c2c2e 0%, #1c1c1e 100%)" }}
      >
        {/* Icon column: asymmetric padding (more left, less right) brings the
            character close to the first metric since there's no separator
            between them. Character is sized to read like a real macOS
            menu-bar glyph rather than a hero illustration. */}
        <div className="flex items-center pl-2 pr-1 py-2.5">
          <img
            src="/clawd/mini/idle-tight.svg"
            alt=""
            aria-hidden="true"
            className="block shrink-0"
            style={{ height: 22, width: "auto" }}
            draggable="false"
          />
        </div>
        {showStats
          ? slotConfigs.map(({ slot, item }, idx) => (
              <React.Fragment key={slot}>
                {idx !== 0 ? (
                  <span className="my-1 w-px bg-white/20" aria-hidden="true" />
                ) : null}
                <div className={cn(
                  "flex min-w-[52px] flex-col items-center justify-center py-1.5",
                  // First metric column hugs closer to the icon (no separator
                  // there); subsequent columns get even padding around the divider.
                  idx === 0 ? "pl-1 pr-2" : "px-2",
                )}>
                  <span className="text-[13px] font-semibold leading-none tabular-nums text-white">
                    {item?.previewValue || "--"}
                  </span>
                  <span className="mt-[2px] text-[6px] font-semibold uppercase leading-none text-white/75">
                    {item?.shortLabel || "Metric"}
                  </span>
                </div>
              </React.Fragment>
            ))
          : null}
      </div>
    </div>
  );
}

function MenuBarSlotSelect({ slot, value, options, disabled, onChange }) {
  const slotLabel = slot === 0 ? copy("menubar.slot.primary") : copy("menubar.slot.secondary");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oai-gray-500 dark:text-oai-gray-400">
        {slotLabel}
      </span>
      <Select
        value={value}
        disabled={disabled}
        ariaLabel={slotLabel}
        onValueChange={(next) => onChange(slot, next)}
        options={options.map((option) => ({ value: option.id, label: option.displayLabel }))}
        matchTriggerWidth
        className="w-full px-3 py-2 text-sm font-medium"
      />
    </div>
  );
}

function MenuBarToggleRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-oai-black dark:text-white">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</p>
        ) : null}
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function MenuBarDisplayCard() {
  const { available, settings, setSetting } = useNativeSettings();

  const availableItems = useMemo(() => {
    const nativeItems = Array.isArray(settings?.menuBarAvailableItems)
      ? settings.menuBarAvailableItems
      : FALLBACK_MENU_BAR_ITEMS;
    return nativeItems.map((item) => ({
      ...item,
      displayLabel: metricLabel(item.id, item.label),
      previewValue: previewValueFor(item),
    }));
  }, [settings?.menuBarAvailableItems]);

  const maxItems = Number(settings?.menuBarMaxItems) || 2;
  const selectedIds = useMemo(
    () => normalizeMenuBarItems(settings?.menuBarItems, availableItems, maxItems),
    [availableItems, maxItems, settings?.menuBarItems],
  );
  const slotIds = useMemo(() => fillTwoSlots(selectedIds, availableItems), [availableItems, selectedIds]);
  const showStats = settings?.showStats !== false;

  const saveSelection = (ids) => {
    setSetting("menuBarItems", normalizeMenuBarItems(ids, availableItems, maxItems));
  };

  const changeSlot = (slot, id) => {
    const next = [...slotIds];
    const otherSlot = slot === 0 ? 1 : 0;
    if (next[otherSlot] === id) return;
    next[slot] = id;
    saveSelection(next);
  };

  const slotConfigs = [0, 1].map((slot) => {
    const currentValue = slotIds[slot] || availableItems[slot]?.id || "";
    const otherSlot = slot === 0 ? 1 : 0;
    const otherValue = slotIds[otherSlot];
    const options = availableItems.filter(
      (candidate) => candidate.id === currentValue || candidate.id !== otherValue,
    );
    const item = availableItems.find((candidate) => candidate.id === currentValue);
    return { slot, currentValue, options, item };
  });

  const animatedIcon = settings?.animatedIcon !== false;
  const confettiOnReset = settings?.confettiOnReset !== false;

  return (
    <article className="tt-surface rounded-[var(--tt-card-radius)] p-5 sm:p-6">
      <MenuBarPreview slotConfigs={slotConfigs} showStats={showStats} />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {slotConfigs.map(({ slot, currentValue, options }) => (
          <MenuBarSlotSelect
            key={slot}
            slot={slot}
            value={currentValue}
            options={options}
            disabled={!available || !showStats}
            onChange={changeSlot}
          />
        ))}
      </div>

      <div className="mt-5 divide-y divide-oai-gray-100 border-t border-oai-gray-100 dark:divide-oai-gray-800 dark:border-oai-gray-800">
        <MenuBarToggleRow
          label={copy("settings.menubar.showStats")}
          hint={available ? copy("settings.menubar.showStatsHint") : copy("menubar.native_only")}
          checked={showStats}
          disabled={!available}
          onChange={() => setSetting("showStats", !showStats)}
        />
        <MenuBarToggleRow
          label={copy("settings.menubar.animatedIcon")}
          hint={copy("settings.menubar.animatedIconHint")}
          checked={animatedIcon}
          disabled={!available}
          onChange={() => setSetting("animatedIcon", !animatedIcon)}
        />
        <MenuBarToggleRow
          label={copy("settings.menubar.confettiOnReset")}
          hint={copy("settings.menubar.confettiOnResetHint")}
          checked={confettiOnReset}
          disabled={!available}
          onChange={() => setSetting("confettiOnReset", !confettiOnReset)}
        />
      </div>
    </article>
  );
}

/* ---------- Header CTA — adaptive by platform ----------
 * native  → inside the menu bar app's WKWebView (bridge currently available)
 * mac-web → browser on macOS (can download the native app)
 * other   → non-macOS browser (widgets unsupported)
 *
 * NOTE: we use `isNativeEmbed()` here (checks `window.webkit.messageHandlers
 * .nativeBridge` directly) instead of `isNativeApp()` (which reads a sticky
 * localStorage flag). The sticky flag persists after the native app launched
 * the dashboard once, so later opening `localhost:5173` in a regular browser
 * would incorrectly report native mode — clicks would then fire a bridge
 * message into the void. isNativeEmbed is the honest "right now" test.
 */
function useClientPlatform() {
  const [platform, setPlatform] = useState("loading");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeEmbed()) {
      setPlatform("native");
      return;
    }
    if (isTauriApp()) {
      setPlatform("windows");
      return;
    }
    const ua = (navigator.userAgent || "").toLowerCase();
    if (/windows/.test(ua)) {
      setPlatform("windows");
      return;
    }
    const isMac = /mac/.test(ua) && !/iphone|ipad/.test(ua);
    setPlatform(isMac ? "mac-web" : "other");
  }, []);
  return platform;
}

function getTauriInvoke() {
  if (typeof window === "undefined") return null;
  return window.__TAURI__?.core?.invoke
    || window.__TAURI__?.invoke
    || window.__TAURI_INTERNALS__?.invoke
    || null;
}

function WindowsWidgetToggle() {
  const available = Boolean(getTauriInvoke());
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(available);
  const [error, setError] = useState(false);
  const visibilityRequest = useRef(0);
  const commandInFlight = useRef(false);

  useEffect(() => {
    const invoke = getTauriInvoke();
    if (!invoke) return undefined;
    let mounted = true;
    const reload = async () => {
      const request = ++visibilityRequest.current;
      try {
        const prefs = await invoke("get_desktop_widget_prefs");
        if (mounted && request === visibilityRequest.current) {
          setVisible(prefs?.visible === true);
          setError(false);
        }
      } catch {
        if (mounted && request === visibilityRequest.current) setError(true);
      } finally {
        if (mounted && request === visibilityRequest.current) setBusy(false);
      }
    };
    const syncWhenVisible = () => {
      if (document.visibilityState !== "hidden" && !commandInFlight.current) void reload();
    };
    void reload();
    window.addEventListener("focus", syncWhenVisible);
    document.addEventListener("visibilitychange", syncWhenVisible);
    return () => {
      mounted = false;
      window.removeEventListener("focus", syncWhenVisible);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  }, []);

  const toggle = async () => {
    const invoke = getTauriInvoke();
    if (!invoke || busy) return;
    commandInFlight.current = true;
    const request = ++visibilityRequest.current;
    setBusy(true);
    setError(false);
    try {
      const prefs = await invoke(visible ? "hide_desktop_widget" : "show_desktop_widget");
      if (request !== visibilityRequest.current) return;
      if (typeof prefs?.visible === "boolean") {
        setVisible(prefs.visible);
      } else {
        const restored = await invoke("get_desktop_widget_prefs");
        if (request === visibilityRequest.current) setVisible(restored?.visible === true);
      }
    } catch {
      if (request === visibilityRequest.current) setError(true);
    } finally {
      commandInFlight.current = false;
      if (request === visibilityRequest.current) setBusy(false);
    }
  };

  if (!available) {
    return (
      <button
        type="button"
        disabled
        title={copy("widgets.windows.unavailable")}
        className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-[var(--tt-control-radius)] border border-oai-gray-200 bg-oai-gray-50 px-4 text-sm font-medium text-oai-gray-500 opacity-70 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-400"
      >
        <Monitor className="h-4 w-4" aria-hidden="true" />
        {copy("widgets.windows.unavailable")}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="tt-pressable tt-product-focusable inline-flex h-10 items-center gap-2 rounded-[var(--tt-control-radius)] bg-oai-black px-4 text-sm font-medium text-white hover:bg-oai-gray-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-200"
      >
        <Monitor className="h-4 w-4" aria-hidden="true" />
        {copy(visible ? "widgets.windows.hide" : "widgets.windows.show")}
      </button>
      {error ? <small role="alert" className="text-xs text-red-600 dark:text-red-400">{copy("widgets.windows.error")}</small> : null}
    </span>
  );
}

function WindowsWidgetProjectSettings() {
  const [prefs, setPrefs] = useState(null);
  const [recentProjects, setRecentProjects] = useState([]);
  const [draftIds, setDraftIds] = useState([]);
  const [draftProjects, setDraftProjects] = useState([]);
  const [draftActiveSessionWindow, setDraftActiveSessionWindow] = useState(DEFAULT_ACTIVE_SESSION_WINDOW);
  const [limitOptions, setLimitOptions] = useState([]);
  const [draftLimitIds, setDraftLimitIds] = useState([]);
  const draggedLimitId = useRef(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [limitsExpanded, setLimitsExpanded] = useState(false);

  useEffect(() => {
    const invoke = getTauriInvoke();
    if (!invoke) return undefined;
    let mounted = true;
    void invoke("get_desktop_widget_prefs").then(async (nextPrefs) => {
      const activeSessionWindow = ACTIVE_SESSION_WINDOWS.includes(nextPrefs?.activeSessionWindow)
        ? nextPrefs.activeSessionWindow
        : DEFAULT_ACTIVE_SESSION_WINDOW;
      return [nextPrefs, await getDesktopWidgetViewModel("all", activeSessionWindow)];
    }).then(([nextPrefs, model]) => {
      if (!mounted) return;
      const detectedLimits = Array.isArray(model?.limits) ? model.limits : [];
      const detectedLimitIds = detectedLimits.map((limit) => String(limit.id || "")).filter(Boolean);
      const restoredLimitIds = Array.isArray(nextPrefs?.selectedLimitIds)
        ? selectedWidgetLimitIds(detectedLimits, nextPrefs.selectedLimitIds)
        : detectedLimitIds;
      const selectedLimitSet = new Set(restoredLimitIds);
      const orderedLimits = [
        ...restoredLimitIds.map((id) => detectedLimits.find((limit) => limit.id === id)).filter(Boolean),
        ...detectedLimits.filter((limit) => !selectedLimitSet.has(limit.id)),
      ];
      const restored = {
        ...(nextPrefs || {}),
        activeSessionWindow: ACTIVE_SESSION_WINDOWS.includes(nextPrefs?.activeSessionWindow)
          ? nextPrefs.activeSessionWindow
          : DEFAULT_ACTIVE_SESSION_WINDOW,
        selectedProjectIds: Array.isArray(nextPrefs?.selectedProjectIds)
          ? nextPrefs.selectedProjectIds
          : [],
        selectedProjects: Array.isArray(nextPrefs?.selectedProjects)
          ? nextPrefs.selectedProjects
          : [],
        selectedLimitIds: restoredLimitIds,
      };
      setPrefs(restored);
      setDraftIds(restored.selectedProjectIds);
      setDraftProjects(restored.selectedProjects);
      setDraftActiveSessionWindow(restored.activeSessionWindow);
      setLimitOptions(orderedLimits);
      setDraftLimitIds(restored.selectedLimitIds);
      setRecentProjects(
        mergeWidgetProjectOptions([
          ...(Array.isArray(model?.projectStatus?.projects)
            ? model.projectStatus.projects
            : []),
          ...(Array.isArray(model?.projectStatus?.recentProjects)
            ? model.projectStatus.recentProjects
            : []),
        ], []).slice(0, 10),
      );
      setError(false);
    }).catch(() => {
      if (mounted) setError(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedIds = draftIds;
  const projectOptions = mergeWidgetProjectOptions(
    recentProjects,
    draftProjects,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = normalizedQuery
    ? projectOptions.filter((project) => (
      String(project?.label || "").toLocaleLowerCase().includes(normalizedQuery)
    ))
    : projectOptions;

  const save = async () => {
    const invoke = getTauriInvoke();
    if (!invoke || !prefs || !dirty || saving) return;
    const byId = new Map(projectOptions.map((project) => [project.id, project]));
    const nextPrefs = {
      ...prefs,
      activeSessionWindow: draftActiveSessionWindow,
      selectedProjectIds: draftIds,
      selectedProjects: draftIds.map((id) => byId.get(id)).filter(Boolean),
      selectedLimitIds: draftLimitIds,
    };
    setSaving(true);
    setSaved(false);
    setError(false);
    try {
      const persisted = await invoke("set_desktop_widget_prefs", { prefs: nextPrefs });
      setPrefs(persisted || nextPrefs);
      setDraftProjects(nextPrefs.selectedProjects);
      setDirty(false);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const toggleProject = (project) => {
    setDraftProjects((current) => mergeWidgetProjectOptions([], [...current, project]));
    setDraftIds((current) => (
      current.includes(project.id)
        ? current.filter((value) => value !== project.id)
        : [...current, project.id]
    ));
    setDirty(true);
    setSaved(false);
  };

  const toggleLimit = (plan) => {
    const planIds = plan.windows.map((limit) => String(limit.id));
    setDraftLimitIds((current) => {
      const selected = planIds.some((id) => current.includes(id));
      return selected
        ? current.filter((value) => !planIds.includes(value))
        : [...current, ...planIds.filter((id) => !current.includes(id))];
    });
    setDirty(true);
    setSaved(false);
  };

  const dropLimit = (targetId) => {
    const sourceId = draggedLimitId.current;
    draggedLimitId.current = null;
    if (!sourceId || sourceId === targetId) return;
    setDraftLimitIds((current) => {
      const plans = groupWidgetLimits(limitOptions);
      const source = plans.find((plan) => plan.id === sourceId);
      const target = plans.find((plan) => plan.id === targetId);
      if (!source || !target) return current;
      const sourceIds = source.windows.map((limit) => String(limit.id));
      const targetIds = target.windows.map((limit) => String(limit.id));
      const next = current.filter((id) => !sourceIds.includes(id));
      const targetIndex = next.findIndex((id) => targetIds.includes(id));
      if (targetIndex === -1) return current;
      next.splice(targetIndex, 0, ...sourceIds.filter((id) => current.includes(id)));
      return next;
    });
    setDirty(true);
    setSaved(false);
  };

  const addProjectFolder = async () => {
    setError(false);
    const invoke = getTauriInvoke();
    let selectedPath = await selectDirectoryViaTauri();
    if (!selectedPath && !invoke) {
      const result = await selectLocalDirectory();
      selectedPath = result?.path || null;
    }
    const project = await widgetProjectFromPath(selectedPath);
    if (!project) return;
    setDraftProjects((current) => mergeWidgetProjectOptions([], [...current, project]));
    setDraftIds((current) => (
      current.includes(project.id) ? current : [...current, project.id]
    ));
    setDirty(true);
    setSaved(false);
  };

  const useRecentProjects = () => {
    setDraftIds(recentProjects.map((project) => String(project.id || "")).filter(Boolean));
    setDraftProjects((current) => mergeWidgetProjectOptions(recentProjects, current));
    setDirty(true);
    setSaved(false);
  };

  const limitPlans = groupWidgetLimits(limitOptions);
  const visibleLimitOptions = [
    ...limitPlans.filter((plan) => widgetLimitGroupSelected(plan, draftLimitIds)),
    ...limitPlans.filter((plan) => !widgetLimitGroupSelected(plan, draftLimitIds)),
  ];
  const selectedLimitPlanCount = limitPlans.reduce((count, plan) => {
    return count + Number(widgetLimitGroupSelected(plan, draftLimitIds));
  }, 0);

  return (
    <div className="tt-surface mb-5 rounded-[var(--tt-card-radius)] p-3 sm:p-4">
      <section className="overflow-hidden rounded-xl border border-oai-gray-200/80 bg-white/45 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
        <button
          type="button"
          aria-expanded={projectsExpanded}
          aria-controls="windows-widget-projects-panel"
          onClick={() => setProjectsExpanded((current) => !current)}
          className="tt-pressable tt-product-focusable flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/[0.06] sm:px-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200/70 bg-sky-50 text-sky-600 shadow-sm dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300">
            <FolderKanban className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-oai-black dark:text-white">
              {copy("widgets.windows.projects.title")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {selectedIds.length > 0
                ? copy("widgets.windows.projects.selected_count", { count: selectedIds.length })
                : copy("widgets.windows.projects.recent_hint")}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-oai-gray-500 transition-transform duration-200",
              projectsExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>

        {projectsExpanded ? (
          <div
            id="windows-widget-projects-panel"
            className="border-t border-oai-gray-200/70 px-3.5 pb-4 pt-3 dark:border-white/10 sm:px-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5 text-[11px] leading-5 text-oai-gray-500 dark:text-oai-gray-400">
                <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{copy("widgets.windows.projects.active_window_hint")}</span>
              </p>
              <label className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[var(--tt-control-radius)] border border-oai-gray-200 bg-white px-2.5 text-xs font-medium text-oai-gray-700 shadow-sm dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200">
                <span>{copy("widgets.windows.projects.active_window")}</span>
                <select
                  value={draftActiveSessionWindow}
                  aria-label={copy("widgets.windows.projects.active_window")}
                  onChange={(event) => {
                    setDraftActiveSessionWindow(event.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                  className="h-7 min-w-[4.5rem] cursor-pointer rounded-md border-0 bg-oai-gray-50 px-2 text-xs font-semibold text-oai-black outline-none focus:ring-2 focus:ring-oai-gray-300 dark:bg-oai-gray-800 dark:text-white dark:focus:ring-oai-gray-600"
                >
                  {ACTIVE_SESSION_WINDOWS.map((window) => (
                    <option key={window} value={window}>
                      {copy(`widgets.windows.projects.active_window.${window}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                aria-label={copy("widgets.windows.projects.add_folder")}
                disabled={!prefs}
                onClick={() => void addProjectFolder()}
                className="tt-pressable tt-product-focusable inline-flex h-9 items-center gap-1.5 rounded-[var(--tt-control-radius)] border border-oai-gray-200 bg-white px-3 text-xs font-medium text-oai-gray-700 shadow-sm hover:border-oai-gray-300 hover:bg-oai-gray-50 disabled:cursor-default disabled:opacity-45 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {copy("widgets.windows.projects.add_folder")}
              </button>
              <button
                type="button"
                aria-label={copy("widgets.windows.projects.use_recent")}
                disabled={!prefs || recentProjects.length === 0}
                onClick={useRecentProjects}
                className="tt-pressable tt-product-focusable inline-flex h-9 items-center gap-1.5 rounded-[var(--tt-control-radius)] border border-oai-gray-200 bg-white px-3 text-xs font-medium text-oai-gray-700 shadow-sm hover:border-oai-gray-300 hover:bg-oai-gray-50 disabled:cursor-default disabled:opacity-45 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
              >
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                {copy("widgets.windows.projects.use_recent")}
              </button>
            </div>

            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={copy("widgets.windows.projects.search")}
              placeholder={copy("widgets.windows.projects.search")}
              className="mt-3 h-9 w-full rounded-lg border border-oai-gray-200 bg-white/75 px-3 text-sm outline-none transition-colors placeholder:text-oai-gray-400 focus:border-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900/80 dark:focus:border-oai-gray-500"
            />

            <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-oai-gray-200/80 bg-white/50 dark:border-oai-gray-800 dark:bg-oai-gray-900/30">
              {!normalizedQuery && recentProjects.length !== 0 ? (
                <p className="border-b border-oai-gray-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
                  {copy("widgets.windows.projects.recent_title")}
                </p>
              ) : null}
              {error ? (
                <p className="px-3 py-4 text-sm text-red-600 dark:text-red-400">
                  {copy("widgets.windows.projects.load_failed")}
                </p>
              ) : visibleProjects.length !== 0 ? (
                visibleProjects.map((project) => {
                  const id = String(project.id || "");
                  const checked = selectedIds.includes(id);
                  return (
                    <label
                      key={id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 border-b border-oai-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-white/70 dark:border-oai-gray-800 dark:hover:bg-white/[0.04]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={project.label}
                        onChange={() => toggleProject(project)}
                        className="h-4 w-4 accent-oai-brand-600"
                      />
                      <span className="min-w-0 truncate">{project.label}</span>
                    </label>
                  );
                })
              ) : (
                <p className="px-3 py-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("widgets.windows.projects.empty")}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-3 overflow-hidden rounded-xl border border-oai-gray-200/80 bg-white/45 shadow-sm dark:border-white/10 dark:bg-white/[0.035]">
        <button
          type="button"
          aria-expanded={limitsExpanded}
          aria-controls="windows-widget-limits-panel"
          onClick={() => setLimitsExpanded((current) => !current)}
          className="tt-pressable tt-product-focusable flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-white/70 dark:hover:bg-white/[0.06] sm:px-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-200/70 bg-violet-50 text-violet-600 shadow-sm dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300">
            <Gauge className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-oai-black dark:text-white">
              {copy("widgets.windows.limits.title")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {selectedLimitPlanCount} / {limitPlans.length}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-oai-gray-500 transition-transform duration-200",
              limitsExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>

        {limitsExpanded ? (
          <div
            id="windows-widget-limits-panel"
            className="border-t border-oai-gray-200/70 px-3.5 pb-4 pt-3 dark:border-white/10 sm:px-4"
          >
            <p className="text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
              {copy("widgets.windows.limits.hint")}
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border border-oai-gray-200/80 bg-white/50 dark:border-oai-gray-800 dark:bg-oai-gray-900/30">
              {visibleLimitOptions.length > 0 ? visibleLimitOptions.map((plan) => {
                const id = String(plan.id || "");
                const checked = widgetLimitGroupSelected(plan, draftLimitIds);
                const planName = plan.planLabel || plan.accountLabel || plan.provider;
                const label = planName === plan.provider
                  ? plan.provider
                  : `${plan.provider} - ${planName}`;
                return (
                  <div
                    key={id}
                    draggable={checked}
                    onDragStart={() => {
                      draggedLimitId.current = id;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropLimit(id)}
                    className="flex min-h-11 items-center gap-2 border-b border-oai-gray-100 px-3 py-2 last:border-b-0 hover:bg-white/70 dark:border-oai-gray-800 dark:hover:bg-white/[0.04]"
                  >
                    <GripVertical
                      className={cn(
                        "h-4 w-4 shrink-0 text-oai-gray-400",
                        checked ? "cursor-grab" : "opacity-35",
                      )}
                      aria-hidden="true"
                    />
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={label}
                        onChange={() => toggleLimit(plan)}
                        className="h-4 w-4 accent-oai-brand-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{label}</span>
                        {plan.windows.map((limit) => (
                          <span
                            className="mt-0.5 block truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400"
                            key={limit.id}
                          >
                            {limit.window} · {limit.usedPercent == null
                              ? copy("widgets.windows.limits.unavailable")
                              : `${limit.usedPercent}%`}
                          </span>
                        ))}
                      </span>
                    </label>
                    <span className="text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                      {plan.usedPercent == null
                        ? copy("widgets.windows.limits.unavailable")
                        : `${plan.usedPercent}%`}
                    </span>
                  </div>
                );
              }) : (
                <p className="px-3 py-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("widgets.windows.limits.empty")}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <div className="mt-4 flex items-center justify-end gap-3">
        {saved ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
            {copy("widgets.windows.projects.saved")}
          </span>
        ) : null}
        <button
          type="button"
          disabled={!prefs || !dirty || saving}
          onClick={() => void save()}
          className="tt-pressable tt-product-focusable inline-flex h-9 items-center rounded-[var(--tt-control-radius)] bg-oai-black px-4 text-sm font-medium text-white hover:bg-oai-gray-800 disabled:cursor-default disabled:opacity-40 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-200"
        >
          {saving
            ? copy("widgets.windows.projects.saving")
            : copy("widgets.windows.projects.save")}
        </button>
      </div>
    </div>
  );
}

function formatProjectLastActive(project) {
  const updatedAt = Date.parse(project?.updatedAt || "");
  if (!Number.isFinite(updatedAt)) return copy("widget.session.time_unknown");
  const elapsedHours = Math.max(0, Math.floor((Date.now() - updatedAt) / 3_600_000));
  const elapsedDays = Math.floor(elapsedHours / 24);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "always" });
  if (elapsedHours < 24) return formatter.format(-elapsedHours, "hour");
  if (elapsedDays < 7) return formatter.format(-elapsedDays, "day");
  if (elapsedDays < 30) return formatter.format(-Math.floor(elapsedDays / 7), "week");
  return formatter.format(-Math.floor(elapsedDays / 30), "month");
}

function formatProjectCreatedAt(project) {
  const timestamp = Date.parse(project?.createdAt || "");
  if (!Number.isFinite(timestamp)) return copy("widget.session.time_unknown");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp).replaceAll("/", "-");
}

function formatLimitResetAt(limit) {
  const resetAt = Date.parse(limit?.resetAt || "");
  if (!Number.isFinite(resetAt)) {
    return `${copy("settings.token_plan.quota_window_reset")}: ${copy("settings.token_plan.reset_unavailable")}`;
  }
  return `${copy("settings.token_plan.quota_window_reset")}: ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(resetAt).replaceAll("/", "-")}`;
}

function formatWidgetPlanValidity(value, now = new Date()) {
  const timestamp = tokenPlanExpiryTimestamp(value);
  if (timestamp === null) return copy("settings.token_plan.validity_unset");

  const totalMinutes = Math.max(0, Math.floor((timestamp - now.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const remaining = days > 0
    ? copy("settings.token_plan.validity_days_hours", { days, hours })
    : hours > 0
      ? copy("settings.token_plan.validity_hours_minutes", { hours, minutes })
      : copy("settings.token_plan.validity_minutes", { minutes });
  const expiresAt = new Date(timestamp);
  const pad = (part) => String(part).padStart(2, "0");
  const dateTime = `${expiresAt.getFullYear()}/${pad(expiresAt.getMonth() + 1)}/${pad(expiresAt.getDate())} ${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}`;
  return copy("settings.token_plan.validity_summary", { remaining, date: dateTime });
}

function formatWidgetPlanDate(value, boundary = "start") {
  const timestamp = boundary === "end"
    ? tokenPlanExpiryTimestamp(value)
    : tokenPlanStartTimestamp(value);
  if (timestamp === null) return copy("settings.token_plan.validity_unset");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp).replaceAll("/", "-");
}

const WIDGET_PROJECT_STATUSES = ["red", "yellow", "green", "unknown"];
const WIDGET_SESSION_STATES = new Set([
  "waiting_approval",
  "error",
  "running",
  "completed",
  "stopped",
  "unknown",
]);

function widgetProjectStatus(project) {
  const status = String(project?.status || "").toLowerCase();
  if (WIDGET_PROJECT_STATUSES.includes(status)) return status;
  for (const candidate of WIDGET_PROJECT_STATUSES) {
    if (Number(project?.[candidate] || 0) > 0) return candidate;
  }
  for (const candidate of WIDGET_PROJECT_STATUSES) {
    if (project?.sessions?.some((session) => String(session?.status || "").toLowerCase() === candidate)) {
      return candidate;
    }
  }
  return "unknown";
}

function widgetProjectStatusTone(status) {
  if (status === "green") return "active";
  if (status === "yellow") return "recovering";
  return "inactive";
}

function widgetSessionStateLabel(session) {
  const state = String(session?.state || "").toLowerCase();
  if (WIDGET_SESSION_STATES.has(state)) return copy(`widget.session_state.${state}`);
  const status = String(session?.status || "").toLowerCase();
  return copy(`widget.status.${WIDGET_PROJECT_STATUSES.includes(status) ? status : "unknown"}`);
}

function widgetProjectTags(project) {
  const savedTags = Array.isArray(project?.tags)
    ? project.tags.filter(Boolean)
    : project?.tag
      ? [project.tag]
      : [];
  return savedTags;
}

function widgetProjectTagTone(tag) {
  const tones = {
    [copy("widgets.reference.tag_core")]: "core",
    [copy("widgets.reference.tag_tool")]: "tool",
    [copy("widgets.reference.tag_card")]: "card",
    [copy("widgets.reference.tag_design")]: "design",
    [copy("widgets.reference.tag_personal")]: "personal",
    [copy("widgets.reference.tag_theme")]: "theme",
    [copy("widgets.reference.tag_experiment")]: "experiment",
  };
  return tones[tag] || "project";
}

function maskWidgetPlanEmail(value) {
  const normalized = String(value || "").trim();
  const match = /^([^@]+)@(.+)$/.exec(normalized);
  if (!match || match[1].includes("*")) return normalized;
  return `${match[1].slice(0, Math.min(3, match[1].length))}***@${match[2]}`;
}

function isWidgetLimitSelected(limit, selectedIds) {
  const id = String(limit?.id || "");
  return selectedIds.includes(id) || selectedIds.some((selectedId) => (
    selectedId.startsWith(`${id}:`) || id.startsWith(`${selectedId}:`)
  ));
}

function selectedWidgetLimitIds(limits, selectedIds) {
  return groupWidgetLimits(limits)
    .filter((plan) => plan.windows.some((limit) => isWidgetLimitSelected(limit, selectedIds)))
    .flatMap((plan) => plan.windows.map((limit) => String(limit.id)));
}

function selectedWidgetProjects(projects, savedProjects, selectedIds) {
  const byId = new Map(mergeWidgetProjectOptions(projects, savedProjects)
    .map((project) => [project.id, project]));
  return selectedIds.map((id) => byId.get(id)).filter(Boolean);
}

function widgetProjectSelectionsEqual(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return left.every((project, index) => (
    String(project?.id || "") === String(right[index]?.id || "")
    && String(project?.label || "") === String(right[index]?.label || "")
    && String(project?.path || "") === String(right[index]?.path || "")
  ));
}

function WidgetTablePagination() {
  return (
    <div className="tt-widget-table-pagination" aria-label={copy("widgets.reference.pagination")}>
      <button type="button" disabled aria-hidden><ChevronsLeft /></button>
      <button type="button" disabled aria-hidden><ChevronLeft /></button>
      <b>{1}</b>
      <button type="button" disabled aria-hidden><ChevronRight /></button>
      <button type="button" disabled aria-hidden><ChevronsRight /></button>
      <label><select aria-label={copy("widgets.reference.page_size")} value="10" onChange={() => {}}><option value="10">{copy("widgets.reference.page_size")}</option></select><ChevronDown aria-hidden /></label>
    </div>
  );
}

function WindowsProjectManager({ onOpenSettings }) {
  const [model, setModel] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [query, setQuery] = useState("");
  const [refreshingPlans, setRefreshingPlans] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [dismissedProjectIds, setDismissedProjectIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("recent");
  const [batchOpen, setBatchOpen] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState([]);
  const [limitPlanOrder, setLimitPlanOrder] = useState([]);
  const [expiredPlansOpen, setExpiredPlansOpen] = useState(false);
  const [scheduledPlansOpen, setScheduledPlansOpen] = useState(false);
  const draggedLimitPlanId = useRef(null);

  useEffect(() => {
    let mounted = true;
    const invoke = getTauriInvoke();
    const prefsPromise = invoke
      ? invoke("get_desktop_widget_prefs")
      : Promise.resolve(null);
    void prefsPromise.then(async (savedPrefs) => {
      const activeSessionWindow = ACTIVE_SESSION_WINDOWS.includes(savedPrefs?.activeSessionWindow)
        ? savedPrefs.activeSessionWindow
        : DEFAULT_ACTIVE_SESSION_WINDOW;
      return [savedPrefs, await getDesktopWidgetViewModel("all", activeSessionWindow)];
    })
      .then(([savedPrefs, nextModel]) => {
        if (!mounted) return;
        const projects = mergeWidgetStatusProjects(
          Array.isArray(nextModel?.projectStatus?.projects)
            ? nextModel.projectStatus.projects
            : [],
          Array.isArray(nextModel?.projectStatus?.recentProjects)
            ? nextModel.projectStatus.recentProjects
            : [],
          Array.isArray(savedPrefs?.selectedProjects) ? savedPrefs.selectedProjects : [],
        );
        const limits = Array.isArray(nextModel?.limits) ? nextModel.limits : [];
        const fallbackPrefs = {
          activeSessionWindow: DEFAULT_ACTIVE_SESSION_WINDOW,
          selectedProjectIds: projects.slice(0, 2).map((project) => project.id),
          selectedProjects: projects.slice(0, 2),
          selectedLimitIds: limits.map((limit) => String(limit.id)),
        };
        const currentPrefs = savedPrefs
          ? {
            ...savedPrefs,
            activeSessionWindow: ACTIVE_SESSION_WINDOWS.includes(savedPrefs.activeSessionWindow)
              ? savedPrefs.activeSessionWindow
              : DEFAULT_ACTIVE_SESSION_WINDOW,
          }
          : fallbackPrefs;
        const storedProjectIds = Array.isArray(currentPrefs.selectedProjectIds)
          ? currentPrefs.selectedProjectIds
          : fallbackPrefs.selectedProjectIds;
        const restoredProjectIds = migrateWidgetProjectSelectionIds(projects, storedProjectIds);
        const restoredSelectedProjects = selectedWidgetProjects(
          projects,
          Array.isArray(currentPrefs.selectedProjects) ? currentPrefs.selectedProjects : [],
          restoredProjectIds,
        );
        const storedLimitIds = Array.isArray(currentPrefs.selectedLimitIds)
          ? currentPrefs.selectedLimitIds
          : fallbackPrefs.selectedLimitIds;
        const restoredLimitIds = selectedWidgetLimitIds(limits, storedLimitIds);
        const restoredPrefs = {
          ...currentPrefs,
          selectedProjectIds: restoredProjectIds,
          selectedProjects: restoredSelectedProjects,
          selectedLimitIds: restoredLimitIds,
        };
        setModel(nextModel || { projectStatus: { projects: [], recentProjects: [] }, limits: [] });
        setPrefs(restoredPrefs);
        if (
          invoke
          && (
            storedProjectIds.join("\u0000") !== restoredProjectIds.join("\u0000")
            || !widgetProjectSelectionsEqual(currentPrefs.selectedProjects, restoredSelectedProjects)
            || storedLimitIds.join("\u0000") !== restoredLimitIds.join("\u0000")
          )
        ) {
          void invoke("set_desktop_widget_prefs", { prefs: restoredPrefs });
        }
      })
      .catch(() => {
        if (mounted) setModel({ projectStatus: { projects: [], recentProjects: [] }, limits: [] });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const projects = mergeWidgetStatusProjects(
    Array.isArray(model?.projectStatus?.projects) ? model.projectStatus.projects : [],
    Array.isArray(model?.projectStatus?.recentProjects) ? model.projectStatus.recentProjects : [],
    Array.isArray(prefs?.selectedProjects) ? prefs.selectedProjects : [],
  );
  const limits = Array.isArray(model?.limits) ? model.limits : [];
  const limitPlans = groupWidgetLimits(limits);

  useEffect(() => {
    const availableIds = limitPlans.map((plan) => plan.id);
    setLimitPlanOrder((current) => {
      const next = [
        ...current.filter((id) => availableIds.includes(id)),
        ...availableIds.filter((id) => !current.includes(id)),
      ];
      return next.join("\u0000") === current.join("\u0000") ? current : next;
    });
  }, [limits]);

  const selectedProjectIds = Array.isArray(prefs?.selectedProjectIds) ? prefs.selectedProjectIds : [];
  const storedSelectedLimitIds = Array.isArray(prefs?.selectedLimitIds) ? prefs.selectedLimitIds : [];
  const selectedLimitIds = selectedWidgetLimitIds(limits, storedSelectedLimitIds);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const displayedProjects = projects
    .map((project, index) => ({ project, index, status: widgetProjectStatus(project) }))
    .filter(({ project, status }) => (
      (!normalizedQuery || String(project.label || "").toLocaleLowerCase().includes(normalizedQuery))
      && (statusFilter === "all" || status === statusFilter)
      && !dismissedProjectIds.includes(project.id)
    ))
    .sort((left, right) => {
      if (sortOrder !== "recent") return 0;
      return Date.parse(right.project.updatedAt || "") - Date.parse(left.project.updatedAt || "");
    });
  const limitPlansById = new Map(limitPlans.map((plan) => [plan.id, plan]));
  const orderedLimitPlans = [
    ...limitPlanOrder.map((id) => limitPlansById.get(id)).filter(Boolean),
    ...limitPlans.filter((plan) => !limitPlanOrder.includes(plan.id)),
  ];
  const groupedLimitPlans = splitWidgetLimitGroups(orderedLimitPlans);
  const selectedLimitPlanCount = limitPlans.filter((plan) => (
    widgetLimitGroupSelected(plan, selectedLimitIds)
  )).length;

  const persist = async (next) => {
    setPrefs(next);
    const invoke = getTauriInvoke();
    if (invoke) await invoke("set_desktop_widget_prefs", { prefs: next });
  };

  const toggleProject = (project) => {
    if (!prefs) return;
    const projectId = String(project.id);
    const selected = selectedProjectIds.includes(projectId);
    const nextIds = selected
      ? selectedProjectIds.filter((value) => value !== projectId)
      : [...selectedProjectIds, projectId];
    void persist({
      ...prefs,
      selectedProjectIds: nextIds,
      selectedProjects: selectedWidgetProjects(projects, prefs.selectedProjects, nextIds),
    });
  };

  const toggleLimit = (plan) => {
    if (!prefs) return;
    const planIds = plan.windows.map((limit) => String(limit.id));
    const selected = planIds.some((id) => selectedLimitIds.includes(id));
    const nextIds = selected
      ? selectedLimitIds.filter((value) => !planIds.includes(value))
      : [...selectedLimitIds, ...planIds.filter((id) => !selectedLimitIds.includes(id))];
    void persist({ ...prefs, selectedLimitIds: nextIds });
  };

  const moveLimitPlan = (targetPlanId) => {
    const sourcePlanId = draggedLimitPlanId.current;
    if (!sourcePlanId || sourcePlanId === targetPlanId) return;
    setLimitPlanOrder((current) => {
      const order = current.length ? current : limitPlans.map((plan) => plan.id);
      const sourceIndex = order.indexOf(sourcePlanId);
      const targetIndex = order.indexOf(targetPlanId);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      const next = [...order];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourcePlanId);
      return next;
    });
  };

  const persistLimitPlanOrder = () => {
    if (!prefs) return;
    const orderedSelectedIds = orderedLimitPlans
      .flatMap((plan) => plan.windows.map((limit) => String(limit.id)))
      .filter((id) => selectedLimitIds.includes(id));
    void persist({ ...prefs, selectedLimitIds: orderedSelectedIds });
  };

  const removeProjectFromWidget = (project) => {
    if (!prefs) return;
    const projectId = String(project.id);
    setDismissedProjectIds((current) => [...current, projectId]);
    setOpenMenu(null);
    const nextIds = selectedProjectIds.filter((value) => value !== projectId);
    void persist({
      ...prefs,
      selectedProjectIds: nextIds,
      selectedProjects: selectedWidgetProjects(projects, prefs.selectedProjects, nextIds),
    });
  };

  const toggleProjectSessions = (project) => {
    setExpandedProjectIds((current) => (
      current.includes(project.id)
        ? current.filter((id) => id !== project.id)
        : [...current, project.id]
    ));
  };

  const activeProjects = projects.filter((project) => {
    const updatedAt = Date.parse(project.updatedAt || "");
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 3 * 24 * 60 * 60 * 1000;
  }).length;
  const activeToday = projects.filter((project) => {
    const updatedAt = Date.parse(project.updatedAt || "");
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 24 * 60 * 60 * 1000;
  }).length;
  const activeThisWeek = projects.filter((project) => {
    const updatedAt = Date.parse(project.updatedAt || "");
    return Number.isFinite(updatedAt) && Date.now() - updatedAt < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const selectedProjectCount = projects.filter((project) => (
    selectedProjectIds.includes(project.id)
  )).length;

  const refreshPlans = async () => {
    if (refreshingPlans) return;
    setRefreshingPlans(true);
    try {
      const activeSessionWindow = ACTIVE_SESSION_WINDOWS.includes(prefs?.activeSessionWindow)
        ? prefs.activeSessionWindow
        : DEFAULT_ACTIVE_SESSION_WINDOW;
      const nextModel = await getDesktopWidgetViewModel("all", activeSessionWindow);
      setModel(nextModel || { projectStatus: { projects: [], recentProjects: [] }, limits: [] });
    } finally {
      setRefreshingPlans(false);
    }
  };

  const renderLimitPlan = (plan, validityState = "active") => {
    const selected = widgetLimitGroupSelected(plan, selectedLimitIds);
    const agent = String(plan.agent || plan.provider || "").toLowerCase();
    const providerName = plan.provider || agent;
    const planName = plan.planLabel || plan.accountLabel || providerName;
    const accessibleName = planName === providerName ? providerName : `${providerName} - ${planName}`;
    let validitySummary = null;
    if (validityState === "scheduled" && plan.startsAt) {
      validitySummary = <div className="tt-token-plan-card-summary">
        <span className="tt-token-plan-summary-expiry">
          <CalendarDays aria-hidden />
          <span>{copy("settings.token_plan.starts_at")}: {formatWidgetPlanDate(plan.startsAt, "start")}</span>
        </span>
      </div>;
    } else if (validityState === "expired" && plan.expiresAt) {
      validitySummary = <div className="tt-token-plan-card-summary">
        <span className="tt-token-plan-summary-expiry">
          <CalendarDays aria-hidden />
          <span>{copy("settings.token_plan.expired_at")}: {formatWidgetPlanDate(plan.expiresAt, "end")}</span>
        </span>
      </div>;
    } else if (validityState === "active" && plan.expiresAt) {
      validitySummary = <div className="tt-token-plan-card-summary">
        <span className="tt-token-plan-summary-expiry">
          <CalendarDays aria-hidden />
          <span>{formatWidgetPlanValidity(plan.expiresAt)}</span>
        </span>
      </div>;
    }
    return <article
      className="tt-widget-plan-card tt-token-plan-card tt-token-plan-card--reference"
      data-testid="widget-limit-plan-card"
      data-plan-id={plan.id}
      data-card-layout="cost-settings-token-plan"
      data-layout-density="content"
      draggable
      onDragStart={(event) => {
        draggedLimitPlanId.current = plan.id;
        event.dataTransfer?.setData("text/plain", plan.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        moveLimitPlan(plan.id);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => event.preventDefault()}
      onDragEnd={() => {
        draggedLimitPlanId.current = null;
        persistLimitPlanOrder();
      }}
      key={plan.id}
    >
      <div className="tt-widget-plan-card__top">
        <GripVertical aria-hidden className="tt-widget-plan-card__drag" />
        <span className={cn("tt-token-provider-mark", `tt-token-provider-mark--${agent}`)}>
          <ProviderIcon provider={agent} size={14} className={`tt-widget-agent-logo is-${agent}`} />
        </span>
        <span className="tt-token-plan-copy">
          <span className="tt-token-plan-full">
            <span className="tt-token-plan-full-text"><span>{providerName}</span>{planName === providerName ? null : ` / ${planName}`}</span>
          </span>
          <span className="tt-token-plan-card-identity-meta">
            <span className="tt-token-plan-card-account">{maskWidgetPlanEmail(plan.accountLabel) || "—"}</span>
          </span>
        </span>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={accessibleName}
          className={cn("tt-widget-check", "tt-widget-plan-card__check", selected && "is-checked")}
          onClick={() => toggleLimit(plan)}
        >
          {selected ? <Check aria-hidden /> : null}
        </button>
      </div>
      <div className="tt-token-plan-card-detail">
        <div className="tt-token-plan-quota-windows">
          <div>
            {plan.windows.map((limit) => {
              const windowUsed = Number(limit.usedPercent || 0);
              const atLeastFull = [0, 1].includes(Math.sign(windowUsed - 100));
              const nearFull = [0, 1].includes(Math.sign(windowUsed - 90));
              const tone = atLeastFull ? "danger" : nearFull ? "warning" : "normal";
              return <div className="tt-token-plan-quota-window" data-testid="widget-limit-quota-window" data-kind={limit.kind} key={limit.id}>
                <div className="tt-token-plan-quota-window-head">
                  <strong>{limit.kind === "total" ? null : <Clock3 aria-hidden />}{limit.window}</strong>
                  <span className="tt-token-plan-quota-window-percent">{windowUsed}%</span>
                </div>
                <span className="tt-token-plan-progress" data-tone={tone}>
                  <i style={{ width: `${Math.max(0, Math.min(100, windowUsed))}%` }} />
                </span>
                <small data-align="end">{formatLimitResetAt(limit)}</small>
              </div>;
            })}
          </div>
        </div>
        {validitySummary}
      </div>
    </article>;
  };

  return (
    <div className="tt-widget-manager" data-testid="widget-manager">
      <section className="tt-widget-summary" data-testid="widget-summary">
        <article data-tone="blue" className="tt-pressable">
          <span className="tt-widget-summary-icon"><FolderKanban aria-hidden /></span>
          <div><span>{copy("widgets.reference.selected_projects")}</span><strong>{selectedProjectCount}</strong><small>{copy("widgets.reference.selected_projects_detail")}</small></div>
          <aside><b>{copy("widgets.reference.yesterday_delta", { count: activeToday })}</b><small>{copy("widgets.reference.week_added", { count: activeThisWeek })}</small></aside>
        </article>
        <article data-tone="green" className="tt-pressable">
          <span className="tt-widget-summary-icon"><CheckCircle2 aria-hidden /></span>
          <div><span>{copy("widgets.reference.active_projects")}</span><strong>{activeProjects}</strong><small>{copy("widgets.reference.active_projects_detail")}</small></div>
          <aside><b>{copy("widgets.reference.yesterday_delta", { count: activeToday })}</b><small>{copy("widgets.reference.active_rate", { rate: projects.length ? Math.round((activeProjects / projects.length) * 100) : 0 })}</small></aside>
        </article>
        <article data-tone="violet" className="tt-pressable">
          <span className="tt-widget-summary-icon"><Package aria-hidden /></span>
          <div><span>{copy("widgets.reference.plan_usage")}</span><strong>{selectedLimitPlanCount} / {limitPlans.length}</strong><small>{copy("widgets.reference.plan_usage_detail")}</small></div>
          <aside className="tt-widget-summary-ring-wrap"><span className="tt-widget-summary-ring" style={{ "--widget-progress": `${limitPlans.length ? Math.round((selectedLimitPlanCount / limitPlans.length) * 100) : 0}%` }}><b>{limitPlans.length ? Math.round((selectedLimitPlanCount / limitPlans.length) * 100) : 0}%</b></span><small>{copy("widgets.reference.all_plans_enabled")}</small></aside>
        </article>
      </section>

      <section className="tt-widget-projects tt-pressable-group" data-testid="widget-projects">
        <header>
          <div className="tt-widget-section-title">
            <span><FolderKanban aria-hidden /></span>
            <h2>{copy("widgets.reference.desktop_projects")}</h2>
            <small>{copy("widgets.reference.total_projects", { count: projects.length })}</small>
          </div>
        </header>
        <div className="tt-widget-project-toolbar">
          <button type="button" className="tt-widget-project-add tt-raised-control tt-pressable" aria-label={copy("widgets.reference.add_project_folder")} onClick={() => void selectDirectoryViaTauri()}><FolderPlus aria-hidden />{copy("widgets.reference.choose_project_folder")}</button>
          <div className="tt-widget-batch-actions"><button type="button" className="tt-raised-control tt-pressable" aria-expanded={batchOpen} onClick={() => setBatchOpen((open) => !open)}><ListChecks aria-hidden />{copy("widgets.reference.batch_actions")}<ChevronDown aria-hidden /></button>{batchOpen ? <div role="menu"><button type="button" role="menuitem" onClick={() => { setBatchOpen(false); onOpenSettings(); }}>{copy("widgets.reference.batch_manage")}</button><button type="button" role="menuitem" onClick={() => { setBatchOpen(false); prefs && void persist({ ...prefs, selectedProjectIds: [], selectedProjects: [] }); }}>{copy("widgets.reference.clear_selection")}</button></div> : null}</div>
          <button type="button" className="tt-raised-control tt-pressable" aria-label={copy("widgets.reference.import_recent_projects")} onClick={() => {
            if (!prefs) return;
            setDismissedProjectIds([]);
            const nextIds = projects.map((project) => project.id);
            void persist({
              ...prefs,
              selectedProjectIds: nextIds,
              selectedProjects: selectedWidgetProjects(projects, prefs.selectedProjects, nextIds),
            });
          }}><History aria-hidden />{copy("widgets.reference.restore_recent_projects")}</button>
          <label><Search aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy("widgets.reference.search_projects")} /></label>
          <span className="tt-widget-toolbar-spacer" />
          <Select
            ariaLabel={copy("widgets.reference.status_all")}
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: "all", label: copy("widgets.reference.status_all") },
              { value: "red", label: copy("widget.status.red") },
              { value: "yellow", label: copy("widget.status.yellow") },
              { value: "green", label: copy("widget.status.green") },
              { value: "unknown", label: copy("widget.status.unknown") },
            ]}
            leadingIcon={<Filter aria-hidden />}
            className="tt-widget-toolbar-select tt-raised-control tt-pressable"
          />
          <Select
            ariaLabel={copy("widgets.reference.sort_recent_active")}
            value={sortOrder}
            onValueChange={setSortOrder}
            options={[{ value: "recent", label: copy("widgets.reference.sort_recent_active") }]}
            className="tt-widget-toolbar-select tt-raised-control tt-pressable"
          />
        </div>
        <div className="tt-widget-project-table">
          <div className="tt-widget-project-head"><span /><span>{copy("widgets.reference.project_name")}</span><span>{copy("widgets.reference.project_tag")}</span><span>{copy("widgets.reference.status")}</span><span>{copy("widgets.reference.last_active")}</span><span>{copy("widgets.reference.created_at")}</span><span>{copy("widgets.reference.action")}</span></div>
          {displayedProjects.map(({ project, index, status }) => {
            const checked = selectedProjectIds.includes(project.id);
            const tags = widgetProjectTags(project);
            const canExpand = Boolean(project.sessions.length);
            const expanded = canExpand && expandedProjectIds.includes(project.id);
            return (
              <React.Fragment key={project.id}>
                <div className="tt-widget-project-row">
                  <button type="button" className={cn("tt-widget-check", checked && "is-checked")} onClick={() => toggleProject(project)} aria-label={project.label}>{checked ? <Check aria-hidden /> : null}</button>
                  <span className={cn("tt-widget-project-name", canExpand && "is-expandable")}>
                    {canExpand ? (
                      <button type="button" data-testid="widget-project-expand" aria-expanded={expanded} onClick={() => toggleProjectSessions(project)}>
                        <i data-tone={index % 6}>{String(project.label || "PR").slice(0, 3).toUpperCase()}</i><span>{project.label}</span><ChevronDown aria-hidden />
                      </button>
                    ) : <span className="tt-widget-project-name-static"><i data-tone={index % 6}>{String(project.label || "PR").slice(0, 3).toUpperCase()}</i><span>{project.label}</span></span>}
                  </span>
                  <span className="tt-widget-project-tag">{tags.map((tag) => <i key={tag} data-tone={widgetProjectTagTone(tag)}>{tag}</i>)}</span>
                  <span className={cn("tt-widget-project-status", `is-${widgetProjectStatusTone(status)}`)}><i />{copy(`widget.status.${status}`)}</span>
                  <time>{formatProjectLastActive(project)}</time>
                  <time className="tt-widget-project-created">{formatProjectCreatedAt(project)}</time>
                  <div className="tt-widget-row-actions">
                    <button type="button" aria-label={copy("settings.token_plan.delete_short")} aria-expanded={openMenu === `project:${project.id}`} onClick={() => setOpenMenu((current) => current === `project:${project.id}` ? null : `project:${project.id}`)}><Ellipsis aria-hidden /></button>
                    {openMenu === `project:${project.id}` ? <div role="menu"><button type="button" role="menuitem" onClick={() => removeProjectFromWidget(project)}><Trash2 aria-hidden />{copy("settings.token_plan.delete_short")}</button></div> : null}
                  </div>
                </div>
                {expanded ? <div className="tt-widget-project-sessions" data-testid="widget-project-sessions">
                  <div className="tt-widget-project-sessions-title">{copy("widgets.reference.project_sessions", { count: project.sessions.length })}</div>
                  {project.sessions.map((session, sessionIndex) => {
                    const sessionStatus = widgetProjectStatus(session);
                    const sessionTime = formatProjectLastActive(session);
                    return <div className="tt-widget-project-session" data-testid="widget-project-session" key={session.id || `${project.id}:${sessionIndex}`}>
                      <span>{session.label || copy("widget.session.untitled", { time: sessionTime })}</span>
                      <span className={cn("tt-widget-project-status", `is-${widgetProjectStatusTone(sessionStatus)}`)}><i />{widgetSessionStateLabel(session)}</span>
                      <time>{sessionTime}</time>
                    </div>;
                  })}
                </div> : null}
              </React.Fragment>
            );
          })}
          <footer><span className="tt-widget-table-selection">{copy("widgets.reference.selected_prefix")} <b>{selectedProjectCount}</b> {copy("widgets.reference.project_count_suffix")}<button type="button" onClick={() => prefs && void persist({ ...prefs, selectedProjectIds: [], selectedProjects: [] })}>{copy("widgets.reference.clear_selection")}</button></span><WidgetTablePagination /></footer>
        </div>
      </section>

      <div className="tt-widget-bottom-grid">
        <section className="tt-widget-limits tt-pressable-group" data-testid="widget-limits">
          <header>
            <div className="tt-widget-section-title"><span><Gauge aria-hidden /></span><div><h2>{copy("widgets.reference.usage_plans")}</h2><small>{copy("widgets.reference.total_plans", { selected: selectedLimitPlanCount, total: limitPlans.length })}</small></div></div>
            <div className="tt-widget-limit-actions">
              <button type="button" className="tt-raised-control tt-pressable" onClick={() => void refreshPlans()} disabled={refreshingPlans}><RefreshCw aria-hidden />{copy("widgets.reference.refresh_data")}</button>
              {groupedLimitPlans.expired.length ? <button type="button" aria-expanded={expiredPlansOpen} aria-controls="widget-expired-limit-plan-panel" className="tt-widget-expired-toggle tt-raised-control tt-pressable" onClick={() => setExpiredPlansOpen((open) => !open)}>
                <span>{copy("settings.token_plan.expired_group", { count: groupedLimitPlans.expired.length })}</span>
                <ChevronDown aria-hidden />
              </button> : null}
            </div>
          </header>
          <div className="tt-widget-plan-list">
            <div className="tt-token-plan-grid" data-testid="widget-active-limit-plan-list">
              {groupedLimitPlans.active.map((plan) => renderLimitPlan(plan, "active"))}
            </div>
            {groupedLimitPlans.scheduled.length ? <section className="tt-widget-limit-history" data-testid="widget-scheduled-limit-plans">
              <button type="button" aria-expanded={scheduledPlansOpen} aria-controls="widget-scheduled-limit-plan-panel" className="tt-raised-control tt-pressable" onClick={() => setScheduledPlansOpen((open) => !open)}>
                <span>{copy("settings.token_plan.scheduled_group", { count: groupedLimitPlans.scheduled.length })}</span>
                <ChevronDown aria-hidden />
              </button>
              {scheduledPlansOpen ? <div id="widget-scheduled-limit-plan-panel" className="tt-token-plan-grid tt-widget-limit-plan-grid" data-testid="widget-scheduled-limit-plan-list">
                {groupedLimitPlans.scheduled.map((plan) => renderLimitPlan(plan, "scheduled"))}
              </div> : null}
            </section> : null}
            {groupedLimitPlans.expired.length ? <section className="tt-widget-limit-history" data-testid="widget-expired-limit-plans">
              {expiredPlansOpen ? <div id="widget-expired-limit-plan-panel" className="tt-token-plan-grid tt-widget-limit-plan-grid" data-testid="widget-expired-limit-plan-list">
                {groupedLimitPlans.expired.map((plan) => renderLimitPlan(plan, "expired"))}
              </div> : null}
            </section> : null}
            <footer><span className="tt-widget-table-count">{copy("widgets.reference.plan_count", { count: limitPlans.length })}</span><WidgetTablePagination /></footer>
          </div>
        </section>
      </div>
    </div>
  );
}

function WindowsWidgetsContent() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <WindowsProjectManager onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen ? (
        <div
          className="tt-widget-settings-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={copy("widgets.windows.projects.title")}
        >
          <div className="tt-widget-settings-dialog">
            <button
              type="button"
              className="tt-widget-settings-close"
              aria-label={copy("widgets.reference.batch_manage")}
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
            <WindowsWidgetProjectSettings />
          </div>
        </div>
      ) : null}
    </>
  );
}

function HeaderCta({ platform }) {

  // Reserve space so the layout doesn't jump once detection resolves.
  if (platform === "loading") {
    return <div className="h-10 w-40" aria-hidden="true" />;
  }

  if (platform === "native") {
    return (
      <button
        type="button"
        onClick={() => nativeAction("openWidgetGallery")}
        className="tt-pressable tt-product-focusable inline-flex h-10 items-center gap-2 rounded-[var(--tt-control-radius)] bg-oai-black px-4 text-sm font-medium text-white hover:bg-oai-gray-800 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-200"
      >
        {copy("widgets.cta.open_gallery")}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  if (platform === "windows") {
    return <WindowsWidgetToggle />;
  }

  if (platform === "mac-web") {
    return (
      <a
        href="https://github.com/muxunson-9677/token-eyes/releases"
        target="_blank"
        rel="noopener noreferrer"
        className="tt-pressable tt-product-focusable inline-flex h-10 items-center gap-2 rounded-[var(--tt-control-radius)] bg-oai-black px-4 text-sm font-medium text-white no-underline hover:bg-oai-gray-800 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-200"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {copy("widgets.cta.download")}
      </a>
    );
  }

  // Non-macOS — widgets aren't available, tell the user gently.
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-4 text-sm font-medium text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-400">
      <Monitor className="h-4 w-4" aria-hidden="true" />
      {copy("widgets.cta.macos_only")}
    </span>
  );
}

/* ---------- Secondary catalog data ---------- */

const SECONDARY_WIDGETS = [
  { id: "topModels", Preview: TopModelsWidgetPreview,  nameKey: "widgets.topModels.name", descKey: "widgets.topModels.description" },
  { id: "limits",    Preview: UsageLimitsWidgetPreview, nameKey: "widgets.limits.name",   descKey: "widgets.limits.description" },
];

function WidgetCatalogCard({ Preview, nameKey, descKey }) {
  return (
    <article className="tt-surface flex h-full flex-col rounded-[var(--tt-card-radius)] p-4 sm:p-5">
      <Preview />
      <div className="mt-4">
        <h3 className="text-[15px] font-semibold text-oai-black dark:text-white">
          {copy(nameKey)}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-oai-gray-500 dark:text-oai-gray-400">
          {copy(descKey)}
        </p>
      </div>
    </article>
  );
}

/* ---------- Page ---------- */

function SectionTitle({ titleKey }) {
  return (
    <h2 className="mb-4 text-xl font-semibold tracking-tight text-oai-black dark:text-white sm:mb-5 sm:text-2xl">
      {copy(titleKey)}
    </h2>
  );
}

export function WidgetsPage() {
  const platform = useClientPlatform();
  return (
    <div
      className="tt-reference-route-widgets flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased"
      onPointerDownCapture={startWidgetPressRebound}
      onAnimationEndCapture={finishWidgetPressRebound}
    >
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8">
          {/* Page header — H1 + adaptive CTA. No page subtitle (the two H2
              sections speak for themselves; subtitles only added title noise). */}
          <FadeIn y={12}>
            <header className="tt-widgets-heading mb-10 flex items-start justify-between gap-4 sm:mb-12" data-testid="widgets-heading">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                  {copy("widgets.page.title")}
                </h1>
                {platform === "windows" ? <p>{copy("widgets.reference.subtitle")}</p> : null}
              </div>
              {platform === "windows" ? (
                <div className="tt-widget-top-controls">
                  <div className="tt-widget-primary-action">
                    <WindowsWidgetToggle />
                  </div>
                </div>
              ) : (
                <div className="shrink-0"><HeaderCta platform={platform} /></div>
              )}
            </header>
          </FadeIn>

          {/* Menu Bar — own section, dedicated card */}
          {platform !== "windows" ? (
            <FadeIn y={12} delay={0.06}>
              <section aria-label={copy("widgets.menubar.section.title")} className="mb-12 sm:mb-14">
                <SectionTitle titleKey="widgets.menubar.section.title" />
                <MenuBarDisplayCard />
              </section>
            </FadeIn>
          ) : null}

          {/* Desktop Widgets gallery */}
          <section aria-label={copy("widgets.gallery.section.title")}>
            {platform === "windows" ? (
              <WindowsWidgetsContent />
            ) : (
              <>
                <SectionTitle titleKey="widgets.gallery.section.title" />
                <StaggerContainer staggerDelay={0.08} initialDelay={0.04}>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
                    {SECONDARY_WIDGETS.map(({ id, Preview, nameKey, descKey }) => (
                      <StaggerItem key={id}>
                        <WidgetCatalogCard Preview={Preview} nameKey={nameKey} descKey={descKey} />
                      </StaggerItem>
                    ))}
                  </div>
                </StaggerContainer>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
