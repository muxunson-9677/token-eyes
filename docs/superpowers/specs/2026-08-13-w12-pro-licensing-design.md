# W12 Pro 付费:License 校验 + InsForge 字段设计(方案文档)

> 状态:**仅设计,不含生产代码**。当前无外部收款账号(Lemon Squeezy / Paddle 均未开通),
> 本文档交付完整可执行的设计,收款账号就绪后按此实现。

## 1. 分层定义

| 层级 | 内容 | 定位 |
|---|---|---|
| Free | 本地全功能(采集/解析/成本/限额/请求日志)、排行榜、基础分享卡(broadsheet / annual-report / weekly-bill) | 获客渠道,永不降级 |
| Pro($29 买断) | 云同步多设备、周报/月报邮件、异常检测通知、自定义分享卡主题、README 徽章高级样式 | 增值层,全部为云侧/增值能力 |

设计红线:**离线或 License 服务不可用时,本地功能永不锁定**。Pro 只解锁云侧增值,
校验失败的最坏结果是回落到 Free 行为。

## 2. 收款与凭证发放(MoR 模式)

- 收款用 Merchant-of-Record(首选 Lemon Squeezy,备选 Paddle),由 MoR 处理税务/发票/退款。
- 购买完成 → MoR webhook → InsForge edge function `tokentracker-license-webhook`(新):
  1. 校验 webhook 签名(MoR secret 存 InsForge secrets);
  2. 生成 license key:`TTPRO-` + 32 字节 base32(服务端随机,不含用户信息);
  3. upsert `tokentracker_licenses` 行,状态 `active`;
  4. MoR 的邮件回执自带 license key(配置 MoR 模板),产品端不发邮件。
- 退款/拒付 webhook → 同一 edge function 将状态置 `revoked`(保留行,审计可查)。

## 3. InsForge 字段设计

新表 `tokentracker_licenses`(RLS:仅 service role 可写;认证用户只能读自己 `user_id` 绑定的行):

| 列 | 类型 | 说明 |
|---|---|---|
| `license_key_hash` | text PK | license key 的 SHA-256(**不存明文**,防库泄漏) |
| `status` | text | `active` / `revoked` |
| `product` | text | `pro_lifetime`(为将来订阅制留扩展) |
| `order_ref` | text | MoR 订单号(退款对账用) |
| `user_id` | uuid nullable | 首次激活后绑定的 InsForge 用户;购买时为 null |
| `activated_device_ids` | jsonb | 已激活设备指纹哈希数组,上限 5 台 |
| `created_at` / `activated_at` / `revoked_at` | timestamptz | 生命周期时间戳 |

设备指纹 = SHA-256(机器 GUID + 用户名),仅哈希上传,与排行榜既有 device 口径一致(隐私红线:不上传可逆标识)。

## 4. License 校验流程

新 edge function `tokentracker-license-verify`(新,无需登录也可调用):

```
POST { license_key, device_hash }
→ 200 { ok: true, product, activated_at }   // key 有效,设备已登记(不足 5 台时自动登记)
→ 403 { ok: false, code: "revoked" | "device_limit" | "invalid" }
```

客户端(CLI `src/lib/` 新模块 `pro-license.js`,设计):

1. 激活:Settings 页输入 key → 本地算 device_hash → 调 verify → 成功后把
   `{ license_key, verified_at, product }` 写入 OS 凭据库(复用既有 credential store 通道,**不落明文文件**)。
2. 周期复验:`serve` 启动时若 `verified_at` 距今 >24h 则后台静默复验。
3. **7 天离线宽限**:复验网络失败不降级,`verified_at` 距今 >7 天才回落 Free 行为;
   revoked 立即回落。宽限状态在 Settings 显示"上次校验时间 + 宽限剩余天数"。
4. 跨设备:新设备重复步骤 1;超 5 台返回 `device_limit`,Settings 提供"重置设备列表"
   (调用 verify 的 `reset_devices` 动作,一年限 2 次,防 key 共享滥用)。

## 5. 功能门控点(实现时的接入位)

| Pro 能力 | 门控位置 |
|---|---|
| 云同步多设备 | `src/lib/cloud-account.js` 上传路径检查 license 状态 |
| 周报/月报 | InsForge 定时任务只对 active license 的 user_id 发送 |
| 异常检测通知(W11 云侧推送) | 同上;本地横幅保持 Free 可用 |
| 分享卡自定义主题 / 徽章高级样式 | dashboard 侧 `useProLicense()` hook(读本地校验缓存) |

## 6. 退款流程(文档化)

1. 用户向 MoR 发起退款(MoR 政策 14 天);
2. MoR webhook → `status = revoked` + `revoked_at`;
3. 客户端下次复验(≤24h)收到 `revoked` → 立即回落 Free,本地数据不受影响;
4. 对账:`order_ref` 关联 MoR 后台订单,月度人工核对一次。

## 7. 实现排期(收款账号就绪后)

1. InsForge 表 + 两个 edge functions + webhook 联调(1 天);
2. CLI `pro-license.js` + credential store + 宽限逻辑 + 测试(1 天);
3. dashboard 激活 UI + `useProLicense()` + 门控接入(1 天);
4. 购买→激活→跨设备→退款全链路演练 + 文档(0.5 天)。

## 8. 风险

- **key 共享**:设备上限 5 台 + 重置限频;不做在线心跳锁(违背本地优先价值观)。
- **MoR webhook 丢失**:MoR 后台可手动重发;verify 端点对未入库 key 返回 `invalid`,
  用户联系支持后人工补录。
- **凭据库不可用(某些 Linux 无 keyring)**:回落到 `~/.tokentracker/license.json`
  (仅存 key 哈希 + 校验缓存,明文 key 不落盘)。
