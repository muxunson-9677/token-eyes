"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  advanceWorkbuddyDailyObservation,
  groupWorkbuddyPackages,
  summarizeWorkbuddyQuota,
} = require("../src/lib/workbuddy-quota");

test("missing or invalid WorkBuddy capacity remains unknown instead of becoming exact zero", () => {
  for (const entry of [
    { Status: 0, PackageCode: "TCACA_code_001_PqouKr6QWV" },
    { Status: 0, PackageCode: "TCACA_code_001_PqouKr6QWV", CycleCapacitySize: "", CycleCapacityRemain: "" },
    { Status: 0, PackageCode: "TCACA_code_001_PqouKr6QWV", CycleCapacitySize: "not-a-number", CycleCapacityRemain: "not-a-number" },
  ]) {
    const { groups } = groupWorkbuddyPackages([entry]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].total, null);
    assert.equal(groups[0].remain, null);
    assert.equal(groups[0].used, null);
    assert.equal(groups[0].used_percent, null);
  }
});

test("complete WorkBuddy capacity preserves a real exact zero usage", () => {
  const { groups } = groupWorkbuddyPackages([{
    Status: 0,
    PackageCode: "TCACA_code_001_PqouKr6QWV",
    CycleCapacitySizePrecise: 100,
    CycleCapacityRemainPrecise: 100,
  }]);
  assert.deepEqual(groups[0], {
    id: "base",
    items: 1,
    total: 100,
    remain: 100,
    used: 0,
    used_percent: 0,
  });
});

test("WorkBuddy cards aggregate remaining points instead of exposing package-cycle usage buckets", () => {
  assert.deepEqual(summarizeWorkbuddyQuota([
    { id: "base", total: 300, remain: 180, used: 120 },
    { id: "activity", total: 4000, remain: 3700, used: 300 },
  ]), {
    total: 4300,
    remaining: 3880,
  });
  assert.deepEqual(summarizeWorkbuddyQuota([
    { id: "base", total: 300, remain: null, used: null },
  ]), {
    total: 300,
    remaining: null,
  });
});

test("WorkBuddy daily consumption is the observed same-day remaining-balance decrease and resets on refill or a new day", () => {
  const first = advanceWorkbuddyDailyObservation(null, {
    day: "2026-08-24",
    observedAt: "2026-08-24T06:00:00.000Z",
    remaining: 3880,
    total: 4300,
  });
  assert.equal(first.todayConsumed, 0);
  assert.equal(first.evidenceState, "observed");

  const later = advanceWorkbuddyDailyObservation(first.snapshot, {
    day: "2026-08-24",
    observedAt: "2026-08-24T14:00:00.000Z",
    remaining: 3824.5,
    total: 4300,
  });
  assert.equal(later.todayConsumed, 55.5);
  assert.equal(later.snapshot.first_remaining, 3880);

  const refill = advanceWorkbuddyDailyObservation(later.snapshot, {
    day: "2026-08-24",
    observedAt: "2026-08-24T15:00:00.000Z",
    remaining: 4000,
    total: 4500,
  });
  assert.equal(refill.todayConsumed, 0);
  assert.equal(refill.snapshot.first_remaining, 4000);

  const nextDay = advanceWorkbuddyDailyObservation(refill.snapshot, {
    day: "2026-08-25",
    observedAt: "2026-08-25T01:00:00.000Z",
    remaining: 3975,
    total: 4500,
  });
  assert.equal(nextDay.todayConsumed, 0);
  assert.equal(nextDay.snapshot.day, "2026-08-25");
});
