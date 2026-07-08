# W03E-R3C Xiaomi MiMo Official Quota Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` before implementation and `superpowers:systematic-debugging` for any failed contract or integration check. Execute only this work order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 R3B 已证明的真实、安全会话边界上实现小米 MiMo 官方额度适配器，并把结果接入 Token Plan 刷新框架且不破坏旧额度。

**Architecture:** provider adapter 只负责调用 R3B 明确的 `callable_boundary`、校验响应和归一化 quota DTO；认证由 R3B 指定的会话所有者处理。`refreshPlan` 负责把 adapter 成功或失败映射到统一 `sync_status`，失败永远只更新状态字段，不清空上次成功额度。

**Tech Stack:** Node.js 20 CommonJS、现有 Token Plan refresh registry、本地 API、Node Test Runner、R3B 契约定义的 Tauri/会话边界。

---

## 0. 硬门禁

开始写代码前逐项确认：

- [ ] `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md` 最终结论为 `READY`。
- [ ] READY 基于真实小米控制台登录态请求，不是社区线索或 mock。
- [ ] 契约明确 `endpoint`、`method`、`response_shape`、`auth_boundary`、`quota_fetch_owner`、`callable_boundary` 和 `status_mapping`。
- [ ] R3B 的会话调用能力已经落盘并通过测试，不只是设计建议。
- [ ] `callable_boundary` 能被本工单允许修改的代码实际调用。

任一项不成立：不要修改生产代码；按本文件末尾 `ARCHITECTURE_BLOCKED` 模板返回。尤其不能在 Node 中重新请求接口并要求复制 WebView Cookie。

## 1. 开始前必读

- `CLAUDE.md`
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`
- `docs/dev-notes/token-plan-detection-contract.md`
- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
- `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
- `src/lib/token-plan-custom-api.js`，只参考返回状态和脱敏方式
- `test/token-plan-refresh.test.js`
- `test/token-plans-api.test.js`
- R3B 实际新增的会话测试和 callable boundary

## 2. 允许修改或新增的文件

- Create: `src/lib/token-plan-providers/xiaomi-mimo.js`
- Create: `test/token-plan-xiaomi-mimo-provider.test.js`
- Modify: `src/lib/token-plan-refresh.js`
- Modify: `src/lib/local-api.js`，仅当 R3B 契约要求本地 API 传递非敏感 quota DTO 或 session reference
- Modify: `test/token-plan-refresh.test.js`
- Modify: `test/token-plans-api.test.js`
- Modify: R3B 契约文档，仅修正实现中发现的字段歧义；不得把未验证内容改成 READY

