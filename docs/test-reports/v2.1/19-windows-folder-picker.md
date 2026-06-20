# 19 — Windows Folder Picker Verification

## 验证信息

| 项目 | 值 |
|---|---|
| 验证日期 | 2026-06-20 |
| 分支 | `claude/te-mvp-win-07-folder-picker-verification` |
| 基准 commit | `3a38cff` (pre-implementation) |
| 操作系统 | Ubuntu 26.04 LTS (WSL2) |
| dotnet 版本 | **未安装** (Windows 侧和 WSL 均无 .NET 8 SDK) |

## 验证结论

**代码审查发现：文件夹选择器功能完全未实现。** 三层代码（React 组件、C# 端、local-api fallback）均不存在。本次验证实现了全部三层代码并完成了可执行的前端验证。

**环境阻塞：** 无 .NET 8 SDK，C# 端无法编译，WebView2 手动验证无法执行。

## 代码审查发现

| 检查项 | 实现前状态 | 实现后状态 |
|---|---|---|
| `DataDirectoriesSection.jsx` 有"选择文件夹"按钮 | ❌ 不存在 | ✅ 已实现 |
| `DataDirectoriesSection.jsx` 有 WebView2 桥接逻辑 | ❌ 不存在 | ✅ 已实现 |
| `DataDirectoriesSection.jsx` 有浏览器 fallback 逻辑 | ❌ 不存在 | ✅ 已实现 |
| `DashboardWindow.cs` 有 `selectFolder` 处理 | ❌ 不存在 | ✅ 已实现 |
| `DashboardWindow.cs` 有 `FolderBrowserDialog` | ❌ 不存在 | ✅ 已实现 |
| `src/lib/local-api.js` 有 `/tokentracker-select-directory` 端点 | ❌ 不存在 | ✅ 已实现 |
| `dashboard/src/lib/api.ts` 有 `selectLocalDirectory()` | ❌ 不存在 | ✅ 已实现 |

## 前端验证结果

### Dashboard Build

```
✅ TypeScript type check: 0 errors
✅ Vite build: success (5.42s)
```

### 单元测试 (Vitest)

```
✅ 6 tests passed (199ms)

1. loads and saves data directory overrides
2. shows browse buttons for each directory input
3. fills path via browser fallback when browse button is clicked
4. shows unsupported hint when platform does not support folder picker
5. preserves existing values when folder picker is cancelled
6. uses WebView2 bridge when running in native Windows app
```

### Node.js 测试

```
✅ local-settings-api.test.js: 1 test passed
```

## .NET 编译验证

**状态：❌ 环境阻塞**

机器缺少 .NET 8 SDK，以下验证无法执行：
- `dotnet build TokenTrackerWin/TokenTrackerWin.csproj`
- WebView2 手动验证（启动 Windows app → /settings → 点击按钮）
- 普通浏览器 fallback 端到端验证（需要 Windows PowerShell）

## 三个按钮手动验证

| 按钮 | 结果 | 备注 |
|---|---|---|
| Claude Code 数据目录 → 选择文件夹 | ⏳ 待 Windows 环境验证 | 代码已实现，需 .NET 编译后测试 |
| Codex 数据目录 → 选择文件夹 | ⏳ 待 Windows 环境验证 | 同上 |
| Hermes Agent 数据目录 → 选择文件夹 | ⏳ 待 Windows 环境验证 | 同上 |

## 取消选择验证

**单元测试已验证：** 取消时 `selectLocalDirectory` 返回 `{ cancelled: true }`，输入框值不被清空。WebView2 端取消时 `cancelled: true` 同样不修改输入值。

## 普通浏览器 Fallback 验证

**单元测试已验证：** 非 Windows 平台返回 `{ unsupported: true, message: "当前环境不支持直接选择本机目录，请手动输入路径。" }`，UI 显示 amber 色提示文字。

**端到端验证：** ⏳ 待 Windows 环境（需要 `node bin/tracker.js serve --no-sync --no-open` + 浏览器访问 `/settings`）。

## 代码修改清单

### 1. `src/lib/local-api.js`

**原因：** 添加 `/functions/tokentracker-select-directory` POST 端点，作为浏览器 fallback。

**改动：**
- 添加 `selectDirectoryWindows()` 函数：通过 PowerShell `FolderBrowserDialog` 打开系统文件夹选择器
- 添加端点路由：Windows 平台调用 PowerShell 选择器，非 Windows 平台返回 `unsupported` + 中文提示

### 2. `dashboard/src/lib/api.ts`

**原因：** 添加 `selectLocalDirectory()` API 函数。

**改动：**
- PATHS 对象添加 `selectDirectory: "tokentracker-select-directory"`
- 新增 `selectLocalDirectory()` 函数，POST 到新端点

### 3. `dashboard/src/components/settings/DataDirectoriesSection.jsx`

**原因：** 添加文件夹选择 UI 和双路径逻辑。

**改动：**
- 添加"选择文件夹"按钮（每个目录输入框旁）
- WebView2 路径：`isNativeWindowsApp()` → `window.chrome.webview.postMessage({ type: "selectFolder", requestId })` + 监听 `folderSelected` 响应
- 浏览器 fallback：调用 `selectLocalDirectory()` API
- 取消/不支持时显示相应提示
- 按钮文案：`选择文件夹`（内联中文，copy.csv 不在允许修改范围内）

### 4. `TokenTrackerWin/DashboardWindow.cs`

**原因：** 添加 WebView2 端的 `selectFolder` 消息处理。

**改动：**
- `WebMessageReceived` JSON 消息分支添加 `selectFolder` 类型处理
- 新增 `HandleSelectFolder()` 方法：`FolderBrowserDialog` 弹出选择器，回传 `folderSelected` 消息（含 requestId、path、cancelled）

### 5. `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`

**原因：** 添加文件夹选择器功能测试。

**改动：**
- 新增 5 个测试：browse 按钮存在、浏览器 fallback 路径、unsupported 提示、取消保留值、WebView2 桥接
- Mock `selectLocalDirectory` 和 `isNativeWindowsApp`

## 阻塞问题

1. **无 .NET 8 SDK** — 无法编译 `TokenTrackerWin.csproj`，无法验证 C# 代码是否编译通过
2. **无 Windows 环境** — 无法运行 WebView2 手动验证和 PowerShell fallback 端到端验证

## 非阻塞问题

1. **copy.csv 未更新** — 按钮文案和提示文字使用内联中文，未添加到 `copy.csv`（不允许修改）。后续应将文案添加到 copy.csv 和 i18n 翻译文件以支持多语言。
2. **C# 代码未编译验证** — `HandleSelectFolder` 方法逻辑基于 WebView2 API 文档实现，需实际编译验证
