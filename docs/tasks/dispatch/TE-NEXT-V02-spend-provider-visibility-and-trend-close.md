# TE-NEXT-V02 - 花销页 Provider 同步与趋势浮层关闭

## 工单目标

修复两个独立但范围明确的问题：

1. 设置页“限制显示”中启用的 Provider 必须同步控制 Spend 页的花销趋势、按来源拆分、Provider 统计、请求明细选择框和模型统计。
2. 仪表盘“使用趋势”放大浮层的 `X`、背景点击和 Escape 必须可靠关闭，不能依赖浏览器/WebView 必然触发 CSS `animationend`。

本工单不新增功能模块，不改 Provider parser，不扩展请求日志采集能力，不改数据 schema。

## 用户验收示例

当限制显示仅启用 `Claude`、`Codex`、`Hermes` 时：

- 花销趋势图例顺序为 Claude、Codex、Hermes；Hermes 即使没有花销数据也要出现。
- Provider 统计与按来源拆分恰好展示这三个 Provider；无数据项数值为 0。
- 请求明细选择框恰好展示这三个 Provider；切换选项时请求对应的 `source`。
- 模型统计只保留已启用 Provider 的真实模型记录；没有真实请求记录的 Provider 不要伪造模型行。
- 关闭任意一个 Provider 后，它不再出现在上述任一位置。

已知限制：本地 `/functions/tokentracker-request-usage-records` 目前只实现 Codex rollout 解析。Claude/Hermes 出现在选择框中是正确行为，但选择后应显示既有空状态，不能生成虚构记录。

## 开始前必读

按顺序阅读：

1. `CLAUDE.md`
2. `docs/superpowers/specs/2026-06-24-spend-provider-visibility-and-trend-close-design.md`
3. `dashboard/src/hooks/use-limits-display-prefs.js`
4. `dashboard/src/lib/limits-providers.js`
5. `dashboard/src/pages/SpendPage.jsx`
6. `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
7. `dashboard/src/ui/dashboard/components/TrendMonitor.jsx`
8. `dashboard/src/ui/dashboard/components/TrendMonitorZoomModal.jsx`
9. `dashboard/src/components/spend/SpendTrendChart.jsx`
10. `dashboard/src/pages/SpendPage.test.jsx`
11. `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
12. `dashboard/src/ui/dashboard/components/__tests__/TrendMonitor.test.jsx`

当前工作区已存在大量用户未提交改动。不得执行 `git reset --hard`、`git checkout --` 或回退任何不属于本工单的文件。

## 已确认根因

### Provider 同步

- `useLimitsDisplayPrefs()` 已提供 `visibleOrdered`，但 `SpendPage` 没有使用它。
- `RequestUsageLog.jsx` 的 `SOURCES` 常量写死为 `[{ value: "codex", label: "Codex" }]`。
- `SpendTrendChart`、Provider 表格和按来源拆分直接渲染 API 返回的全部来源，没有按限制显示过滤或补零。
- `SpendPage.jsx` 的 `fetchRecords` 引用了未定义的 `requestUsageResult`，会导致刷新流程抛出 `ReferenceError`。
- 本地请求明细 API 对 `source !== "codex"` 明确返回空记录；这是当前产品能力边界，不是本工单要扩展的后端缺陷。

### 趋势浮层关闭

`TrendMonitorZoomModal.jsx` 的 `handleClose` 仅调用 `setIsClosing(true)`；真正的
`onClose()` 只在根浮层的 `onAnimationEnd` 中触发。若 Windows WebView 未派发动画事件，或
`prefers-reduced-motion` 使动画为 `none`，浮层不会卸载。

## 允许修改的文件

