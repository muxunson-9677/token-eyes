import { useEffect, useReducer, useRef } from "react";
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
  consumeLeaderboardLoginIntent,
  getLeaderboardSyncState,
  setLeaderboardParticipationState,
} from "../lib/leaderboard-sync-state";

export const LEADERBOARD_SYNC_EVENT = "token-eyes:leaderboard-sync";

function publishSyncStatus(status: "syncing" | "ready" | "deferred", error?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LEADERBOARD_SYNC_EVENT, {
    detail: {
      status,
      message: error instanceof Error ? error.message : "",
    },
  }));
}

function isLeaderboardPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/leaderboard" || normalized.startsWith("/leaderboard/");
}

export function useLeaderboardParticipationSync(): void {
  const location = useLocation();
  const auth = useInsforgeAuth();
  const previousSignedIn = useRef<boolean | null>(null);
  const previousLeaderboardPath = useRef(false);
  const inFlight = useRef(false);
  const [participationRevision, refreshParticipationState] = useReducer(
    (revision: number) => revision + 1,
    0,
  );

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
    const signedInTransition = priorSignedIn !== true;
    const canConsumeConsent = onLeaderboard && (signedInTransition || enteredLeaderboard);
    const refreshProfile = syncState.participationReady !== true
      || (canConsumeConsent && syncState.participant !== true);
    const syncExistingParticipant = enteredLeaderboard
      && syncState.participationReady === true
      && syncState.participant === true;
    if (!refreshProfile && !syncExistingParticipant) return;

    inFlight.current = true;
    publishSyncStatus("syncing");
    void (async () => {
      const accessToken = await auth.getAccessToken();
      if (!accessToken) throw new Error("Leaderboard session token unavailable");

      let participant = syncState.participant === true;
      let shareActualCost = syncState.shareActualCost === true;
      let reason: "leaderboard-consent" | "leaderboard-open" | null =
        syncExistingParticipant ? "leaderboard-open" : null;
      if (refreshProfile) {
        const profile = await getPublicVisibility({ accessToken });
        participant = profile?.leaderboard_public === true;
        const explicitConsent = canConsumeConsent
          ? consumeLeaderboardLoginIntent()
          : false;
        if (!participant && explicitConsent) {
          await setPublicVisibility({ accessToken, leaderboard_public: true });
          participant = true;
          reason = "leaderboard-consent";
        } else if (participant && enteredLeaderboard) {
          reason = "leaderboard-open";
        }
        shareActualCost = profile?.share_actual_cost === true;
        setLeaderboardParticipationState({ accountId, participant, shareActualCost });
        refreshParticipationState();
      }

      if (participant && shareActualCost && reason) {
        try {
          const periodCosts = await getLocalLeaderboardActualCost();
          const stillEnabled = await refreshLeaderboardActualCost({
            accessToken,
            periodCosts,
          });
          if (!stillEnabled) {
            setLeaderboardParticipationState({
              accountId,
              participant: true,
              shareActualCost: false,
            });
            refreshParticipationState();
          }
        } catch (error) {
          console.warn("[tokentracker] leaderboard actual-cost refresh:", error);
        }
      }

      if (participant && reason) {
        const result = await syncLeaderboardState({
          getAccessToken: async () => accessToken,
          reason,
          accountId,
        });
        if (result.status === "deferred") {
          throw new Error("Leaderboard usage upload failed");
        }
      }
      publishSyncStatus("ready");
    })()
      .catch((error) => {
        console.warn("[tokentracker] leaderboard participation sync:", error);
        publishSyncStatus("deferred", error);
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

  useEffect(() => {
    if (!auth.enabled || auth.loading || !auth.signedIn) return;
    const accountId =
      typeof auth.user?.id === "string" ? auth.user.id.trim().slice(0, 128) : "";
    if (!accountId) return;
    const syncState = getLeaderboardSyncState(accountId);
    if (syncState.participationReady !== true || syncState.participant !== true) return;

    let periodicSyncInFlight = false;
    const timer = window.setInterval(() => {
      if (periodicSyncInFlight) return;
      periodicSyncInFlight = true;
      void syncLeaderboardState({
        getAccessToken: auth.getAccessToken,
        reason: "meaningful-change",
        accountId,
      }).then((result) => {
        if (result.status === "uploaded") publishSyncStatus("ready");
        if (result.status === "deferred") publishSyncStatus("deferred");
      }).catch((error) => {
        console.warn("[tokentracker] leaderboard meaningful-change sync:", error);
        publishSyncStatus("deferred", error);
      }).finally(() => {
        periodicSyncInFlight = false;
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [
    auth.enabled,
    auth.getAccessToken,
    auth.loading,
    auth.signedIn,
    auth.user?.id,
    participationRevision,
  ]);
}
