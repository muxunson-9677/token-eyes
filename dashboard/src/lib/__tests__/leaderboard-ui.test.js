import { describe, expect, it } from "vitest";
import {
  getPaginationFlags,
  pageContainingRank,
  prependMeRowToPage,
} from "../leaderboard-ui";

describe("getPaginationFlags", () => {
  it("keeps next enabled when totalPages is unknown", () => {
    const flags = getPaginationFlags({ page: 1, totalPages: null });
    expect(flags.canPrev).toBe(false);
    expect(flags.canNext).toBe(true);
  });

  it("disables next when totalPages is 0", () => {
    const flags = getPaginationFlags({ page: 1, totalPages: 0 });
    expect(flags.canPrev).toBe(false);
    expect(flags.canNext).toBe(false);
  });

  it("disables next when on last page", () => {
    const flags = getPaginationFlags({ page: 5, totalPages: 5 });
    expect(flags.canPrev).toBe(true);
    expect(flags.canNext).toBe(false);
  });
});

describe("prependMeRowToPage", () => {
  it("prepends a pinned me row when current page does not contain me", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      is_me: false,
      display_name: "Anonymous",
      avatar_url: null,
      gpt_tokens: "1",
      claude_tokens: "2",
      total_tokens: "3",
    }));

    const me = { rank: 237, gpt_tokens: "10", claude_tokens: "20", total_tokens: "30" };
    const result = prependMeRowToPage({ entries, me, meLabel: "YOU" });

    expect(result).toHaveLength(21);
    expect(result[0]?.is_pinned).toBe(true);
    expect(result[0]?.is_me).toBe(true);
    expect(result[0]?.rank).toBe(237);
    expect(result[0]?.total_tokens).toBe("30");
    expect(result[0]?.display_name).toBe("YOU");
    expect(result[1]?.rank).toBe(1);
    expect(result[20]?.rank).toBe(20);
  });

  it("does not prepend when current page already contains me naturally", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      rank: i + 1,
      is_me: false,
      display_name: "Anonymous",
      total_tokens: "3",
    }));
    entries[7].is_me = true;

    const me = { rank: 8, total_tokens: "30" };
    const result = prependMeRowToPage({ entries, me, meLabel: "YOU" });

    expect(result).not.toBe(entries);
    expect(result.filter((row) => row.is_me)).toHaveLength(1);
    expect(result[7]?.total_tokens).toBe("30");
    expect(result.some((r) => r?.is_pinned)).toBe(false);
  });

  it("prepends current local usage while the cloud rank is pending", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      rank: i + 1,
      total_tokens: "3",
    }));

    const me = { rank: null, is_local_pending: true, total_tokens: "30" };
    const result = prependMeRowToPage({ entries, me, meLabel: "YOU" });

    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({
      rank: null,
      is_me: true,
      is_pinned: true,
      is_local_pending: true,
      total_tokens: "30",
      display_name: "YOU",
    });
  });

  it("uses the public cloud row for the same user instead of duplicating it", () => {
    const entries = [
      { rank: 1, user_id: "another-user", total_tokens: "40" },
      { rank: 2, user_id: "user-1", total_tokens: "30" },
    ];
    const me = {
      rank: null,
      user_id: "user-1",
      is_local_pending: true,
      total_tokens: "31",
    };

    const result = prependMeRowToPage({ entries, me, meLabel: "YOU" });

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      rank: 2,
      user_id: "user-1",
      is_me: true,
      total_tokens: "31",
    });
    expect(result.some((row) => row.is_pinned)).toBe(false);
  });

  it("replaces the anonymous public row at my cloud rank with current local usage", () => {
    const entries = [
      { rank: 1, display_name: "Old cloud profile", total_tokens: "6950299812" },
      { rank: 2, display_name: "Another user", total_tokens: "100" },
    ];
    const me = {
      rank: 1,
      user_id: "user-1",
      is_local_pending: false,
      display_name: "Local profile",
      total_tokens: "7035384780",
    };

    const result = prependMeRowToPage({ entries, me, meLabel: "YOU" });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      rank: 1,
      user_id: "user-1",
      is_me: true,
      total_tokens: "7035384780",
    });
    expect(result.some((row) => row.is_pinned)).toBe(false);
  });

  it("keeps exactly one current-user row when stale cloud rows also claim is_me", () => {
    const entries = [
      { rank: 1, user_id: "old-user", is_me: true, total_tokens: "100" },
      { rank: 2, user_id: "user-1", is_me: false, total_tokens: "30" },
    ];
    const result = prependMeRowToPage({
      entries,
      me: { user_id: "user-1", rank: 2, is_local_pending: false, total_tokens: "31" },
      meLabel: "YOU",
    });

    expect(result.filter((row) => row.is_me)).toHaveLength(1);
    expect(result[0].is_me).toBe(false);
    expect(result[1]).toMatchObject({ user_id: "user-1", is_me: true, total_tokens: "31" });
  });

  it("returns entries unchanged when me is null", () => {
    const entries = [{ rank: 1, total_tokens: "3" }];
    const result = prependMeRowToPage({ entries, me: null, meLabel: "YOU" });
    expect(result).toBe(entries);
  });
});

describe("pageContainingRank", () => {
  it("returns the page index that contains the given rank", () => {
    expect(pageContainingRank(1, 20)).toBe(1);
    expect(pageContainingRank(20, 20)).toBe(1);
    expect(pageContainingRank(21, 20)).toBe(2);
    expect(pageContainingRank(237, 20)).toBe(12);
    expect(pageContainingRank(237, 50)).toBe(5);
  });

  it("returns null for invalid input", () => {
    expect(pageContainingRank(null, 20)).toBeNull();
    expect(pageContainingRank(5, 0)).toBeNull();
    expect(pageContainingRank("x", 20)).toBeNull();
  });
});
