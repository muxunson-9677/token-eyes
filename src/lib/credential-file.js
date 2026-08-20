"use strict";

const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REDACTED = "[REDACTED]";

function percentEncodedSurfacePattern(surface) {
  let pattern = "";
  for (let index = 0; index < surface.length; index += 1) {
    const character = surface[index];
    const hexPair = character === "%" ? surface.slice(index + 1, index + 3) : "";
    if (/^[0-9A-Fa-f]{2}$/.test(hexPair)) {
      pattern += "%";
      for (const hexCharacter of hexPair) {
        if (/[A-Fa-f]/.test(hexCharacter)) {
          pattern += `[${hexCharacter.toUpperCase()}${hexCharacter.toLowerCase()}]`;
        } else {
          pattern += hexCharacter;
        }
      }
      index += 2;
      continue;
    }
    pattern += /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(pattern, "g");
}

function redactSecrets(value, secrets = []) {
  let text = String(value ?? "");
  const rawSecrets = new Set();
  const encodedSurfaces = new Set();
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length === 0) continue;
    rawSecrets.add(secret);
    encodedSurfaces.add(encodeURIComponent(secret));
    encodedSurfaces.add(new URLSearchParams({ token: secret }).toString().slice("token=".length));
  }
  for (const surface of Array.from(encodedSurfaces).sort((a, b) => b.length - a.length)) {
    text = text.replace(percentEncodedSurfacePattern(surface), REDACTED);
  }
  for (const surface of Array.from(rawSecrets).sort((a, b) => b.length - a.length)) {
    text = text.split(surface).join(REDACTED);
  }
  return text;
}

function credentialError(code, stage, error, secrets) {
  const detail = redactSecrets(error?.message || error || "Unknown error", secrets);
  const wrapped = new Error(`Credential file persistence failed during ${stage}: ${detail}`);
  wrapped.code = code;
  wrapped.stage = stage;
  return wrapped;
}

function stableCredentialError(code, stage, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  return error;
}

const WINDOWS_ACL_PREAMBLE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$VerbosePreference = 'SilentlyContinue'",
  "$InformationPreference = 'SilentlyContinue'",
  "$WarningPreference = 'SilentlyContinue'",
  "$modulePath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
  "Import-Module -Name $modulePath -Force -ErrorAction Stop",
].join("; ");

function runWindowsAclPowerShell(script, aclEnv = {}) {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const encodedCommand = Buffer.from(`${WINDOWS_ACL_PREAMBLE}; ${script}`, "utf16le").toString("base64");
  const result = cp.spawnSync(
    executable,
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    {
      encoding: "utf8",
      env: {
        SystemRoot: systemRoot,
        windir: systemRoot,
        ComSpec: process.env.ComSpec || path.join(systemRoot, "System32", "cmd.exe"),
        ...aclEnv,
      },
      windowsHide: true,
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || String(result.stderr || "").length > 0) {
    throw new Error("Windows ACL operation failed");
  }
  return String(result.stdout || "");
}

function sddlFingerprint(sddl) {
  return crypto.createHash("sha256").update(sddl, "utf8").digest("hex");
}

function credentialSecretsFromValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [value.access_token, value.refresh_token, value.id_token]
    .filter((secret) => typeof secret === "string" && secret.length > 0);
}

const defaultWindowsAcl = Object.freeze({
  readSddl(filePath) {
    const sddl = runWindowsAclPowerShell(
      [
        "$acl = Get-Acl -LiteralPath $env:TOKEN_EYES_ACL_TARGET",
        "if ($null -eq $acl -or [String]::IsNullOrWhiteSpace($acl.Sddl)) { throw 'empty ACL descriptor' }",
        "[Console]::Out.Write($acl.Sddl)",
      ].join("; "),
      { TOKEN_EYES_ACL_TARGET: filePath, TOKEN_EYES_ACL_MODE: "read" },
    );
    if (!/^O:[^\r\n]*G:[^\r\n]*D:[^\r\n]*$/.test(sddl)) {
      throw new Error("Windows ACL descriptor output was invalid");
    }
    return sddl;
  },
  copyAndVerify(sourcePath, tempPath) {
    const fingerprint = runWindowsAclPowerShell(
      [
        "$sourceAcl = Get-Acl -LiteralPath $env:TOKEN_EYES_ACL_TARGET",
        "Set-Acl -LiteralPath $env:TOKEN_EYES_ACL_TEMP -AclObject $sourceAcl",
        "$sourceSddl = (Get-Acl -LiteralPath $env:TOKEN_EYES_ACL_TARGET).Sddl",
        "$tempSddl = (Get-Acl -LiteralPath $env:TOKEN_EYES_ACL_TEMP).Sddl",
        "if ($sourceSddl -cne $tempSddl) { throw 'ACL descriptor mismatch' }",
        "$sha = [Security.Cryptography.SHA256]::Create()",
        "$hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sourceSddl))",
        "[Console]::Out.Write((($hash | ForEach-Object { $_.ToString('x2') }) -join ''))",
      ].join("; "),
      {
        TOKEN_EYES_ACL_TARGET: sourcePath,
        TOKEN_EYES_ACL_TEMP: tempPath,
        TOKEN_EYES_ACL_MODE: "copy",
      },
    );
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error("Windows ACL fingerprint was invalid");
    }
    return fingerprint;
  },
});

