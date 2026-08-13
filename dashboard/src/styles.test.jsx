// W5 design-token unification: core surfaces must stay free of hardcoded
// color literals and hardcoded px border-radius values — all styling goes
// through the styles.css token variables (--oai-*, --brand-*, --radius-*)
// or Tailwind semantic classes. The repo-wide ratchet lives in
// scripts/ops/validate-ui-hardcode.cjs; these assertions pin the cleaned
// files to zero so regressions fail fast in vitest as well.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEX_OR_RGB_REGEX =
  /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0?\.\d+|1(?:\.0+)?))?\s*\)/g;
const PX_RADIUS_REGEX =
  /\brounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[\d+(?:\.\d+)?px\]|\bborderRadius\s*:\s*["']\d+(?:\.\d+)?px["']/g;

// Core navigation / page surfaces: no raw colors AND no raw px radii.
const TOKEN_PURE_FILES = [
  "ui/components/Sidebar.jsx",
  "ui/dashboard/components/CostAccumulation.jsx",
  "ui/dashboard/components/RequestUsageLog.jsx",
  "pages/LimitsPage.jsx",
  "pages/SettingsPage.jsx",
  "pages/PlanMarketPage.jsx",
];

// Files whose hardcoded px radii were migrated to --radius-* tokens (W5).
// Colors are governed separately by the repo-wide ratchet.
const RADII_CLEAN_FILES = [
  "components/settings/Controls.jsx",
  "pages/SkillsPage.jsx",
  "pages/SkillDetailPanel.jsx",
];

function readSource(rel) {
  const abs = path.join(__dirname, rel);
  expect(fs.existsSync(abs), `${rel} must exist`).toBe(true);
  return fs.readFileSync(abs, "utf8");
}

describe("design token unification (W5)", () => {
  it.each(TOKEN_PURE_FILES)("%s contains no hardcoded color literals", (rel) => {
    const source = readSource(rel);
    const matches = source.match(HEX_OR_RGB_REGEX) || [];
    expect(matches, `hardcoded colors found: ${matches.join(", ")}`).toEqual([]);
  });

  it.each([...TOKEN_PURE_FILES, ...RADII_CLEAN_FILES])(
    "%s contains no hardcoded px border-radius",
    (rel) => {
      const source = readSource(rel);
      const matches = source.match(PX_RADIUS_REGEX) || [];
      expect(matches, `hardcoded radii found: ${matches.join(", ")}`).toEqual([]);
    },
  );

  it("styles.css defines the radius token scale used by the replacements", () => {
    const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
    for (const token of ["--radius-sm", "--radius-md", "--radius-lg", "--radius-xl"]) {
      expect(css.includes(`${token}:`), `${token} must be defined`).toBe(true);
    }
  });
});
