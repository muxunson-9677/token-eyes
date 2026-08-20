# Token Eyes 0.54.44 修复验收台账

> 记录日期：2026-08-21（Asia/Shanghai）
> 计划：`docs/superpowers/plans/2026-08-20-token-eyes-05444-remediation.md`
> 审查：`docs/reports/2026-08-20-v0.54.44-auth-data-provider-link-audit.md`

## 1. 当前结论

Tasks 1–11 的代码、合成安全 fixture、自动化 source-to-screen 和本地 canonical CI 已完成。Task 12 的 root canonical gate 与无 bundle resources 的全量 Rust gate也已通过。

当前**不能**把 23 个问题写成“已修复/verified”，原因是修复仍在未提交工作区内，且尚未获授权执行新唯一版本、私有 Windows installer build/install、真实测试账号、legacy 精确 cleanup、安装版 UI 截图/录屏及四点 SHA 闭环。

当前状态：

- `code done`：代码与自动化已完成，但 Packaged UI 或 Artifact/source 层仍缺。
- `blocked`：还缺用户授权、真实测试账号或固定上游 fixture。
- `verified`：0 项。
- 未 commit、push、tag、release、公开发布；未读取真实 token、Cookie、账号标识或凭据文件。

## 2. 工作区与源码身份

| 项目 | 结果 |
|---|---|
| Worktree | `E:\AgentData\Codex\worktrees\e9b3\010-Token eye` |
| Branch | `codex/05444-remediation-20260820` |
| HEAD | `993da2785cf7d61379fa2ec0d11ebea8e9428d71` |
| `origin/main` | `993da2785cf7d61379fa2ec0d11ebea8e9428d71` |
| Worktree | dirty；包含 Tasks 1–12 的未提交修改及保留的报告/计划/证据资产 |
| 修复源码 SHA | 不存在；当前 HEAD 仍是修复前基线，不能用于修复 provenance |
| Build / installed SHA | 未生成 |

因此下述四点闭环全部 pending：修复源码 SHA → build manifest SHA → installed manifest SHA → Data Sources/诊断页 SHA。

## 3. 自动化验收证据

| 层 | 精确命令 | 结果 | 边界 |
|---|---|---:|---|
| Task 11 exact | `node --test test/test-discovery-contract.test.js test/token-plan-catalog.test.js test/token-eyes-codex-auth-contract.test.js test/npm-publish-workflow.test.js test/release-windows-workflow.test.js test/windows-build-script-safety.test.js test/windows-release-metadata.test.js` | 107/107 pass | 合同与 workflow 静态/合成验证 |
| Root canonical | `npm test` | 2313 total / 2305 pass / 0 fail / 8 skip | skip 不计作通过 |
| Dashboard | `npm --prefix dashboard run test` | 155 files / 1620 tests pass | DOM 自动化不替代安装版 UI |
| Local canonical CI | `npm run ci:local` | exit 0 | agents、lint、typecheck、Dashboard test/build、data policy、root tests、copy/hardcode/architecture guards 全链 |
| Rust full | `$env:TAURI_CONFIG='{"bundle":{"resources":[]}}'; cargo test --manifest-path src-tauri/Cargo.toml; Remove-Item Env:TAURI_CONFIG` | 305/305 pass | 测试模式清空 resources，不是实际 bundle/install |
| Task 11 A review | discovery/catalog/auth/npm workflow + build safety | 58/58 + 10/10 | independent review PASS，0 Critical/Important |
| Task 11 C review | metadata + Windows + DMG workflows | 62/62；version consistency 6/6 | independent review PASS，0 Critical/Important |
| Mixed pricing review | Node/API + Dashboard hooks/components | 46/46 + 114/114 | independent review PASS，0 Critical/Important |

### 3.1 八条条件 skip

- 6 条：`skills-manager` 目录 symlink 安全用例；当前 Windows 环境不能创建目录 symlink。
- 1 条：Gemini nvm/launchd PATH fallback；仅适用于 macOS。
- 1 条：Kiro DB→JSONL fallback；本机缺固定 `sqlite3` 测试依赖。

这些 skip 没有被记作 PASS；如需跨平台完整绿灯，必须在具备相应能力/依赖的隔离环境重跑。

## 4. 23 项逐项台账

