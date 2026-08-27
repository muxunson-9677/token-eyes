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

test("value comparison source names wrap instead of hiding long provider labels", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const sourceNameRule = stylesheet.match(/\.vr-source-name\s*\{[^}]*\}/)?.[0] || "";

  assert.match(sourceNameRule, /white-space:\s*normal/);
  assert.match(sourceNameRule, /overflow:\s*visible/);
  assert.doesNotMatch(sourceNameRule, /overflow:\s*hidden/);
});

test("reference-sized value and Agent cards stay compact without stacking at desktop width", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const valueCardRule = stylesheet.match(/\.vr-value-card\s*\{[^}]*\}/)?.[0] || "";
  const agentCardRule = stylesheet.match(/\.rt-session-mini\s*\{[^}]*\}/)?.[0] || "";
  const miniDataRule = stylesheet.match(/\.rt-mini-data\s*\{[^}]*\}/)?.[0] || "";
  const desktopBreakpoint = stylesheet.match(/@media \(max-width: 1360px\)\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(valueCardRule, /height:\s*154px/);
  assert.match(valueCardRule, /box-sizing:\s*border-box/);
  assert.match(agentCardRule, /height:\s*90px/);
  assert.match(agentCardRule, /justify-content:\s*center/);
  assert.match(miniDataRule, /flex-wrap:\s*nowrap/);
  assert.doesNotMatch(desktopBreakpoint, /\.vr-value-flow\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(stylesheet, /\.rt-focus-top\s*\{[^}]*grid-template-columns:\s*1\.2fr\s+\.85fr\s+\.75fr\s+\.95fr/);
  assert.doesNotMatch(stylesheet, /\.rt-focus-art\s*\{/);
});

test("compact desktop keeps value labels readable without collapsing the three-card flow", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const compositionRule = stylesheet.match(/\.vr-composition-row\s*\{[^}]*\}/)?.[0] || "";
  const compactDesktopBlock = stylesheet.match(/@media \(max-width: 1360px\)\s*\{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(compositionRule, /grid-template-columns:\s*minmax\(76px,\s*90px\)\s+minmax\(42px,\s*1fr\)\s+minmax\(64px,\s*max-content\)\s+44px/);
  assert.doesNotMatch(compactDesktopBlock, /\.vr-twin-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(compactDesktopBlock, /\.vr-value-number\s*\{[^}]*font-size:\s*32px/);
  assert.match(compactDesktopBlock, /\.vr-value-number--status\s*\{[^}]*font-size:\s*24px/);
  assert.match(compactDesktopBlock, /\.rt-session-viewport\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*calc\(\(100%\s*-\s*51px\)\s*\/\s*4\)\)/);
  assert.match(compactDesktopBlock, /\.rt-session-viewport\s*\{[^}]*overflow:\s*hidden/);
  assert.match(compactDesktopBlock, /\.rt-mini-name\s*\{[^}]*font-size:\s*11px/);
  assert.match(compactDesktopBlock, /\.rt-mini-name\s*\{[^}]*gap:\s*5px/);
  assert.doesNotMatch(compactDesktopBlock, /\.vr-value-flow\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("narrow desktop value cards keep both comparison badges inside the card", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const cardContentRule = stylesheet.match(/\.vr-value-card\s*>\s*div:last-child\s*\{[^}]*\}/)?.[0] || "";
  const sectionRule = stylesheet.match(/\.vr-section\s*\{[^}]*\}/)?.[0] || "";
  const tableCellRule = stylesheet.match(/\.vr-data-table td\s*\{[^}]*\}/)?.[0] || "";
  const narrowStart = stylesheet.indexOf("@media (min-width: 761px) and (max-width: 1300px)");
  const narrowEnd = stylesheet.indexOf("@media", narrowStart + 1);
  const narrowBlock = narrowStart >= 0 ? stylesheet.slice(narrowStart, narrowEnd >= 0 ? narrowEnd : undefined) : "";

  assert.match(cardContentRule, /min-width:\s*0/);
  assert.match(sectionRule, /height:\s*270px/);
  assert.match(sectionRule, /overflow:\s*clip/);
  assert.match(tableCellRule, /padding:\s*4px\s+8px/);
  assert.ok(narrowBlock, "missing narrow-desktop value-card breakpoint");
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-value-flow,\s*\.vr-page--value\s+\.vr-evidence-strip\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+16px\s+minmax\(0,\s*1fr\)\s+16px\s+minmax\(0,\s*1fr\)/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-value-meta\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-value-state,[^}]*\.vr-page--value\s+\.vr-value-badge\s*\{[^}]*font-size:\s*11px/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-evidence-strip\s*>\s*div\s*\{[^}]*font-size:\s*12px/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-comparison-columns\s*\{[^}]*gap:\s*8px/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-twin-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-comparison-columns\s*>\s*div\s*\+\s*div\s*\{[^}]*padding-left:\s*12px/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-composition-row\s*\{[^}]*grid-template-columns:\s*minmax\(60px,\s*72px\)\s+minmax\(20px,\s*1fr\)\s+minmax\(45px,\s*max-content\)\s+40px/);
  assert.match(narrowBlock, /\.vr-page--value\s+\.vr-composition-row\s*\{[^}]*column-gap:\s*3px/);
});

