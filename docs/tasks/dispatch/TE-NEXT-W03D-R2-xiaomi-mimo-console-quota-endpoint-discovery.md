# TE-NEXT-W03D-R2：小米 MiMo 控制台额度数据源探测

## 任务目标

在用户授权登录小米 MiMo 官方控制台后，找出控制台用于展示 Token Plan 状态的真实数据源，形成可复现的数据契约，用于后续自动同步。

本工单的输出不是“没有公开 API，所以手动填写”。本工单必须围绕控制台真实状态进行探测。如果无法找到稳定数据源，必须提交阻塞报告和证据。

## 前置条件

满足任一条件即可开始：

- `TE-NEXT-W03C-R2` 已提供应用内控制台会话。
- 用户允许执行代理使用人工 DevTools 或 HAR 文件探测控制台网络请求，且 HAR 文件已经脱敏。

如果两者都没有，本工单不能执行。

## 官方依据

- 功能更新页说明 Token Plan 支持用量查询：https://mimo.mi.com/docs/zh-CN/updates/feature
- 官方控制台入口：https://platform.xiaomimimo.com/token-plan
- 文档入口提供控制台链接：https://mimo.mi.com/docs/zh-CN/quick-start/first-api-call

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03-R2-live-quota-dispatch-order.md`
3. `docs/tasks/dispatch/TE-NEXT-W03C-R2-xiaomi-mimo-console-session-auth.md`
4. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
5. `src/lib/local-api.js`
6. `dashboard/src/components/settings/TokenPlanSection.jsx`

## 允许修改或新增的文件

- 新增：`docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-25.md`
- 新增：`scripts/dev/xiaomi-mimo-console-probe.cjs`
- 新增：`test/fixtures/xiaomi-mimo-console/quota-response.redacted.json`
- 新增：`test/fixtures/xiaomi-mimo-console/plan-response.redacted.json`
- 新增：`test/xiaomi-mimo-console-contract.test.js`
- 修改：`package.json`，仅当需要新增探测脚本命令时修改

不要修改生产同步逻辑。生产同步属于 `W03E-R2`。

## 探测范围

必须覆盖以下官方页面或等价控制台路径：

- `https://platform.xiaomimimo.com/console/balance`
- `https://platform.xiaomimimo.com/console/plan-manage`
- `https://platform.xiaomimimo.com/console/usage`
- `https://platform.xiaomimimo.com/token-plan`

如果实际路由使用 hash 或前端重写，以浏览器地址栏和网络请求为准记录。

## 任务 1：记录控制台网络请求

使用以下任一方式：

1. 应用内会话探测：通过 `W03C-R2` 的受控会话打开控制台，并记录同域 `fetch` / XHR 请求。
2. 人工 DevTools 探测：用户登录官方控制台后导出 HAR，执行代理只处理已脱敏 HAR。

记录时只允许保存：

- 请求方法。
- 请求 URL 的 origin、pathname、query 参数名。
- HTTP 状态码。
- 响应 JSON 的字段结构。
- 与额度相关的数值字段，账号 ID、手机号、邮箱、姓名、Cookie、token 必须脱敏。

禁止保存：

- Cookie。
- Authorization。
- Set-Cookie。
- access token。
- refresh token。
- 手机号、邮箱、真实姓名。
- 完整请求头。
- 完整原始响应体。

## 任务 2：形成数据契约报告

新增 `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-25.md`，必须包含：

```markdown
# 小米 MiMo 控制台额度数据契约

## 探测环境

- 日期：
- Token Eyes 运行形态：桌面端 / 人工 DevTools
- 登录方式：官方控制台页面登录
- 使用页面：

## 发现的数据源

| 页面 | 方法 | Path | 用途 | 是否需要登录 | 是否稳定 |
|---|---|---|---|---|---|

## 字段映射

| 产品字段 | 控制台字段路径 | 单位 | 说明 |
|---|---|---|---|
| total_quota |  | credits | 总额度 |
| used_quota |  | credits | 已用额度 |
| remaining_quota |  | credits | 剩余额度 |
| expires_at |  | ISO 日期或控制台日期 | 到期时间 |

## 状态码映射

| 状态 | 产品含义 |
|---|---|
| 200 | 同步成功 |
| 401/403 | 需要重新登录 |
| 429 | 限流，稍后重试 |
| 5xx | 服务商暂不可用 |

## 安全审查

- 是否保存 Cookie：否
- 是否保存 Authorization：否
- 是否保存账号敏感信息：否

## 结论

- PASS：存在可稳定读取的数据源
- BLOCKED：控制台无稳定数据源，附复现证据
```

不得留下空白字段。没有发现时写“未发现”，并附复现步骤。

## 任务 3：生成脱敏 fixture 和契约测试

新增 fixture：

- `test/fixtures/xiaomi-mimo-console/quota-response.redacted.json`
- `test/fixtures/xiaomi-mimo-console/plan-response.redacted.json`

要求：

- 保留响应结构。
- 数值可以保留数量级，但账号标识必须脱敏。
- 不含 Cookie、token、手机号、邮箱。

新增 `test/xiaomi-mimo-console-contract.test.js`：

- 读取报告中确认的 fixture。
- 断言能提取 `total_quota`、`used_quota`、`remaining_quota`、`expires_at`。
- 断言单位为 `credits`。
- 断言脱敏 fixture 不含 `cookie`、`authorization`、`token`、手机号、邮箱。

运行：

```powershell
node --test test/xiaomi-mimo-console-contract.test.js
```

## 阻塞报告要求

如果找不到稳定数据源，报告必须包含：

- 登录后用户是否能在页面看到额度状态。
- 尝试过的页面列表。
- 是否有 XHR/fetch 请求。
- 是否只有静态 HTML 或加密数据。
- 是否因为风控、验证码、跨域、同源策略或 CSP 阻塞。
- 不能同步的技术原因。

阻塞报告不能写“建议手动填写”作为完成方案；只能写“当前实时同步阻塞”。

## 最终验证

运行：

```powershell
node --test test/xiaomi-mimo-console-contract.test.js
npm run validate:guardrails
```

人工检查：

```powershell
rg -n -i "cookie|authorization|set-cookie|access_token|refresh_token|手机号|邮箱" docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-25.md test/fixtures/xiaomi-mimo-console
```

命中必须逐条人工复核。字段名作为结构说明可以出现，真实凭证值不得出现。

## 验收标准

- 找到可复现的数据源，并形成字段映射；或提交证据充分的阻塞报告。
- 有脱敏 fixture。
- 有契约测试。
- 没有凭证泄露。

## 禁止事项

- 不把“没有公开 API”当成阻塞终点。
- 不把手动录入当成完成。
- 不保存原始 HAR。
- 不提交任何真实 Cookie、token、手机号、邮箱。
- 不在本工单实现生产适配器。
