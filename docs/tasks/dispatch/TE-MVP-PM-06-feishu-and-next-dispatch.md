# TE-MVP-PM-06 - 飞书进度更新与下一批 Claude 派发归档

日期: 2026-06-20

## 当前状态

Codex 已通过飞书 REST API 真实写入 `Token Eyes 进度表` / `V2.1工单` 表。这个文件作为 A06 任务归档,不要再把“飞书同步”派给 Claude。

实际派发入口使用:

- `docs/tasks/dispatch/TE-MVP-DISPATCH-2026-06-20.md`
- `docs/tasks/dispatch/TE-MVP-QA-06-ui-localization-final-acceptance.md`
- `docs/tasks/dispatch/TE-MVP-WIN-07-windows-folder-picker-verification.md`

## 飞书读回确认

| 任务ID | 状态 | 当前阶段 |
|---|---|---|
| `A05` | 执行中 | 持续维护中 |
| `C02` | 已审核 | 已完成并补充收尾验证 |
| `G02` | 已审核 | 已完成并补充中文化验证 |
| `H01` | 已审核 | 已完成并补充可见文本验证 |
| `H02` | 已审核 | 已完成并补充最终本地验证 |
| `H03` | 待审核 | 等待用户最终确认与独立 QA 报告 |
| `A06` | 已审核 | 已完成 |
| `H05` | 待分派 | 等待用户打开 Claude 终端执行 |
| `C05` | 待分派 | 等待 .NET 8 SDK Windows 环境 |

## Claude 上次失败的根因

Claude 之前没有真的改成功,核心不是浏览器缓存,而是没有定位到真实运行链路:

1. 只改了部分中文文案,没有处理 `copy.csv` fallback、i18n registry、`locale.ts`、`LocaleProvider`。
2. 删除 `ja/ko/zh-TW` 后,没有验证旧 `localStorage` 语言偏好仍可能让页面回退到英文。
3. 只跑 build/typecheck,没有打开真实页面读取 `body.innerText()`。
4. 没有发现 `<title>` 是从 `dashboard/src/content/copy.csv` 的 meta 字段注入。
5. 把“选择路径”误判为普通前端按钮,没有区分 Windows WebView2 原生桥和普通浏览器 fallback。

后续 Claude 工单必须写入并执行这些经验:

```text
不要把 UI 未更新归因于浏览器缓存,除非已经证明服务端 JS 包、文案源头、语言偏好和真实页面文本都正确。
必须验证 copy.csv / i18n / locale.ts / LocaleProvider。
必须模拟 localStorage.setItem("tokentracker-locale", "en") 后刷新。
必须用 Playwright 或浏览器读取 document.title 与 document.body.innerText。
没有真实页面证据,不能报告完成。
```

## 下一批派发

建议开 2 个 Claude 终端对话框,一个 Claude 只处理一个工单:

1. Claude #1: `TE-MVP-QA-06-ui-localization-final-acceptance.md`
2. Claude #2: `TE-MVP-WIN-07-windows-folder-picker-verification.md`

如果当前机器没有 .NET 8 SDK,先只开 Claude #1;`TE-MVP-WIN-07` 等有 .NET 8 SDK 的 Windows 环境后再派发。

不要再开多个 Claude 同时修改:

- `/spend`
- `/settings`
- `dashboard/src/content/copy.csv`
- `dashboard/src/lib/locale.ts`
- `dashboard/src/content/i18n/**`

这些区域已经收尾,多个 Claude 同时改会互相覆盖。
