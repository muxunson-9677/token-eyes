/**
 * Public mirror of dashboard/public/.well-known/token-eyes/codex-reset-feed.json.
 * The desktop client verifies the Ed25519 signature before accepting any item.
 */
import { createClient } from "npm:@insforge/sdk";

const fallbackEnvelope = {
  version: 1,
  payload_b64: "eyJnZW5lcmF0ZWRfYXQiOiIyMDI2LTA3LTIyVDA0OjI3OjI4LjM2MVoiLCJhbm5vdW5jZW1lbnRzIjpbXX0",
  signature_b64: "8AF61SRIQ7t8D5OogiXPNxnG06iIBFiRumlgA7N1CZw_AVnCKx72t6mH1gck_yomnxiQnPZ-F5EvzYqR5U5JCA",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "If-None-Match",
};

export default async function (request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  let envelope = fallbackEnvelope;
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  const serviceKey = Deno.env.get("API_KEY");
  if (baseUrl && serviceKey) {
    const client = createClient({ baseUrl, edgeFunctionToken: serviceKey });
    const { data } = await client.database
      .from("tokentracker_codex_reset_feed_state")
      .select("envelope")
      .eq("singleton", true)
      .maybeSingle();
    const stored = data?.envelope;
    if (
      stored?.version === 1
      && typeof stored.payload_b64 === "string"
      && typeof stored.signature_b64 === "string"
    ) {
      envelope = stored;
    }
  }

  const body = JSON.stringify(envelope);
  const etag = `W/\"reset-feed-${envelope.payload_b64.slice(-12)}\"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ...cors, ETag: etag } });
  }

  return new Response(body, {
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-if-error=86400",
      ETag: etag,
    },
  });
}
