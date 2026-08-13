# GitHub README 统计卡片 (tokentracker-badge)

`dashboard/edge-patches/tokentracker-badge.ts` 是一个 InsForge 边缘函数, 为公开的排行榜档案生成一张 SVG 统计卡片, 用于嵌入 GitHub README (W10 工单)。

> **状态: 代码就绪, 尚未部署。** 下面的 URL 在函数部署到 InsForge 之前不可用。

## 卡片内容

深色主题卡片 (GitHub 深色配色, 浅色背景下同样可读), 展示当前 ISO 周 (周一起始, UTC) 的三项统计:

- **Tokens this week** — 本周总 tokens
- **Est. spend** — 本周估算花费 (来自排行榜快照的 `estimated_cost_usd`)
- **Top model** — 本周 token 用量最高的模型

## 嵌入方式

```markdown
![Token Eyes](https://www.tokentracker.cc/functions/tokentracker-badge?profile=<id>)
```

`<id>` 是公开档案 id (即排行榜使用的 user_id UUID)。也接受 `user_id=` 作为等价参数名 (与既有的 `tokentracker-badge-svg` 保持一致)。

## 行为约定

- **永远返回 SVG**: 任何错误 (参数缺失、档案不存在、档案私密、服务故障) 都渲染成合法的错误状态 SVG, 不返回 JSON, README 中的图片不会裂开。
- **缓存**: `Cache-Control: public, max-age=3600` (1 小时)。
- **隐私门**: 与排行榜一致 — 仅 `is_public` 的快照行可见; 被封禁用户返回 404 卡片; 私密档案返回 403 卡片。
- **数据访问**: 周 tokens / 花费读取 `tokentracker_leaderboard_snapshots_v2` (与 `tokentracker-badge-svg.ts` 相同); top model 对 `tokentracker_hourly` 做单用户周窗口扫描 (简化自 `tokentracker-leaderboard-profile.ts` 的 `scanHourlyForUser`, 账号级来源跨设备去重、机器级来源仅累加活跃设备)。隐私最小化部署没有 `tokentracker_hourly` 表时, top model 显示 `n/a`。

## 部署前待办

- 函数尚未部署, 也未加入任何部署配置 — 部署时按现有边缘函数的发布流程操作。
- 代码内的 TODO:
  - `TODO(field-verification)`: 若未来上线短档案别名 (profile handle), 需在 UUID 校验前先做别名解析;
  - `TODO(pricing)`: 花费只读快照的 `estimated_cost_usd`, 刻意不把 5 份边缘文件的 MODEL_PRICING 镜像扩散成第 6 份; 快照缺失成本时显示 `$0`。
