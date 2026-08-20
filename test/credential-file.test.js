const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

let writeCredentialJsonFileSync;
try {
  ({ writeCredentialJsonFileSync } = require("../src/lib/credential-file"));
} catch (error) {
  // Keep every behavioral test runnable before the new production module exists.
  // Each call still fails through an assertion with the named test as its owner.
  writeCredentialJsonFileSync = () => {
    throw error;
  };
}

const SYNTHETIC_SECRETS = [
  "synthetic-access-token-task9",
  "synthetic-refresh-token-task9",
  "synthetic-id-token-task9",
];

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function injectedFailure(stage) {
  const error = new Error(`injected ${stage} failure ${SYNTHETIC_SECRETS.join(" ")}`);
  error.code = "EIO";
  return error;
}

function makeFsAdapter({ targetPath, failStage = null, raceTarget = false } = {}) {
  const calls = [];
  const unlinked = [];
  let closeFailures = 0;
  let targetLstats = 0;
  const adapter = {
    lstatSync(filePath) {
      calls.push(["lstat", filePath]);
      const stat = fs.lstatSync(filePath);
      if (filePath === targetPath) {
        targetLstats += 1;
        if (raceTarget && targetLstats > 1) {
          return {
            dev: stat.dev,
            ino: `${stat.ino}-changed`,
            isSymbolicLink: () => false,
          };
        }
      }
      return stat;
    },
    openSync(filePath, flags, mode) {
      calls.push(["open", filePath, flags, mode]);
      return fs.openSync(filePath, flags, mode);
    },
    writeFileSync(fd, data, options) {
      calls.push(["write", fd]);
      if (failStage === "write") throw injectedFailure("write");
      return fs.writeFileSync(fd, data, options);
    },
    fsyncSync(fd) {
      calls.push(["sync", fd]);
      if (failStage === "sync") throw injectedFailure("sync");
      return fs.fsyncSync(fd);
    },
    closeSync(fd) {
      calls.push(["close", fd]);
      if (failStage === "close" && closeFailures++ === 0) {
        throw injectedFailure("close");
      }
      return fs.closeSync(fd);
    },
    linkSync(existingPath, newPath) {
      calls.push(["link", existingPath, newPath]);
      return fs.linkSync(existingPath, newPath);
    },
    renameSync(sourcePath, destinationPath) {
      calls.push(["rename", sourcePath, destinationPath]);
      if (failStage === "rename") throw injectedFailure("rename");
      return fs.renameSync(sourcePath, destinationPath);
    },
    unlinkSync(filePath) {
      calls.push(["unlink", filePath]);
      unlinked.push(filePath);
      return fs.unlinkSync(filePath);
    },
  };
  return { adapter, calls, unlinked };
}

function makeMatchingWindowsAcl(
  targetPath,
  calls,
  { mismatchTemp = false, failRead = false } = {},
) {
  return {
    readSddl(filePath) {
      calls.push(["acl-read", filePath]);
      if (failRead) throw new Error("ACL capability unavailable");
      if (filePath === targetPath) {
        return "O:SYG:SYD:P(A;;FA;;;SY)";
      }
      return mismatchTemp
        ? "O:SYG:SYD:P(A;;FA;;;WD)"
        : "O:SYG:SYD:P(A;;FA;;;SY)";
    },
    applySddl(filePath, sddl) {
      calls.push(["acl-apply", filePath, sddl]);
    },
  };
}

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function assertOriginalAndOnlySentinelRemain({ dir, targetPath, originalBytes, sentinelPath }) {
  const after = fs.readFileSync(targetPath);
  assert.deepEqual(after, originalBytes, "the vendor credential file must remain byte-for-byte unchanged");
  assert.doesNotThrow(() => JSON.parse(after.toString("utf8")), "the old credential JSON must remain parseable");
  assert.equal(fs.readFileSync(sentinelPath, "utf8"), "unrelated-temp-sentinel");
  const tempNames = fs.readdirSync(dir).filter((name) => name.includes(".tmp."));
  assert.deepEqual(tempNames, [path.basename(sentinelPath)], "cleanup must remove only this call's temp file");
}

