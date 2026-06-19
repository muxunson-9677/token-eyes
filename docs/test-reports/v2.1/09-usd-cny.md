# V2.1-09 固定 USD/CNY 成本展示验收报告

日期: 2026-06-19

## 结论

已完成 MVP 固定汇率展示:

- `dashboard/src/lib/currency.ts` 导出 `MVP_USD_TO_CNY = 7.2`。
- 新增 `formatMvpUsdCny()`。
- Dashboard 成本摘要改为同时展示 `USD x / CNY y`。
- 没有新增汇率设置项,没有调用外部汇率 API。
- Spend 页面总额也同时展示 USD 和 CNY。

## 验证

```bash
npm.cmd --prefix dashboard run test -- currency.test.ts cache-hit.test.ts
```

结果: 22 个测试通过。

```bash
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

结果: 均通过。构建仅有 Vite 既有 chunk 大小和动态导入提示。
