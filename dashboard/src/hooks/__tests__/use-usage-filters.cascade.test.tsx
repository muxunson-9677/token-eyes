import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  UsageFiltersProvider,
  useUsageFilters,
  useUsageFilterActions,
} from "../use-usage-filters";

function useHarness() {
  const { state, refreshRevision, requestRefresh } = useUsageFilters();
  const actions = useUsageFilterActions();
  return { state, actions, refreshRevision, requestRefresh };
}

function setup() {
  return renderHook(() => useHarness(), { wrapper: UsageFiltersProvider });
}

describe("useUsageFilters cascade", () => {
  it("SET_AGENT_IDS forward-cascades: clears sources and models to null", () => {
    const { result } = setup();

    act(() => {
      result.current.actions.setSources(["codex"]);
    });
    act(() => {
      result.current.actions.setModels(["gpt-4o"]);
    });
    expect(result.current.state.sources).toEqual(["codex"]);
    expect(result.current.state.models).toEqual(["gpt-4o"]);

    act(() => {
      result.current.actions.setAgentIds(["codex"]);
    });

    expect(result.current.state.agentIds).toEqual(["codex"]);
    expect(result.current.state.sources).toBeNull();
    expect(result.current.state.models).toBeNull();
  });

  it("SET_SOURCES forward-cascades: clears models to null", () => {
    const { result } = setup();

    act(() => {
      result.current.actions.setModels(["gpt-4o"]);
    });
    expect(result.current.state.models).toEqual(["gpt-4o"]);

    act(() => {
      result.current.actions.setSources(["codex"]);
    });

    expect(result.current.state.sources).toEqual(["codex"]);
    expect(result.current.state.models).toBeNull();
  });

  it("applies a concrete source selection from the default all state", () => {
    const { result } = setup();
    act(() => result.current.actions.setSources(["codex"]));
    expect(result.current.state.agentIds).toBeNull();
    expect(result.current.state.sources).toEqual(["codex"]);
    expect(result.current.state.models).toBeNull();
  });

  it("applies a concrete model selection from the default all state", () => {
    const { result } = setup();
    act(() => result.current.actions.setModels(["gpt-5.5"]));
    expect(result.current.state.agentIds).toBeNull();
    expect(result.current.state.sources).toBeNull();
    expect(result.current.state.models).toEqual(["gpt-5.5"]);
  });

  it("changing an agent clears source and model selections", () => {
    const { result } = setup();
    act(() => result.current.actions.setSources(["codex"]));
    act(() => result.current.actions.setModels(["gpt-5.5"]));
    act(() => result.current.actions.setAgentIds(["codex"]));
    expect(result.current.state).toMatchObject({
      agentIds: ["codex"],
      sources: null,
      models: null,
    });
  });

  it("setTimeRange sets timeRange/from/to and resets from/to when omitted", () => {
    const { result } = setup();

    act(() => {
      result.current.actions.setTimeRange("custom", "2026-01-01", "2026-01-31");
    });
    expect(result.current.state.timeRange).toBe("custom");
    expect(result.current.state.from).toBe("2026-01-01");
    expect(result.current.state.to).toBe("2026-01-31");

    act(() => {
      result.current.actions.setTimeRange("7d");
    });
    expect(result.current.state.timeRange).toBe("7d");
    expect(result.current.state.from).toBeNull();
    expect(result.current.state.to).toBeNull();
  });

  it("setRefreshInterval sets the interval", () => {
    const { result } = setup();

    act(() => {
      result.current.actions.setRefreshInterval("30s");
    });
    expect(result.current.state.refreshInterval).toBe("30s");
  });

  it("increments one shared refresh revision", () => {
    const { result } = setup();
    expect(result.current.refreshRevision).toBe(0);
    act(() => result.current.requestRefresh());
    expect(result.current.refreshRevision).toBe(1);
    act(() => result.current.requestRefresh());
    expect(result.current.refreshRevision).toBe(2);
  });
});