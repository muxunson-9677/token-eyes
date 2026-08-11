import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const viteConfigSource = fs.readFileSync(
  path.resolve(process.cwd(), "vite.config.js"),
  "utf8",
);

describe("local development data routing", () => {
  it("serves every cost page read endpoint from the in-process local API fallback", () => {
    const fallbackBlock = viteConfigSource.match(
      /const DEV_LOCAL_DATA_FALLBACK_PATHS = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1] || "";

    expect(fallbackBlock).toContain('"/functions/tokentracker-api-billing-accounts"');
    expect(fallbackBlock).toContain('"/functions/tokentracker-provider-api-configs"');
    expect(fallbackBlock).toContain('"/functions/tokentracker-provider-api-balances"');
    expect(fallbackBlock).toContain('"/functions/tokentracker-provider-api-refresh"');
    expect(fallbackBlock).toContain('"/api/local-auth"');
    expect(viteConfigSource).toContain('req.url.startsWith("/api/local-auth")');
  });

  it("serves the data-sources health endpoints from the same local read-only fallback", () => {
    const fallbackBlock = viteConfigSource.match(
      /const DEV_LOCAL_DATA_FALLBACK_PATHS = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1] || "";

    expect(fallbackBlock).toContain('"/functions/tokentracker-agent-environment"');
    expect(fallbackBlock).toContain('"/functions/tokentracker-usage-summary"');
  });

  it("includes ledger integrity diagnostics in the development usage summary", () => {
    const usageSummaryBlock = viteConfigSource.match(
      /if \(pathname === "\/functions\/tokentracker-usage-summary"\) \{([\s\S]*?)\/\/ .*usage-daily/,
    )?.[1] || "";

    expect(usageSummaryBlock).toContain("data_integrity:");
    expect(usageSummaryBlock).toContain("readQueueDiagnostics(rows.length)");
    expect(viteConfigSource).toContain("raw_records:");
    expect(viteConfigSource).toContain("visible_records:");
    expect(viteConfigSource).toContain("duplicate_records:");
    expect(viteConfigSource).toContain("malformed_records:");
  });
});
