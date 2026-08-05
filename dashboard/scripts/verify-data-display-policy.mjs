import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productFiles = [
  "src/pages/DashboardPage.jsx",
  "src/pages/LeaderboardPage.jsx",
  "src/lib/model-breakdown.ts",
  "src/ui/dashboard/components/UsageOverview.jsx",
  "src/ui/dashboard/components/UsageStatsPanel.jsx",
  "src/ui/dashboard/components/CostAccumulation.jsx",
  "src/ui/dashboard/components/CostAnalysisModal.jsx",
  "src/ui/dashboard/components/ProjectUsagePanel.jsx",
  "src/ui/dashboard/components/RequestUsageLog.jsx",
  "src/ui/dashboard/components/TokenServiceList.jsx",
  "src/components/settings/ProviderApiConfigSection.jsx",
  "src/pages/DataSourcesPage.jsx",
];

const forbidden = [
  { name: "shared short-placeholder copy", pattern: /copy\(["']shared\.placeholder\.short["']\)/ },
  { name: "literal dash data node", pattern: />\s*[-—]\s*</ },
  { name: "dash missing-value ternary", pattern: /\?\s*["'][-—]["']\s*:/ },
  { name: "dash fallback", pattern: /(?:\|\||\?\?)\s*["'][-—]["']/ },
];

const failures = [];
for (const relativePath of productFiles) {
  const source = await readFile(path.join(dashboardRoot, relativePath), "utf8");
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        failures.push(`${relativePath}:${index + 1} [${rule.name}] ${line.trim()}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Data display policy violations:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Data display policy passed for ${productFiles.length} product files.`);
}
