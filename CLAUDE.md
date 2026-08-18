# CLAUDE.md

Guidance for Claude Code working in this repository. Every line here is loaded into every conversation turn — keep it lean and current.

## Token Eyes Windows note

For Token Eyes TE-NEXT/V01 work, Windows verification follows the Tauri stack: Rust toolchain + Node.js + WebView2 Runtime. Do not require `.NET SDK` or `.NET 8 SDK` as a Token Eyes prerequisite. Any legacy `TokenTrackerWin/` .NET wording below applies only to the older TokenTrackerWin packaging path, not to Token Eyes Tauri work orders.

## Project shape

Token Tracker is a local-first AI token usage tracker.

- **CLI** (`src/`, CommonJS, Node ≥20) — entry `bin/tracker.js` → `src/cli.js`. `serve` runs a local HTTP server on `:7680`, `sync` parses logs into `~/.tokentracker/queue.jsonl`.
- **Dashboard** (`dashboard/`, React 18 + Vite 7 + TS strict + Tailwind) — built to `dashboard/dist/`, served by the CLI locally and by Vercel at `www.tokentracker.cc`.
- **macOS app** (`TokenTrackerBar/`, Swift 5.9, XcodeGen) — menu bar + WidgetKit. `EmbeddedServer/` bundles the CLI runtime + built dashboard so the `.app` is self-contained.
- **Windows app** (`TokenTrackerWin/`, .NET 8 WinForms + WPF + WebView2) — system-tray counterpart of the macOS app. Launches the bundled CLI `serve` on a dynamic loopback port (avoids the DoSvc-held `:7680`), hosts the dashboard in WebView2, registers the `tokentracker://` deep-link for OAuth. Built `EmbeddedServer/` (Node + CLI + dashboard) is bundled by `scripts/bundle-node.ps1` so the `.exe` is self-contained. Dashboard adaptations are gated behind `isNativeWindowsApp()` (`dashboard/src/lib/native-bridge.js`) so macOS/web paths are untouched.

Data flow: AI CLI runs → hook fires → `rollout.js` parses → `queue.jsonl` → local API → dashboard.

For the canonical list of supported providers, grep `parse*Incremental` in `src/lib/rollout.js` — the source of truth, not this file.

## Frequently used commands

```bash
npm test                                  # node --test test/*.test.js  (97 files)
node --test test/<name>.test.js           # single test file
npm run ci:local                          # tests + validations + builds
npm run dashboard:dev                     # Vite dev server with local API mock (port 5173)
npm run dashboard:build                   # build to dashboard/dist/
npm run validate:copy                     # copy registry completeness
npm run validate:ui-hardcode              # no hardcoded UI strings
npm run validate:guardrails               # architecture guardrails
node bin/tracker.js serve --no-sync       # local dashboard server on :7680
```

`npm run dashboard:dev` skips the CLI backend; to verify `src/` changes use `node bin/tracker.js serve`.

## What's where

| Need to... | Look here |
|---|---|
| Add / modify a provider parser | `src/lib/rollout.js` — search `parse*Incremental` |
| Install / uninstall a provider hook | `src/lib/<provider>-hook.js` + register in `src/commands/init.js` + `uninstall.js` |
| Add a local API endpoint | `src/lib/local-api.js` — search `/functions/tokentracker-` |
| Wire a provider into sync | `src/commands/sync.js` (call site + totals aggregation) + `src/commands/status.js` (status reporting) |
| Add pricing for a model | `src/lib/pricing/curated-overrides.json` **+ the canonical edge block in `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`, copied verbatim into the other 4 edge files** (account-daily / account-summary / account-model-breakdown / leaderboard-profile). `test/edge-pricing-parity.test.js` fails on any drift. Deploy the touched edge functions after editing. |
| Add a dashboard page | `dashboard/src/pages/` (lazy-loaded via `React.lazy()` in `App.jsx` — **except `NativeAuthCallbackPage`, which must stay eager-imported**, see Lessons learned) |
| Add UI components | `dashboard/src/ui/dashboard/components/` |
| Add a provider icon | `dashboard/src/ui/dashboard/components/ProviderIcon.jsx` (`PROVIDER_ICON_MAP` keyed by `source.toUpperCase()`) |
| Add user-facing text | `dashboard/src/content/copy.csv` — never hardcode |
| Modify menu bar UI | `TokenTrackerBar/Services/` (controllers) + `Views/` (SwiftUI) |
| Bridge native ↔ web | `TokenTrackerBar/Services/NativeBridge.swift` + `dashboard/src/lib/native-bridge.js` |

