"use strict";

const path = require("node:path");

const initModulePath = path.resolve(process.argv[2] || "");
const initArgs = process.argv.slice(3);
const { cmdInit } = require(initModulePath);

cmdInit(initArgs, { firstSyncRunner: async () => null }).catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exitCode = 1;
});
