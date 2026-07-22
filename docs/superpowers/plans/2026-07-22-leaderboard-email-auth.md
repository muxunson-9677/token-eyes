# Leaderboard Email Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub-only leaderboard participation with a free email/password flow that completes six-digit signup verification inside the existing login modal.

**Architecture:** Extend the existing InsForge auth context with verification methods, complete the shared `LoginCard` verification state, and let the existing global login modal accept an email-only option. The leaderboard opens that modal and no longer knows about OAuth configuration.

**Tech Stack:** React 18, Vitest, Testing Library, InsForge SDK, Tauri 2, NSIS

---

### Task 1: Expose email verification through the auth context

**Files:**
- Modify: `dashboard/src/contexts/InsforgeAuthContext.jsx`
- Modify: `dashboard/src/contexts/InsforgeAuthContext.d.ts`
- Test: `dashboard/src/contexts/__tests__/InsforgeAuthContext.test.jsx`

- [ ] **Step 1: Write failing context tests**

Add SDK mocks and assertions that `verifyEmail({ email, otp })` delegates to `client.auth.verifyEmail`, stores the returned user, and that `resendVerificationEmail({ email })` delegates without changing the session.

```jsx
await result.current.verifyEmail({ email: "person@example.com", otp: "123456" });
expect(mockClient.auth.verifyEmail).toHaveBeenCalledWith({ email: "person@example.com", otp: "123456" });
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm --prefix dashboard test -- --run src/contexts/__tests__/InsforgeAuthContext.test.jsx`

Expected: FAIL because the two methods are absent.

- [ ] **Step 3: Add minimal context wrappers and declarations**

```jsx
const verifyEmail = useCallback(async (request) => {
  if (!client) return { data: null, error: new Error("InsForge client not configured") };
  const { data, error } = await client.auth.verifyEmail(request);
  if (data?.user) setUser(data.user);
  return { data, error };
}, [client]);

const resendVerificationEmail = useCallback(
  async (request) => client
    ? client.auth.resendVerificationEmail(request)
    : { data: null, error: new Error("InsForge client not configured") },
  [client],
);
```

Expose both methods in configured and unconfigured context values and in the TypeScript declaration.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm --prefix dashboard test -- --run src/contexts/__tests__/InsforgeAuthContext.test.jsx`

Expected: PASS.

### Task 2: Complete code-based signup verification

**Files:**
- Create: `dashboard/src/components/LoginCard.test.jsx`
- Modify: `dashboard/src/components/LoginCard.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing LoginCard tests**

Cover these observable behaviors:

```jsx
expect(screen.queryByText("Continue with GitHub")).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Create account" }));
// submit nickname, email, and password
expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();
await user.type(screen.getByLabelText("Verification code"), "123456");
await user.click(screen.getByRole("button", { name: "Verify and join" }));
expect(verifyEmail).toHaveBeenCalledWith({ email: "person@example.com", otp: "123456" });
```

Also verify resend calls `resendVerificationEmail`, invalid codes keep the verification form visible, and ordinary email/password sign-in remains unchanged.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm --prefix dashboard test -- --run src/components/LoginCard.test.jsx`

Expected: FAIL because focused email mode and signup verification do not exist.

- [ ] **Step 3: Implement the minimal verification state**

Add `emailOnly = false`, track `verifyEmailMethod`, add `verify_email` mode, and render a six-digit input when signup returns `requireEmailVerification` with code verification.

```jsx
const { data, error: err } = await verifyEmail({
  email: email.trim(),
  otp: code.trim(),
});
if (!err && data?.user) await refreshUser();
```

Hide the OAuth block and expand the email form immediately when `emailOnly` is true. Add copy registry entries for verification title, explanation, code label, submit, resend, and resend success.

- [ ] **Step 4: Run focused tests and validators**

Run:

```powershell
npm --prefix dashboard test -- --run src/components/LoginCard.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: all pass.

### Task 3: Make the shared modal selectable as email-only

**Files:**
- Modify: `dashboard/src/contexts/LoginModalContext.jsx`
- Modify: `dashboard/src/components/LoginModal.jsx`
- Modify: `dashboard/src/components/LoginModal.test.jsx`

- [ ] **Step 1: Write failing modal tests**

Test that `openLoginModal({ emailOnly: true })` makes `LoginModal` render:

```jsx
<LoginCard emailOnly onSuccess={closeLoginModal} />
```

and closing resets options so unrelated login entry points preserve their existing provider choices.

- [ ] **Step 2: Run the modal tests and confirm failure**

Run: `npm --prefix dashboard test -- --run src/components/LoginModal.test.jsx`

Expected: FAIL because modal options are absent.

- [ ] **Step 3: Implement modal options**

Store `{ emailOnly: false }` in the provider, merge supported boolean options in `openLoginModal`, reset on close, and pass `emailOnly` to `LoginCard`.

- [ ] **Step 4: Run modal tests and confirm pass**

Run: `npm --prefix dashboard test -- --run src/components/LoginModal.test.jsx`

Expected: PASS.

### Task 4: Replace leaderboard GitHub OAuth with email modal

**Files:**
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Replace GitHub assertions with failing email assertions**

Assert the guest button is `邮箱登录并参与排行榜`, remains available without a GitHub provider, and calls:

```jsx
expect(openLoginModal).toHaveBeenCalledWith({ emailOnly: true });
expect(signInWithOAuth).not.toHaveBeenCalled();
```

Keep anonymous leaderboard visibility and developer-preview coverage.

- [ ] **Step 2: Run the page test and confirm failure**

Run: `npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx`

Expected: FAIL because the page still starts GitHub OAuth.

- [ ] **Step 3: Remove leaderboard OAuth state and open the focused modal**

Import `useLoginModal`, remove `signInWithOAuth`, provider discovery, OAuth busy/error state, and native OAuth redirect handling. The guest button directly calls `openLoginModal({ emailOnly: true })`; only disable it when cloud auth itself is unavailable.

- [ ] **Step 4: Update registered copy and run focused tests**

Replace GitHub-specific leaderboard sign-in strings with email participation wording, then run:

```powershell
npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx src/components/LoginModal.test.jsx src/components/LoginCard.test.jsx src/contexts/__tests__/InsforgeAuthContext.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
```

Expected: all pass.

### Task 5: Regression verification and Windows installer

**Files:**
- Generated: `dashboard/dist/**`
- Generated: `src-tauri/target/release/bundle/nsis/Token Eyes_0.54.7_x64-setup.exe`

- [ ] **Step 1: Run the dashboard build and relevant regression suite**

Run:

```powershell
npm --prefix dashboard run build
npm --prefix dashboard test -- --run src/pages/LeaderboardPage.test.jsx src/components/LoginModal.test.jsx src/components/LoginCard.test.jsx src/contexts/__tests__/InsforgeAuthContext.test.jsx
node --test test/leaderboard*.test.js test/runtime-config.test.js
```

Expected: all pass.

- [ ] **Step 2: Run native checks and build the installer**

Run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Expected: Cargo check and the NSIS bundle succeed.

- [ ] **Step 3: Verify artifact identity and repository scope**

Compute installer SHA-256, confirm version `0.54.7`, inspect `git diff --stat`, and confirm no unrelated files or backend schema changes appear.

- [ ] **Step 4: Commit and push**

```powershell
git add dashboard/src docs/superpowers/plans/2026-07-22-leaderboard-email-auth.md
git commit -m "feat: add leaderboard email authentication"
git push origin codex/leaderboard-provider-api
```

Expected: local HEAD equals the remote branch HEAD and `git status --short` is empty.