- 新增：`dashboard/src/lib/spend-provider-visibility.js`
- 新增：`dashboard/src/lib/spend-provider-visibility.test.js`
- 修改：`dashboard/src/pages/SpendPage.jsx`
- 修改：`dashboard/src/pages/SpendPage.test.jsx`
- 修改：`dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- 修改：`dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`
- 修改：`dashboard/src/ui/dashboard/components/TrendMonitorZoomModal.jsx`
- 新增：`dashboard/src/ui/dashboard/components/__tests__/TrendMonitorZoomModal.test.jsx`

如确有必要，可以调整 `dashboard/src/components/spend/SpendTrendChart.jsx` 的空序列显示；不要改其 SVG 绘制逻辑、不要新增图表依赖。

## 任务 1：提取并测试 Provider 可见性数据转换

### 1.1 先写失败测试

新建 `dashboard/src/lib/spend-provider-visibility.test.js`。测试应覆盖：

```js
import { describe, expect, it } from "vitest";
import {
  filterProviderRows,
  filterSpendTimeseries,
} from "./spend-provider-visibility.js";

describe("spend provider visibility", () => {
  const visible = ["claude", "codex", "hermes"];

  it("按限制显示顺序过滤趋势来源并保留无数据 Provider", () => {
    const result = filterSpendTimeseries({
      sources: ["codex", "cursor", "claude"],
      series: [
        { source: "codex", bucket_start: "2026-06-01", combined_usd: 2 },
        { source: "cursor", bucket_start: "2026-06-01", combined_usd: 9 },
        { source: "claude", bucket_start: "2026-06-01", combined_usd: 1 },
      ],
    }, visible);

    expect(result.sources).toEqual(["claude", "codex", "hermes"]);
    expect(result.series.map((row) => row.source)).toEqual(["codex", "claude"]);
  });

  it("为可见但无花销数据的 Provider 补零，并排除已关闭 Provider", () => {
    expect(filterProviderRows([
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3 },
      { source: "cursor", api_usd: 9, subscription_usd: 0, combined_usd: 9 },
    ], visible)).toEqual([
      { source: "claude", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
      { source: "codex", api_usd: 1, subscription_usd: 2, combined_usd: 3 },
      { source: "hermes", api_usd: 0, subscription_usd: 0, combined_usd: 0 },
    ]);
  });
});
```

运行：

```bash
npm --prefix dashboard run test -- src/lib/spend-provider-visibility.test.js
```

预期：失败，原因是辅助模块尚不存在。

### 1.2 实现最小辅助模块

新增 `dashboard/src/lib/spend-provider-visibility.js`，只实现 Spend 页需要的两项纯函数：

```js
const ZERO_COST_ROW = Object.freeze({
  api_usd: 0,
  subscription_usd: 0,
  combined_usd: 0,
});

function normalizeSource(value) {
  return String(value || "").trim().toLowerCase();
}

export function filterProviderRows(rows, visibleProviderIds) {
  const bySource = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [normalizeSource(row.source), row]),
  );

  return visibleProviderIds.map((source) => {
    const row = bySource.get(source);
    return row
      ? { ...ZERO_COST_ROW, ...row, source }
      : { source, ...ZERO_COST_ROW };
  });
}

export function filterSpendTimeseries(timeseries, visibleProviderIds) {
  const visible = new Set(visibleProviderIds);
  const source = timeseries && typeof timeseries === "object" ? timeseries : {};
  return {
    ...source,
    sources: visibleProviderIds,
    series: (Array.isArray(source.series) ? source.series : []).filter(
      (row) => visible.has(normalizeSource(row.source)),
    ),
    by_source: filterProviderRows(source.by_source, visibleProviderIds),
  };
}
```

约束：

- 传入的 `visibleProviderIds` 已来自 `visibleOrdered`，不得自行重排。
- 只补 Provider 级成本行；不要生成模型行或虚构请求记录。
- 如现有响应行包含 `api_cost_usd` 等不同字段，保留原字段，不要丢失。

重新运行上面的测试，预期通过。

## 任务 2：将 Spend 页接入唯一可见 Provider 列表

### 2.1 先扩展 SpendPage 失败测试

在 `dashboard/src/pages/SpendPage.test.jsx` 中 mock：

```js
vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  useLimitsDisplayPrefs: () => ({
    visibleOrdered: ["claude", "codex", "hermes"],
  }),
}));
```

为 `getSpendTimeseries` mock 返回 Claude、Codex、Cursor 三个来源。渲染后断言传给
`SpendTrendChart` 的 `sources` 为 `["claude", "codex", "hermes"]`，且 Provider 表格没有
`cursor`、包含零值 Hermes 行。

先运行：

```bash
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx
```

预期：新增断言失败，当前实现没有读取限制显示偏好。

### 2.2 修改 SpendPage

在 `dashboard/src/pages/SpendPage.jsx`：

1. 导入 `useLimitsDisplayPrefs`、`filterProviderRows`、`filterSpendTimeseries`。
2. 在组件内获取 `const { visibleOrdered } = useLimitsDisplayPrefs();`。
3. 用 `useMemo` 构造 `visibleTimeseries` 和 `visibleBySource`：

```js
const visibleTimeseries = useMemo(
  () => filterSpendTimeseries(timeseries, visibleOrdered),
  [timeseries, visibleOrdered],
);

