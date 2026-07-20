# 成本月度查看功能：失败基线与开发态验证

日期：2026-07-20

分支：`codex/token-eyes-provider-api`

执行工作树：`D:\04-AI-Project\010-Token eye\.worktrees\provider-api`

## 验收口径

- 成本月份由成本模块自己的月份选择器控制，不改变“使用趋势”的日期筛选。
- 当前月按“本月至今”统计，并与“上月同期”比较。
- 历史月按完整自然月统计，并与上一个完整自然月比较。
- API、套餐订阅、其他 AI 自定义花销使用各自原始账目；总成本为三者合计。
- 历史月份的“本年”改为“所选年份 1 月 1 日至所选月月末”；累计仍统计全部历史。
- 缺失或请求失败的数据必须保持未知状态，不能伪装为真实的 0。
- 快速连续切换月份时，较慢的旧请求不能覆盖最新月份。

## 失败基线（修复前）

1. 日期范围：`date-range.test.ts` 新增 4 组用例后失败，原因是 `getCostMonthRanges is not a function`。
2. 后端分组汇总：请求 `summary_month=2025-06` 后，响应中的 `summary_month` 为 `undefined`，仍固定按当前月汇总。
3. 数据 Hook：新增 3 组核心用例失败：
   - 选择 `2025-06` 后仍请求 `2026-07`；
   - 时间序列缺少字段时被错误转换为 `0`；
   - 先发出的旧月份慢响应会覆盖后选择月份的新响应。
4. 成本组件：找不到“选择成本月份”，历史月份标题及前后月按钮不存在。
5. 页面接入：成本页面找不到月份选择器，不能独立加载历史月份账目。

## 实施结果

- 新增统一月份范围函数，覆盖当前月、历史月、跨年和闰年。
- 花销记录接口支持 `summary_month=YYYY-MM`，按所选月份计算其他 AI 的月度与年内累计，累计总额不随所选月份缩短。
- 成本 Hook 同时查询所选期和比较期；成本汇总查询完整财务账目，不受页面当前可见供应商过滤影响。
- 新增请求序号保护，旧月份慢响应不会覆盖最新月份。
- 新增独立月份选择器、前后月按钮、禁止未来月份，以及随月份变化的卡片标题。
- 总成本继续采用后端 `combined_usd = api_usd + subscription_usd + other_ai_usd` 原始汇总字段。

## 自动化验证命令与结果

```powershell
npm --prefix dashboard test -- --run src/lib/date-range.test.ts src/hooks/use-cost-accumulation.test.jsx src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx src/pages/SpendPage.test.jsx src/ui/dashboard/components/TokenServiceList.test.jsx
```

结果：5 个测试文件通过，79/79 项通过。

```powershell
node --test test/spend-records-api.test.js test/spend-timeseries-api.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js
```

结果：117/117 项通过。

```powershell
npm --prefix dashboard run typecheck
```

结果：通过。

```powershell
npx --prefix dashboard eslint dashboard/src/lib/date-range.ts dashboard/src/hooks/use-cost-accumulation.js dashboard/src/hooks/use-cost-accumulation.test.jsx dashboard/src/ui/dashboard/components/CostAccumulation.jsx dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx dashboard/src/pages/SpendPage.jsx dashboard/src/pages/SpendPage.test.jsx
```

结果：通过。

```powershell
git diff --check
```

结果：通过（仅有仓库既有换行符提示，无空白错误）。

```powershell
npm --prefix dashboard test -- --reporter=dot
```

结果：96 个测试文件通过，861/861 项通过。

```powershell
npm --prefix dashboard run build
```

结果：开发网页资源构建成功；未执行 Tauri 或安装包构建。

```powershell
npm run validate:copy
```

结果：通过，文案注册表共 1805 条、代码使用 1288 个键；输出的 unused 项为仓库现有告警。

## 已知的仓库级非本功能问题

全量 ESLint 仍在 `dashboard/src/components/settings/TokenPlanSection.jsx` 报告两处既有错误：`no-extra-boolean-cast` 与 `no-dupe-else-if`。本次按“只修改需求相关代码”的规则未处理。

全量 `npm test` 仍有仓库/环境既有失败：当前工作树缺少 `.github/workflows/release-windows.yml` 与 `.github/workflows/release-dmg.yml`，导致发布流程契约测试失败；本机 `@mongodb-js/zstd` 缺少 `build/Debug/zstd.node`，导致一项 Zed 降级解析测试无法加载。成本月度功能直接覆盖的 117 项后端测试全部通过。

## 开发态真实账目页面验证

验证地址：`http://127.0.0.1:7682/spend/cost`

内容宽度：1440

初始月份：2026-07

切换月份：2026-06

实际请求：

```text
/functions/tokentracker-spend-records?from=2026-06-01&to=2026-06-30&...&summary_month=2026-06
/functions/tokentracker-spend-timeseries?from=2026-06-01&to=2026-06-30&...
/functions/tokentracker-spend-timeseries?from=2026-05-01&to=2026-05-31&...
```

原始汇总与手算：

| 项目 | 2026-06 | 2026-05 | 环比计算 | 页面显示 |
| --- | ---: | ---: | --- | --- |
| API | USD 1305.255588 | USD 243.626266 | `(1305.255588 - 243.626266) / 243.626266 × 100% = 435.8%` | USD 1,305.26；较上月新增 435.8% |
| 套餐订阅 | USD 0 | USD 0 | 两期均为 0，持平 | USD 0.00；与上月持平 |
| 其他 AI | USD 18.75 | USD 52.051389 | 纳入总成本 | 分组月度金额合计 USD 18.75 |
| 总成本 | USD 1324.005588 | USD 295.677655 | `(1324.005588 - 295.677655) / 295.677655 × 100% = 347.8%` | USD 1,324.01；较上月新增 347.8% |

CNY 使用当前页面换算率 7.2：API 为 `1305.255588 × 7.2 = 9397.84`，总成本为 `1324.005588 × 7.2 = 9532.84`，与页面一致。

其他 AI 分组的 2026-06 / 2026 年截至 6 月 / 总累计金额均由真实花销记录接口返回；页面显示完整金额，无破折号、裁切或隐藏。

交互结果：

- 月份输入从 `2026-07` 切换为 `2026-06` 后，顶部三张当月卡片和全部自定义分组标题同步变为 2026 年 6 月。
- 历史月份的“下一月”按钮可用；返回当前月份后会禁止继续进入未来月份。
- 月份切换只触发成本账目请求，没有修改使用趋势筛选。

截图：`docs/test-reports/provider-api/2026-07-20-cost-month-browser-current.png`

## 安装版状态

按用户要求，本轮不构建安装包、不覆盖当前安装版，也不把开发态自动化测试当作最终安装版验收。正式安装版验证与最终 PASS 状态留到全部需求完成后统一执行。
