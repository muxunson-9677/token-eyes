import providerCapabilities from "../../../shared/provider-capabilities.json";

const PROVIDER_API_PRESETS = [
  {
    providerId: "deepseek",
    label: "DeepSeek",
    aliases: ["deepseek", "deep seek"],
    hosts: ["api.deepseek.com"],
    defaultRequestUrl: "https://api.deepseek.com/user/balance",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "balance_infos[*].total_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "balance_infos[*].currency",
  },
  {
    providerId: "dashscope",
    label: "DashScope",
    aliases: ["dashscope", "百炼", "bailian", "aliyun", "灵积", "aliyuncs"],
    hosts: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com"],
    defaultRequestUrl: "https://dashscope.aliyuncs.com/api/v1/recharge/recharge-balance/query",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "output.available_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "output.currency",
  },
  {
    providerId: "moonshot",
    label: "Moonshot",
    aliases: ["moonshot", "kimi", "月之暗面", "moon shot"],
    hosts: ["api.moonshot.cn", "api.moonshot.com"],
    defaultRequestUrl: "https://api.moonshot.cn/v1/users/me/balance",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.available_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "glm",
    label: "智谱 GLM",
    aliases: ["glm", "zhipu", "智谱", "bigmodel", "智谱ai", "zhipuai"],
    hosts: ["open.bigmodel.cn", "www.bigmodel.cn", "bigmodel.cn"],
    defaultRequestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    requestMethod: "GET",
    // #6: 智谱 API keys authenticate as `Authorization: Bearer <key>`; the old
    // "header" mode sent the raw key with no scheme and 401'd. NOTE: 智谱 account
    // balance/recharge is often only exposed to the console session, so the
    // 官网检测 (glm_session.rs) path may still be the reliable one — verify this
    // preset against a real key.
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.limits[*].usage",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "siliconflow",
    label: "硅基流动 SiliconFlow",
    aliases: ["siliconflow", "硅基流动", "silicon flow", "硅基"],
    hosts: ["api.siliconflow.cn", "api.siliconflow.com"],
    defaultRequestUrl: "https://api.siliconflow.cn/v1/user/info",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.totalBalance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
  {
    providerId: "openrouter",
    label: "OpenRouter",
    aliases: ["openrouter", "open router"],
    hosts: ["openrouter.ai"],
    defaultRequestUrl: "https://openrouter.ai/api/v1/auth/key",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.limit_remaining",
    monthSpendPath: "data.usage",
    lifetimeSpendPath: "",
    currencyPath: "",
  },
];
export const PROVIDER_API_PRESET_IDS = PROVIDER_API_PRESETS.map((preset) => preset.providerId);
const balanceCapabilityIds = providerCapabilities.providers
  .filter((provider) => provider.provider_balance)
  .map((provider) => provider.id)
  .sort();
if (JSON.stringify([...PROVIDER_API_PRESET_IDS].sort()) !== JSON.stringify(balanceCapabilityIds)) {
  throw new Error("Provider balance presets do not match the capability manifest");
}

function lowerTrim(value) {
  return String(value || "").trim().toLowerCase();
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function slugifyProviderId(label) {
  const slug = String(label || "").trim().toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return slug || "custom";
}

function detectPreset(form) {
  const providerText = lowerTrim(form?.providerId);
  const labelText = lowerTrim(form?.label);
  const host = hostFromUrl(form?.requestUrl);
  return PROVIDER_API_PRESETS.find((preset) => (
    providerText === preset.providerId ||
    preset.aliases.some((alias) => providerText === alias || labelText.includes(alias)) ||
    preset.hosts.includes(host)
  )) || null;
}

function shouldUsePresetRequestUrl(rawUrl, preset) {
  const value = String(rawUrl || "").trim();
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return preset.hosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function applyPresetFields(form, preset) {
  const next = { ...form };
  const usePresetUrl = shouldUsePresetRequestUrl(next.requestUrl, preset);

  if (!String(next.providerId || "").trim()) next.providerId = preset.providerId;
  if (!String(next.label || "").trim()) next.label = preset.label;

  if (usePresetUrl) {
    next.requestUrl = preset.defaultRequestUrl;
    next.balancePath = preset.balancePath;
    next.monthSpendPath = preset.monthSpendPath;
    next.lifetimeSpendPath = preset.lifetimeSpendPath;
    next.currencyPath = preset.currencyPath;
  } else {
    if (!String(next.balancePath || "").trim()) next.balancePath = preset.balancePath;
    if (!String(next.monthSpendPath || "").trim()) next.monthSpendPath = preset.monthSpendPath;
    if (!String(next.lifetimeSpendPath || "").trim()) next.lifetimeSpendPath = preset.lifetimeSpendPath;
    if (!String(next.currencyPath || "").trim()) next.currencyPath = preset.currencyPath;
  }

  if (!String(next.requestMethod || "").trim()) next.requestMethod = preset.requestMethod;
  if (!String(next.authType || "").trim()) next.authType = preset.authType;
  if (!String(next.authHeaderName || "").trim()) next.authHeaderName = preset.authHeaderName;

  if (preset.providerId === "deepseek") {
    if (String(next.balancePath || "").trim() === "balance_infos[0].total_balance") {
      next.balancePath = preset.balancePath;
    }
    if (String(next.currencyPath || "").trim() === "balance_infos[0].currency") {
      next.currencyPath = preset.currencyPath;
    }
  }

  return next;
}

// #6: lightweight detection used purely for UX — lets the config form show
// "已识别为 <provider>" so URL+Key users get confirmation the auto-fill matched
// a known provider. Returns null when nothing matches (custom endpoint).
export function detectProviderApiPreset(form) {
  const preset = detectPreset(form);
  return preset ? { providerId: preset.providerId, label: preset.label } : null;
}

export function applyProviderApiPreset(form) {
  const preset = detectPreset(form);
  const prepared = preset ? applyPresetFields(form, preset) : { ...form };

  if (!String(prepared.providerId || "").trim()) {
    prepared.providerId = slugifyProviderId(prepared.label);
  }
  if (!String(prepared.label || "").trim() && prepared.providerId) {
    prepared.label = prepared.providerId;
  }

  return {
    ...prepared,
    refreshIntervalSeconds: Number(prepared.refreshIntervalSeconds) || 300,
  };
}
