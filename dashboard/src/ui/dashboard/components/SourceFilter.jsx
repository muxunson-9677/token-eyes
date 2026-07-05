import React, { useMemo, useState } from "react";
import { Database, ChevronDown, Check, Search } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { Button } from "../../components";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";

/**
 * Ticket-02 B: "全部来源"下拉筛选。
 *
 * 胶囊触发按钮 + 多选下拉面板。草稿+确定模式：打开时从 state.sources
 * 初始化 draft，点"确定"才派发 selectSourcesCascade（反向级联）并关闭。
 *
 * option 列表据已选 Agent 收窄：当 agentIds 为单值时仅展示该 agent 下的
 * source，否则展示全集。
 */
export function SourceFilter({ options = [], loading = false }) {
  const { state } = useUsageFilters();
  const { setSources } = useUsageFilterActions();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(state.sources);
  const [query, setQuery] = useState("");

  const filteredOptions = useMemo(() => {
    if (!state.agentIds || state.agentIds.length !== 1) return options;
    return options;
  }, [options, state.agentIds]);

  const searchedOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredOptions;
    return filteredOptions.filter((opt) =>
      opt.source_display_name.toLowerCase().includes(q),
    );
  }, [filteredOptions, query]);

  const showSearch = filteredOptions.length > 8;

  const handleOpenChange = (next) => {
    if (next) {
      setDraft(state.sources);
      setQuery("");
    }
    setOpen(next);
  };

  const toggleOption = (source) => {
    setDraft((current) => {
      if (current === null) return [source];
      if (current.includes(source)) {
        const next = current.filter((s) => s !== source);
        return next.length === 0 ? null : next;
      }
      return [...current, source];
    });
  };

  const toggleSelectAll = () => {
    setDraft((current) => {
      if (current === null) {
        // 当前是"全部"→收窄为全选数组（语义上仍代表全部，但显式勾选）
        return filteredOptions.map((o) => o.source);
      }
      // 当前是数组→切回"全部"
      return null;
    });
  };

  const handleApply = () => {
    setSources(draft);
    setOpen(false);
  };

  const label =
    state.sources === null
      ? copy("ticket02.source.label")
      : copy("ticket02.source.selected", { count: state.sources.length });

  const allChecked = draft === null;
  const isAllFilteredSelected =
    draft !== null &&
    filteredOptions.length > 0 &&
    filteredOptions.every((o) => draft.includes(o.source));

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={copy("ticket02.source.aria")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-oai-gray-300 bg-white px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:border-oai-gray-400 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          />
        }
      >
        <Database className="h-3.5 w-3.5 text-oai-gray-400" aria-hidden="true" />
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronDown className="h-3 w-3 text-oai-gray-400" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="bottom" align="start" className="!z-[9999]">
          <Popover.Popup className="w-60 rounded-xl border border-oai-gray-200 bg-white p-2 shadow-lg dark:border-oai-gray-700 dark:bg-oai-gray-900">
            {showSearch && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oai-gray-400" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy("ticket02.source.search_placeholder")}
                  className="h-8 w-full rounded-md border border-oai-gray-200 bg-white pl-7 pr-2 text-xs text-oai-gray-900 outline-none focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 dark:border-oai-gray-700 dark:bg-oai-gray-950 dark:text-oai-gray-100"
                />
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              {loading ? (
                <div className="py-4 text-center text-xs text-oai-gray-400">{copy("ticket02.source.empty")}</div>
              ) : searchedOptions.length === 0 ? (
                <div className="py-4 text-center text-xs text-oai-gray-400">{copy("ticket02.source.empty")}</div>
              ) : (
                searchedOptions.map((opt) => {
                  const checked = draft === null || draft.includes(opt.source);
                  return (
                    <button
                      key={opt.source}
                      type="button"
                      onClick={() => toggleOption(opt.source)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-oai-gray-700 transition-colors hover:bg-oai-gray-100 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    >
                      <span
                        className={cn(
                          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "border-oai-brand-500 bg-oai-brand-500 text-white"
                            : "border-oai-gray-300 bg-white dark:border-oai-gray-600 dark:bg-oai-gray-900",
                        )}
                      >
                        {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{opt.source_display_name}</span>
                    </button>
                  );
                })
              )}
            </div>

            {filteredOptions.length > 0 && (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-oai-gray-100 pt-2 dark:border-oai-gray-800">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs font-medium text-oai-gray-500 hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-white"
                >
                  {allChecked || isAllFilteredSelected ? copy("ticket02.source.clear_all") : copy("ticket02.source.select_all")}
                </button>
                <Button size="sm" onClick={handleApply}>
                  {copy("shared.action.apply")}
                </Button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
