import React, { useState, useMemo, useEffect } from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { enUS, zhCN, zhTW, ja, ko } from "date-fns/locale";
import { Button } from "../../components";
import { copy, getCopyLocale } from "../../../lib/copy";

// Map the dashboard's resolved locale to a date-fns locale object so the
// calendar (month captions + weekday headers) and the in-popover date summary
// render in the selected language instead of always English.
const DATE_FNS_LOCALES = {
  en: enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
};

/** Resolve a dashboard locale (en/zh-CN/zh-TW/ja/ko) to a date-fns Locale. */
export function getDateFnsLocale(resolvedLocale) {
  return DATE_FNS_LOCALES[resolvedLocale] || enUS;
}

/**
 * Format a date string to short display like "Mar 1".
 * Accepts both "yyyy-MM-dd" and "yyyy-MM-ddTHH:mm:ss" — only the date part
 * is used. Pass a date-fns `locale` (see getDateFnsLocale) to localize the
 * month name.
 */
export function formatDateShort(dateStr, locale) {
  if (!dateStr) return "";
  // Take the leading date segment so trailing time components don't break
  // parsing (e.g. "2026-06-29T00:00:00" → "2026-06-29").
  const datePart = String(dateStr).slice(0, 10);
  const parts = datePart.split("-");
  if (parts.length !== 3) return datePart;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (!Number.isFinite(d.getTime())) return datePart;
  return format(d, "MMM d", locale ? { locale } : undefined);
}

// ---------------------------------------------------------------------------
// Helpers for parsing / formatting the date+time inputs
// ---------------------------------------------------------------------------

