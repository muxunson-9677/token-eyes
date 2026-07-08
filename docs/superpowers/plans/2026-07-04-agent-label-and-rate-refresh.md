# Agent Label and USD/CNY Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the usage-statistics hero label in sync with the selected AgentSwitcher agent, and add a real manual USD/CNY exchange-rate refresh button in basic settings.

**Architecture:** Reuse existing dashboard agent registry and `ProviderIcon` for the selected-agent identity. Reuse the existing `CurrencyProvider.refreshRates` path backed by `open.er-api.com`; the settings row writes the fetched CNY rate into the existing `currencySettings.usdToCny` setting.

**Tech Stack:** React, Vitest, Testing Library, existing local settings API, existing currency/exchange-rate utilities.

---

### Task 1: Selected agent identity in usage statistics

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] **Step 1: Write failing component and page tests**

Assert that `UsageStatsPanel` renders `selectedAgent.displayName` beside the real-token label, and that `SpendUsagePage` passes the selected AgentSwitcher item through after clicking the `Claude Code` agent button.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/pages/SpendPage.test.jsx
```

Expected: fails because no `usage-selected-agent` marker is rendered.

- [ ] **Step 3: Implement minimal selected-agent rendering**

Add an optional `selectedAgent` prop to `UsageStatsPanel`, render icon/name only when a single agent is selected, and derive that prop in `SpendUsagePage` from `filterState.agentIds` + `DASHBOARD_AGENTS`.

- [ ] **Step 4: Run tests to verify GREEN**

Run the same command and expect pass.

### Task 2: Manual USD/CNY refresh in basic settings

**Files:**
- Modify: `dashboard/src/ui/foundation/CurrencyProvider.jsx`
- Modify: `dashboard/src/hooks/useCurrency.js`
- Modify: `dashboard/src/components/settings/AppearanceSection.jsx`
- Create: `dashboard/src/components/settings/AppearanceSection.test.jsx`

- [ ] **Step 1: Write failing settings test**

Mock `useCurrency().refreshRates` to return `{ rates: { CNY: 7.31 } }`, click the USD/CNY refresh button, and assert `setLocalSettings({ currencySettings: { usdToCny: 7.31 } })` is called.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix dashboard test -- --run src/components/settings/AppearanceSection.test.jsx
```

Expected: fails because no refresh button exists.

- [ ] **Step 3: Implement minimal real refresh**

Expose `refreshRates` from `CurrencyProvider`, keep background refresh silent by default, support manual throw-on-error mode, add the refresh button beside Save, and persist fetched `rates.CNY`.

- [ ] **Step 4: Run tests to verify GREEN**

Run the same command and expect pass.

### Task 3: Final verification

- [ ] Run related tests:

```bash
npm --prefix dashboard test -- --run src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/pages/SpendPage.test.jsx src/components/settings/AppearanceSection.test.jsx
```

- [ ] Run build:

```bash
npm run dashboard:build
```

- [ ] Run `git diff --check` and report any warnings separately from errors.
