import { getInsforgeAnonKey, getInsforgeRemoteUrl } from "./insforge-config";
import {
  getLeaderboardSyncState,
  setLeaderboardSyncState,
} from "./leaderboard-sync-state";

const MAX_PAYLOAD_BYTES = 8 * 1024;
const LOCAL_STATE_URL = "/functions/tokentracker-leaderboard-state";
const UPSERT_RPC = "upsert_my_leaderboard_device_state";

export type LeaderboardSyncReason =
  | "first-login"
  | "leaderboard-open"
  | "daily-catchup"
  | "manual-list-refresh"
  | "app-exit";

type CompactLeaderboardState = {
  version: number;
  device_id: string;
  captured_at: string;
  periods: Record<string, unknown>;
};

type LocalStateResponse = {
  ok?: boolean;
  summary_hash?: string;
  state?: CompactLeaderboardState;
};

function defer(
  reason: LeaderboardSyncReason,
  summaryHash?: string,
): { status: "deferred"; summaryHash?: string } {
  const previous = getLeaderboardSyncState();
  setLeaderboardSyncState({
    ...previous,
    pending: true,
    ...(summaryHash ? { summaryHash } : {}),
    lastAttemptAt: new Date().toISOString(),
    lastReason: reason,
  });
  return {
    status: "deferred",
    ...(summaryHash ? { summaryHash } : {}),
  };
}

function isValidStateResponse(
  value: LocalStateResponse,
): value is Required<Pick<LocalStateResponse, "summary_hash" | "state">> &
  LocalStateResponse {
  return Boolean(
    value?.ok === true &&
      typeof value.summary_hash === "string" &&
      /^[a-f0-9]{64}$/.test(value.summary_hash) &&
      value.state &&
      value.state.version === 1 &&
      typeof value.state.device_id === "string" &&
      value.state.device_id.length >= 8 &&
      typeof value.state.captured_at === "string" &&
      value.state.periods &&
      typeof value.state.periods === "object",
  );
}

export async function syncLeaderboardState(options: {
  getAccessToken: () => Promise<string | null>;
  reason: LeaderboardSyncReason;
  force?: boolean;
}): Promise<{
  status: "uploaded" | "unchanged" | "deferred";
  summaryHash?: string;
}> {
  let local: LocalStateResponse;
  try {
    const response = await fetch(LOCAL_STATE_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return defer(options.reason);
    local = (await response.json()) as LocalStateResponse;
  } catch {
    return defer(options.reason);
  }

  if (!isValidStateResponse(local)) return defer(options.reason);
  const summaryHash = local.summary_hash;
  const serializedState = JSON.stringify(local.state);
  if (new TextEncoder().encode(serializedState).byteLength > MAX_PAYLOAD_BYTES) {
    return defer(options.reason, summaryHash);
  }

  const previous = getLeaderboardSyncState();
  if (!options.force && !previous.pending && previous.summaryHash === summaryHash) {
    return { status: "unchanged", summaryHash };
  }

  const accessToken = await options.getAccessToken();
  if (!accessToken) return defer(options.reason, summaryHash);

  const baseUrl = getInsforgeRemoteUrl().trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return defer(options.reason, summaryHash);
  const anonKey = getInsforgeAnonKey();
  const attemptedAt = new Date().toISOString();

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      Prefer: "return=minimal",
    };
    if (anonKey) headers.apikey = anonKey;
    const response = await fetch(`${baseUrl}/api/database/rpc/${UPSERT_RPC}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_device_id: local.state.device_id,
        p_state_version: local.state.version,
        p_summary_hash: summaryHash,
        p_captured_at: local.state.captured_at,
        p_payload: local.state,
      }),
    });
    if (!response.ok) return defer(options.reason, summaryHash);
  } catch {
    return defer(options.reason, summaryHash);
  }

  setLeaderboardSyncState({
    pending: false,
    summaryHash,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: new Date().toISOString(),
    lastReason: options.reason,
  });
  return { status: "uploaded", summaryHash };
}
