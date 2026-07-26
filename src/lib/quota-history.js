"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeDataEvidence } = require("./data-evidence");
const { isEvidenceStale } = require("./data-freshness");

const QUOTA_SAMPLES_RELATIVE_PATH = path.join(".tokentracker", "quota-samples.jsonl");
const USED_PERCENT_DROP_CYCLE_THRESHOLD = 5;
const MAX_SAMPLES_KEPT = 5000;

function samplesPath(home) {
  return path.join(home || os.homedir(), QUOTA_SAMPLES_RELATIVE_PATH);
}

function optionalIso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeSample(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!["account_key", "provider_id", "window_kind", "window_label"].every((key) => typeof raw[key] === "string" && raw[key])) return null;
  const usedPercent = Number(raw.used_percent);
  const observedAt = optionalIso(raw.observed_at);
  if (!Number.isFinite(usedPercent) || !observedAt) return null;
  let evidence;
  try {
    evidence = normalizeDataEvidence(raw.evidence || {
      source_kind: "official_api", accuracy: "unknown", coverage: "partial", observed_at: observedAt,
      source_updated_at: null, stale_after_seconds: 300, pricing_source: null, pricing_version: null, note_code: null,
    }, { nowMs: Date.parse(observedAt) });
  } catch {
    return null;
  }
  return {
    account_key: raw.account_key,
    provider_id: raw.provider_id,
    window_kind: raw.window_kind,
    window_label: raw.window_label,
    used_percent: Math.min(100, Math.max(0, usedPercent)),
    reset_at: optionalIso(raw.reset_at),
    window_seconds: Number.isInteger(raw.window_seconds) && raw.window_seconds >= 0 ? raw.window_seconds : null,
    observed_at: observedAt,
    evidence,
  };
}

function readQuotaSamples({ home } = {}) {
  let content;
  try { content = fs.readFileSync(samplesPath(home), "utf8"); } catch { return []; }
  const samples = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const sample = normalizeSample(JSON.parse(line));
      if (sample) samples.push(sample);
    } catch { /* ignore corrupt line */ }
  }
  return samples.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
}

function writeAllSamples(samples, { home } = {}) {
  const filePath = samplesPath(home);
  const kept = samples.slice(-MAX_SAMPLES_KEPT);
  const body = kept.map((sample) => JSON.stringify(sample)).join("\n") + (kept.length ? "\n" : "");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, body, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.writeFileSync(filePath, body, { encoding: "utf8", mode: 0o600 });
    try { fs.unlinkSync(tempPath); } catch { /* already absent */ }
  }
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows */ }
}

function sampleKey(sample) {
  return `${sample.account_key}\0${sample.window_kind}\0${sample.window_label}`;
}

function isDuplicate(previous, next) {
  return Boolean(previous) && (
    previous.observed_at === next.observed_at
    || (previous.used_percent === next.used_percent
      && previous.reset_at === next.reset_at
      && Math.abs(Date.parse(next.observed_at) - Date.parse(previous.observed_at)) < 60_000)
  );
}

function shouldStartNewCycle(previous, next) {
  return Boolean(previous) && (
    previous.reset_at !== next.reset_at
    || next.used_percent + USED_PERCENT_DROP_CYCLE_THRESHOLD < previous.used_percent
  );
}

function selectCycleSamples(samples, { accountKey, windowKind, windowLabel } = {}) {
  const filtered = (samples || []).filter((sample) => sample.account_key === accountKey
    && sample.window_kind === windowKind && sample.window_label === windowLabel)
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  let cycleStart = 0;
  for (let index = 1; index < filtered.length; index += 1) {
    if (shouldStartNewCycle(filtered[index - 1], filtered[index])) cycleStart = index;
  }
  return filtered.slice(cycleStart);
}

function buildSampleFromWindow(account, window, { nowMs }) {
  if (!account || !window || ["unavailable", "auth_error", "rate_limited"].includes(account.status)) return null;
  if (!Number.isFinite(Number(window.used_percent)) || !window.evidence || isEvidenceStale(window.evidence, nowMs)) return null;
  const observedAt = optionalIso(window.evidence.observed_at) || new Date(nowMs).toISOString();
  return normalizeSample({
    account_key: account.account_key, provider_id: account.provider_id, window_kind: window.kind, window_label: window.label,
    used_percent: window.used_percent, reset_at: window.reset_at, window_seconds: window.window_seconds, observed_at: observedAt,
    evidence: window.evidence,
  });
}

function appendQuotaSamplesFromAccounts(accounts, { home, nowMs = Date.now() } = {}) {
  const existing = readQuotaSamples({ home });
  const lastByKey = new Map(existing.map((sample) => [sampleKey(sample), sample]));
  const additions = [];
  for (const account of accounts || []) {
    for (const window of account?.windows || []) {
      const sample = buildSampleFromWindow(account, window, { nowMs });
      if (!sample) continue;
      const previous = lastByKey.get(sampleKey(sample));
      if (previous && Date.parse(sample.observed_at) < Date.parse(previous.observed_at)) continue;
      if (isDuplicate(previous, sample)) continue;
      additions.push(sample);
      lastByKey.set(sampleKey(sample), sample);
    }
  }
  if (additions.length) writeAllSamples(existing.concat(additions), { home });
  return additions.length;
}

module.exports = {
  QUOTA_SAMPLES_RELATIVE_PATH,
  USED_PERCENT_DROP_CYCLE_THRESHOLD,
  appendQuotaSamplesFromAccounts,
  readQuotaSamples,
  selectCycleSamples,
  shouldStartNewCycle,
};
