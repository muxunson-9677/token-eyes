# TE-NEXT-W03E - Token 套餐目录、授权与实时额度端到端验收

## 任务 ID

`TE-NEXT-W03E`

## 所属模块

Token 套餐 / 发布前集成验收

## 前置依赖

`TE-NEXT-W03A`、`TE-NEXT-W03B`、`TE-NEXT-W03C`、`TE-NEXT-W03D` 均已完成并提交可审查改动。若 W03A 或 W03D 结论为“无官方额度接口”，本工单的通过标准是准确的手工回退与清晰状态，不是伪造实时数据。

## 任务目标

从用户视角和安全边界两方面验收整个流程：选择 Agent 与服务商、选择已核验套餐、绑定账号、同步额度、处理过期授权、自动刷新、手工回退、旧记录兼容和桌面 EXE 构建。发现问题时只做能直接归属到本链路的最小修复。

## 开始前必读

1. `CLAUDE.md`
2. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
3. `docs/tasks/dispatch/TE-NEXT-W03A-xiaomi-mimo-plan-contract-discovery.md`
4. `docs/tasks/dispatch/TE-NEXT-W03B-token-plan-provider-catalog-and-form.md`
5. `docs/tasks/dispatch/TE-NEXT-W03C-token-plan-credential-vault-and-account-authorization.md`
6. `docs/tasks/dispatch/TE-NEXT-W03D-xiaomi-mimo-live-quota-adapter.md`
7. `src/lib/token-plan-refresh.js`
8. `src/lib/local-api.js`
9. `dashboard/src/components/settings/TokenPlanSection.jsx`

## 允许修改的文件

优先新增验收报告：

- 新增：`docs/test-reports/token-plan/2026-06-25-live-quota-integration.md`

发现明确阻塞缺陷时，只允许修改对应工单已经列出的 Token Plan 文件和测试；不扩展功能范围，不重构无关模块。若修改产品代码，必须补充回归测试。

## 验收矩阵

### 场景 1：服务商与套餐选择

1. 新建套餐时，用户先选 Agent 来源，再选服务商，再选套餐。
2. Agent 来源可选 Hermes；服务商可选小米 MiMo 和自定义套餐。
3. 小米套餐列表只显示 W03A 已核验的条目；没有已核验条目时仅显示自定义套餐和原因提示。
4. 固定额度套餐选择后，总额度自动带出官方数值与单位且不可手改。
5. 如果官方确认“110 亿 Token”，界面显示“110 亿 Token”，本地存储为 `11000000000`。
6. 自定义套餐可手动设置额度和到期时间，并明确标为手工数据。

### 场景 2：账号绑定

1. 原生桌面应用只显示 W03A 已确认的授权方式。
2. 用户能完成官方授权或导入官方允许的凭证，随后看到连接状态与删除入口。
3. 网页环境明确提示账号绑定仅支持桌面应用，不显示伪成功。
4. 应用不读取浏览器 Cookie、浏览器数据库、账号密码或验证码。
5. 删除绑定后，套餐记录不再可自动刷新，并显示需要重新授权。

### 场景 3：实时额度与自动刷新

1. 绑定小米账号并点击立即同步后，实时字段只在官方适配器成功时更新。
2. 同步成功显示数据来源、上次同步时间、已用、剩余和到期时间。
3. 开启自动刷新后，本地进程存活期间按设置间隔刷新；停止进程后没有后台服务残留。
4. 授权过期显示重新授权；限流显示稍后重试；网络失败显示可读原因；这些情况均保留上次成功数据。
5. 若官方接口不存在，显示不支持自动同步并回退手工数据，不出现“Cookie 抓取”开关。

### 场景 4：兼容性与秘密检查

1. 旧 `tokenPlans` 记录可读取、编辑和保存，自动归入自定义套餐。
2. 费用归因继续使用 Agent `source` 与既有 `plan_label`，不会把小米显示为额外 Agent。
3. `tracker-config.json`、本地 API 响应、前端状态、日志和构建产物均没有明文令牌、Cookie 或密码。
4. 本地刷新并发保护仍有效，同一套餐重复刷新返回既有冲突提示。

## 执行步骤

### 步骤 1：运行自动化回归

按顺序运行：

```bash
node --test src/lib/token-plan-catalog/index.test.js
node --test test/token-plan-credentials.test.js test/token-plan-providers/xiaomi-mimo.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js test/serve-token-plan-scheduler.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

记录每条命令的退出码和失败详情。已有无关测试失败必须与本工单改动隔离说明，不能把失败直接忽略。

### 步骤 2：进行桌面人工验收

启动本地桌面应用，完成验收矩阵场景 1 至场景 3。使用真实账号前先征得账号所有者同意；截图不得包含完整账号、令牌、Cookie 或余额之外的敏感信息。

若没有官方账号查询能力，使用 W03A 报告中的“不支持”路径完成验收，确认界面不再提供自动 Cookie 抓取。

### 步骤 3：检查秘密是否落盘

在创建、同步、删除测试绑定后执行：

```powershell
rg -n -i "token-plan/|authorization:|cookie:|set-cookie:|api[_-]?key|access[_-]?token|refresh[_-]?token" "$HOME\.tokentracker" dashboard\dist src-tauri\target
```

逐项人工复核命中内容。凭证引用名称允许出现；任何凭证值、请求头、Cookie 值或账号密码均为阻塞问题。

### 步骤 4：形成验收报告

报告固定包含：

```markdown
# Token 套餐实时额度集成验收

## 基准

- 分支：
- 提交：
- W03A 套餐目录版本：
- 官方额度能力：支持 / 不支持

## 自动化验证

| 命令 | 结果 | 说明 |
|---|---|---|

## 用户流程验收

| 场景 | 结果 | 证据或原因 |
|---|---|---|

## 凭证安全检查

- 配置文件：通过 / 阻塞
- API 响应：通过 / 阻塞
- 日志与构建产物：通过 / 阻塞

## 结论

- PASS / BLOCKED
- 已知限制：
```

## 阻塞判定

以下任一情况必须报告为 `BLOCKED`：

1. 未核验的套餐或额度出现在默认目录中。
2. 小米实时数据来自非官方、逆向或自动浏览器 Cookie 抓取。
3. 任何秘密写入普通文件、API 响应、UI、日志或构建产物。
4. 授权失败时清空最近一次成功额度或显示“同步成功”。
5. Agent 与服务商身份混淆，导致 Hermes 的 MiMo 用量显示为独立 Agent。
6. 旧套餐记录无法读取，或手工套餐无法继续使用。
7. 自动化验证失败且无法证明与本工单无关。

## 验收标准

1. 通过验收矩阵全部适用场景；官方不支持路径以明确手工回退为通过条件。
2. 自动化命令、桌面构建和秘密检查都成功。
3. 报告完整记录目录证据版本、账号同步能力和已知限制。
4. 生成可测试的 `src-tauri/target/release/token-eyes.exe` 或项目当前配置的同等可执行文件，并报告实际路径与 SHA-256。

## 禁止事项

- 不为了让验收通过而手工篡改实时字段或 mock 生产接口。
- 不把测试账号的秘密放入报告、截图、提交记录或工单。
- 不修复超出 Token Plan 链路的无关问题。
- 不删除既有安全提示来掩盖“无官方接口”的限制。

## 完成后报告

提交验收报告路径、验证命令结果、桌面 EXE 的绝对路径与 SHA-256、最终结论和所有阻塞项。
