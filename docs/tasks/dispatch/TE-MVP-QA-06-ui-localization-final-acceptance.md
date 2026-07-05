# TE-MVP-QA-06 - Token Eyes 中文化收尾独立验收

## 给 Claude Code 的执行说明

你是独立 QA 执行者。**原则上不改代码**。本工单只做验证和报告,不要继续开发 UI 文案、不要重构、不要扩大到 full-plan 后续功能。

> 重要经验: 上一个 Claude 失败的根因不是浏览器缓存,而是没有验证真实运行时语言链路。你必须用浏览器/Playwright 读取真实页面文本,并模拟旧语言偏好 `tokentracker-locale=en`。没有这个验证,不能说完成。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: 等 Codex 当前 Token Eyes UI 收尾修复提交/推送后的最新分支。
- 新建分支: `claude/te-mvp-qa-06-ui-localization-acceptance`

如果当前工作区有未提交改动,不要直接 `git switch`。请先询问负责人或使用干净 worktree。

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-qa-06-ui-localization-acceptance
```

## 背景

Codex 已完成 Token Eyes UI 收尾修复:

- `/spend` 中文化。
- `/settings` 中文化。
- 页面 title 改为 `Token Eyes`。
- 旧语言偏好 `tokentracker-locale=en` 会归一为 `zh-CN`。
- 云同步、公开主页/公开排行榜、Star、Token Tracker 可见文本已移除。
- Claude Code / Codex / Hermes Agent 数据目录各有 `选择文件夹` 按钮。

## 必须吸取的失败经验

Claude 上次失败主要因为:

1. 只改了表层文案,没有处理 `copy.csv` fallback + i18n registry + `locale.ts` 的语言解析链路。
2. 删除 `ja/ko/zh-TW` 后没有验证旧 localStorage 偏好仍可能让页面回退英文。
3. 只跑 build/typecheck,没有打开真实页面读取 `body.innerText()`。
4. 没有发现 `<title>` 是 Vite 从 `dashboard/src/content/copy.csv` 的 meta 字段注入的。
5. 把用户看到的旧 UI 归因于缓存,但没有证据。

本工单的验收必须覆盖这些点。

## 自动验证命令

```bash
npm.cmd --prefix dashboard run test -- locale.test.ts LocaleProvider.test.jsx UsageLimitsPanel.test.jsx WidgetsPage.test.jsx AgentPricingSection.test.jsx DataDirectoriesSection.test.jsx TokenPlanSection.test.jsx SpendPage.test.jsx currency.test.ts cache-hit.test.ts
node --test test/app-route-pathname-guard.test.js test/settings-account-user-id.test.js
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

预期:

- Vitest 相关测试通过。
- Node route/account 测试通过。
- typecheck 通过。
- dashboard build 通过; Vite chunk size warning 不算失败。

## 真实页面验证

启动本地服务:

```bash
node bin/tracker.js serve --no-sync --no-open
```

打开页面:

```text
http://127.0.0.1:7681/spend
http://127.0.0.1:7681/settings
```

如果终端输出不是 7681,以实际端口为准。

必须验证:

- 页面 title 是 `Token Eyes`。
- `/spend` 可见中文包含:
  - `支出`
  - `MVP 手动支出记录`
  - `USD 合计`
  - `CNY 合计`
  - `来源`
  - `套餐名称`
  - `金额`
  - `币种`
  - `备注`
  - `添加记录`
  - `暂无支出记录`
- `/settings` 可见中文包含:
  - `设置`
  - `外观`
  - `主题`
  - `语言`
  - `货币`
  - `数据目录`
  - `Claude Code 数据目录`
  - `Codex 数据目录`
  - `Hermes Agent 数据目录`
  - `选择文件夹`
  - `Agent 默认计费`
  - `输入`
  - `输出`
  - `Token 套餐`
  - `限制显示`
- `选择文件夹` 按钮数量是 3。
- 可见文本中不得出现:
  - `Spend`
  - `Manual MVP spend records`
  - `Settings`
  - `DATA DIRECTORIES`
  - `Agent Default Pricing`
  - `Token Plan`
  - `Cloud sync`
  - `Public profile`
  - `leaderboard`
  - `云同步`
  - `公开主页`
  - `公开排行榜`
  - `Star`
  - `Token Tracker`

必须模拟旧语言偏好:

```js
localStorage.setItem("tokentracker-locale", "en")
```

刷新 `/spend` 和 `/settings`,确认仍然显示中文。

## 推荐 Playwright 验证脚本

可以用项目已安装的 Playwright。脚本里的中文断言请使用 Unicode escape 或独立 UTF-8 文件,避免 Windows PowerShell 管道把中文变成 `??`。

最小要求:

```text
读取 document.title
读取 document.body.innerText
设置 localStorage tokentracker-locale=en 后 reload
断言 required 文案存在
断言 forbidden 文案不存在
断言选择文件夹按钮数量为 3
```

## 报告文件

创建:

```text
docs/test-reports/v2.1/18-ui-localization-final-acceptance.md
```

报告必须包含:

- 验收日期
- 分支名和 commit SHA
- 自动验证命令与结果
- `/spend` 页面可见文本摘要
- `/settings` 页面可见文本摘要
- 旧 `tokentracker-locale=en` 验证结果
- `选择文件夹` 按钮数量
- 是否发现 forbidden 文案
- 阻塞问题
- 非阻塞问题

## 完成后提交

如果没有改代码,只提交报告:

```bash
git status --short
git add docs/test-reports/v2.1/18-ui-localization-final-acceptance.md
git commit -m "test: add token eyes ui localization acceptance report"
git push -u origin claude/te-mvp-qa-06-ui-localization-acceptance
```

最后回复:

- 分支名
- commit SHA
- 验收结论
- 自动验证结果
- 阻塞问题
- 非阻塞问题
