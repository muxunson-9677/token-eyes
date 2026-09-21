"use strict";

/**
 * Provider API Secure Credential Store (02 - 供应商 API 余额后端)
 *
 * Security invariants (01-密钥安全修复强化):
 * - API keys are secrets, NOT ordinary config fields.
 * - Secrets NEVER appear in subprocess argv, env, PowerShell history, Keychain
 *   CLI arguments, process listings, logs, errors, or temp files. The only
 *   permitted transport is a controlled stdin pipe (Windows DPAPI) or a native
 *   secure IPC path. If neither is available on a platform, the store reports
 *   `credential_store_unavailable` and NEVER falls back to an insecure path.
 * - Secrets are persisted via OS-level secure storage:
 *   - macOS: Keychain — the `security` CLI requires `-w <secret>` (argv leak)
 *     and cannot read the secret from stdin. A Node-only CLI has no native
 *     Keychain binding, so the secure path is unavailable in this process.
 *     The store therefore returns `credential_store_unavailable` on macOS
 *     rather than keeping the insecure argv implementation. (A native Tauri
 *     Keychain command would be the secure path; out of scope for this fix.)
 *   - Windows: DPAPI (Data Protection API) via PowerShell — the plaintext
 *     secret is fed to powershell.exe through stdin ONLY; the `-Command`
 *     script contains no secret. The DPAPI-encrypted blob is stored in a
 *     separate vault file (NOT config.json), mode 0600, bound to the current
 *     Windows user.
 *   - Linux/other: credential_store_unavailable — secrets CANNOT be saved.
 * - The save endpoint only returns a reference (apiKeyRef) and a masked
 *   preview (e.g., "••••1234"), never the full secret.
 * - Secrets never appear in config.json, localStorage, sessionStorage, logs,
 *   error messages, or test snapshots.
 *
 * This module NEVER calls model inference endpoints. It only stores
 * credentials for financial balance/spend queries.
 */

const crypto = require("node:crypto");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_NAME = "TokenEyes:provider-api";
const VAULT_FILENAME = "provider-api-vault.enc";

const ERROR_CODES = Object.freeze({
  CREDENTIAL_STORE_UNAVAILABLE: "credential_store_unavailable",
  CREDENTIAL_MISSING: "credential_missing",
  INVALID_CONFIG: "invalid_config",
});

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Return a masked preview of a secret, showing only the last 4 characters.
 * Example: "sk-abc1234567" → "••••5677"
 */
function maskSecret(secret) {
  const s = String(secret || "");
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

// ---------------------------------------------------------------------------
// Credential store interface
// ---------------------------------------------------------------------------
//
// Every credential store implements:
//   isAvailable() → boolean
//   saveSecret(ref, secret) → { ok: true, masked: string } | { ok: false, error_code: string }
//   readSecret(ref) → string | null
//   deleteSecret(ref) → boolean
//   listRefs() → string[]
//
// ---------------------------------------------------------------------------

/**
 * Create an in-memory credential store (for testing only).
 * Does NOT persist across process restarts.
 */
function createInMemoryCredentialStore() {
  const store = new Map();
  return {
    isAvailable: () => true,
    saveSecret(ref, secret) {
      if (typeof ref !== "string" || !ref.trim()) {
        return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG };
      }
      store.set(ref, String(secret));
      return { ok: true, masked: maskSecret(secret) };
    },
    readSecret(ref) {
      return store.has(ref) ? store.get(ref) : null;
    },
    deleteSecret(ref) {
      return store.delete(ref);
    },
    listRefs() {
      return Array.from(store.keys());
    },
  };
}

/**
 * Create the default OS-backed credential store.
 *
 * - macOS: credential_store_unavailable — the `security` CLI cannot accept the
 *   secret except via argv (`-w <secret>`), which is an unacceptable leak.
 *   A Node-only CLI has no native Keychain binding, so there is no secure
 *   transport. Fail explicitly rather than keeping the insecure path.
 * - Windows: DPAPI via PowerShell, plaintext delivered via stdin ONLY.
 * - Other: credential_store_unavailable
 *
 * @param {Object} [options]
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.trackerDataDir] - For Windows vault file
 * @param {Function} [options.runner] - Override process runner (for testing)
 */
function createDefaultCredentialStore(options = {}) {
  const platform = options.platform || process.platform;
  const trackerDataDir = options.trackerDataDir || path.join(os.homedir(), ".tokentracker", "tracker");
  const runner = options.runner || defaultRunner;

  if (platform === "darwin") {
    // No secure native Keychain path exists from a Node-only CLI: the
    // `security` CLI leaks the secret into argv. Fail safe.
    return createUnavailableStore();
  }
  if (platform === "win32") {
    return createWindowsDpapiStore(trackerDataDir, runner);
  }
  // Linux and other platforms — no secure storage available
  return createUnavailableStore();
}

/**
 * Default process runner. Secrets are delivered to the child ONLY through the
 * `opts.input` field, which `spawnSync` writes to the child's stdin pipe and
 * then closes. The child argv and inherited env never carry the secret.
 */
