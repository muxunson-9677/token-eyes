#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSignedLeaderboardStaticSnapshot,
  listLeaderboardStaticDimensions,
  normalizeLeaderboardGeneratedAt,
} = require("../src/lib/leaderboard-static-snapshot");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("Arguments must be name/value pairs");
    options[name.slice(2)] = value;
  }
  if (!options.private || !options.input || !options.output) {
    throw new Error("Usage: --private <path> --input <snapshot-export.json> --output <directory> [--key-id <id>] [--require-complete <true|false>]");
  }
  return options;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
    });
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = JSON.parse(fs.readFileSync(path.resolve(options.input), "utf8"));
  if (!Array.isArray(input?.dimensions) || typeof input?.generated_at !== "string") {
    throw new TypeError("snapshot export must contain generated_at and dimensions");
  }
  const requiredKeys = new Set(
    listLeaderboardStaticDimensions().map(({ period, metric, source }) => `${period}/${metric}/${source}`),
  );
  const seen = new Set();
  for (const dimension of input.dimensions) {
    const key = `${dimension?.period}/${dimension?.metric}/${dimension?.source}`;
    if (!requiredKeys.has(key)) throw new TypeError(`snapshot dimension is not fixed: ${key}`);
    if (seen.has(key)) throw new TypeError(`duplicate snapshot dimension: ${key}`);
    seen.add(key);
  }
  if (options["require-complete"] === "true" && seen.size !== requiredKeys.size) {
    throw new TypeError(`complete snapshot export must contain exactly ${requiredKeys.size} dimensions`);
  }

  const privateKey = fs.readFileSync(path.resolve(options.private), "utf8");
  const outputRoot = path.resolve(options.output);
  const generatedAt = normalizeLeaderboardGeneratedAt(input.generated_at);
  const manifest = [];
  for (const dimension of input.dimensions) {
    const envelope = buildSignedLeaderboardStaticSnapshot({
      ...dimension,
      privateKey,
      keyId: options["key-id"] || "token-eyes-static-2026-01",
      generatedAt,
    });
    const relativePath = path.posix.join(
      "leaderboard",
      dimension.period,
      dimension.metric,
      `${dimension.source}.json`,
    );
    atomicWrite(path.join(outputRoot, ...relativePath.split("/")), envelope);
    manifest.push({
      key: `${dimension.period}/${dimension.metric}/${dimension.source}`,
      path: relativePath,
      sha256: crypto.createHash("sha256").update(JSON.stringify(envelope)).digest("hex"),
    });
  }
  atomicWrite(path.join(outputRoot, "leaderboard", "manifest.json"), {
    schema_version: "token-eyes.leaderboard-manifest/v1",
    generated_at: generatedAt,
    object_count: manifest.length,
    objects: manifest,
  });
  process.stdout.write(`Built ${manifest.length} signed leaderboard objects.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || "Leaderboard feed build failed"}\n`);
  process.exitCode = 1;
}
