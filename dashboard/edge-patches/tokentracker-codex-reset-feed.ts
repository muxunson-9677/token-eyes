/**
 * Public mirror of dashboard/public/.well-known/token-eyes/codex-reset-feed.json.
 * The desktop client verifies the Ed25519 signature before accepting any item.
 */
const envelope = {
  version: 1,
  payload_b64: "eyJnZW5lcmF0ZWRfYXQiOiIyMDI2LTA3LTIwVDE0OjI5OjExLjk1MVoiLCJhbm5vdW5jZW1lbnRzIjpbXX0",
  signature_b64: "vcsKLQJnV1hLqy7w0GY9mCu3H_zO24m-Ise4GrKCfW1Gz-gQeHgKl8Qs3wO57Cm0lh9G5nbPE9LnYMuCqlGBBg",
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

  const body = JSON.stringify(envelope);
  const etag = `W/\"reset-feed-${envelope.payload_b64.slice(-12)}\"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ...cors, ETag: etag } });
  }

  return new Response(body, {
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=1800, stale-if-error=86400",
      ETag: etag,
    },
  });
}
