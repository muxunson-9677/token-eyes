# V2.1-15 简化花销记录验收报告

日期: 2026-06-19

## 结论

已完成简化花销页:

- 新增本机接口 `tokentracker-spend-records`。
- 支持 create/list/delete。
- 新增 `/spend` 页面和路由。
- 表单字段: source、plan label、amount、currency、note。
- 汇总字段: `total_usd`, `total_cny`, 固定汇率 7.2。
- 新增记录无需刷新即可出现在列表中。
- 没有月付/年付/一次性周期折算逻辑,没有云同步。

## 验证

```bash
node --test test\spend-records-api.test.js
```

结果: 通过,覆盖 USD/CNY 汇总和删除后汇总。

```bash
npm.cmd --prefix dashboard run test -- SpendPage.test.jsx
```

结果: 通过,覆盖新增记录后列表和总额立即更新。

统一验证中的 typecheck 和 build 均通过。
