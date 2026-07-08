# TICKET-05 测试报告：本地数据链路、筛选状态与统一刷新修复

## 概述

本报告验证 TICKET-05 的所有验收标准是否通过。

## 修改文件列表

### Task 1：建立唯一的本地 Dashboard 运行时判断
- `dashboard/src/lib/local-api-url.ts` — 新增 `isLocalDashboardRuntime()` 函数
- `dashboard/src/lib/local-api-url.test.ts` — 新增测试文件（2个测试用例）

### Task 2：让全部新增 usage hooks 支持本地未登录模式
- `dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx` — 新增测试文件（6个测试用例）
- `dashboard/src/hooks/use-usage-summary.ts` — 接入本地判断
- `dashboard/src/hooks/use-usage-trend.ts` — 接入本地判断
- `dashboard/src/hooks/use-usage-filter-options.ts` — 接入本地判断
- `dashboard/src/hooks/use-request-usage-records.ts` — 接入本地判断
- `dashboard/src/hooks/use-provider-stats.ts` — 接入本地判断
- `dashboard/src/hooks/use-model-stats.ts` — 接入本地判断

### Task 3：修复来源和模型筛选 reducer
- `dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx` — 更新测试用例
- `dashboard/src/hooks/use-usage-filters.tsx` — 简化 reducer，删除反向级联
- `dashboard/src/ui/dashboard/components/SourceFilter.jsx` — 直接应用选择
- `dashboard/src/ui/dashboard/components/ModelFilter.jsx` — 直接应用选择
- `dashboard/src/ui/dashboard/components/__tests__/SourceFilter.test.jsx` — 更新测试
- `dashboard/src/ui/dashboard/components/__tests__/ModelFilter.test.jsx` — 更新测试

### Task 4：用单一 refresh revision 刷新全部支出数据
- `dashboard/src/hooks/use-usage-filters.tsx` — 新增 `refreshRevision` 和 `requestRefresh`
- `dashboard/src/hooks/__tests__/use-usage-filters.cascade.test.tsx` — 新增 refresh revision 测试
- `dashboard/src/hooks/use-usage-summary.ts` — 监听 refresh revision
- `dashboard/src/hooks/use-usage-trend.ts` — 监听 refresh revision
- `dashboard/src/hooks/use-usage-filter-options.ts` — 监听 refresh revision
- `dashboard/src/hooks/use-request-usage-records.ts` — 监听 refresh revision
- `dashboard/src/hooks/use-provider-stats.ts` — 监听 refresh revision
- `dashboard/src/hooks/use-model-stats.ts` — 监听 refresh revision
- `dashboard/src/hooks/__tests__/local-usage-hooks.test.tsx` — 更新测试
- `dashboard/src/pages/SpendPage.jsx` — 统一定时器调用 `requestRefresh`
- `dashboard/src/pages/SpendPage.test.jsx` — 更新测试

### Task 5：让请求日志内部来源筛选同时约束 records 和 totals
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx` — 动态调整 `visibleProviderIds`
- `dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx` — 更新测试
- `dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx` — 更新测试

### Task 6：给本地 API 增加协议握手并拒绝旧服务
- `test/local-api-handshake.test.js` — 新增测试文件（1个测试用例）
- `src/lib/local-api.js` — 新增 `LOCAL_API_PROTOCOL_VERSION=2` 和 `LOCAL_API_CAPABILITIES`，扩展 local-auth 响应
- `src-tauri/src/commands.rs` — 解析 HTTP body，校验协议版本和 capability，新增 5 个测试用例

## 测试结果

### 前端测试

```powershell
npm --prefix dashboard run test -- src/lib/local-api-url.test.ts src/hooks/__tests__/local-usage-hooks.test.tsx src/hooks/__tests__/use-usage-filters.cascade.test.tsx src/hooks/__tests__/use-request-usage-records.test.tsx src/ui/dashboard/components/__tests__/SourceFilter.test.jsx src/ui/dashboard/components/__tests__/ModelFilter.test.jsx src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/RefreshIntervalPicker.test.jsx src/pages/SpendPage.test.jsx
```

结果：全部通过，无 React duplicate key、`act()`、未处理 Promise warning。

### Node API 测试

```powershell
node --test test/local-api-handshake.test.js
```

结果：1/1 通过。

### Rust 测试

```powershell
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

结果：5/5 通过（包括 4 个协议拒绝测试和 1 个协议接受测试）。

### TypeScript 检查

```powershell
npm --prefix dashboard run typecheck
```

结果：exit 0。

### Dashboard 构建

```powershell
npm run dashboard:build
```

结果：成功，仅包含构建器既有 chunk-size warning。

## 验收标准验证

### 标准 1：本地未登录模式加载
- ✅ `isLocalDashboardRuntime()` 正确识别 localhost 和 Tauri 环境
- ✅ 六个 usage hooks 在本地无 token 时能完成加载并终止 loading

### 标准 2：筛选按钮显示选择数量
- ✅ SourceFilter 选择具体项后显示选择数量
- ✅ ModelFilter 选择具体项后显示选择数量
- ✅ 所有统计请求带上对应参数

### 标准 3：向下级联逻辑
- ✅ Agent 变化清空来源和模型
- ✅ 来源变化清空模型
- ✅ 目标选择本身不会被清空

### 标准 4：统一刷新覆盖全部数据
- ✅ `refreshRevision` 机制覆盖七类数据：summary、trend、filter options、request records、Provider stats、model stats、Spend records
- ✅ 手动刷新触发 `requestRefresh()`
- ✅ 自动刷新定时器调用 `requestRefresh()`

### 标准 5：请求日志来源筛选一致性
- ✅ `queriedProviderIds` 动态调整 `visibleProviderIds`
- ✅ 来源筛选同时约束 records 和 totals

### 标准 6：旧协议拒绝
- ✅ Node API 响应包含 `protocol_version: 2` 和 `capabilities`
- ✅ Rust probe 校验协议版本 >= 2
- ✅ Rust probe 校验必需 capabilities（`spend_usage_v2`、`provider_model_stats`、`request_usage_records`）
- ✅ 旧协议服务即使含 token 也被拒绝

### 标准 7：loading 终止
- ✅ 所有 loading 分支最终进入 loaded、empty 或 error
- ✅ 禁止永久 spinner

## 已知非本工单问题

- Dashboard 部分测试文件存在预先存在的失败（16 个测试失败），与 TICKET-05 修改无关
- 构建器 chunk-size warning 为既有问题，不影响功能

## 协议版本和能力集

- **协议版本**: 2
- **必需能力**: `spend_usage_v2`、`provider_model_stats`、`request_usage_records`
