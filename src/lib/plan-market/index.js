const fs = require("node:fs");
const path = require("node:path");

// Single source of truth shared with the dashboard bundle (which imports the
// JSON directly, see dashboard/src/pages/PlanMarketPage.jsx).
const CATALOG_PATH = path.join(__dirname, "..", "..", "..", "shared", "plan-market-catalog.json");

let rawCache = null;

function loadRaw() {
  if (rawCache) return rawCache;
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.providers)) {
    throw new Error("plan-market catalog.json must contain a providers array");
  }
  rawCache = data;
  return data;
}

// Callers may decorate/sort the payload, so hand out deep copies instead of
// sharing the module-level cache.
function getPlanMarketCatalog() {
  const data = loadRaw();
  return {
    updated_at: data._meta?.updated_at || "",
    providers: structuredClone(data.providers),
  };
}

module.exports = { getPlanMarketCatalog };
