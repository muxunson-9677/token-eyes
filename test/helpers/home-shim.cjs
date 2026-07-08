"use strict";

/**
 * Test-only os.homedir() shim that honors process.env.HOME on ALL platforms.
 *
 * Why
 * ---
 * Node's `os.homedir()` reads `USERPROFILE` on Windows and `HOME` on POSIX.
 * Many test helpers isolate the home directory by setting `process.env.HOME`
 * to a temp dir (see the ~17 test files that do `process.env.HOME = tmp`).
 * On Windows that leaves `os.homedir()` returning the real user's home
 * (`C:\Users\<user>`), so fixtures leak into the real `~/.tokentracker` and
 * tests fail with assertions about cookie/queue/config paths.
 *
 * This shim makes `os.homedir()` return `process.env.HOME` when it is set,
 * falling back to the original implementation otherwise. The override only
 * affects the test process that requires this module; production code is
 * untouched. On POSIX `HOME` is normally the real home anyway, so behavior is
 * unchanged there.
 *
 * Usage
 * -----
 * Add as the FIRST require in a test file that isolates HOME:
 *   require("./helpers/home-shim.cjs");
 */

const os = require("node:os");

const _originalHomedir = os.homedir;
os.homedir = function homedirWithHomeOverride() {
  const home = process.env.HOME;
  if (home && typeof home === "string" && home.length > 0) return home;
  return _originalHomedir.call(os);
};

module.exports = {};
