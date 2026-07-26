"use strict";

const SENSITIVE_KEYS = new Set(["prompt", "messages", "message", "response", "response_body", "api_key", "access_token", "refresh_token", "cookie", "account_id", "raw_account_id", "secret"]);

function escapeCsvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function rowsToCsv(rows, columns) { return `${[columns, ...(rows || []).map((row) => columns.map((column) => escapeCsvCell(row[column])))].map((line) => line.join(",")).join("\n")}\n`; }
function projectDisplayName(value) { const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean); return parts.at(-1) || null; }
function redactExportRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    if (key === "session_key") { out.session_key = null; continue; }
    if (key === "project_key") { out.project_key = projectDisplayName(value); continue; }
    if (key === "dimensions" && value && typeof value === "object") out.dimensions = { ...value, session_key: null, account_scope: null, project_key: projectDisplayName(value.project_key) };
    else out[key] = value;
  }
  return out;
}
function exportRows(rows, { format = "json" } = {}) {
  const redacted = (rows || []).map(redactExportRecord);
  if (format === "json") return `${JSON.stringify(redacted, null, 2)}\n`;
  const columns = ["hour_start", "source", "model", "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_input_tokens", "reasoning_output_tokens", "total_tokens", "conversation_count"];
  return rowsToCsv(redacted, columns);
}
module.exports = { escapeCsvCell, rowsToCsv, redactExportRecord, exportRows, projectDisplayName };
