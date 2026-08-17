# DeepSeek Harness 与桌面小组件联动修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user has explicitly prohibited commits, pushes, merges, and packaging before review, so every normal commit checkpoint is replaced by a diff review checkpoint.

**目标：** 真实接入 DeepSeek Harness，并修复限制显示、使用明细、桌面小组件之间的 Agent、项目、套餐与原生窗口几何联动。

**架构：** 在现有 Agent 适配器注册表中增加 `deepseek-harness`，使用独立增量解析器读取 `~/.dsh/sessions` 的 JSONL/Zstandard 会话并写入既有队列。前端沿用“限制显示”偏好作为显隐正典；Rust 将折叠高度设为固定不变量，并把特效临时几何与基础几何持久化彻底隔离。

**技术栈：** Node.js CommonJS、`@mongodb-js/zstd`、React/Vitest、Tauri 2/Rust、Node `node:test`。

---

### 任务 1：锁定 DeepSeek Harness 会话解析契约

**文件：**
- 新建：`test/deepseek-harness-parser.test.js`
- 修改：`src/lib/rollout.js`
- 修改：`src/lib/agent-adapters.js`
- 修改：`src/commands/sync.js`

- [ ] **步骤 1：编写失败测试**

测试构造一个压缩会话，包含 `session`、`request/context`、`assistant/chunk` usage 和 `assistant/message` usage，断言最终消息替换同一步骤的流式样本：

```js
assert.deepEqual(result.totals, {
  input_tokens: 120,
  cached_input_tokens: 30,
  output_tokens: 40,
  reasoning_output_tokens: 10,
});
assert.equal(queueRows[0].source, "deepseek-harness");
assert.equal(queueRows[0].model, "deepseek-v4-flash");
```

- [ ] **步骤 2：确认测试按预期失败**

运行：`node --test test/deepseek-harness-parser.test.js`

预期：因为解析器和 resolver 尚不存在而失败。

- [ ] **步骤 3：实现最小解析器**

在 `src/lib/rollout.js` 增加并导出：

```js
resolveDeepSeekHarnessHome(env, home)
listDeepSeekHarnessSessionFiles(dshHome)
parseDeepSeekHarnessIncremental({ sessionFiles, cursors, queuePath, onProgress })
```

解析规则：以 `(sessionId, turn, step)` 为采样键；`assistant/chunk.data.chunk.type === "usage"` 写入候选样本，`assistant/message.data.usage` 覆盖同键；按请求上下文记录最近模型；只累计相对游标增长量。

- [ ] **步骤 4：接入注册表与同步流程**

注册项必须是：

```js
{
  id: "deepseek-harness",
  displayName: "DeepSeek Harness",
  queueSource: "deepseek-harness",
  family: "deepseek",
  collectionMode: "passive_log",
  parserExport: "parseDeepSeekHarnessIncremental",
  resolverExports: ["resolveDeepSeekHarnessHome", "listDeepSeekHarnessSessionFiles"],
  statusSurface: true,
  diagnosticsSurface: true,
  usageLimitsSurface: true,
  pathOverrideKey: null,
  accountLevel: false,
}
```

`cmdSync` 在其他本地日志解析器之后调用新解析器，并把结果纳入 `totalParsed` 与 `totalBuckets`。

- [ ] **步骤 5：运行解析器与注册表测试**

运行：`node --test test/deepseek-harness-parser.test.js test/agent-adapters.test.js`

预期：全部通过，重复执行解析器时新增桶为 0。

- [ ] **步骤 6：检查未提交差异**

运行：`git diff --check && git diff -- src/lib/rollout.js src/lib/agent-adapters.js src/commands/sync.js test/deepseek-harness-parser.test.js`

预期：无空白错误，只包含本任务相关改动；不提交。

### 任务 2：统一限制显示、使用明细和小组件 Agent