describe("writeCredentialJsonFileSync failure safety", () => {
  for (const platform of ["linux", "win32"]) {
    for (const stage of ["write", "sync", "close", "rename"]) {
      it(`${platform}: ${stage} failure preserves old bytes, JSON, and unrelated temp`, () => {
        const dir = makeTempDir(`token-eyes-credential-${platform}-${stage}-`);
        try {
          const targetPath = path.join(dir, "credentials.json");
          const sentinelPath = `${targetPath}.tmp.unrelated`;
          const originalBytes = Buffer.from('{"access_token":"old","unknown":{"keep":true}}\n', "utf8");
          fs.writeFileSync(targetPath, originalBytes);
          fs.writeFileSync(sentinelPath, "unrelated-temp-sentinel");
          const { adapter, calls, unlinked } = makeFsAdapter({ targetPath, failStage: stage });
          const windowsAcl = makeMatchingWindowsAcl(targetPath, calls);

          const error = captureError(() => writeCredentialJsonFileSync(
            targetPath,
            { access_token: SYNTHETIC_SECRETS[0] },
            {
              fsImpl: adapter,
              platform,
              windowsAcl,
              pid: 4242,
              randomUUID: () => "11111111-2222-4333-8444-555555555555",
              secrets: SYNTHETIC_SECRETS,
            },
          ));

          assert.equal(error?.stage, stage);
          for (const secret of SYNTHETIC_SECRETS) {
            assert.equal(String(error?.message).includes(secret), false, `${stage} error must redact the exact token`);
          }
          assert.match(String(error?.message), /\[REDACTED\]/);
          assertOriginalAndOnlySentinelRemain({ dir, targetPath, originalBytes, sentinelPath });
          assert.equal(unlinked.includes(targetPath), false, "the target must never be unlinked");

          const operationNames = calls.map(([name]) => name);
          assert.ok(operationNames.indexOf("write") < operationNames.indexOf("sync") || stage === "write");
          assert.ok(operationNames.indexOf("sync") < operationNames.indexOf("close") || ["write", "sync"].includes(stage));
          if (stage === "rename") {
            assert.ok(operationNames.indexOf("close") < operationNames.indexOf("rename"));
            if (platform === "win32") {
              assert.ok(operationNames.indexOf("acl-apply") < operationNames.indexOf("rename"));
            }
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("writeCredentialJsonFileSync atomic contract", () => {
  it("uses a same-directory PID+UUID temp, mode 0600, and write-sync-close-rename order", () => {
    const dir = makeTempDir("token-eyes-credential-order-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      fs.writeFileSync(targetPath, '{"old":true}\n');
      const { adapter, calls } = makeFsAdapter({ targetPath });
      const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

      writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "linux",
        pid: 7777,
        randomUUID: () => uuid,
      });

      const openCall = calls.find(([name]) => name === "open");
      assert.ok(openCall);
      assert.equal(path.dirname(openCall[1]), dir);
      assert.match(path.basename(openCall[1]), /credentials\.json\.tmp\./);
      assert.ok(path.basename(openCall[1]).includes("7777"));
      assert.ok(path.basename(openCall[1]).includes(uuid));
      assert.equal(openCall[2], "wx");
      assert.equal(openCall[3], 0o600);
      const names = calls.map(([name]) => name);
      assert.ok(names.indexOf("write") < names.indexOf("sync"));
      assert.ok(names.indexOf("sync") < names.indexOf("close"));
      assert.ok(names.indexOf("close") < names.indexOf("rename"));
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, "utf8")), { updated: true });
      assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp.")), false);
      if (process.platform !== "win32") {
        assert.equal(fs.statSync(targetPath).mode & 0o777, 0o600);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a vendor symlink before opening a temp and leaves the link untouched", () => {
    const dir = makeTempDir("token-eyes-credential-symlink-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      const realTargetPath = path.join(dir, "vendor-real.json");
      fs.writeFileSync(targetPath, '{"old":true}\n');
      fs.writeFileSync(realTargetPath, '{"vendor":true}\n');
      const { adapter, calls } = makeFsAdapter({ targetPath });
      adapter.lstatSync = (filePath) => {
        calls.push(["lstat", filePath]);
        if (filePath === targetPath) {
          return { dev: 1, ino: 2, isSymbolicLink: () => true };
        }
        return fs.lstatSync(filePath);
      };

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "linux",
      }));

      assert.equal(error?.code, "credential_symlink_unsupported");
      assert.equal(calls.some(([name]) => name === "open"), false);
      assert.equal(fs.readFileSync(targetPath, "utf8"), '{"old":true}\n');
      assert.equal(fs.readFileSync(realTargetPath, "utf8"), '{"vendor":true}\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts raw, URI-encoded, and form-encoded token surfaces from errors", () => {
    const dir = makeTempDir("token-eyes-credential-encoded-redaction-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      fs.writeFileSync(targetPath, '{"old":true}\n');
      const secret = "synthetic token+/=?&% task9";
      const uriEncoded = encodeURIComponent(secret);
      const uriEncodedLower = uriEncoded.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase());
      let encodedPartIndex = 0;
      const uriEncodedMixed = uriEncoded.replace(
        /%[0-9A-F]{2}/g,
        (part) => encodedPartIndex++ % 2 === 0 ? part.toLowerCase() : part,
      );
      const formEncoded = new URLSearchParams({ token: secret }).toString().slice("token=".length);
      const formEncodedLower = formEncoded.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase());
      const { adapter } = makeFsAdapter({ targetPath });
      adapter.renameSync = () => {
        throw new Error(`encoded failure ${uriEncoded} ${uriEncodedLower} ${uriEncodedMixed} ${formEncoded} ${formEncodedLower}`);
      };

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "linux",
        secrets: [secret],
      }));

      assert.equal(error?.stage, "rename");
      assert.match(error?.message, /\[REDACTED\]/);
      for (const surface of [secret, uriEncoded, uriEncodedLower, uriEncodedMixed, formEncoded, formEncodedLower]) {
        assert.equal(error.message.includes(surface), false, `must redact ${surface}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeCredentialJsonFileSync Windows ACL fail-closed checks", () => {
  it("uses rename as the final Windows commit with no backup or post-commit operation", () => {
    const dir = makeTempDir("token-eyes-credential-final-commit-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      fs.writeFileSync(targetPath, '{"old":true}\n');
      const { adapter, calls } = makeFsAdapter({ targetPath });
      const windowsAcl = makeMatchingWindowsAcl(targetPath, calls);

      writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "win32",
        windowsAcl,
      });

      assert.equal(calls.some(([name]) => name === "link"), false, "Windows commit must not create a rollback hard link");
      const renameIndex = calls.findIndex(([name]) => name === "rename");
      assert.notEqual(renameIndex, -1);
      assert.deepEqual(calls.slice(renameIndex + 1), [], "rename must be the final fallible fs/ACL operation");
      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, "utf8")), { updated: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does zero temp writes when the original full SDDL cannot be read", () => {
    const dir = makeTempDir("token-eyes-credential-acl-capability-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      const originalBytes = Buffer.from('{"old":true}\n');
      fs.writeFileSync(targetPath, originalBytes);
      const { adapter, calls } = makeFsAdapter({ targetPath });
      const windowsAcl = makeMatchingWindowsAcl(targetPath, calls, { failRead: true });

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "win32",
        windowsAcl,
      }));

      assert.equal(error?.code, "credential_acl_unavailable");
      assert.equal(calls.some(([name]) => name === "open"), false);
      assert.deepEqual(fs.readFileSync(targetPath), originalBytes);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a broader temp SDDL before replace and preserves the old target", () => {
    const dir = makeTempDir("token-eyes-credential-acl-mismatch-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      const originalBytes = Buffer.from('{"old":true}\n');
      fs.writeFileSync(targetPath, originalBytes);
      const { adapter, calls, unlinked } = makeFsAdapter({ targetPath });
      const windowsAcl = makeMatchingWindowsAcl(targetPath, calls, { mismatchTemp: true });

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "win32",
        windowsAcl,
      }));

      assert.equal(error?.code, "credential_acl_mismatch");
      assert.equal(calls.some(([name]) => name === "rename"), false);
      assert.equal(unlinked.includes(targetPath), false);
      assert.deepEqual(fs.readFileSync(targetPath), originalBytes);
      assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp.")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aborts when target dev/ino changes before replace", () => {
    const dir = makeTempDir("token-eyes-credential-race-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      const originalBytes = Buffer.from('{"old":true}\n');
      fs.writeFileSync(targetPath, originalBytes);
      const { adapter, calls } = makeFsAdapter({ targetPath, raceTarget: true });
      const windowsAcl = makeMatchingWindowsAcl(targetPath, calls);

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "win32",
        windowsAcl,
      }));

      assert.equal(error?.code, "credential_target_changed");
      assert.equal(calls.some(([name]) => name === "rename"), false);
      assert.deepEqual(fs.readFileSync(targetPath), originalBytes);
      assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp.")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite a vendor inode replacement during final pre-commit ACL verification", () => {
    const dir = makeTempDir("token-eyes-credential-precommit-race-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      const vendorBytes = Buffer.from('{"vendor_generation":2,"preserve":true}\n');
      fs.writeFileSync(targetPath, '{"vendor_generation":1}\n');
      const { adapter, calls } = makeFsAdapter({ targetPath });
      let targetAclReads = 0;
      const windowsAcl = {
        readSddl(filePath) {
          calls.push(["acl-read", filePath]);
          if (filePath === targetPath && ++targetAclReads === 2) {
            const vendorTempPath = `${targetPath}.vendor-replace`;
            fs.writeFileSync(vendorTempPath, vendorBytes);
            fs.renameSync(vendorTempPath, targetPath);
          }
          return "O:SYG:SYD:P(A;;FA;;;SY)";
        },
        applySddl(filePath, sddl) {
          calls.push(["acl-apply", filePath, sddl]);
        },
      };

      const error = captureError(() => writeCredentialJsonFileSync(targetPath, { updated: true }, {
        fsImpl: adapter,
        platform: "win32",
        windowsAcl,
      }));

      assert.equal(error?.code, "credential_target_changed");
      assert.equal(calls.some(([name]) => name === "link"), false);
      assert.equal(calls.some(([name]) => name === "rename"), false);
      assert.deepEqual(fs.readFileSync(targetPath), vendorBytes);
      assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp.")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function runPowerShell(script, args = []) {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$modulePath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'",
    "Import-Module -Name $modulePath -Force -ErrorAction Stop",
    "$targetPath = $env:TOKEN_EYES_ACL_TARGET",
    script,
  ].join("; ");
  const result = cp.spawnSync(
    executable,
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    {
      encoding: "utf8",
      env: {
        SystemRoot: systemRoot,
        windir: systemRoot,
        ComSpec: process.env.ComSpec || path.join(systemRoot, "System32", "cmd.exe"),
        TOKEN_EYES_ACL_TARGET: args[0],
      },
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (result.status !== 0) {
    throw new Error(`PowerShell ACL fixture failed with status ${result.status}`);
  }
  return String(result.stdout || "").trim();
}

(process.platform === "win32" ? describe : describe.skip)("writeCredentialJsonFileSync real Windows replace", () => {
  it("replaces an existing file without changing its full SDDL", () => {
    const dir = makeTempDir("token-eyes-credential-real-win-");
    try {
      const targetPath = path.join(dir, "credentials.json");
      fs.writeFileSync(targetPath, '{"old":true}\n');
      const parentSddl = runPowerShell("(Get-Acl -LiteralPath (Split-Path -Parent $targetPath)).Sddl", [targetPath]);
      runPowerShell([
        "$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
        "$acl = Get-Acl -LiteralPath $targetPath",
        "$acl.SetAccessRuleProtection($true, $false)",
        "foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }",
        "$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')",
        "[void]$acl.AddAccessRule($rule)",
        "Set-Acl -LiteralPath $targetPath -AclObject $acl",
      ].join("; "), [targetPath]);
      const getSddl = () => runPowerShell("(Get-Acl -LiteralPath $targetPath).Sddl", [targetPath]);
      const beforeSddl = getSddl();
      assert.notEqual(beforeSddl, parentSddl, "fixture target ACL must differ from its parent directory ACL");

      writeCredentialJsonFileSync(targetPath, { updated: true });

      assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, "utf8")), { updated: true });
      assert.equal(getSddl(), beforeSddl, "replace-over-existing must preserve the complete SDDL");
      assert.equal(fs.readdirSync(dir).some((name) => name.includes(".tmp.")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
