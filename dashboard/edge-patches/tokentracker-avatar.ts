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
      .select("object_key")
      .eq("user_id", userId)
      .maybeSingle();
    const { error: uploadError } = await storage.upload(
      objectKey,
      new Blob([bytes], { type: "image/webp" }),
    );
    if (uploadError) return json({ error: uploadError.message }, 500);

    const publicBase = (Deno.env.get("LEADERBOARD_AVATAR_PUBLIC_BASE") || "").replace(/\/$/, "");
    const avatarUrl = `${publicBase}?hash=${hash}`;
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
    return json({ avatar_url: avatarUrl, content_hash: hash }, 200, true);
  }

  const { data: previous } = await client.database
    .from("tokentracker_leaderboard_avatar_metadata")
    .select("object_key")
    .eq("user_id", userId)
    .maybeSingle();
  const { error: deleteError } = await client.database
    .from("tokentracker_leaderboard_avatar_metadata")
    .delete()
    .eq("user_id", userId);
  if (deleteError) return json({ error: deleteError.message }, 500);
  if (previous?.object_key) await storage.remove(previous.object_key);
  return json({ avatar_url: null });
}
