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
    financialCapabilities: {
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    },
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
    financialCapabilities: {
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    },
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
    financialCapabilities: {
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    },
  },
  {
    providerId: "glm",
    label: "智谱 GLM",
    aliases: ["glm", "zhipu", "智谱", "bigmodel", "智谱ai", "zhipuai"],
    hosts: ["open.bigmodel.cn", "www.bigmodel.cn", "bigmodel.cn"],
    defaultRequestUrl: "https://open.bigmodel.cn/api/paas/v4",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
    financialCapabilities: {
      balance: "unsupported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "token_plan",
    },
  },
];

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

export const PROVIDER_API_MODES = [
  { value: "", copyKey: "settings.cost.provider_api.form.api_mode_auto" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "dashscope", label: "DashScope" },
  { value: "moonshot", label: "Moonshot" },
  { value: "glm", label: "智谱 GLM" },
  { value: "custom", copyKey: "settings.cost.provider_api.form.api_mode_custom" },
];

export function getProviderFinancialCapabilities(form) {
  if (form?.financialCapabilities) return { ...form.financialCapabilities };
  const preset = detectPreset(form);
  if (preset) return { ...preset.financialCapabilities };
  return {
    balance: String(form?.balancePath || "").trim() ? "custom" : "unsupported",
    monthSpend: String(form?.monthSpendPath || "").trim() ? "custom" : "unsupported",
    lifetimeSpend: String(form?.lifetimeSpendPath || "").trim() ? "custom" : "unsupported",
    tokenQuota: "unsupported",
  };
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
    financialCapabilities: getProviderFinancialCapabilities(prepared),
  };
}
