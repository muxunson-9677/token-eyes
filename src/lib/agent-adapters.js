"use strict";

const { listProviderIdsByCapability } = require("./provider-capabilities");

/**
 * Central registry of known AI tool adapters (agent sources).
 *
 * Each entry records non-sensitive metadata used to wire parsers into sync,
 * surface providers in status/diagnostics, populate Usage Limits preferences,
 * and allow users to override data-root paths for select providers.
 *
 * This module does NOT execute parsers or mutate queue state 鈥?it only
 * serves as the single source of truth for adapter metadata.
 */

/**
 * @typedef {Object} AgentAdapter
 * @property {string} id            - Stable lowercase registry id.
 * @property {string} displayName  - UI / status display name.
 * @property {string} queueSource   - Value written to queue.jsonl `source` field.
 * @property {string} family        - Vendor or protocol family.
 * @property {string} collectionMode - How tokens are collected.
 * @property {string|null} parserExport  - rollout.js export name of the parseIncremental fn.
 * @property {string[]} resolverExports  - rollout.js export names of file-discovery fns.
 * @property {boolean} statusSurface     - Should appear in `tracker status`.
 * @property {boolean} diagnosticsSurface - Should appear in diagnostics output.
 * @property {string|null} pathOverrideKey - Key in dataDirectories config; null if not overridable.
 * @property {boolean} accountLevel      - Account-level source (tokens aggregated across machines).
 * @property {string} [notes]            - Maintenance notes for future contributors.
 */

