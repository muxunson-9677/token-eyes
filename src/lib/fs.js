const fs = require("node:fs/promises");
const path = require("node:path");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmp, content, { encoding: "utf8" });
  await fs.rename(tmp, filePath);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

async function readJsonStrict(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { status: "ok", value: JSON.parse(raw), error: null };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return { status: "missing", value: null, error: err };
    }
    if (err && err.name === "SyntaxError") {
      return { status: "invalid", value: null, error: err };
    }
    return { status: "error", value: null, error: err };
  }
}

async function writeJson(filePath, obj) {
  await writeFileAtomic(filePath, JSON.stringify(obj, null, 2) + "\n");
}

async function chmod600IfPossible(filePath) {
  try {
    await fs.chmod(filePath, 0o600);
  } catch (_e) {}
}

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

async function openWindowsLockGate(lockPath) {
  const key = require("node:crypto").createHash("sha256").update(require("node:path").resolve(lockPath).toLowerCase()).digest("hex");
  const server = require("node:net").createServer(socket => socket.destroy());
  const acquired = await new Promise((resolve, reject) => {
    server.once("error", error => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    server.listen(`\\\\.\\pipe\\token-eyes-sync-${key}`, () => resolve(true));
  });
  if (!acquired) return null;
  server.unref();
  return () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function openLock(lockPath, { quietIfLocked, coalesce = false } = {}) {
  const pendingPath = `${lockPath}.pending`;
  if (coalesce) await fs.writeFile(pendingPath, "");
  // Kernel-owned Windows IPC serializes creation and stale-file recovery together.
  // A crash releases the gate without another stale file needing recovery.
  const closeGate = process.platform === "win32" ? await openWindowsLockGate(lockPath) : async () => {};
  if (!closeGate) {
    if (!quietIfLocked) process.stdout.write("Another sync is already running.\n");
    return null;
  }
  let transferred = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const owner = { pid: process.pid, token: require("node:crypto").randomUUID() };
      let handle;
      try {
        handle = await fs.open(lockPath, "wx");
        await handle.writeFile(JSON.stringify(owner));
        if (coalesce) await fs.unlink(pendingPath).catch(error => { if (error.code !== "ENOENT") throw error; });
        transferred = true;
        return {
          async release() {
            try {
              await handle.close();
              const current = await readJsonStrict(lockPath);
              if (current.status === "ok" && current.value?.token === owner.token) {
                await fs.unlink(lockPath).catch(error => { if (error.code !== "ENOENT") throw error; });
              }
            } finally {
              await closeGate();
            }
            return coalesce && await fs.stat(pendingPath).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
          },
        };
      } catch (error) {
        if (handle) { await handle.close(); await fs.unlink(lockPath); throw error; }
        if (error.code !== "EEXIST") throw error;
        const current = await readJsonStrict(lockPath);
        if (current.status === "missing") continue;
        let stale = false;
        if (current.status === "ok" && Number.isInteger(current.value?.pid) && current.value.pid > 0) {
          try { process.kill(current.value.pid, 0); }
          catch (ownerError) { stale = ownerError.code === "ESRCH"; }
        } else if (current.status === "invalid") {
          // An empty file can be an owner still publishing its identity; allow a grace period.
          const stat = await fs.stat(lockPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
          if (!stat) continue;
          stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
        } else if (current.status === "error") {
          throw current.error;
        }
        if (stale) {
          // Recheck the observed file before recovery; Windows also holds the kernel gate.
          const latest = await readJsonStrict(lockPath);
          if (JSON.stringify(latest.value) !== JSON.stringify(current.value) || latest.status !== current.status) continue;
          await fs.unlink(lockPath).catch(error => { if (error.code !== "ENOENT") throw error; });
          continue;
        }
        if (!quietIfLocked) process.stdout.write("Another sync is already running.\n");
        return null;
      }
    }
    return null;
  } finally {
    if (!transferred) await closeGate();
  }
}

module.exports = {
  ensureDir,
  writeFileAtomic,
  readJson,
  readJsonStrict,
  writeJson,
  chmod600IfPossible,
  openLock,
};