const visibleBySource = useMemo(
  () => filterProviderRows(bySource, visibleOrdered),
  [bySource, visibleOrdered],
);
```

4. `SpendTrendChart` 使用 `visibleTimeseries.series` 与
   `visibleTimeseries.sources`。
5. `UsageDetailTabs`、`ProviderUsageTable` 和既有“按来源拆分”使用
   `visibleBySource`，不再直接使用 `bySource`。
6. 传递 `visibleProviderIds={visibleOrdered}` 给 `UsageDetailTabs`。
7. 删除 `REQUEST_USAGE_SOURCE` 常量。
8. 在 `fetchRecords` 中删除未定义的 `requestUsageResult` 判断。`lastUpdatedAt`
   只依据实际存在的 `recordsResult` 与 `timeseriesResult`。

不要把 Provider 可见性写入 `SpendPage` 的 local state，也不要改后端 API。

重新运行 SpendPage 测试，预期通过。

## 任务 3：请求明细选择框同步 Provider 并保护空选择

### 3.1 先写失败测试

修改 `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx`：

```jsx
render(
  <RequestUsageLog
    from="2025-12-01"
    to="2025-12-31"
    timeZone="UTC"
    tzOffsetMinutes={0}
    visibleProviderIds={["claude", "codex", "hermes"]}
  />,
);

expect(screen.getByRole("option", { name: "Claude" })).toBeInTheDocument();
expect(screen.getByRole("option", { name: "Codex" })).toBeInTheDocument();
expect(screen.getByRole("option", { name: "Hermes" })).toBeInTheDocument();
```

再使用 `userEvent.selectOptions` 选择 `hermes`，断言
`getRequestUsageRecords` 最终以 `source: "hermes"` 调用。

先运行：

```bash
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx
```

预期：失败，当前组件只渲染 Codex 选项。

### 3.2 修改 RequestUsageLog

1. 将组件签名改为：

```jsx
export function RequestUsageLog({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  visibleProviderIds = [],
})
```

2. 导入 `limitProviderName`，使用 `visibleProviderIds` 创建选择框选项。
3. 以第一个可见 Provider 初始化/修正 `source`：当前 source 不再可见时，切换到
   `visibleProviderIds[0] || ""`。
4. 当 `source` 为空时，清空请求记录和 totals，且不调用 API。
5. 保留当前 API 调用的 `source` 参数；不要在前端拦截非 Codex 选择，后端会返回合法空状态。

在 `UsageDetailTabs` 中把 `visibleProviderIds` 传给 `RequestUsageLog`。

重新运行 RequestUsageLog 测试，预期通过。

## 任务 4：模型统计只使用可见 Provider 的真实请求记录

### 4.1 先写失败测试

在 `SpendPage.test.jsx` 追加一个场景：请求聚合包含 `codex` 与 `cursor` 的记录，但
`visibleOrdered` 只包含 `codex`。断言模型统计中出现 Codex 模型，不出现 Cursor 模型。

先运行 SpendPage 测试，预期失败或暴露当前 `requestUsageResult` 的未定义引用。

### 4.2 修复请求聚合

`SpendPage` 当前引入了 `getRequestUsageRecords` 但没有正确调用。实现时：

```js
const requestUsageResults = await Promise.allSettled(
  visibleOrdered.map((source) =>
    getRequestUsageRecords({
      source,
      from,
      to,
      timeZone,
      tzOffsetMinutes,
      limit: 100,
    }),
  ),
);
```

将 fulfilled 结果中的 `records` 合并为 `requestUsage.records`，并将各 totals 数值字段
逐项相加。只合并 `visibleOrdered` 发起的结果；非 Codex 空响应参与合并但不产生伪数据。

`buildModelUsageRows` 必须只接收该合并后的记录。模型行如需区分同名模型的不同
Provider，可使用 `source + model` 作为内部 Map key，但不要改变既有模型统计表的列结构。

完成后重新运行 SpendPage 测试，预期通过。

## 任务 5：为趋势浮层关闭增加无动画兜底

### 5.1 先写失败测试

新建 `dashboard/src/ui/dashboard/components/__tests__/TrendMonitorZoomModal.test.jsx`。

mock `useTrendData` 返回空 rows，mock `useCurrency` 返回 USD，传入最小 `zoomConfig` 和
`renderChart={() => <div />}`。使用 fake timers：

```jsx
const onClose = vi.fn();
render(<TrendMonitorZoomModal {...props} onClose={onClose} />);

