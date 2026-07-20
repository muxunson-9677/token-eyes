#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createSignedCodexResetFeedEnvelope,
  validateCodexResetFeedPayload,
} = require("../src/lib/codex-reset-feed");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--private", "--input", "--output"].includes(name) || !value) {
      throw new Error("Usage: --private <path> [--input <reviewed.json>] --output <path>");
    }
    options[name.slice(2)] = path.resolve(value);
  }
  if (!options.private || !options.output) {
    throw new Error("--private and --output are required");
  }
  return options;
}

function requireApprovedReview(item, nowMs) {
  let source;
  try {
    source = new URL(item.source_url);
  } catch {
    return;
  }
  if (source.hostname.toLowerCase() !== "x.com") return;
  const review = item.review;
  if (
    !review
    || review.status !== "approved"
    || review.source_verified !== true
    || typeof review.reviewed_by !== "string"
    || review.reviewed_by.trim().length === 0
    || review.reviewed_by.length > 80
  ) {
    throw new TypeError("Every X announcement requires explicit approved review metadata");
  }
  const reviewedAt = Date.parse(review.reviewed_at);
  if (!Number.isFinite(reviewedAt) || reviewedAt > nowMs + 5 * 60 * 1000) {
    throw new TypeError("X announcement review timestamp is invalid");
  }
}

function loadReviewedPayload(inputPath, nowMs) {
  if (!inputPath) {
    return {
      generated_at: new Date(nowMs).toISOString(),
      announcements: [],
    };
  }
  const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (Array.isArray(parsed?.review_items)) {
    throw new TypeError("Unreviewed candidate artifacts cannot be signed directly");
  }
  if (!Array.isArray(parsed?.announcements)) {
    throw new TypeError("Reviewed input must contain an announcements array");
  }
  const announcements = parsed.announcements.map((item) => {
    requireApprovedReview(item, nowMs);
    const { review: _review, ...announcement } = item;
    return announcement;
  });
  return {
    generated_at: new Date(nowMs).toISOString(),
    announcements,
  };
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
  const nowMs = Date.now();
  const payload = loadReviewedPayload(options.input, nowMs);
  validateCodexResetFeedPayload(payload, { nowMs });
  const privateKey = fs.readFileSync(options.private, "utf8");
  const envelope = createSignedCodexResetFeedEnvelope(payload, privateKey);
  writeAtomic(options.output, envelope);
  process.stdout.write(`Signed ${payload.announcements.length} reviewed Codex reset announcement(s).\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.message || "Feed signing failed"}\n`);
  process.exitCode = 1;
}
