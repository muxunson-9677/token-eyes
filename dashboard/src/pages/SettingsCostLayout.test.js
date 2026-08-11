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
});
