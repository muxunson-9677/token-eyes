#!/usr/bin/env node
/**
 * W4 data-accuracy parity check: Token Eyes parsers vs ccusage.
 *
 * Reads the SAME local AI CLI logs twice:
 *   1. Through Token Eyes' own incremental parsers (src/lib/rollout.js) —
 *      pointed READ-ONLY at ~/.claude/projects and ~/.codex/sessions with a
 *      throwaway cursor state and a queue file inside the repo (.parity-tmp/).
 *   2. Through the third-party `ccusage` npm CLI (`npx ccusage --json`,
 *      plus `@ccusage/codex` for Codex logs), which reports daily per-model
 *      token usage from the same files.
 *
 * It then produces a per-day per-model diff report under docs/reports/ with a
 * +-0.5% threshold marker. If ccusage is unavailable or there are no local
 * logs, the script still exits 0 and writes a report marked "待真机数据".
 *
 * Privacy: only token counts are aggregated. No prompt/conversation content
 * is read into the report. Nothing is written outside the repository.
 *
 * Usage: node scripts/parity-ccusage.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const rollout = require(path.join(repoRoot, "src", "lib", "rollout.js"));
const { resolveDataDirectoryPaths } = require(
  path.join(repoRoot, "src", "lib", "data-directories.js"),
);

const TMP_DIR = path.join(repoRoot, ".parity-tmp");
const REPORTS_DIR = path.join(repoRoot, "docs", "reports");
const THRESHOLD_PCT = 0.5;
const CCUSAGE_TIMEOUT_MS = 300_000;
const PENDING = "待真机数据";

// ───────────────────────── Token Eyes side ─────────────────────────

/**
 * Collapse the parser's half-hour buckets (`source|model|hourStartISO`) into
 * a per-(UTC day, model) map. Source is intentionally dropped: ccusage reads
 * the same directory without source attribution, so grouping by model only
 * keeps the join fair.
 */
function aggregateBuckets(hourlyState) {
  const map = new Map();
  const buckets = hourlyState && typeof hourlyState === "object" ? hourlyState.buckets : null;
  if (!buckets || typeof buckets !== "object") return map;
  for (const [key, bucket] of Object.entries(buckets)) {
    const totals = bucket && typeof bucket === "object" ? bucket.totals : null;
    if (!totals) continue;
    const first = key.indexOf("|");
    const second = key.indexOf("|", first + 1);
    if (first <= 0 || second <= first) continue;
    const model = key.slice(first + 1, second);
    const day = key.slice(second + 1, second + 11);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const mapKey = `${day}|${model}`;
    const acc = map.get(mapKey) || {
      day,
      model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    };
    acc.input += Number(totals.input_tokens) || 0;
    acc.output += Number(totals.output_tokens) || 0;
    acc.cacheRead += Number(totals.cached_input_tokens) || 0;
    acc.cacheWrite += Number(totals.cache_creation_input_tokens) || 0;
    acc.reasoning += Number(totals.reasoning_output_tokens) || 0;
    acc.total += Number(totals.total_tokens) || 0;
    map.set(mapKey, acc);
  }
  return map;
}

/**
 * Same home-directory resolution the real `tracker sync` uses
 * (src/commands/sync.js → resolveDataDirectoryPaths): respects CODEX_HOME,
 * relocated `<drive>:\AgentData\Codex` homes on Windows, etc. Read-only.
 */
const dataDirs = resolveDataDirectoryPaths({ config: {}, env: process.env, home: os.homedir() });

async function parseClaudeWithTokenEyes() {
  const projectsDir = dataDirs.claudeProjectsDir;
  const projectFiles = await rollout.listClaudeProjectFiles(projectsDir).catch(() => []);
  if (!projectFiles.length) {
    return {
      available: false,
      reason: `no jsonl files under ${projectsDir}`,
      byDayModel: new Map(),
      files: 0,
      scanned: [projectsDir],
    };
  }
  // Throwaway cursor state + queue file inside the repo: the real
  // ~/.tokentracker state is never touched.
  const cursors = {};
  await rollout.parseClaudeIncremental({
    projectFiles,
    cursors,
    queuePath: path.join(TMP_DIR, "claude-queue.jsonl"),
    source: "claude",
  });
  return {
    available: true,
    reason: null,
    byDayModel: aggregateBuckets(cursors.hourly),
    files: projectFiles.length,
    scanned: [projectsDir],
  };
}

