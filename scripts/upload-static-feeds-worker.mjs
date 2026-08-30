#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FIXED_UPLOADS = [
  ["plan-market", "plan-market"],
  ["codex-reset", "codex-reset"],
];

function parseArgs(argv) {
  const options = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--execute") {
      options.execute = true;
      continue;
    }
    const value = argv[index + 1];
    if (!["--origin", "--plan-market", "--codex-reset"].includes(name) || !value) {
      throw new Error("Usage: --origin <https://worker> [--plan-market <feed.json>] [--codex-reset <feed.json>] [--execute]");
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  const origin = new URL(options.origin || "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/"
    || origin.search || origin.hash) {
    throw new TypeError("A fixed HTTPS Worker origin is required");
  }
  const uploads = FIXED_UPLOADS.flatMap(([optionName, feed]) => {
    if (!options[optionName]) return [];
    const file = path.resolve(options[optionName]);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new TypeError(`${optionName} feed file does not exist`);
    }
    const body = fs.readFileSync(file, "utf8").trim();
    JSON.parse(body);
    return [{ file, body, url: new URL(`/internal/static-feed/${feed}`, origin).toString() }];
  });
  if (uploads.length === 0) throw new TypeError("At least one fixed feed file is required");
  return { ...options, origin: origin.toString(), uploads };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = options.uploads.map(({ file, url }) => ({ file, url }));
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", uploads: plan }, null, 2)}\n`);
    return;
  }
  const secret = process.env.LEADERBOARD_PUBLISHER_SECRET;
  if (!secret) throw new Error("--execute requires LEADERBOARD_PUBLISHER_SECRET");
  const results = [];
  for (const upload of options.uploads) {
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Leaderboard-Publisher-Secret": secret,
      },
      body: upload.body,
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`Worker upload failed with HTTP ${response.status}: ${responseBody}`);
    results.push({ url: upload.url, status: response.status, result: JSON.parse(responseBody) });
  }
  process.stdout.write(`${JSON.stringify({ mode: "execute", uploads: results }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.message || "Static feed upload failed"}\n`);
  process.exitCode = 1;
});
