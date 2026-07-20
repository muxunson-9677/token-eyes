import { createClient } from "npm:@insforge/sdk";

const BUCKET = "tokentracker-leaderboard-avatars";
const HASH_RE = /^[a-f0-9]{64}$/;

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async function (req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const hash = new URL(req.url).searchParams.get("hash") || "";
  if (!HASH_RE.test(hash)) return json({ error: "Not found" }, 404);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);
  const client = createClient({ baseUrl, edgeFunctionToken: serviceRoleKey });
  const { data: metadata, error: metadataError } = await client.database
    .from("tokentracker_leaderboard_avatar_metadata")
    .select("object_key")
    .eq("content_hash", hash)
    .maybeSingle();
  if (metadataError || !metadata?.object_key) return json({ error: "Not found" }, 404);

  const { data, error } = await client.storage.from(BUCKET).download(metadata.object_key);
  if (error || !data) return json({ error: "Not found" }, 404);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
