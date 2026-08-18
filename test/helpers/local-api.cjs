"use strict";

const os = require("node:os");
const path = require("node:path");

require("./home-shim.cjs");

const localApi = require("../../src/lib/local-api");

module.exports = {
  ...localApi,
  createLocalApiHandler(options = {}) {
    if (!options.trackerDataDir) {
      throw new Error("test local API helper requires an explicit trackerDataDir");
    }
    const trackerDataDir = path.resolve(options.trackerDataDir);
    const tempRoot = path.resolve(os.tmpdir());
    const relative = path.relative(tempRoot, trackerDataDir);
    if (!path.isAbsolute(options.trackerDataDir) || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("test local API helper trackerDataDir must be an absolute path under the OS temporary directory");
    }
    const handler = localApi.createLocalApiHandler(options);
    const wrapped = async (req, res, url) => {
      req[Symbol.for("tokentracker.test.localApiSecurityBypass")] = true;
      return handler(req, res, url);
    };
    Object.assign(wrapped, handler);
    return wrapped;
  },
};
