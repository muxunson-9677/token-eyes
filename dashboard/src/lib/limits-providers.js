import providerCapabilities from "../../../shared/provider-capabilities.json";
import { copy } from "./copy";

/** Canonical usage-limits provider ids (order defaults in useLimitsDisplayPrefs). */
export const LIMIT_PROVIDER_IDS = providerCapabilities.providers
  .filter((provider) => provider.desktop_visibility)
  .map((provider) => provider.id);

export function providerHasCapability(id, capability) {
  const provider = providerCapabilities.providers.find((entry) => entry.id === id);
  return provider?.[capability] === true;
}

/** Keys for ProviderIcon; mono logos use inline SVG and colored logos use /brand-logos/. */
export const LIMIT_PROVIDER_ICON_KEYS = {
  claude: "CLAUDE",
  codex: "CODEX",
  cursor: "CURSOR",
  trae: "TRAE",
  gemini: "GEMINI",
  hermes: "HERMES",
  openclaw: "OPENCLAW",
  opencode: "OPENCODE",
  antigravity: "ANTIGRAVITY",
};

export function limitProviderIconKey(id) {
  return LIMIT_PROVIDER_ICON_KEYS[id] || null;
}

export function limitProviderName(id) {
  switch (id) {
    case "claude":
      return copy("limits.provider.claude");
    case "codex":
      return copy("limits.provider.codex");
    case "cursor":
      return copy("limits.provider.cursor");
    case "trae":
      return copy("limits.provider.trae");
    case "gemini":
      return copy("limits.provider.gemini");
    case "hermes":
      return copy("limits.provider.hermes");
    case "openclaw":
      return copy("limits.provider.openclaw");
    case "opencode":
      return copy("limits.provider.opencode");
    case "kimi":
      return copy("limits.provider.kimi");
    case "kiro":
      return copy("limits.provider.kiro");
    case "grok":
      return copy("limits.provider.grok");
    case "copilot":
      return copy("limits.provider.copilot");
    case "antigravity":
      return copy("limits.provider.antigravity");
    default:
      return String(id || "");
  }
}
