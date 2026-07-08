# TE-NEXT-W03E-R3A 小米 MiMo 官方控制台额度接口契约确认

> 复制本文件全文给 Claude 执行。此工单是串行前置工单，完成并通过审核前，不要启动后续 W03E 实现工单。

## 背景

R3D 已完成并放行。Token 套餐模块必须保持：

`新增套餐 -> 服务商 -> 套餐 -> 检测方式`

严禁再做独立“小米控制台连接卡片”。小米 MiMo 只能作为服务商/套餐/检测方式中的一种能力存在。

当前准备进入 W03E：小米 MiMo 官方控制台实时额度同步。实现前必须先确认官方控制台是否存在稳定、可复现、可解析的额度接口契约。

## 本工单目标

只做“额度接口契约确认”。

不要写前端实现。不要接入刷新链路。不要做假同步。

你需要确认：

1. 小米 MiMo 官方控制台登录后，是否存在可稳定获取套餐额度、剩余额度、周期信息的接口。
2. 该接口需要哪些请求条件：URL、method、headers、body、认证依赖。
3. 返回结构中哪些字段可映射到 Token Eyes 的套餐额度模型。
4. 如果无法确认稳定接口，必须明确写出 `BLOCKED` 原因，不能编造字段或用页面文案当接口契约。

## 必读文件

先读取这些文件，按现有约束执行：

- `D:\04-AI-Project\010-Token eye\CLAUDE.md`
- `D:\04-AI-Project\010-Token eye\上下文.md`
- `D:\04-AI-Project\010-Token eye\docs\tasks\dispatch\TE-NEXT-W03-R3-token-plan-auth-methods-dispatch.md`
- `D:\04-AI-Project\010-Token eye\docs\tasks\dispatch\TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md`

如果存在，也读取：

- `D:\04-AI-Project\010-Token eye\docs\tasks\dispatch\TE-NEXT-W03D-R2-xiaomi-mimo-console-quota-endpoint-discovery.md`
- `D:\04-AI-Project\010-Token eye\docs\tasks\dispatch\TE-NEXT-W03E-R2-xiaomi-mimo-live-quota-sync-integration.md`
- `D:\04-AI-Project\010-Token eye\docs\tasks\dispatch\TE-NEXT-W03E-token-plan-live-quota-integration-acceptance.md`

## 硬约束

1. 不允许新增独立小米控制台连接卡片。
2. 不允许把“打开过官方窗口”当成已连接或已同步。
3. 不允许用 mock 数据、页面展示文案、人工填额度来冒充官方实时同步。
4. 不允许保存 cookie、token、api key、session secret 到配置文件。
5. 不允许把真实密钥、cookie、Authorization、Set-Cookie 写入测试、日志、报告。
6. 如果只能靠浏览器页面人工查看额度，而没有稳定接口，必须标记为 `BLOCKED`。
7. 本工单不改 `dashboard/src/components/settings/TokenPlanSection.jsx`，除非只是修正文档引用中的路径错误。
8. 本工单不实现 `refreshPlan` 接入，不改套餐保存流程。

## 交付物

### 1. 契约文档

创建或更新：

`D:\04-AI-Project\010-Token eye\docs\dev-notes\xiaomi-mimo-console-quota-contract-2026-06-27.md`

文档必须包含：

- 结论：`READY` 或 `BLOCKED`
- 控制台入口 URL
- 额度接口 URL pattern
- method
- request headers，必须脱敏
- request body schema，如无 body 写明无
- response schema，必须脱敏
- 字段映射：
  - plan name / package name
  - quota total
  - quota used
  - quota remaining
  - reset cycle / expire time
  - currency or token unit if present
- 错误状态：
  - 未登录
  - session 过期
  - 套餐不存在
  - 接口限流
  - 网络失败
- 隐私和安全说明：
  - 哪些字段不能持久化
  - 哪些字段可以进入本地套餐记录
