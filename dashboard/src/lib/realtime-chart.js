// Preserve missing observations as gaps; x is elapsed time, never array position.
export function activitySegments(points) {
  const ordered = (Array.isArray(points) ? points : [])
    .map(point => ({ time: Date.parse(point?.observed_at), value: point?.total_tokens }))
    .filter(point => Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  if (!ordered.length) return [];
  const start = ordered[0].time;
  const duration = ordered.at(-1).time - start;
  const segments = [];
  let segment = null;
  for (const point of ordered) {
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) {
      segment = null;
      continue;
    }
    if (!segment) { segment = []; segments.push(segment); }
    segment.push({ x: duration ? (point.time - start) / duration : 0.5, value: point.value });
  }
  return segments;
}