**文件：**
- 修改：`dashboard/src/lib/limits-providers.js`
- 修改：`dashboard/src/lib/agent-adapters-dashboard.ts`
- 修改：`dashboard/src/ui/dashboard/components/ProviderIcon.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`src/lib/widget-view-model.js`
- 修改：`dashboard/src/pages/DesktopWidgetPage.tsx`
- 测试：`dashboard/src/components/LimitsSettingsPanel.test.jsx`
- 测试：`dashboard/src/hooks/use-limits-display-prefs.test.js`
- 测试：`dashboard/src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx`
- 测试：`dashboard/src/pages/DesktopWidgetPage.test.tsx`
- 测试：`test/widget-view-model.test.js`

- [ ] **步骤 1：编写跨界面失败测试**

断言：

```js
expect(LIMIT_PROVIDER_IDS).toContain("deepseek-harness");
expect(screen.getByText("DeepSeek Harness")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /DeepSeek Harness/ })).toBeVisible();
assert.ok(WIDGET_AGENTS.includes("deepseek-harness"));
```

同时构造仅关闭 `cursor` 的限制显示快照，断言小组件菜单不显示 Cursor；当前选择 Cursor 时偏好回退为 `all`。

- [ ] **步骤 2：确认测试按预期失败**

运行：

```powershell
node --test test/widget-view-model.test.js
cd dashboard
npx vitest run src/components/LimitsSettingsPanel.test.jsx src/hooks/use-limits-display-prefs.test.js src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx src/pages/DesktopWidgetPage.test.tsx
```

预期：缺少新 id、显示名称或小组件显隐联动而失败。

- [ ] **步骤 3：实现统一注册与显示**

增加 `deepseek-harness` 的 Dashboard 注册、限制显示名称/图标/copy、API 联合类型和小组件标签。`DesktopWidgetPage` 从限制显示偏好计算菜单，而不是使用硬编码五项回退。

- [ ] **步骤 4：实现陈旧选择回退**

当 `prefs.selectedAgent` 不在当前可见 Agent 列表中时调用既有偏好更新接口保存 `all`，界面立即使用“全部”，不渲染不可见 Agent。

- [ ] **步骤 5：运行跨界面测试**

运行步骤 2 的命令。

预期：全部通过。

- [ ] **步骤 6：检查未提交差异**

运行：`git diff --check`，并核对本任务文件没有覆盖上一轮卡片按压效果修改；不提交。

### 任务 3：保留已选文件夹和全部套餐窗口

**文件：**
- 修改：`src/lib/widget-view-model.js`
- 修改：`dashboard/src/pages/DesktopWidgetPage.tsx`
- 修改：`dashboard/src/pages/WidgetsPage.jsx`
- 测试：`test/widget-view-model.test.js`
- 测试：`dashboard/src/pages/DesktopWidgetPage.test.tsx`
- 测试：`dashboard/src/pages/WidgetsPage.test.jsx`

- [ ] **步骤 1：编写文件夹失败测试**

提供已保存项目但不给活跃会话，断言项目仍出现：

```js
expect(screen.getByText("010-Token eye")).toBeInTheDocument();
expect(screen.getByText("暂无活跃会话")).toBeInTheDocument();
```

再以同 id 提供 `{ path: "" }` 新快照，断言已有非空路径仍被保存。

- [ ] **步骤 2：编写套餐窗口失败测试**

构造一个套餐包含 5h 和 7d 两个窗口：

```js
assert.deepEqual(limits.map((item) => item.windowLabel), ["5h", "7d"]);
assert.equal(new Set(limits.map((item) => item.id)).size, 2);
```

- [ ] **步骤 3：确认失败**

运行：

```powershell
node --test test/widget-view-model.test.js
cd dashboard
npx vitest run src/pages/DesktopWidgetPage.test.tsx src/pages/WidgetsPage.test.jsx
```

预期：无会话项目被过滤、套餐仅保留一个代表窗口或空路径覆盖保护缺失。

- [ ] **步骤 4：实现最小修复**

删除 `filteredProjectStatus` 对零会话项目的二次过滤；为空项目提供明确空态。`WidgetsPage` 合并快照时按“非空路径优先、明确标签优先”处理。`flattenTokenPlanRecords` 对每个有效 quota window 生成稳定记录，使用 `planId:windowId` 作为 id，并保留套餐顺序和窗口顺序。

- [ ] **步骤 5：运行相关测试并核对既有脏改动**

运行步骤 3 的命令和 `git diff -- dashboard/src/pages/WidgetsPage.jsx dashboard/src/pages/WidgetsPage.test.jsx`。

预期：测试通过，上一轮新增的 `tt-pressable-group` 不被删除；不提交。

### 任务 4：固定折叠几何并隔离临时窗口状态

**文件：**
- 修改：`src-tauri/src/widget_window.rs`
- 修改：`test/windows-widget-contract.test.js`

- [ ] **步骤 1：编写版本 7 污染配置失败测试**

新增 Rust 测试：

```rust
let prefs = normalize_prefs(WidgetPrefs {
    version: 7,
    height: 260,
    collapsed_height: 260,
    expanded: false,
    ..WidgetPrefs::default()
});
assert_eq!(prefs.height, 72);
assert_eq!(prefs.collapsed_height, 72);
```

并修正旧测试对当前 `PREFS_VERSION` 的陈旧期望，不降低断言。

- [ ] **步骤 2：确认 Rust 测试失败**

运行：`cargo test --manifest-path src-tauri/Cargo.toml widget_window::tests`

预期：污染配置仍返回 260，同时旧版本断言显示现有基线失败。

- [ ] **步骤 3：实现固定折叠高度**

`normalize_prefs` 在 `expanded == false` 时把 `height` 与 `collapsed_height` 设为 `DEFAULT_HEIGHT`；`transition_height(..., false)` 始终返回 `DEFAULT_HEIGHT`；`persist_geometry` 不再写入 `collapsed_height`。窗口创建与折叠后设置 `resizable(false)`，展开时恢复可调整。

- [ ] **步骤 4：禁止临时几何写回**

把菜单和特效状态判断集中到一个 `transient_open()` 辅助函数；任何临时状态存在时 `persist_geometry` 直接返回。偏好保存前不得先捕获临时窗口尺寸。

- [ ] **步骤 5：运行 Rust 与静态契约测试**

运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml widget_window::tests
node --test test/windows-widget-contract.test.js
```

