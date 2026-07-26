#!/usr/bin/env node
/**
 * Build a self-contained single HTML file for Trae contest submission.
 * Runs dashboard production build (single chunk + mock data), then inlines assets.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dashboard", "dist");
const OUT_DIR = path.join(ROOT, "trae-contest-submission");
const OUT_FILE = path.join(OUT_DIR, "token-eyes-demo.html");

function mimeForFont(file) {
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

function inlineAssetUrls(css, distDir) {
  return css.replace(/url\(\.\/assets\/([^)]+)\)/g, (match, file) => {
    const assetPath = path.join(distDir, "assets", file);
    if (!fs.existsSync(assetPath)) return match;
    const data = fs.readFileSync(assetPath);
    const mime = mimeForFont(file);
    return `url(data:${mime};base64,${data.toString("base64")})`;
  });
}

function runDashboardBuild() {
  const dashboardDir = path.join(ROOT, "dashboard");
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCmd, ["run", "build"], {
    cwd: dashboardDir,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      TOKENTRACKER_SINGLE_FILE: "1",
      VITE_TOKENTRACKER_MOCK: "1",
      VITE_TOKENTRACKER_HASH_ROUTER: "1",
    },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function packageHtml() {
  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error("Missing dashboard/dist/index.html — run:");
    console.error("  cd dashboard && TOKENTRACKER_SINGLE_FILE=1 VITE_TOKENTRACKER_MOCK=1 npm run build");
    process.exit(1);
  }

  let html = fs.readFileSync(indexPath, "utf8");

  const jsMatch = html.match(/src="\.\/assets\/(main-[^"]+\.js)"/);
  const cssMatch = html.match(/href="\.\/assets\/(main-[^"]+\.css)"/);
  if (!jsMatch || !cssMatch) {
    console.error("Could not find main JS/CSS references in dist/index.html");
    process.exit(1);
  }

  const jsPath = path.join(DIST, "assets", jsMatch[1]);
  const cssPath = path.join(DIST, "assets", cssMatch[1]);
  const js = fs.readFileSync(jsPath, "utf8");
  let css = fs.readFileSync(cssPath, "utf8");
  css = inlineAssetUrls(css, DIST);

  html = html.replace(/<script type="module"[^>]*><\/script>\s*/i, "");
  html = html.replace(/<link rel="stylesheet"[^>]*>\s*/i, "");

  const bootstrap = `<script>
(function(){
  function logErr(label, e) {
    try { console.error(label, e); } catch (_) {}
  }
  window.addEventListener('error', function(e) { logErr('[JS Error]', e.error || e.message); });
  window.addEventListener('unhandledrejection', function(e) { logErr('[Promise Error]', e.reason); });

  // Mock demo data + contest showcase (sidebar navigation, no login).
  window.__TOKENTRACKER_FORCE_MOCK__ = true;
  window.__TOKENTRACKER_CONTEST_SHOWCASE__ = true;
  try {
    var p = new URLSearchParams(window.location.search || "");
    if (!p.has("mock")) p.set("mock", "true");
    if (!p.has("contest")) p.set("contest", "1");
    var hash = window.location.hash || "";
    if (!hash || hash === "#" || hash === "#/") hash = "#/dashboard";
    var u = window.location.pathname + "?" + p.toString() + hash;
    window.history.replaceState({}, "", u);
  } catch (e) {}

  // file:// cannot use BrowserRouter absolute paths (/login). Pretend localhost + swallow bad history writes.
  if (window.location.protocol === "file:") {
    try {
      Object.defineProperty(window.location, "hostname", { configurable: true, get: function () { return "localhost"; } });
      Object.defineProperty(window.location, "host", { configurable: true, get: function () { return "localhost"; } });
      Object.defineProperty(window.location, "origin", { configurable: true, get: function () { return "http://localhost"; } });
    } catch (e) {}
    var origReplace = window.history.replaceState.bind(window.history);
    var origPush = window.history.pushState.bind(window.history);
    function safeHistory(fn) {
      return function (state, title, url) {
        try { return fn(state, title, url); } catch (e) { /* file:// navigation blocked */ }
      };
    }
    window.history.replaceState = safeHistory(origReplace);
    window.history.pushState = safeHistory(origPush);
  }
})();
</script>`;

  if (!html.includes("</head>")) {
    console.error("Unexpected index.html structure");
    process.exit(1);
  }

  html = html.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
  html = html.replace("<head>", `<head>\n${bootstrap}`);

  // Boot splash subtitle for contest demo (not "starting local server")
  html = html.replace(
    "正在启动本地仪表盘…",
    "演示数据加载中…",
  );

  const scriptBlock = `<script type="module">\n${js}\n</script>`;
  const rootClose = html.indexOf("</div>", html.indexOf('id="root"'));
  if (rootClose === -1) {
    console.error('Could not find #root in index.html');
    process.exit(1);
  }
  const insertAt = rootClose + "</div>".length;
  html = html.slice(0, insertAt) + "\n" + scriptBlock + html.slice(insertAt);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, "utf8");

  const sizeMb = (fs.statSync(OUT_FILE).size / (1024 * 1024)).toFixed(2);
  console.log(`Wrote ${OUT_FILE} (${sizeMb} MB)`);
}

function main() {
  runDashboardBuild();
  packageHtml();
}

main();
