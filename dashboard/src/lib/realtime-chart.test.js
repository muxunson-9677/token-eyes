import { describe, expect, it } from "vitest";
import { activitySegments } from "./realtime-chart";

describe("实时趋势时间与缺失语义", () => {
  const point = (minute, total_tokens) => ({ observed_at: `2026-09-22T00:${String(minute).padStart(2, "0")}:00Z`, total_tokens });
  it("按时间距离定位，缺失值分段，真实零不丢失", () => {
    const segments = activitySegments([point(0, 0), point(1, 10), point(2, null), point(10, 20)]);
    expect(segments).toHaveLength(2);
    expect(segments[0].map(p => p.x)).toEqual([0, 0.1]);
    expect(segments[0][0].value).toBe(0);
    expect(segments[1][0].x).toBe(1);
  });
  it("单点居中且无效日期不伪造坐标", () => {
    expect(activitySegments([point(5, 0)])[0][0].x).toBe(0.5);
    expect(activitySegments([{ observed_at: "bad", total_tokens: 10 }])).toEqual([]);
  });
});
