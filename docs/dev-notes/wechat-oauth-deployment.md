# Token Eyes 排行榜微信登录部署说明

本说明只适用于 Token Eyes 自己的排行榜登录。部署不会改变本地免登录行为，也不涉及 CC Switch 或仓库外软件。

## 外部前提

- 已审核通过的微信开放平台“网站应用”。
- 该应用的 AppID、AppSecret 和已备案授权回调域名。
- 可管理的 InsForge 项目，以及该项目生成的自定义 OAuth 回调 URL。
- 已部署的 HTTPS Edge Function 公网 URL。

没有这些真实配置时，客户端会显示“微信登录服务尚未配置”，不会用模拟账号冒充成功。

## 1. 建表

在 InsForge 数据库执行 `scripts/ops/wechat-oauth-adapter.sql`。迁移会创建三个启用 RLS 的短期表：授权流程、一次性授权码和短期 UserInfo 令牌。

表中不保存微信 AppSecret、微信 access token、openid、unionid、原始适配器 state、原始授权码或原始 bearer token。适配器 state、授权码、令牌和微信稳定身份都以 SHA-256 摘要持久化。为把微信身份映射为 InsForge 用户，授权码和 UserInfo 短期表会暂存微信昵称、头像、不可逆稳定账户标识和内部不可投递邮箱；有效期最长 10 分钟，过期后由清理函数删除。该数据范围已在排行榜规则页向用户披露。

适配器的每个有状态 OAuth 动作都会调用 `tokentracker_prune_wechat_oauth()` 删除过期流程、授权码、令牌和临时资料。生产环境还应使用数据库平台的定时任务每小时执行一次 `SELECT tokentracker_prune_wechat_oauth();`，确保长期没有新登录请求时，最后一批过期数据也会按期清理。

## 2. 部署 Edge Function

把 `dashboard/edge-patches/tokentracker-wechat-oauth.ts` 部署为一个公开 Edge Function。该函数用查询参数提供五个动作：

- `?action=discovery`
- `?action=authorize`
- `?action=callback`
- `?action=token`
- `?action=userinfo`

生产地址必须使用 HTTPS，并且 `WECHAT_OAUTH_PUBLIC_URL` 必须填写不带 `action` 查询参数的完整函数地址。

## 3. 服务端环境变量

只在 Edge Function 服务端配置以下变量，禁止写入前端 `.env`、源码、安装包或文档示例值：

| 变量 | 用途 |
|---|---|
| `WECHAT_OPEN_APP_ID` | 微信开放平台网站应用 AppID |
| `WECHAT_OPEN_APP_SECRET` | 微信开放平台网站应用 AppSecret |
| `WECHAT_OAUTH_PUBLIC_URL` | 当前适配函数的 HTTPS 公网地址 |
| `WECHAT_OAUTH_CLIENT_ID` | Token Eyes 与 InsForge 自定义 Provider 共用的 client ID |
| `WECHAT_OAUTH_CLIENT_SECRET` | Token Eyes 与 InsForge 自定义 Provider 共用的 client secret |
| `WECHAT_OAUTH_REDIRECT_URIS` | InsForge 回调 URL 精确白名单；多个值以英文逗号分隔 |
| `INSFORGE_BASE_URL` | 当前 InsForge 项目地址 |
| `INSFORGE_SERVICE_ROLE_KEY` | 仅 Edge Function 使用的服务端密钥 |
| `INSFORGE_ANON_KEY` | 项目需要时使用的 anon key |

`WECHAT_OAUTH_CLIENT_SECRET` 与微信 AppSecret 是两个不同的密钥，不能复用。

## 4. 配置微信开放平台

微信网站应用的授权回调指向：

`<WECHAT_OAUTH_PUBLIC_URL>?action=callback`

回调域名必须与微信开放平台审核配置完全一致。AppSecret 只保存在 Edge Function 环境变量中。

## 5. 配置 InsForge 自定义 OAuth Provider

- Provider key：`wechat`
- Discovery URL：`<WECHAT_OAUTH_PUBLIC_URL>?action=discovery`
- Client ID：与 `WECHAT_OAUTH_CLIENT_ID` 完全相同
- Client secret：与 `WECHAT_OAUTH_CLIENT_SECRET` 完全相同
- 唯一身份字段：`sub`（响应同时提供兼容字段 `id`）
- 邮箱字段：`email`
- 显示名字段：`name`
- 头像字段：`picture`

将 InsForge 展示的实际 OAuth 回调 URL 原样加入 `WECHAT_OAUTH_REDIRECT_URIS`，不要填写排行榜页面 URL，也不要使用模糊域名匹配。

### 区分两层白名单

`WECHAT_OAUTH_REDIRECT_URIS` 与 InsForge 项目的 **Allowed Redirect URLs** 是两层不同的白名单，不能互相替代：

- Provider 回调白名单：`WECHAT_OAUTH_REDIRECT_URIS` 只接受 InsForge 为自定义 Provider 生成的 OAuth 回调 URL，供本适配器把授权结果交还 InsForge。
- 应用回跳白名单：在 InsForge 项目的 **Allowed Redirect URLs** 中，按实际发布入口加入下表地址。

| Token Eyes 入口 | Allowed Redirect URL |
|---|---|
| Web 生产站 | `<TOKEN_EYES_WEB_ORIGIN>/leaderboard` |
| Tauri 安装版 | `http://tauri.localhost/leaderboard` |
| macOS 原生壳 | `http://localhost:7680/auth/callback` |
| Windows 原生壳 | `http://127.0.0.1:17680/auth/callback` |

Windows 原生壳在 17680 被占用时会选择操作系统分配的任意动态端口。动态回退端口无法预先加入精确白名单，因此这种情况下本地免登录功能仍可用，但排行榜微信 OAuth 需要 17680 可用；除非后续把 Windows 端改成一组有界且已放行的回退端口，否则不能把动态端口登录标为已验收。开发环境若使用其他 origin，也必须按实际 `window.location.origin` 单独加入对应 `/leaderboard` 或 `/auth/callback`，不能照抄生产值。

不要把 `<TOKEN_EYES_WEB_ORIGIN>/leaderboard` 或本机 `/auth/callback` 填入 `WECHAT_OAUTH_REDIRECT_URIS`；也不要把 InsForge Provider 回调 URL 当作应用回跳地址。所有占位符必须替换为项目真实 HTTPS origin 后再验收。

## 6. 验收清单

1. 访问 Discovery URL，确认 authorization、token、userinfo 和 `S256` 字段存在。
2. 对照上一节检查 Provider 回调与应用回跳两层白名单，确认 Web 和安装版实际地址均已覆盖。
3. 未登录访问 `/leaderboard`，确认榜单可公开浏览，且登录入口只有微信。
4. 点击微信登录，确认进入微信官方二维码页，而不是 Token Eyes 自建账号窗口。
5. 取消扫码，确认返回排行榜并显示失败状态；重复回调不能继续授权。
6. 正常扫码后确认返回排行榜、创建 InsForge 会话并能显示“我的排名”。
7. 退出后确认本地概览、使用统计、限制、成本和设置仍然可用。
8. 检查浏览器包、日志和数据库，确认没有 AppSecret、微信 access token、openid、unionid 或原始 OAuth bearer token。
9. 确认数据库定时清理任务已启用，并验证过期 OAuth 临时行会在下一次任务执行后删除。

仓库自动化只能验证协议、安全状态机和前端边界。真实扫码、微信审核域名、生产回调和真实 InsForge 会话必须使用项目自己的合规配置进行人工验收。
