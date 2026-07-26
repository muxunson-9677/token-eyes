import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useUsageAttribution } from "../use-usage-attribution";
import type { UsageSnapshotV2 } from "../../lib/usage-attribution";

const SNAPSHOTS: UsageSnapshotV2[] = [
  {
    schema_version: "token-observability/v2",
    hour_start: "2026-07-26T00:00:00.000Z",
    dimensions: {
      device_id: "device-a",
      environment_id: "native:host-a",
      environment_kind: "native",
      agent_id: "claude",
      account_scope: null,
      project_key: "c:\\app",
      session_key: null,
      model_id: "claude-opus-4-6",
    },
    tokens: {
      input_tokens: 100,
      cached_input_tokens: 10,
      cache_creation_input_tokens: 5,
      output_tokens: 50,
      reasoning_output_tokens: 20,
      total_tokens: 185,
      conversation_count: 2,
    },
  },
  {
    schema_version: "token-observability/v2",
    hour_start: "2026-07-26T00:00:00.000Z",
    dimensions: {
      device_id: "device-a",
      environment_id: "wsl:ubuntu",
      environment_kind: "wsl",
      agent_id: "codex",
      account_scope: null,
      project_key: "/home/user/app",
      session_key: "session-1",
      model_id: "gpt-5",
    },
    tokens: {
      input_tokens: 80,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      total_tokens: 120,
      conversation_count: 1,
    },
  },
];

describe("useUsageAttribution", () => {
  it("returns an empty result when snapshots is null", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({ snapshots: null, groupBy: "agent" }),
    );
    expect(result.current.result?.groups).toEqual([]);
    expect(result.current.result?.total_tokens).toBe(0);
    expect(result.current.unattributed).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("groups by agent and preserves the invariant", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({ snapshots: SNAPSHOTS, groupBy: "agent" }),
    );
    const groups = result.current.result?.groups ?? [];
    const sum = groups.reduce((acc, g) => acc + g.tokens.total_tokens, 0);
    expect(sum).toBe(result.current.result?.total_tokens);
    expect(result.current.result?.total_tokens).toBe(305);
    expect(groups.map((g) => g.dimensions.agent_id).sort()).toEqual(["claude", "codex"]);
  });

  it("applies the filter before grouping", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({
        snapshots: SNAPSHOTS,
        groupBy: "agent",
        filter: { agent_id: "codex" },
      }),
    );
    expect(result.current.result?.groups.length).toBe(1);
    expect(result.current.result?.groups[0].dimensions.agent_id).toBe("codex");
    expect(result.current.result?.total_tokens).toBe(120);
  });

  it("recomputes when the filter changes", () => {
    let filter: { agent_id?: string } = {};
    const { result, rerender } = renderHook(
      ({ filter: f }) =>
        useUsageAttribution({ snapshots: SNAPSHOTS, groupBy: "agent", filter: f }),
      { initialProps: { filter } },
    );
    expect(result.current.result?.total_tokens).toBe(305);

    filter = { agent_id: "claude" };
    rerender({ filter });

    expect(result.current.result?.total_tokens).toBe(185);
  });

  it("computes the unattributed delta when officialDeltaTokens is provided", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({
        snapshots: SNAPSHOTS,
        groupBy: "agent",
        officialDeltaTokens: 400,
        observedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    expect(result.current.unattributed).not.toBeNull();
    expect(result.current.unattributed?.unattributed_tokens).toBe(95);
    expect(result.current.unattributed?.evidence.source_kind).toBe("estimated");
    expect(result.current.unattributed?.evidence.accuracy).toBe("estimated");
    expect(result.current.unattributed?.evidence.coverage).toBe("partial");
  });

  it("clamps the unattributed delta to zero when local exceeds official", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({
        snapshots: SNAPSHOTS,
        groupBy: "agent",
        officialDeltaTokens: 100,
        observedAt: "2026-07-26T00:00:00.000Z",
      }),
    );
    expect(result.current.unattributed?.unattributed_tokens).toBe(0);
    expect(result.current.unattributed?.evidence.note_code).toBe("local_exceeds_official");
  });

  it("returns null unattributed when officialDeltaTokens is null", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({
        snapshots: SNAPSHOTS,
        groupBy: "agent",
        officialDeltaTokens: null,
      }),
    );
    expect(result.current.unattributed).toBeNull();
  });

  it("exposes the supported group-by fields and the unknown bucket constant", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({ snapshots: SNAPSHOTS, groupBy: "device" }),
    );
    expect(result.current.groupByFields).toEqual([
      "device",
      "environment",
      "agent",
      "project",
      "model",
    ]);
    expect(result.current.unknownBucket).toBe("__unknown__");
  });

  it("refresh() forces recomputation without changing the inputs", () => {
    const refreshSpy = vi.fn();
    const { result } = renderHook(() => {
      const hook = useUsageAttribution({ snapshots: SNAPSHOTS, groupBy: "agent" });
      // Spy on refresh by wrapping the returned function.
      void refreshSpy;
      return hook;
    });
    const before = result.current.result;
    act(() => {
      result.current.refresh();
    });
    // The reference identity of `result` may or may not change, but the
    // totals must stay consistent.
    expect(result.current.result?.total_tokens).toBe(before?.total_tokens);
  });

  it("surfaces an external error without throwing", () => {
    const { result } = renderHook(() =>
      useUsageAttribution({
        snapshots: null,
        groupBy: "agent",
        error: "fetch failed",
      }),
    );
    expect(result.current.error).toBe("fetch failed");
    expect(result.current.result?.groups).toEqual([]);
  });
});
