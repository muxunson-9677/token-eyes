/**
 * InsForge Edge: WeChat website OAuth adapter.
 *
 * One deployed function exposes discovery, authorize, callback, token and
 * userinfo actions through `?action=...`. It adapts WeChat's website QR flow
 * to the OAuth + PKCE contract expected by an InsForge custom provider.
 * Raw state, authorization codes, adapter access tokens and stable WeChat IDs
 * are never persisted. Display profile fields are short-lived and disclosed
 * to users; bearer material and stable IDs are stored only as SHA-256 digests.
 */
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const noStoreHeaders = { ...corsHeaders, "Cache-Control": "no-store" };
const FLOW_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 10 * 60 * 1000;

type DatabaseClient = ReturnType<typeof createClient>;
type RuntimeConfig = {
  publicUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  redirectUris: Set<string>;
  wechatAppId: string;
  wechatAppSecret: string;
  insforgeBaseUrl: string;
  serviceRoleKey: string;
  anonKey?: string;
};
type OAuthFlow = {
  client_id: string;
  client_state: string;
  redirect_uri: string;
  code_challenge: string;
};
type OAuthCode = {
  subject: string;
  internal_email: string;
  display_name: string;
  avatar_url: string | null;
};
type OAuthToken = OAuthCode;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...noStoreHeaders,
      "Content-Type": "application/json",
    },
  });
}

function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { ...noStoreHeaders, Location: location },
  });
}

function redirectOAuth(
  redirectUri: string,
  params: Record<string, string | null | undefined>,
) {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) target.searchParams.set(key, value);
  }
  return redirect(target.toString());
}

