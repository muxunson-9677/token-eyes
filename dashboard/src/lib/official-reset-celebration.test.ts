import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodexResetEvent, CodexResetMonitorStatus } from "./api";
import {
  CELEBRATED_EVENT_KEY,
  OFFICIAL_RESET_CELEBRATION_LOCK,
  claimOfficialResetCelebration,
  toOfficialResetCelebrationEvent,
  type OfficialResetCelebrationEvent,
} from "./official-reset-celebration";

const status: CodexResetMonitorStatus = {
  enabled: true,
  configured: true,
  running: false,
  last_checked_at: null,
  last_successful_at: null,
  next_check_at: null,
  last_error_code: null,
  failure_count: 0,
  unread_count: 1,
  feed_enabled: true,
  feed_last_checked_at: null,
  feed_error_code: null,
  backfill_error_code: null,
};

function officialEvent(
  overrides: Partial<CodexResetEvent> = {},
): CodexResetEvent {
  return {
    id: "official-reset-42",
    type: "official_reset_announcement",
    agent: "codex",
    account_key: "default",
    window: null,
    created_at: "2026-07-30T12:00:01.000Z",
    reset_at: null,
    official_url: "https://chatgpt.com/codex",
    source: "signed_feed",
    observed_at: "2026-07-30T12:00:01.000Z",
    previous_used_percent: null,
    current_used_percent: null,
    confidence: "confirmed",
    alert_eligible: true,
    occurred_at: "2026-07-30T12:00:00.000Z",
    source_url: "https://x.com/OpenAI/status/1950000000000000000",
    reset_kind: "hard",
    reset_scope: "all_paid_users",
    ...overrides,
  };
}

function celebration(
  overrides: Partial<OfficialResetCelebrationEvent> = {},
): OfficialResetCelebrationEvent {
  return {
    eventId: "official-reset-42",
    provider: "codex",
    occurredAt: "2026-07-30T12:00:00.000Z",
    sourceUrl: "https://x.com/OpenAI/status/1950000000000000000",
    resetKind: "official-extra-reset",
    appliesToCurrentUsage: true,
    ...overrides,
  };
}

function createQueuedLockManager(): LockManager {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn(<T>(
    name: string,
    optionsOrCallback: LockOptions | LockGrantedCallback<T>,
    callback?: LockGrantedCallback<T>,
  ): Promise<T> => {
    const granted = typeof optionsOrCallback === "function"
      ? optionsOrCallback
      : callback!;
    const mode = typeof optionsOrCallback === "function"
      ? "exclusive"
      : optionsOrCallback.mode || "exclusive";
    const result = tail.then(() => granted({ name, mode }));
    tail = result.then(() => undefined, () => undefined);
    return result;
  });
  return {
    request,
    async query() {
      return { held: [], pending: [] };
    },
  } as LockManager;
}