| ID | 修复前 RED / 缺陷证据 | 修复后 GREEN / 安全或数据 fixture | Packaged UI / SHA | 状态 |
|---|---|---|---|---|
| AUTH-01 | `persists awaiting -> awaiting -> authorized across every Codex polling round`：旧流程提前清 pending 并让 `session_not_found` 覆盖真实原因 | Codex Node 65/65；Codex Rust 82/82；TokenPlan UI 120/120。fake app-server 与临时 account dir 验证逐轮持久化、browser-open failure cancel+reconcile | 新账号、旧失败重试、取消/超时/重启恢复尚未在安装版实点；四点 SHA pending | code done |
| AUTH-02 | `acknowledged_cancel_allows_the_same_client_to_start_the_next_login`：旧 direct listener 无法可靠取消/复用 | Node/Rust/UI 同上；`codex_oauth.rs` 已移除，listener/固定端口路径不再进入生产；cancel ack 后同 client 可再次登录 | 安装版“取消后立即重试”未实点；SHA pending | code done |
| AUTH-03 | `Codex authorized without quota remains connected with a retryable sync error`：旧实现把授权和额度同步耦合 | fake `account/read` + rate-limit failure；授权保持 connected，额度错误独立可重试；Node 65/65、Rust 82/82、UI 120/120 | 安装版“授权成功但额度网络失败”未实点；SHA pending | code done |
| UX-01 | `shows a five-minute Codex waiting panel with safe reopen, cancel, diagnostics, and link semantics` | fake timers/DOM 锁 5 分钟、reopen/cancel/诊断、`role=status/alert`、`aria-live`、focus；copy/hardcode/typecheck/build 已进 `ci:local` | 安装版键盘/a11y/倒计时/恢复截图录屏未做；SHA pending | code done |
| DATA-01 | `DATA-01 refresh adapter treats fresh 100/0 and 0/100 as authoritative reports`：旧 50 覆盖合法 0 | console/refresh/local API 166/166；临时记录锁 absent/null/0、非法数值、expiry 五态与 provider-owned 字段 | 安装版 `used=0`、`remaining=0` 未实点；SHA pending | code done |
| DATA-02 | `DATA-02 GLM live weekly window exclusively owns the top-level quota triple`；legacy migration 必须有 paired evidence | Task 6 七文件当前 213/213；固定 reviewed URL/SHA，hash 漂移返回 `manual_evidence_required`；static entitlement 与 live token window 分层 | 安装版未验；SHA pending | code done |
| DATA-03 | `DATA-03 treats interval and weekly usage_count as consumed and saturates overage` | Task 6 213/213；合成 overage/negative/type drift；parser→refresh→local 四层均 `provider_count`，无 token 换算 | 安装版未验；SHA pending | code done |
| DATA-04 | `pricing hard max: stale catalog evidence is retained but cost is null`；mixed provenance API RED | pricing Node 135/135、Dashboard 120/120；30 天 ±1ms、user override、stale=null、priced+unpriced=`partial/mixed/components`；独立复审 46/46 + 114/114 | 安装版成本来源标签未实点；SHA pending | code done |
| DATA-05 | GLM source hash drift 与 market TTL/promotion expiry RED | Task 6 213/213；Task 10 catalog focused/组合通过；invalid clock、TTL ±1ms、hash replay、过期促销 fail closed | live 来源巡检未运行；安装版 stale/unverified 未实点；SHA pending | code done |
| DATA-06 | Xiaomi missing credit 被伪 0；ZCode host-derived key/未核 endpoint 会假支持 | Xiaomi/ZCode Node 196/196、Dashboard 170/170、Rust Xiaomi 38/38；ZCode 在 fixture 缺失时 0 credential-file probe / 0 network 并诚实 unsupported | Xiaomi 真实 Windows 测试账号与安装版未验；ZCode 缺固定 endpoint/response/credential-reader/source hash | Xiaomi code done；ZCode full support blocked |
| DATA-07 | aggregate Codex network error 不一致；Cursor Auto/API/team/overall 被平均或伪造 headline | Node scoped 145 pass/1 platform skip、Dashboard 131/131、Rust Codex 82/82、Cursor 46/46；401/403/404/5xx/network 与 forged DTO fixtures | 安装版独立 lane/错误态未实点；SHA pending | code done |
| ID-01 | `Token Plan GET migrates only exact kiro-cli source records...` | Task 7 current 379 pass/1 platform skip；canonical projection；只迁精确 Token Plan source，不迁 queue/model/path | installed runtime registry 未实点；SHA pending | code done |
| ID-02 | `Copilot vendor families remain distinct across market, agent, and capability registries` | market-only `microsoft-copilot`，GitHub `copilot` usage/history 保持；Task 7 与 PlanMarket 自动化通过 | 安装版市场/额度分离未实点；SHA pending | code done |
| ID-03 | `canonical agent registry owns exactly 28 adapters and 27 usage identities` | `agents:check` exit 0；28 adapters/27 identities；Limits renderer 面 16，Token Plan 27，互不混层；Dashboard 1620/1620 | bundled/installed registry 文件未实点；SHA pending | code done |
| ID-04 | Windows `auth.db` 无 fixed Credential Manager target/blob；旧实现 plaintext-first/身份重读 | secure-first 候选与仅 401/403 fallback；auth.db-only=`configured:true + secure_store_unsupported`，0猜测reader/0真实凭据 | 缺固定上游 Credential Manager fixture 与安装版验证 | fail-closed code done；full secure read blocked |
| SEC-01 | `safe outbound rejects private A, private AAAA, and mixed public/private DNS` | custom/provider/Cursor 239/239；合成 Bearer + injected DNS/request；HTTPS、全 A/AAAA、pin、redirect、cap、exact redaction，0真实 token | 安装 runtime 未验；SHA pending | code done |
| SEC-02 | `config_writer_creates_top_level_keyring_setting`；旧 per-plan `auth.json` 所有权错误 | 临时 config 锁 keyring hard-fail、官方 app-server；只操作精确 synthetic legacy path，不接真实 keyring/账号 | 两个隔离 `CODEX_HOME`/不同测试账号、重启 `account/read`、fresh 全程无 `auth.json`、用户授权 legacy cleanup 均未做 | blocked |
| SEC-03 | atomic credential writer 与 persist-failure fresh quota RED | Task 9 102 total/101 pass/1 platform skip；synthetic Kimi/Gemini、symlink/inode/ACL/failure；真实 Windows restricted DACL replace；无真实凭据 | 安装版负向场景未验；SHA pending | code done |
| SEC-04 | Cursor 302 跨源会复用 Cookie；CSV/summary 无 cap | custom/provider/Cursor 239/239；合成 Cookie/mock HTTPS；只允许一次相对同源 redirect，跨源/伪域/跨端口/downgrade 0 二跳，body cap+脱敏 | 安装 runtime 未验；SHA pending | code done |
| LINK-01 | Volcengine 旧购买 claim 无当前证据；promotion freshness 只在构建时计算 | Task 10 A focused/组合通过；旧 Volc claim 清零并标 stale/unverified；offline fixture 分类通过 | scheduled/live checker 未运行；真实浏览器/安装版未验 | code done（诚实降级） |
| LINK-02 | 任意 URL opener、第三方未披露、redirect secret/report 泄漏 | provider-links 单一 authority；Task 10 fixture 8 classification / 10 policy / 1 valid registry / 7 invalid / 3 report / 10 secret；0 live network；Rust link_id 与 Dashboard自动链通过 | Windows 安装版鼠标/Enter 各打开系统浏览器未实点；SHA pending | code done |
| CI-01 | root glob 漏 co-located test；`ci:local` 漏 Dashboard；workflow 合同可被 OR/额外门绕过 | Task 11 exact 107/107；root 0 fail；Dashboard 1620；`ci:local` exit 0；unique owner/10 子门/AND opt-in/canonical+Rust only；Task 11A review PASS | 尚无修复 commit/push 对应的远端 CI run | code done；remote CI pending |
| REL-01 | 0.54.44 无修复级 SHA artifact；同版本可覆盖；MSI/NSIS/tag/provenance 门不完整 | build identity、manifest/build-info、metadata/checksum、MSI/NSIS 独立 guard、tag→`github.sha`、private artifact、publish/upload/no-clobber；Task 11B/C reviews PASS | 未选新唯一版本、未打包/安装、未核 digest/installed/UI SHA、未发布 | blocked pending Task 12 artifact/UI |

