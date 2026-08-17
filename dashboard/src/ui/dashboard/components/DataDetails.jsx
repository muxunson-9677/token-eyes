import React, { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronRight, FolderKanban, Loader2, X } from "lucide-react";
import { Card } from "../../components";
import { formatTokenCount } from "../../../lib/format";
import { getCopyLocale } from "../../../lib/copy";
import { selectLocalDirectory } from "../../../lib/api.ts";
import { selectDirectoryViaTauri } from "../../../lib/tauri-directory.js";
import { ProjectUsagePanel } from "./ProjectUsagePanel.jsx";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { limitProviderName } from "../../../lib/limits-providers.js";
import { resolveDisplayTokens } from "../../../lib/model-breakdown";

const DAILY_USAGE_KEYS = [
  "total_tokens",
  "billable_total_tokens",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
  "conversation_count",
];
const DEFAULT_DAILY_PAGE_SIZE = 10;

// V4 round 1 item-5: manual project folders and dismissed auto-project cards
// survive reloads. Both live in localStorage so "add" really accumulates.
const SELECTED_FOLDERS_KEY = "tt.projects.selectedFolders";
const HIDDEN_PROJECTS_KEY = "tt.projects.hiddenKeys";

function readStoredStringArray(key) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item) : [];
  } catch {
    return [];
  }
}

function writeStoredStringArray(key, values) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore quota/privacy-mode failures — the in-memory list still works.
  }
}

export function hasRecordedDailyUsage(row) {
  if (!row || row.future || row.missing || !row.day) return false;
  return DAILY_USAGE_KEYS.some((key) => Number(row[key]) > 0);
}