## Load-bearing conventions

### Token normalization

```
input_tokens                  = non-cached input only (no cache reads/writes)
cached_input_tokens           = cache reads
cache_creation_input_tokens   = cache writes
reasoning_output_tokens       = reasoning tokens (Codex/every-code fold them into output_tokens for cost)
total_tokens                  = input + output + cache_creation + cache_read + reasoning_output (sum of all columns; Gemini-style rows that omit reasoning still pass invariants if you set the column to 0)
```

**Cost is computed from `input_tokens + output_tokens + cached_input_tokens + cache_creation_input_tokens + reasoning_output_tokens` only — never `total_tokens`** (`computeRowCost` in `src/lib/pricing/index.js`). If a new provider only fills `total_tokens` with input=0/output=0, the dashboard renders **$0 cost** regardless of pricing entries. Distribute the total across columns or extend `computeRowCost`.

### Queue entry

```json
{
  "hour_start": "2026-04-05T14:00:00Z",
  "source": "claude|codex|cursor|gemini|...",
  "model": "claude-opus-4-6|gpt-5.4|...",
  "input_tokens": 0, "output_tokens": 0,
  "cached_input_tokens": 0, "cache_creation_input_tokens": 0,
  "reasoning_output_tokens": 0,
  "total_tokens": 0, "conversation_count": 1
}
```

UTC, half-hour buckets, append-only — readers take the latest entry per `(source, model, hour_start)`.

### Project-wide

- **Repository boundary (hard rule)**: all agent/tool mutations for Token Eyes work must stay inside this repository root. Do not create, edit, delete, move, install, uninstall, update, launch, stop, or reconfigure files or software outside the repository, including CC Switch or any other independent application. Read-only inspection outside the repository is allowed only when needed for diagnosis. Any external mutation requires the user's explicit approval first.
- **Branch and worktree authority (hard rule)**: before any mutation, report and verify the exact worktree path, branch, HEAD, and status. Never create, switch, merge, rebase, delete, or push a branch/worktree unless the user has explicitly authorized that specific branch/worktree action. A UI implementation request, a request to commit/push, or a detached HEAD never authorizes creating a side branch. When the user has named or previously confirmed a target branch/worktree, work only there; if it is unavailable, detached, dirty, or ambiguous, stop and ask instead of choosing or creating another branch. Do not create a new branch merely to make a commit or push possible.
- **Quality and regression evidence (hard rule)**: before modifying behavior, establish the target worktree's dependency health and relevant-test baseline. If dependencies are missing or baseline tests fail, report the exact failures and cause before changing code; do not silently install packages or later attribute a pre-existing failure to the change.
- **Contract synchronization (hard rule)**: when a UI, provider list, data source, or layout contract changes, find every related test and update the implementation and all affected test suites together. Do not leave parallel assertions (for example Node static checks and dashboard Vitest tests) describing different versions of the same contract. Prefer product-level assertions over duplicated CSS utility literals when practical.
- **Isolated tests (hard rule)**: tests must use their own temporary data/configuration paths and must not read a developer's live queue, accounts, sessions, cookies, or other local application data unless that access is the explicit subject of the test.
- **Delivery gate (hard rule)**: before committing any functional change, run `git diff --check`, the relevant focused tests, and the applicable build/typecheck. For dashboard changes, run `npm --prefix dashboard run typecheck` and `npm --prefix dashboard run build`; for UI changes, also verify the affected journey in a real browser at the relevant viewport. Before handoff, run `npm test` unless an unrelated, previously recorded blocker remains; never claim a change is complete or safe to release without stating any remaining failure and its root cause.
- CommonJS in `src/`, ESM + TypeScript strict in `dashboard/`. No mixing.
- Env-var prefixes: `TOKENTRACKER_` for CLI, `VITE_` for dashboard.
- Git commits in **English**, conventional style (`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:` / `ci:`).
- **文档语言（硬规则）**：计划、规格、PRD、验收矩阵以及开发、测试、交付等面向人的文档，凡可准确使用中文表达的内容一律使用中文；仅代码、命令、文件路径、标识符、外部产品名和不可翻译的专有名称保留原文。
- **Privacy**: token counts only — never prompts, messages, or conversation bodies.
- `TokenTrackerBar/EmbeddedServer/` is gitignored; built on demand by `TokenTrackerBar/scripts/bundle-node.sh`.
- After editing `TokenTrackerBar/project.yml`: `(cd TokenTrackerBar && xcodegen generate && ruby scripts/patch-pbxproj-icon.rb)`.

