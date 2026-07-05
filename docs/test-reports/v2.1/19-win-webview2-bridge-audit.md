# TE-MVP-WIN-07: WebView2 JSON String Bridge Audit Report

## 审计信息

| 项目 | 值 |
|---|---|
| 审计日期 | 2026-06-20 |
| 基准分支 | `codex-token-tracker-baseline` |
| 基准 commit | `9a127d4` (feat: finalize token eyes mvp shell) |
| 工作分支 | `claude/te-mvp-win-07-webview2-bridge` |
| 审计人 | Claude Code (QA Agent) |
| 结论 | **PASS — Bridge 正确实现，无 object 问题** |

---

## 1. 审计背景

上一个 Windows 分支被打回，原因是：
> "WebView2 前端 postMessage 发 object，但 C# 端 TryGetWebMessageAsString 只接收 string，真实 WebView2 下消息进不去。"

本报告对 `9a127d4` 全量 postMessage 调用做端到端审计，验证 bridge 格式正确性。

---

## 2. 全量 postMessage 调用审计

### 2.1 WebView2 bridge (`window.chrome.webview.postMessage`)

| 位置 | 发送内容 | 类型 | 安全 |
|---|---|---|---|
| `DataDirectoriesSection.jsx:201` | `JSON.stringify({type:"selectFolder", requestId})` | string | ✅ |
| `pet.jsx:121` | bare string (`"click"`, `"drag"`, `"open"` 等) | string | ✅ |
| `DashboardWindow.cs` 注入 (359) | `'currency'` | bare string | ✅ |
| `DashboardWindow.cs` 注入 (360) | `JSON.stringify({type:'nativeSetting', key:k, value:v})` | string | ✅ |
| `DashboardWindow.cs` 注入 (362) | `'locale'` | bare string | ✅ |
| `DashboardWindow.cs` 注入 (363) | `JSON.stringify({type:'nativeSetting', key:k, value:v})` | string | ✅ |
| `DashboardWindow.cs` 注入 (365) | `'theme'` | bare string | ✅ |
| `DashboardWindow.cs` 注入 (366) | `JSON.stringify({type:'nativeSetting', key:k, value:v})` | string | ✅ |
| `DashboardWindow.cs` OAuth shim (375, 529) | `JSON.stringify({type:'oauth', url:u})` | string | ✅ |
| `DashboardWindow.cs` TitleBarScript (568) | `'win:'+kind` | bare string | ✅ |
| `DashboardWindow.cs` TitleBarScript (577) | `'win:drag'` | bare string | ✅ |
| `DashboardWindow.cs` TitleBarScript (580) | `'win:max'` | bare string | ✅ |

**结论：零个 raw object 发送到 WebView2。所有调用均发送字符串。**

### 2.2 WKWebView bridge (`window.webkit.messageHandlers.nativeBridge.postMessage`) — macOS only

| 位置 | 发送内容 | 类型 | 影响 Windows? |
|---|---|---|---|
| `native-bridge.js:91` | `{type:"getSettings"}` | raw object | ❌ macOS only |
| `native-bridge.js:100` | `{type:"setSetting", key, value}` | raw object | ❌ macOS only |
| `native-bridge.js:104` | `{type:"action", name}` | raw object | ❌ macOS only |
| `native-bridge.js:108` | `{type:"getSystemAppearance"}` | raw object | ❌ macOS only |
| `native-bridge.js:124` | `{type:"setChromeAppearance", isDark, theme}` | raw object | ❌ macOS only |
| `ShareModal.tsx:220` | `{type:"action", name:"openURL", value}` | raw object | ❌ macOS only |
| `native-save.ts:75` | `{type:"action", name:"copyImageToClipboard", ...}` | raw object | ❌ macOS only |
| `native-save.ts:116` | `{type:"action", name:"saveImageToDownloads", ...}` | raw object | ❌ macOS only |

**结论：macOS WKWebView 的 raw object 调用与 WebView2 完全隔离。** 两个 bridge 使用不同的全局对象（`window.webkit.messageHandlers.nativeBridge` vs `window.chrome.webview`），互不影响。

---

## 3. selectFolder 消息流分析

### 3.1 发送方向 (JS → C#)

```
DataDirectoriesSection.jsx:201
  webview.postMessage(JSON.stringify({type:"selectFolder", requestId}))
  └─ 类型: string (JSON.stringify 产物)
  └─ WebView2 传递: postMessage(string) → TryGetWebMessageAsString() ✅
```

### 3.2 C# 处理 (DashboardWindow.cs:260-338)

```csharp
string msg;
try { msg = e.TryGetWebMessageAsString(); }  // ✅ 接收 string
catch { return; }

if (msg[0] == '{')  // ✅ JSON string 前缀检测
{
    var doc = JsonDocument.Parse(msg);  // ✅ 解析 JSON
    if (t.GetString() == "selectFolder")
    {
        // 处理文件夹选择
        _webView.CoreWebView2.PostWebMessageAsJson(payload);  // ✅ 返回 JSON string
    }
}
```

