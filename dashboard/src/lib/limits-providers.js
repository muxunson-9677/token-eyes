import { copy } from "./copy";

/**
 * Canonical usage-limits provider ids (order defaults in useLimitsDisplayPrefs).
 * V4 round 1 item-3a: this list now mirrors every implemented agent channel in
 * DASHBOARD_AGENTS (agent-adapters-dashboard.ts) so the settings "限制显示"
 * panel can toggle all of them. The first 11 keep their historical order so
 * existing users' saved ordering stays stable; the rest follow the registry
 * order and are appended by normalizeOrder for existing snapshots.
 * Swift's normalizedOrder safely drops ids it doesn't know about, and
 * normalizeOrder here re-appends them, so macOS mirrors stay consistent.
 */
export const LIMIT_PROVIDER_IDS = [
  "claude",
  "codex",
  "cursor",
  "trae",
  "codebuddy",
  "gemini",
  "hermes",
  "openclaw",
  "opencode",
  "antigravity",
  "zed",
  "workbuddy",
  "every-code",
  "kilo-cli",
  "kilocode",
  "roocode",
  "kiro",
  "kiro-cli",
  "kimi",
  "kimi-code",
  "omp",
  "pi",
  "craft",
  "grok",
  "copilot",
  "goose",
  "droid",
];

/** Keys for ProviderIcon; mono logos use inline SVG and colored logos use /brand-logos/. */
export const LIMIT_PROVIDER_ICON_KEYS = {
  claude: "CLAUDE",
  codex: "CODEX",
  cursor: "CURSOR",
  trae: "TRAE",
  codebuddy: "CODEBUDDY",
  workbuddy: "WORKBUDDY",
  gemini: "GEMINI",
  hermes: "HERMES",
  openclaw: "OPENCLAW",
  opencode: "OPENCODE",
  antigravity: "ANTIGRAVITY",
  zed: "ZED",
  "every-code": "EVERY-CODE",
  "kilo-cli": "KILO-CLI",
  kilocode: "KILO-CODE",
  roocode: "ROOCODE",
  kiro: "KIRO",
  "kiro-cli": "KIRO",
  kimi: "KIMI",
  "kimi-code": "KIMI",
  omp: "OMP",
  pi: "PI",
  craft: "CRAFT",
  grok: "GROK",
  copilot: "COPILOT",
  goose: "GOOSE",
  droid: "DROID",
};

export function limitProviderIconKey(id) {
  return LIMIT_PROVIDER_ICON_KEYS[id] || null;
}

const LIMIT_PROVIDER_NAME_KEYS = {
  claude: "limits.provider.claude",
  codex: "limits.provider.codex",
  cursor: "limits.provider.cursor",
  trae: "limits.provider.trae",
  codebuddy: "limits.provider.codebuddy",
  workbuddy: "limits.provider.workbuddy",
  gemini: "limits.provider.gemini",
  hermes: "limits.provider.hermes",
  openclaw: "limits.provider.openclaw",
  opencode: "limits.provider.opencode",
  antigravity: "limits.provider.antigravity",
  zed: "limits.provider.zed",
  "every-code": "limits.provider.every_code",
  "kilo-cli": "limits.provider.kilo_cli",
  kilocode: "limits.provider.kilocode",
  roocode: "limits.provider.roocode",
  kiro: "limits.provider.kiro",
  "kiro-cli": "limits.provider.kiro_cli",
  kimi: "limits.provider.kimi",
  "kimi-code": "limits.provider.kimi_code",
  omp: "limits.provider.omp",
  pi: "limits.provider.pi",
  craft: "limits.provider.craft",
  grok: "limits.provider.grok",
  copilot: "limits.provider.copilot",
  goose: "limits.provider.goose",
  droid: "limits.provider.droid",
};

export function limitProviderName(id) {
  const key = LIMIT_PROVIDER_NAME_KEYS[id];
  return key ? copy(key) : String(id || "");
}
