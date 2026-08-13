"use strict";

/**
 * Zed subscription usage limits.
 *
 * Zed's desktop app stores its cloud credential in the OS credential store
 * under the URL `https://zed.dev`:
 *   - macOS Keychain: internet password, server `zed.dev`
 *     (account = numeric user id, password = access token)
 *   - Windows Credential Manager: generic credential, target
 *     `zed:url=https://zed.dev` (UserName = user id, blob = access token)
 *
 * Usage comes from `GET {cloud}/client/users/me` with the *space-separated*
 * `Authorization: <user_id> <access_token>` header (not Bearer). The
 * `/frontend/billing/*` endpoints intentionally are NOT used — desktop
 * credentials get 401 there.
 *
 * Response fields used:
 *   plan.plan_v3                             → plan name ("zed_pro", ...)
 *   current_usage.token_spend.{used,limit}   → cents
 *   current_usage.edit_predictions.{used,limit}
 *   subscription.period.end_at               → window reset
 */

const DEFAULT_ZED_CLOUD_BASE_URL = "https://cloud.zed.dev";
const ZED_KEYCHAIN_SERVER = "zed.dev";
const ZED_WINDOWS_CRED_TARGET = "zed:url=https://zed.dev";
const MACOS_SECURITY_BIN = "/usr/bin/security";

function resolveZedCloudBaseUrl(env = process.env) {
  const explicit = typeof env.TOKENTRACKER_ZED_CLOUD_BASE_URL === "string"
    ? env.TOKENTRACKER_ZED_CLOUD_BASE_URL.trim()
    : "";
  return (explicit || DEFAULT_ZED_CLOUD_BASE_URL).replace(/\/$/, "");
}

function readZedCredentialFromEnv(env = process.env) {
  const userId = typeof env.TOKENTRACKER_ZED_USER_ID === "string" ? env.TOKENTRACKER_ZED_USER_ID.trim() : "";
  const accessToken = typeof env.TOKENTRACKER_ZED_ACCESS_TOKEN === "string" ? env.TOKENTRACKER_ZED_ACCESS_TOKEN.trim() : "";
  if (userId && accessToken) return { userId, accessToken };
  return null;
}

function runnerOutput(result) {
  if (!result || result.error || result.status !== 0) return null;
  const stdout = typeof result.stdout === "string"
    ? result.stdout
    : Buffer.isBuffer(result.stdout)
      ? result.stdout.toString("utf8")
      : "";
  return stdout;
}

/**
 * macOS: two `security find-internet-password` calls — one for the attribute
 * dump (account/user id), one with `-w` for the password (access token).
 * `securityRunner` is spawnSync-compatible and injectable for tests.
 */
function readZedCredentialMacos({ securityRunner, timeoutMs = 2000 } = {}) {
  const cp = require("node:child_process");
  const fs = require("node:fs");
  const runner = typeof securityRunner === "function" ? securityRunner : cp.spawnSync;
  if (runner === cp.spawnSync && !fs.existsSync(MACOS_SECURITY_BIN)) return null;

  const attrResult = runner(MACOS_SECURITY_BIN, ["find-internet-password", "-s", ZED_KEYCHAIN_SERVER], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
    encoding: "utf8",
  });
  const attrs = runnerOutput(attrResult);
  if (!attrs) return null;
  const acctMatch = attrs.match(/"acct"<blob>="([^"]*)"/);
  const userId = acctMatch ? acctMatch[1].trim() : "";
  if (!userId) return null;

  const pwResult = runner(MACOS_SECURITY_BIN, ["find-internet-password", "-s", ZED_KEYCHAIN_SERVER, "-w"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
    encoding: "utf8",
  });
  const accessToken = (runnerOutput(pwResult) || "").trim();
  if (!accessToken) return null;
  return { userId, accessToken };
}

// PowerShell CredRead (P/Invoke) — prints "<user id>\n<access token>". The
// blob may be UTF-8 or UTF-16LE depending on the writer, so the script decodes
// UTF-8 first and falls back to Unicode when NUL bytes are present.
const ZED_WINDOWS_CRED_SCRIPT = `
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class CredReader {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr credential);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction Stop | Out-Null
$ptr = [IntPtr]::Zero
if (-not [CredReader]::CredRead('__TARGET__', 1, 0, [ref]$ptr)) { exit 1 }
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredReader+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  if ($cred.CredentialBlobSize -gt 0) {
    [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  }
  $secret = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($secret.Contains([char]0)) { $secret = [System.Text.Encoding]::Unicode.GetString($bytes) }
  Write-Output $cred.UserName
  Write-Output $secret.TrimEnd([char]0)
} finally {
  [CredReader]::CredFree($ptr)
}
`.trim();

