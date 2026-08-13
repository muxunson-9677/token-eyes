"use strict";

// Aggregates all per-provider limit-account adapters. Each adapter maps a
// provider's authorized CLI/desktop login into one or more LimitAccountV2
// entries. Orchestration in limit-accounts.js collects them into a matrix.
//
// Current Token Eyes rate-limit sources expose one authorized login per
// provider. The matrix UI already renders multiple rows when an adapter
// returns them; dual-account providers stay experimental until real
// read-only verification exists (see docs/dev-notes/limit-account-provider-capabilities.md).

const codexAdapter = require("./codex");
const claudeAdapter = require("./claude");
const cursorAdapter = require("./cursor");
const kimiAdapter = require("./kimi");
const geminiAdapter = require("./gemini");
const kiroAdapter = require("./kiro");
const antigravityAdapter = require("./antigravity");
const copilotAdapter = require("./copilot");
const grokAdapter = require("./grok");
const zedAdapter = require("./zed");

function getDefaultAdapters() {
  return {
    codex: codexAdapter,
    claude: claudeAdapter,
    cursor: cursorAdapter,
    kimi: kimiAdapter,
    gemini: geminiAdapter,
    kiro: kiroAdapter,
    antigravity: antigravityAdapter,
    copilot: copilotAdapter,
    grok: grokAdapter,
    zed: zedAdapter,
  };
}

module.exports = {
  getDefaultAdapters,
  codexAdapter,
  claudeAdapter,
  cursorAdapter,
  kimiAdapter,
  geminiAdapter,
  kiroAdapter,
  antigravityAdapter,
  copilotAdapter,
  grokAdapter,
  zedAdapter,
};
