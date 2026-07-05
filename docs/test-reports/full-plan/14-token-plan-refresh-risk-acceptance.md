# TE-FULL-F04 - Token Plan Refresh Risk Acceptance Report

## 分支和 Commit

- **验收分支**: `claude/te-full-f04-token-plan-refresh-risk-acceptance`
- **基准分支**: `claude/te-full-f03-token-plan-auto-refresh-scheduler`
- **基准 commit**: `01c8ba2`
- **是否修改产品代码**: 否（仅新增本报告）

## 验收结果总览

| 验收项 | 结果 | 说明 |
|--------|------|------|
| API/单元验收 | ✅ PASS | 19/19 测试通过 |
| 凭证安全验收 | ✅ PASS | 白名单机制正常工作 |
| UI 文案验收 | ✅ PASS | 文案已更新，不再显示过时内容 |
| 常规验证 | ✅ PASS | typecheck、build、validate 全部通过 |

## API/单元验收

### 运行命令

```bash
node --test test/token-plans-api.test.js test/token-plan-refresh.test.js
```

### 测试结果

```
ℹ tests 19
ℹ pass 19
ℹ fail 0
ℹ duration_ms 89.4542
```

### 逐项确认

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | `manual` refresh 返回 success，`next_refresh_at=""` | ✅ PASS |
| 2 | `official_api` 无 adapter 时返回 failed，写入中文可读错误 | ✅ PASS |
| 3 | `cookie_scrape` 返回 failed，写入风险提示 | ✅ PASS |
| 4 | `credential_ref` 白名单：`codex_auth_json`/`claude_credentials_json`/`""` | ✅ PASS |
| 5 | 同一 plan 并发 refresh 返回 409 | ✅ PASS |
| 6 | 测试覆盖调度器 404、due plan 扫描等场景 | ✅ PASS |

### 详细验证

**1. manual 方法 (test: `refreshPlan manual returns success and no next_refresh_at`)**
- 状态: `"success"`
- `next_refresh_at`: `""` （不安排下次刷新）
- `last_refresh_status`: `"success"`

**2. official_api 无 adapter (test: `refreshPlan official_api fails when no provider adapter`)**
- 状态: `"failed"`
- `last_refresh_status`: `"failed"`
- 错误信息: `"不支持自动刷新：缺少官方接口。当前没有可用的 provider quota API，请改为手动录入。"`

**3. cookie_scrape (test: `refreshPlan cookie_scrape fails with risk notice`)**
- 状态: `"failed"`
- `last_refresh_error`: 包含 `"Cookie 抓取未配置"` 和 `"账号风控风险"`
- 不读取任何真实 cookie，不执行网络请求

**4. 并发保护 (test: `scheduler refreshById prevents concurrent in-flight for same plan`)**
- 同一 plan 并发刷新返回 `statusCode: 409`, `ok: false`
- 第一次刷新在 adapter resolve 后正常完成

**5. API 端点集成 (token-plans-api.test.js 3 个新增测试)**
- `token plans API persists F03 refresh fields`: 创建带 refresh 字段的 plan 后，GET 返回正确字段
- `token plans refresh endpoint writes failed status when no provider API`: refresh 端点写入 failed 状态
- `token plans refresh endpoint handles manual method as success no-op`: manual 方法 refresh 返回 success 且 `next_refresh_at=""`

## 凭证安全验收

### 运行命令

```bash
node -e "const { pickCredentialRef } = require('./src/lib/token-plan-refresh');
  // 测试各种输入
"
```

### 结果

| 输入 | 输出 | 预期 | 状态 |
|------|------|------|------|
| `"raw-secret-cookie-token"` | `""` | `""` | ✅ |
| `"codex_auth_json"` | `"codex_auth_json"` | `"codex_auth_json"` | ✅ |
| `"claude_credentials_json"` | `"claude_credentials_json"` | `"claude_credentials_json"` | ✅ |
| `""` | `""` | `""` | ✅ |
| `"sk-ant-api-xxx"` (bearer token) | `""` | `""` | ✅ |
| `"sessionKey=abc123"` (cookie) | `""` | `""` | ✅ |

**结论**: 只有 `codex_auth_json`、`claude_credentials_json`、空字符串被允许。原始 token/cookie/任意字符串均被拒绝并返回空字符串。不保存、不读取原始凭证。

## UI 验收

### 运行命令

```bash
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx
```

### 测试结果

```
✓ src/components/settings/TokenPlanSection.test.jsx (2 tests) 451ms
  ✓ loads, edits, and saves manual token plan records 391ms
  ✓ triggers manual refresh and updates status

Test Files  1 passed (1)
     Tests  2 passed (2)
```

### UI 文案检查

| 文案 key | 当前值 | 状态 |
|----------|--------|------|
| `settings.token_plan.subtitle` | "记录套餐额度，并可在本地进程存活时按配置刷新；官方接口不可用时会显示失败原因。" | ✅ 不再说"自动刷新后续再做" |
| `settings.token_plan.empty` | "暂无 Token 套餐记录。" | ✅ 不再说"手动 Token 套餐记录" |
| "立即刷新"按钮 | 触发 `refreshTokenPlan(id)` | ✅ 测试确认 |
| `last_refresh_error` 显示 | 刷新失败时显示错误信息 | ✅ 代码逻辑确认 |

## 常规验证

| 命令 | 结果 |
|------|------|
| `npm.cmd --prefix dashboard run typecheck` | ✅ 无类型错误 |
| `npm.cmd run dashboard:build` | ✅ 构建成功（仅有 chunk size 优化建议，非错误） |
| `npm.cmd run validate:copy` | ✅ 无致命错误（仅有 unused key 警告，包括动态拼接 key 的 false positive） |
| `npm.cmd run validate:guardrails` | ✅ "Guardrails ok: no violations found." |

## 阻塞判定

以下阻塞条件逐一确认：

| 阻塞条件 | 状态 | 说明 |
|----------|------|------|
| 原始 token/cookie 被保存到 config | ✅ 不阻塞 | `pickCredentialRef` 白名单机制确保任意字符串被拒绝 |
| `cookie_scrape` 真实读取 cookie 或声称成功 | ✅ 不阻塞 | 直接返回 failed，不执行任何网络/cookie 操作 |
| `official_api` 无 adapter 时静默成功或没有错误文案 | ✅ 不阻塞 | 返回 failed + 中文可读错误 |
| 并发同 plan refresh 不返回 409 | ✅ 不阻塞 | `inFlight` Set 确保 409 |
| UI 仍显示 F03 已过时文案 | ✅ 不阻塞 | subtitle/empty 文案已更新 |

**阻塞状态: 无阻塞 (NOT BLOCKED)**

## 结论

F03 Token Plan 自动刷新调度器的所有失败路径、Cookie 风险提示、凭证安全、并发保护和 UI 文案均符合规范。未发现阻塞 bug，无需修改产品代码。
