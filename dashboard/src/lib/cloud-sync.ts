/**
 * Legacy cloud-usage sync compatibility surface.
 *
 * Token Eyes 0.54.49 no longer issues device tokens, uploads raw/hourly queues,
 * or invokes a public leaderboard refresh from this path. Explicit leaderboard
 * participants are synchronized only through leaderboard-state-client.ts,
 * which uploads the bounded compact aggregate after a summary-hash change.
 */
export async function runCloudUsageSyncIfDue(
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  void getAccessToken;
}

export async function runCloudUsageSyncNow(
  getAccessToken: () => Promise<string | null>,
): Promise<void> {
  void getAccessToken;
}
