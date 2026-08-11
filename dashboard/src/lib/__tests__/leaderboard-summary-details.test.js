import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const modulePath = join(process.cwd(), "src/lib/leaderboard-summary-details.js");

describe("leaderboard summary details module", () => {
  it("keeps the dynamically imported leaderboard dependency available", () => {
    const moduleExists = existsSync(modulePath);
    expect(moduleExists).toBe(true);
  });
});
