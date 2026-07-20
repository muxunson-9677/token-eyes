const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("desktop startup keeps cloud-only libraries out of static entry imports", () => {
  const app = read("dashboard/src/App.jsx");
  const insforgeConfig = read("dashboard/src/lib/insforge-config.ts");

  assert.doesNotMatch(insforgeConfig, /^import\s+\{\s*createClient\s*\}\s+from\s+["']@insforge\/sdk["']/m);
  assert.match(insforgeConfig, /import\(["']@insforge\/sdk["']\)/);
  assert.doesNotMatch(app, /^import\s+\{\s*Analytics\s*\}\s+from\s+["']@vercel\/analytics\/react["']/m);
  assert.doesNotMatch(app, /^import\s+\{\s*SpeedInsights\s*\}\s+from\s+["']@vercel\/speed-insights\/react["']/m);
  assert.doesNotMatch(app, /^import\s+\{\s*LoginModal\s*\}\s+from\s+["']\.\/components\/LoginModal\.jsx["']/m);
  assert.doesNotMatch(app, /^import\s+\{\s*CommandPalette\s*\}\s+from\s+["']\.\/ui\/dashboard\/components\/CommandPalette\.jsx["']/m);
});

test("native OAuth callback capture stays eager while startup exposes timing markers", () => {
  const app = read("dashboard/src/App.jsx");
  const main = read("dashboard/src/main.jsx");

  assert.match(app, /^import\s+\{\s*NativeAuthCallbackPage\s*\}\s+from\s+["']\.\/pages\/NativeAuthCallbackPage\.jsx["'];/m);
  assert.doesNotMatch(app, /lazy\([^)]*NativeAuthCallbackPage/s);
  assert.match(main, /token-eyes-react-start/);
  assert.match(main, /token-eyes-interactive/);
});

test("route chunks keep a visible Token Eyes shell instead of clearing to a blank window", () => {
  const app = read("dashboard/src/App.jsx");
  const splash = read("dashboard/src/components/AppBootSplash.jsx");

  assert.match(app, /^import\s+\{\s*AppBootSplash\s*\}\s+from\s+["']\.\/components\/AppBootSplash\.jsx["'];/m);
  assert.match(app, /<Suspense\s+fallback=\{<AppBootSplash\s*\/>\}>\{content\}<\/Suspense>/);
  assert.doesNotMatch(app, /<Suspense\s+fallback=\{null\}>\{content\}<\/Suspense>/);
  assert.match(app, /isTauriMode[\s\S]*?<AppBootSplash\s*\/>[\s\S]*?<Navigate\s+to="\/settings\/basic"\s+replace\s*\/>/);
  assert.match(splash, /boot-splash/);
  assert.match(splash, /copy\("shared\.app_name"\)/);
});

test("basic settings startup does not statically import cost-only sections", () => {
  const settings = read("dashboard/src/pages/SettingsPage.jsx");

  for (const moduleName of ["TokenPlanSection", "ProviderApiConfigSection", "OtherAiSpendSection"]) {
    assert.doesNotMatch(settings, new RegExp(`^import\\s+\\{\\s*${moduleName}\\s*\\}`, "m"));
    assert.match(settings, new RegExp(`lazy\\(\\(\\) =>\\s*\\n?\\s*import\\(["'][^"']*${moduleName}\\.jsx["']\\)`));
  }
});

test("startup benchmark is repository-scoped and terminates only launched process IDs", () => {
  const script = read("scripts/benchmark-token-eyes-startup.ps1");
  assert.match(script, /src-tauri[\\/]target[\\/]release[\\/]token-eyes\.exe/i);
  assert.match(script, /Start-Process\s+-FilePath\s+\$ExePath\s+-PassThru/i);
  assert.match(script, /Stop-Process\s+-Id\s+\$process\.Id/i);
  assert.doesNotMatch(script, /CC Switch/i);
  assert.doesNotMatch(script, /Get-Process\s+(?!-Id)/i);
});
