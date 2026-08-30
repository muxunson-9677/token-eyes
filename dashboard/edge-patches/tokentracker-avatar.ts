import { createClient } from "npm:@insforge/sdk";

const BUCKET = "tokentracker-leaderboard-avatars";
const MAX_BYTES = 16 * 1024;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(value: unknown, status = 200, immutable = false) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      ...(immutable ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
    },
  });
}

async function verifiedUserId(baseUrl: string, token: string): Promise<string | null> {
  const authClient = createClient({ baseUrl, edgeFunctionToken: token });
  const { data, error } = await authClient.auth.getCurrentUser();
  return !error && typeof data?.user?.id === "string" ? data.user.id : null;
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function publishStaticAvatar(hash: string, method: "PUT" | "DELETE", bytes?: Uint8Array) {
  const publisherOrigin = Deno.env.get("LEADERBOARD_AVATAR_PUBLISH_ORIGIN") || "";
  const publisherSecret = Deno.env.get("LEADERBOARD_PUBLISHER_SECRET") || "";
  if (!/^https:\/\//i.test(publisherOrigin) || !publisherSecret) return false;
  const response = await fetch(
    new URL(`/internal/leaderboard-avatar/${hash}.webp`, publisherOrigin),
    {
      method,
      headers: {
        "x-leaderboard-publisher-secret": publisherSecret,
        ...(method === "PUT" ? { "Content-Type": "image/webp" } : {}),
      },
      ...(bytes ? { body: bytes } : {}),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  return Boolean(response?.ok);
}

async function notifyRefreshCoordinator() {
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

function staticAvatarUrl(hash: string) {
  const feedOrigin = Deno.env.get("PUBLIC_FEED_ORIGIN") || "";
  if (!/^https:\/\//i.test(feedOrigin)) return null;
  return new URL(`/v1/avatars/${hash}.webp`, feedOrigin).toString();
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "PUT" && req.method !== "DELETE") {
    return json({ error: "Method not allowed" }, 405);
  }
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const userId = await verifiedUserId(baseUrl, token);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const serviceRoleKey = Deno.env.get("API_KEY") ?? Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });
  const storage = client.storage.from(BUCKET);

  if (req.method === "PUT") {
    if ((req.headers.get("content-type") || "").toLowerCase() !== "image/webp") {
      return json({ error: "Only image/webp is accepted" }, 415);
    }
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) return json({ error: "Avatar exceeds 16 KiB" }, 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024) {
      return json({ error: "Avatar exceeds 16 KiB" }, 413);
    }
    const ascii = (start: number, length: number) =>
      String.fromCharCode(...bytes.slice(start, start + length));
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") {
      return json({ error: "Invalid RIFF/WEBP signature" }, 415);
    }

    const hash = hex(await crypto.subtle.digest("SHA-256", bytes));
    const objectKey = `${userId}/${hash}.webp`;
    const { data: previous } = await client.database
      .from("tokentracker_leaderboard_avatar_metadata")
      .select("object_key, content_hash, avatar_url")
      .eq("user_id", userId)
      .maybeSingle();
    if (previous?.content_hash === hash) {
      return json({
        avatar_url: previous.avatar_url || staticAvatarUrl(hash),
        content_hash: hash,
        unchanged: true,
      }, 200, true);
    }
    const { error: uploadError } = await storage.upload(
      objectKey,
      new Blob([bytes], { type: "image/webp" }),
    );
    if (uploadError) return json({ error: uploadError.message }, 500);

    const avatarUrl = staticAvatarUrl(hash);
    if (!avatarUrl || !await publishStaticAvatar(hash, "PUT", bytes)) {
      await storage.remove(objectKey);
      return json({ error: "Static avatar publication failed" }, 502);
    }
    const { error: metadataError } = await client.database
      .from("tokentracker_leaderboard_avatar_metadata")
      .upsert({
        user_id: userId,
        object_key: objectKey,
        content_hash: hash,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (metadataError) {
      await storage.remove(objectKey);
      return json({ error: metadataError.message }, 500);
    }
    if (previous?.object_key && previous.object_key !== objectKey) {
      await storage.remove(previous.object_key);
    }
    if (previous?.content_hash && previous.content_hash !== hash) {
      await publishStaticAvatar(previous.content_hash, "DELETE");
    }
    const dirty = await client.database.rpc("mark_leaderboard_dimensions_dirty", {
      p_user_id: userId,
      p_actual_cost_changed: true,
    });
    if (dirty.error) return json({ error: dirty.error.message || "Leaderboard dirty mark failed" }, 500);
    if (!await notifyRefreshCoordinator()) {
      return json({ error: "Leaderboard refresh coordinator unavailable" }, 502);
    }
    return json({ avatar_url: avatarUrl, content_hash: hash }, 200, true);
  }

  const { data: previous } = await client.database
    .from("tokentracker_leaderboard_avatar_metadata")
    .select("object_key, content_hash")
    .eq("user_id", userId)
    .maybeSingle();
  if (!previous) {
    return json({ avatar_url: null, unchanged: true });
  }
  if (previous?.content_hash && !await publishStaticAvatar(previous.content_hash, "DELETE")) {
    return json({ error: "Static avatar deletion failed" }, 502);
  }
  const { error: deleteError } = await client.database
    .from("tokentracker_leaderboard_avatar_metadata")
    .delete()
    .eq("user_id", userId);
  if (deleteError) return json({ error: deleteError.message }, 500);
  if (previous?.object_key) await storage.remove(previous.object_key);
  const dirty = await client.database.rpc("mark_leaderboard_dimensions_dirty", {
    p_user_id: userId,
    p_actual_cost_changed: true,
  });
  if (dirty.error) return json({ error: dirty.error.message || "Leaderboard dirty mark failed" }, 500);
  if (!await notifyRefreshCoordinator()) {
    return json({ error: "Leaderboard refresh coordinator unavailable" }, 502);
  }
  return json({ avatar_url: null });
}