function readTargetIdentity(filePath, fsImpl, secrets) {
  let stat;
  try {
    stat = fsImpl.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw credentialError("credential_target_unavailable", "target", error, secrets);
  }
  if (stat.isSymbolicLink()) {
    throw stableCredentialError(
      "credential_symlink_unsupported",
      "target",
      "Credential file persistence does not replace vendor symlinks",
    );
  }
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

function writeCredentialJsonFileSync(filePath, value, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const windowsAcl = options.windowsAcl || defaultWindowsAcl;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const pid = options.pid ?? process.pid;
  const secrets = Array.isArray(options.secrets) ? options.secrets : [];
  const initialIdentity = readTargetIdentity(filePath, fsImpl, secrets);

  let originalSddl = null;
  if (platform === "win32") {
    const canCopyAcl = typeof windowsAcl?.copyAndVerify === "function";
    const canApplyAcl = typeof windowsAcl?.applySddl === "function";
    if (!initialIdentity || typeof windowsAcl?.readSddl !== "function" || (!canCopyAcl && !canApplyAcl)) {
      throw stableCredentialError(
        "credential_acl_unavailable",
        "acl",
        "Credential file persistence requires the existing Windows ACL",
      );
    }
    try {
      originalSddl = windowsAcl.readSddl(filePath);
      if (typeof originalSddl !== "string" || !originalSddl) {
        throw new Error("Windows ACL descriptor was empty");
      }
    } catch (error) {
      throw credentialError("credential_acl_unavailable", "acl", error, secrets);
    }
  }

  let valueToWrite = value;
  const effectiveSecrets = [...secrets, ...credentialSecretsFromValue(value)];
  if (options.mergeLatest === true) {
    try {
      const latest = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
      if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
        throw new Error("Vendor credential file is not a JSON object");
      }
      const identityAfterRead = readTargetIdentity(filePath, fsImpl, effectiveSecrets);
      if (!sameIdentity(initialIdentity, identityAfterRead)) {
        throw stableCredentialError(
          "credential_target_changed",
          "target",
          "Credential target changed while reading the latest vendor JSON",
        );
      }
      effectiveSecrets.push(...credentialSecretsFromValue(latest));
      valueToWrite = { ...latest, ...value };
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("credential_")) {
        throw credentialError(error.code, error.stage || "read", error, effectiveSecrets);
      }
      throw credentialError("credential_read_failed", "read", error, effectiveSecrets);
    }
  }

  let serialized;
  try {
    serialized = `${JSON.stringify(valueToWrite, null, 2)}\n`;
  } catch (error) {
    throw credentialError("credential_write_failed", "write", error, effectiveSecrets);
  }

  const tempPath = `${filePath}.tmp.${pid}.${randomUUID()}`;
  let fd = null;
  let tempCreated = false;
  let renamed = false;
  let stage = "write";
  try {
    fd = fsImpl.openSync(tempPath, "wx", 0o600);
    tempCreated = true;
    fsImpl.writeFileSync(fd, serialized, { encoding: "utf8" });

    stage = "sync";
    fsImpl.fsyncSync(fd);

    stage = "close";
    fsImpl.closeSync(fd);
    fd = null;

    if (platform === "win32") {
      stage = "acl";
      if (typeof windowsAcl.copyAndVerify === "function") {
        const copiedFingerprint = windowsAcl.copyAndVerify(filePath, tempPath);
        if (copiedFingerprint !== sddlFingerprint(originalSddl)) {
          throw stableCredentialError(
            "credential_acl_mismatch",
            "acl",
            "Credential ACL fingerprint changed before atomic replace",
          );
        }
      } else {
        windowsAcl.applySddl(tempPath, originalSddl);
      }
      const tempSddl = windowsAcl.readSddl(tempPath);
      if (tempSddl !== originalSddl) {
        throw stableCredentialError(
          "credential_acl_mismatch",
          "acl",
          "Credential temp ACL did not exactly match the vendor credential ACL",
        );
      }
    }

    if (platform === "win32") {
      stage = "target";
      const currentSddl = windowsAcl.readSddl(filePath);
      const tempSddl = windowsAcl.readSddl(tempPath);
      if (currentSddl !== originalSddl || tempSddl !== originalSddl) {
        throw stableCredentialError(
          "credential_target_changed",
          "target",
          "Credential target ACL changed before atomic replace",
        );
      }
    }
    stage = "target";
    const currentIdentity = readTargetIdentity(filePath, fsImpl, effectiveSecrets);
    if (!sameIdentity(initialIdentity, currentIdentity)) {
      throw stableCredentialError(
        "credential_target_changed",
        "target",
        "Credential target changed before atomic replace",
      );
    }

    stage = "rename";
    fsImpl.renameSync(tempPath, filePath);
    renamed = true;
  } catch (error) {
    if (fd !== null) {
      try {
        fsImpl.closeSync(fd);
      } catch (_closeError) {
        // Best effort only; the original operation and stage remain authoritative.
      }
    }
    if (tempCreated && !renamed) {
      try {
        fsImpl.unlinkSync(tempPath);
      } catch (_unlinkError) {
        // Never broaden cleanup to any path other than this invocation's unique temp.
      }
    }
    if (typeof error?.code === "string" && error.code.startsWith("credential_")) {
      throw credentialError(error.code, error.stage || stage, error, effectiveSecrets);
    }
    throw credentialError("credential_write_failed", stage, error, effectiveSecrets);
  }

  return { value: valueToWrite };
}

module.exports = {
  redactSecrets,
  writeCredentialJsonFileSync,
};
