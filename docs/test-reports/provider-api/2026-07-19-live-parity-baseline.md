# Provider live parity baseline — 2026-07-19

Worktree: `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`  
Branch: `codex/token-eyes-provider-api`  
Captured: 2026-07-19 (local)

This report freezes the **pre-fix failure baseline** for cost MoM, compact spend cards, Cursor multi-account quota, and TRAE OAuth/quota. Live Token Eyes EXE values were **not** re-sampled in this session (no running install / no reachable EXE on this machine). Cockpit Tools screenshot values are treated as the ground-truth expected side. Token Eyes cells that could not be read live are marked `未采集(安装版不可达)` — **not invented**.

---

## 1. Automated test command results

| Command | Exit code | Summary |
|---|---:|---|
| `npm test -- --runInBand` | **1** | `# tests 1548` / `# pass 1494` / `# fail 52` / `# skipped 2` / `duration_ms ~64213` |
| `npm --prefix dashboard test -- --run` | **0** | `Test Files 95 passed` / `Tests 832 passed` / `Duration 26.86s` |
| `cargo test --manifest-path src-tauri/Cargo.toml cursor_session -- --nocapture` | **101** | Did **not** run unit tests: integration targets failed to compile (`cc_switch_lib`, `toml`, `tokio`, `futures` unresolved in `src-tauri/tests/*`) |
| `cargo test --manifest-path src-tauri/Cargo.toml trae_session -- --nocapture` | **101** | Same compile failure pattern as above; filter never reached `trae_session` unit tests |

### 1.1 Supplemental (not a substitute for the mandated commands)

These were run only to clarify whether the filtered **lib** units themselves are green while the mandated cargo filter is red:

| Supplemental command | Exit code | Result |
|---|---:|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib cursor_session -- --nocapture` | 0 | 28 passed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib trae_session -- --nocapture` | 0 | 10 passed |

**Baseline interpretation:** mandated `cargo test … cursor_session|trae_session` is currently **unforgeably failing at compile time** due to orphan / unresolved `cc_switch_lib` integration tests in this worktree. Lib unit tests for those modules pass when isolated with `--lib`.

### 1.2 `npm test` failures (52) — names

**Workflow / release files missing under `.github/workflows/` (50):**

- `npm-publish workflow file exists` (+ 10 more `npm-publish` workflow contract tests)
- `release-dmg workflow file exists` (+ 21 more `release-dmg` workflow contract tests)
- `release-windows workflow file exists` (+ 13 more `release-windows` workflow contract tests)
- `release-windows is callable as a reusable workflow`
- `release-dmg invokes release-windows so one dispatch ships both platforms`
- `macOS + Windows build in parallel off a shared create-release job`

Observed error shape: `ENOENT: …\.worktrees\provider-api\.github\workflows\release-windows.yml` (and `release-dmg.yml` / publish workflow). Worktree `.github` retains templates / dependabot / CODEOWNERS but **not** the release/publish workflow YAML files.

**Provider stats (2):**

- `provider-stats returns providers sorted by tokens descending` — `test/provider-model-stats.test.js` — expected 2 providers, actual 4 (`4 !== 2`)
- `provider-stats and model-stats return empty arrays for empty queue` — same file — expected `[]`, actual non-empty provider rows including `collection_status: 'connected_no_precise_tokens'`

Raw logs (local, not committed):  
`docs/test-reports/provider-api/_npm-test-baseline.log`  
`docs/test-reports/provider-api/_dashboard-test-baseline.log`  
`docs/test-reports/provider-api/_cargo-cursor-baseline.log`  
`docs/test-reports/provider-api/_cargo-trae-baseline.log`

---

## 2. Live parity table (four scenarios)

