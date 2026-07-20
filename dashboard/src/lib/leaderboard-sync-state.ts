const STORAGE_KEY = "tokentracker_leaderboard_sync_state_v1";

const REASONS = new Set([
  "first-login",
  "leaderboard-open",
  "daily-catchup",
  "manual-list-refresh",
  "app-exit",
]);

export type LeaderboardRetryState = {
  pending: boolean;
  summaryHash?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastReason?: string;
};

function emptyState(): LeaderboardRetryState {
  return { pending: false };
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return undefined;
  }
  return value;
}

export function getLeaderboardSyncState(): LeaderboardRetryState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as
      | Record<string, unknown>
      | null;
    if (!parsed || typeof parsed !== "object") return emptyState();
    const summaryHash = boundedString(parsed.summaryHash, 64);
    const lastAttemptAt = boundedString(parsed.lastAttemptAt, 40);
    const lastSuccessAt = boundedString(parsed.lastSuccessAt, 40);
    const lastReason =
      typeof parsed.lastReason === "string" && REASONS.has(parsed.lastReason)
        ? parsed.lastReason
        : undefined;
    return {
      pending: parsed.pending === true,
      ...(summaryHash && /^[a-f0-9]{64}$/.test(summaryHash) ? { summaryHash } : {}),
      ...(lastAttemptAt ? { lastAttemptAt } : {}),
      ...(lastSuccessAt ? { lastSuccessAt } : {}),
      ...(lastReason ? { lastReason } : {}),
    };
  } catch {
    return emptyState();
  }
}

export function setLeaderboardSyncState(state: LeaderboardRetryState): void {
  const normalized: LeaderboardRetryState = {
    pending: state.pending === true,
    ...(state.summaryHash && /^[a-f0-9]{64}$/.test(state.summaryHash)
      ? { summaryHash: state.summaryHash }
      : {}),
    ...(boundedString(state.lastAttemptAt, 40)
      ? { lastAttemptAt: state.lastAttemptAt }
      : {}),
    ...(boundedString(state.lastSuccessAt, 40)
      ? { lastSuccessAt: state.lastSuccessAt }
      : {}),
    ...(state.lastReason && REASONS.has(state.lastReason)
      ? { lastReason: state.lastReason }
      : {}),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* retry metadata is best-effort */
  }
}

export function clearLeaderboardSyncState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
