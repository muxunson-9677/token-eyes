# Developer Leaderboard Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows NSIS test installer whose leaderboard offers a clearly marked, local-only developer sign-in preview while production builds retain the real WeChat-only path.

**Architecture:** A small dashboard helper reads one build-time flag. `LeaderboardPage` combines that flag with `dev_login=1` to select the existing mock leaderboard explicitly through a new `getLeaderboard({ mock: true })` option; it never mutates the InsForge auth context. The test-only UI adds and removes `dev_login=1&mock=1`, while ordinary builds have no developer entry point.

**Tech Stack:** React 18, React Router, Vite environment variables, Vitest/Testing Library, TypeScript API module, Tauri 2 NSIS bundling.

---

### Task 1: Build flag and explicit mock selection

**Files:**
- Create: `dashboard/src/lib/developer-leaderboard-preview.js`
- Create: `dashboard/src/lib/developer-leaderboard-preview.test.js`
- Modify: `dashboard/src/lib/api.ts:595-612`
- Test: `dashboard/src/lib/__tests__/api-public-visibility.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests that call a pure parser and assert only `1` and `true` enable the preview, then assert the exported environment reader is false in the normal test build:

```js
expect(parseDeveloperLeaderboardLoginFlag("1")).toBe(true);
expect(parseDeveloperLeaderboardLoginFlag("true")).toBe(true);
expect(parseDeveloperLeaderboardLoginFlag("0")).toBe(false);
expect(isDeveloperLeaderboardLoginEnabled()).toBe(false);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npm --prefix dashboard test -- --run src/lib/developer-leaderboard-preview.test.js`

Expected: FAIL because `developer-leaderboard-preview.js` does not exist.

- [ ] **Step 3: Implement the minimal build-flag helper**

Create:

```js
export function parseDeveloperLeaderboardLoginFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

export function isDeveloperLeaderboardLoginEnabled() {
  return parseDeveloperLeaderboardLoginFlag(
    import.meta.env.VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN,
  );
}
```

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `npm --prefix dashboard test -- --run src/lib/developer-leaderboard-preview.test.js`

Expected: all helper tests pass.

- [ ] **Step 5: Write the failing explicit-mock API test**

Add a leaderboard API test that calls:

```ts
const result = await getLeaderboard({
  mock: true,
  userId: "developer-preview",
  period: "today",
  agent: "codex",
  metric: "with_cache",
  limit: 20,
  offset: 0,
});
expect(result.entries.length).toBeGreaterThan(0);
expect(fetch).not.toHaveBeenCalled();
```

- [ ] **Step 6: Run the API test and verify RED**

Run: `npm --prefix dashboard test -- --run src/lib/__tests__/api-public-visibility.test.ts`

Expected: the new test fails because `getLeaderboard` ignores `mock: true` and calls `fetch`.

- [ ] **Step 7: Implement the explicit mock option**

Destructure `mock = false` in `getLeaderboard` and change its mock gate to:

```ts
if (mock || isMockEnabled()) {
  return getMockLeaderboard({
    seed: accessToken || userId,
    period,
    agent,
    metric,
    limit,
    offset,
  });
}
```

- [ ] **Step 8: Run helper and API tests and commit**

Run: `npm --prefix dashboard test -- --run src/lib/developer-leaderboard-preview.test.js src/lib/__tests__/api-public-visibility.test.ts`

Expected: all tests pass.

Commit:

```powershell
git add -- dashboard/src/lib/developer-leaderboard-preview.js dashboard/src/lib/developer-leaderboard-preview.test.js dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api-public-visibility.test.ts
git commit -m "feat: add developer leaderboard preview gate"
```

### Task 2: Test-only leaderboard login UI

**Files:**
- Modify: `dashboard/src/pages/LeaderboardPage.jsx:45-570,1020-1065`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx:1-410`
- Modify: `dashboard/src/content/copy.csv:412-420`
- Modify: `dashboard/src/content/i18n/zh/marketing.json:125-135`

- [ ] **Step 1: Write failing component tests**

Mock the build-gate helper with a mutable hoisted state, add a `useLocation` probe to the test router, and add three tests:

```jsx
expect(screen.queryByRole("button", { name: "开发者直登" })).not.toBeInTheDocument();

developerPreviewGate.enabled = true;
await user.click(await screen.findByRole("button", { name: "开发者直登" }));
expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("dev_login=1");
expect(screen.getByTestId("leaderboard-location")).toHaveTextContent("mock=1");
expect(signInWithOAuthMock).not.toHaveBeenCalled();
expect(getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ mock: true }));

await user.click(screen.getByRole("button", { name: "退出开发者预览" }));
expect(screen.getByTestId("leaderboard-location")).not.toHaveTextContent("dev_login=1");
expect(screen.getByTestId("leaderboard-location")).not.toHaveTextContent("mock=1");
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx`