| 场景 | Token Eyes 实际值 | Cockpit/原始接口值 | 是否一致 | 原始证据 |
|---|---:|---:|---|---|
| 成本环比口径（本月 vs 上月） | 未采集(安装版不可达) | 应用「本月至今 vs 上月同期」；当前代码为本月完整自然月 vs 上月完整自然月 | 否（代码口径） | `date-range.ts` / `use-cost-accumulation.js`；见 §3.1。示例 (Asia/Shanghai, 2026-07-19): current `2026-07-01…2026-07-31`, previous `2026-06-01…2026-06-30` |
| 自定义花销卡片金额可读性 @1280/1440/1920 | 未采集(安装版不可达)（无 Playwright/安装版截图） | 金额完整可读（验收目标） | 否（CSS 证据） | `CostAccumulation.jsx` L193–208：`lg:grid-cols-4` + 卡内 `grid-cols-3` + 金额外层 `truncate`；见 §3.2 |
| Cursor 账号 A Total Usage（`evelynwatt3779@h…` / auth0 `…MKZ2XX`） | 未采集(安装版不可达) | **27%**（另：Auto+Composer 20%，API 72%，配额 $20/$20，重置 2026/08/06 22:31） | 否 | Cockpit 截图 §4.1；计划 §1.3 记 UI 仍显示 0。解析代码见 §3.3 |
| Cursor 账号 B Total Usage（`shelmain01@g…` / google-oauth2 `…FGF3D`） | 未采集(安装版不可达) | **6%**（另：Auto+Composer 1%，API 39%，配额 $20/$20，重置 2026/08/13 17:08） | 否 | Cockpit 截图 §4.1 |
| Cursor 账号 C Total Usage（`muxunson@g…` / github `…XVSF`，FREE） | 未采集(安装版不可达) | **0%**（配额 $0/$0） | 未对照（Cockpit 本身为 0） | Cockpit 截图 §4.1（第三张卡；非本次双账号硬验收主路径） |
| Cursor OAuth URL 形态 | 未采集(安装版不可达) | `https://cursor.com/loginDeepControl?challenge=…`；有效期 300s；轮询 2s | 代码方向一致 / 实时未证 | Cockpit 截图 §4.2；`cursor_session.rs` `LOGIN_URL` / `POLL_URL` |
| TRAE 剩余次数（Muxunson / 用户 ID `…6825`） | 未采集(安装版不可达) | **75** 次（速通 Pro，进度约 25%，重置 2026/08/01 00:03） | 否 | Cockpit 截图 §4.3；计划 §1.3 记 UI 仍显示 0 |
| TRAE OAuth 授权链接 host | 未采集(安装版不可达) | `https://www.trae.cn/authorization?login_version=1&auth_from=trae&…` | 否（缺陷路径） | Cockpit 截图 §4.4；代码可拼出 `https://api.trae.cn/authorization` — 见 §3.4 |

Privacy: full emails / tokens / cookies / JWTs redacted. Stable tails kept for account matching only.

---

## 3. Code inspection findings

### 3.1 Cost page MoM — formula and range mismatch

**Formula** (`CostAccumulation.jsx` `getMonthComparison`):

```text
percentage = abs((current - previous) / previous) × 100   // when previous ≠ 0
```

Direction copy: increase / decrease / flat / “new amount” when previous is 0. Increase and decrease both use green styling.

**Range generation** (`date-range.ts` `getMonthComparisonRanges`):

- `current` = `getRangeForPeriod("month")` → first…last day of **current calendar month**
- `previous` = first…last day of **previous calendar month** (full month)

Computed for `now = 2026-07-19T12:30:00+08:00`, `timeZone = Asia/Shanghai`:

```json
{
  "current":  { "from": "2026-07-01", "to": "2026-07-31" },
  "previous": { "from": "2026-06-01", "to": "2026-06-30" }
}
```

**Defect:** with no future data, “current” is effectively month-to-date while “previous” is a **full** prior month. That is **not** same-elapsed-period comparison (plan Task 2 requires month-to-date vs same day last month, e.g. 2026-07-01…19 vs 2026-06-01…19).

**Hook wiring** (`use-cost-accumulation.js`):

- Spend records use SpendPage filter `from`/`to`
- MoM timeseries **ignores** the filter and always calls `getSpendTimeseries` with `getMonthComparisonRanges().current|previous`

Live Token Eyes MoM percentages (e.g. reported `401.9%` / `405.8%` in the plan) were **not** re-verified against ledger rows in this capture → marked 未采集; the **range asymmetry alone** is sufficient to mark口径 inconsistent.

### 3.2 Custom spend cards — truncate / grid at 1280 / 1440 / 1920

`OtherAiGroupCostSection` (`CostAccumulation.jsx` ~193–208):

- Outer grid: `grid grid-cols-2 gap-1.5 lg:grid-cols-4` (`lg` = viewport ≥1024px)
- Inner metrics: `grid grid-cols-3`
- Group name: `truncate`
- **Amount wrapper:** `truncate text-[11px] font-semibold` around `formatDualAmount` (USD + CNY flex column)

**Why this fails visual acceptance without needing a screenshot:**

1. `truncate` ⇒ `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on a container that holds a multi-line dual-currency block → amounts clip instead of wrapping.
2. Four outer columns × three inner metric columns leaves very little horizontal room per amount at 1280-class widths.
3. Visual evidence gap: Playwright / installed-app screenshots at 1280/1440/1920 were **not** captured in this session (`未采集`).

### 3.3 Cursor — multi-account + usage vs Cockpit

**Cockpit ground truth (screenshot §4.1):** three accounts; hard acceptance pair is A=27% / B=6%.

**Code evidence of remaining risk / failure modes:**

1. **Singular OAuth pending slot:** `CursorSessionState.active_session_ref: Option<String>` — only one in-flight login identity in process state (per-account dirs under `cursor-accounts/{suffix}` exist, but concurrent/multi bind UX is not proven live).
2. **Quota fetch path:** Rust `fetch_cursor_quota` → `GET https://cursor.com/api/usage-summary` with `WorkosCursorSessionToken=…` cookie + browser UA. WebView script also same-origin fetches `/api/usage-summary`.
3. **Parser** (`parse_cursor_usage_summary`) already has unit coverage for `totalPercentUsed`, `totalSpend` / `total_spend`, and stale-zero fallbacks (`--lib` 28 tests green). That proves **fixture JSON** parsing, **not** live multi-account Token Eyes UI parity.
4. **Live gap:** installed Token Eyes values for accounts A/B were not readable here → `未采集(安装版不可达)`. Plan §1.3 still records UI showing `0` against Cockpit non-zero — kept as historical observation only, not re-measured.

