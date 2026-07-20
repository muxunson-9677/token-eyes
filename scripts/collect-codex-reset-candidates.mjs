#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  classifyCodexResetCandidate,
  collectXRecentCandidates,
  mergeCodexResetCandidates,
} from "./lib/codex-announcement-sources.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--x-api") {
      options.xApi = true;
      continue;
    }
    if (["--manual", "--text-file", "--output", "--campaign-key", "--since-id"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (Boolean(options.xApi) === Boolean(options.manual)) {
    throw new Error("Choose exactly one collection mode: --x-api or --manual");
  }
  if (!options.output) throw new Error("--output is required");
  if (options.manual && !options.textFile) {
    throw new Error("--text-file is required with --manual");
  }
  return options;
}

function readExisting(outputPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return Array.isArray(parsed?.review_items) ? parsed.review_items : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error("Existing candidate file is invalid");
  }
}

function writeAtomic(outputPath, value) {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tempPath = `${resolved}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tempPath, resolved);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let candidates;
  if (options.xApi) {
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      process.stderr.write("X API collection is not configured; use the manual URL fallback.\n");
      process.exitCode = 2;
      return;
    }
    candidates = await collectXRecentCandidates({
      bearerToken,
      sinceId: options.sinceId,
    });
  } else {
    const text = fs.readFileSync(path.resolve(options.textFile), "utf8");
    const candidate = classifyCodexResetCandidate({
      source_url: options.manual,
      text,
      campaign_key: options.campaignKey,
    });
    if (!candidate) {
      throw new Error("Manual candidate failed author, relevance, or 48-hour validation");
    }
    candidates = [candidate];
  }

  const existing = readExisting(options.output);
  const reviewItems = mergeCodexResetCandidates(existing, candidates);
  writeAtomic(options.output, {
    version: 1,
    collected_at: new Date().toISOString(),
    review_items: reviewItems,
  });
  process.stdout.write(`Collected ${candidates.length} candidate post(s) into ${reviewItems.length} review item(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || "Candidate collection failed"}\n`);
  process.exitCode = 1;
});
