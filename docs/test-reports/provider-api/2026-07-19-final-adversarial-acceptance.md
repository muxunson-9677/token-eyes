# Final adversarial acceptance — cost MoM / spend cards / Cursor / TRAE

Date: 2026-07-19  
Branch: `codex/token-eyes-provider-api`  
Worktree: `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`  
HEAD at verification start: `76efa952` (Task 5) + local uncommitted tree used for installer build  

**Status: DONE_WITH_CONCERNS**

Installer cover-install and automated suites were executed. **Cursor dual-account live Cockpit parity** and **TRAE interactive OAuth + quota vs Cockpit** remain **未完成** (no qualifying live screenshot / redacted successful usage evidence). MoM ledger math was re-fetched from the installed EXE local API; **Spend UI percentages do not match the audited delta formula**.

Active plan doc (main checkout, not present in this worktree before Task 6):  
`docs/superpowers/plans/2026-07-19-cost-cards-cursor-trae-live-parity.md`  
Work-order file in this worktree: `任务工单.md` (updated with Task 6 status only).

---

## 1. Automated test summary

| Command | Exit | Result |
|---|---:|---|
| `npm test` | **1** | `# tests 1548` / `# pass 1493` / `# fail 53` / `# skipped 2` |
| `npm --prefix dashboard test -- --run` | **0** | `Test Files 95 passed` / `Tests 843 passed` |
| `npm --prefix dashboard run build` | **0** | Vite production build OK (~6s) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture` | **0** | **178 passed; 0 failed** (includes `cursor_session` + `trae_session`) |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` | **101** | Integration targets fail to compile (baseline orphan `cc_switch_lib` / `toml`) — lib suite still green |

Logs (local, not committed):  
`docs/test-reports/provider-api/_task6-npm-test.log`  
`docs/test-reports/provider-api/_task6-dashboard-test.log`  
`docs/test-reports/provider-api/_task6-cargo-lib.log`  
`docs/test-reports/provider-api/_task6-cargo-full.log`

### 1.1 `npm test` failures (53) — named, not “ignored”

**Baseline (Task 1) had 52 failures.** Task 6 has **53** = baseline 52 + **1 new**.

#### A. Workflow ENOENT (50) — same class as baseline

Missing under `.worktrees/provider-api/.github/workflows/`:

- `npm-publish workflow file exists` (+ 10 sibling publish-contract tests)
- `release-dmg workflow file exists` (+ 21 sibling dmg-contract tests)
- `release-windows workflow file exists` (+ 13 sibling windows-contract tests)
- `release-windows is callable as a reusable workflow`
- `release-dmg invokes release-windows so one dispatch ships both platforms`
- `macOS + Windows build in parallel off a shared create-release job`

Error shape: `ENOENT: …\.github\workflows\release-windows.yml` (and siblings). Baseline evidence: `docs/test-reports/provider-api/2026-07-19-live-parity-baseline.md` §1.2 / `_npm-test-baseline.log`.

#### B. Provider-stats (2) — same as baseline

- `provider-stats returns providers sorted by tokens descending` — `test/provider-model-stats.test.js`
- `provider-stats and model-stats return empty arrays for empty queue` — same file

#### C. **New vs baseline (1)**

- `workspace and cards expose the approved layered surface hierarchy` — `test/dashboard-layout-adjustments.test.js:235`  
  Assertion: `expected cost cards to use the shared depth rhythm`  
  **Not present in `_npm-test-baseline.log`.** Likely collateral from Task 3 compact-card CSS changes. Recorded here; not waived.

### 1.2 Full `cargo test` compile failures (baseline)

These integration crates fail to compile (unresolved `cc_switch_lib` / `toml`), matching Task 1 baseline:

`app_config_load`, `app_type_parse`, `deeplink_import`, `hermes_roundtrip`, `import_export_sync`, `mcp_commands`, `provider_commands`, `provider_service`, `proxy_commands`, `skill_sync`, `support`

---

## 2. Installer

| Item | Path / value |
|---|---|
| NSIS (required) | `src-tauri\target\release\bundle\nsis\Token Eyes_0.54.6_x64-setup.exe` |
| Built at | 2026-07-19 20:27:50 (local) |
| Size | 37,685,692 bytes |
| SHA256 | `846C4BCF3C8C87B7FB47410F867E33895DE28B1E29651552F4078A8F6D2A4863` |
| MSI (also produced earlier) | `src-tauri\target\release\bundle\msi\Token Eyes_0.54.6_x64_en-US.msi` |

Build notes:

1. First `npm run tauri:build` produced **MSI only** (`Finished 1 bundle` → msi). Stale NSIS from 18:30 remained.
2. Forced `npx @tauri-apps/cli@2.11.3 build --bundles nsis` with `makensis` on PATH → fresh NSIS at 20:27:50.
3. Cover-install: stopped pid 30920, ran installer with `/S`, exit 0.
4. Installed EXE: `E:\Users\admin\AppData\Local\Token Eyes\token-eyes.exe` — Length `17384448`, LastWriteTime `2026-07-19 20:27:16` (replaced prior `17213952` / 18:29).

---

