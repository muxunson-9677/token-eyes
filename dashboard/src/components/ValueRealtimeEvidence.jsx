import React from "react";
import { CircleHelp, ExternalLink, Info } from "lucide-react";
import { copy } from "../lib/copy";

function dateTime(value) {
  if (!value) return copy("value_realtime.evidence.unavailable");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? copy("value_realtime.evidence.unavailable") : date.toLocaleString();
}

function sourceLabel(value) {
  if (value === "local_usage_log") return copy("value_realtime.evidence.source.local_usage_log");
  if (value === "local_spend_ledger") return copy("value_realtime.evidence.source.local_spend_ledger");
  return copy("value_realtime.evidence.source.unavailable");
}

function pricingLabel(value) {
  if (value === "estimated") return copy("value_realtime.evidence.pricing.estimated");
  if (value === "reported") return copy("value_realtime.evidence.pricing.reported");
  return copy("value_realtime.evidence.pricing.unavailable");
}

export function ValueRealtimeEvidence({ evidence, className = "", title = copy("value_realtime.evidence.title") }) {
  const pricing = evidence?.pricing || null;
  return <details className={`vr-evidence-details ${className}`.trim()}>
    <summary><span className="vr-detail-icon vr-detail-icon--violet"><CircleHelp data-detail-icon="evidence" size={15} /></span>{title}</summary>
    <div className="vr-evidence-details__body">
      <dl>
        <div><dt>{copy("value_realtime.evidence.source")}</dt><dd>{sourceLabel(evidence?.source_kind)}</dd></div>
        <div><dt>{copy("value_realtime.evidence.records")}</dt><dd>{Number.isInteger(evidence?.record_count) ? evidence.record_count : copy("value_realtime.evidence.unavailable")}</dd></div>
        <div><dt>{copy("value_realtime.evidence.observed")}</dt><dd>{dateTime(evidence?.observed_from)} 至 {dateTime(evidence?.observed_to)}</dd></div>
        <div><dt>{copy("value_realtime.evidence.pricing")}</dt><dd>{pricingLabel(pricing?.state)}{pricing?.model ? ` · ${pricing.model}` : ""}{pricing?.version ? ` · ${pricing.version}` : ""}</dd></div>
      </dl>
      {pricing?.source_url ? <a href={pricing.source_url} target="_blank" rel="noreferrer" className="vr-evidence-details__link"><ExternalLink size={15} />{copy("value_realtime.evidence.open_pricing")}</a> : null}
      {evidence?.safe_record_refs?.length ? <p className="vr-evidence-details__refs"><Info size={15} />{copy("value_realtime.evidence.safe_refs")}：{evidence.safe_record_refs.join("、")}</p> : null}
      <p className="vr-evidence-details__privacy">{copy("value_realtime.evidence.privacy")}</p>
    </div>
  </details>;
}
