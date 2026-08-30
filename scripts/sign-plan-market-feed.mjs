#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PLAN_MARKET_FEED_SCHEMA,
  PLAN_MARKET_FEED_URL,
  hashPlanMarketCatalog,
  normalizePlanMarketFeedUrl,
} = require("../src/lib/plan-market");
const { createSignedStaticFeedEnvelope } = require("../src/lib/signed-static-feed");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("Arguments must be name/value pairs");
    options[name.slice(2)] = value;
  }
  if (!options.private || !options.input || !options.output) {
    throw new Error("Usage: --private <path> --input <catalog.json> --output <feed.json> [--generated-at <ISO>] [--key-id <id>]");
  }
  return options;
}

function exactIso(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("--generated-at must be an exact ISO timestamp");
  }
  return value;
}

function catalogVersion(catalog) {
  const updatedAt = String(catalog?._meta?.updated_at || "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(updatedAt)
    ? `${updatedAt.replace(" ", "T")}:00.000Z`
    : updatedAt;
  const timestamp = Date.parse(normalized);
  const revision = Number(catalog?._meta?.version);
  if (!Number.isFinite(timestamp) || !Number.isInteger(revision) || revision < 1) {
    throw new TypeError("Plan Market catalog metadata is invalid");
  }
  return `${new Date(timestamp).toISOString().slice(0, 10)}.${revision}`;
}

function writeAtomic(outputPath, envelope) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    fs.renameSync(tempPath, outputPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
  if (catalog?._meta?.version !== 1 || !Array.isArray(catalog?.providers) || catalog.providers.length === 0) {
    throw new TypeError("Plan Market catalog is invalid");
  }
  const generatedAt = options["generated-at"]
    ? exactIso(options["generated-at"])
    : new Date().toISOString();
  const payload = {
    schema_version: PLAN_MARKET_FEED_SCHEMA,
    catalog_version: catalogVersion(catalog),
    generated_at: generatedAt,
    source_url: normalizePlanMarketFeedUrl(options["source-url"] || PLAN_MARKET_FEED_URL),
    catalog_sha256: hashPlanMarketCatalog(catalog),
    catalog,
  };
  const privateKey = fs.readFileSync(path.resolve(options.private), "utf8");
  const envelope = createSignedStaticFeedEnvelope(payload, privateKey, {
    keyId: options["key-id"] || "token-eyes-static-2026-01",
    maxPayloadBytes: 5 * 1024 * 1024,
  });
  writeAtomic(path.resolve(options.output), envelope);
  process.stdout.write(`Signed Plan Market ${payload.catalog_version}.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || "Plan Market signing failed"}\n`);
  process.exitCode = 1;
}
