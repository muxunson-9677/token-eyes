# [MVP] 09 - 固定 USD/CNY 成本展示

## 任务ID

`V2.1-09`

## 对应 full-plan

full-plan #8 和 #9,V2.1 简化版。

## 执行方

Claude Code

## 分支名

`feature/09-mvp-usd-cny`

## 所属模块

成本展示。

## 目标文件

- 修改: `dashboard/src/lib/currency.ts`
- 修改: `dashboard/src/hooks/useCurrency.js`
- 修改: Dashboard 中展示成本的组件
- 如 `V2.1-15` 已存在,同步修改花销页/组件
- 测试: `dashboard/src/lib/currency.test.ts`
- 新建: `docs/test-reports/v2.1/09-usd-cny.md`

## 背景说明

V2.1 只需要先看到人民币数字。汇率使用 MVP 固定常量,不要做成设置项。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“V2.1 USD/CNY”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败测试,覆盖 `MVP_USD_TO_CNY = 7.2`。
3. 导出单一常量:

```js
const MVP_USD_TO_CNY = 7.2;
```

4. 在 V2.1 成本总数展示处同时显示 USD 和 CNY。
5. 运行:

```bash
npm --prefix dashboard run build
npm test
```

6. 把验证证据写入 `docs/test-reports/v2.1/09-usd-cny.md`。

## 验收标准

- Dashboard 成本摘要同时显示 USD 和 CNY。
- 如果花销页已存在,花销摘要也同时显示 USD 和 CNY。
- 没有新增汇率输入框或网络请求。

## 禁止事项

- V2.1 不做可配置汇率。
- 不调用任何外部汇率 API。