await userEvent.click(screen.getByRole("button", { name: "Close" }));
act(() => vi.advanceTimersByTime(250));

expect(onClose).toHaveBeenCalledTimes(1);
```

测试中不要触发 `animationEnd`。当前实现会失败，因为 `onClose` 只在动画事件中调用。

运行：

```bash
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/TrendMonitorZoomModal.test.jsx
```

### 5.2 实现幂等关闭

在 `TrendMonitorZoomModal.jsx` 中：

1. 增加 `closeTimerRef` 和 `didCloseRef`。
2. 新增 `finalizeClose`：只调用一次 `onClose`，并清除定时器。
3. `handleClose` 第一次调用时设置 `isClosing`，随后用 `window.setTimeout(finalizeClose, 220)`
   安排兜底关闭。
4. `handleAnimationEnd` 在根浮层结束动画时调用 `finalizeClose`，使有动画的场景立即完成。
5. 在 unmount cleanup 中清除定时器。
6. 保持现有关闭按钮、背景点击、Escape 均调用同一个 `handleClose`。

核心逻辑应等价于：

```js
const didCloseRef = React.useRef(false);
const closeTimerRef = React.useRef(null);

const finalizeClose = React.useCallback(() => {
  if (didCloseRef.current) return;
  didCloseRef.current = true;
  if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  closeTimerRef.current = null;
  onClose?.();
}, [onClose]);

const handleClose = React.useCallback(() => {
  if (isClosing) return;
  setIsClosing(true);
  closeTimerRef.current = window.setTimeout(finalizeClose, 220);
}, [finalizeClose, isClosing]);
```

重新运行浮层测试，预期通过。

## 最终验证

依次运行：

```bash
npm --prefix dashboard run test -- src/lib/spend-provider-visibility.test.js
npm --prefix dashboard run test -- src/pages/SpendPage.test.jsx
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/TrendMonitorZoomModal.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

手动验证：

1. 在设置的限制显示中仅启用 Claude、Codex、Hermes。
2. 打开 Spend 页，确认趋势、Provider 统计、按来源拆分与请求明细选择框均为三项，顺序一致。
3. 关闭 Hermes，确认所有位置立刻不再出现 Hermes。
4. 打开仪表盘使用趋势放大浮层，分别点击 `X`、背景和按 Escape，三种方式均关闭。

## 禁止事项

- 不修改 `src/lib/local-api.js` 以伪造或扩展 Claude/Hermes 请求级记录。
- 不修改 queue schema、Spend record schema、parser、adapter registry 或服务商图标。
- 不新增 npm 依赖。
- 不在 JSX 中硬编码新增用户文案；如必须新增文案，写入 `dashboard/src/content/copy.csv` 并运行 copy 校验。
- 不提交或回退无关工作区改动；如需要提交，只暂存本工单涉及的文件，提交信息使用英文 conventional commit。

## 完成后报告

- 修改文件列表。
- 每条验证命令的结果。
- 是否构建出新的 `src-tauri/target/release/token-eyes.exe`。
- 已知限制：只有 Codex 具有本地逐请求明细，其他可见 Provider 可选但会显示空状态。
