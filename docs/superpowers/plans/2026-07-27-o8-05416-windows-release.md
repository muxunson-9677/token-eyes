# O8 0.54.16 Windows Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution selected; no delegated agents are authorized for this task).

**Goal:** Deliver a verified Windows EXE that preserves the 0.54.16 product baseline, contains O0–O8 observability work, and uses the 0.54.20 runtime-bundling repair without importing its product behavior.

**Architecture:** Keep the migrated product changes isolated in the Node local API and React dashboard. Treat the later branch solely as a packaging reference, then create a new synchronized desktop version (`0.54.21`) across the five required version locations. Validate each public endpoint and identity rule before building the self-contained Tauri bundle.

**Tech Stack:** Node.js CommonJS tests, React/Vite/Vitest, Rust/Tauri 2, PowerShell runtime bundler, NSIS Windows installer.

---

### Task 1: Close the O8 leaderboard identity invariant

**Files:**
- Modify: `dashboard/src/lib/leaderboard-ui.js`
- Test: `dashboard/src/lib/__tests__/leaderboard-ui.test.js`

- [x] **Step 1:** Add a regression case containing both a stale cloud `is_me` row and the current account identity.
- [x] **Step 2:** Verify the test fails against the early-return implementation.
- [x] **Step 3:** Normalize all stale flags and merge or prepend only the current identity.
- [x] **Step 4:** Run `npm test -- --run src/lib/__tests__/leaderboard-ui.test.js`; expect all tests to pass.
- [x] **Step 5:** Commit `fix: keep one current leaderboard identity`.

### Task 2: Wire the remaining local observability surfaces

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `src/lib/request-diagnostics.js`
- Modify: `src/lib/observability-export.js`
- Modify: `src/lib/tray-compact.js`
- Test: `test/request-diagnostics.test.js`
- Test: `test/observability-export.test.js`
- Test: `test/tray-compact.test.js`

- [x] **Step 1:** Add one failing API-contract test for each of request diagnostics, redacted export, and compact tray data.
- [x] **Step 2:** Expose only safe, local data through the existing local API dispatcher.
- [x] **Step 3:** Run the three focused Node tests; expect zero failures.
- [x] **Step 4:** Commit the tested local API wiring.

### Task 3: Port installer repair without changing product behavior

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `TokenTrackerBar/project.yml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/scripts/bundle-runtime.ps1`
- Create: `src-tauri/EmbeddedServer-0.54.21/.gitkeep`
- Test: `test/windows-bundled-runtime-smoke.test.cjs`

- [x] **Step 1:** Add a failing smoke assertion for a versioned runtime resource directory.
- [x] **Step 2:** Port only the 0.54.20 runtime path and shared-manifest bundling logic, parameterized by the current app version.
- [x] **Step 3:** Set all five release version values to `0.54.21` and update lock metadata.
- [x] **Step 4:** Run the versioned-runtime smoke test after preparation; expect it to locate the bundled server resources.
- [x] **Step 5:** Commit the packaging repair.

### Task 4: Build and adversarially verify the release candidate

**Files:**
- Verify only; generated artifacts remain under `src-tauri/target/`.

- [ ] **Step 1:** Run `npm test`, `npm run validate:copy`, `npm run validate:ui-hardcode`, and `npm run validate:guardrails`.
- [ ] **Step 2:** Run dashboard `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] **Step 3:** Run `npm run tauri:prepare-runtime`, then `npm run tauri:build`.
- [ ] **Step 4:** Confirm the produced NSIS EXE has the matching versioned embedded runtime and run the smoke test.
- [ ] **Step 5:** Commit the final release-candidate source changes and report the absolute EXE path plus evidence.