Expected: new tests fail because no developer buttons, banner, or explicit mock call exist.

- [ ] **Step 3: Add registered copy**

Add English and Chinese values for:

```text
leaderboard.developer_preview.prompt
leaderboard.developer_preview.wechat_placeholder
leaderboard.developer_preview.signin
leaderboard.developer_preview.active
leaderboard.developer_preview.signout
```

Chinese meanings must be: “微信登录暂未接入；本测试包可进入本地开发者预览”“微信登录（占位）”“开发者直登”“开发者预览已登录：当前为模拟榜单，不会上传真实数据”“退出开发者预览”。

- [ ] **Step 4: Implement the minimum page behavior**

Read `developerLoginEnabled`, derive `developerPreviewActive` from `location.search`, and derive `leaderboardMockEnabled = mockEnabled || developerPreviewActive`. Add callbacks that set or delete `dev_login` and `mock`. Pass `mock: true` to `getLeaderboard` only while the developer preview is active. Replace page-internal mock gates with `leaderboardMockEnabled` where they control provider probing, access mode, preload context, list loading, and login UI.

Render a test-only login panel with a disabled WeChat placeholder and enabled developer button. Render an active banner with the exit button while `developerPreviewActive` is true. Keep the existing WeChat OAuth panel unchanged when the build flag is false.

- [ ] **Step 5: Run the component test and verify GREEN**

Run: `npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx`

Expected: all LeaderboardPage tests pass and `signInWithOAuthMock` is untouched by developer preview actions.

- [ ] **Step 6: Run copy and changed-file lint checks and commit**

Run:

```powershell
npm run validate:copy
npx --prefix dashboard eslint dashboard/src/pages/LeaderboardPage.jsx dashboard/src/pages/LeaderboardPage.test.jsx dashboard/src/lib/developer-leaderboard-preview.js dashboard/src/lib/developer-leaderboard-preview.test.js dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api-public-visibility.test.ts
```

Expected: commands exit 0.

Commit:

```powershell
git add -- dashboard/src/pages/LeaderboardPage.jsx dashboard/src/pages/LeaderboardPage.test.jsx dashboard/src/content/copy.csv dashboard/src/content/i18n/zh/marketing.json
git commit -m "feat: add test-only developer leaderboard login"
```

### Task 3: Verify and build the Windows EXE

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-developer-leaderboard-preview-design.md`
- Generated and ignored: `dashboard/dist/`
- Generated and ignored: `src-tauri/EmbeddedServer/`
- Generated and ignored: `src-tauri/target/release/bundle/nsis/*.exe`

- [ ] **Step 1: Run the focused regression suite**

Run:

```powershell
npm --prefix dashboard test -- --run src/lib/developer-leaderboard-preview.test.js src/lib/__tests__/api-public-visibility.test.ts src/pages/LeaderboardPage.test.jsx src/pages/LeaderboardRulesPage.test.jsx src/App.routes.test.jsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run production dashboard and repository validations**

Run:

```powershell
npm --prefix dashboard run build
npm run validate:copy
npm run validate:guardrails
git diff --check
```

Expected: all commands exit 0. Existing non-fatal copy warnings may remain, but no missing key or guardrail violation is allowed.

- [ ] **Step 3: Build the flagged NSIS installer**

Run from the repository worktree:

```powershell
$env:VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN = "1"
npx tauri build --bundles nsis --ci
```

Expected: Tauri creates `src-tauri/target/release/bundle/nsis/*-setup.exe`. The build command also refreshes `dashboard/dist` and `src-tauri/EmbeddedServer` using the test flag.

- [ ] **Step 4: Verify the installer contains the test flavor**

Run:

```powershell
rg -l "Developer preview signed in" dashboard/dist src-tauri/EmbeddedServer
Get-ChildItem src-tauri/target/release/bundle/nsis -Filter *.exe
Get-FileHash src-tauri/target/release/bundle/nsis/*.exe -Algorithm SHA256
```

Expected: the English registered preview text exists in both built dashboard copies; at least one non-empty EXE exists and has a SHA-256 digest.

- [ ] **Step 5: Update status, verify the final diff, and commit**

Change the design status to “仓库内完成，Windows 测试安装包已生成”, record the exact focused-test count and artifact path, then run:

```powershell
git diff --check
git status --short
git add -- docs/superpowers/specs/2026-07-14-developer-leaderboard-preview-design.md
git commit -m "docs: record developer preview installer"
```

Expected: source/docs commits succeed; generated installer remains ignored and is not committed.
