# [MVP] 17 - 基本联调测试报告

## 任务ID

`V2.1-17`

## 对应 full-plan

full-plan #17。

## 执行方

Claude Code

## 分支名

`feature/17-mvp-integration-test`

## 所属模块

联调验证。

## 目标文件

- 读取: 所有 V2.1 实现改动
- 新建: `docs/test-reports/v2.1/17-integration-test.md`

## 背景说明

本任务在 V2.1 实现 PR 可用后执行,产出一份给 Codex 审核用的联调报告。本任务不新增产品功能。

## 必跑验证

运行:

```bash
npm test
npm --prefix dashboard run build
node bin/tracker.js sync
node bin/tracker.js serve --no-sync
```

本地 Dashboard 手动检查:

- Dashboard 可以打开。
- 如果本机存在对应数据,同屏能看到 Codex、Claude Code、Hermes Agent 来源。
- 成本能显示 USD 和 CNY。
- 缓存命中率卡片可见,数字逻辑合理。
- 花销页可以新增一条手动记录并显示汇总。
- 设置页显示数据目录覆盖和 Token Plan 手动占位表单。
- 侧边栏只显示 Dashboard、Spend、Settings。

## 报告格式

写入 `docs/test-reports/v2.1/17-integration-test.md`,包含:

- 环境
- Commit SHA
- 执行命令
- 命令结果
- 手动检查结果
- 已知缺口
- 如果有截图,写明截图路径

## 验收标准

- 报告存在,并包含明确的通过/失败证据。
- 缺少真实来源数据时,按环境缺口说明,不能隐瞒。
- 不包含 prompt、消息正文、凭证、Cookie 或私人内容。

## 禁止事项

- 除非 Codex 开新工单,本分支不修 bug。
- 不实现 Token Plan 自动刷新。
- 不扩大 V2.1 MVP 范围。
