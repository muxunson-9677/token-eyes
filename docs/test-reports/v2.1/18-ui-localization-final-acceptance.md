# 18 — Token Eyes UI 中文化收尾验收

## 验收信息

| 项目 | 值 |
|---|---|
| 验收日期 | 2026-06-20 |
| 分支 | `claude/te-mvp-qa-06-ui-localization-acceptance` |
| 基准 commit | `9a127d4` (feat: finalize token eyes mvp shell) |
| 操作系统 | Ubuntu 26.04 LTS (WSL2) |
| Node | v22+ (WSL) |

## 验收结论

**⚠️ 有条件通过。** 自动验证全部通过，但发现 1 个非阻塞 forbidden 文案问题（Sidebar 移动端标题栏硬编码 "Token Tracker"）。

## 一、自动验证结果

### Vitest（10 个文件，42 个测试）

```
✅ src/lib/locale.test.ts              — 5 tests
✅ src/lib/currency.test.ts            — 20 tests
✅ src/lib/cache-hit.test.ts           — 2 tests
✅ src/pages/SpendPage.test.jsx        — 1 test
✅ src/pages/WidgetsPage.test.jsx      — 2 tests
✅ src/components/settings/AgentPricingSection.test.jsx  — 1 test
✅ src/components/settings/DataDirectoriesSection.test.jsx — 4 tests
✅ src/components/settings/TokenPlanSection.test.jsx    — 1 test
✅ src/ui/foundation/__tests__/LocaleProvider.test.jsx  — 1 test
✅ src/ui/dashboard/components/UsageLimitsPanel.test.jsx — 5 tests
```

### Node 测试

```
✅ test/app-route-pathname-guard.test.js — 5 tests
✅ test/settings-account-user-id.test.js — 1 test
```

### TypeScript

```
✅ tsc --noEmit — 0 errors
```

### Dashboard Build

```
✅ vite build — 5.68s
⚠️ main bundle 921KB (chunk size warning，非阻塞)
```

## 二、页面 Title 验证

```
curl http://127.0.0.1:17699/spend    → <title>Token Eyes</title> ✅
curl http://127.0.0.1:17699/settings → <title>Token Eyes</title> ✅
```

**来源：** `dashboard/vite.config.*` 在构建时从 `copy.csv` 的 `landing.meta.title`（"Token Eyes"）注入 `__TOKENTRACKER_TITLE__` 到 `index.html`。

## 三、`tokentracker-locale=en` 验证

**代码级验证：** `dashboard/src/lib/locale.ts` 强制归一化所有语言到 `zh-CN`：

```typescript
export const EN_LOCALE = ZH_CN_LOCALE;           // "en" → "zh-CN"
export const ZH_TW_LOCALE = ZH_CN_LOCALE;         // "zh-TW" → "zh-CN"
export const JA_LOCALE = ZH_CN_LOCALE;            // "ja" → "zh-CN"
export const KO_LOCALE = ZH_CN_LOCALE;            // "ko" → "zh-CN"

function classifyLanguageTag(tag: string): string | null {
  return tag.trim() ? ZH_CN_LOCALE : null;        // 任何非空字符串 → zh-CN
}
```

- `localStorage.setItem("tokentracker-locale", "en")` → `normalizeLocalePreference("en")` → `zh-CN`
- `resolvePreferredLocale("en")` → `normalizeLocalePreference("en")` !== `"system"` → `ZH_CN_LOCALE`
- 旧 `ja/ko/zh-TW` i18n 文件已删除，不存在回退路径

**测试验证：** `locale.test.ts` 5 个测试全部通过，覆盖了 en/zh-TW/ja/ko/空值/系统偏好场景。

**结论：** ✅ 无论 localStorage 存什么值，页面始终显示中文。

## 四、`/spend` 页面验证

### copy.csv 中文条目

| Key | 值 | 状态 |
|---|---|---|
| `spend.page.title` | `支出` | ✅ |
| `spend.page.subtitle` | `MVP 手动支出记录，暂不做月付/年付周期换算。` | ✅ |
| `spend.total_usd` | `USD 合计` | ✅ |
| `spend.total_cny` | `CNY 合计` | ✅ |
| `spend.source` | `来源` | ✅ |
| `spend.plan_label` | `套餐名称` | ✅ |
| `spend.amount` | `金额` | ✅ |
| `spend.currency` | `币种` | ✅ |
| `spend.note` | `备注` | ✅ |
| `spend.add` | `添加记录` | ✅ |
| `spend.empty` | `暂无支出记录。` | ✅ |

**SpendPage.jsx** 全部使用 `copy()` 函数，无硬编码文案。测试通过。

## 五、`/settings` 页面验证

### 必须出现的中文文案