## 3. Requirement-by-requirement evidence

### R1 — MoM 本月至今 vs 上月同期 + ledger reconciliation vs UI

| Field | Value |
|---|---|
| 要求 | 环比区间为「本月至今 vs 上月同期」；显示值可由原始账本证明 |
| 改动文件 | Task 2: `dashboard/src/lib/date-range.ts`, `CostAccumulation.jsx`, `use-cost-accumulation.js` (+ report `2026-07-19-month-comparison-reconciliation.md`) |
| 自动测试 | `date-range` / CostAccumulation contract covered inside dashboard suite (843 passed). Full `npm test` still has baseline + 1 new failure (above). |
| 安装版操作步骤 | Cover-install → launch installed EXE → local API on `:7681` → Playwright `/spend/cost` + `/spend/usage` |
| Token Eyes 实际结果 | **Ledger (installed API, Asia/Shanghai):** current `2026-07-01…2026-07-19` combined `6749.666167` / api `6603.138389` / other `146.527778`; previous `2026-06-01…2026-06-19` combined `472.143724` / api `463.393724` / other `8.75`. **Delta MoM:** total **1329.6%**, api **1325.0%**, other **1574.6%**. **UI text:** `较上月新增 1422.0%` (API card), `较上月新增 1425.0%` (total card) — **does not match delta ledger**. 1425.0 numerically equals api **ratio** (`current/previous×100`), not `((c-p)/p)×100`. |
| Cockpit/原始数据对照 | Raw timeseries from installed local API (not Cockpit). Evidence JSON: `artifacts/final-acceptance/mom-post-install-redacted.json` |
| 截图路径 | `artifacts/final-acceptance/installed-spend-1440.png`, `installed-spend-usage.png`, text: `installed-spend-text-snippets.json` |
| 是否通过 | **未完成**（账本口径可审计；安装版 UI 百分比与 delta 公式不一致） |

### R2 — 成本总览卡 + 自定义花销金额完整可读

| Field | Value |
|---|---|
| 要求 | 总览卡与自定义花销金额在 1280/1440/1920 完整可读、无裁切 |
| 改动文件 | Task 3: `CostAccumulation.jsx` (+ `2026-07-19-cost-group-visual-acceptance.md`) |
| 自动测试 | Dashboard contract tests in suite; `node dashboard/scripts/verify-cost-group-layout.mjs` → PASS 1280/1440/1920 (fixture+built CSS) |
| 安装版操作步骤 | Playwright against installed `:7681/spend/cost`; also fixture screenshots copied |
| Token Eyes 实际结果 | Overview cards show full USD amounts (e.g. `USD 6,626.55`). **自定义花销分组** live text extracted as `当月花销: —` / `累计花销: —` (em dash), not numeric amounts — cannot claim readable spend figures on installed cost page. Fixture layout check still PASS. |
| Cockpit/原始数据对照 | `other_ai` spend-records exist (13 rows in July MTD) via local API; UI group cards still showed `—` |
| 截图路径 | Fixture: `artifacts/final-acceptance/cost-group-{1280,1440,1920}.png`. Installed: `installed-spend-cost.png` / spend-* (overview cards). |
| 是否通过 | **部分 / 未完成**（fixture 布局通过；安装版自定义花销金额未显示为可读数字） |

### R3 — Cursor 双账号独立 / 实时 / 刷新准确

| Field | Value |
|---|---|
| 要求 | ≥2 账号独立授权与刷新；用量与 Cockpit 同账号一致；失败不假 0+已连接 |
| 改动文件 | Task 4: `src-tauri/src/cursor_session.rs`, dashboard Cursor plan wiring, fixtures, `2026-07-19-cursor-live-parity.md` |
| 自动测试 | `cargo test --lib` → cursor tests included in **178 passed** |
| 安装版操作步骤 | Inspected `cursor-accounts/` (1 folder only); token-plans API; attempted `oauth/token` refresh + `usage-summary` |
| Token Eyes 实际结果 | App data: **one** `cursor-accounts/{uuid}/auth.json` (tokens present). Token plan `cursor` / `cursor_pro`: `sync_status=not_configured`, `used_quota=0`, **no `account_id` / session_ref**. Live refresh returned `access_token` but `usage-summary` → **401 not_authenticated**. Second account: **no local auth**. |
| Cockpit/原始数据对照 | No successful redacted usage-summary capture this session. Prior Task 4 live capture (account A ~29%) not reproduced after install. |
| 截图路径 | None proving Cursor Total/Auto/API vs Cockpit. Failure evidence: `artifacts/final-acceptance/cursor-account-a-usage-redacted.json` |
| 是否通过 | **未完成** |

### R4 — TRAE OAuth 无 404；额度 vs Cockpit