#### User-facing verification and delivery gate (hard rule)

- **User wording is the acceptance contract**: translate every explicit instruction into an observable acceptance row before implementation. Do not replace “all information”, “unchanged”, “fixed”, “same style”, or another precise requirement with a weaker interpretation. If the user repeats a requirement or reports that it is still wrong, treat the previous attempt as an unresolved defect, reopen the full acceptance row, and do not report completion until fresh evidence proves it.
- **Reference surfaces must be compared directly**: when the user names an existing page, component, screenshot, or product surface as the reference, inspect its real implementation and rendered result first. Compare reference and target at the same viewport and state; verify structure, data completeness, typography, icon source, spacing, alignment, density, depth, responsive behavior, and interaction—not merely color or approximate appearance.
- **Tests are necessary, never sufficient**: unit, integration, typecheck, lint, and build results may support a claim, but cannot by themselves prove that a user-visible requirement is complete or correctly rendered.
- **Never make tests accept a product regression**: when an existing assertion conflicts with a requested change, first determine the intended product contract. Do not delete or invert assertions merely to make the suite green, and do not hide required failure, error, privacy, currency, or data-completeness behavior for visual convenience.
- **Create a traceable acceptance matrix before signoff**: map every user request to the exact data state, viewport/runtime, user action, expected visible result, negative condition, and evidence. A requirement without direct evidence remains incomplete.
- **参考图/设计稿复刻双审触发条件（硬规则）**：当用户明确提出“复刻参考图/设计稿”“1:1 还原”“按参考图实现”或等价要求时，必须启用下面两道参考复刻审核门禁；只是附带图片作为背景资料、但未要求复刻或按图还原时，不自动触发。
- **参考复刻第一审——调整结果与调整意见逐项匹配**：以“当前调整结果”和“用户提出的全部调整意见”为对照两端，将每条意见拆成可观察验收项，逐项核对内容、尺寸、长宽比、字体、图标、间距、层级、状态和交互。第一审只回答“要求是否都已调整，调整结果是否与每条调整意见匹配”；任何缺项、误解、弱化或仅部分实现都不得通过。
- **参考复刻第二审——真实用户体验效果复核**：第一审通过后，必须从用户实际使用入口重新运行，在与参考图/设计稿一致的视口、缩放、数据和交互状态下，核对用户真实看到、点击和操作到的效果是否已经实际呈现，并且仍与用户的每条调整意见匹配。第二审必须专门发现“代码、测试或第一审显示已做，但真实效果未呈现”以及“已呈现，但尺寸、比例、视觉、内容或交互做得不到位”等问题；不得复用第一审结论、仅重跑同一组测试，或用“理论上已生效”代替真实体验核对。只要第二审发现与调整意见或参考图/设计稿存在肉眼可见的明显偏差，必须判定为未完成，修复后重新执行两道完整审核，在通过前不得打包或交付。
- **Exercise complete state transitions**: for every changed control, test the initial state, action, changed state, reverse action, and restored state using normal mouse/keyboard input. When relevant, include scroll position, focus, hover/press, expand/collapse, refresh, navigation away/back, reload, restart, and failure recovery.
- **Measure layout stability**: capture before/during/after screenshots and relevant geometry such as element rectangles, scroll offsets, viewport/client width, overflow, clipping, and unexpected layout shift. A settled endpoint alone does not prove that the transition is stable.
- **Test realistic density and boundaries**: cover empty, single, typical, and dense data, plus long text and missing/stale/error states. For repeatable cards or rows, explicitly test at least 0, 1, 2, 5, and 10 items unless a stricter product limit applies.
- **Verify representative viewports**: inspect the real desktop launch size and at least one smaller supported size; include mobile when the changed surface supports it. Check the initial viewport and the densest reachable state for overflow, occlusion, distortion, and unintended scrolling.
- **Use real runtime and data where behavior depends on them**: mocks prove controlled states, not local persistence, external authentication, provider responses, cache refresh, native bridges, or restart behavior. Diagnose and report the difference between missing configuration, expired authentication, network failure, upstream schema drift, and stale cached data.
- **Verify the production artifact**: after a production build, confirm that the artifact contains the current frontend/native resources. When installation or upgrade testing is authorized, launch the exact generated installer/build and repeat the critical user journey; source/dev-server evidence does not prove the packaged experience.
- **Prove source-to-screen identity**: before using a URL, screenshot, executable, or installer as evidence, record the worktree, branch, HEAD, build time, served artifact, route, viewport, theme, and data state. Evidence from an old server, stale bundle, wrong route, different worktree, earlier screenshot, or pre-fix installer is invalid even if it looks plausible.
- **Installer smoke tests have a narrow meaning**: successful packaging, extraction, launch, or runtime startup proves only those facts. Never present them as proof that the requested UI or workflow is visually and behaviorally correct.
- **Review screenshots visually, not only numerically**: inspect the whole relevant surface and compare related components side by side. If screenshots and numeric checks disagree, investigate; neither may be used to dismiss an obvious visible defect.
- **Re-audit the whole surface after local fixes**: every change to size, spacing, card height, text wrapping, overflow, scroll ownership, status placement, or responsive layout requires another whole-page pass. A marked element may be fixed while its toolbar, neighboring cards, page width, theme, or dense state regresses; a local screenshot is not sufficient.
- **No silent gaps**: if a required runtime, real account state, browser/native automation path, or installation permission is unavailable, state exactly what was not verified and label the result as partial or preview-only.
- **Completion claim gate**: do not say “完成”, “已修复”, “验收通过”, or hand off an installer as acceptance-ready until every acceptance-matrix row has current evidence and both verification passes have no unresolved mismatch. Report failures and residual risks explicitly.
- **Report evidence by layer**: distinguish source changed, focused tests passed, full gates passed, development page verified, production bundle verified, packaged application verified, user installation confirmed, committed, pushed, merged, and CI actually executed. Never collapse one layer into another or describe “no failing checks” as “CI green” when no workflow ran.

