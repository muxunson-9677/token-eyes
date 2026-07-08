# [MVP] 12 - Token Plan 手动占位表单

## 任务ID

`V2.1-12`

## 对应 full-plan

来自 full-plan #12 的 V2.1 占位版。full-plan #11 和 #13 本轮推迟。

## 执行方

Claude Code

## 分支名

`feature/12-mvp-token-plan-placeholder`

## 所属模块

设置页占位表单。

## 目标文件

- 修改: `src/lib/local-api.js`
- 修改: `dashboard/src/lib/api.ts`
- 修改: `dashboard/src/pages/SettingsPage.jsx`
- 修改或新建: 设置页聚焦组件
- 测试: 在 `test/*.test.js` 下新增本地 API/配置测试
- 测试: 新增 Dashboard 组件测试
- 新建: `docs/test-reports/v2.1/12-token-plan-placeholder.md`

## 背景说明

V2.1 明确不做 Token Plan 自动刷新。本任务只占住 UI 位置,提供手动静态表单,让用户判断布局方向是否正确。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“Token Plan 占位表单”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败测试,覆盖创建/列表/更新一条本地手动套餐记录。
3. 增加本地存储/API,字段为:
   - `source`
   - `plan_label`
   - `total_quota`
   - `used_quota`
   - `remaining_quota`
   - `expires_at`
4. 在 Settings 页面增加表单和列表,展示这些手动值。
5. 在文案注册表中增加说明:自动刷新在 MVP 后推迟。
6. 运行:

```bash
npm test
npm --prefix dashboard run build
```

7. 把验证证据写入 `docs/test-reports/v2.1/12-token-plan-placeholder.md`。

## 验收标准

- 用户可以手动保存并查看一条或多条 Token Plan 占位记录。
- 没有后台刷新。
- 没有 credential/cookie 字段。
- UI 明确说明这只是 MVP 手动数据。

## 禁止事项

- 不实现官方 API 轮询。
- 不实现 Cookie 抓取。
- 不存储任何凭证。
- 不增加刷新间隔设置。
