# Token Eyes 0.54.47 私有候选验收台账

> 记录日期：2026-08-21（Asia/Shanghai）
> 计划：`docs/superpowers/plans/2026-08-20-token-eyes-05444-remediation.md`
> 本记录提交：验收记录提交 E；其父提交 S 是安装包、provenance、checksums 与安装版 manifest 的唯一源码身份。

## 1. 当前结论

候选源码提交 S 已完成本地 canonical CI、完整 Rust、私有 Windows 构建、provenance/checksums、隔离安装 runtime manifest 检查，以及两遍相互独立的**未登录第一审**。安装包、build provenance、checksums、bundle manifest、installed manifest 全部绑定 S。

本台账区分如下：

- `verified (第一审)`：针对未安装 Codex CLI 的隔离安装，真实鼠标已验证浏览器打开、1455 回调监听、等待 OAuth、删除后 reload/restart 均未连接。
- `partial/blocked (第二审)`：真实 OpenAI OAuth 成功后的“已连接”、真实额度结果以及删除后持久化回归，必须由用户本人或明确获授权的隔离测试账号完成；本轮没有读取、记录或使用任何账号标识、token、Cookie 或授权页秘密。
- `code done`：合成 fixture 与自动化 source-to-screen 已完成，但不替代需要真实供应商/多账号/上游固定 fixture 的项目。

未 push、未合并 main、未打 tag、未创建 GitHub Release、未公开发布、未发布 npm。远端 CI 尚未在 S 上运行，故本地证据不能提前宣称最终合并条件成立。

## 2. 工作区与源码身份

| 项目 | 结果 |
|---|---|
| Worktree | `E:\AgentData\Codex\worktrees\e9b3\010-Token eye` |
| Branch | `codex/05444-remediation-20260820` |
| Candidate source S | `5b37bf90cce38e5069a215988b407e4703967c94`（`test: stabilize installed Codex OAuth acceptance`） |
| S 的父提交 | `727bc43936bfcbe912b3c08fdc51bf1238e20864` |
| `origin/main`（本地追踪引用） | `9b3967aaa6267a4fd72c65844e730de4692c7487` |
| ancestry（提交 E 前） | `origin/main` 是 S 的祖先；S 不是 `origin/main` 的祖先，具备本地 fast-forward 关系 |
| Worktree | 保留既有未跟踪审计报告、素材、计划；本轮未读取、删除或暂存它们 |
| 产品版本 | `0.54.47` |
| 私有安装包 | `E:\AgentData\Codex\worktrees\e9b3\010-Token eye\src-tauri\target\release\bundle\nsis\Token Eyes_0.54.47_x64-setup.exe` |
| 安装包 SHA-256 | `082a6d474059c0b215a793de12ed558d7272e66d2cc74345b4c41a554b7480ae` |
| build provenance | `src-tauri/target/release/bundle/local-release-metadata-5b37bf90/build-provenance-v0.54.47.json`；`version=0.54.47`、`head_sha=S`、artifact SHA 与安装包一致、`run_id=local`、`run_url=null` |
| checksums | `src-tauri/target/release/bundle/local-release-metadata-5b37bf90/checksums-v0.54.47.txt`；安装包 SHA 与 provenance/实际文件逐项一致 |
| bundle manifest | `src-tauri/EmbeddedServer-0.54.47/runtime-manifest.json`；`app_version=0.54.47`、`head_sha=S`、`built_at_utc=2026-08-21T01:01:07.9421011Z` |
| installed manifest | 隔离安装时读取 `<temp>\app\EmbeddedServer-0.54.47\runtime-manifest.json`；`app_version=0.54.47`、`head_sha=S`，并验证 bundled runtime/local API 可启动；临时安装目录和 installer 注册表随后已恢复/清理 |

已闭环：S → build provenance/checksums → bundle manifest → isolated installed manifest。Data Sources/诊断页的 build-info API 已进入本地自动化；本轮第一审聚焦用户报告的 Codex OAuth 按钮链，而非将其替代为一般诊断页截图。

## 3. 自动化验收证据

