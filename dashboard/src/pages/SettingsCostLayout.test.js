import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.resolve(process.cwd(), "src/ui/foundation/apple-glass.css"),
  "utf8",
);

describe("cost settings responsive layout contract", () => {
  it("uses the available page width and preserves readable side gutters", () => {
    expect(css).toMatch(/\.tt-settings-cost-page main > \.tt-settings-cost-shell\s*\{[\s\S]*?width:\s*100%;/);
    expect(css).toMatch(/\.tt-settings-cost-page main > \.tt-settings-cost-shell\s*\{[\s\S]*?padding-inline:\s*clamp\(0\.75rem,\s*1\.5vw,\s*1\.5rem\);/);
  });

  it("keeps the disclosure arrow beside the title and gives cards physical depth", () => {
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-surface button\[aria-expanded\] > span:last-of-type\s*\{[\s\S]*?flex:\s*0 1 auto;/);
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-surface:has\(button\[aria-expanded\]\)\s*\{[\s\S]*?box-shadow:\s*0 10px 28px/);
  });

  it("keeps five active plans on each desktop row, collapses their height immediately, and contains overflow", () => {
    expect(css).toMatch(/@media \(min-width:\s*720px\)\s*\{[\s\S]*?\.tt-settings-cost-page \.tt-token-plan-grid\s*\{[\s\S]*?repeat\(var\(--tt-token-plan-columns,\s*5\)/);
    expect(css).toMatch(/\.tt-main-scroll-region:has\(\.tt-settings-cost-page\)\s*\{[\s\S]*?scrollbar-width:\s*none;/);
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-section-card-body\s*\{[\s\S]*?overflow-y:\s*auto;/);
    const gridRule = css.match(/\.tt-settings-cost-page \.tt-token-plan-grid\s*\{[^}]*\}/)?.[0] ?? "";
    const cardRule = css.match(/\.tt-settings-cost-page \.tt-token-plan-grid \.tt-token-plan-card\s*\{[^}]*\}/)?.[0] ?? "";
    expect(gridRule).not.toMatch(/grid-auto-rows:\s*1fr/);
    expect(cardRule).not.toMatch(/height:\s*100%/);
  });

  it("keeps the new overview and plan surfaces readable in dark mode", () => {
    expect(css).toMatch(/\.dark \.tt-settings-cost-page \.tt-cost-overview-card[\s\S]*?background:\s*rgba\(17,\s*24,\s*39,\s*0\.72\);/);
    expect(css).toMatch(/\.dark \.tt-settings-cost-page \.tt-token-plan-grid \.tt-token-plan-card\s*\{[\s\S]*?background:\s*linear-gradient/);
    expect(css).toMatch(/\.dark \.tt-settings-cost-page \.tt-token-plan-summary-expiry\s*\{[\s\S]*?background:[^;]+;[\s\S]*?color:[^;]+;/);
  });

  it("aligns summaries with actions and never flashes action buttons white on hover", () => {
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-section-card-header\s*\{[^}]*align-items:\s*center;/s);
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-section-header-main\s*\{[^}]*align-items:\s*center;[^}]*flex-wrap:\s*nowrap;/s);
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-cost-header-action:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--tt-cost-accent-soft\);/s);
    expect(css).toMatch(/\.tt-settings-cost-page \.tt-cost-header-action-primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*[^;]+;[^}]*color:\s*[^;]+;/s);
  });
});