| Field | Value |
|---|---|
| 要求 | 授权 URL 不 404；回调成功；剩余次数/套餐/重置与 Cockpit 一致 |
| 改动文件 | Task 5: `src-tauri/src/trae_session.rs`, fixtures, dashboard Trae wiring, `2026-07-19-trae-live-parity.md` |
| 自动测试 | `cargo test --lib` includes trae tests (**178 passed**). Unit: browser origin `www.trae.cn/authorization`. |
| 安装版操作步骤 | Live `GetLoginGuidance` smoke; no `trae-accounts/`; token plan status; **human OAuth UI not completed** |
| Token Eyes 实际结果 | Guidance: `LoginHost=www.trae.cn` (`artifacts/final-acceptance/trae-login-guidance-redacted.json`). Plan `trae_cn_pro`: `sync_status=unsupported`, quotas 0, no account. **No interactive authorize → exchange → quota**. |
| Cockpit/原始数据对照 | Cockpit baseline remains 75 remaining / 速通 Pro (Task 1 screenshots). Not matched in Token Eyes this run. |
| 截图路径 | None for successful TRAE OAuth/quota in Token Eyes. |
| 是否通过 | **未完成**（guidance host unit+live smoke only） |

### R5 — 失败显示真实错误，非虚假 0/已连接

| Field | Value |
|---|---|
| 要求 | auth/usage/parse 失败保留真实错误，禁止假 connected+0 |
| 改动文件 | Cursor/TRAE session mapping (`sync_failed`, parse errors) from Tasks 4–5 |
| 自动测试 | Lib unit tests cover `sync_failed` / missing-field parse failures (passed under `--lib`) |
| 安装版操作步骤 | Observed token-plans + provider overview after install |
| Token Eyes 实际结果 | Cursor plan `not_configured` (not fake connected). TRAE plan `unsupported`. Overview provider chips still show some “已连接” copy for log-based sources without precise tokens — **separate from official OAuth quota path**; official Cursor/TRAE quota path was not successfully greenlit. |
| Cockpit/原始数据对照 | N/A for failure-path |
| 截图路径 | `artifacts/final-acceptance/installed-limits.png` (provider status chips) |
| 是否通过 | **部分**（官方套餐路径未伪造成功；完整失败态 UX 未对 Cursor/TRAE 实账号穷尽） |

### R6 — 覆盖安装正式 EXE 端到端复验完成

| Field | Value |
|---|---|
| 要求 | 使用新 NSIS 覆盖安装后的正式 EXE 完成真实账号 E2E |
| 改动文件 | Installer build only (this task) |
| 自动测试 | N/A |
| 安装版操作步骤 | `/S` cover-install; launch; API `:7681`; screenshots |
| Token Eyes 实际结果 | New EXE installed and running; MoM ledger + cost overview captured; **Cursor/TRAE live account E2E not completed** |
| Cockpit/原始数据对照 | Incomplete (see R3/R4) |
| 截图路径 | `artifacts/final-acceptance/installed-exe-main-window.png` |
| 是否通过 | **未完成** |

---

## 4. Human steps still required

1. **Cursor account A:** In installed Token Eyes → Token 套餐 → re-authorize Cursor (loginDeepControl) → refresh → compare Total / Auto+Composer / API to Cockpit for the same account; save screenshot under `artifacts/final-acceptance/`.
2. **Cursor account B:** Second independent authorize (do not overwrite A) → same Cockpit compare.
3. **TRAE:** Start OAuth from app → confirm browser URL `https://www.trae.cn/authorization?...` (no 404) → complete login → confirm remaining/plan/reset vs Cockpit (baseline 75 / 速通 Pro) → screenshot.
4. **MoM UI:** On `/spend/cost`, confirm cards show delta MoM matching `mom-post-install-redacted.json` (1329.6% / 1325.0% / 1574.6% at capture time) or document a new bug if UI stays at 1422/1425.
5. **自定义花销:** Confirm group cards show numeric 当月/累计 amounts (not `—`) at 1280/1440/1920.

---

## 5. Definition-of-done checklist (honest)

| Criterion | Status |
|---|---|
| MoM ranges = MTD vs same-period + ledger核账 | 账本 **是**；UI 对齐 **否** |
| 401.9%/405.8% recalculated or corrected | 旧口径已解释为全月对比≈401%；正确 delta≈1329%；**UI 仍显示 1422/1425** |
| Custom cards no truncation @1280/1440/1920 | Fixture **是**；安装版金额 `—` **否** |
| Cursor ≥2 accounts independent live | **否**（仅 1 个 auth 目录；usage 401） |
| Cursor vs Cockpit; failures not fake 0+connected | **否**（无成功对照） |
| TRAE OAuth + quota vs Cockpit | **否** |
| Auto tests / dashboard build / Rust lib | Dashboard+lib **是**；`npm test`/`cargo` full **基线失败仍在** |
| Cover-install EXE E2E | Install **是**；账号 E2E **否** |
| Final report with evidence | **本文件** |

---

## 6. Artifacts index (gitignored under `artifacts/`)

- `artifacts/final-acceptance/mom-post-install-redacted.json`
- `artifacts/final-acceptance/mom-ledger-redacted.json`
- `artifacts/final-acceptance/token-plans-redacted.json`
- `artifacts/final-acceptance/cursor-account-a-usage-redacted.json`
- `artifacts/final-acceptance/trae-login-guidance-redacted.json`
- `artifacts/final-acceptance/installed-*.png`
- `artifacts/final-acceptance/cost-group-*.png`