预期：全部通过。

- [ ] **步骤 6：检查未提交差异**

运行：`git diff --check && git diff -- src-tauri/src/widget_window.rs test/windows-widget-contract.test.js`；不提交。

### 任务 5：让特效关闭按钮贴近主体并消除关闭跳位

**文件：**
- 修改：`dashboard/src/pages/DesktopWidgetPage.tsx`
- 修改：`dashboard/src/pages/desktop-widget.css`
- 修改：`dashboard/src/lib/native.ts`
- 修改：`src-tauri/src/widget_window.rs`
- 测试：`dashboard/src/pages/DesktopWidgetPage.test.tsx`
- 测试：`test/windows-widget-contract.test.js`

- [ ] **步骤 1：编写失败契约**

断言关闭按钮使用主体偏移变量：

```js
assert.match(css, /right:\s*var\(--widget-effect-halo\)/u);
assert.match(css, /top:\s*var\(--widget-effect-halo\)/u);
```

前端测试断言点击关闭时先等待 `setDesktopWidgetCelebration(false)` 完成，再移除特效节点。

- [ ] **步骤 2：确认失败**

运行：

```powershell
node --test test/windows-widget-contract.test.js
cd dashboard
npx vitest run src/pages/DesktopWidgetPage.test.tsx
```

预期：当前按钮仍相对透明窗口定位，前端立即移除节点。

- [ ] **步骤 3：实现关闭握手**

把关闭处理改为异步：先调用 NativeBridge 恢复基础几何，成功后再清除 `activeCelebrationId`。重复点击在恢复过程中禁用。Rust 命令返回前完成目标尺寸和目标位置设置，且不调用基础几何持久化。

- [ ] **步骤 4：调整按钮坐标**

按钮使用 `--widget-effect-halo` 加主体内边距定位到卡片右上角附近；浏览器预览与原生窗口共用同一规则。

- [ ] **步骤 5：运行测试**

运行步骤 2 的命令。

预期：全部通过。

### 任务 6：完成两轮验证但暂不打包

**文件：**
- 验证：全部本轮相关文件
- 产物：`dashboard/.artifacts/` 下的隔离截图与几何日志，不提交

- [ ] **步骤 1：运行聚焦测试**

```powershell
node --test test/deepseek-harness-parser.test.js test/widget-view-model.test.js test/windows-widget-contract.test.js test/agent-adapters.test.js
cd dashboard
npx vitest run src/pages/DesktopWidgetPage.test.tsx src/pages/WidgetsPage.test.jsx src/components/LimitsSettingsPanel.test.jsx src/hooks/use-limits-display-prefs.test.js src/ui/dashboard/components/__tests__/UsageFilterBar.test.jsx
```

- [ ] **步骤 2：运行类型、构建与 Rust 测试**

```powershell
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
cargo test --manifest-path src-tauri/Cargo.toml widget_window::tests
git diff --check
```

- [ ] **步骤 3：第一轮需求匹配核验**

逐条核对：DeepSeek Harness 三界面联动、已选空项目、全部套餐窗口、72 像素折叠态、按钮位置和关闭握手。记录每条对应代码与测试证据。

- [ ] **步骤 4：第二轮真实原生效果核验**

使用隔离偏好副本，不覆盖用户现有偏好；在 175% 缩放下验证冷启动、折叠、项目、套餐、Agent 切换和特效关闭。记录关闭前后主体 `x/y/width/height`，要求完全一致，并保存截图。

- [ ] **步骤 5：复核边界**

运行：`git status --short` 与 `git diff --stat`。

预期：不包含提交、推送、合并或安装包；等待用户查看开发效果后再决定是否打包。