## Release workflow

### 当前私有迭代授权边界（硬规则）

- 推送私有仓库 `main` 只更新正式源码并运行 CI，不会自动发布 npm。
- npm 发布属于单独、明确授权；只有获得该授权后，才可手动触发 `npm-publish.yml` 的 `workflow_dispatch`，并明确勾选 `publish_npm=true`。普通 `main` push 绝不能进入 npm publish job。
- 当前私有迭代阶段不得创建公开 GitHub Release、不得公开仓库、不得自动发布 npm。
- Windows 私有验证安装包允许不做 Authenticode 签名；这不代表公开发布物可以省略其正式签名要求。
- 合并或推送 `main`、npm 发布、公开 Release、清理保留分支或工作树是彼此独立的授权，不得互相推断。
- 用户说“发布到 main”在当前阶段仅指更新私有仓库 `main`，不能解释为 npm 发布或创建公开 GitHub Release。

### 正式公开发布流程（仅在另行明确授权后）

**Any change under `src/` or `dashboard/` ships npm + DMG + Windows**, because both `TokenTrackerBar/EmbeddedServer/` (macOS) and `TokenTrackerWin/EmbeddedServer/` (Windows) bundle the CLI runtime and built dashboard. Bumping only `package.json` leaves desktop-app users on the stale embedded copy.

