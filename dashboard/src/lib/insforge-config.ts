/**
 * Production InsForge cloud — hardcoded fallback so deployments that don't
 * inject `VITE_INSFORGE_*` at build time (notably the Vercel build for
 * tokentracker.cc) still reach the cloud. Without this, `getInsforgeRemoteUrl`
 * returns "" and every cloud call (leaderboard list, profile modal, OAuth
 * login) silently fails on the public site.
 *
 * Both values are public by design: the anon key is a JWT (role=anon) meant to
 * ship in the browser bundle and also appears in `.github/workflows/*.yml`.
 * (Previously this mistakenly hardcoded the full-access `ik_*` API key, which
 * has admin access and must never reach the frontend.) Explicit env vars still win.
 */
const PROD_INSFORGE_BASE_URL = "https://a62b9nf2.ap-southeast.insforge.app";
const PROD_INSFORGE_FUNCTIONS_URL = "https://a62b9nf2.function2.insforge.app";
const PROD_INSFORGE_ANON_KEY =
  "anon_13e8a5d6400e9b50912a5c3612f3480ba06edbd2c331e84e5fbdf5fd16d3d381";

/**
 * InsForge 云端（SDK OAuth/Session）。`getInsforgeBaseUrl()` 在 localhost 有 env 时同样指向云端。
 * 仪表盘用量接口仍由 `getBackendBaseUrl()` 在 localhost 返回空串走本地 CLI；排行榜单独用 `getLeaderboardBaseUrl()`。
 */
/** 云端 InsForge 原始 URL（供 proxy 目标和 edge function 调用使用） */
export function getInsforgeRemoteUrl(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_BASE_URL ||
    env?.VITE_TOKENTRACKER_BACKEND_BASE_URL ||
    PROD_INSFORGE_BASE_URL
  ).trim();
}

/** Direct edge-function runtime. It avoids the slower compatibility proxy. */
export function getInsforgeFunctionsUrl(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_FUNCTIONS_BASE_URL ||
    PROD_INSFORGE_FUNCTIONS_URL
  ).trim();
}

/**
 * SDK baseUrl：localhost 时指向自己（走 vite proxy 避免跨域 cookie 问题），
 * 部署后直接指向云端。
 */
function getInsforgeBaseUrl(): string {
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (isLocalhost) return window.location.origin;
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_BASE_URL ||
    env?.VITE_TOKENTRACKER_BACKEND_BASE_URL ||
    PROD_INSFORGE_BASE_URL
  ).trim();
}

export function getInsforgeAnonKey(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_ANON_KEY ||
    env?.VITE_TOKENTRACKER_BACKEND_ANON_KEY ||
    PROD_INSFORGE_ANON_KEY
  ).trim();
}

export function isCloudInsforgeConfigured(): boolean {
  return Boolean(getInsforgeBaseUrl());
}

/**
 * 全局单例 SDK 客户端。
 *
 * OAuth 回调时 URL 上的 `insforge_code` 只会被处理一次；若在 React 18 Strict Mode 下
 * 每次挂载都 `createClient()`，第二次实例会错过回调且会话为空，右上角头像不更新。
 */
type InsforgeClient = Awaited<ReturnType<(typeof import("@insforge/sdk"))["createClient"]>>;

let insforgeClientSingleton: InsforgeClient | null = null;
let insforgeClientPromise: Promise<InsforgeClient> | null = null;

export async function getOrCreateInsforgeClient(): Promise<InsforgeClient | null> {
  if (!isCloudInsforgeConfigured()) return null;
  if (insforgeClientSingleton) return insforgeClientSingleton;
  if (!insforgeClientPromise) {
    insforgeClientPromise = import("@insforge/sdk").then(({ createClient }) => {
      insforgeClientSingleton = createClient({
        baseUrl: getInsforgeBaseUrl(),
        anonKey: getInsforgeAnonKey() || undefined,
        autoRefreshToken: true,
      });
      return insforgeClientSingleton;
    });
  }
  return insforgeClientPromise;
}
