# 自定义花销卡片重修验收 — 2026-07-19

- 工作树：`D:\04-AI-Project\010-Token eye\.worktrees\provider-api`
- 分支：`codex/token-eyes-provider-api`
- 安装版页面：`http://127.0.0.1:7681/spend/cost`
- 安装版复验时间：`2026-07-19T21:58:06.938+08:00`
- 状态：`PASS`（仅 Task 2；Cursor/TRAE 门禁仍未完成）

## 1. 失败基线

旧正式安装资产在 1280、1440、1920 浏览器视口下虽然能看到短名称，但组名节点带 `truncate`，严格安装版检查三种宽度均失败：

```text
group name can be truncated: VPN
```

进一步将验收改为用户要求的“内容宽度”后，三种目标宽度都被成本页的 `max-w-5xl` 限制为实际 976px，无法证明 1280/1440/1920 三种内容宽度。

失败证据：

- `artifacts/rework/spend-cards/installed-spend-cards-baseline-20260719-215213.json`
- `artifacts/rework/spend-cards/installed-spend-cards-content-width-baseline-20260719-215603.json`
- `artifacts/rework/spend-cards/installed-spend-cards-content-1280-FAIL.png`
- `artifacts/rework/spend-cards/installed-spend-cards-content-1440-FAIL.png`
- `artifacts/rework/spend-cards/installed-spend-cards-content-1920-FAIL.png`

组件红测使用计划规定的长组名与六个不同金额：

```text
AI 学习投入与长期订阅
本月 USD 1,234.56 / CNY 8,888.88
本年 USD 12,345.67 / CNY 88,888.88
总累计 USD 123,456.78 / CNY 888,888.88
```

红测结果：长组名仍带 `truncate`，`1 failed / 15 skipped`。内容宽度静态门禁随后也先失败，证明 `max-w-5xl` 上限仍存在。

## 2. 最小修复

- 组名移除 `truncate`，允许正常换行，使用 14px 字号。
- 三组 USD/CNY 金额使用 12px 字号，不隐藏、不省略、不使用破折号占位。
- 外层卡片最小宽度 300px；内部期间列以 108px 为最小可读宽度自动换列。
- 成本页仅移除这一页的固定 `max-w-5xl` 上限，使安装页可真实形成 1280/1440/1920 内容区。
- 验收脚本删除 fixture 回退，只允许本机正式 `/spend/cost` 页面和真实本地账目。

## 3. 自动测试

```powershell
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx
node --test test/dashboard-layout-adjustments.test.js
```

结果：

- CostAccumulation：`16 passed`
- dashboard-layout-adjustments：`18 passed`

## 4. 安装版真实数据验收

诊断安装包（非最终交付包）：

- SHA-256：`1AF732F2905FC74A26760D7A4F2716849624508CDDC1476B71A92534A6F15CE0`
- 大小：`37,690,237` bytes
- 覆盖安装：`INSTALL_EXIT=0`

操作步骤：覆盖安装诊断包，打开正式 `/spend/cost` 页面；脚本根据侧栏和页面边距自动调整浏览器外框，使分组网格内容宽度精确为 1280/1440/1920；等待真实 `tokentracker-spend-records` HTTP 200 后，检查所有卡片的名称、六行金额、计算样式尺寸和滚动尺寸，并保存整页截图。

真实账目与页面显示：

| 分组 | 本月 USD/CNY | 本年 USD/CNY | 总累计 USD/CNY |
|---|---|---|---|
| VPN | 2.78 / 20.00 | 12.78 / 92.00 | 12.78 / 92.00 |
| API | 105.56 / 760.00 | 119.44 / 860.00 | 119.44 / 860.00 |
| 订阅 | 38.19 / 275.00 | 79.69 / 573.77 | 79.69 / 573.77 |
| Token plan | 0.00 / 0.00 | 5.42 / 39.00 | 5.42 / 39.00 |

| 目标内容宽度 | 实际内容宽度 | 浏览器视口 | 布局 | 结果 |
|---:|---:|---:|---|---|
| 1280 | 1280 | 1562 | 卡片内金额自动两列，第三项换行 | PASS |
| 1440 | 1440 | 1722 | 卡片内三列 | PASS |
| 1920 | 1920 | 2202 | 卡片内三列 | PASS |

三种宽度下所有名称和金额均满足：`scrollWidth <= clientWidth`、`scrollHeight <= clientHeight`、`text-overflow: clip`、无 `truncate`、无 `overflow-hidden`、无 `—`、无 `…`。

通过证据：

- `artifacts/rework/spend-cards/installed-spend-cards.json`（真实 API 分组 totals、页面文本、字号、滚动/客户尺寸、宽度）
- `artifacts/rework/spend-cards/installed-spend-cards-content-1280.png`
- `artifacts/rework/spend-cards/installed-spend-cards-content-1440.png`
- `artifacts/rework/spend-cards/installed-spend-cards-content-1920.png`

结论：Task 2 `PASS`。该诊断安装包不是最终安装包。