| 要求 | copy key | 值 | 来源 | 状态 |
|---|---|---|---|---|
| `设置` | `settings.page.title` | `设置` | zh/core.json | ✅ |
| `外观` | `settings.section.appearance` | `外观` | zh/core.json | ✅ |
| `主题` | `settings.appearance.theme.label` | `主题` | zh/core.json | ✅ |
| `语言` | `settings.appearance.language.label` | `语言` | zh/core.json | ✅ |
| `货币` | `settings.appearance.currency.label` | `货币` | zh/core.json | ✅ |
| `数据目录` | `settings.section.data_dirs` | `数据目录` | copy.csv | ✅ |
| `Claude Code 数据目录` | `settings.data_dirs.claude` | `Claude Code 数据目录` | copy.csv | ✅ |
| `Codex 数据目录` | `settings.data_dirs.codex` | `Codex 数据目录` | copy.csv | ✅ |
| `Hermes Agent 数据目录` | `settings.data_dirs.hermes` | `Hermes Agent 数据目录` | copy.csv | ✅ |
| `选择文件夹` | `settings.data_dirs.select_folder` | `选择文件夹` | copy.csv | ✅ |
| `Agent 默认计费` | `settings.section.agent_pricing` | `Agent 默认计费` | copy.csv | ✅ |
| `输入` | agent pricing `input_label` | `输入` | copy.csv | ✅ |
| `输出` | agent pricing `output_label` | `输出` | copy.csv | ✅ |
| `Token 套餐` | `settings.section.token_plan` | `Token 套餐` | copy.csv | ✅ |
| `限制显示` | `settings.section.limits` | `限制显示` | zh/core.json | ✅ |

## 六、`选择文件夹` 按钮验证

| 检查项 | 结果 |
|---|---|
| copy.csv 中 `settings.data_dirs.select_folder` = "选择文件夹" | ✅ |
| `DataDirectoriesSection.jsx` 渲染 3 个 `DirectoryInput`（claude/codex/hermes） | ✅ |
| 每个 `DirectoryInput` 包含一个 `选择文件夹` 按钮 | ✅ |
| WebView2 路径：`selectDirectoryWithNativeBridge()` → `chrome.webview.postMessage` | ✅ |
| Browser fallback：`selectLocalDirectory()` API → PowerShell / unsupported 提示 | ✅ |
| 测试：4 个 DataDirectoriesSection 测试通过 | ✅ |
| `DashboardWindow.cs`：`selectFolder` 消息 → `FolderBrowserDialog` | ✅ |
| `src/lib/local-api.js`：`/tokentracker-select-directory` POST 端点 | ✅ |

**按钮数量 = 3 ✅**

## 七、Forbidden 文案扫描

### 必须不存在的文案（在 `/spend` 和 `/settings` 渲染页面中）

| Forbidden 文案 | 在 SpendPage.jsx | 在 SettingsPage.jsx | 在 copy.csv（active） | 状态 |
|---|---|---|---|---|
| `Spend` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Manual MVP spend records` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Settings` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `DATA DIRECTORIES` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Agent Default Pricing` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Token Plan` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Cloud sync` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Public profile` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `leaderboard` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `云同步` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `公开主页` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `公开排行榜` | ❌ | ❌ | ❌ | ✅ 不存在 |
| `Star` | ❌ | ❌ | ❌（dashboard 侧） | ✅ 不存在 |
| `Token Tracker` | ❌ | ❌ | ❌ | ⚠️ 见下 |

### ⚠️ `Token Tracker` 残留

| 位置 | 行号 | 是否可见 | 严重度 |
|---|---|---|---|
| `Sidebar.jsx` → `MobileTopBar` | 416, 420 | ✅ **移动端可见**（`< lg` 断点） | 中 |
| `Shell.jsx` | 12, 18 | 着陆页壳，MVP 中可能未路由 | 低 |
| `LeaderboardProfilePage.jsx` | 60 | 排行榜路由已隐藏 | 低 |
| `MarketingLanding.jsx` | 171 | 着陆页，MVP 中可能未路由 | 低 |
| `AnnualReportCard.jsx` | 168, 232 | 分享卡片，非主页面 | 低 |
| `BroadsheetCard.jsx` | 95 | 分享卡片，非主页面 | 低 |

**关键问题：** `Sidebar.jsx:420` 的 `MobileTopBar` 组件在移动端屏幕（宽度 < lg）上会显示硬编码的 "Token Tracker"，而非 "Token Eyes"。

## 八、`document.title` 注入链路验证

```
copy.csv: landing.meta.title = "Token Eyes"
    ↓ vite.config reads copy.csv at build time
    ↓ meta.title → __TOKENTRACKER_TITLE__
    ↓ index.html: <title>__TOKENTRACKER_TITLE__</title>
    ↓ build output: <title>Token Eyes</title>
```

✅ 链路完整，curl 确认输出为 `<title>Token Eyes</title>`。

## 九、语言链路完整性

```
localStorage("tokentracker-locale") = any value
    ↓ normalizeLocalePreference()
    ↓ classifyLanguageTag() → always zh-CN for non-empty
    ↓ resolvePreferredLocale() → always zh-CN
    ↓ copy(key) loads from zh/core.json + zh/dashboard.json (i18n override)
    ↓ fallback to copy.csv (which has Chinese values for MVP keys)
```

✅ 旧 `ja/ko/zh-TW` i18n 目录已删除，无回退路径。

## 十、阻塞问题

**无。**

## 十一、非阻塞问题

1. **Sidebar.jsx:420 硬编码 "Token Tracker"** — 移动端标题栏显示旧品牌名。应改为 `copy("shared.app_name")` 或硬编码 "Token Eyes"。
2. **Main bundle 921KB** — 超过 500KB chunk size 警告阈值。非本次验收范围。
3. **部分 copy.csv 英文 fallback** — settings section 标题（Appearance、Account、Limits Display）在 copy.csv 中仍为英文，依赖 zh/core.json 覆盖。如果 i18n 加载失败会回退英文。