function defaultRunner(cmd, args, opts = {}) {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const spawnOpts = {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: opts.timeout != null ? opts.timeout : 10_000,
    windowsHide: true,
    env: {
      SystemRoot: systemRoot,
      windir: systemRoot,
      PSModulePath: path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
    },
  };
  if (opts.input != null) {
    spawnOpts.input = opts.input;
  }
  const executable = cmd === "powershell.exe"
    ? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : cmd;
  const result = cp.spawnSync(executable, args, spawnOpts);
  return {
    status: result.status,
    stdout: result.stdout ? result.stdout.toString("utf8") : "",
    stderr: result.stderr ? result.stderr.toString("utf8") : "",
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// macOS Keychain store
// ---------------------------------------------------------------------------
//
// Intentionally NOT implemented. The `security` CLI on macOS requires the
// secret as an argv value (`security add-generic-password -w <secret>`), which
// leaks the key into the process list, shell history, and PowerShell/`security`
// error messages. There is no stdin mode for the password. Without a native
// Keychain binding (SecItemAdd via a Tauri command), there is no secure path
// from a Node-only CLI, so macOS reports `credential_store_unavailable`
// (see createDefaultCredentialStore). The previous insecure argv implementation
// was removed per 01-密钥安全修复 ("不能保留不安全实现").

// ---------------------------------------------------------------------------
// Windows DPAPI store
// ---------------------------------------------------------------------------

function createWindowsDpapiStore(trackerDataDir, runner) {
  const vaultPath = path.join(trackerDataDir, VAULT_FILENAME);

  function loadVault() {
    try {
      const raw = fs.readFileSync(vaultPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveVault(data) {
    try {
      if (!fs.existsSync(trackerDataDir)) {
        fs.mkdirSync(trackerDataDir, { recursive: true });
      }
      const tmp = `${vaultPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tmp, vaultPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Encrypt a secret using DPAPI via PowerShell.
   *
   * SECURITY: the plaintext secret is delivered to powershell.exe ONLY through
   * stdin (`opts.input`). The `-Command` script below contains NO secret — it
   * reads the plaintext from stdin via `[Console]::In.ReadToEnd()`. This keeps
   * the secret out of the process argv, PowerShell history, and error output.
   * Returns a hex-encoded DPAPI blob.
   */
  function encryptSecret(secret) {
    // Script text is constant — it never interpolates the secret.
    const psScript = `
$ErrorActionPreference = 'Stop'
$plain = [Console]::In.ReadToEnd()
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
ConvertFrom-SecureString -SecureString $secure
`.trim();

    const result = runner("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command", psScript,
    ], { timeout: 15_000, input: String(secret) });

    if (result.status !== 0 || !result.stdout.trim()) {
      return null;
    }
    return result.stdout.trim();
  }

  /**
   * Decrypt a DPAPI-encrypted blob via PowerShell.
   *
   * SECURITY: the blob is delivered via stdin only. Although the blob is
   * DPAPI-encrypted (not plaintext), keeping it out of argv prevents it from
   * appearing in process listings and error traces alongside the ref name.
   */
  function decryptSecret(encryptedBlob) {
    const psScript = `
$ErrorActionPreference = 'Stop'
$blob = [Console]::In.ReadToEnd().Trim()
$secure = ConvertTo-SecureString -String $blob
[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
`.trim();

    const result = runner("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command", psScript,
    ], { timeout: 15_000, input: String(encryptedBlob) });

    if (result.status !== 0) {
      return null;
    }
    return result.stdout.replace(/\r\n|\n|\r/g, "");
  }

  return {
    isAvailable: () => true,

    saveSecret(ref, secret) {
      if (typeof ref !== "string" || !ref.trim()) {
        return { ok: false, error_code: ERROR_CODES.INVALID_CONFIG };
      }
      const s = String(secret);
      const encrypted = encryptSecret(s);
      if (encrypted === null) {
        return { ok: false, error_code: ERROR_CODES.CREDENTIAL_STORE_UNAVAILABLE };
      }
      const vault = loadVault();
      vault[ref] = encrypted;
      if (!saveVault(vault)) {
        return { ok: false, error_code: ERROR_CODES.CREDENTIAL_STORE_UNAVAILABLE };
      }
      return { ok: true, masked: maskSecret(s) };
    },

    readSecret(ref) {
      if (typeof ref !== "string" || !ref.trim()) return null;
      const vault = loadVault();
      const encrypted = vault[ref];
      if (!encrypted) return null;
      const decrypted = decryptSecret(encrypted);
      return decrypted;
    },

    deleteSecret(ref) {
      if (typeof ref !== "string" || !ref.trim()) return false;
      const vault = loadVault();
      if (!(ref in vault)) return false;
      delete vault[ref];
      return saveVault(vault);
    },

    listRefs() {
      const vault = loadVault();
      return Object.keys(vault);
    },
  };
}

// ---------------------------------------------------------------------------
// Unavailable store (Linux and other platforms without secure storage)
// ---------------------------------------------------------------------------

function createUnavailableStore() {
  return {
    isAvailable: () => false,
    saveSecret() {
      return { ok: false, error_code: ERROR_CODES.CREDENTIAL_STORE_UNAVAILABLE };
    },
    readSecret() {
      return null;
    },
    deleteSecret() {
      return false;
    },
    listRefs() {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// Generate a unique apiKeyRef
// ---------------------------------------------------------------------------

/**
 * Generate a unique API key reference for storing a secret in the credential store.
 * Format: "provider-api/<providerId>/<uuid>"
 */
function generateApiKeyRef(providerId) {
  const pid = String(providerId || "unknown").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `provider-api/${pid}/${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ERROR_CODES,
  maskSecret,
  createDefaultCredentialStore,
  createInMemoryCredentialStore,
  createUnavailableStore,
  generateApiKeyRef,
  SERVICE_NAME,
  VAULT_FILENAME,
};