function normalizedPublicUrl(req: Request) {
  const configured = Deno.env.get("WECHAT_OAUTH_PUBLIC_URL")?.trim();
  const url = new URL(configured || req.url);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function readConfig(req: Request): RuntimeConfig | null {
  const oauthClientId = Deno.env.get("WECHAT_OAUTH_CLIENT_ID")?.trim() || "";
  const oauthClientSecret = Deno.env.get("WECHAT_OAUTH_CLIENT_SECRET")?.trim() || "";
  const wechatAppId = Deno.env.get("WECHAT_OPEN_APP_ID")?.trim() || "";
  const wechatAppSecret = Deno.env.get("WECHAT_OPEN_APP_SECRET")?.trim() || "";
  const insforgeBaseUrl = Deno.env.get("INSFORGE_BASE_URL")?.trim() || "";
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY")?.trim() || "";
  const redirectUris = new Set(
    (Deno.env.get("WECHAT_OAUTH_REDIRECT_URIS") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (
    !oauthClientId ||
    !oauthClientSecret ||
    !wechatAppId ||
    !wechatAppSecret ||
    !insforgeBaseUrl ||
    !serviceRoleKey ||
    redirectUris.size === 0
  ) {
    return null;
  }
  return {
    publicUrl: normalizedPublicUrl(req),
    oauthClientId,
    oauthClientSecret,
    redirectUris,
    wechatAppId,
    wechatAppSecret,
    insforgeBaseUrl,
    serviceRoleKey,
    anonKey: Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? undefined,
  };
}

function databaseClient(config: RuntimeConfig): DatabaseClient {
  return createClient({
    baseUrl: config.insforgeBaseUrl,
    edgeFunctionToken: config.serviceRoleKey,
    anonKey: config.anonKey,
    ...(config.anonKey ? { headers: { apikey: config.anonKey } } : {}),
  });
}

async function pruneExpiredOauthRows(client: DatabaseClient) {
  const { error } = await client.database.rpc("tokentracker_prune_wechat_oauth");
  return !error;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Bytes(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

async function sha256Hex(input: string) {
  return Array.from(await sha256Bytes(input))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Base64Url(input: string) {
  return bytesToBase64Url(await sha256Bytes(input));
}

function constantTimeEquals(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let different = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    different |= (a[index] || 0) ^ (b[index] || 0);
  }
  return different === 0;
}

function isValidPkceVerifier(value: string) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function discovery(req: Request) {
  const publicUrl = normalizedPublicUrl(req);
  return json({
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}?action=authorize`,
    token_endpoint: `${publicUrl}?action=token`,
    userinfo_endpoint: `${publicUrl}?action=userinfo`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: ["openid", "profile", "email"],
    subject_types_supported: ["public"],
  });
}

async function authorize(req: Request, config: RuntimeConfig) {
  if (req.method !== "GET") return oauthError("invalid_request", "GET required", 405);
  const params = new URL(req.url).searchParams;
  const responseType = params.get("response_type") || "";
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const clientState = params.get("state") || "";
  const codeChallenge = params.get("code_challenge") || "";
  const codeChallengeMethod = params.get("code_challenge_method") || "";

  if (responseType !== "code") return oauthError("unsupported_response_type", "code required");
  if (!constantTimeEquals(clientId, config.oauthClientId)) {
    return oauthError("unauthorized_client", "unknown client");
  }
  if (!config.redirectUris.has(redirectUri)) {
    return oauthError("invalid_request", "redirect_uri is not allowed");
  }
  if (!clientState || clientState.length > 512) {
    return oauthError("invalid_request", "state required");
  }
  if (codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return oauthError("invalid_request", "S256 PKCE required");
  }

  const adapterState = randomBase64Url();
  const expiresAt = new Date(Date.now() + FLOW_TTL_MS).toISOString();
  const client = databaseClient(config);
  if (!(await pruneExpiredOauthRows(client))) {
    return oauthError("temporarily_unavailable", "authorization unavailable", 503);
  }
  const { error } = await client.database.from("tokentracker_wechat_oauth_flows").insert([
    {
      state_hash: await sha256Hex(adapterState),
      client_id: clientId,
      client_state: clientState,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      expires_at: expiresAt,
    },
  ]);
  if (error) return oauthError("temporarily_unavailable", "authorization unavailable", 503);

  const callbackUrl = `${config.publicUrl}?action=callback`;
  const wechatUrl = new URL("https://open.weixin.qq.com/connect/qrconnect");
  wechatUrl.searchParams.set("appid", config.wechatAppId);
  wechatUrl.searchParams.set("redirect_uri", callbackUrl);
  wechatUrl.searchParams.set("response_type", "code");
  wechatUrl.searchParams.set("scope", "snsapi_login");
  wechatUrl.searchParams.set("state", adapterState);
  wechatUrl.hash = "wechat_redirect";
  return redirect(wechatUrl.toString());
}

async function consumeFlow(client: DatabaseClient, adapterState: string) {
  const now = new Date().toISOString();
  const { data, error } = await client.database
    .from("tokentracker_wechat_oauth_flows")
    .update({ consumed_at: now })
    .eq("state_hash", await sha256Hex(adapterState))
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("client_id, client_state, redirect_uri, code_challenge")
    .maybeSingle();
  if (error || !data) return null;
  return data as OAuthFlow;
}

async function readJsonResponse(response: Response) {
  if (!response.ok) return null;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchWechatJson(url: URL) {
  try {
    return await readJsonResponse(
      await fetch(url, { headers: { Accept: "application/json" } }),
    );
  } catch {
    return null;
  }
}

function safeDisplayName(value: unknown) {
  if (typeof value !== "string") return "微信用户";
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return normalized ? normalized.slice(0, 100) : "微信用户";
}

function safeAvatarUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

async function callback(req: Request, config: RuntimeConfig) {
  if (req.method !== "GET") return oauthError("invalid_request", "GET required", 405);
  const params = new URL(req.url).searchParams;
  const adapterState = params.get("state") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(adapterState)) {
    return oauthError("invalid_request", "invalid or expired state");
  }

  const client = databaseClient(config);
  if (!(await pruneExpiredOauthRows(client))) {
    return oauthError("temporarily_unavailable", "authorization unavailable", 503);
  }
  const flow = await consumeFlow(client, adapterState);
  if (!flow) return oauthError("invalid_request", "invalid or expired state");

  const wechatCode = params.get("code") || "";
  if (!wechatCode || params.has("error") || params.has("errcode")) {
    return redirectOAuth(flow.redirect_uri, {
      error: "access_denied",
      error_description: "WeChat authorization was cancelled",
      state: flow.client_state,
    });
  }

  const exchangeUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  exchangeUrl.searchParams.set("appid", config.wechatAppId);
  exchangeUrl.searchParams.set("secret", config.wechatAppSecret);
  exchangeUrl.searchParams.set("code", wechatCode);
  exchangeUrl.searchParams.set("grant_type", "authorization_code");
  const exchange = await fetchWechatJson(exchangeUrl);
  const wechatAccessToken = typeof exchange?.access_token === "string" ? exchange.access_token : "";
  const wechatOpenId = typeof exchange?.openid === "string" ? exchange.openid : "";
  if (!wechatAccessToken || !wechatOpenId || exchange?.errcode) {
    return redirectOAuth(flow.redirect_uri, {
      error: "server_error",
      state: flow.client_state,
    });
  }

  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.searchParams.set("access_token", wechatAccessToken);
  profileUrl.searchParams.set("openid", wechatOpenId);
  profileUrl.searchParams.set("lang", "zh_CN");
  const profile = await fetchWechatJson(profileUrl);
  if (!profile || profile.errcode) {
    return redirectOAuth(flow.redirect_uri, {
      error: "server_error",
      state: flow.client_state,
    });
  }

  const unionId =
    typeof profile.unionid === "string"
      ? profile.unionid
      : typeof exchange.unionid === "string"
        ? exchange.unionid
        : "";
  const identityDigest = await sha256Hex(
    unionId ? `wechat:union:${unionId}` : `wechat:open:${config.wechatAppId}:${wechatOpenId}`,
  );
  const subject = `wechat_${identityDigest}`;
  const internalEmail = `${identityDigest.slice(0, 48)}@wechat.invalid`;
  const authorizationCode = randomBase64Url();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error: insertError } = await client.database
    .from("tokentracker_wechat_oauth_codes")
    .insert([
      {
        code_hash: await sha256Hex(authorizationCode),
        client_id: flow.client_id,
        redirect_uri: flow.redirect_uri,
        code_challenge: flow.code_challenge,
        subject,
        internal_email: internalEmail,
        display_name: safeDisplayName(profile.nickname),
        avatar_url: safeAvatarUrl(profile.headimgurl),
        expires_at: expiresAt,
      },
    ]);
  if (insertError) {
    return redirectOAuth(flow.redirect_uri, {
      error: "temporarily_unavailable",
      state: flow.client_state,
    });
  }
  return redirectOAuth(flow.redirect_uri, {
    code: authorizationCode,
    state: flow.client_state,
  });
}

async function parseTokenBody(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const data = (await req.json()) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, typeof value === "string" ? value : ""]),
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

function basicClientCredentials(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      clientId: decoded.slice(0, separator),
      clientSecret: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function token(req: Request, config: RuntimeConfig) {
  if (req.method !== "POST") return oauthError("invalid_request", "POST required", 405);
  const body = await parseTokenBody(req);
  const basic = basicClientCredentials(req);
  const grantType = body.grant_type || "";
  const authorizationCode = body.code || "";
  const redirectUri = body.redirect_uri || "";
  const clientId = basic?.clientId || body.client_id || "";
  const clientSecret = basic?.clientSecret || body.client_secret || "";
  const codeVerifier = body.code_verifier || "";

  if (grantType !== "authorization_code") {
    return oauthError("unsupported_grant_type", "authorization_code required");
  }
  if (
    !constantTimeEquals(clientId, config.oauthClientId) ||
    !constantTimeEquals(clientSecret, config.oauthClientSecret)
  ) {
    return oauthError("invalid_client", "client authentication failed", 401);
  }
  if (!config.redirectUris.has(redirectUri) || !authorizationCode || !isValidPkceVerifier(codeVerifier)) {
    return oauthError("invalid_grant", "authorization code rejected");
  }

  const codeChallenge = await sha256Base64Url(codeVerifier);
  const now = new Date().toISOString();
  const client = databaseClient(config);
  if (!(await pruneExpiredOauthRows(client))) {
    return oauthError("temporarily_unavailable", "token unavailable", 503);
  }
  const { data, error } = await client.database
    .from("tokentracker_wechat_oauth_codes")
    .update({ consumed_at: now })
    .eq("code_hash", await sha256Hex(authorizationCode))
    .eq("client_id", clientId)
    .eq("redirect_uri", redirectUri)
    .eq("code_challenge", codeChallenge)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("subject, internal_email, display_name, avatar_url")
    .maybeSingle();
  if (error || !data) return oauthError("invalid_grant", "authorization code rejected");
  const code = data as OAuthCode;

  const accessToken = randomBase64Url();
  const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error: tokenError } = await client.database
    .from("tokentracker_wechat_oauth_tokens")
    .insert([
      {
        token_hash: await sha256Hex(accessToken),
        subject: code.subject,
        internal_email: code.internal_email,
        display_name: code.display_name,
        avatar_url: code.avatar_url,
        expires_at: tokenExpiresAt,
      },
    ]);
  if (tokenError) return oauthError("temporarily_unavailable", "token unavailable", 503);
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    scope: "openid profile email",
  });
}

async function userinfo(req: Request, config: RuntimeConfig) {
  if (req.method !== "GET" && req.method !== "POST") {
    return oauthError("invalid_request", "GET or POST required", 405);
  }
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return oauthError("invalid_token", "bearer token required", 401);

  const now = new Date().toISOString();
  const client = databaseClient(config);
  if (!(await pruneExpiredOauthRows(client))) {
    return oauthError("temporarily_unavailable", "userinfo unavailable", 503);
  }
  const { data, error } = await client.database
    .from("tokentracker_wechat_oauth_tokens")
    .select("subject, internal_email, display_name, avatar_url")
    .eq("token_hash", await sha256Hex(match[1]))
    .gt("expires_at", now)
    .maybeSingle();
  if (error || !data) return oauthError("invalid_token", "token rejected", 401);
  const identity = data as OAuthToken;
  return json({
    id: identity.subject,
    sub: identity.subject,
    subject: identity.subject,
    email: identity.internal_email,
    email_verified: true,
    name: identity.display_name,
    picture: identity.avatar_url,
  });
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const action = new URL(req.url).searchParams.get("action") || "discovery";
  if (action === "discovery") return discovery(req);

  const config = readConfig(req);
  if (!config) return oauthError("temporarily_unavailable", "WeChat login is not configured", 503);
  if (action === "authorize") return authorize(req, config);
  if (action === "callback") return callback(req, config);
  if (action === "token") return token(req, config);
  if (action === "userinfo") return userinfo(req, config);
  return oauthError("invalid_request", "unknown OAuth action", 404);
}