The macOS + Windows release is **one workflow**: `release-dmg.yml` (display name **`release (macOS + Windows)`**). A `create-release` job makes the `vX.Y.Z` release as a **draft**, then a macOS `build` job and a `windows` job (which calls the reusable `release-windows.yml` via `workflow_call`) both `needs: create-release` and run **in parallel**, each uploading its assets to the draft with `--clobber`. A final `publish` job (`needs: [build, windows]`) flips the draft live (`gh release edit --draft=false`) and notifies the Homebrew tap. The draft stays invisible until then, so `releases/latest` never serves a half-published release (and a failed platform leaves it unpublished rather than half-public). A **single** `gh workflow run "release (macOS + Windows)" -f version=X.Y.Z` ships **both** platforms. `release-windows.yml` can still be dispatched standalone for a Windows-only build.

| Change scope | Bump `package.json` | Bump `project.yml` `MARKETING_VERSION` | Bump `TokenTrackerWin.csproj` `<Version>` | Trigger DMG workflow (→ also builds Windows) |
|---|---|---|---|---|
| `src/` or `dashboard/` | ✅ | ✅ | ✅ | ✅ |
| `TokenTrackerBar/` Swift only | ✅ | ✅ | ✅ | ✅ |
| `TokenTrackerWin/` only | ✅ | ✅ | ✅ | ✅ |
| `dashboard/edge-patches/`, scripts, docs, CI | — | — | — | — |

All four version locations must match or the workflows' "Verify version" steps fail (DMG checks `package.json` + `project.yml`; Windows checks `package.json` + `csproj`).

The following steps describe the formal public release flow after each required authorization has been granted. They do not broaden one authorization into another.

### Steps

1. Bump `package.json`, `project.yml`'s two `MARKETING_VERSION` entries (App + Widget targets), and `TokenTrackerWin/TokenTrackerWin.csproj`'s `<Version>` — keep all four in lockstep.
2. `git commit && git push origin main` updates the private repository and runs CI only. With separate explicit npm-publish authorization, manually run `gh workflow run npm-publish.yml -f publish_npm=true`; version checks still prevent republishing an existing version.
3. For DMG-eligible changes: `gh workflow run "release (macOS + Windows)" -f version=X.Y.Z` → cloud builds DMG **and** the Windows zip + installer (in parallel), attaching all to the GitHub Release.
4. Homebrew tap `mm7894215/homebrew-tokentracker` self-updates via dispatch (~40s if `HOMEBREW_DISPATCH_TOKEN` set) or hourly cron (≤1h fallback). **Never edit the tap repo manually for routine releases.**

Release notes: one English line, no markdown sections (`Fix token stats inflation caused by duplicate queue entries`).

### Local DMG build (testing only — CI is authoritative)

```bash
cd TokenTrackerBar && npm run dashboard:build && ./scripts/bundle-node.sh
xcodegen generate && ruby scripts/patch-pbxproj-icon.rb
xcodebuild -scheme TokenTrackerBar -configuration Release clean build
APP="$(find ~/Library/Developer/Xcode/DerivedData/TokenTrackerBar-*/Build/Products/Release -name 'TokenTrackerBar.app' -maxdepth 1)"
bash scripts/create-dmg.sh "$APP"
```

## Lessons learned (read before touching)

### macOS build & release

