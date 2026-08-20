import { copy } from "./copy";

/**
 * Canonical usage-limits provider ids (order defaults in useLimitsDisplayPrefs).
 * Every id here has either a provider limit spec or a dedicated panel renderer.
 * Agent selection is intentionally independent: agents without a real limits
 * surface must not create empty rows in the settings panel. The first 10 keep
 * their historical order so existing users' saved ordering stays stable.
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
  "kimi",
  "kiro",
  "grok",
  "copilot",
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
  kimi: "KIMI",
  "kimi-code": "KIMI",
  pi: "PI",
  grok: "GROK",
  copilot: "COPILOT",
  "deepseek-harness": "DEEPSEEK-HARNESS",
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
  kimi: "limits.provider.kimi",
  "kimi-code": "limits.provider.kimi_code",
  pi: "limits.provider.pi",
  grok: "limits.provider.grok",
  copilot: "limits.provider.copilot",
  "deepseek-harness": "limits.provider.deepseek_harness",
};

export function limitProviderName(id) {
  const key = LIMIT_PROVIDER_NAME_KEYS[id];
  return key ? copy(key) : String(id || "");
}
