import { describe, expect, it } from "vitest";
import copyCsv from "./copy.csv?raw";
import coreJson from "./i18n/zh/core.json?raw";
import dashboardJson from "./i18n/zh/dashboard.json?raw";
import marketingJson from "./i18n/zh/marketing.json?raw";

describe("Token Eyes user-facing brand copy", () => {
  it("does not expose the retired TokenTracker product name", () => {
    const files = [
      ["copy.csv", copyCsv],
      ["i18n/zh/core.json", coreJson],
      ["i18n/zh/dashboard.json", dashboardJson],
      ["i18n/zh/marketing.json", marketingJson],
    ] as const;

    const retiredBrandOccurrences = files.flatMap(([file, content]) => (
      Array.from(content.matchAll(/TokenTracker(?:Bar)?/g), (match) => ({
        file,
        value: match[0] ?? "",
      }))
    ));

    expect(retiredBrandOccurrences).toEqual([]);
    const storageRegistryLine = copyCsv.split(/\r?\n/).find((line) => (
      line.startsWith("data_sources.storage_path,")
    ));
    const localizedStorageValue = JSON.parse(dashboardJson)["data_sources.storage_path"];
    expect(storageRegistryLine).not.toMatch(/tokentracker/i);
    expect(localizedStorageValue).not.toMatch(/tokentracker/i);
  });
});
