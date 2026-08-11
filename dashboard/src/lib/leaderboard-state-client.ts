import { getInsforgeAnonKey, getInsforgeRemoteUrl } from "./insforge-config";
import { getLocalApiAuthHeaders } from "./local-api-auth";
import { buildLocalApiUrl } from "./local-api-url";
import {
  getLeaderboardSyncState,
  setLeaderboardSyncState,
} from "./leaderboard-sync-state";

const MAX_PAYLOAD_BYTES = 8 * 1024;
const LOCAL_STATE_URL = "/functions/tokentracker-leaderboard-state";
const UPSERT_RPC = "upsert_my_leaderboard_device_state";
const REFRESH_FUNCTION = "tokentracker-leaderboard-refresh";

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
  accountId: string,
  summaryHash?: string,
): { status: "deferred"; summaryHash?: string } {
  const previous = getLeaderboardSyncState(accountId);
  setLeaderboardSyncState({
    ...previous,
    accountId,
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

async function refreshPublishedLeaderboard(options: {
  baseUrl: string;
  accessToken: string;
  anonKey: string;
}): Promise<boolean> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.accessToken}`,
  };
  if (options.anonKey) headers.apikey = options.anonKey;
  try {
    const response = await fetch(`${options.baseUrl}/functions/${REFRESH_FUNCTION}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        period: "total",
        source: "compact-state-upload",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getLocalLeaderboardState(): Promise<
  Required<Pick<LocalStateResponse, "summary_hash" | "state">> & LocalStateResponse
> {
  const [url, authHeaders] = await Promise.all([
    buildLocalApiUrl(LOCAL_STATE_URL),
    getLocalApiAuthHeaders(),
  ]);
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeaders },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  const local = (await response.json()) as LocalStateResponse;
  if (!isValidStateResponse(local)) throw new Error("Invalid local leaderboard state");
  return local;
}

export async function syncLeaderboardState(options: {
  getAccessToken: () => Promise<string | null>;
  reason: LeaderboardSyncReason;
  accountId: string;
  force?: boolean;
}): Promise<{
  status: "uploaded" | "unchanged" | "deferred";
  summaryHash?: string;
}> {
  let local: Awaited<ReturnType<typeof getLocalLeaderboardState>>;
  try {
    local = await getLocalLeaderboardState();
  } catch {
    return defer(options.reason, options.accountId);
  }
  const summaryHash = local.summary_hash;
  const serializedState = JSON.stringify(local.state);
  if (new TextEncoder().encode(serializedState).byteLength > MAX_PAYLOAD_BYTES) {
    return defer(options.reason, options.accountId, summaryHash);
  }

  const previous = getLeaderboardSyncState(options.accountId);
  if (!options.force && !previous.pending && previous.summaryHash === summaryHash) {
    return { status: "unchanged", summaryHash };
  }

  const accessToken = await options.getAccessToken();
  if (!accessToken) return defer(options.reason, options.accountId, summaryHash);

  const baseUrl = getInsforgeRemoteUrl().trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return defer(options.reason, options.accountId, summaryHash);
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
    if (!response.ok) return defer(options.reason, options.accountId, summaryHash);
  } catch {
    return defer(options.reason, options.accountId, summaryHash);
  }
  const refreshed = await refreshPublishedLeaderboard({
    baseUrl,
    accessToken,
    anonKey,
  });
  if (!refreshed) return defer(options.reason, options.accountId, summaryHash);

  setLeaderboardSyncState({
    ...getLeaderboardSyncState(options.accountId),
    accountId: options.accountId,
    pending: false,
    summaryHash,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: new Date().toISOString(),
    lastReason: options.reason,
  });
  return { status: "uploaded", summaryHash };
}