/** @type {AgentAdapter[]} */
const AGENT_ADAPTERS = [
  {
    id: "claude",
    displayName: "Claude Code",
    queueSource: "claude",
    family: "anthropic",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseClaudeIncremental",
    resolverExports: ["listClaudeProjectFiles"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: "claude",
    accountLevel: false,
    notes: "Claude Code sessions under ~/.claude/projects/.",
  },
  {
    id: "codex",
    displayName: "Codex",
    queueSource: "codex",
    family: "openai",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseRolloutIncremental",
    resolverExports: ["listRolloutFiles", "listRolloutFilesDeep"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: "codex",
    accountLevel: false,
    notes: "OpenAI Codex CLI sessions/ JSONL; archived_sessions is scanned with event dedup.",
  },
  {
    id: "every-code",
    displayName: "Every Code",
    queueSource: "every-code",
    family: "openai",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseRolloutIncremental",
    resolverExports: ["listRolloutFiles", "listRolloutFilesDeep"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "EveryCode CLI (OpenAI Codex fork); shares parseRolloutIncremental with codex.",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    queueSource: "cursor",
    family: "unknown",
    collectionMode: "cloud_api",
    parserExport: "parseCursorApiIncremental",
    resolverExports: [],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: "cursor",
    accountLevel: true,
    notes: "Cursor API (CSV fetch); account-level because it is a cloud-backed subscription.",
  },
  {
    id: "trae",
    displayName: "Trae",
    queueSource: "trae",
    family: "bytedance",
    collectionMode: "passive_log",
    parserExport: "parseTraeIncremental",
    resolverExports: ["listTraeDataRoots"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: "trae",
    accountLevel: false,
    notes: "Trae CN local ai-agent store (decrypted DB or token_usage.jsonl export).",
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    queueSource: "gemini",
    family: "google",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseGeminiIncremental",
    resolverExports: ["listGeminiSessionFiles"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Google Gemini CLI (CLI hook + passive log reader).",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    queueSource: "opencode",
    family: "opencode",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseOpencodeIncremental",
    resolverExports: ["listOpencodeMessageFiles"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "OpenCode CLI (SQLite message store + JSON file fallback).",
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    queueSource: "openclaw",
    family: "openclaw",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseOpenclawIncremental",
    resolverExports: [],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: "openclaw",
    accountLevel: false,
    notes: "OpenClaw session plugin / hook; triggered by --from-openclaw flag.",
  },
  {
    id: "kilo-cli",
    displayName: "Kilo CLI",
    queueSource: "kilo-cli",
    family: "kilo",
    collectionMode: "sqlite",
    parserExport: "parseOpencodeDbIncremental",
    resolverExports: [],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Kilo CLI (kilo.ai); reuses parseOpencodeDbIncremental with separate cursor namespace.",
  },
  {
    id: "kilocode",
    displayName: "Kilo Code",
    queueSource: "kilocode",
    family: "vscode_extension",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseKilocodeIncremental",
    resolverExports: ["resolveKilocodeTaskFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Kilo Code VS Code extension (Cline-style ui_messages.json).",
  },
  {
    id: "roocode",
    displayName: "Roo Code",
    queueSource: "roocode",
    family: "vscode_extension",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseRoocodeIncremental",
    resolverExports: ["resolveRoocodeTaskFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Roo Code VS Code extension (Cline-derived; rooveterinaryinc.roo-cline).",
  },
  {
    id: "kiro",
    displayName: "Kiro",
    queueSource: "kiro",
    family: "kiro",
    collectionMode: "sqlite",
    parserExport: "parseKiroIncremental",
    resolverExports: ["resolveKiroDbPath", "resolveKiroJsonlPath"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Kiro IDE (SQLite + JSONL fallback); tokens merged transparently with kiro-cli.",
  },
  {
    id: "kiro-cli",
    displayName: "Kiro CLI",
    queueSource: "kiro-cli",
    family: "kiro",
    collectionMode: "sqlite",
    parserExport: "parseKiroCliIncremental",
    resolverExports: ["resolveKiroCliSessionFiles", "resolveKiroCliDbPath"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Kiro CLI; tokens approximated at 4 chars/token (credit-based billing). Merged under 'kiro' in dashboards.",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    queueSource: "hermes",
    family: "hermes",
    collectionMode: "sqlite",
    parserExport: "parseHermesIncremental",
    resolverExports: ["resolveHermesPath"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: "hermes",
    accountLevel: false,
    notes: "Hermes Agent SQLite sessions.",
  },
  {
    id: "kimi",
    displayName: "Kimi",
    queueSource: "kimi",
    family: "moonshot",
    collectionMode: "passive_log",
    parserExport: "parseKimiIncremental",
    resolverExports: ["resolveKimiWireFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Kimi (moonshot-ai/kimi) passive wire.jsonl reader.",
  },
  {
    id: "kimi-code",
    displayName: "Kimi Code",
    queueSource: "kimi-code",
    family: "moonshot",
    collectionMode: "passive_log",
    parserExport: "parseKimiCodeIncremental",
    resolverExports: ["resolveKimiCodeWireFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Moonshot-ai/kimi-code official CLI (different wire.jsonl path than kimi).",
  },
  {
    id: "codebuddy",
    displayName: "CodeBuddy",
    queueSource: "codebuddy",
    family: "tencent",
    collectionMode: "passive_log",
    parserExport: "parseCodebuddyIncremental",
    resolverExports: ["resolveCodebuddyProjectFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Tencent CodeBuddy CLI; passive ~/.codebuddy/projects/**/*.jsonl reader.",
  },
  {
    id: "omp",
    displayName: "oh-my-pi",
    queueSource: "omp",
    family: "unknown",
    collectionMode: "passive_log",
    parserExport: "parseOmpIncremental",
    resolverExports: ["resolveOmpSessionFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "oh-my-pi passive ~/.omp/agent/sessions/**/*.jsonl reader.",
  },
  {
    id: "pi",
    displayName: "pi",
    queueSource: "pi",
    family: "unknown",
    collectionMode: "passive_log",
    parserExport: "parsePiIncremental",
    resolverExports: ["resolvePiSessionFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "@mariozechner/pi-coding-agent passive ~/.pi/agent/sessions/**/*.jsonl reader.",
  },
  {
    id: "craft",
    displayName: "Craft Agents",
    queueSource: "craft",
    family: "unknown",
    collectionMode: "passive_log",
    parserExport: "parseCraftIncremental",
    resolverExports: ["resolveCraftSessionFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Craft Agents passive session.jsonl reader.",
  },
  {
    id: "grok",
    displayName: "Grok Build",
    queueSource: "grok",
    family: "xai",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseGrokBuildIncremental",
    resolverExports: ["resolveGrokBuildSessions"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "xAI Grok Build (passive session scan + optional hook).",
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    queueSource: "copilot",
    family: "github",
    collectionMode: "otel",
    parserExport: "parseCopilotIncremental",
    resolverExports: ["resolveCopilotOtelPaths"],
    statusSurface: true,
    diagnosticsSurface: true,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "GitHub Copilot OTEL JSONL file reader.",
  },
  {
    id: "zed",
    displayName: "Zed Agent",
    queueSource: "zed",
    family: "zed",
    collectionMode: "sqlite",
    parserExport: "parseZedIncremental",
    resolverExports: ["resolveZedDbPath"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Zed Agent (all providers; cumulative-delta over SQLite threads).",
  },
  {
    id: "goose",
    displayName: "Goose",
    queueSource: "goose",
    family: "block",
    collectionMode: "sqlite",
    parserExport: "parseGooseIncremental",
    resolverExports: ["resolveGooseDbPath"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Goose (Block) SQLite sessions with cumulative tokens.",
  },
  {
    id: "droid",
    displayName: "Droid",
    queueSource: "droid",
    family: "factory",
    collectionMode: "passive_log",
    parserExport: "parseDroidIncremental",
    resolverExports: ["listDroidSettingsFiles"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Factory CLI (Droid) passive ~/.factory/sessions/*.settings.json reader.",
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    queueSource: "antigravity",
    family: "antigravity",
    collectionMode: "passive_log",
    parserExport: "parseAntigravityIncremental",
    resolverExports: ["listAntigravityTranscripts"],
    statusSurface: true,
    diagnosticsSurface: false,
    pathOverrideKey: null,
    accountLevel: false,
    notes: "Antigravity passive transcript reader.",
  },
];

/**
 * Normalize an adapter id for comparison (case-insensitive, trimmed).
 * @param {string} id
 * @returns {string}
 */
function normalizeAdapterId(id) {
  return String(id || "").trim().toLowerCase();
}

/**
 * List all agent adapters. Returns a shallow copy so callers cannot mutate
 * the registry.
 * @returns {Array<Object>}
 */
function listAgentAdapters() {
  return AGENT_ADAPTERS.map((entry) => ({ ...entry, resolverExports: [...entry.resolverExports] }));
}

/**
 * Look up a single adapter by id (case-insensitive).
 * @param {string} id
 * @returns {AgentAdapter|null}
 */
function getAgentAdapter(id) {
  const normalized = normalizeAdapterId(id);
  return AGENT_ADAPTERS.find((entry) => entry.id === normalized) || null;
}

/**
 * Return the ids of adapters that should appear in the Usage Limits provider list.
 * @returns {string[]}
 */
function listUsageLimitAdapterIds() {
  return listProviderIdsByCapability("desktop_visibility")
    .filter((id) => getAgentAdapter(id));
}

/**
 * Return the pathOverrideKey values present in the registry (nulls excluded).
 * @returns {string[]}
 */
function listDataDirectoryAdapterKeys() {
  return AGENT_ADAPTERS.map((entry) => entry.pathOverrideKey).filter(Boolean);
}

/**
 * Return the queueSource values of adapters marked as account-level.
 * @returns {string[]}
 */
function listAccountLevelSources() {
  return AGENT_ADAPTERS.filter((entry) => entry.accountLevel).map((entry) => entry.queueSource);
}

module.exports = {
  AGENT_ADAPTERS,
  getAgentAdapter,
  listAgentAdapters,
  listUsageLimitAdapterIds,
  listDataDirectoryAdapterKeys,
  listAccountLevelSources,
};

