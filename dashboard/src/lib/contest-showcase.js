export function isContestShowcaseEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__TOKENTRACKER_CONTEST_SHOWCASE__) return true;
  const q = String(new URLSearchParams(window.location.search).get("contest") || "").toLowerCase();
  return q === "1" || q === "true" || q === "yes" || q === "on";
}
