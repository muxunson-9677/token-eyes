import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext";
import {
  getLocalLeaderboardActualCost,
  getPublicVisibility,
  refreshLeaderboardActualCost,
  setPublicVisibility,
} from "../lib/api";
import { syncLeaderboardState } from "../lib/leaderboard-state-client";
import {
  getLeaderboardSyncState,
  setLeaderboardParticipationState,
} from "../lib/leaderboard-sync-state";

const DAILY_CATCHUP_MS = 24 * 60 * 60 * 1000;

function isLeaderboardPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/leaderboard" || normalized.startsWith("/leaderboard/");
}

function dailyCatchupDue(
  state: ReturnType<typeof getLeaderboardSyncState>,
  nowMs = Date.now(),
): boolean {
  if (state.pending) return true;
  const lastSuccessMs = Date.parse(state.lastSuccessAt || "");
  return !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs >= DAILY_CATCHUP_MS;
}

export function useLeaderboardParticipationSync(): void {
  const location = useLocation();
  const auth = useInsforgeAuth();
  const previousSignedIn = useRef<boolean | null>(null);
  const previousLeaderboardPath = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!auth.enabled || auth.loading) return;

    const signedIn = Boolean(auth.signedIn);
    const accountId =
      typeof auth.user?.id === "string" ? auth.user.id.trim().slice(0, 128) : "";
    const onLeaderboard = isLeaderboardPath(location.pathname || "/");
    const priorSignedIn = previousSignedIn.current;
    const enteredLeaderboard = onLeaderboard && !previousLeaderboardPath.current;
    previousSignedIn.current = signedIn;
    previousLeaderboardPath.current = onLeaderboard;

    if (!signedIn || !accountId) {
      return;
    }
    if (inFlight.current) return;
    const syncState = getLeaderboardSyncState(accountId);

    let reason:
      | "first-login"
      | "leaderboard-open"
      | "daily-catchup"
      | null = null;
    if (priorSignedIn === false) {
      reason = "first-login";
    } else if (enteredLeaderboard && dailyCatchupDue(syncState)) {
      reason = "leaderboard-open";
    } else if (priorSignedIn === null && dailyCatchupDue(syncState)) {
      reason = "daily-catchup";
    }
    const refreshProfile = syncState.participationReady !== true;
    if (!reason && !refreshProfile) return;

    inFlight.current = true;
    void (async () => {
      const accessToken = await auth.getAccessToken();
      if (!accessToken) throw new Error("Leaderboard session token unavailable");

      let shareActualCost = syncState.shareActualCost === true;
      if (refreshProfile) {
        const profile = await getPublicVisibility({ accessToken });
        if (!profile?.leaderboard_public) {
          await setPublicVisibility({ accessToken, leaderboard_public: true });
        }
        shareActualCost = profile?.share_actual_cost === true;
        setLeaderboardParticipationState({ accountId, shareActualCost });
      }

      if (shareActualCost && reason) {
        try {
          const periodCosts = await getLocalLeaderboardActualCost();
          const stillEnabled = await refreshLeaderboardActualCost({
            accessToken,
            periodCosts,
          });
          if (!stillEnabled) {
            setLeaderboardParticipationState({
              accountId,
              shareActualCost: false,
            });
          }
        } catch (error) {
          console.warn("[tokentracker] leaderboard actual-cost refresh:", error);
        }
      }

      if (reason) {
        await syncLeaderboardState({
          getAccessToken: async () => accessToken,
          reason,
        });
      }
    })()
      .catch((error) => {
        console.warn("[tokentracker] leaderboard participation sync:", error);
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [
    auth.enabled,
    auth.getAccessToken,
    auth.loading,
    auth.signedIn,
    auth.user?.id,
    location.pathname,
  ]);
}
