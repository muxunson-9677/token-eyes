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
    providerId: "aliyun_bss",
    label: "阿里云（含千问/百炼）",
    aliases: ["aliyun_bss", "dashscope", "百炼", "bailian", "aliyun", "阿里云", "千问", "qwen"],
    hosts: ["business.aliyuncs.com", "dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com"],
    fixedRequestUrl: true,
    defaultRequestUrl: "https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14",
    requestMethod: "GET",
    authType: "aliyun_rpc",
    authHeaderName: "",
    balancePath: "Data.AvailableAmount",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "Data.Currency",
    currencyValue: "",
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
    hosts: ["api.moonshot.cn", "api.moonshot.ai"],
    defaultRequestUrl: "https://api.moonshot.cn/v1/users/me/balance",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "data.available_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
    currencyValue: "CNY",
    financialCapabilities: {
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    },
  },
  {
    providerId: "volcengine_billing",
    label: "火山引擎（含豆包）",
    aliases: ["volcengine_billing", "volcengine", "volces", "火山引擎", "豆包", "doubao", "ark"],
    hosts: ["open.volcengineapi.com", "ark.cn-beijing.volces.com"],
    fixedRequestUrl: true,
    defaultRequestUrl: "https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01",
    requestMethod: "GET",
    authType: "volcengine_hmac",
    authHeaderName: "",
    balancePath: "Result.AvailableBalance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
    currencyValue: "CNY",
    financialCapabilities: {
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    },
  },
  {
    providerId: "minimax",
    label: "MiniMax",
    aliases: ["minimax", "mini max", "海螺"],
    hosts: ["api.minimax.io", "api.minimaxi.com", "platform.minimax.io"],
    fixedRequestUrl: true,
    defaultRequestUrl: "https://platform.minimax.io/account/billing",
    requestMethod: "GET",
    authType: "bearer",
    authHeaderName: "",
    balancePath: "",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "",
    currencyValue: "",
    financialCapabilities: {
      balance: "unsupported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "token_plan",
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

function isOfficialGlmQuotaEndpoint(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    const host = parsed.hostname.toLowerCase();
    const isBigModelHost = host === "bigmodel.cn" || host.endsWith(".bigmodel.cn");
    return isBigModelHost && /\/quota\/limit\/?$/i.test(parsed.pathname);
  } catch {
    return false;
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

  if (providerText) {
    return PROVIDER_API_PRESETS.find((preset) => (
      providerText === preset.providerId
      || preset.aliases.some((alias) => providerText === alias)
    )) || null;
  }

  return PROVIDER_API_PRESETS.find((preset) => (
    preset.aliases.some((alias) => labelText.includes(alias)) ||
    preset.hosts.includes(host)
  )) || null;
}

export const PROVIDER_API_MODES = [
  { value: "", copyKey: "settings.cost.provider_api.form.api_mode_auto" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "moonshot", label: "Kimi" },
  { value: "aliyun_bss", label: "Alibaba Cloud / Qwen" },
  { value: "volcengine_billing", label: "Volcengine / Doubao" },
  { value: "minimax", label: "MiniMax" },
  { value: "glm", label: "智谱 GLM" },
  { value: "custom", copyKey: "settings.cost.provider_api.form.api_mode_custom" },
];

export function getProviderFinancialCapabilities(form) {
  if (isOfficialGlmQuotaEndpoint(form?.requestUrl)) {
    return {
      balance: "unsupported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "token_plan",
    };
  }
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
  if (preset.fixedRequestUrl) return true;
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
    next.currencyValue = preset.currencyValue || "";
  } else {
    if (!String(next.balancePath || "").trim()) next.balancePath = preset.balancePath;
    if (!String(next.monthSpendPath || "").trim()) next.monthSpendPath = preset.monthSpendPath;
    if (!String(next.lifetimeSpendPath || "").trim()) next.lifetimeSpendPath = preset.lifetimeSpendPath;
    if (!String(next.currencyPath || "").trim()) next.currencyPath = preset.currencyPath;
    if (!String(next.currencyValue || "").trim()) next.currencyValue = preset.currencyValue || "";
  }

  if (preset.fixedRequestUrl) {
    next.requestMethod = preset.requestMethod;
    next.authType = preset.authType;
    next.authHeaderName = preset.authHeaderName;
  } else {
    if (!String(next.requestMethod || "").trim()) next.requestMethod = preset.requestMethod;
    if (!String(next.authType || "").trim()) next.authType = preset.authType;
    if (!String(next.authHeaderName || "").trim()) next.authHeaderName = preset.authHeaderName;
  }

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
