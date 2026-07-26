const fs = require("node:fs");
const path = require("node:path");
const { PROVIDER_CAPABILITIES } = require("../provider-capabilities");

const CATALOG_DIR = __dirname;

const PROVIDER_CATALOG_FILES = Object.fromEntries(
  PROVIDER_CAPABILITIES
    .filter((provider) => provider.catalog_token_plan)
    .sort((a, b) => (a.catalog_order ?? 0) - (b.catalog_order ?? 0))
    .map((provider) => {
      if (!provider.manual_token_plan || !provider.official_rate_limit) {
        throw new Error(`Catalog provider ${provider.id} has inconsistent capabilities`);
      }
      return [provider.id, `${provider.id.replaceAll("_", "-")}.catalog.json`];
    }),
);

const CUSTOM_PROVIDER = {
  id: "custom",
  name: "自定义套餐",
};

let catalogCache = null;

function loadCatalogs() {
  if (catalogCache) return catalogCache;

  const providers = {};

  for (const [providerId, fileName] of Object.entries(PROVIDER_CATALOG_FILES)) {
    const filePath = path.join(CATALOG_DIR, fileName);
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (data.provider_id !== providerId) {
      throw new Error(`Catalog ${fileName} provider_id must be ${providerId}`);
    }
    providers[providerId] = {
      provider_id: data.provider_id,
      provider_name: data.provider_name,
      catalog_version: data.catalog_version,
      plans: (data.plans || []).map((plan) => ({
        plan_id: plan.plan_id,
        display_name: plan.display_name,
        quota_kind: plan.quota?.kind || "unknown",
        quota_unit: plan.quota?.unit || "tokens",
        total_quota: Number(plan.quota?.total || 0),
        total_quota_display: plan.quota?.display || "",
        official_evidence_url: plan.official_evidence_url || "",
      })),
    };
  }

  catalogCache = providers;
  return providers;
}

function getProviderCatalog(providerId) {
  const catalogs = loadCatalogs();
  const id = String(providerId || "").trim().toLowerCase();
  if (!id || !catalogs[id]) return null;
  const catalog = catalogs[id];
  return {
    provider_id: catalog.provider_id,
    provider_name: catalog.provider_name,
    catalog_version: catalog.catalog_version,
    plans: catalog.plans.map((p) => ({ ...p })),
  };
}

function getPlanById(providerId, planId) {
  const catalog = getProviderCatalog(providerId);
  if (!catalog) return null;
  const pid = String(planId || "").trim();
  const plan = catalog.plans.find((p) => p.plan_id === pid);
  return plan ? { ...plan } : null;
}

function listProviderOptions() {
  const catalogs = loadCatalogs();
  const options = [];
  for (const [id, catalog] of Object.entries(catalogs)) {
    options.push({ id, name: catalog.provider_name });
  }
  options.push({ id: CUSTOM_PROVIDER.id, name: CUSTOM_PROVIDER.name });
  return options;
}

module.exports = {
  getProviderCatalog,
  getPlanById,
  listProviderOptions,
  listCatalogProviderIds: () => Object.keys(loadCatalogs()),
};