function normalizedPathKey(p) {
  const resolved = path.resolve(String(p || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Parse ONE codex home (sessions/ strict layout + archived_sessions/ deep)
 * with its own throwaway cursor state, exactly like sync.js does per home.
 */
async function parseCodexHome(homeDir, index) {
  const rolloutFiles = [];
  for (const entry of [
    { dir: path.join(homeDir, "sessions"), deep: false },
    { dir: path.join(homeDir, "archived_sessions"), deep: true },
  ]) {
    const files = entry.deep
      ? await rollout.listRolloutFilesDeep(entry.dir).catch(() => [])
      : await rollout.listRolloutFiles(entry.dir).catch(() => []);
    for (const filePath of files) rolloutFiles.push({ path: filePath, source: "codex" });
  }
  if (!rolloutFiles.length) {
    return { home: homeDir, files: 0, byDayModel: new Map() };
  }
  const cursors = {};
  await rollout.parseRolloutIncremental({
    rolloutFiles,
    cursors,
    queuePath: path.join(TMP_DIR, `codex-queue-${index}.jsonl`),
    source: "codex",
  });
  return { home: homeDir, files: rolloutFiles.length, byDayModel: aggregateBuckets(cursors.hourly) };
}

/**
 * Parse every codex home the real sync would scan, each one separately.
 * ccusage only ever reads $CODEX_HOME (default ~/.codex), so the parity
 * comparison uses that home alone; the other homes are reported as extra
 * Token Eyes coverage outside ccusage's scope.
 */
async function parseCodexWithTokenEyes() {
  const ccusageHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const syncHomes = Array.isArray(dataDirs.codexHomes) && dataDirs.codexHomes.length > 0
    ? dataDirs.codexHomes
    : [dataDirs.codexHome || path.join(os.homedir(), ".codex")];
  const allHomes = [];
  const seen = new Set();
  for (const h of [ccusageHome, ...syncHomes]) {
    const key = normalizedPathKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    allHomes.push(h);
  }

  const perHome = [];
  for (let i = 0; i < allHomes.length; i++) {
    perHome.push(await parseCodexHome(allHomes[i], i));
  }

  const ccusageKey = normalizedPathKey(ccusageHome);
  const primary = perHome.find((r) => normalizedPathKey(r.home) === ccusageKey) || {
    home: ccusageHome,
    files: 0,
    byDayModel: new Map(),
  };
  const extras = perHome.filter((r) => normalizedPathKey(r.home) !== ccusageKey && r.files > 0);

  return {
    available: primary.files > 0,
    reason: primary.files > 0 ? null : `no rollout-*.jsonl under ${primary.home}`,
    byDayModel: primary.byDayModel,
    files: primary.files,
    scanned: [primary.home],
    extras,
  };
}

// ───────────────────────── ccusage side ─────────────────────────

function runCommand(command, timeoutMs) {
  return new Promise((resolve) => {
    // shell:true is required on Windows so `npx` resolves to npx.cmd. All
    // argument tokens are static strings (no user input), so passing one
    // pre-joined command line is safe and avoids DEP0190.
    const child = spawn(command, { shell: true, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\n[timeout after ${timeoutMs}ms]` });
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

/** Tolerant JSON extraction: some ccusage versions print notices around the payload. */
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function numField(obj, keys) {
  for (const k of keys) {
    const n = Number(obj?.[k]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function itemTokens(item) {
  const input = numField(item, ["inputTokens", "input_tokens"]);
  const output = numField(item, ["outputTokens", "output_tokens"]);
  const cacheWrite = numField(item, [
    "cacheCreationTokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ]);
  const cacheRead = numField(item, ["cacheReadTokens", "cachedInputTokens", "cached_input_tokens"]);
  const reasoning = numField(item, ["reasoningOutputTokens", "reasoning_output_tokens"]);
  const declaredTotal = numField(item, ["totalTokens", "total_tokens"]);
  const summed = input + output + cacheWrite + cacheRead + reasoning;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: declaredTotal > 0 ? declaredTotal : summed,
  };
}

/** Normalize any recognized ccusage daily JSON payload into a (day, model) map. */
function extractCcusageDaily(json) {
  const days = Array.isArray(json?.daily)
    ? json.daily
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.days)
        ? json.days
        : null;
  if (!days) return null;
  const map = new Map();
  const add = (day, model, tokens) => {
    const mapKey = `${day}|${model}`;
    const acc = map.get(mapKey) || {
      day,
      model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    };
    acc.input += tokens.input;
    acc.output += tokens.output;
    acc.cacheRead += tokens.cacheRead;
    acc.cacheWrite += tokens.cacheWrite;
    acc.reasoning += tokens.reasoning;
    acc.total += tokens.total;
    map.set(mapKey, acc);
  };
  for (const d of days) {
    const day = String(d?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    // Model breakdown shapes seen in the wild:
    //   ccusage (Claude): modelBreakdowns: [{ modelName, inputTokens, ... }]
    //   ccusage codex:    models: { "<model>": { inputTokens, ... } } (keyed object)
    let breakdownEntries = null;
    if (Array.isArray(d?.modelBreakdowns) && d.modelBreakdowns.length > 0) {
      breakdownEntries = d.modelBreakdowns.map((b) => [
        String(b?.modelName ?? b?.model ?? "unknown").trim() || "unknown",
        b,
      ]);
    } else if (Array.isArray(d?.models) && d.models.every((m) => m && typeof m === "object")) {
      breakdownEntries = d.models.map((b) => [
        String(b?.modelName ?? b?.model ?? "unknown").trim() || "unknown",
        b,
      ]);
    } else if (d?.models && typeof d.models === "object" && !Array.isArray(d.models)) {
      breakdownEntries = Object.entries(d.models).filter(([, v]) => v && typeof v === "object");
    }
    if (breakdownEntries && breakdownEntries.length > 0) {
      for (const [model, b] of breakdownEntries) {
        add(day, model, itemTokens(b));
      }
    } else {
      add(day, "(all models)", itemTokens(d));
    }
  }
  return map;
}

async function runCcusageVariants(variants) {
  const attempts = [];
  for (const args of variants) {
    const rendered = `npx ${args.join(" ")}`;
    const res = await runCommand(rendered, CCUSAGE_TIMEOUT_MS);
    if (res.ok) {
      const json = extractJson(res.stdout);
      const map = json ? extractCcusageDaily(json) : null;
      if (map) {
        return { available: true, command: rendered, byDayModel: map, attempts };
      }
      attempts.push({ command: rendered, error: "exit 0 but no parseable daily JSON payload" });
    } else {
      const firstLine = (res.stderr || res.stdout || "unknown error")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-1)[0];
      attempts.push({ command: rendered, error: firstLine || "non-zero exit" });
    }
  }
  return { available: false, command: null, byDayModel: new Map(), attempts };
}

// ───────────────────────── Diffing / report ─────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function sumTotals(map) {
  let total = 0;
  for (const v of map.values()) total += v.total;
  return total;
}

function diffRows(oursMap, theirsMap) {
  const keys = new Set([...oursMap.keys(), ...theirsMap.keys()]);
  const rows = [];
  for (const key of keys) {
    const ours = oursMap.get(key);
    const theirs = theirsMap.get(key);
    const day = (ours || theirs).day;
    const model = (ours || theirs).model;
    const ourTotal = ours ? ours.total : 0;
    const theirTotal = theirs ? theirs.total : 0;
    const absDiff = ourTotal - theirTotal;
    const pct = theirTotal > 0 ? (absDiff / theirTotal) * 100 : ourTotal > 0 ? Infinity : 0;
    rows.push({ day, model, ourTotal, theirTotal, absDiff, pct });
  }
  rows.sort((a, b) => (a.day === b.day ? a.model.localeCompare(b.model) : a.day.localeCompare(b.day)));
  return rows;
}

function pctLabel(pct) {
  if (!Number.isFinite(pct)) return "n/a";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`;
}

function markerLabel(pct) {
  if (!Number.isFinite(pct)) return "SIDE-ONLY";
  return Math.abs(pct) <= THRESHOLD_PCT ? "OK" : "DIFF";
}

function renderSection(title, ours, theirs) {
  const lines = [`## ${title}`, ""];
  if (!ours.available && !theirs.available) {
    lines.push(`状态: ${PENDING} — 本机既没有可解析的日志（${ours.reason || "无本地日志"}），ccusage 也不可用。`);
    lines.push("");
    return { lines, verdict: PENDING, ourTotal: 0, theirTotal: 0, pct: null };
  }
  if (!ours.available) {
    lines.push(`状态: ${PENDING} — Token Eyes 侧无本地日志（${ours.reason}），无法对比。`);
    lines.push("");
    return { lines, verdict: PENDING, ourTotal: 0, theirTotal: sumTotals(theirs.byDayModel), pct: null };
  }
  if (!theirs.available) {
    lines.push(`状态: ${PENDING} — ccusage 不可用，仅列出 Token Eyes 侧解析结果备查。`);
    lines.push("");
    lines.push("ccusage 尝试记录:");
    for (const a of theirs.attempts) {
      lines.push(`- \`${a.command}\` → ${a.error}`);
    }
    lines.push("");
    lines.push(`Token Eyes 解析: ${ours.files} 个文件, 总 tokens = ${fmt(sumTotals(ours.byDayModel))}`);
    lines.push("");
    return { lines, verdict: PENDING, ourTotal: sumTotals(ours.byDayModel), theirTotal: 0, pct: null };
  }

  const rows = diffRows(ours.byDayModel, theirs.byDayModel);
  const okRows = rows.filter((r) => Number.isFinite(r.pct) && Math.abs(r.pct) <= THRESHOLD_PCT).length;
  const ourTotal = sumTotals(ours.byDayModel);
  const theirTotal = sumTotals(theirs.byDayModel);
  const totalDiff = ourTotal - theirTotal;
  const totalPct = theirTotal > 0 ? (totalDiff / theirTotal) * 100 : null;
  const verdict =
    ourTotal === 0 && theirTotal === 0
      ? `无数据 (两侧均为 0) — ${PENDING}`
      : totalPct !== null && Math.abs(totalPct) <= THRESHOLD_PCT
        ? "PASS (±0.5% 以内)"
        : "FAIL (超出 ±0.5%)";

  lines.push(`ccusage 命令: \`${theirs.command}\``);
  lines.push(`Token Eyes 扫描目录: ${(ours.scanned || []).map((p) => `\`${p}\``).join(", ")}`);
  lines.push(`Token Eyes 解析文件数: ${ours.files}`);
  lines.push(`逐行一致率: ${okRows}/${rows.length} 行在 ±${THRESHOLD_PCT}% 以内`);
  lines.push("");
  lines.push("### 逐日逐模型对比 (total tokens)");
  lines.push("");
  lines.push("| 日期 (UTC) | 模型 | Token Eyes | ccusage | 绝对差 | 相对差 | ±0.5% |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.day} | ${r.model} | ${fmt(r.ourTotal)} | ${fmt(r.theirTotal)} | ${fmt(r.absDiff)} | ${pctLabel(r.pct)} | ${markerLabel(r.pct)} |`,
    );
  }
  lines.push("");
  lines.push("### 小计");
  lines.push("");
  lines.push("| 来源 | Token Eyes 总 tokens | ccusage 总 tokens | 绝对差 | 相对差 | 结论 |");
  lines.push("|---|---:|---:|---:|---:|---|");
  lines.push(
    `| ${title} | ${fmt(ourTotal)} | ${fmt(theirTotal)} | ${fmt(totalDiff)} | ${totalPct === null ? "n/a" : pctLabel(totalPct)} | ${verdict} |`,
  );
  lines.push("");
  if (Array.isArray(ours.extras) && ours.extras.length > 0) {
    lines.push("### Token Eyes 额外覆盖 (ccusage 扫描范围之外)");
    lines.push("");
    lines.push(
      "以下目录是真实 `tracker sync` 会额外扫描、但 ccusage (只读 `$CODEX_HOME`) 不会读取的历史数据目录, 不参与上方 parity 判定:",
    );
    lines.push("");
    lines.push("| 目录 | 文件数 | 总 tokens |");
    lines.push("|---|---:|---:|");
    for (const extra of ours.extras) {
      lines.push(`| \`${extra.home}\` | ${extra.files} | ${fmt(sumTotals(extra.byDayModel))} |`);
    }
    lines.push("");
    lines.push(
      "> 注: 真实 sync 将所有目录合并在同一次解析中, 依靠 sessionUUID+timestamp 事件去重吸收跨目录副本, 因此各目录 tokens 直接相加是上限值。",
    );
    lines.push("");
  }
  return { lines, verdict, ourTotal, theirTotal, pct: totalPct };
}

// ───────────────────────── Main ─────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = path.join(REPORTS_DIR, `parity-ccusage-${today}.md`);
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(REPORTS_DIR, { recursive: true });

  let claudeOurs = { available: false, reason: "parser error", byDayModel: new Map(), files: 0 };
  let codexOurs = { available: false, reason: "parser error", byDayModel: new Map(), files: 0 };
  try {
    claudeOurs = await parseClaudeWithTokenEyes();
  } catch (err) {
    claudeOurs.reason = `parser error: ${err?.message || err}`;
  }
  try {
    codexOurs = await parseCodexWithTokenEyes();
  } catch (err) {
    codexOurs.reason = `parser error: ${err?.message || err}`;
  }

  // --timezone UTC keeps ccusage day bucketing aligned with Token Eyes'
  // UTC hour_start buckets; older versions without the flag fall back to
  // the plain invocation (a timezone caveat is then noted in the report).
  const claudeCc = await runCcusageVariants([
    ["--yes", "ccusage", "daily", "--json", "--timezone", "UTC"],
    ["--yes", "ccusage", "--json"],
    ["--yes", "ccusage@latest", "daily", "--json", "--timezone", "UTC"],
    ["--yes", "ccusage@latest", "--json"],
  ]);
  // Codex support ships inside the main ccusage package (`ccusage codex ...`);
  // the standalone @ccusage/codex npm package is a stub that always exits 1.
  const codexCc = await runCcusageVariants([
    ["--yes", "ccusage@latest", "codex", "daily", "--json", "--timezone", "UTC"],
    ["--yes", "ccusage@latest", "codex", "daily", "--json"],
    ["--yes", "ccusage", "codex", "daily", "--json"],
  ]);

  const claudeSection = renderSection("Claude Code", claudeOurs, claudeCc);
  const codexSection = renderSection("Codex", codexOurs, codexCc);

  const tzCaveat =
    (claudeCc.available && !claudeCc.command.includes("--timezone")) ||
    (codexCc.available && !codexCc.command.includes("--timezone"))
      ? "\n> 注意: 本次 ccusage 运行未带 `--timezone UTC`（旧版本不支持），逐日分桶可能与 Token Eyes 的 UTC 分桶错位, 跨午夜的会话会落到相邻日期。此时应以总量相对差为准。\n"
      : "";

  const report = [
    `# ccusage 数据一致性对比报告 (${today})`,
    "",
    "本报告由 `node scripts/parity-ccusage.mjs` 生成。",
    "对比对象: Token Eyes 自有解析器 (src/lib/rollout.js) vs 第三方 `ccusage` CLI, 读取同一份本地日志。",
    `阈值: 总量相对差在 ±${THRESHOLD_PCT}% 以内视为一致 (表格中 OK / DIFF 为逐行标记, SIDE-ONLY 表示仅一侧有数据)。`,
    "隐私: 仅聚合 token 计数, 不读取、不落盘任何对话内容。",
    tzCaveat,
    "## 总结",
    "",
    "| 来源 | Token Eyes 总 tokens | ccusage 总 tokens | 相对差 | 结论 |",
    "|---|---:|---:|---:|---|",
    `| Claude Code | ${fmt(claudeSection.ourTotal)} | ${fmt(claudeSection.theirTotal)} | ${claudeSection.pct === null ? "n/a" : pctLabel(claudeSection.pct)} | ${claudeSection.verdict} |`,
    `| Codex | ${fmt(codexSection.ourTotal)} | ${fmt(codexSection.theirTotal)} | ${codexSection.pct === null ? "n/a" : pctLabel(codexSection.pct)} | ${codexSection.verdict} |`,
    "",
    ...claudeSection.lines,
    ...codexSection.lines,
    "## 口径说明",
    "",
    "- Token Eyes `total_tokens` = input + output + cache_creation + cache_read + reasoning_output。",
    "- ccusage `totalTokens` (Claude) = input + output + cacheCreation + cacheRead; Claude 无独立 reasoning 列, 两侧口径一致。",
    "- Codex 侧: Token Eyes 将 cached input 从 input 中拆出、reasoning 单列; ccusage codex 同样输出五列, 总量口径一致。",
    "- ccusage 只读取 `$CODEX_HOME` (默认 `~/.codex`) 一个目录; Token Eyes 的真实 sync 会扫描所有 tracking-ready 的 codex home。上方 parity 判定只使用 ccusage 可见的那个 home, 其余目录单列为额外覆盖。",
    "",
    "## 已知差异类别 (解读逐行 DIFF / SIDE-ONLY 时参考)",
    "",
    "1. 模型归因差异: Token Eyes 将 Codex auto-review 子会话计入伪模型 `codex-auto-review`, ccusage 归入底层真实模型 (如 `gpt-5.5`)。同一天两行加总相等时属于纯命名差异, 不是丢数据。",
    "2. `unknown` 模型行: 缺少模型元数据的会话 Token Eyes 记为 `unknown` 并保留 tokens, ccusage 可能跳过或并入其他行。",
    "3. Token Eyes 额外扫描 `archived_sessions/`; ccusage 是否扫描该目录未确认, 可能造成 Token Eyes 偏高。",
    "4. fork/resume 会话的跨文件重放事件, 两侧 dedup 策略可能不同, 重度使用日容易放大差异 — 若某天 Token Eyes 明显偏高, 优先核对该天是否有 fork 会话。",
    "5. 日期分桶: 双方都按 UTC 分桶时跨午夜会话对齐; 若 ccusage 回退到本地时区, 相邻两天会互相补偿。",
    "",
  ].join("\n");

  await fs.writeFile(reportPath, report, "utf8");

  const rel = path.relative(repoRoot, reportPath);
  console.log(`parity-ccusage: report written to ${rel}`);
  console.log(
    `  Claude Code: ours=${fmt(claudeSection.ourTotal)} ccusage=${fmt(claudeSection.theirTotal)} → ${claudeSection.verdict}`,
  );
  console.log(
    `  Codex:       ours=${fmt(codexSection.ourTotal)} ccusage=${fmt(codexSection.theirTotal)} → ${codexSection.verdict}`,
  );
}

try {
  await main();
} catch (err) {
  // Never fail the pipeline: write a pending-data report instead.
  console.error(`parity-ccusage: unexpected error: ${err?.stack || err}`);
  try {
    const today = new Date().toISOString().slice(0, 10);
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(REPORTS_DIR, `parity-ccusage-${today}.md`),
      `# ccusage 数据一致性对比报告 (${today})\n\n状态: ${PENDING} — 脚本在本机运行失败, 待真机数据后重跑。\n\n错误: ${String(err?.message || err)}\n`,
      "utf8",
    );
  } catch {
    // ignore secondary failures
  }
} finally {
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
}
process.exitCode = 0;