describe("official reset celebration contract", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: createQueuedLockManager(),
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
    vi.restoreAllMocks();
  });

  it("normalizes an applicable official announcement without inventing fields", () => {
    expect(toOfficialResetCelebrationEvent(officialEvent(), status)).toEqual({
      eventId: "official-reset-42",
      provider: "codex",
      occurredAt: "2026-07-30T12:00:00.000Z",
      sourceUrl: "https://x.com/OpenAI/status/1950000000000000000",
      resetKind: "official-extra-reset",
      appliesToCurrentUsage: true,
    });
  });

  it("never normalizes a regular quota rollover", () => {
    expect(toOfficialResetCelebrationEvent(officialEvent({
      type: "reset_completed",
      source: "local_quota",
    }), status)).toBeNull();
  });

  it.each([
    ["event id", { id: "" }],
    ["occurrence time", { occurred_at: "" }],
    ["source URL", { source_url: "" }],
  ])("rejects an official announcement missing its %s", (_label, overrides) => {
    expect(toOfficialResetCelebrationEvent(
      officialEvent(overrides),
      status,
    )).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[official-reset-celebration] skipped",
      expect.objectContaining({ reason: expect.any(String) }),
    );
  });

  it.each([
    [{ configured: false }, true],
    [{ configured: null }, true],
    [{ configured: true }, false],
  ])("marks non-applicable announcements honestly", async (statusOverride, eligible) => {
    const normalized = toOfficialResetCelebrationEvent(
      officialEvent({ alert_eligible: eligible }),
      { ...status, ...statusOverride },
    );
    expect(normalized?.appliesToCurrentUsage).toBe(false);
    expect(await claimOfficialResetCelebration(normalized!)).toBe(false);
  });

  it.each(["all_paid_users", "all_codex_work_users"] as const)(
    "accepts the supported %s scope",
    (reset_scope) => {
      expect(toOfficialResetCelebrationEvent(
        officialEvent({ reset_scope }),
        status,
      )?.appliesToCurrentUsage).toBe(true);
    },
  );

  it("rejects an unsupported scope", async () => {
    const normalized = toOfficialResetCelebrationEvent(
      officialEvent({ reset_scope: "unknown" }),
      status,
    );
    expect(normalized?.appliesToCurrentUsage).toBe(false);
    expect(await claimOfficialResetCelebration(normalized!)).toBe(false);
  });

  it("claims a valid event once and persists its stable id", async () => {
    expect(await claimOfficialResetCelebration(celebration())).toBe(true);
    expect(window.localStorage.getItem(CELEBRATED_EVENT_KEY))
      .toBe("official-reset-42");
    expect(await claimOfficialResetCelebration(celebration())).toBe(false);
  });

  it.each([
    "https://help.openai.com/en/articles/11369540",
    "https://openai.com/index/introducing-codex/",
    "https://chatgpt.com/codex",
    "https://x.com/OpenAI/status/1950000000000000000",
    "https://x.com/thsottiaux/status/1950000000000000001/",
  ])("accepts an exact official HTTPS source: %s", async (sourceUrl) => {
    expect(await claimOfficialResetCelebration(celebration({
      eventId: `accepted-${sourceUrl}`,
      sourceUrl,
    }))).toBe(true);
  });

  it.each([
    "http://openai.com/reset",
    "https://help.openai.com.evil.example/reset",
    "https://sub.openai.com/reset",
    "https://openai.com.evil.example/reset",
    "https://openai.com@evil.example/reset",
    "https://user%40evil.example@openai.com/reset",
    "https://openai.com:8443/reset",
    "https://openai.com/reset#details",
    "https://xn--openai-9za.com/reset",
    "https://x.com/OpenAI/status/1950000000000000000?ref=reset",
    "https://x.com/openai/status/1950000000000000000",
    "https://x.com/OpenAI/status/not-a-number",
    "https://x.com/OpenAI/status/1950000000000000000/more",
    "https://x.com/other/status/1950000000000000000",
    "not a URL",
  ])("rejects an untrusted source boundary: %s", async (sourceUrl) => {
    expect(await claimOfficialResetCelebration(celebration({
      eventId: `rejected-${sourceUrl}`,
      sourceUrl,
    }))).toBe(false);
  });

  it("rejects an invalid occurrence timestamp", async () => {
    expect(await claimOfficialResetCelebration(celebration({
      occurredAt: "not-a-date",
    }))).toBe(false);
  });

  it("does not claim a different reset kind", async () => {
    expect(await claimOfficialResetCelebration({
      ...celebration(),
      resetKind: "quota-rollover",
    } as unknown as OfficialResetCelebrationEvent)).toBe(false);
  });

  it("does not throw or dispatch a claim when localStorage cannot be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied");
    });

    expect(await claimOfficialResetCelebration(celebration())).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("official-reset-42"),
      expect.anything(),
    );
  });

  it("does not claim an event when its id cannot be persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota");
    });

    expect(await claimOfficialResetCelebration(celebration())).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[official-reset-celebration] skipped",
      { reason: "storage-write-failed" },
    );
  });

  it("serializes concurrent same-origin claims so only one callback runs", async () => {
    const first = vi.fn();
    const second = vi.fn();

    const results = await Promise.all([
      claimOfficialResetCelebration(celebration(), { onClaim: first }),
      claimOfficialResetCelebration(celebration(), { onClaim: second }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1);
    expect(navigator.locks.request).toHaveBeenCalledWith(
      OFFICIAL_RESET_CELEBRATION_LOCK,
      { mode: "exclusive" },
      expect.any(Function),
    );
    expect(window.localStorage.getItem(CELEBRATED_EVENT_KEY))
      .toBe("official-reset-42");
  });

  it("fails closed when Web Locks are unavailable", async () => {
    Reflect.deleteProperty(navigator, "locks");
    const onClaim = vi.fn();

    expect(await claimOfficialResetCelebration(
      celebration(),
      { onClaim },
    )).toBe(false);
    expect(onClaim).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[official-reset-celebration] skipped",
      { reason: "lock-unavailable" },
    );
  });

  it("fails closed when the exclusive lock request is rejected", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn().mockRejectedValue(new DOMException("denied")),
      },
    });
    const onClaim = vi.fn();

    expect(await claimOfficialResetCelebration(
      celebration(),
      { onClaim },
    )).toBe(false);
    expect(onClaim).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[official-reset-celebration] skipped",
      { reason: "lock-request-failed" },
    );
  });
});
