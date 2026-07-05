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
    balancePath: "balance_infos[0].total_balance",
    monthSpendPath: "",
    lifetimeSpendPath: "",
    currencyPath: "balance_infos[0].currency",
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

export function applyProviderApiPreset(form) {
  const preset = detectPreset(form);
  if (!preset) return { ...form };

  return {
    ...form,
    providerId: String(form.providerId || "").trim() || preset.providerId,
    label: String(form.label || "").trim() || preset.label,
    requestUrl: shouldUsePresetRequestUrl(form.requestUrl, preset)
      ? preset.defaultRequestUrl
      : form.requestUrl,
    requestMethod: String(form.requestMethod || "").trim() || preset.requestMethod,
    authType: String(form.authType || "").trim() || preset.authType,
    authHeaderName: String(form.authHeaderName || "").trim() || preset.authHeaderName,
    balancePath: String(form.balancePath || "").trim() || preset.balancePath,
    monthSpendPath: String(form.monthSpendPath || "").trim() || preset.monthSpendPath,
    lifetimeSpendPath: String(form.lifetimeSpendPath || "").trim() || preset.lifetimeSpendPath,
    currencyPath: String(form.currencyPath || "").trim() || preset.currencyPath,
    refreshIntervalSeconds: Number(form.refreshIntervalSeconds) || 300,
  };
}
