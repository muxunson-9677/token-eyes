"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  assert.equal(fs.existsSync(absolutePath), true, `${relativePath} must exist`);
  return fs.readFileSync(absolutePath, "utf8");
}

test("Windows ships one independent desktop-widget route and Tauri window module", () => {
  const app = read("dashboard/src/App.jsx");
  assert.match(app, /\/desktop-widget/u);
  assert.equal(
    fs.existsSync(path.join(ROOT, "dashboard/src/pages/DesktopWidgetPage.tsx")),
    true,
  );
  assert.equal(fs.existsSync(path.join(ROOT, "src-tauri/src/widget_window.rs")), true);
});

test("widget reset acknowledgement has no automatic dismissal or navigation side effect", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  assert.doesNotMatch(widget, /setTimeout\s*\([^)]*(dismiss|acknowledge)/u);
  assert.doesNotMatch(widget, /(navigate|location\.(assign|href)|open)\s*\([^)]*reset/u);
  assert.match(widget, /acknowledgePendingReset/u);
});

test("widget implementation keeps a single vertical content scroll region", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const regions = widget.match(/data-widget-scroll-region/g) || [];
  assert.equal(regions.length, 1);
});

test("compact widget menus stay inside the native 72px window", () => {
  const widget = read("dashboard/src/pages/DesktopWidgetPage.tsx");
  const css = read("dashboard/src/pages/desktop-widget.css");
  assert.match(widget, /data-menu-kind/u);
  assert.match(css, /@media\s*\(max-height:\s*120px\)/u);
  assert.match(css, /grid-auto-flow:\s*column/u);
});