- 后续 W03E-R3B 可实现的最小接口建议

### 2. 脱敏 fixture，可选但推荐

如果拿到了真实响应结构，创建脱敏 fixture：

- `D:\04-AI-Project\010-Token eye\test\fixtures\xiaomi-mimo-console\quota-success.json`
- `D:\04-AI-Project\010-Token eye\test\fixtures\xiaomi-mimo-console\quota-expired-session.json`

fixture 必须满足：

- 不包含真实 cookie
- 不包含真实 token
- 不包含真实用户 ID
- 不包含真实手机号、邮箱、订单号
- 数值可以保留结构意义，但用户标识必须替换为 `redacted_*`

如果没有稳定接口，不要创建假 fixture。

### 3. 可选契约测试

如果 fixture 已创建，可以新增最小契约测试：

`D:\04-AI-Project\010-Token eye\test\xiaomi-mimo-console-quota-contract.test.js`

测试只验证脱敏响应结构和字段映射，不实现网络请求。

## 执行步骤

1. 读取必读文件，确认当前 R3 约束。
2. 检查已有 W03D/W03E 任务文档，避免重复发明接口。
3. 使用官方控制台登录态观察网络请求，寻找真实额度接口。
4. 记录接口契约，所有敏感值脱敏。
5. 判断是否 `READY`。
6. 如果 `READY`，补充脱敏 fixture 和可选契约测试。
7. 如果 `BLOCKED`，只写清楚阻塞原因，不写实现代码。
8. 运行验证命令。
9. 按“Claude 自审模板”自审后再返回结果。

## 验证命令

按实际改动运行：

```powershell
npm.cmd run validate:guardrails
```

如果新增了测试：

```powershell
node --test test/xiaomi-mimo-console-quota-contract.test.js
```

再做敏感信息扫描：

```powershell
rg -n "cookie|authorization|set-cookie|bearer|session|secret|token|phone|email" docs/dev-notes test/fixtures test -S
```

如果命中的是字段名或脱敏占位符，报告中要解释为什么安全。

## Claude 自审模板

提交结果前，必须按这个模板自审。

### A. 需求不变量

逐条回答：

- 是否保持 `新增套餐 -> 服务商 -> 套餐 -> 检测方式`？
- 是否没有新增独立小米控制台连接卡片？
- 是否没有把“打开窗口”当成同步成功？
- 是否没有用 mock/人工额度冒充实时额度？
- 是否没有保存 cookie/token/secret？

### B. 真实链路验证

说明你验证的是哪一种：

- 官方接口真实存在，契约 `READY`。
- 官方接口无法稳定确认，结果 `BLOCKED`。
- 只看到页面数据，没有接口，结果 `BLOCKED`。

不能写“理论上可行”。

### C. 反例检查

主动构造这些反例并说明结果：

- 未登录时返回什么？
- session 过期时返回什么？
- 套餐不存在时返回什么？
- 接口返回字段缺失时是否能识别？
- 返回结构变化时后续实现如何失败得可见？

### D. 安全检查

说明新增文件中是否出现：

- cookie
- Authorization
- Set-Cookie
- bearer token
- session id
- api key
- 手机号/邮箱/用户 ID

如出现，必须说明是字段名、脱敏占位符，还是必须删除的泄漏。

### E. 测试和命令

列出实际运行命令和结果，不要只写“已测试”。

### F. 最终结论

只允许三种：

- `READY：可以进入 W03E-R3B 后端 adapter 实现`
- `BLOCKED：缺少稳定官方额度接口`
- `NEEDS_REWORK：本工单信息不足或存在安全问题`

## 返回格式

返回时给 Codex：

1. 改动文件列表
2. 契约结论：`READY` / `BLOCKED` / `NEEDS_REWORK`
3. 关键接口摘要，敏感值必须脱敏
4. 验证命令和结果
5. 自审结果
6. 如果 `BLOCKED`，明确下一步需要什么外部信息