| 层 | 精确命令 | 结果 | 边界 |
|---|---|---:|---|
| Task 11 exact | `node --test test/test-discovery-contract.test.js test/token-plan-catalog.test.js test/token-eyes-codex-auth-contract.test.js test/npm-publish-workflow.test.js test/release-windows-workflow.test.js test/windows-build-script-safety.test.js test/windows-release-metadata.test.js` | 107/107 pass | 合同与 workflow 静态/合成验证 |
| Root canonical | `npm test` | 2313 total / 2305 pass / 0 fail / 8 skip | skip 不计作通过 |
| Dashboard | `npm --prefix dashboard run test` | 155 files / 1620 tests pass | DOM 自动化不替代安装版 UI |
| Local canonical CI（S fresh） | `npm run ci:local` | exit 0；Dashboard 155 files / 1623 tests pass | agents、lint、typecheck、Dashboard test/build、data policy、root tests、copy/hardcode/architecture guards 全链 |
| Rust full（S fresh） | `$env:TAURI_CONFIG='{"bundle":{"resources":[]}}'; cargo test --manifest-path src-tauri/Cargo.toml; Remove-Item Env:TAURI_CONFIG` | 321/321 pass | 测试模式清空 resources；随后另执行真实 NSIS isolated install/runtime smoke |
| 隔离 installer/runtime smoke（S） | `TOKEN_EYES_ISOLATED_INSTALLER_SMOKE=1 node --test test/windows-installed-runtime-smoke.test.cjs` | 3/3 pass | 实际 NSIS 临时安装、读取 installed manifest、启动版本化 runtime、恢复 installer 注册表 |
| 第一审：安装版 OAuth UI（S） | `TOKEN_EYES_PACKAGED_CODEX_UI=1 node --test --test-name-pattern 'final installed Codex buttons' test/windows-packaged-codex-ui.test.cjs` | 1/1 pass；内部两次独立 pass | 实际安装、真实系统鼠标和 Chrome 前台；证据目录为 `src-tauri/target/private-acceptance/codex-ui/`（构建输出，不纳入 Git） |
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
| AUTH-01 | `persists awaiting -> awaiting -> authorized across every Codex polling round`：旧流程提前清 pending 并让 `session_not_found` 覆盖真实原因 | Codex Node 65/65；Codex Rust 82/82；TokenPlan UI 120/120。fake app-server 与临时 account dir 验证逐轮持久化、browser-open failure cancel+reconcile | S/artifact 已绑定；真实 OAuth 成功、旧失败重试、取消/超时恢复仍需第二审 | partial |
| AUTH-02 | `acknowledged_cancel_allows_the_same_client_to_start_the_next_login`：旧 direct listener 无法可靠取消/复用 | Node/Rust/UI 同上；`codex_oauth.rs` 已移除，listener/固定端口路径不再进入生产；cancel ack 后同 client 可再次登录 | 第一审已验证 delete/reload/restart 未连接；“取消后立即重试”仍未在安装版实点 | partial |
| AUTH-03 | `Codex authorized without quota remains connected with a retryable sync error`：旧实现把授权和额度同步耦合 | fake `account/read` + rate-limit failure；授权保持 connected，额度错误独立可重试；Node 65/65、Rust 82/82、UI 120/120 | S/artifact 已绑定；授权成功但额度网络失败必须在第二审验证 | partial |
| UX-01 | `shows a five-minute Codex waiting panel with safe reopen, cancel, diagnostics, and link semantics` | fake timers/DOM 锁 5 分钟、reopen/cancel/诊断、`role=status/alert`、`aria-live`、focus；copy/hardcode/typecheck/build 已进 `ci:local` | 第一审截图已见等待授权与倒计时；键盘/a11y/取消恢复仍未实点 | partial |
| DATA-01 | `DATA-01 refresh adapter treats fresh 100/0 and 0/100 as authoritative reports`：旧 50 覆盖合法 0 | console/refresh/local API 166/166；临时记录锁 absent/null/0、非法数值、expiry 五态与 provider-owned 字段 | S/artifact 已绑定；安装版 `used=0`、`remaining=0` 尚未实点 | code done |
| DATA-02 | `DATA-02 GLM live weekly window exclusively owns the top-level quota triple`；legacy migration 必须有 paired evidence | Task 6 七文件当前 213/213；固定 reviewed URL/SHA，hash 漂移返回 `manual_evidence_required`；static entitlement 与 live token window 分层 | S/artifact 已绑定；安装版未验 | code done |
| DATA-03 | `DATA-03 treats interval and weekly usage_count as consumed and saturates overage` | Task 6 213/213；合成 overage/negative/type drift；parser→refresh→local 四层均 `provider_count`，无 token 换算 | S/artifact 已绑定；安装版未验 | code done |
| DATA-04 | `pricing hard max: stale catalog evidence is retained but cost is null`；mixed provenance API RED | pricing Node 135/135、Dashboard 120/120；30 天 ±1ms、user override、stale=null、priced+unpriced=`partial/mixed/components`；独立复审 46/46 + 114/114 | S/artifact 已绑定；安装版成本来源标签未实点 | code done |
| DATA-05 | GLM source hash drift 与 market TTL/promotion expiry RED | Task 6 213/213；Task 10 catalog focused/组合通过；invalid clock、TTL ±1ms、hash replay、过期促销 fail closed | live 来源巡检未运行；安装版 stale/unverified 未实点 | code done |
| DATA-06 | Xiaomi missing credit 被伪 0；ZCode host-derived key/未核 endpoint 会假支持 | Xiaomi/ZCode Node 196/196、Dashboard 170/170、Rust Xiaomi 38/38；ZCode 在 fixture 缺失时 0 credential-file probe / 0 network 并诚实 unsupported | Xiaomi 真实 Windows 测试账号与安装版未验；ZCode 缺固定 endpoint/response/credential-reader/source hash | Xiaomi code done；ZCode full support blocked |
| DATA-07 | aggregate Codex network error 不一致；Cursor Auto/API/team/overall 被平均或伪造 headline | Node scoped 145 pass/1 platform skip、Dashboard 131/131、Rust Codex 82/82、Cursor 46/46；401/403/404/5xx/network 与 forged DTO fixtures | S/artifact 已绑定；安装版独立 lane/错误态未实点 | code done |
| ID-01 | `Token Plan GET migrates only exact kiro-cli source records...` | Task 7 current 379 pass/1 platform skip；canonical projection；只迁精确 Token Plan source，不迁 queue/model/path | isolated installed runtime 已包含 canonical registry；完整 UI 场景未实点 | partial |
| ID-02 | `Copilot vendor families remain distinct across market, agent, and capability registries` | market-only `microsoft-copilot`，GitHub `copilot` usage/history 保持；Task 7 与 PlanMarket 自动化通过 | S/artifact 已绑定；安装版市场/额度分离未实点 | code done |
| ID-03 | `canonical agent registry owns exactly 28 adapters and 27 usage identities` | `agents:check` exit 0；28 adapters/27 identities；Limits renderer 面 16，Token Plan 27，互不混层；Dashboard 1620/1620 | isolated installed runtime 已验证 canonical registry；完整 UI 场景未实点 | partial |
| ID-04 | Windows `auth.db` 无 fixed Credential Manager target/blob；旧实现 plaintext-first/身份重读 | secure-first 候选与仅 401/403 fallback；auth.db-only=`configured:true + secure_store_unsupported`，0猜测reader/0真实凭据 | 缺固定上游 Credential Manager fixture 与安装版验证 | fail-closed code done；full secure read blocked |
| SEC-01 | `safe outbound rejects private A, private AAAA, and mixed public/private DNS` | custom/provider/Cursor 239/239；合成 Bearer + injected DNS/request；HTTPS、全 A/AAAA、pin、redirect、cap、exact redaction，0真实 token | S/artifact 已绑定；安装 runtime 安全场景未实点 | code done |
| SEC-02 | `config_writer_creates_top_level_keyring_setting`；旧 per-plan `auth.json` 所有权错误 | 临时 config 锁 keyring hard-fail、官方 app-server；只操作精确 synthetic legacy path，不接真实 keyring/账号 | 两个隔离 `CODEX_HOME`/不同测试账号、重启 `account/read`、fresh 全程无 `auth.json`、用户授权 legacy cleanup 均未做 | blocked |
| SEC-03 | atomic credential writer 与 persist-failure fresh quota RED | Task 9 102 total/101 pass/1 platform skip；synthetic Kimi/Gemini、symlink/inode/ACL/failure；真实 Windows restricted DACL replace；无真实凭据 | S/artifact 已绑定；安装版负向场景未验 | code done |
| SEC-04 | Cursor 302 跨源会复用 Cookie；CSV/summary 无 cap | custom/provider/Cursor 239/239；合成 Cookie/mock HTTPS；只允许一次相对同源 redirect，跨源/伪域/跨端口/downgrade 0 二跳，body cap+脱敏 | S/artifact 已绑定；安装 runtime 安全场景未实点 | code done |
| LINK-01 | Volcengine 旧购买 claim 无当前证据；promotion freshness 只在构建时计算 | Task 10 A focused/组合通过；旧 Volc claim 清零并标 stale/unverified；offline fixture 分类通过 | scheduled/live checker 未运行；真实浏览器/安装版未验 | code done（诚实降级） |
| LINK-02 | 任意 URL opener、第三方未披露、redirect secret/report 泄漏 | provider-links 单一 authority；Task 10 fixture 8 classification / 10 policy / 1 valid registry / 7 invalid / 3 report / 10 secret；0 live network；Rust link_id 与 Dashboard自动链通过 | S/artifact 已绑定；Windows 安装版鼠标/Enter 各打开系统浏览器未实点 | code done |
| CI-01 | root glob 漏 co-located test；`ci:local` 漏 Dashboard；workflow 合同可被 OR/额外门绕过 | Task 11 exact 107/107；root 0 fail；Dashboard 1620；`ci:local` exit 0；unique owner/10 子门/AND opt-in/canonical+Rust only；Task 11A review PASS | 尚无修复 commit/push 对应的远端 CI run | code done；remote CI pending |
| REL-01 | 旧版本没有修复级 SHA artifact；同版本可覆盖；MSI/NSIS/tag/provenance 门不完整 | build identity、manifest/build-info、metadata/checksum、MSI/NSIS 独立 guard、tag→`github.sha`、private artifact、publish/upload/no-clobber；Task 11B/C reviews PASS | 本轮 0.54.47 私有 NSIS 已从 S 构建、SHA/provenance/checksum/installed manifest 一致；第一审已实点，第二审真实 OAuth 仍 blocked；未发布 | partial：artifact/source 与第一审 verified；真实 OAuth/额度第二审 blocked |