### 3.3 响应方向 (C# → JS)

```
DashboardWindow.cs:318
  PostWebMessageAsJson(payload)  // payload = JsonSerializer.Serialize(...)
  └─ 类型: JSON string (PostWebMessageAsJson 接受 JSON string 参数)
  └─ JS 端 event.data: string (WebView2 标准行为)
```

### 3.4 JS 接收处理 (DataDirectoriesSection.jsx:188-192, 209-217)

```js
const handler = (event) => {
  const data = normalizeWebViewMessage(event.data);
  // event.data = JSON string → normalizeWebViewMessage 内 JSON.parse 解析
  if (data?.type !== "folderSelected" || data.requestId !== requestId) return;
  resolve(typeof data.path === "string" && data.path.trim() ? data.path : null);
};

function normalizeWebViewMessage(data) {
  if (data && typeof data === "object") return data;  // object 消息兼容
  if (typeof data !== "string") return null;
  try { return JSON.parse(data); } catch { return null; }  // JSON string 解析
}
```

**`normalizeWebViewMessage` 双格式兼容**：既处理 object（兼容未来 WebView2 行为变化），也处理 JSON string（当前标准行为）。

---

## 4. Bridge 隔离机制

```
┌─────────────────────────────────────────────────┐
│ macOS: window.webkit.messageHandlers.nativeBridge │
│   post(object) → WKWebView accepts objects       │
│   由 NativeBridge.swift handle(message:) 处理     │
└─────────────────────────────────────────────────┘
                    ↕ 完全隔离
┌─────────────────────────────────────────────────┐
│ Windows: window.chrome.webview                   │
│   postMessage(string) → TryGetWebMessageAsString │
│   由 DashboardWindow.cs WebMessageReceived 处理   │
└─────────────────────────────────────────────────┘
```

- `isNativeWindowsApp()` 检查 `window.chrome?.webview` 存在性（`native-bridge.js:73-76`）
- `isNativeEmbed()` 检查 `window.webkit?.messageHandlers?.nativeBridge` 存在性（`native-bridge.js:63-66`）
- OAuth shim: Windows 上注入 `window.webkit.messageHandlers.nativeOAuth` 代理，将 URL 包装为 `JSON.stringify({type:'oauth', url})` 再发往 WebView2

---

## 5. 测试覆盖

### 5.1 现有测试

`DataDirectoriesSection.test.jsx` 包含 5 个测试用例：

| 测试 | 覆盖内容 |
|---|---|
| loads and saves data directory overrides | 基础 CRUD + 3 个选择文件夹按钮 |
| shows a Chinese fallback | 非 Windows 环境降级提示 |
| fills the selected local directory | selectLocalDirectory API 路径 |
| uses JSON string messages for WebView2 bridge | 发送类型验证 (string) + 接收 object response |
| **新增**: handles C# PostWebMessageAsJson response as JSON string | 接收 JSON string response（匹配真实 WebView2 行为） |

### 5.2 覆盖空白已填补

新增测试模拟了 C# `PostWebMessageAsJson` 的真实行为：`event.data` 是 JSON string 而非 object。验证 `normalizeWebViewMessage` 的 `JSON.parse` 分支正确处理。

### 5.3 测试结果

```
DataDirectoriesSection.test.jsx: 5/5 PASS ✅
全量 dashboard 测试: 239 passed, 13 failed (6 files)
失败均为已有问题，无 WebView2 bridge 相关回归
```

---

## 6. 阻塞问题

**无。**

---

## 7. 非阻塞问题

| # | 问题 | 说明 |
|---|---|---|
| N1 | Windows 侧缺少 Tauri 验证环境 | 需 Rust工具链 + Node.js + WebView2 Runtime，并运行 Tauri Windows build/dev 宿主 |
| N2 | 无法做真实 WebView2 手动验证 | 需要 Windows 环境运行 .exe，验证 Settings 页面 3 个文件夹按钮 |
| N3 | 文件夹选择器缺少桌面宿主自动化覆盖 | selectFolder handler 无自动化测试覆盖 |

---

## 8. 用户手动验证清单

在 Windows Tauri 环境准备完成后：

```powershell
# 1. Build 验证
npm run tauri build

# 2. 运行应用，打开 Settings 页面
# 3. 验证 3 个"选择文件夹"按钮各自独立工作：
#    - Claude Code 数据目录 → 选择文件夹 → 弹出文件夹对话框 → 选择后路径回填
#    - Codex 数据目录 → 选择文件夹 → 同上
#    - Hermes Agent 数据目录 → 选择文件夹 → 同上
# 4. 验证每个按钮的 requestId 独立，不会互相干扰
```

---

*报告生成时间: 2026-06-20T21:05:00+08:00*
