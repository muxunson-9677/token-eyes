"use strict";

/**
 * Test-only SQLite helper built on Node's built-in `node:sqlite` module.
 *
 * Why this exists
 * ---------------
 * Many parser tests build SQLite fixture databases by shelling out to the
 * external `sqlite3` CLI via `execFileSync("sqlite3", [dbPath, sql])`. On
 * machines without `sqlite3.exe` on PATH (common on Windows), every such call
 * throws `spawn sqlite3 ENOENT` and the test fails — not because the code
 * under test is broken, but because a test-setup dependency is missing. That
 * produced dozens of假失败 (false failures) that masked real regressions.
 *
 * The production reader (`src/lib/sqlite-reader.js`) already falls back from
 * the sqlite3 CLI to `node:sqlite`. This helper gives tests the same
 * fallback for fixture *creation*, so the suite no longer depends on an
 * external binary.
 *
 * Node 22+ ships `node:sqlite` (DatabaseSync) as a built-in. The project
 * requires Node 22+ (see engines in package.json).
 *
 * Return contract
 * ---------------
 * `runSql(dbPath, sql)` mirrors sqlite3 CLI stdout so existing call sites that
 * do `execFileSync("sqlite3", [dbPath, sql]).toString().trim()` keep working
 * unchanged:
 *   - SELECT / WITH: returns the first column of each row joined by "\n"
 *     (matches `sqlite3 db "select ..."` default mode, one value per line).
 *   - DDL / DML (CREATE / INSERT / UPDATE / DELETE / PRAGMA / BEGIN / COMMIT):
 *     returns "" (matches sqlite3 CLI which prints nothing for these).
 *
 * `execSqlScript(dbPath, sql)` runs a multi-statement script (e.g. a BEGIN…
 * COMMIT block piped via stdin in the original CLI call) and returns "".
 */

let DatabaseSyncRef = null;
let nodeSqliteUnavailable = null;

function loadDatabaseSync() {
  if (DatabaseSyncRef) return DatabaseSyncRef;
  if (nodeSqliteUnavailable) throw nodeSqliteUnavailable;
  try {
    // require("node:sqlite") throws on Node < 22.5 or when the built-in is
    // disabled (--no-experimental-sqlite). We rethrow that error to callers.
    const mod = require("node:sqlite");
    const DatabaseSync = mod && mod.DatabaseSync;
    if (typeof DatabaseSync !== "function") {
      throw new Error("node:sqlite DatabaseSync is not available in this build");
    }
    DatabaseSyncRef = DatabaseSync;
    return DatabaseSyncRef;
  } catch (err) {
    nodeSqliteUnavailable = err;
    throw err;
  }
}

function isNodeSqliteAvailable() {
  try {
    loadDatabaseSync();
    return true;
  } catch {
    return false;
  }
}

function runSql(dbPath, sql) {
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(dbPath);
  try {
    const trimmed = String(sql).trim();
    if (/^(?:select|with)\s/i.test(trimmed)) {
      const rows = db.prepare(trimmed).all();
      return rows
        .map((row) => {
          const v = Object.values(row)[0];
          return v == null ? "" : String(v);
        })
        .join("\n");
    }
    // DDL / DML — may contain multiple statements separated by ";".
    db.exec(trimmed);
    return "";
  } finally {
    db.close();
  }
}

function execSqlScript(dbPath, sql) {
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(String(sql));
    return "";
  } finally {
    db.close();
  }
}

/**
 * Build a drop-in replacement for `execFileSync` that routes `sqlite3` calls
 * to `node:sqlite` and delegates everything else to the real `execFileSync`.
 *
 * Used by tests that inject `execFileSync` into the code under test (e.g.
 * `importScip({ deps: { execFileSync } })`) so the production code path still
 * "calls sqlite3" but is serviced by the built-in instead of the CLI.
 *
 * Honors the two call shapes the source uses:
 *   - execFileSync("sqlite3", ["-version"], { stdio: "ignore" }) → returns ""
 *     (pretends the CLI is present so availability checks pass)
 *   - execFileSync("sqlite3", [dbPath], { input: sqlScript }) → runs the
 *     multi-statement script against the DB, returns ""
 *   - execFileSync("sqlite3", [dbPath, sql]) → runs single statement,
 *     returns scalar string (see runSql)
 */
function makeSqliteShimExecFileSync(realExecFileSync) {
  return function sqliteShimExecFileSync(cmd, args, opts) {
    const arg0 = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const isSqlite3 = cmd === "sqlite3" || (opts && opts.sqlite3Path && cmd === opts.sqlite3Path);
    if (isSqlite3) {
      if (arg0 === "-version" || arg0 === "--version") {
        return Buffer.from("");
      }
      // Pipe-via-stdin shape: execFileSync("sqlite3", [dbPath], { input: sql })
      if (opts && typeof opts.input === "string" && (arg0 && arg0 !== "-version")) {
        execSqlScript(arg0, opts.input);
        return Buffer.from("");
      }
      // Arg shape: execFileSync("sqlite3", [dbPath, sql])
      if (arg0 && args.length >= 2) {
        return Buffer.from(runSql(arg0, args[1]));
      }
      return Buffer.from("");
    }
    return realExecFileSync(cmd, args, opts);
  };
}

module.exports = {
  runSql,
  execSqlScript,
  isNodeSqliteAvailable,
  makeSqliteShimExecFileSync,
};