## 5. 本轮 0.54.47 安装版两次独立验收

### 5.1 第一审 — verified（未登录、隔离安装）

- 使用上述精确 SHA 的 NSIS 安装包在临时隔离目录进行两次独立安装/启动，不覆盖当前 Token Eyes；每次结束均恢复安装器注册表并清理临时目录。
- 两次均明确不提供 `codex.exe` / `codex.cmd`；测试记录 `codex_cli_available=false`。
- 使用真实系统鼠标点击“连接并同步”，Chrome 成为前台，`127.0.0.1:1455` 回调监听存在，安装版页面显示“等待 OpenAI 官方授权”和五分钟倒计时。
- 真实点击“删除连接”后，立即 reload 与退出重启均回到未连接的连接入口；不会再显示“已连接”。
- 本轮截图已复看：`pass-1-after-sync.png` 显示等待授权，`pass-1-after-delete-restart.png` 显示删除后的未连接表单。截图与 `result.json` 位于 `src-tauri/target/private-acceptance/codex-ui/`，是 ignored build evidence，不纳入本提交。

### 5.2 第二审 — blocked（真实 OAuth 成功链）

本轮没有用户本人参与 OpenAI OAuth，也没有提供明确获授权的隔离测试账号。因此**没有**执行或声称执行以下动作：真实授权成功、页面显示“已连接”、真实额度同步结果、删除后真实授权状态的 reload/restart 回归。没有读取、记录账号标识、token、Cookie 或 OAuth 页面秘密。