test("six-month positive bars use a definite-height flex container instead of a collapsed grid percentage", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const monthRule = stylesheet.match(/\.vr-month\s*\{[^}]*\}/)?.[0] || "";

  assert.match(monthRule, /display:\s*flex/);
  assert.match(monthRule, /height:\s*88px/);
  assert.match(monthRule, /align-items:\s*flex-end/);
  assert.match(stylesheet, /\.vr-month-series--actual\s*>\s*span\s*\{[^}]*background:\s*var\(--vr-blue\)/);
  assert.match(stylesheet, /\.vr-month-series--value\s*>\s*span\s*\{[^}]*background:\s*var\(--vr-green\)/);
  assert.match(stylesheet, /\.vr-month-series\s*\{[^}]*align-items:\s*center/);
  assert.match(stylesheet, /\.vr-month-series\s*\{[^}]*justify-content:\s*flex-end/);
});

test("value summary columns align to the same five-track flow as the three hero cards", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const flowRule = stylesheet.match(/\.vr-value-flow\s*\{[^}]*\}/)?.[0] || "";
  const evidenceRule = stylesheet.match(/\.vr-evidence-strip\s*\{[^}]*\}/)?.[0] || "";

  assert.match(flowRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+38px\s+minmax\(0,\s*1fr\)\s+38px\s+minmax\(0,\s*1fr\)/);
  assert.match(evidenceRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+38px\s+minmax\(0,\s*1fr\)\s+38px\s+minmax\(0,\s*1fr\)/);
  assert.match(stylesheet, /\.vr-evidence-cell--actual\s*\{[^}]*grid-column:\s*1/);
  assert.match(stylesheet, /\.vr-evidence-cell--value\s*\{[^}]*grid-column:\s*3/);
  assert.match(stylesheet, /\.vr-evidence-cell--coverage\s*\{[^}]*grid-column:\s*5/);
});

test("five composition rows fit inside the card and preserve their category colors", () => {
  const stylesheet = fs.readFileSync(path.join(__dirname, "..", "dashboard", "src", "pages", "value-realtime-pages.css"), "utf8");
  const rowRule = stylesheet.match(/\.vr-composition-row\s*\{[^}]*\}/)?.[0] || "";
  const unavailableDotRule = stylesheet.match(/\.vr-composition-row--unavailable\s+\.vr-dot\s*\{[^}]*\}/)?.[0] || "";

  assert.match(rowRule, /min-height:\s*30px/);
  assert.match(rowRule, /grid-template-columns:\s*minmax\(76px,\s*90px\)\s+minmax\(42px,\s*1fr\)\s+minmax\(64px,\s*max-content\)\s+44px/);
  assert.match(rowRule, /column-gap:\s*7px/);
  assert.doesNotMatch(unavailableDotRule, /background:/);
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
  assert.match(stylesheet, /\.vr-value-meta\s*\{[^}]*flex-wrap:\s*wrap[^}]*white-space:\s*normal/);
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
