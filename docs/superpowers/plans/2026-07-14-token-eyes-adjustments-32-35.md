# Token Eyes Adjustments 32–35 Implementation Plan

> Execute only in the existing `provider-api` worktree. Do not mutate project-external files.

**Goal:** Make cost settings safely manageable, provide provider-specific balance connectors, add organized Other AI spend records, and expose group-linked month/year/lifetime totals.

**Architecture:** Extend the existing local-first config and spend-record APIs with minimal fields and atomic reorder/group operations. Reuse the current credential store and official-console session bridge. Keep cost totals derived server-side from the canonical spend records.

**Tech Stack:** CommonJS Node local API, React 18/Vite/Tailwind dashboard, Tauri 2 Rust/WebView, Vitest/Testing Library, Node test runner.

---

### Task 1: Token plan deletion and two-level settings sections

- [x] Add failing local API and client tests for Token plan deletion.
- [x] Implement atomic delete plus orphaned local-secret cleanup.
- [x] Add failing UI tests for section and row disclosure states.
- [x] Implement concise rows, detail disclosure and safe delete confirmation.

### Task 2: Other AI spend organization

- [x] Add failing API tests for group CRUD, record metadata and atomic reorder.
- [x] Implement group normalization, persistence and orphan-safe group deletion.
- [x] Add failing UI tests for group assignment, drag order, favorite and numbering.
- [x] Implement grouped list UI with detail disclosure.

### Task 3: Dynamic group cost accumulation

- [x] Add failing summary tests for month/year/lifetime group totals.
- [x] Implement backend group summaries from canonical spend records.
- [x] Add failing component tests for dynamic group rows/cards.
- [x] Wire summaries through `useCostAccumulation` to `CostAccumulation`.

### Task 4: Six provider balance connectors

- [x] Freeze official adapter contracts for Kimi, Alibaba Cloud and Volcengine.
- [x] Reuse GLM and Xiaomi official-console session bridges for financial balance display.
- [x] Add MiniMax official-console session bridge with domain allowlist and auto-close.
- [x] Add provider capability and security tests; ensure unknown values render as unknown.

### Task 5: Verification and package

- [x] Run focused tests after each task.
- [x] Run dashboard tests/typecheck and Node tests relevant to touched contracts.
- [x] Run copy, UI hardcode and guardrail validation.
- [x] Build dashboard, Tauri release and NSIS installer.
- [x] Update design status and record artifact path, size and SHA-256.
