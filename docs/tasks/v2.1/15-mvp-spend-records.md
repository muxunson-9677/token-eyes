# [MVP] 15 - 简化花销记录

## 任务ID

`V2.1-15`

## 对应 full-plan

full-plan #14 和 #15,V2.1 简化版。

## 执行方

Claude Code

## 分支名

`feature/15-mvp-spend-records`

## 所属模块

花销页。

## 目标文件

- 修改: `src/lib/local-api.js`
- 修改: `dashboard/src/lib/api.ts`
- 修改: `dashboard/src/App.jsx`
- 修改: `dashboard/src/ui/components/Sidebar.jsx`
- 新建: `dashboard/src/pages/SpendPage.jsx`
- 新建或修改: `dashboard/src/ui/dashboard/components/` 下的聚焦组件
- 测试: 在 `test/*.test.js` 下新增本地 API 测试
- 测试: 新增 Dashboard 页面/组件测试
- 新建: `docs/test-reports/v2.1/15-spend-records.md`

## 背景说明

V2.1 只需要手动新增订阅/花销记录、列表展示和简单求和。不需要月付/年付/一次性周期换算。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“订阅/花销记录 MVP”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败的本地 API 测试,覆盖 create/list/delete 和总额计算。
3. 新增本地存储/API 保存花销记录。
4. 增加 `/spend` 路由和侧边栏入口。
5. 实现表单字段:
   - source
   - plan label
   - amount
   - currency
   - note
6. 实现列表和 USD/CNY 简单总额。
7. 运行:

```bash
npm test
npm --prefix dashboard run build
```

8. 把验证证据写入 `docs/test-reports/v2.1/15-spend-records.md`。

## 验收标准

- 用户可以新增一条花销/订阅记录。
- 新增记录无需刷新即可出现在列表中。
- 总额同时显示 USD 和 CNY,使用 MVP 固定汇率。
- 不存在周期换算逻辑。

## 禁止事项

- V2.1 不实现年付/月付折算。
- 不为花销记录增加云同步。
- 不增加账号登录要求。
