/** Isolated 0.54.49 staging backend. Explicit environment values still win. */
const DEFAULT_INSFORGE_BASE_URL = "https://wm59q8gm.ap-southeast.insforge.app";
const DEFAULT_INSFORGE_FUNCTIONS_URL = DEFAULT_INSFORGE_BASE_URL;
const DEFAULT_INSFORGE_ANON_KEY = "";

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
    DEFAULT_INSFORGE_BASE_URL
  ).trim();
}

/** Direct edge-function runtime. It avoids the slower compatibility proxy. */
export function getInsforgeFunctionsUrl(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_FUNCTIONS_BASE_URL ||
    DEFAULT_INSFORGE_FUNCTIONS_URL
  ).trim();
}

/**
 * SDK baseUrl：localhost 时指向自己（走 vite proxy 避免跨域 cookie 问题），
 * 部署后直接指向云端。
 */
function getInsforgeBaseUrl(): string {
  const remoteUrl = getInsforgeRemoteUrl();
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (isLocalhost && remoteUrl) return window.location.origin;
  return remoteUrl;
}

export function getInsforgeAnonKey(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_INSFORGE_ANON_KEY ||
    env?.VITE_TOKENTRACKER_BACKEND_ANON_KEY ||
    DEFAULT_INSFORGE_ANON_KEY
  ).trim();
}

export type CloudInsforgeDisabledReason =
  | "missing_public_auth_credential"
  | "invalid_auth_base_url";

function hasSafeInsforgeRemoteUrl(): boolean {
  try {
    const url = new URL(getInsforgeRemoteUrl());
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function getCloudInsforgeDisabledReason(): CloudInsforgeDisabledReason | null {
  if (!hasSafeInsforgeRemoteUrl()) return "invalid_auth_base_url";
  if (!getInsforgeAnonKey()) return "missing_public_auth_credential";
  return null;
}

export function isCloudInsforgeConfigured(): boolean {
  return getCloudInsforgeDisabledReason() === null;
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
        anonKey: getInsforgeAnonKey(),
        autoRefreshToken: true,
      });
      return insforgeClientSingleton;
    });
  }
  return insforgeClientPromise;
}
