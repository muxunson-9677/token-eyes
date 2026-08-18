"use strict";

require("./home-shim.cjs");

const localApi = require("../../src/lib/local-api");

module.exports = {
  ...localApi,
  createLocalApiHandler(options = {}) {
    localApi.validateLocalApiTestPaths(options, { context: "test local API helper" });
    const handler = localApi.createLocalApiHandler(options);
    const wrapped = async (req, res, url) => {
      req[Symbol.for("tokentracker.test.localApiSecurityBypass")] = true;
      return handler(req, res, url);
    };
    Object.assign(wrapped, handler);
    return wrapped;
  },
};