async function readZedCredentialWindows({ commandRunner, timeoutMs = 5000 } = {}) {
  const { runCommand } = require("./usage-limits");
  const script = ZED_WINDOWS_CRED_SCRIPT.replace("__TARGET__", ZED_WINDOWS_CRED_TARGET);
  const result = await runCommand(
    commandRunner,
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: timeoutMs, windowsHide: true },
  );
  const stdout = runnerOutput(result);
  if (!stdout) return null;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const userId = lines[0];
  const accessToken = lines[1];
  if (!userId || !accessToken) return null;
  return { userId, accessToken };
}

async function readZedCredential({ platform = process.platform, env = process.env, securityRunner, commandRunner } = {}) {
  const fromEnv = readZedCredentialFromEnv(env);
  if (fromEnv) return fromEnv;
  try {
    if (platform === "darwin") {
      return readZedCredentialMacos({ securityRunner });
    }
    if (platform === "win32") {
      return await readZedCredentialWindows({ commandRunner });
    }
  } catch {
    return null;
  }
  return null;
}

function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ts = Date.parse(value.trim());
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : null;
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

function usageWindow(usage, resetAt) {
  if (!usage || typeof usage !== "object") return null;
  const used = finiteNonNegative(usage.used);
  const limit = finiteNonNegative(usage.limit);
  if (used === null || limit === null || limit <= 0) return null;
  const pct = clampPercent((used / limit) * 100);
  if (pct === null) return null;
  return { used_percent: pct, reset_at: resetAt || null };
}

function prettifyZedPlan(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return null;
  return value.replace(/^zed[_\s-]*/, "").replace(/[_-]+/g, " ").trim() || null;
}

function normalizeZedUsageResponse(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Could not parse Zed usage: empty response");
  }
  const currentUsage = body.current_usage && typeof body.current_usage === "object" ? body.current_usage : {};
  const period = body.subscription && typeof body.subscription === "object" && body.subscription.period && typeof body.subscription.period === "object"
    ? body.subscription.period
    : {};
  const resetAt = isoOrNull(period.end_at);

  const tokenSpend = currentUsage.token_spend;
  const editPredictions = currentUsage.edit_predictions;
  const primaryWindow = usageWindow(tokenSpend, resetAt);
  const secondaryWindow = usageWindow(editPredictions, resetAt);
  if (!primaryWindow && !secondaryWindow) {
    throw new Error("Could not parse Zed usage: no quota windows in response");
  }

  const plan = body.plan && typeof body.plan === "object" ? body.plan : {};
  return {
    plan_name: prettifyZedPlan(plan.plan_v3 ?? plan.plan),
    // token_spend values are USD cents; surfaced for richer display later.
    spend_used_cents: finiteNonNegative(tokenSpend?.used),
    spend_limit_cents: finiteNonNegative(tokenSpend?.limit),
    predictions_used: finiteNonNegative(editPredictions?.used),
    predictions_limit: finiteNonNegative(editPredictions?.limit),
    period_start: isoOrNull(period.start_at),
    period_end: resetAt,
    primary_window: primaryWindow,
    secondary_window: secondaryWindow,
  };
}

async function fetchZedUsage(credential, { fetchImpl = fetch, baseUrl, env } = {}) {
  const root = (baseUrl || resolveZedCloudBaseUrl(env)).replace(/\/$/, "");
  const res = await fetchImpl(`${root}/client/users/me`, {
    method: "GET",
    headers: {
      // Zed's client auth header is "<user_id> <access_token>" — not Bearer.
      Authorization: `${credential.userId} ${credential.accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Not signed in to Zed. Sign in from the Zed editor to refresh the credential.");
  }
  if (!res.ok) {
    throw new Error(`Zed usage API returned ${res.status}`);
  }
  return res.json();
}

async function fetchZedLimits({ platform, env, fetchImpl = fetch, securityRunner, commandRunner } = {}) {
  const credential = await readZedCredential({ platform, env, securityRunner, commandRunner });
  if (!credential) {
    return { configured: false };
  }
  try {
    const body = await fetchZedUsage(credential, { fetchImpl, env });
    return {
      configured: true,
      error: null,
      ...normalizeZedUsageResponse(body),
    };
  } catch (error) {
    return {
      configured: true,
      error: error?.message || "Unknown error",
    };
  }
}

module.exports = {
  DEFAULT_ZED_CLOUD_BASE_URL,
  ZED_KEYCHAIN_SERVER,
  ZED_WINDOWS_CRED_TARGET,
  resolveZedCloudBaseUrl,
  readZedCredentialFromEnv,
  readZedCredentialMacos,
  readZedCredentialWindows,
  readZedCredential,
  prettifyZedPlan,
  normalizeZedUsageResponse,
  fetchZedUsage,
  fetchZedLimits,
};
