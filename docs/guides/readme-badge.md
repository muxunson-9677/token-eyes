# GitHub README 统计卡片（已停用）

Token Eyes 0.54.49 将公共排行榜读取收敛为 285 个固定、签名的 Top 50 静态快照。旧 README Badge/Embed 接口按匿名 `user_id` 逐次查询 InsForge，与该隐私和零预算边界冲突，因此已经停用并从部署源删除。

- 不再部署 `tokentracker-badge`、`tokentracker-badge-svg` 或 `tokentracker-embed-svg`。
- 同一原因下，匿名逐用户的 `tokentracker-profile-likes` 装饰计数也已停用。
- 不再向用户提供公开档案 URL 或 README badge 复制入口。
- 公共访客只读取签名 Top 50 静态对象；不会获得内部账号 UUID。
- 已登录参与者仍可通过 JWT 绑定的 `me` 和本人详情接口查看自己的名次与详情。

不得恢复本文档旧版本中的匿名逐用户 Edge/数据库读取方式。若未来重新提供可嵌入卡片，必须先设计不产生无限逐用户对象、不泄露账号标识、且不回源 InsForge 的独立静态方案。
