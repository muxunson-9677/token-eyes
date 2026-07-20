#!/usr/bin/env node
// Fetch the live LiteLLM pricing JSON and write a slimmed snapshot used as the
// day-1 offline fallback. Runs from `npm prepublishOnly`; can also be invoked
// manually: `node scripts/build-pricing-seed.cjs`.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const OUT_PATH = path.resolve(__dirname, "../src/lib/pricing/seed-snapshot.json");
const CURATED_PATH = path.resolve(__dirname, "../src/lib/pricing/curated-overrides.json");
const TIMEOUT_MS = 30_000;

const KEEP_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
];

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fixedRate(value) {
  return (Number.isFinite(value) ? value : 0).toFixed(12);
}

function snapshotRate(entry, field) {
  const value = entry?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function snapshotRow(entry) {
  return {
    input: snapshotRate(entry, "input_cost_per_token"),
    output: snapshotRate(entry, "output_cost_per_token"),
    cacheRead: snapshotRate(entry, "cache_read_input_token_cost"),
    cacheWrite: snapshotRate(entry, "cache_creation_input_token_cost"),
  };
}

function curatedRow(entry) {
  const perMillion = (field) => {
    const value = entry?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value / 1_000_000 : 0;
  };
  return {
    input: perMillion("input"),
    output: perMillion("output"),
    cacheRead: perMillion("cache_read"),
    cacheWrite: perMillion("cache_write"),
  };
}

function buildServerPricingRows(snapshot, curated) {
  const rows = new Map();
  const suffixCandidates = new Map();

  for (const [pricingKey, entry] of Object.entries(snapshot)) {
    if (pricingKey === "_meta" || !entry || typeof entry !== "object") continue;
    rows.set(pricingKey, snapshotRow(entry));
    const slash = pricingKey.lastIndexOf("/");
    if (slash >= 0 && slash < pricingKey.length - 1) {
      const suffix = pricingKey.slice(slash + 1);
      const candidates = suffixCandidates.get(suffix) || [];
      candidates.push(pricingKey);
      suffixCandidates.set(suffix, candidates);
    }
  }

  const curatedExact = curated?.exact || {};
  for (const [suffix, candidates] of suffixCandidates) {
    if (rows.has(suffix) || Object.hasOwn(curatedExact, suffix)) continue;
    candidates.sort((a, b) => a.localeCompare(b));
    rows.set(suffix, { ...rows.get(candidates[0]) });
  }

  for (const [pricingKey, entry] of Object.entries(curatedExact)) {
    if (!entry || typeof entry !== "object") continue;
    rows.set(pricingKey, curatedRow(entry));
  }

  for (const [alias, reference] of Object.entries(curated?.alias || {})) {
    if (rows.has(alias)) continue;
    const referenced = rows.get(reference);
    if (referenced) rows.set(alias, { ...referenced });
  }

  return [...rows.entries()]
    .map(([pricingKey, rates]) => ({
      pricingKey,
      input: fixedRate(rates.input),
      output: fixedRate(rates.output),
      cacheRead: fixedRate(rates.cacheRead),
      cacheWrite: fixedRate(rates.cacheWrite),
    }))
    .sort((a, b) => a.pricingKey.localeCompare(b.pricingKey));
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildPricingSql(snapshot, curated) {
  const rows = buildServerPricingRows(snapshot, curated);
  const canonical = rows.map((row) => [
    row.pricingKey,
    row.input,
    row.output,
    row.cacheRead,
    row.cacheWrite,
  ]);
  const pricingVersion = crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  const values = rows.map((row) =>
    `  (${sqlString(row.pricingKey)}, ${row.input}, ${row.output}, ${row.cacheRead}, ${row.cacheWrite}, '${pricingVersion}')`,
  );

  return [
    "-- Generated from the bundled pricing snapshot and curated overrides.",
    "-- Rebuild offline with: node scripts/build-pricing-seed.cjs --from-existing-snapshot --sql-out scripts/ops/leaderboard-model-pricing.sql",
    "begin;",
    "",
    "create table if not exists public.tokentracker_model_pricing (",
    "  pricing_key text primary key,",
    "  input_usd_per_token numeric(24,12) not null,",
    "  output_usd_per_token numeric(24,12) not null,",
    "  cache_read_usd_per_token numeric(24,12) not null,",
    "  cache_write_usd_per_token numeric(24,12) not null,",
    "  pricing_version text not null",
    ");",
    "",
    "insert into public.tokentracker_model_pricing (",
    "  pricing_key, input_usd_per_token, output_usd_per_token,",
    "  cache_read_usd_per_token, cache_write_usd_per_token, pricing_version",
    ") values",
    `${values.join(",\n")}`,
    "on conflict (pricing_key) do update set",
    "  input_usd_per_token = excluded.input_usd_per_token,",
    "  output_usd_per_token = excluded.output_usd_per_token,",
    "  cache_read_usd_per_token = excluded.cache_read_usd_per_token,",
    "  cache_write_usd_per_token = excluded.cache_write_usd_per_token,",
    "  pricing_version = excluded.pricing_version;",
    "",
    "delete from public.tokentracker_model_pricing",
    `where pricing_version <> '${pricingVersion}';`,
    "",
    "commit;",
    "",
  ].join("\n");
}

function writePricingSql(outputPath, snapshot) {
  const curated = JSON.parse(fs.readFileSync(CURATED_PATH, "utf8"));
  const sql = buildPricingSql(snapshot, curated);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, sql);
  process.stdout.write(`[build-pricing-seed] wrote ${outputPath}\n`);
}

async function main() {
  const sqlOut = readOption("--sql-out");
  if (process.argv.includes("--from-existing-snapshot")) {
    if (!sqlOut) throw new Error("--sql-out is required with --from-existing-snapshot");
    const snapshot = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    writePricingSql(path.resolve(sqlOut), snapshot);
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let raw;
  try {
    const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    raw = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const slim = {};
  let kept = 0;
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const out = {};
    let hasAny = false;
    for (const f of KEEP_FIELDS) {
      const v = entry[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[f] = v;
        hasAny = true;
      }
    }
    if (hasAny) {
      slim[name] = out;
      kept++;
    }
  }

  const meta = {
    _meta: {
      source: LITELLM_URL,
      generated_at: new Date().toISOString(),
      kept_models: kept,
    },
  };
  const final = { ...meta, ...slim };

  fs.writeFileSync(OUT_PATH, JSON.stringify(final) + "\n");
  const stat = fs.statSync(OUT_PATH);
  process.stdout.write(
    `[build-pricing-seed] wrote ${OUT_PATH} (${kept} models, ${stat.size} bytes)\n`,
  );

  if (sqlOut) writePricingSql(path.resolve(sqlOut), final);
}

main().catch((err) => {
  process.stderr.write(`[build-pricing-seed] failed: ${err?.message || err}\n`);
  process.exitCode = 1;
});
