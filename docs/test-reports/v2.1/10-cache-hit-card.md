# V2.1-10 缓存命中率卡片验收报告

日期: 2026-06-19

## 结论

已完成 Dashboard 顶部缓存命中率展示:

- 新增 `dashboard/src/lib/cache-hit.ts`。
- 计算公式为 `cached_input_tokens / (input_tokens + cached_input_tokens + cache_creation_input_tokens)`。
- 分母为 0 时展示 `0%`。
- `UsageOverview` 在摘要区显示缓存命中 token 数和命中率。
- 未新增后端接口,直接使用已有 summary totals。

## 验证

```bash
npm.cmd --prefix dashboard run test -- currency.test.ts cache-hit.test.ts
```

结果: 22 个测试通过,其中缓存命中率测试覆盖正常分母和 0 分母。

```bash
npm.cmd run dashboard:build
```

结果: 通过。
