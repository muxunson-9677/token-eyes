import React from "react";
import { copy } from "../../../lib/copy";
import { computeSubscriptionRoi } from "../../../lib/subscription-roi";
import { formatCost, formatWowChange, heroFontSize } from "../build-share-card-data";

// Weekly bill ("AI 周账单") — ledger/receipt aesthetic on ivory paper.
// Hero: this week's spend. Ledger rows: WoW change, top model, subscription ROI.
// Colors are oklch on purpose: the ui-hardcode guardrail rejects new hex/rgb
// literals, and it keeps the palette consistent with BroadsheetCard.

const PAPER = "oklch(0.97 0.008 90)";
const INK = "oklch(0.2 0.02 270)";
const INK_SOFT = "oklch(0.42 0.015 270)";
const RULE = "oklch(0.82 0.012 270)";
const ACCENT = "oklch(0.5 0.19 265)";
const RISE = "oklch(0.55 0.22 25)";
const DROP = "oklch(0.55 0.14 150)";

const FONT_DISPLAY = '"Instrument Serif", "Times New Roman", Georgia, serif';
const FONT_BODY = '"Inter Tight", "Helvetica Neue", Arial, sans-serif';

const LABEL_STYLE = {
  fontSize: 15,
  letterSpacing: "0.24em",
  textTransform: "uppercase",
  color: INK_SOFT,
};

function formatDay(isoDay) {
  return typeof isoDay === "string" && isoDay ? isoDay.replace(/-/g, ".") : null;
}

function LedgerRow({ label, children, testId }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 24,
        padding: "26px 0",
        borderBottom: `1px solid ${RULE}`,
      }}
    >
      <div style={LABEL_STYLE}>{label}</div>
      <div
        data-testid={testId}
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 44,
          lineHeight: 1,
          color: INK,
          textAlign: "right",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontFeatureSettings: '"lnum" 1, "tnum" 1',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function WeeklyBillCard({ data }) {
  const bill = data.weeklyBill || {};
  const costOptions = { currency: data.currency, rate: data.exchangeRate };

  const weekSpend =
    bill.weekCostUsd != null ? formatCost(bill.weekCostUsd, costOptions) : "—";
  const wow = formatWowChange(bill.weekCostUsd, bill.prevWeekCostUsd);
  const wowColor = wow === null ? INK_SOFT : wow.startsWith("-") ? DROP : RISE;
  const top = data.topModels && data.topModels.length ? data.topModels[0] : null;
  const roi = computeSubscriptionRoi({
    monthApiEquivalentUsd:
      bill.monthApiEquivalentUsd ?? bill.monthApiCostUsd ?? null,
    monthSubscriptionCostUsd: bill.monthSubscriptionCostUsd ?? null,
  });

  const fromLabel = formatDay(data.periodFrom);
  const toLabel = formatDay(data.periodTo);
  const rangeLabel = fromLabel && toLabel ? `${fromLabel} — ${toLabel}` : "—";
  const heroSize = heroFontSize(weekSpend, {
    baseSize: 176,
    baseChars: 8,
    shrinkPerChar: 14,
    minSize: 96,
  });

  return (
    <div
      data-testid="weekly-bill-card"
      style={{
        width: "100%",
        height: "100%",
        background: PAPER,
        color: INK,
        fontFamily: FONT_BODY,
        padding: "72px 80px 60px 80px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Masthead — brand left, week range right */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          paddingBottom: 16,
          borderBottom: `2px solid ${INK}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: INK,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: ACCENT,
            }}
          />
          {copy("shared.app_name")}
        </div>
        <div
          style={{
            fontSize: 14,
            letterSpacing: "0.18em",
            color: INK_SOFT,
            fontFeatureSettings: '"tnum" 1',
          }}
        >
          {rangeLabel}
        </div>
      </header>

      {/* Title + handle */}
      <div
        style={{
          marginTop: 34,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 24,
        }}
      >
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 64,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            color: INK,
          }}
        >
          {copy("share.card.weekly_bill.title")}
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontStyle: "italic",
            fontSize: 34,
            color: INK_SOFT,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 380,
          }}
        >
          {data.handle}
        </div>
      </div>

      {/* Hero — this week's spend */}
      <div style={{ marginTop: 48 }}>
        <div style={{ ...LABEL_STYLE, color: ACCENT, marginBottom: 14 }}>
          {copy("share.card.weekly_bill.week_spend")}
        </div>
        <div
          data-testid="weekly-bill-spend"
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: heroSize,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            color: INK,
            whiteSpace: "nowrap",
            overflow: "hidden",
            fontFeatureSettings: '"lnum" 1, "tnum" 1',
          }}
        >
          {weekSpend}
        </div>
      </div>

      {/* Ledger rows */}
      <section style={{ marginTop: 52, borderTop: `1px solid ${INK}` }}>
        <LedgerRow
          label={copy("share.card.weekly_bill.wow_label")}
          testId="weekly-bill-wow"
        >
          <span style={{ color: wowColor }}>{wow != null ? wow : "—"}</span>
        </LedgerRow>
        <LedgerRow
          label={copy("share.card.weekly_bill.top_model")}
          testId="weekly-bill-top-model"
        >
          {top ? top.name : "—"}
        </LedgerRow>
        <LedgerRow
          label={copy("share.card.weekly_bill.roi_label")}
          testId="weekly-bill-roi"
        >
          {roi ? (
            <span style={{ color: ACCENT }}>
              {copy("share.card.weekly_bill.roi_value", {
                multiplier: roi.multiplier.toFixed(1),
              })}
            </span>
          ) : (
            <span
              style={{
                fontFamily: FONT_BODY,
                fontSize: 22,
                letterSpacing: "0.04em",
                color: INK_SOFT,
              }}
            >
              {copy("share.card.weekly_bill.roi_empty")}
            </span>
          )}
        </LedgerRow>
      </section>

      {/* Footer — brand line, mirrors the other variants */}
      <footer
        style={{
          marginTop: "auto",
          paddingTop: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 14,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: INK_SOFT,
        }}
      >
        <span>{copy("shared.app_name")}</span>
        <span style={{ color: ACCENT }}>{copy("share.card.weekly_bill.title")}</span>
      </footer>
    </div>
  );
}