const DEFAULT_FROM_TIME = "00:00";
const DEFAULT_TO_TIME = "23:59";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Format a Date as "yyyy/MM/dd" for the visible text input value. */
function toSlashDate(d) {
  if (!d) return "";
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** Format a Date as "yyyy-MM-dd" (no time) — used when composing ISO output. */
function toISODate(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parse a string that may be "yyyy-MM-dd" or "yyyy-MM-ddTHH:mm:ss" into
 * { date: Date|null, time: string }. When the time component is missing
 * or invalid, falls back to `defaultTime` (DEFAULT_FROM_TIME for the
 * start of the range, DEFAULT_TO_TIME for the end so a date-only end
 * selection still spans the full end day).
 */
function parseDateInput(value, defaultTime = DEFAULT_FROM_TIME) {
  if (!value) return { date: null, time: defaultTime };
  const raw = String(value).trim();
  const [datePart, timePart] = raw.split("T");
  const parts = datePart.split("-");
  if (parts.length !== 3) return { date: null, time: defaultTime };
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return { date: null, time: defaultTime };
  }
  const dt = new Date(y, m, d);
  if (!Number.isFinite(dt.getTime())) return { date: null, time: defaultTime };
  let time = defaultTime;
  if (timePart && /^\d{2}:\d{2}/.test(timePart)) {
    time = timePart.slice(0, 5);
  }
  return { date: dt, time };
}

/**
 * Parse a user-typed date string. Accepts "YYYY/MM/DD" or "YYYY-MM-DD"
 * (single-digit month/day allowed). Returns null on invalid input so the
 * caller can reset the text field to the last valid value.
 */
function parseSlashDate(text) {
  const raw = (text || "").trim().replace(/\s+/g, "");
  // Character class [/-] puts the dash last so it matches a literal "-"
  // without an unnecessary escape (eslint no-useless-escape).
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo, d);
  if (!Number.isFinite(dt.getTime())) return null;
  // Reject rollover dates (e.g. Feb 30 → Mar 2).
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** Parse "H:mm" or "HH:mm" into canonical "HH:mm". Returns null if invalid. */
function parseTimeInput(text) {
  const raw = (text || "").trim();
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Ticket-02 E: Calendar-based date+time range picker.
 *
 * Layout (per ticket E §2):
 *   ┌────────────────────┬──────────────────────┐
 *   │ 开始时间            │   双月日历            │
 *   │   日期 [YYYY/MM/DD] │   (DayPicker range)  │
 *   │   时间 [HH:mm]      │                       │
 *   │ 结束时间            │                       │
 *   │   日期 [YYYY/MM/DD] │                       │
 *   │   时间 [HH:mm]      │                       │
 *   ├────────────────────┴──────────────────────┤
 *   │  [已选范围摘要]            [取消] [确定]    │
 *   └────────────────────────────────────────────┘
 *
 * Date+time inputs and the calendar are bidirectionally synced: typing a
 * valid date updates the calendar selection; clicking a day updates the
 * inputs. `onApply` receives ISO local-time strings "yyyy-MM-ddTHH:mm:ss"
 * so the backend can resolve an exact second-level window. Default times
 * are 00:00 for `from` and 23:59 for `to` so a date-only selection still
 * spans the full end day.
 */
export function DateRangePopover({ from, to, onApply, onCancel }) {
  const initialFrom = useMemo(() => parseDateInput(from, DEFAULT_FROM_TIME), [from]);
  const initialTo = useMemo(() => parseDateInput(to, DEFAULT_TO_TIME), [to]);

  const [range, setRange] = useState({
    from: initialFrom.date,
    to: initialTo.date,
  });
  const [fromTime, setFromTime] = useState(initialFrom.time);
  const [toTime, setToTime] = useState(initialTo.time);
  // Visible text mirrors of the date inputs. Users can type freely; the
  // value is reconciled to the calendar state on blur.
  const [fromDateText, setFromDateText] = useState(() => toSlashDate(initialFrom.date));
  const [toDateText, setToDateText] = useState(() => toSlashDate(initialTo.date));

  const dateLocale = getDateFnsLocale(getCopyLocale());

  // Keep text inputs in sync when calendar selection changes.
  useEffect(() => {
    setFromDateText(toSlashDate(range?.from));
  }, [range?.from]);
  useEffect(() => {
    setToDateText(toSlashDate(range?.to));
  }, [range?.to]);

  const handleFromDateBlur = () => {
    const parsed = parseSlashDate(fromDateText);
    if (parsed) {
      setRange((r) => ({ ...r, from: parsed }));
    } else {
      // Reset to the calendar's current value when the typed text is invalid.
      setFromDateText(toSlashDate(range?.from));
    }
  };

  const handleToDateBlur = () => {
    const parsed = parseSlashDate(toDateText);
    if (parsed) {
      setRange((r) => ({ ...r, to: parsed }));
    } else {
      setToDateText(toSlashDate(range?.to));
    }
  };

  const handleFromTimeBlur = () => {
    const parsed = parseTimeInput(fromTime);
    setFromTime(parsed || DEFAULT_FROM_TIME);
  };

  const handleToTimeBlur = () => {
    const parsed = parseTimeInput(toTime);
    setToTime(parsed || DEFAULT_TO_TIME);
  };

  const handleApply = () => {
    if (!range?.from) return;
    // Compose ISO local-time strings so the backend resolves an exact
    // second-level window. End time defaults to 23:59:59 to include the
    // entire end day.
    const toDate = range.to || range.from;
    const fromStr = `${toISODate(range.from)}T${fromTime}:00`;
    const toStr = `${toISODate(toDate)}T${toTime}:59`;
    onApply?.(fromStr, toStr);
  };

  const hasSelection = !!range?.from;

  const dateInputClass =
    "h-8 w-full rounded-md border border-oai-gray-200 bg-white px-2 text-xs text-oai-gray-900 outline-none focus:border-oai-brand-500 focus:ring-2 focus:ring-oai-brand-500/20 dark:border-oai-gray-700 dark:bg-oai-gray-950 dark:text-oai-gray-100";
  const subLabelClass =
    "text-[10px] text-oai-gray-500 dark:text-oai-gray-400";
  const fieldLabelClass =
    "text-xs font-medium text-oai-gray-700 dark:text-oai-gray-300";

  return (
    <div className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        {/* Left column: start + end date/time inputs */}
        <div className="flex flex-col gap-3 sm:w-44 sm:shrink-0">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>{copy("ticket02.time.start")}</span>
            <div className="flex flex-col gap-1">
              <span className={subLabelClass}>{copy("ticket02.time.date_label")}</span>
              <input
                type="text"
                value={fromDateText}
                onChange={(e) => setFromDateText(e.target.value)}
                onBlur={handleFromDateBlur}
                placeholder={copy("ticket02.time.date_placeholder")}
                aria-label={`${copy("ticket02.time.start")} ${copy("ticket02.time.date_label")}`}
                className={dateInputClass}
              />
              <span className={subLabelClass}>{copy("ticket02.time.time_label")}</span>
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                onBlur={handleFromTimeBlur}
                placeholder={copy("ticket02.time.time_placeholder")}
                aria-label={`${copy("ticket02.time.start")} ${copy("ticket02.time.time_label")}`}
                className={dateInputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>{copy("ticket02.time.end")}</span>
            <div className="flex flex-col gap-1">
              <span className={subLabelClass}>{copy("ticket02.time.date_label")}</span>
              <input
                type="text"
                value={toDateText}
                onChange={(e) => setToDateText(e.target.value)}
                onBlur={handleToDateBlur}
                placeholder={copy("ticket02.time.date_placeholder")}
                aria-label={`${copy("ticket02.time.end")} ${copy("ticket02.time.date_label")}`}
                className={dateInputClass}
              />
              <span className={subLabelClass}>{copy("ticket02.time.time_label")}</span>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                onBlur={handleToTimeBlur}
                placeholder={copy("ticket02.time.time_placeholder")}
                aria-label={`${copy("ticket02.time.end")} ${copy("ticket02.time.time_label")}`}
                className={dateInputClass}
              />
            </div>
          </div>
        </div>

        {/* Right column: two-month calendar */}
        <div className="flex-1 min-w-0">
          <DayPicker
            mode="range"
            locale={dateLocale}
            selected={range}
            onSelect={setRange}
            numberOfMonths={2}
            showOutsideDays={false}
            classNames={{
              root: "rdp-oai",
              months: "flex gap-4",
              month: "space-y-3",
              month_caption: "flex justify-center items-center h-8",
              caption_label: "text-sm font-medium text-oai-black dark:text-oai-white",
              nav: "flex items-center justify-between absolute inset-x-0 top-0 px-2",
              button_previous: "inline-flex items-center justify-center w-7 h-7 rounded-md text-oai-gray-500 hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-oai-white hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors",
              button_next: "inline-flex items-center justify-center w-7 h-7 rounded-md text-oai-gray-500 hover:text-oai-black dark:text-oai-gray-400 dark:hover:text-oai-white hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors",
              chevron: "w-4 h-4 fill-current",
              month_grid: "border-collapse",
              weekdays: "flex",
              weekday: "w-9 text-center text-xs font-medium text-oai-gray-400 dark:text-oai-gray-500 py-1",
              week: "flex",
              day: "w-9 h-9 text-center text-sm p-0 relative",
              day_button: "w-full h-full inline-flex items-center justify-center rounded-md transition-colors hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 text-oai-black dark:text-oai-white cursor-pointer rdp-day-btn",
              today: "font-bold",
              selected: "rdp-selected",
              range_start: "rdp-selected rdp-range-start",
              range_end: "rdp-selected rdp-range-end",
              range_middle: "rdp-range-mid",
              outside: "text-oai-gray-300 dark:text-oai-gray-600",
              disabled: "text-oai-gray-300 dark:text-oai-gray-600 cursor-not-allowed",
              hidden: "invisible",
            }}
            styles={{
              months: { position: "relative" },
            }}
          />
        </div>
      </div>

      {/* Footer: selected range summary + action buttons */}
      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-oai-gray-200 dark:border-oai-gray-700">
        {hasSelection && range.from && (
          <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400 mr-auto">
            {format(range.from, "MMM d, yyyy", { locale: dateLocale })}
            {range.to && range.to.getTime() !== range.from.getTime()
              ? ` — ${format(range.to, "MMM d, yyyy", { locale: dateLocale })}`
              : ""}
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {copy("shared.action.cancel")}
        </Button>
        <Button variant="primary" size="sm" onClick={handleApply} disabled={!hasSelection}>
          {copy("shared.action.apply")}
        </Button>
      </div>
    </div>
  );
}
