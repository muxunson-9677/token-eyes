import React, { useEffect } from "react";
import { X } from "lucide-react";
import { copy } from "../../lib/copy";

/**
 * 排行榜规则说明弹窗（对齐 tokenrank / 生财有道 的玩法说明）。
 *
 * 纯静态内容组件 —— 规则文案都走 copy.csv。其中「今日/昨日、多口径、各 Agent
 * 分榜」等在正文里明确标注为即将上线的前端占位，真实数据后续再接。
 */

const RULE_ITEM_KEYS = [
  "leaderboard.rules.item1",
  "leaderboard.rules.item2",
  "leaderboard.rules.item3",
  "leaderboard.rules.item4",
  "leaderboard.rules.item5",
  "leaderboard.rules.item6",
  "leaderboard.rules.item7",
];

export function LeaderboardRulesModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy("leaderboard.rules.title")}
    >
      <div
        className="absolute inset-0 bg-oai-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-oai-gray-200 bg-white shadow-2xl dark:border-oai-gray-800 dark:bg-oai-gray-950">
        <div className="flex items-start justify-between gap-4 border-b border-oai-gray-100 px-5 py-4 dark:border-oai-gray-800">
          <h2 className="text-base font-semibold text-oai-black dark:text-white">
            {copy("leaderboard.rules.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy("leaderboard.rules.close")}
            className="rounded-md p-1 text-oai-gray-400 hover:bg-oai-gray-100 hover:text-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <p className="text-sm text-oai-gray-600 dark:text-oai-gray-300">
            {copy("leaderboard.rules.intro")}
          </p>
          <ol className="mt-3 flex flex-col gap-2.5">
            {RULE_ITEM_KEYS.map((key, index) => (
              <li key={key} className="flex gap-2.5 text-sm text-oai-gray-700 dark:text-oai-gray-300">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-oai-brand-50 text-[11px] font-semibold text-oai-brand-600 dark:bg-oai-brand-900/20 dark:text-oai-brand-400">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{copy(key)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            {copy("leaderboard.rules.disclaimer")}
          </p>
        </div>

        <div className="flex justify-end border-t border-oai-gray-100 px-5 py-3 dark:border-oai-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-oai-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-oai-brand-600"
          >
            {copy("leaderboard.rules.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
