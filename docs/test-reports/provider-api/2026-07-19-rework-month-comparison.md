# 成本环比重修核账 — 2026-07-19

- 工作树：`D:\04-AI-Project\010-Token eye\.worktrees\provider-api`
- 分支：`codex/token-eyes-provider-api`
- 安装版复验：`2026-07-19T21:46:50.431+08:00`
- 时区：`Asia/Shanghai`
- 当前状态：`PASS`（仅 Task 1；其余重修门禁仍未完成）

## 1. 区间与原始账目

本期 `2026-07-01..2026-07-19`，上期 `2026-06-01..2026-06-19`。原始脱敏 JSON：`artifacts/rework/month-comparison-ledger-20260719-212630-redacted.json`。

| 账目 | 本期 USD | 上期 USD | 本期逐来源合计 | 上期逐来源合计 |
|---|---:|---:|---:|---:|
| API | 6603.138389 | 463.393724 | 0.085068 + 6533.505260 + 69.091916 + 0.456145 = 6603.138389 | 55.212905 + 319.760390 + 27.107260 + 61.313169 = 463.393724 |
| 订阅 | 0 | 0 | 0 | 0 |
| 其他 AI | 146.527778 | 8.750000 | 146.527778 | 8.750000 |
| 总成本 | 6749.666167 | 472.143724 | 6603.138389 + 0 + 146.527778 = 6749.666167 | 463.393724 + 0 + 8.75 = 472.143724 |

## 2. 手算

唯一公式：`(本期 - 上期) / 上期 × 100%`。

| 卡片 | 计算 | 四舍五入 UI 值 |
|---|---|---:|
| API | `(6603.138389 - 463.393724) / 463.393724 × 100%` | `较上月新增 1325.0%` |
| 订阅 | `0 = 0` | `与上月持平` |
| 其他 AI | `(146.527778 - 8.75) / 8.75 × 100%` | `较上月新增 1574.6%` |
| 总成本 | `(6749.666167 - 472.143724) / 472.143724 × 100%` | `较上月新增 1329.6%` |

上期为 0 且本期大于 0 时显示 `上月无基数`，不显示 Infinity、NaN 或伪百分比。

## 3. 根因

旧安装版的 `1422.0% / 1425.0%` 并不是当前计算函数仍在使用 `current / previous × 100`。失败请求同时带入默认 Provider `sources` 和账本时区平移参数，导致 API 读到另一组本期/上期基数：`6626.554829 / 435.379159` 与 `6773.082607 / 444.129159`；按正确 delta 公式恰好就是 `1422.0% / 1425.0%`。

最小修复为：默认“全部”财务卡不下发来源过滤，用户主动选择 Provider 时才下发；月份日期仍按浏览器本地日历生成，但原始财务账本不再对 `YYYY-MM-DD` 日期键做第二次时区平移。API、订阅、总成本分别绑定各自上期字段；零基数使用 `上月无基数`。

## 4. TDD 证据

红测命令：

```powershell
npm --prefix dashboard test -- --run src/lib/date-range.test.ts src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx
```

第一轮红测结果：`2 failed / 36 passed`，复现零基数仍显示金额增长文字。

第二轮红测：默认页面仍携带 `sources`，`1 failed / 34 skipped`。

第三轮红测：使用统计页和成本累积页仍携带账本时区平移参数，`2 failed / 34 skipped`。

最终目标回归命令：

```powershell
npm --prefix dashboard test -- --run src/lib/date-range.test.ts src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/pages/SpendPage.test.jsx
```

结果：`4 files passed / 74 tests passed`。

## 5. 安装版门禁

旧安装版证据：

- `artifacts/final-acceptance/installed-spend-usage-text.json`：API `1422.0%`、总成本 `1425.0%`
- `artifacts/final-acceptance/installed-spend-1280.png`
- `artifacts/final-acceptance/installed-spend-1440.png`
- `artifacts/final-acceptance/installed-spend-1920.png`

诊断安装包（非最终交付包）：

- 路径：`src-tauri/target/release/bundle/nsis/Token Eyes_0.54.6_x64-setup.exe`
- SHA-256：`67D84825DA09BBA01A6324F87C121C49EB43E46D3DD41A8F914DC2DB2FB033A2`
- 静默覆盖安装：`INSTALL_EXIT=0`

安装版操作步骤：打开本地正式页面 `http://127.0.0.1:7681/spend`，保持“全部”范围，在 1440×900 视口等待两个月账目请求完成，读取三张月度卡 CNY 行并记录请求响应。

安装版结果：

| 卡片 | CNY 行 | 原始账目手算 | 结果 |
|---|---|---|---|
| API | `CNY 47,542.60 / 较上月新增 1325.0%` | `1325.0%` | PASS |
| 订阅 | `CNY 0.00 / 与上月持平` | `持平` | PASS |
| 总成本 | `CNY 48,597.60 / 较上月新增 1329.6%` | `1329.6%` | PASS |

证据：

- `artifacts/rework/installed-month-comparison-1440.json`（页面文本、完整请求 URL、HTTP 200、原始 totals、时间戳）
- `artifacts/rework/installed-month-comparison-1440.png`
- `artifacts/rework/month-comparison-ledger-20260719-212630-redacted.json`

结论：Task 1 `PASS`。该包仅用于重修中的安装版诊断，不是最终安装包；四项门禁完成前不得交付最终包。