export function DataDetails({
  // Project props
  projectEntries = [],
  projectLimit = 0,
  onProjectLimitChange,
  // Daily breakdown props
  copy,
  hasDetailsActual,
  dailyEmptyMessage,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
  onLoadDailyModelBreakdown,
}) {
  const [activeTab, setActiveTab] = useState("daily");
  const [selectedProjectFolders, setSelectedProjectFolders] = useState(
    () => readStoredStringArray(SELECTED_FOLDERS_KEY),
  );
  const [hiddenProjectKeys, setHiddenProjectKeys] = useState(
    () => readStoredStringArray(HIDDEN_PROJECTS_KEY),
  );
  const [dailyPage, setDailyPage] = useState(0);
  const [dailyPageInput, setDailyPageInput] = useState("1");
  const [dailyPageSize, setDailyPageSize] = useState(DEFAULT_DAILY_PAGE_SIZE);
  const [dailyOverlay, setDailyOverlay] = useState(null);
  const dailyOverlayCacheRef = useRef(new Map());
  const dailyTableRef = useRef(null);
  const visibleDailyRows = useMemo(() => {
    if (!Array.isArray(dailyBreakdownRows)) return [];
    return dailyBreakdownRows.filter(hasRecordedDailyUsage);
  }, [dailyBreakdownRows]);
  const dailyPageCount = Math.max(1, Math.ceil(visibleDailyRows.length / dailyPageSize));
  const currentDailyPage = Math.min(dailyPage, dailyPageCount - 1);
  const displayedDailyRows = visibleDailyRows.slice(
    currentDailyPage * dailyPageSize,
    (currentDailyPage + 1) * dailyPageSize,
  );
  const locale = getCopyLocale();
  const dailyTotals = visibleDailyRows.map((row) => Number(row?.total_tokens || row?.billable_total_tokens || 0));
  const dailyPeak = dailyTotals.length > 0 ? Math.max(...dailyTotals) : 0;
  const dailyAverage = dailyTotals.length > 0
    ? dailyTotals.reduce((sum, value) => sum + value, 0) / dailyTotals.length
    : 0;
  const dailyDates = visibleDailyRows.map((row) => String(row?.[dailyBreakdownDateKey] || row?.day || "")).filter(Boolean).sort();
  const dailyDateRange = dailyDates.length > 0
    ? `${dailyDates[0]}  →  ${dailyDates[dailyDates.length - 1]}`
    : "—";
  const dailyChangeByKey = new Map(visibleDailyRows.map((row, index) => {
    const key = String(row?.[dailyBreakdownDateKey] || row?.day || "");
    const current = Number(row?.total_tokens || row?.billable_total_tokens || 0);
    const previousRow = visibleDailyRows[index + 1];
    const previous = Number(previousRow?.total_tokens || previousRow?.billable_total_tokens || 0);
    const percent = previous > 0 ? ((current - previous) / previous) * 100 : null;
    return [key, percent];
  }));
  const navigateDailyPage = (nextPage) => {
    const target = Math.max(0, Math.min(dailyPageCount - 1, nextPage));
    setDailyPage(target);
    setDailyPageInput(String(target + 1));
  };
  const jumpToDailyPage = () => {
    const target = Number.parseInt(dailyPageInput, 10);
    if (Number.isFinite(target)) navigateDailyPage(target - 1);
  };
  const projectsWithSelectedFolders = useMemo(() => {
    const hidden = new Set(hiddenProjectKeys);
    const entries = (Array.isArray(projectEntries) ? projectEntries : []).filter(
      (entry) => !hidden.has(String(entry?.project_key || "")),
    );
    for (const projectPath of selectedProjectFolders) {
      if (entries.some((entry) => entry?.project_path === projectPath)) continue;
      const parts = projectPath.split(/[\\/]/).filter(Boolean);
      entries.push({
        project_key: `selected-folder:${projectPath}`,
        project_name: parts.at(-1) || projectPath,
        project_path: projectPath,
        total_tokens: 0,
        billable_total_tokens: 0,
        pricing_coverage: "unpriced",
        selected_folder: true,
      });
    }
    return entries;
  }, [projectEntries, selectedProjectFolders, hiddenProjectKeys]);
  const chooseProjectFolder = async () => {
    const tauriPath = await selectDirectoryViaTauri();
    const fallback = tauriPath ? { path: tauriPath } : await selectLocalDirectory();
    const selectedPath = typeof fallback?.path === "string" ? fallback.path.trim() : "";
    if (!selectedPath) return;
    setSelectedProjectFolders((current) => {
      const next = current.includes(selectedPath) ? current : [...current, selectedPath];
      writeStoredStringArray(SELECTED_FOLDERS_KEY, next);
      return next;
    });
    // Re-adding a folder always resurfaces its card, even if the auto entry
    // for the same project was dismissed earlier.
    setHiddenProjectKeys((current) => {
      const matched = (Array.isArray(projectEntries) ? projectEntries : []).filter(
        (entry) => entry?.project_path === selectedPath,
      ).map((entry) => String(entry?.project_key || ""));
      if (!matched.some((key) => current.includes(key))) return current;
      const next = current.filter((key) => !matched.includes(key));
      writeStoredStringArray(HIDDEN_PROJECTS_KEY, next);
      return next;
    });
  };
  const removeProjectCard = (entry) => {
    const projectPath = String(entry?.project_path || "");
    const projectKey = String(entry?.project_key || "");
    // Deleting a card always drops the matching manual folder (if any) AND
    // hides the auto entry (if it has a real key), so the card cannot come
    // back through the other source on the next render.
    if (projectPath) {
      setSelectedProjectFolders((current) => {
        if (!current.includes(projectPath)) return current;
        const next = current.filter((path) => path !== projectPath);
        writeStoredStringArray(SELECTED_FOLDERS_KEY, next);
        return next;
      });
    }
    if (projectKey && !projectKey.startsWith("selected-folder:")) {
      setHiddenProjectKeys((current) => {
        if (current.includes(projectKey)) return current;
        const next = [...current, projectKey];
        writeStoredStringArray(HIDDEN_PROJECTS_KEY, next);
        return next;
      });
    }
  };
  const toggleDailyBreakdown = async (row, trigger) => {
    const day = String(row?.[dailyBreakdownDateKey] || row?.day || "");
    if (!day || typeof onLoadDailyModelBreakdown !== "function") return;
    if (dailyOverlay?.day === day) {
      setDailyOverlay(null);
      return;
    }
    const tableViewport = dailyTableRef.current;
    const tableRow = trigger?.closest?.("tr");
    const desiredTop = Number(tableRow?.offsetTop || 0) + Number(tableRow?.offsetHeight || 44);
    const maxTop = Math.max(46, Number(tableViewport?.clientHeight || 320) - 238);
    const top = Math.min(desiredTop, maxTop);
    const cached = dailyOverlayCacheRef.current.get(day);
    if (cached) {
      setDailyOverlay({ day, top, loading: false, error: null, breakdown: cached });
      return;
    }
    setDailyOverlay({ day, top, loading: true, error: null, breakdown: null });
    try {
      const breakdown = await onLoadDailyModelBreakdown(day);
      dailyOverlayCacheRef.current.set(day, breakdown || { sources: [] });
      setDailyOverlay((current) => current?.day === day
        ? { day, top, loading: false, error: null, breakdown: breakdown || { sources: [] } }
        : current);
    } catch (error) {
      setDailyOverlay((current) => current?.day === day
        ? { day, top, loading: false, error: error?.message || String(error), breakdown: null }
        : current);
    }
  };
  const dailyOverlaySources = useMemo(() => {
    const sources = Array.isArray(dailyOverlay?.breakdown?.sources)
      ? dailyOverlay.breakdown.sources
      : [];
    const normalized = sources.map((source) => {
      const total = resolveDisplayTokens(source?.totals, 0);
      const models = (Array.isArray(source?.models) ? source.models : [])
        .map((model) => ({
          name: String(model?.model || copy("data.confidence.unattributed")),
          tokens: resolveDisplayTokens(model?.totals, 0),
        }))
        .filter((model) => model.tokens > 0)
        .sort((left, right) => right.tokens - left.tokens);
      return { id: String(source?.source || "unknown"), total, models };
    }).filter((source) => source.total > 0 || source.models.length > 0);
    const grandTotal = normalized.reduce((sum, source) => sum + source.total, 0);
    return normalized.map((source) => ({
      ...source,
      share: grandTotal > 0 ? (source.total / grandTotal) * 100 : 0,
      models: source.models.map((model) => ({
        ...model,
        share: source.total > 0 ? (model.tokens / source.total) * 100 : 0,
      })),
    }));
  }, [copy, dailyOverlay]);
  let dailyOverlayBody = null;
  if (dailyOverlay?.loading) {
    dailyOverlayBody = (
      <div className="tt-daily-breakdown-state">
        <Loader2 className="animate-spin" aria-hidden="true" />
        {copy("dashboard.daily.overlay_loading")}
      </div>
    );
  } else if (dailyOverlay?.error) {
    dailyOverlayBody = (
      <div className="tt-daily-breakdown-state tt-daily-breakdown-state--error">
        {copy("dashboard.daily.overlay_error")}
      </div>
    );
  } else if (dailyOverlay && dailyOverlaySources.length === 0) {
    dailyOverlayBody = (
      <div className="tt-daily-breakdown-state">{copy("dashboard.daily.overlay_empty")}</div>
    );
  } else if (dailyOverlay) {
    dailyOverlayBody = (
      <div className="tt-daily-breakdown-list">
        {dailyOverlaySources.map((source) => (
          <article key={source.id}>
            <div className="tt-daily-breakdown-agent">
              <ProviderIcon provider={source.id} size={18} />
              <strong>{limitProviderName(source.id)}</strong>
              <span>{formatTokenCount(source.total, { locale })}</span>
              <b>{source.share.toFixed(1)}%</b>
            </div>
            <div className="tt-daily-breakdown-models">
              {source.models.map((model) => (
                <div key={model.name}><span>{model.name}</span><span>{formatTokenCount(model.tokens, { locale })}</span><b>{model.share.toFixed(1)}%</b></div>
              ))}
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <Card
      variant="nested"
      className="tt-pressable-parent h-full min-h-0"
      bodyClassName="flex h-full min-h-0 flex-col overflow-hidden"
    >
      {/* Tab Switcher + Controls */}
      <div className="tt-overview-data-header mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Data view" className="tt-overview-data-tabs">
          <button
            role="tab"
            aria-selected={activeTab === "daily"}
            type="button"
            onClick={() => setActiveTab("daily")}
            className={`tt-overview-data-tab tt-analytics-focusable tt-pressable inline-flex min-h-10 items-center gap-1.5 rounded-[var(--tt-control-radius)] px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "daily"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {copy("dashboard.daily.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "projects"}
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`tt-overview-data-tab tt-analytics-focusable tt-pressable inline-flex min-h-10 items-center gap-1.5 rounded-[var(--tt-control-radius)] px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "projects"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
            {copy("dashboard.projects.title")}
          </button>
        </div>
        {activeTab === "daily" && Math.sign(visibleDailyRows.length) === 1 ? (
          <div className="tt-overview-daily-summary ml-auto flex min-w-0 items-stretch">
            <div data-testid="daily-summary-peak"><span>{copy("dashboard.daily.summary_peak")}</span><strong>{formatTokenCount(dailyPeak, { locale })}</strong></div>
            <div data-testid="daily-summary-average"><span>{copy("dashboard.daily.summary_average")}</span><strong>{formatTokenCount(dailyAverage, { locale })}</strong></div>
            <div data-testid="daily-summary-active-days"><span>{copy("dashboard.daily.summary_active_days")}</span><strong>{copy("dashboard.daily.active_days_value", { count: visibleDailyRows.length })}</strong></div>
            <div data-testid="daily-date-range" className="tt-overview-daily-range"><span>{dailyDateRange}</span><CalendarDays aria-hidden="true" /></div>
          </div>
        ) : null}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (
        <div
          data-testid="project-scroll-viewport"
          className="tt-overview-project-tab min-h-0 flex-1 overflow-x-hidden overflow-y-scroll oai-scrollbar"
        >
          <ProjectUsagePanel
            embedded
            entries={projectsWithSelectedFolders}
            limit={projectLimit}
            onLimitChange={onProjectLimitChange}
            onSelectFolder={chooseProjectFolder}
            onRemoveProject={removeProjectCard}
          />
        </div>
      )}

      {/* Daily Tab */}
      {activeTab === "daily" && (
        <div className="tt-overview-daily-tab flex min-h-0 flex-1 flex-col">
          {visibleDailyRows.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
              {dailyEmptyMessage}
            </div>
          ) : (
          <div ref={dailyTableRef} className="tt-overview-daily-table relative -mx-4 min-h-0 flex-1 overflow-auto oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {dailyBreakdownColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={dailyBreakdownAriaSortFor?.(column.key) || "none"}
                      className="text-left p-0 bg-white dark:bg-oai-gray-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex min-h-10 w-full items-center justify-start px-2.5 py-2 text-left oai-text-caption font-semibold text-oai-gray-600 transition-colors hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-oai-white sm:px-4"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-oai-gray-400 dark:text-oai-gray-400">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                  <td role="columnheader" className="bg-white px-2.5 py-2 text-right text-[10px] font-semibold text-oai-gray-600 dark:bg-oai-gray-900 dark:text-oai-gray-300 sm:px-4">
                    {copy("dashboard.daily.yesterday_change")}
                  </td>
                </tr>
              </thead>
              <tbody>
                {displayedDailyRows.map((row) => {
                  const rowKey = String(row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "");
                  const changePercent = dailyChangeByKey.get(rowKey);
                  return (
                  <tr
                    key={rowKey}
                    role="button"
                    tabIndex={0}
                    aria-expanded={dailyOverlay?.day === rowKey}
                    onClick={(event) => void toggleDailyBreakdown(row, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      void toggleDailyBreakdown(row, event.currentTarget);
                    }}
                    className="cursor-pointer border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0 hover:bg-oai-gray-50/50 dark:hover:bg-oai-gray-800/50 transition-colors text-oai-black dark:text-oai-white"
                  >
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 whitespace-nowrap">
                      <button
                        type="button"
                        className="tt-daily-row-trigger tt-analytics-focusable"
                        aria-expanded={dailyOverlay?.day === rowKey}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleDailyBreakdown(row, event.currentTarget);
                        }}
                      >
                        <span>{renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row)}</span>
                        <ChevronRight aria-hidden="true" />
                      </button>
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                      {renderDetailCell(row, "total_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "cached_input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "reasoning_output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "conversation_count")}
                    </td>
                    <td data-testid={`daily-change-${rowKey}`} className={`whitespace-nowrap px-2.5 py-2 text-right text-[10px] font-semibold tabular-nums sm:px-4 ${changePercent == null ? "text-oai-gray-400" : Math.sign(changePercent) === 1 ? "text-red-500" : Math.sign(changePercent) === -1 ? "text-emerald-500" : "text-oai-gray-400"}`}>
                      {changePercent == null ? "—" : `${Math.sign(changePercent) === 1 ? "↑" : Math.sign(changePercent) === -1 ? "↓" : ""} ${Math.abs(changePercent).toFixed(1)}%`}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {dailyOverlay ? (
              <section
                data-testid="daily-breakdown-overlay"
                data-overlay-layout="cover"
                className="tt-daily-breakdown-overlay"
                style={{ top: dailyOverlay.top }}
                aria-live="polite"
              >
                <header>
                  <div><strong>{dailyOverlay.day}</strong><span>{copy("dashboard.daily.overlay_title")}</span></div>
                  <button type="button" onClick={() => setDailyOverlay(null)} aria-label={copy("dashboard.daily.overlay_close")}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </header>
                {dailyOverlayBody}
              </section>
            ) : null}
          </div>
          )}

          {Math.sign(visibleDailyRows.length) === 1 ? (
            <div className="tt-overview-pagination tt-overview-daily-pagination" data-testid="daily-pagination">
              <span data-testid="daily-pagination-total">{copy("dashboard.projects.records", { count: visibleDailyRows.length })}</span>
              <div>
                <label className="tt-overview-page-size">{copy("dashboard.daily.page_size_label")}
                  <select aria-label={copy("dashboard.daily.page_size_aria")} value={dailyPageSize} onChange={(event) => { setDailyPageSize(Number(event.target.value)); navigateDailyPage(0); }}>
                    {[10, 20, 50].map((size) => <option key={size} value={size}>{copy("dashboard.daily.page_size_value", { count: size })}</option>)}
                  </select>
                </label>
                <button type="button" disabled={currentDailyPage === 0} onClick={() => navigateDailyPage(currentDailyPage - 1)}>{copy("details.pagination.prev")}</button>
                {Array.from({ length: dailyPageCount }, (_, index) => <button key={index} type="button" aria-current={currentDailyPage === index ? "page" : undefined} onClick={() => navigateDailyPage(index)}>{index + 1}</button>)}
                <button type="button" disabled={currentDailyPage + 1 >= dailyPageCount} onClick={() => navigateDailyPage(currentDailyPage + 1)}>{copy("details.pagination.next")}</button>
                <input aria-label={copy("dashboard.projects.page_number")} value={dailyPageInput} inputMode="numeric" onChange={(event) => setDailyPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") jumpToDailyPage(); }} />
                <button type="button" onClick={jumpToDailyPage}>{copy("dashboard.projects.page_jump")}</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
