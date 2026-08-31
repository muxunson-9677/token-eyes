import { describe, expect, it } from "vitest";
import * as widgetLimitGroups from "./widget-limit-groups.js";

function limit(id, overrides = {}) {
  return {
    id: `${id}:total`,
    planId: id,
    provider: "Codex",
    planLabel: id,
    accountLabel: `${id}@example.com`,
    window: "Total Usage",
    ...overrides,
  };
}

describe("widget limit plan groups", () => {
  it("preserves an empty plan label and the plan start boundary", () => {
    expect(widgetLimitGroups.groupWidgetLimits([limit("scheduled", {
      planLabel: "",
      accountLabel: "owner@example.com",
      startsAt: "2026-09-01T00:00:00.000Z",
    })])).toEqual([
      expect.objectContaining({
        id: "scheduled",
        planLabel: "",
        accountLabel: "owner@example.com",
        startsAt: "2026-09-01T00:00:00.000Z",
      }),
    ]);
  });

  it.each([0, 1, 2, 5, 10])(
    "splits active, scheduled, and %i expired plans with the shared validity semantics",
    (expiredCount) => {
      const split = widgetLimitGroups.splitWidgetLimitGroups;
      expect(split).toBeTypeOf("function");
      if (typeof split !== "function") return;
      const now = new Date("2026-08-30T12:00:00.000Z");
      const grouped = widgetLimitGroups.groupWidgetLimits([
        limit("active", { expiresAt: "2026-09-30T00:00:00.000Z" }),
        limit("scheduled", { startsAt: "2026-09-01T00:00:00.000Z" }),
        ...Array.from({ length: expiredCount }, (_, index) => limit(`expired-${index + 1}`, {
          expiresAt: "2026-08-01T00:00:00.000Z",
        })),
      ]);

      expect(split(grouped, now)).toEqual({
        active: [expect.objectContaining({ id: "active" })],
        scheduled: [expect.objectContaining({ id: "scheduled" })],
        expired: Array.from({ length: expiredCount }, (_, index) => (
          expect.objectContaining({ id: `expired-${index + 1}` })
        )),
      });
    },
  );

  it("treats date-only starts and ends as local calendar-day boundaries", () => {
    const [startingToday, endingToday] = widgetLimitGroups.groupWidgetLimits([
      limit("starting-today", { startsAt: "2026-09-01" }),
      limit("ending-today", { expiresAt: "2026-09-01" }),
    ]);

    expect(widgetLimitGroups.splitWidgetLimitGroups(
      [startingToday],
      new Date(2026, 8, 1, 0, 30),
    ).active).toEqual([startingToday]);
    expect(widgetLimitGroups.splitWidgetLimitGroups(
      [endingToday],
      new Date(2026, 8, 1, 23, 59, 59),
    ).active).toEqual([endingToday]);
    expect(widgetLimitGroups.splitWidgetLimitGroups(
      [endingToday],
      new Date(2026, 8, 2, 0, 0),
    ).expired).toEqual([endingToday]);
  });

  it("folds a configured Cursor Pro plan when the official membership is free", () => {
    const [cursor] = widgetLimitGroups.groupWidgetLimits([
      limit("cursor-plan", {
        agent: "cursor",
        provider: "Cursor",
        catalogPlanId: "cursor_pro",
        reportedPlanName: "free",
        expiresAt: null,
      }),
    ]);

    expect(widgetLimitGroups.splitWidgetLimitGroups(
      [cursor],
      new Date("2026-08-31T00:00:00.000Z"),
    ).expired).toEqual([cursor]);
  });
});
