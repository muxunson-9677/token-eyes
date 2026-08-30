/** @vitest-environment jsdom */
import { expect, it } from "vitest";
import { shouldReportAutoRefreshError } from "../lib/background-refresh-error.js";

it("does not report a background refresh that is cancelled while the dashboard unmounts", () => {
  expect(shouldReportAutoRefreshError(new TypeError("Failed to fetch"), false)).toBe(false);
  expect(shouldReportAutoRefreshError(new DOMException("Aborted", "AbortError"), true)).toBe(false);
  expect(shouldReportAutoRefreshError(new Error("upstream unavailable"), true)).toBe(true);
});
