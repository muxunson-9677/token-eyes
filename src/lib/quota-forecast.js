"use strict";

const { normalizeDataEvidence } = require("./data-evidence");
const { selectCycleSamples } = require("./quota-history");

const ADVICE = Object.freeze({ NORMAL: "normal", CAUTION: "caution", DANGER: "danger", INSUFFICIENT: "insufficient" });
const CONFIDENCE = Object.freeze({ HIGH: "high", MEDIUM: "medium", LOW: "low", INSUFFICIENT: "insufficient" });
const MIN_SAMPLES = 3;
const MIN_SPAN_MS = 10 * 60 * 1000;

function toMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

function cleanSamples(samples) {
  const out = [];
  for (const sample of [...(samples || [])].sort((a, b) => toMs(a.observed_at) - toMs(b.observed_at))) {
    if (!Number.isFinite(Number(sample?.used_percent)) || !Number.isFinite(toMs(sample?.observed_at)) || sample?.evidence?.is_stale) continue;
    const previous = out[out.length - 1];
    if (previous?.observed_at === sample.observed_at) continue;
    if (previous?.used_percent === sample.used_percent && toMs(sample.observed_at) - toMs(previous.observed_at) < 60_000) continue;
    out.push(sample);
  }
  return out;
}

function slopesPerHour(samples) {
  const slopes = [];
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const deltaMs = toMs(samples[j].observed_at) - toMs(samples[i].observed_at);
      if (deltaMs > 0) slopes.push(((samples[j].used_percent - samples[i].used_percent) / deltaMs) * 3_600_000);
    }
  }
  return slopes;
}

function windowRate(samples, nowMs, durationMs) {
  const local = samples.filter((sample) => toMs(sample.observed_at) >= nowMs - durationMs);
  return median(slopesPerHour(local.length >= 2 ? local : samples));
}

function computePaceFields(window, nowMs) {
  const used = Number(window?.used_percent);
  const resetMs = toMs(window?.reset_at);
  const seconds = Number(window?.window_seconds);
  if (!Number.isFinite(used) || !Number.isFinite(resetMs) || !(seconds > 0)) return { time_elapsed_percent: null, pace_ratio: null };
  const elapsed = Math.min(seconds, Math.max(0, (nowMs - (resetMs - seconds * 1000)) / 1000));
  const timeElapsedPercent = (elapsed / seconds) * 100;
  return { time_elapsed_percent: timeElapsedPercent, pace_ratio: timeElapsedPercent > 0 ? used / timeElapsedPercent : null };
}

function confidence(sampleCount, spanMs) {
  if (sampleCount >= 8 && spanMs >= 45 * 60 * 1000) return CONFIDENCE.HIGH;
  if (sampleCount >= 5 && spanMs >= 20 * 60 * 1000) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.LOW;
}

function forecastEvidence(nowMs, sourceUpdatedAt, noteCode) {
  return normalizeDataEvidence({
    source_kind: "estimated", accuracy: "estimated", coverage: "partial", observed_at: new Date(nowMs).toISOString(),
    source_updated_at: sourceUpdatedAt || null, stale_after_seconds: 300, pricing_source: null, pricing_version: null, note_code: noteCode,
  }, { nowMs });
}

function buildResult({ accountKey, window, nowMs, samples, pace, slope = null, slopeLow = null, slopeHigh = null }) {
  const used = Number(window?.used_percent);
  const remaining = Number.isFinite(used) ? Math.max(0, 100 - used) : null;
  const resetMs = toMs(window?.reset_at);
  const estimate = (rate) => rate > 0.01 && remaining != null ? new Date(nowMs + (remaining / rate) * 3_600_000).toISOString() : null;
  const exhaustAt = estimate(slope);
  const exhaustsBeforeReset = exhaustAt && Number.isFinite(resetMs) ? toMs(exhaustAt) < resetMs : slope != null && slope <= 0.01 ? false : null;
  let advice = ADVICE.NORMAL;
  if (slope == null || !Number.isFinite(used)) advice = ADVICE.INSUFFICIENT;
  else if (slope > 0.01 && (exhaustsBeforeReset && (pace.pace_ratio == null || pace.pace_ratio >= 1.25 || used >= 85))) advice = ADVICE.DANGER;
  else if (slope > 0.01 && (exhaustsBeforeReset || (pace.pace_ratio != null && pace.pace_ratio >= 1.1))) advice = ADVICE.CAUTION;
  return {
    account_key: accountKey, window_kind: window?.kind || null, window_label: window?.label || null,
    used_percent: Number.isFinite(used) ? used : null, ...pace,
    burn_rate_15m: windowRate(samples, nowMs, 15 * 60 * 1000), burn_rate_30m: windowRate(samples, nowMs, 30 * 60 * 1000), burn_rate_60m: windowRate(samples, nowMs, 60 * 60 * 1000),
    exhaust_at: exhaustAt, exhaust_at_low: estimate(slopeHigh), exhaust_at_high: estimate(slopeLow), exhausts_before_reset: exhaustsBeforeReset,
    sample_count: samples.length, confidence: slope == null ? CONFIDENCE.INSUFFICIENT : confidence(samples.length, toMs(samples.at(-1)?.observed_at) - toMs(samples[0]?.observed_at)),
    advice, evidence: forecastEvidence(nowMs, samples.at(-1)?.observed_at, slope == null ? "forecast_insufficient_samples" : "quota_forecast_estimated"),
  };
}

function computeQuotaForecast({ samples, window, accountKey, nowMs = Date.now() } = {}) {
  const cleaned = cleanSamples(samples);
  const pace = computePaceFields(window, nowMs);
  const spanMs = cleaned.length >= 2 ? toMs(cleaned.at(-1).observed_at) - toMs(cleaned[0].observed_at) : 0;
  if (cleaned.length < MIN_SAMPLES || spanMs < MIN_SPAN_MS) return buildResult({ accountKey, window, nowMs, samples: cleaned, pace });
  const slopes = slopesPerHour(cleaned);
  return buildResult({ accountKey, window, nowMs, samples: cleaned, pace, slope: median(slopes), slopeLow: percentile(slopes, 0.25), slopeHigh: percentile(slopes, 0.75) });
}

function computeQuotaForecastsForAccounts(accounts, allSamples, { nowMs = Date.now() } = {}) {
  const forecasts = [];
  for (const account of accounts || []) {
    for (const window of account?.windows || []) {
      if (window?.used_percent == null) continue;
      forecasts.push(computeQuotaForecast({ accountKey: account.account_key, window, nowMs, samples: selectCycleSamples(allSamples, { accountKey: account.account_key, windowKind: window.kind, windowLabel: window.label }) }));
    }
  }
  return forecasts;
}

module.exports = { ADVICE, CONFIDENCE, MIN_SAMPLES, MIN_SPAN_MS, computePaceFields, computeQuotaForecast, computeQuotaForecastsForAccounts };
