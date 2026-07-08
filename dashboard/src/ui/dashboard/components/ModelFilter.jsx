import React, { useMemo, useState } from "react";
import { Box, ChevronDown, Check, Search } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { Button } from "../../components";
import { useUsageFilters, useUsageFilterActions } from "../../../hooks/use-usage-filters";

/**
 * Ticket-02 C: "全部模型"下拉筛选。
 *
 * 胶囊触发按钮 + 多选下拉面板（搜索 + 全选 + 确定草稿模式）。打开时从
 * state.models 初始化 draft，点"确定"才派发 selectModelsCascade（反向级
 * 联：同时 merge 所属 source 与 agent）并关闭。
 *
 * option 列表据已选 Source 收窄：当 sources 非空时仅展示这些 source 下
 * 的模型，否则展示全部 source 的模型并集。展平为 {model, source} 列表，
 * source 标签用 getAgentDisplayNameByQueueSource。
 */
export function ModelFilter({ options = {}, loading = false }) {
  const { state } = useUsageFilters();
  const { setModels } = useUsageFilterActions();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(state.models);
  const [query, setQuery] = useState("");

  const flatOptions = useMemo(() => {
    const sourcesToUse =
      state.sources && state.sources.length > 0
        ? state.sources
        : Object.keys(options);
    const result = [];
    const seen = new Set();
    for (const source of sourcesToUse) {
      const models = options[source];
      if (!Array.isArray(models)) continue;
      for (const model of models) {
        const key = `${source}::${model}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ model, source });
      }
    }
    return result;
  }, [options, state.sources]);

  const searchedOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatOptions;
    return flatOptions.filter((opt) => {
      if (opt.model.toLowerCase().includes(q)) return true;
      return opt.source.toLowerCase().includes(q);
    });
  }, [flatOptions, query]);

  const showSearch = flatOptions.length > 8;

  const handleOpenChange = (next) => {
    if (next) {
      setDraft(state.models);
      setQuery("");
    }
    setOpen(next);
  };

  const toggleOption = (model) => {
    setDraft((current) => {
      if (current === null) return [model];
      if (current.includes(model)) {
        const next = current.filter((m) => m !== model);
        return next.length === 0 ? null : next;
      }
      return [...current, model];
    });
  };

  const toggleSelectAll = () => {
    setDraft((current) => {
      if (current === null) {
        return flatOptions.map((o) => o.model);
      }
      return null;
    });
  };

  const handleApply = () => {
    setModels(draft);
    setOpen(false);
  };

  const label =
    state.models === null
      ? copy("ticket02.model.label")
      : copy("ticket02.model.selected", { count: state.models.length });

  const allChecked = draft === null;
  const isAllFilteredSelected =
    draft !== null &&
    flatOptions.length > 0 &&
    flatOptions.every((o) => draft.includes(o.model));

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={copy("ticket02.model.aria")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-oai-gray-300 bg-white px-3 text-xs font-medium text-oai-gray-700 transition-colors hover:border-oai-gray-400 hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
          />
        }
      >
        <Box className="h-3.5 w-3.5 text-oai-gray-400" aria-hidden="true" />
        <span className="max-w-[120px] truncate">{label}</span>
        <ChevronDown className="h-3 w-3 text-oai-gray-400" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} side="bottom" align="start" className="!z-[9999]">
          <Popover.Popup className="w-72 rounded-xl border border-oai-gray-200 bg-white p-2 shadow-lg dark:border-oai-gray-700 dark:bg-oai-gray-900">
            {showSearch && (
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oai-gray-400" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy("ticket02.model.search_placeholder")}
                  className="h-8 w-full rounded-md border border-oai-gray-200 bg-white pl-7 pr-2 text-xs text-oai-gray-900 outline-none focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 dark:border-oai-gray-700 dark:bg-oai-gray-950 dark:text-oai-gray-100"
                />
              </div>
            )}

            <div className="max-h-80 overflow-y-auto">
              {loading ? (
                <div className="py-4 text-center text-xs text-oai-gray-400">{copy("ticket02.model.empty")}</div>
              ) : searchedOptions.length === 0 ? (
                <div className="py-4 text-center text-xs text-oai-gray-400">{copy("ticket02.model.empty")}</div>
              ) : (
                searchedOptions.map((opt) => {
                  const checked = draft === null || draft.includes(opt.model);
                  return (
                    <button
                      key={`${opt.source}::${opt.model}`}
                      type="button"
                      onClick={() => toggleOption(opt.model)}
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
                      <span className="min-w-0 flex-1 truncate">{opt.model}</span>
                    </button>
                  );
                })
              )}
            </div>

            {flatOptions.length > 0 && (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-oai-gray-100 pt-2 dark:border-oai-gray-800">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-xs font-medium text-oai-gray-500 hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-white"
                >
                  {copy("ticket02.model.select_all")}
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
