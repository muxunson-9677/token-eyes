"use strict";
const TRAY_DENSITY = Object.freeze({ MINIMAL: "minimal", STANDARD: "standard", FULL: "full" });
function countdown(resetAt, nowMs) { const ms = Date.parse(resetAt) - nowMs; if (!Number.isFinite(ms) || ms <= 0) return null; const minutes = Math.floor(ms / 60_000); return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`; }
function key(forecast) { return `${forecast.account_key}\0${forecast.window_kind}\0${forecast.window_label}`; }
function buildTrayCompactView(accounts, forecasts, { density = TRAY_DENSITY.STANDARD, nowMs = Date.now() } = {}) {
  const forecastByKey = new Map((forecasts || []).map((forecast) => [key(forecast), forecast]));
  const rows = [];
  for (const account of accounts || []) for (const window of account?.windows || []) if (Number.isFinite(Number(window.used_percent))) rows.push({ account_key: account.account_key, provider_id: account.provider_id, account_label: account.account_label, status: account.status, window_kind: window.kind, window_label: window.label, used_percent: Number(window.used_percent), reset_at: window.reset_at || null, advice: forecastByKey.get(`${account.account_key}\0${window.kind}\0${window.label}`)?.advice || null });
  rows.sort((a, b) => ({ danger: 3, caution: 2, normal: 1 }[b.advice] || 0) - ({ danger: 3, caution: 2, normal: 1 }[a.advice] || 0) || b.used_percent - a.used_percent || String(a.provider_id).localeCompare(String(b.provider_id)));
  const top = rows[0] || null;
  if (!top) return { density, title: "额度不可用", lines: [], status: "unavailable" };
  const title = density === TRAY_DENSITY.MINIMAL ? `${String(top.provider_id).slice(0, 3)} ${Math.round(top.used_percent)}%${countdown(top.reset_at, nowMs) ? ` · ${countdown(top.reset_at, nowMs)}` : ""}` : `${top.provider_id} ${top.window_label} ${Math.round(top.used_percent)}%`;
  return { density, title, status: top.advice === "danger" ? "danger" : top.status === "stale" ? "stale" : "ok", lines: density === TRAY_DENSITY.FULL ? rows.map((row) => `${row.provider_id} ${row.window_label} ${Math.round(row.used_percent)}%${countdown(row.reset_at, nowMs) ? ` · ${countdown(row.reset_at, nowMs)}` : ""}`) : [], top };
}
module.exports = { TRAY_DENSITY, buildTrayCompactView };
