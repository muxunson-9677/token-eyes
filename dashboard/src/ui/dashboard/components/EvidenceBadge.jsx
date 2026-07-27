import { copy } from "../../../lib/copy";

function labelKeyForEvidence(evidence) {
  if (!evidence) return null;
  if (evidence.coverage === "unavailable") return "observability.evidence.unavailable";
  if (evidence.coverage === "unpriced") return "observability.evidence.unpriced";
  if (evidence.coverage === "partial") return "observability.evidence.partial";
  if (evidence.source_kind === "cache") return "observability.evidence.cached";
  if (evidence.source_kind === "official_api") return "observability.evidence.official";
  if (evidence.accuracy === "exact") return "observability.evidence.local_exact";
  if (evidence.accuracy === "normalized") return "observability.evidence.local_normalized";
  return "observability.evidence.estimated";
}

export function EvidenceBadge({ evidence }) {
  const labelKey = labelKeyForEvidence(evidence);
  if (!labelKey) return null;
  const stale = Boolean(evidence.is_stale);
  const detail = [
    copy(labelKey),
    evidence.source_kind,
    evidence.accuracy,
    evidence.observed_at,
    evidence.pricing_source,
    evidence.pricing_version,
    stale ? copy("observability.evidence.stale_tooltip") : null,
  ].filter(Boolean).join(" · ");
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
        stale
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          : "bg-oai-gray-100 text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300"
      }`}
      title={detail}
    >
      {copy(labelKey)}
    </span>
  );
}
