import { resolveAuthAccessToken } from "./auth-token";
import { fetchCloudUsageModelBreakdown, getUsageModelBreakdown } from "./api";

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason || new DOMException("The operation was aborted", "AbortError");
}

export function canonicalizeDailyBreakdownSources(sources) {
  if (!Array.isArray(sources)) return null;
  const normalized = [...new Set(
    sources.map((source) => String(source).trim().toLowerCase()).filter(Boolean),
  )].sort();
  return normalized.length > 0 ? normalized : null;
}

export async function fetchDailyModelBreakdown({
  day,
  useCloud,
  accountAccessToken,
  accessToken,
  baseUrl,
  source,
  sources,
  timeZone,
  tzOffsetMinutes,
  signal,
}) {
  throwIfAborted(signal);
  const resolvedToken = await resolveAuthAccessToken(useCloud ? accountAccessToken : accessToken);
  throwIfAborted(signal);
  const fetcher = useCloud ? fetchCloudUsageModelBreakdown : getUsageModelBreakdown;
  const canonicalSources = canonicalizeDailyBreakdownSources(
    Array.isArray(sources) ? sources : source == null ? null : [source],
  );
  return fetcher({
    baseUrl,
    accessToken: resolvedToken,
    from: day,
    to: day,
    sources: canonicalSources,
    timeZone,
    tzOffsetMinutes,
    signal,
  });
}