## 5. 四层 Definition of Done

| 层 | 当前证据 | 状态 |
|---|---|---|
| Contract/unit | 每个 ID 有可追溯 RED→GREEN；root、Dashboard、Rust 全门通过 | 完成 |
| Integration/security | local API、Rust、app-server、DNS/redirect/body、credential file 等均使用合成 fixture；未接触真实秘密 | 完成（上游 fixture 门除外） |
| Packaged UI | 未构建/安装新唯一版本；未执行真实账号、键盘、重启、失败恢复、0额度、来源披露场景 | 未完成 |
| Artifact/source | 修复未提交；无 build/installer/installed/UI SHA 四点一致证据 | 未完成 |

## 6. 下一步授权门

继续 Task 12 前需要用户明确授权以下操作与输入：

1. 选择并同步一个**新的唯一版本**，并授权建立不可变修复源码 SHA（commit；若需 Actions，再单独授权 push）。
2. 授权私有 Windows build + isolated installed smoke；不得复用/覆盖 0.54.44。
3. 授权使用至少两个不同 Codex 测试账号与两个隔离 `CODEX_HOME`；报告只写 `identities_distinct`，不记录 email、ID、token。
4. legacy `<account_dir>/auth.json` cleanup 必须逐个精确路径单独确认；不得 broad clean。
5. 授权安装版真实 UI 截图/录屏：授权/取消/超时/重启、额度网络失败、0/满额、Kiro/Copilot、27 identities、stale/unverified/第三方、鼠标/键盘官网链接。
6. 公开发布必须在私有 artifact 四层证据齐全后另行授权；当前不创建 tag/Release，不发布 npm/GitHub asset。

## 7. 本轮未执行事项

- 未版本升级。
- 未 commit、push、merge。
- 未构建、安装或卸载 Windows installer。
- 未读取真实 credential、token、Cookie、账号 identity。
- 未执行 live external-link crawl。
- 未创建 tag、GitHub Release 或 npm publish。
