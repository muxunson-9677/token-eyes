/**
 * InsForge Edge：公开资料开关。
 * Deno 内优先用 fetch 调 /api/auth/sessions/current 解析 user id（与浏览器 curl 一致）；
 * SDK 的 getCurrentUser() 在部分 Edge 运行时上对出站请求处理不稳定。
 */
import { createClient } from "npm:@insforge/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function verifiedUserId(baseUrl: string, token: string): Promise<string | null> {
  const authClient = createClient({ baseUrl, edgeFunctionToken: token });
  const { data, error } = await authClient.auth.getCurrentUser();
  return !error && typeof data?.user?.id === "string" ? data.user.id : null;
}

async function notifyRefreshCoordinator(): Promise<boolean> {
  const triggerUrl = Deno.env.get("LEADERBOARD_DIRTY_TRIGGER_URL") || "";
  const triggerSecret = Deno.env.get("LEADERBOARD_DIRTY_TRIGGER_SECRET") || "";
  if (!triggerUrl || !triggerSecret) return false;
  const response = await fetch(triggerUrl, {
    method: "POST",
    headers: { "x-leaderboard-dirty-secret": triggerSecret },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return response?.ok === true;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  /** 与浏览器请求一致：优先环境变量，否则沿用调用方传入的 apikey（Edge 运行时未必注入 INSFORGE_ANON_KEY） */
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  const authH = req.headers.get("Authorization");
  const token = authH?.startsWith("Bearer ") ? authH.slice(7) : undefined;
  if (!token) return json({ error: "Unauthorized" }, 401);

  const userId = await verifiedUserId(baseUrl, token);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const serviceRoleKey = Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  if (req.method === "GET") {
    const { data } = await client.database
      .from("tokentracker_user_settings")
      .select("leaderboard_public, github_url, show_github_url, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: actualCost } = await client.database
      .from("tokentracker_actual_cost_state")
      .select("share_actual_cost")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: profile } = await client.database
      .from("tokentracker_user_profiles")
      .select("display_name, avatar_url")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: customAvatar } = await client.database
      .from("tokentracker_leaderboard_avatar_metadata")
      .select("avatar_url")
      .eq("user_id", userId)
      .maybeSingle();
    return json({
      leaderboard_public: data?.leaderboard_public || false,
      updated_at: data?.updated_at || null,
      display_name: profile?.display_name || null,
      avatar_url: customAvatar?.avatar_url || profile?.avatar_url || null,
      github_url: data?.github_url || null,
      show_github_url: data?.show_github_url || false,
      share_actual_cost: actualCost?.share_actual_cost || false,
    });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as {
      leaderboard_public?: true;
      display_name?: string;
      github_url?: string | null;
      show_github_url?: boolean;
    };
    const now = new Date().toISOString();
    if (body.leaderboard_public !== undefined && body.leaderboard_public !== true) {
      return json({ error: "Use the deletion action to leave the leaderboard" }, 400);
    }

    // Validate github_url (optional). Accept public GitHub profile URLs only —
    // any host/path shape that isn't a bare user/org page is rejected so we
    // don't render arbitrary external links next to names on the leaderboard.
    // `null` / empty string explicitly clears the value.
    let normalizedGithubUrl: string | null | undefined = undefined;
    if (body.github_url !== undefined) {
      if (body.github_url === null || (typeof body.github_url === "string" && body.github_url.trim() === "")) {
        normalizedGithubUrl = null;
      } else if (typeof body.github_url === "string") {
        const raw = body.github_url.trim();
        // Allow bare handle, "@handle", or full URL. Normalize to canonical URL.
        const handleMatch = raw.match(/^@?([A-Za-z0-9][A-Za-z0-9-]{0,38})$/);
        const urlMatch = raw.match(/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/?$/i);
        if (handleMatch) {
          normalizedGithubUrl = `https://github.com/${handleMatch[1]}`;
        } else if (urlMatch) {
          normalizedGithubUrl = `https://github.com/${urlMatch[1]}`;
        } else {
          return json({ error: "Invalid GitHub URL. Use https://github.com/<username> or a bare username." }, 400);
        }
      }
    }

    // Trim + cap the display name once so the saved value and the returned
    // value can't drift.
    let normalizedDisplayName: string | null | undefined = undefined;
    if (typeof body.display_name === "string") {
      normalizedDisplayName = body.display_name.trim().slice(0, 50) || null;
    }

    const { data: currentSettings, error: currentSettingsError } = await client.database
      .from("tokentracker_user_settings")
      .select("leaderboard_public, display_name, github_url, show_github_url, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentSettingsError) {
      return json({ error: currentSettingsError.message || "Failed to read settings" }, 500);
    }

    // Persist everything to tokentracker_user_settings — the writable base table.
    //
    // display_name MUST be written here, NOT to tokentracker_user_profiles:
    // the latter is a VIEW (SELECT over auth.users LEFT JOIN
    // tokentracker_user_settings), so upserting it fails with "cannot insert
    // into view". The view exposes
    //   display_name = COALESCE(s.display_name, users.profile->>'name', email-local-part)
    // so writing tokentracker_user_settings.display_name is exactly what makes
    // the subsequent GET (which reads the view) reflect the saved name.
    const hasPublicProfileMutation =
      (body.leaderboard_public === true && currentSettings?.leaderboard_public !== true) ||
      (normalizedGithubUrl !== undefined && normalizedGithubUrl !== (currentSettings?.github_url ?? null)) ||
      (body.show_github_url !== undefined
        && Boolean(body.show_github_url) !== Boolean(currentSettings?.show_github_url)) ||
      (normalizedDisplayName !== undefined
        && normalizedDisplayName !== (currentSettings?.display_name ?? null));
    if (hasPublicProfileMutation) {
      const upsertRow: Record<string, unknown> = {
        user_id: userId,
        updated_at: now,
      };
      if (body.leaderboard_public === true) upsertRow.leaderboard_public = true;
      if (normalizedGithubUrl !== undefined) upsertRow.github_url = normalizedGithubUrl;
      if (body.show_github_url !== undefined) upsertRow.show_github_url = Boolean(body.show_github_url);
      if (normalizedDisplayName !== undefined) upsertRow.display_name = normalizedDisplayName;
      const { error: settingsErr } = await client.database.from("tokentracker_user_settings").upsert(
        upsertRow,
        { onConflict: "user_id" },
      );
      if (settingsErr) {
        return json({ error: settingsErr.message || "Failed to save settings" }, 500);
      }
      const dirty = await client.database.rpc("mark_leaderboard_dimensions_dirty", {
        p_user_id: userId,
        p_actual_cost_changed: true,
      });
      if (dirty.error) {
        return json({ error: dirty.error.message || "Leaderboard dirty mark failed" }, 500);
      }
      if (!await notifyRefreshCoordinator()) {
        return json({ error: "Leaderboard refresh coordinator unavailable" }, 502);
      }
    }

    const result: Record<string, unknown> = {
      updated_at: hasPublicProfileMutation ? now : currentSettings?.updated_at || null,
    };
    if (body.leaderboard_public === true) result.leaderboard_public = true;
    if (normalizedDisplayName !== undefined) result.display_name = normalizedDisplayName;
    if (normalizedGithubUrl !== undefined) result.github_url = normalizedGithubUrl;
    if (body.show_github_url !== undefined) result.show_github_url = Boolean(body.show_github_url);
    return json(result);
  }
  return json({ error: "Method not allowed" }, 405);
}
