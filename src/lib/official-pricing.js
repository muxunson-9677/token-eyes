"use strict";

const OFFICIAL_SOURCES = [
  {
    provider: "openai",
    hostname: "developers.openai.com",
    matches: (value) => /^(gpt|o\d|chatgpt)/i.test(value),
    url: ({ modelId }) => `https://developers.openai.com/api/docs/models/${encodeURIComponent(modelId)}`,
  },
  {
    provider: "anthropic",
    hostname: "docs.anthropic.com",
    matches: (value) => /^claude/i.test(value),
    url: () => "https://docs.anthropic.com/en/docs/about-claude/pricing",
  },
  {
    provider: "google",
    hostname: "ai.google.dev",
    matches: (value) => /^(gemini|gemma)/i.test(value),
    url: () => "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    provider: "deepseek",
    hostname: "api-docs.deepseek.com",
    matches: (value) => /^deepseek/i.test(value),
    url: () => "https://api-docs.deepseek.com/quick_start/pricing-details-usd",
  },
  {
    provider: "minimax",
    hostname: "platform.minimaxi.com",
    matches: (value) => /^minimax/i.test(value),
    url: () => "https://platform.minimaxi.com/docs/guides/pricing-paygo",
  },
  {
    provider: "moonshot",
    hostname: "platform.moonshot.cn",
    matches: (value) => /^(kimi|moonshot)/i.test(value),
    url: () => "https://platform.moonshot.cn/docs/pricing/chat",
  },
  {
    provider: "xiaomi",
    hostname: "platform.xiaomimimo.com",
    matches: (value) => /^(mimo|xiaomi)/i.test(value),
    url: () => "https://platform.xiaomimimo.com/#/docs/pricing",
  },
  {
    provider: "zhipu",
    hostname: "open.bigmodel.cn",
    matches: (value) => /^(glm|zhipu)/i.test(value),
    url: () => "https://open.bigmodel.cn/pricing",
  },
  {
    provider: "alibaba",
    hostname: "help.aliyun.com",
    matches: (value) => /^(qwen|qwq|wan)/i.test(value),
    url: () => "https://help.aliyun.com/zh/model-studio/model-pricing",
  },
  {
    provider: "xai",
    hostname: "docs.x.ai",
    matches: (value) => /^grok/i.test(value),
    url: () => "https://docs.x.ai/docs/models",
  },
];

function cleanModelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferOfficialPricingSource({ model = "", modelId = "" } = {}) {
  const displayValue = String(model || modelId || "").trim();
  const normalizedId = cleanModelId(modelId || model);
  if (!displayValue || !normalizedId) return null;
  const source = OFFICIAL_SOURCES.find((candidate) => candidate.matches(displayValue) || candidate.matches(normalizedId));
  if (!source) return null;
  const url = source.url({ model: displayValue, modelId: normalizedId });
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== source.hostname) return null;
  return { provider: source.provider, hostname: source.hostname, url, modelId: normalizedId };
}

function pageToText(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#36;|&#x24;|&dollar;/gi, "$")
    .replace(/&#165;|&#xa5;|&yen;/gi, "\u00a5")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readMoney(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}[^$\\u00a5\\uffe5]{0,160}(?:USD|CNY|US\\$)?\\s*[$\\u00a5\\uffe5]\\s*([0-9]+(?:\\.[0-9]+)?)`,
      "i",
    );
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function findAnchorPositions(text, anchors) {
  const lowerText = text.toLowerCase();
  const positions = new Set();
  for (const anchor of anchors) {
    const needle = anchor.toLowerCase();
    let fromIndex = 0;
    while (needle && fromIndex < lowerText.length) {
      const position = lowerText.indexOf(needle, fromIndex);
      if (position < 0) break;
      positions.add(position);
      fromIndex = position + needle.length;
    }
  }
  return [...positions].sort((left, right) => left - right);
}

function parsePricingWindow(window, currency) {
  const input = readMoney(window, ["input(?: price| tokens?)?", "prompt(?: price| tokens?)?"]);
  const output = readMoney(window, ["output(?: price| tokens?)?", "completion(?: price| tokens?)?"]);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return {
    input,
    output,
    cacheRead: readMoney(window, ["cached input", "cache read", "context caching price"]),
    cacheWrite: readMoney(window, ["cache write", "5-minute cache write"]),
    currency: String(currency || "USD").toUpperCase() === "CNY" ? "CNY" : "USD",
  };
}

function parseOfficialPricingPage(page, { model = "", modelId = "", currency = "USD" } = {}) {
  const text = pageToText(page);
  const anchors = [String(modelId || "").trim(), String(model || "").trim()].filter(Boolean);
  const positions = findAnchorPositions(text, anchors);
  for (const start of positions) {
    const pricing = parsePricingWindow(text.slice(start, start + 12_000), currency);
    if (pricing) return pricing;
  }
  return null;
}

async function verifyOfficialModelPricing(request, { fetchImpl = globalThis.fetch } = {}) {
  const model = String(request?.model || "").trim();
  const modelId = String(request?.model_id || request?.modelId || model).trim();
  const source = inferOfficialPricingSource({ model, modelId });
  if (!source) {
    return { ok: false, status: "manual_required", error: "\u6682\u672a\u627e\u5230\u8be5\u6a21\u578b\u7684\u5b98\u65b9\u5b9a\u4ef7\u5165\u53e3\u3002" };
  }
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      status: "manual_required",
      source_url: source.url,
      error: "\u5f53\u524d\u73af\u5883\u65e0\u6cd5\u8bbf\u95ee\u5b98\u65b9\u5b9a\u4ef7\u9875\u3002",
    };
  }

  try {
    const response = await fetchImpl(source.url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Token-Eyes/official-pricing-verifier",
      },
      redirect: "follow",
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15_000)
        : undefined,
    });
    if (!response?.ok) {
      return {
        ok: false,
        status: "manual_required",
        source_url: source.url,
        error: `\u5b98\u65b9\u5b9a\u4ef7\u9875\u8fd4\u56de HTTP ${response?.status || "\u9519\u8bef"}\u3002`,
      };
    }
    const page = await response.text();
    const pricing = parseOfficialPricingPage(page, {
      model,
      modelId: source.modelId,
      currency: request?.currency,
    });
    if (!pricing) {
      return {
        ok: false,
        status: "manual_required",
        source_url: source.url,
        error: "\u5df2\u8bbf\u95ee\u5b98\u7f51\uff0c\u4f46\u672a\u80fd\u53ef\u9760\u8bc6\u522b\u8be5\u6a21\u578b\u7684\u8f93\u5165/\u8f93\u51fa\u4ef7\u683c\uff0c\u8bf7\u4eba\u5de5\u6838\u4ef7\u3002",
      };
    }
    return {
      ok: true,
      status: "verified",
      model,
      model_id: source.modelId,
      provider: source.provider,
      source: String(request?.source || "").trim().toLowerCase(),
      source_url: source.url,
      verified_at: new Date().toISOString(),
      pricing,
    };
  } catch (error) {
    return {
      ok: false,
      status: "manual_required",
      source_url: source.url,
      error: `\u5b98\u65b9\u81ea\u52a8\u6838\u4ef7\u5931\u8d25\uff1a${error?.message || "\u7f51\u7edc\u8bf7\u6c42\u5931\u8d25"}`,
    };
  }
}

module.exports = {
  inferOfficialPricingSource,
  parseOfficialPricingPage,
  verifyOfficialModelPricing,
};