第二审只能在用户本人或明确获授权的隔离测试账号到位后，使用**同一个 SHA 为 `082a6d...80ae` 的安装包**在全新隔离配置中完成；在此之前状态为 `blocked`，不能据此宣称完整安装版验收通过或具备最终合并条件。

## 6. 四层 Definition of Done

| 层 | 当前证据 | 状态 |
|---|---|---|
| Contract/unit | 每个 ID 有可追溯 RED→GREEN；root、Dashboard、Rust 全门通过 | 完成 |
| Integration/security | local API、Rust、app-server、DNS/redirect/body、credential file 等均使用合成 fixture；未接触真实秘密 | 完成（上游 fixture 门除外） |
| Packaged UI | 第一审已在精确 0.54.47 安装包验证浏览器启动、1455、等待授权、删除/reload/restart；真实 OAuth、成功额度与其他 provider 场景仍未验 | partial |
| Artifact/source | S→provenance/checksum→bundle manifest→isolated installed manifest 已逐项一致；E 只记录验收，不是安装包源码身份 | verified（artifact/source） |

## 7. 仍需的授权/外部证据

继续 Task 12 前需要用户明确授权以下操作与输入：

1. 用户本人或明确获授权的隔离测试账号完成第二审的真实 OpenAI OAuth；如涉及两个账号，报告只写 `identities_distinct`，不记录 email、ID、token。
2. legacy `<account_dir>/auth.json` cleanup 仍必须逐个精确路径单独确认；不得 broad clean。
3. Xiaomi 真实 Windows 账号、ZCode 固定 endpoint/response/credential-reader/source hash、Windows Credential Manager 固定 target/blob fixture 仍分别是外部 fixture/授权门。
4. 安装版的其他用户可见场景（0/满额、来源披露、Kiro/Copilot、外链鼠标/键盘）未因本轮 Codex OAuth 第一审而自动验证。
5. 远端 CI 必须在将来 push 后实际运行并通过；在此之前不得声称最终合并条件成立。
6. 公开发布仍须在完整私有验收后另行授权；本轮不创建 tag/Release，不发布 npm/GitHub asset。

## 8. 本轮未执行事项

- 未升级版本（保持 `0.54.47`）。
- 未 push、merge、tag、GitHub Release、公开发布或 npm publish。
- 未覆盖当前 Token Eyes 安装；仅使用临时隔离安装并在检查后清理。
- 未读取真实 credential、token、Cookie、账号 identity。
- 未执行 live external-link crawl。
- 未完成第二审的真实 OAuth 成功与额度同步。
