export function parseDeveloperLeaderboardLoginFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function isDeveloperLeaderboardLoginEnabled() {
  return parseDeveloperLeaderboardLoginFlag(
    import.meta.env.VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN,
  );
}
