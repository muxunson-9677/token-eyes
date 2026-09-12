const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

it("pairs widget dark text with dark outer surfaces and readable secondary text", () => {
  const css = fs.readFileSync(path.join(__dirname, "../dashboard/src/ui/foundation/apple-glass.css"), "utf8");
  for (const selector of [".tt-widget-summary article", ".tt-widget-projects", ".tt-widget-limits"]) {
    const rule = css.slice(css.indexOf(`:root.dark ${selector}`)).split("}")[0];
    assert.match(rule, /background:\s*var\(--tt-page-surface\)/, selector);
    assert.match(rule, /color:\s*var\(--tt-page-ink\)/, selector);
  }
  assert.match(css, /:root\.dark \.tt-widget-section-title small[\s\S]*?color:\s*var\(--tt-page-muted\)/);
  assert.match(css, /:root\.dark \.tt-widget-summary article div > span,[\s\S]*?color:\s*var\(--tt-page-muted\)/);
  assert.match(css, /:root\.dark \.tt-widget-summary article small,[\s\S]*?color:\s*var\(--tt-page-muted\)/);
});
