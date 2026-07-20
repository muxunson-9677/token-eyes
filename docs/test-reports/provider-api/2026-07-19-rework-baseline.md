# Token Eyes 重修失败基线 — 2026-07-19

- 工作树：`D:\04-AI-Project\010-Token eye\.worktrees\provider-api`
- 分支：`codex/token-eyes-provider-api`
- HEAD：`6b80a3378417c16a8763377c85e0434bd78ca0b4`
- 本轮只读复核时间：`2026-07-19T21:19:20+08:00`
- 状态：`FAIL / INCOMPLETE`

本文件冻结本轮修改生产代码前的失败事实。所有邮箱、账号 ID、授权参数、令牌与 Cookie 均已脱敏；Cockpit Tools 仅作只读对照。旧报告中的 Cursor 双账号要求已废止，本轮只验收截图中标记“当前”的唯一账号。

## 1. 成本环比失败基线

安装版正式页面在 2026-07-19 的原始文字为：

| 卡片 | 安装版 UI | 原始账目本期 | 原始账目上期 | 正确公式结果 | 结论 |
|---|---:|---:|---:|---:|---|
| API 成本 | `较上月新增 1422.0%` | `6603.138389` | `463.393724` | `(6603.138389-463.393724)/463.393724×100% = 1325.0%` | FAIL |
| 订阅成本 | `与上月持平` | `0` | `0` | 持平 | 待修后重新核账 |
| 本月总成本 | `较上月新增 1425.0%` | `6749.666167` | `472.143724` | `(6749.666167-472.143724)/472.143724×100% = 1329.6%` | FAIL |
| 其他 AI 花销 | 未在总览卡显示环比 | `146.527778` | `8.75` | `1574.6%` | 原始账目辅助核对 |

区间为 `Asia/Shanghai`：本期 `2026-07-01..2026-07-19`，上期 `2026-06-01..2026-06-19`。UI 的 `1425.0%` 与 API 的 `current/previous×100` 数值吻合，证明发生了 ratio/delta 绑定错位，不能当作增长率。

证据：

- `artifacts/final-acceptance/mom-post-install-redacted.json`
- `artifacts/final-acceptance/installed-spend-usage-text.json`
- `artifacts/final-acceptance/installed-spend-1280.png`
- `artifacts/final-acceptance/installed-spend-1440.png`
- `artifacts/final-acceptance/installed-spend-1920.png`

## 2. 自定义花销卡片失败基线

旧验收提取到正式安装版真实数据页的自定义花销分组为 `当月花销: —`、`累计花销: —`，而本地 API 存在 13 条 7 月 `other_ai` 花销记录。现有 `cost-group-1280/1440/1920.png` 是 fixture/独立验证页，不是正式安装版真实数据页面，不能用于通过验收。现有三张 `installed-spend-{1280,1440,1920}.png` 展示的是“使用统计”总览而非完整自定义花销分组，也不能证明六个 USD/CNY 金额完整可读。

证据：

- `docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md` R2
- `artifacts/final-acceptance/installed-spend-cost.png`
- `artifacts/final-acceptance/cost-group-1280.png`（fixture，明确不作为安装版验收）
- `artifacts/final-acceptance/cost-group-1440.png`（fixture，明确不作为安装版验收）
- `artifacts/final-acceptance/cost-group-1920.png`（fixture，明确不作为安装版验收）

结论：三个正式安装版内容宽度均无合格证据，且真实金额显示为破折号，`FAIL`。

## 3. Cursor 当前唯一账号失败基线

同账号匹配依据：Cockpit 截图中标记“当前”的账号邮箱脱敏前缀为 `evelyn…`，Auth ID 脱敏尾部为 `…MKZ2XX…`；Token Eyes 当前 Cursor 套餐备注为 `evely`。最终仍需用户确认该脱敏备注对应同一账号。

| 字段 | Cockpit Tools 截图（2026-07-19 19:03 +08:00） | Token Eyes 本地 API（2026-07-19 21:19 +08:00） |
|---|---:|---:|
| 套餐 | PRO | Pro |
| Total Usage | 27% | 0（`sync_status=not_configured`，不得视为真实额度） |
| Auto + Composer | 20% | 未成功同步 |
| API Usage | 72% | 未成功同步 |
| 重置时间 | 2026-08-06 22:31 +08:00 | 空 |
| 最后同步 | Cockpit 卡片时间 2026-07-07 19:15 | Token Eyes 最后成功时间字段 2026-07-19T10:40:21.036Z，但本次失败于 2026-07-19T13:14:56.404Z |

Token Eyes 当前状态还有 `CURSOR_CONSOLE_SYNC_REQUIRED`，已有授权刷新后 `usage-summary` 返回 401。授权存在但额度同步未成功，不能显示“已连接 + 0”。

证据：

- `C:\Users\admin\AppData\Local\Temp\codex-clipboard-7c802e62-eaa3-47e6-a4db-fbe1548a734f.png`
- `C:\Users\admin\AppData\Local\Temp\codex-clipboard-b78054ee-2bae-44f5-98c6-f4512b4313d2.png`
- `artifacts/final-acceptance/cursor-account-a-usage-redacted.json`
- `artifacts/final-acceptance/token-plans-redacted.json`

结论：相同账号非零额度未同步，且没有 60 秒实时对账，`FAIL`。

## 4. TRAE OAuth 与额度失败基线

Cockpit Tools 的历史流程样例（不是硬编码目标）：脱敏账号备注 `Muxunson`、用户 ID 尾部 `…6825`、套餐 `速通 Pro`、剩余 75 次、已用约 25%、重置 `2026-08-01 00:03 +08:00`。OAuth 模态框打开 `https://www.trae.cn/authorization?...`，有效期 600 秒、轮询约 1 秒。

Token Eyes 本地 API 在 `2026-07-19T21:19:20+08:00` 的 TRAE 计划为：

- `sync_status=unsupported`
- `used_quota=0`、`total_quota=0`、`remaining_quota=0`
- 无 `session_ref`、无 `account_id`、无成功同步时间
- 错误文案仍称“当前没有可复现官方额度查询能力”，与 Cockpit 同机成功事实冲突

现有 guidance 只证明 `LoginHost=www.trae.cn`；没有证明浏览器授权、回调/轮询、换令牌、额度查询或自动退出等待态成功。

证据：

- `C:\Users\admin\AppData\Local\Temp\codex-clipboard-2a41817b-eeaf-4828-839d-716fab6f825e.png`
- `C:\Users\admin\AppData\Local\Temp\codex-clipboard-353ed59c-fc96-4991-9698-edf86b2d0201.png`
- `artifacts/final-acceptance/trae-login-guidance-redacted.json`
- `artifacts/final-acceptance/token-plans-redacted.json`

结论：真实 OAuth 与额度闭环均未完成，`FAIL`。

## 5. 自动化基线

旧基线与最终失败报告记录：根 `npm test` 为 52 个既有失败，后续旧实现增加到 53 个失败；新增回归为 `workspace and cards expose the approved layered surface hierarchy`。Dashboard 测试和 Rust `--lib` 当时通过，但不能替代上述四项安装版真实验收。

本轮后续每项将遵循：新增失败测试并确认正确失败 → 最小修复 → 目标测试通过 → 正式安装版真实数据复验。四门全部 PASS 前不构建最终安装包。