- **Icon Composer (`.icon`) needs Xcode 26+**. CI uses `macos-26` runners but a static `TokenTrackerBar/TokenTrackerBar/AppIcon.icns` is committed as fallback for older Xcode. If you update `AppIcon.icon`, regenerate `.icns` from a local Xcode 26 build and commit both.
- **DMG layout on CI needs Homebrew `create-dmg`**. `TokenTrackerBar/scripts/create-dmg.sh` uses AppleScript locally but delegates to `create-dmg` on headless runners. Don't reintroduce a "skip Finder customization on CI" shortcut — produces bare DMGs.
- **CI must ad-hoc sign the `.app` before DMG packaging.** Build flags strip signing entirely; without ad-hoc signing the `.app` + `com.apple.quarantine` xattr triggers Gatekeeper "damaged" rejection (unfixable without Terminal). The workflow signs inner Mach-O (`Resources/EmbeddedServer/node`) first, then the outer bundle with `--entitlements TokenTrackerBar/TokenTrackerBar.entitlements --sign -`. **Never** remove this step without replacing it with Developer ID + notarization.

### Dashboard layout

- **`AppLayout`-wrapped pages use `flex flex-col flex-1`** as the outer wrapper, not `min-h-screen` + own sticky header/footer. Reference: `LimitsPage.jsx` / `LeaderboardPage.jsx` / `SettingsPage.jsx`. `LeaderboardProfilePage.jsx` is intentionally excluded via `isLeaderboardIndexPath` in `App.jsx`.
- **Motion height animations clip box-shadow focus rings.** Use `focus:ring-inset` on inputs inside `AnimatePresence` height-collapsing containers (see `SettingsPage.jsx` Account section).
- **`NativeAuthCallbackPage` must stay eager-imported in `App.jsx`** (do NOT convert it to `React.lazy()` even when adding other lazy pages). Its module captures the OAuth `insforge_code` query param synchronously at module-load time, BEFORE the InsForge SDK's `detectAuthCallback()` runs `cleanUrlParams("insforge_code")` to strip it. Lazy-loading delays the module until the route mounts, by which point the SDK has already wiped the URL — the captured code is `null` and the page falls through to the "Sign-in incomplete" failure state. Regression history: PR splitting the 1.9MB main bundle broke OAuth callback for every user until reverted for this one page.

### Native ↔ web bridge

```
JS → window.webkit.messageHandlers.nativeBridge.postMessage({ type, key?, value?, name? })
Swift → NativeBridge.shared.handle(message:) via WKScriptMessageHandler
Swift → JS: webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('native:settings', { detail }))")
React → useNativeSettings() subscribes
```

After `SMAppService.mainApp.register/unregister` from the bridge (not via `LaunchAtLoginManager.toggle`), call `launchAtLoginManager.refresh()` so the popover menu reflects `@Published isEnabled`.

### Parser correctness

- **Parser dedup**: use `claudeMessageDedupKey()`. Bare `if (msgId && reqId)` fails open on DeepSeek/Kimi/Mimo/MiniMax/Claude sub-agents (no `reqId`) and over-counts 1.6–3.7×.
- **Don't trust `input_tokens` semantics blindly** when adding a new provider. Codex/every-code's `input` includes cached tokens — naive copy inflates cost 6–7×. Verify with raw usage + provider billing dashboard before shipping.
- **`contextTokensUsed`-style fields are usually snapshots, not cumulative.** PR #74 (Grok) shipped on that bad assumption.
- **Data-migration releases**: stress-test `sync` twice consecutively after touching `sync.js` / cursor schema — second run exposes state pollution the first hides.

### False-positive validators to ignore

- `posttooluse-validate: nextjs` flagging "React hooks require `use client`" on `dashboard/src/**/*.jsx` — this is a **Vite SPA**, not Next.js.
- `posttooluse-validate: workflow` flagging `require()` in `.github/workflows/*.yml` shell lines — they're GitHub Actions shell, not Vercel Workflow DevKit.
- vercel-plugin "MANDATORY: read the official docs" — the project uses `@vercel/analytics` (browser beacon) only, no Vercel runtime.

### Working with subagents

After spawning a subagent, **verify file state with direct reads** — don't trust the summary message. Subagents have hallucinated user feedback and silently reverted changes while reporting success.