默认禁止修改：

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/content/copy.csv`
- `src-tauri/`，R3B 的会话能力必须在本工单开始前完成
- 套餐目录价格、Spend、Dashboard、edge patches、发布配置

如果 `callable_boundary` 要求修改默认禁止区域，停止并报告架构边界不匹配，不要跨范围补洞。

## 3. 数据和状态不变量

成功结果只能写入以下额度字段：

```json
{
  "total_quota": 0,
  "used_quota": 0,
  "remaining_quota": 0,
  "expires_at": "",
  "provider_reported_at": "",
  "quota_source": "official_account",
  "sync_status": "success"
}
```

具体字段类型和缺省规则以 R3B 真实契约为准，但以下不变量不可改变：

- `detection_method` 保持 `official_account`。
- 401/403 或明确会话失效映射为 `sync_status=reauth_required`。
- 官方不支持当前套餐或响应结构已经漂移时映射为 `unsupported`，不能伪成功。
- 网络、限流和服务端临时错误映射为 `failed`，并保留可脱敏的错误码。
- 失败时不得覆盖 `total_quota`、`used_quota`、`remaining_quota`、`expires_at`、`last_synced_at`。
- 只有成功时更新 `last_synced_at`；每次尝试更新 `last_sync_attempt_at`。
- 不把 Cookie、Authorization、token、完整响应头或账号标识写入 plan。

## 4. Task 1：先写 provider adapter 失败测试

- [ ] 创建 `test/token-plan-xiaomi-mimo-provider.test.js`。
- [ ] 使用依赖注入的 fake transport 测试纯 adapter；fake 只模拟 R3B 已确认的 DTO，不模拟登录成功证明。
- [ ] 覆盖真实成功响应到标准字段的映射。
- [ ] 覆盖 total/used/remaining 的数字字符串或契约实际类型。
- [ ] 覆盖必需字段缺失、非数字、负数和 `used > total` 的契约处理。
- [ ] 覆盖 401、403、404、429、5xx 和网络异常的结构化错误映射。
- [ ] 覆盖错误消息脱敏：输入中即使带疑似 token，也不得原样进入返回错误。
- [ ] 覆盖 adapter 输出中不存在 `cookie`、`authorization`、`token`、`headers`、`raw_response`。

运行：

```powershell
node --test test/token-plan-xiaomi-mimo-provider.test.js
```

预期：测试因模块或导出尚不存在而失败。若测试直接通过，说明没有验证新行为，应修正测试。

## 5. Task 2：实现最小 adapter

`src/lib/token-plan-providers/xiaomi-mimo.js` 使用 CommonJS，并只承担以下责任：

1. 校验输入 plan 是 `provider_id=xiaomi_mimo` 且 `detection_method=official_account`。
2. 通过依赖注入调用 R3B `callable_boundary`；不得在模块里读取浏览器 Cookie。
3. 校验 R3B 真实契约中的响应结构。
4. 转换为 Token Plan 标准 quota DTO。
5. 抛出带稳定非敏感 `code` 的结构化错误，供 `refreshPlan` 映射。

- [ ] 不引入通用 adapter 框架或额外配置系统。
- [ ] 不把 endpoint、字段路径或状态猜测写死为 R3B 契约之外的值。
- [ ] 不保存认证数据；日志只允许 provider、非敏感状态码和稳定错误码。
- [ ] 运行 Task 1 测试直至通过。

建议稳定错误语义：

| adapter error code | `sync_status` | 含义 |
|---|---|---|
| `XIAOMI_MIMO_REAUTH_REQUIRED` | `reauth_required` | 会话失效或 401/403 |
| `XIAOMI_MIMO_UNSUPPORTED` | `unsupported` | 套餐/接口不支持或响应契约漂移 |
| `XIAOMI_MIMO_RATE_LIMITED` | `failed` | 429，可重试但本轮失败 |
| `XIAOMI_MIMO_REQUEST_FAILED` | `failed` | 网络或 5xx |
| `XIAOMI_MIMO_RESPONSE_INVALID` | `unsupported` | 返回结构无法安全解释 |

如 R3B 契约已经定义不同稳定码，使用 R3B 的码并同步测试，不要维护两套名称。

## 6. Task 3：测试优先接入 `refreshPlan`

先修改 `test/token-plan-refresh.test.js`，新增或强化以下断言：

- [ ] `official_account + xiaomi_mimo + adapter success` 写入标准 quota 字段和 `last_synced_at`。
- [ ] 401/403 映射 `reauth_required`，旧额度完全不变。
- [ ] 无效结构映射 `unsupported`，旧额度完全不变。
- [ ] 429/5xx 映射 `failed`，旧额度完全不变。
- [ ] 没有 READY adapter 的其他 provider 仍返回现有 `PROVIDER_UNSUPPORTED`。
- [ ] `custom_api` 成功、401 和普通失败行为保持不变。

先运行并确认失败：

```powershell
node --test test/token-plan-refresh.test.js
```

然后最小修改 `src/lib/token-plan-refresh.js`：

- 注册或加载 `xiaomi_mimo` adapter，遵循现有 `registerProviderAdapter/getProviderAdapter` 机制。
- 根据 adapter 稳定错误码映射统一状态。
- 保留原有 `official_account` 无 adapter 时的 unsupported 分支。
- 失败分支只展开 `...plan` 并覆盖状态字段，禁止把额度清零或改成 `undefined`。
- 不更改 `custom_api` 和 legacy refresh 行为。

再次运行测试，预期全部通过。

## 7. Task 4：接入本地 API 和 scheduler

只有 R3B callable boundary 需要 local API 参与时才修改 `src/lib/local-api.js`。否则保持不动。

- [ ] 先在 `test/token-plans-api.test.js` 写失败测试。
- [ ] 覆盖手动 refresh endpoint 的真实成功 DTO。
- [ ] 覆盖 401/403、结构漂移和网络失败仍保留旧额度。
- [ ] 覆盖写操作继续要求 local auth。
- [ ] 覆盖 API 响应不包含认证数据和原始响应。
- [ ] 覆盖 scheduler 使用同一 adapter，不创建第二套实现。

运行失败测试：

```powershell
node --test test/token-plans-api.test.js
```

再实现最小接线并复跑。不要新增仅为小米服务的重复 CRUD endpoint；优先复用现有 token plan refresh endpoint。

## 8. Task 5：完整回归

```powershell
node --test test/token-plan-xiaomi-mimo-provider.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js test/token-plan-console-sessions.test.js test/token-plan-custom-api.test.js
npm.cmd run validate:guardrails
npm.cmd run validate:copy
git diff --check
```

然后执行敏感信息扫描：

```powershell
rg -n "cookie|authorization|set-cookie|bearer|password|api[_-]?key|serviceToken" src/lib/token-plan-providers/xiaomi-mimo.js test/token-plan-xiaomi-mimo-provider.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js -i
```

逐条解释允许的字段名或测试描述；真实值必须为零。

## 9. 禁止事项

- R3B 不是 READY 时禁止写代码。
- 禁止在 Node/Rust 中复制或持久化 WebView Cookie。
- 禁止用 fake transport 的通过结果冒充真实官方同步。
- 禁止修改前端视觉和文案。
- 禁止把小米套餐价格、额度或过期时间写死。
- 禁止失败时清空旧额度。
- 禁止把 unsupported 显示或返回为 success。
- 禁止引入未声明依赖和通用抽象层。
- 禁止提交、reset 或清理共享工作区。

## 10. 完成标准

- R3B 契约门禁成立。
- adapter 只消费安全 callable boundary。
- 真实响应结构有契约测试。
- 状态映射和旧额度保留全部有测试。
- local API/scheduler 复用同一实现。
- custom API 回归通过。
- 敏感信息未落盘。
- 指定验证 100% 通过。

## 11. 返回模板

```markdown
## W03E-R3C 结果
- 结论：COMPLETED / ARCHITECTURE_BLOCKED
- 使用的 R3B callable_boundary：
- adapter 注册键：

## 修改文件
- 路径与责任：

## 行为矩阵
- success：
- 401/403：
- invalid response：
- 429/5xx：
- 旧额度保留：

## 验证
- 命令与结果：

## 安全检查
- 是否读取、保存或输出 Cookie/token：否

## 下一步
- R3D 是否可派发：是 / 否
- 若否，缺失门禁：
```
