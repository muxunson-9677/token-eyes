# TE-NEXT-W03-R3D 验收报告 — 双检测方式统一同步状态

## 基本信息

| 项目 | 内容 |
|---|---|
| 工单 | TE-NEXT-W03-R3D |
| 验收日期 | 2026-06-26 |
| 返工轮次 | 第 3 轮（第 1 轮 2026-06-25 打回，第 2 轮 2026-06-26 打回） |
| 状态 | ✅ 验收通过 |

## 第 1 轮打回原因与修复

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | P1 | `resolveApiKey` 未传入 scheduler/refreshPlan，custom_api 检测永远拿不到真实 API key | `createScheduler` 新增 `resolveApiKey` 参数；`local-api.js` 注入 `resolveTokenPlanApiKey` 函数 |
| 2 | P2 | reauth 测试伪覆盖 — 用空 URL 触发 `CUSTOM_API_NOT_CONFIGURED` 而非真正的 HTTP 401/403 | 重写为真实 HTTP server mock，验证 401 → `reauth_required` + 额度保留 + API Key 不泄露 |
| 3 | P2 | 工单状态仍为"待派发" | 更新为"已完成" |

## 第 2 轮打回原因与修复

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | P1 | 前端 `save()` 仅在 `!apiKeyRef` 时才调用 `saveTokenPlanSecret`。编辑已有 custom_api 记录时旧 ref 保留，即使重输 key 也被跳过，导致内存 store 重启后无法恢复密钥 | 移除 `!apiKeyRef` 条件：只要 `apiKeyInput.trim()` 有值就调用 `saveTokenPlanSecret` 并用新 ref 覆盖旧 ref；输入为空时才复用旧 ref |
| 2 | P2 | 验收报告仍写 `resolveTokenPlanApiKey` 从 `config.json` 的 `tokenPlanSecrets` 读取，与实际内存 store 实现不符 | 修正描述为"从内存 `tokenPlanSecretStore` Map 读取" |
| 3 | P2 | 工单 checklist 全部未勾选 | 逐条勾选并更新工单状态 |

## 验收标准对照

### 1. 两种检测方式共用统一状态模型和展示 ✅

`refreshPlan` 对 `official_account` 和 `custom_api` 使用同一组 `sync_status` / `last_error_code` / `last_error_message` 字段，前端 `TokenPlanSection.jsx` 统一展示。

### 2. 官网账号检测入口只在新增/编辑小米套餐表单内部出现 ✅

- R3B 已实现（`xiaomi_mimo` + catalog plan 时显示 connect 按钮）
- 自定义套餐（`provider_id: "custom"`）不显示此入口

### 3. 自定义 API 检测成功后可更新额度 ✅

- `refreshPlan` → `detectCustomApi` 成功时写 `total_quota`, `used_quota`, `remaining_quota`, `expires_at`
- `resolveApiKey` 通过 scheduler 链路注入（P1 修复）
- `local-api.js` 提供 `resolveTokenPlanApiKey` 从**内存 `tokenPlanSecretStore` Map** 读取（W03-R3D P0 fix：密钥仅存内存，永不落盘 config.json；进程重启后用户需重输 key）

### 4. 检测失败/reauth/unsupported 不清空上次成功额度 ✅

- `failed` 不覆盖旧额度（R3D 测试: `failed does NOT clear old quota`）
- `reauth_required` 不覆盖旧额度（真实 HTTP 401 mock 测试: `reauth_required (custom_api 401) does NOT clear old quota`）
- `unsupported` 不覆盖旧额度（R3D 测试: `unsupported does NOT display as success`）
- `local-api.js` normalizeTokenPlanRecord 中当检测方式已配置时保护 fallback 额度值

### 5. 没有检测配置时明确提示选择检测方式 ✅

- R3B 实现（`not_configured` 状态 + 提示文案）
- 前端 `TokenPlanSection.jsx` 显示"请选择检测方式"提示

### 6. 不允许手动录入额度作为主路径 ✅

- 当 `detection_method` 已配置（非 `not_configured`），`used_quota`、`remaining_quota`、`expires_at` 输入框禁用
- 显示 hint "额度由检测方式自动获取"
- 后端 `normalizeTokenPlanRecord` 保护 fallback 值不被零值覆盖

### 7. 所有验证命令通过 ✅

见下方验证结果。

## 验证结果

### 后端测试

```
node --test test/token-plan-custom-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js test/token-plan-console-sessions.test.js
```

```
ℹ tests 83
ℹ pass 83
ℹ fail 0
```

### 前端测试

```
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

```
✓ 35 tests passed
```

### typecheck

```
npm --prefix dashboard run typecheck
→ 通过（无错误）
```

### copy 注册表

```
npm run validate:copy
→ Copy registry ok: 1221 entries, 961 keys used.
```

### UI 硬编码

```
npm run validate:ui-hardcode
→ UI hardcode guardrails ok: colors=293, rawText=162
```

### 架构护栏

```
npm run validate:guardrails
→ Guardrails ok: no violations found.
```

### Dashboard build

```
npm run dashboard:build
→ ✓ built in 5.24s
```

### Tauri build

```
npx tauri build --no-bundle
→ ✓ Built application at src-tauri\target\release\token-eyes.exe
  (1 pre-existing warning: map_login_state_to_status unused)
```

## 修改文件清单

| 文件 | 变更 |
|---|---|
| `src/lib/token-plan-refresh.js` | `createScheduler` 接受 `resolveApiKey`，传给 `runDueOnce`/`refreshById` → `refreshPlan` |
| `src/lib/local-api.js` | 新增 `resolveTokenPlanApiKey`；注入 `resolveApiKey` 到 scheduler；secrets 端点存内存 Map |
| `dashboard/src/components/settings/TokenPlanSection.jsx` | W03-R3D P1 fix：`save()` 移除 `!apiKeyRef` 条件，重输 key 时始终调用 `saveTokenPlanSecret` 并替换 ref |
| `dashboard/src/components/settings/TokenPlanSection.test.jsx` | 新增 2 个 P1 回归测试：重输 key 替换 ref / 空 key 保留旧 ref |
| `test/token-plan-refresh.test.js` | 导入 `http`；重写 reauth 测试为真实 HTTP 401 mock |
| `docs/tasks/dispatch/TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md` | checklist 全部勾选；状态更新为"已完成" |
| `docs/test-reports/token-plan/2026-06-25-w03-r3-sync-acceptance.md` | 完整重写（含第 3 轮返工记录与验证结果） |

## 结论

✅ TE-NEXT-W03-R3D 全部 7 条验收标准通过，83 后端测试 + 35 前端测试全部 green，tauri build 成功。
