"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("focus billing method wraps instead of truncating at the compact desktop breakpoint", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");

  assert.match(stylesheet, /@media \(max-width: 1360px\)[\s\S]*?\.rt-focus-footer strong\s*\{[^}]*white-space:\s*normal/);
  assert.match(stylesheet, /@media \(max-width: 1360px\)[\s\S]*?\.rt-focus-footer strong\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test("reference-sized Agent cards stay compact without stacking at desktop width", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const agentCardRule = stylesheet.match(/\.rt-session-mini\s*\{[^}]*\}/)?.[0] || "";
  const miniDataRule = stylesheet.match(/\.rt-mini-data\s*\{[^}]*\}/)?.[0] || "";

  assert.match(agentCardRule, /height:\s*90px/);
  assert.match(agentCardRule, /justify-content:\s*center/);
  assert.match(miniDataRule, /flex-wrap:\s*nowrap/);
  assert.match(stylesheet, /\.rt-focus-top\s*\{[^}]*grid-template-columns:\s*1\.2fr\s+\.85fr\s+\.75fr\s+\.95fr/);
  assert.doesNotMatch(stylesheet, /\.rt-focus-art\s*\{/);
});

test("compact desktop keeps the Agent strip readable", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const compactDesktopBlock = stylesheet.match(/@media \(max-width: 1360px\)\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(compactDesktopBlock, /\.rt-session-viewport\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*calc\(\(100%\s*-\s*51px\)\s*\/\s*4\)\)/);
  assert.match(compactDesktopBlock, /\.rt-session-viewport\s*\{[^}]*overflow:\s*hidden/);
  assert.match(compactDesktopBlock, /\.rt-mini-name\s*\{[^}]*font-size:\s*11px/);
  assert.match(compactDesktopBlock, /\.rt-mini-name\s*\{[^}]*gap:\s*5px/);
});

test("Agent metrics align below the name and coverage content has no conflicting divider", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const miniDataRule = stylesheet.match(/\.rt-mini-data\s*\{[^}]*\}/)?.[0] || "";
  const coverageRule = stylesheet.match(/\.rt-side-content\.rt-coverage\s*\{[^}]*\}/)?.[0] || "";

  assert.match(miniDataRule, /margin-left:\s*30px/);
  assert.match(miniDataRule, /margin-right:\s*8px/);
  assert.match(coverageRule, /border-top:\s*0/);
});

test("Agent strip keeps cards left aligned and stacks both pagination controls on the right", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  assert.match(stylesheet, /\.rt-session-strip\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+38px/u);
  assert.match(stylesheet, /\.rt-session-controls\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/u);
  assert.match(stylesheet, /\.rt-session-controls\s*\{[^}]*justify-content:\s*center/u);
});

test("realtime analysis and the three-card side stack share one stretched bottom edge", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const workspaceRule = stylesheet.match(/\.rt-workspace\s*\{[^}]*\}/)?.[0] || "";
  const sideRule = stylesheet.match(/\.rt-side\s*\{[^}]*\}/)?.[0] || "";

  assert.match(workspaceRule, /align-items:\s*stretch/);
  assert.match(sideRule, /height:\s*100%/);
  assert.match(sideRule, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
});

test("reference-height realtime workspace does not add an extra blank 18px", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const analysisRule = stylesheet.match(/\.rt-analysis\s*\{[^}]*\}/)?.[0] || "";
  assert.match(analysisRule, /min-height:\s*288px/);
});

test("only a genuinely wide tall desktop uses enlarged reference proportions", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const blockStart = stylesheet.indexOf("@media (min-width: 1760px) and (min-height: 1040px)");
  const blockEnd = stylesheet.indexOf("@media", blockStart + 1);
  const largeDesktopBlock = blockStart >= 0 ? stylesheet.slice(blockStart, blockEnd >= 0 ? blockEnd : undefined) : "";

  assert.ok(largeDesktopBlock, "missing large-desktop reference scaling block");
  assert.doesNotMatch(stylesheet, /@media \(min-width: 1361px\) and \(min-height: 1040px\)/);
  assert.match(stylesheet, /\.vr-head\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(stylesheet, /\.vr-controls\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.doesNotMatch(largeDesktopBlock, /\d+(?:\.\d+)?vh/u, "independent viewport-height stretching distorts the reference rhythm");
  assert.match(largeDesktopBlock, /\.vr-page\s*\{[^}]*max-width:\s*1682px/);
  assert.match(largeDesktopBlock, /\.vr-page\s*\{[^}]*margin-inline:\s*auto/);
  assert.match(largeDesktopBlock, /--vr-type-page-title:\s*38px/);
  assert.match(largeDesktopBlock, /--vr-type-kpi:\s*37px/);
  assert.match(largeDesktopBlock, /--vr-type-body:\s*17px/);
  assert.match(largeDesktopBlock, /\.vr-page--realtime\s+\.rt-kpi\s*\{[^}]*min-height:\s*154px/);
  assert.match(largeDesktopBlock, /\.vr-page--realtime\s+\.rt-session-mini\s*\{[^}]*height:\s*111px/);
  assert.match(largeDesktopBlock, /\.vr-page--realtime\s+\.rt-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+29%/);
  assert.match(largeDesktopBlock, /\.vr-page--realtime\s+\.rt-side\s*\{[^}]*grid-template-rows:\s*81fr\s+125fr\s+49fr/);
});

test("reference reconstruction uses one shared visual system instead of page-local magic values", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const pageRule = stylesheet.match(/\.vr-page\s*\{[^}]*\}/)?.[0] || "";

  for (const token of [
    "--vr-space-1", "--vr-space-2", "--vr-space-3", "--vr-space-4", "--vr-space-5", "--vr-space-6",
    "--vr-radius-hero", "--vr-radius-card", "--vr-shadow-card", "--vr-shadow-hero",
    "--vr-type-page-title", "--vr-type-kpi", "--vr-type-card-title",
  ]) assert.match(pageRule, new RegExp(`${token}:`), `missing shared token ${token}`);
});

test("reference pages remove the giant outer card and restore the wide desktop canvas", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");

  assert.doesNotMatch(stylesheet, /\.tt-app-shell:has\(\.vr-page\)[^{]*\{[^}]*--tt-sidebar-width/);
  assert.doesNotMatch(stylesheet, /\.tt-app-shell:has\(\.vr-page\)\s+\.tt-desktop-sidebar/);
  assert.match(stylesheet, /\.tt-native-main-frame:has\(\.vr-page\)\s*\{[^}]*padding:\s*0\s*!important/);
  assert.match(stylesheet, /\.tt-main-work-surface:has\(\.vr-page\)\s*\{[^}]*border-radius:\s*0/);
  assert.match(stylesheet, /\.tt-main-work-surface:has\(\.vr-page\)\s*\{[^}]*box-shadow:\s*none/);
});

test("focus card has a real hero surface instead of relying on a blue outline", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const focusRule = stylesheet.match(/\.rt-focus\s*\{[^}]*\}/)?.[0] || "";

  assert.match(focusRule, /background:\s*var\(--vr-hero-blue\)/);
  assert.match(focusRule, /box-shadow:\s*var\(--vr-shadow-hero\)/);
  assert.match(focusRule, /border-radius:\s*var\(--vr-radius-hero\)/);
});