OAuth URL direction matches Cockpit (`loginDeepControl` + challenge); polling target `https://api2.cursor.sh/auth/poll`. Live success for two simultaneous bound accounts remains unproven.

### 3.4 TRAE — host rewriting / `/authorization` bug

**Cockpit success URL host:** `https://www.trae.cn/authorization?...` (screenshot §4.4).

**Token Eyes construction** (`trae_session.rs`):

```text
resolve_login_guidance_host()  // may return LoginHost from GetLoginGuidance
  → build_authorization_url(login_host, …)
      Url::parse(login_host)
      set_path("/authorization")   // forces path; does NOT rewrite api.* → www.*
```

If guidance (or callback `loginHost`) yields `https://api.trae.cn`, the opened URL becomes:

```text
https://api.trae.cn/authorization?...
```

which is the documented wrong host (plan §1.3: “No hard-coded `https://api.trae.cn/authorization` remains” is an acceptance criterion for the **fix**, implying the failure mode exists). Unit test `accepts_auth_code_info_callback_without_state` even asserts callback `login_host == https://api.trae.cn` without rewriting to `www.trae.cn`.

Default fallback host is correctly `https://www.trae.cn`, but guidance/callback API hosts are not normalized to the www authorization origin.

**Quota:** `normalize_quota` + `QUOTA_PATHS` (`ide_user_ent_usage` v2/v1, entitlement list). Lib unit tests pass; live remaining **75** vs Token Eyes display was not re-sampled → `未采集(安装版不可达)`.

---

## 4. Cockpit screenshot paths used

| ID | Path | Content |
|---|---|---|
| §4.1 | `C:\Users\admin\AppData\Local\Temp\codex-clipboard-7c802e62-eaa3-47e6-a4db-fbe1548a734f.png` | Cursor multi-account overview — Total Usage 27% / 6% / 0% |
| §4.2 | `C:\Users\admin\AppData\Local\Temp\codex-clipboard-b78054ee-2bae-44f5-98c6-f4512b4313d2.png` | Cursor OAuth modal — `loginDeepControl?challenge=…` |
| §4.3 | `C:\Users\admin\AppData\Local\Temp\codex-clipboard-2a41817b-eeaf-4828-839d-716fab6f825e.png` | TRAE CN quota — 速通可用 **75** 次 / 25% |
| §4.4 | `C:\Users\admin\AppData\Local\Temp\codex-clipboard-353ed59c-fc96-4991-9698-edf86b2d0201.png` | TRAE OAuth — `https://www.trae.cn/authorization?...` |

Reference plan: `docs/superpowers/plans/2026-07-19-cost-cards-cursor-trae-live-parity.md` (main worktree copy; Task 1).  
Design note: `docs/superpowers/specs/2026-07-19-live-quota-corrections-design.md`.

---

## 5. Gaps / non-claims

1. Installed Token Eyes EXE was **not** running and was **not** launched from this baseline task → all Token Eyes numeric cells are `未采集(安装版不可达)`.
2. No local queue/API ledger reconciliation was performed for MoM percentages.
3. No viewport screenshots at 1280/1440/1920 — truncate defect is CSS-proven only.
4. Mandated cargo filter commands fail before tests run; `--lib` greens are diagnostic only and must not be treated as live parity proof.
5. Do not treat green fixture unit tests (`totalSpend` / TRAE URL builder with `www.trae.cn`) as proof that the installed app matches Cockpit for the user’s accounts.

---

## 6. Baseline verdict

| Area | Baseline status |
|---|---|
| Automated suite | Root npm **fail 52**; dashboard vitest **pass**; mandated cargo cursor/trae filters **exit 101** (compile) |
| MoM | Range asymmetry confirmed in code |
| Compact cards | `truncate` on amount container confirmed in code |
| Cursor live | Cockpit A/B = 27%/6%; Token Eyes live **未采集** |
| TRAE live | Cockpit remaining = 75; OAuth host must be `www.trae.cn`; Token Eyes live **未采集**; `api.trae.cn` + `/authorization` rewrite path confirmed in code |

This baseline is intentionally **red** on the live-parity dimensions until later tasks produce measurable Token Eyes values that match Cockpit.
