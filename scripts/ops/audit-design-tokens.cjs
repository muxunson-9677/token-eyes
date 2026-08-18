// W5 design-token audit: lists every hardcoded hex/rgb(a) color literal and
// every hardcoded px border-radius in dashboard/src, with file:line context,
// so cleanup work can be planned. Read-only report — the enforcement ratchet
// lives in validate-ui-hardcode.cjs (npm run validate:ui-hardcode).
//
// Usage: node scripts/ops/audit-design-tokens.cjs [--json]

const fs = require("fs");
const path = require("path");

const { COLOR_REGEX, RADIUS_REGEX } = require("./validate-ui-hardcode-lib.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(ROOT, "dashboard", "src");
const EXT_REGEX = /[.](js|jsx|ts|tsx)$/;

function walk(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXT_REGEX.test(entry.name)) continue;
    results.push(fullPath);
  }
  return results;
}

function findMatches(content, regex) {
  const out = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const re = new RegExp(regex.source, regex.flags);
    let m;
    while ((m = re.exec(line))) {
      out.push({ line: idx + 1, match: m[0] });
    }
  });
  return out;
}

function main() {
  const asJson = process.argv.includes("--json");
  const files = walk(SRC_ROOT);
  const report = [];
  let totalColors = 0;
  let totalRadii = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf8");
    const colors = findMatches(content, COLOR_REGEX);
    const radii = findMatches(content, RADIUS_REGEX);
    if (!colors.length && !radii.length) continue;
    totalColors += colors.length;
    totalRadii += radii.length;
    report.push({ file: rel, colors, radii });
  }

  report.sort((a, b) => (b.colors.length + b.radii.length) - (a.colors.length + a.radii.length));

  if (asJson) {
    console.log(JSON.stringify({ totals: { colors: totalColors, radii: totalRadii }, files: report }, null, 2));
    return;
  }

  console.log(`Design token audit (dashboard/src): colors=${totalColors}, radii=${totalRadii}`);
  for (const entry of report) {
    console.log(`\n${entry.file} (colors=${entry.colors.length}, radii=${entry.radii.length})`);
    for (const c of entry.colors) console.log(`  L${c.line} color ${c.match}`);
    for (const r of entry.radii) console.log(`  L${r.line} radius ${r.match}`);
  }
}

main();
