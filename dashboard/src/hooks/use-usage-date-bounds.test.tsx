import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getUsageBounds } from "../lib/api";
import { useUsageDateBounds } from "./use-usage-date-bounds";

vi.mock("../lib/api", () => ({
  getUsageBounds: vi.fn(),
}));

describe("useUsageDateBounds", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("reuses the last successful range immediately on a repeat mount", async () => {
    vi.mocked(getUsageBounds).mockResolvedValueOnce({
      from: "2026-03-16",
      to: "2026-07-30",
    } as never);

    const first = renderHook(() => useUsageDateBounds({
      timeZone: "Asia/Shanghai",
      tzOffsetMinutes: 480,
    }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.from).toBe("2026-03-16");
    first.unmount();

    vi.mocked(getUsageBounds).mockReturnValueOnce(new Promise(() => {}));
    const second = renderHook(() => useUsageDateBounds({
      timeZone: "Asia/Shanghai",
      tzOffsetMinutes: 480,
    }));

    expect(second.result.current).toEqual({
      from: "2026-03-16",
      to: "2026-07-30",
      loading: false,
    });
  });
});
