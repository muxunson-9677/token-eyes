import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card } from "../../ui/components";

const SECTION_ICON_TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
};

export function ToggleSwitch({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "tt-pressable tt-product-focusable relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-oai-brand-500" : "bg-oai-gray-300 dark:bg-oai-gray-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

export function SettingsRow({ label, hint, control }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-oai-gray-900 dark:text-oai-gray-200">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</div>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
  icon: Icon,
  iconTone = "blue",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = collapsible ? open : true;
  const sectionIcon = Icon ? (
    <span
      data-testid="settings-section-icon"
      data-tone={iconTone}
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
        SECTION_ICON_TONES[iconTone] || SECTION_ICON_TONES.blue,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  ) : null;

  return (
    <Card>
      <div className={cn("flex items-start justify-between gap-4", expanded && "mb-3")}>
        {collapsible ? (
          <button
            type="button"
            aria-label={title}
            aria-expanded={expanded}
            onClick={() => setOpen((current) => !current)}
            className="tt-product-focusable group flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left outline-none"
          >
            <ChevronDown
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 text-oai-gray-400 transition-transform group-hover:text-oai-gray-600 dark:group-hover:text-oai-gray-300",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
            {sectionIcon}
            <span className="min-w-0 flex-1">
              <span role="heading" aria-level={2} className="block text-sm font-medium tracking-wide text-oai-gray-500 dark:text-oai-gray-300">
                {title}
              </span>
              {subtitle ? (
                <span className="mt-1 block truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
                  {subtitle}
                </span>
              ) : null}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2">
            {sectionIcon}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 tracking-wide">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        )}
        {action && expanded ? <div className="shrink-0">{action}</div> : null}
      </div>
      {expanded ? (
        <div className="-mb-3 divide-y divide-oai-gray-200/60 dark:divide-oai-gray-800/60">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="inline-flex items-center rounded-[var(--tt-control-radius)] border border-oai-gray-200/80 bg-oai-gray-100/80 p-0.5 shadow-[inset_0_1px_3px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-oai-gray-950/70 dark:shadow-[inset_0_1px_4px_rgba(0,0,0,0.38)]">
      {options.map(({ value: optionValue, label, Icon }) => {
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={active}
            className={cn(
              "tt-pressable tt-product-focusable inline-flex items-center gap-1.5 rounded-[8px] border border-transparent px-3 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow,transform]",
              active
                ? "translate-y-px border-white/90 bg-white text-oai-black shadow-[inset_0_1px_0_rgba(255,255,255,1),inset_0_-1px_0_rgba(15,23,42,0.1),0_1px_2px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-oai-gray-800 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-1px_0_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.35)]"
                : "text-oai-gray-500 hover:text-oai-gray-700 dark:text-oai-gray-500 dark:hover:text-oai-gray-300",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
