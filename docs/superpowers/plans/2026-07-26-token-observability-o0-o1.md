# Token Observability O0/O1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the Token Observability v2 contract and add reusable evidence/freshness primitives without changing later-stage API ownership.

**Architecture:** O0 adds a versioned contract document, JSON Schema, shared fixtures, and a compatibility adapter that maps legacy queue rows into a v2 snapshot while preserving token totals. O1 adds pure CommonJS evidence/freshness helpers, applies evidence at the `usage-limits` service boundary, and introduces a reusable dashboard Evidence badge; request/API wiring remains owned by O5/O6/O8 under the staged file-ownership rules.

**Tech Stack:** Node.js CommonJS and `node:test`; JSON Schema draft 2020-12; React 18/Vite; TypeScript strict.

---

### Task 1: Freeze the O0 v2 contract and compatibility fixture

**Files:**
- Create: `docs/dev-notes/token-observability-v2-contract.md`
- Create: `shared/schemas/token-observability-v2.schema.json`
- Create: `test/fixtures/token-observability-v2/{legacy-queue-v1.jsonl,usage-snapshot-v2.json}`
- Create: `src/lib/token-observability-v2.js`
- Create: `test/token-observability-v2-contract.test.js`
- Modify: `dashboard/src/lib/types/usage.ts`

- [ ] **Step 1: Write failing contract tests**

```js
const { buildHourlyBucketKey, mapLegacyQueueRowToV2 } = require('../src/lib/token-observability-v2');
assert.equal(buildHourlyBucketKey({ hour_start, dimensions: { ...base, session_key: 'a' } }),
  buildHourlyBucketKey({ hour_start, dimensions: { ...base, session_key: 'b' } }));
assert.notEqual(buildHourlyBucketKey({ hour_start, dimensions: { ...base, environment_id: 'native' } }),
  buildHourlyBucketKey({ hour_start, dimensions: { ...base, environment_id: 'wsl' } }));
assert.equal(sumTokens(v1Rows), sumTokens(v1Rows.map(mapLegacyQueueRowToV2)));
```

- [ ] **Step 2: Run the test and verify it fails because the adapter is absent**

Run: `node --require ./test/helpers/home-shim.cjs --test test/token-observability-v2-contract.test.js`

- [ ] **Step 3: Implement the minimum contract files and adapter**

```js
function buildHourlyBucketKey({ hour_start, dimensions }) {
  return [hour_start, dimensions.device_id, dimensions.environment_id,
    dimensions.agent_id, dimensions.account_scope || '', dimensions.project_key || '',
    dimensions.model_id || ''].join('|');
}
```

The adapter must map absent legacy dimensions to `unknown`/`null`, preserve every token field unchanged, and never include `session_key` in the bucket key.

- [ ] **Step 4: Run the O0 test and dashboard typecheck**

Run: `node --require ./test/helpers/home-shim.cjs --test test/token-observability-v2-contract.test.js && npm --prefix dashboard run typecheck`

- [ ] **Step 5: Commit O0**

```bash
git add docs/dev-notes/token-observability-v2-contract.md shared/schemas/token-observability-v2.schema.json test/fixtures/token-observability-v2 src/lib/token-observability-v2.js test/token-observability-v2-contract.test.js dashboard/src/lib/types/usage.ts
git commit -m "feat: freeze token observability v2 contract"
```

### Task 2: Add O1 data-evidence and freshness primitives

**Files:**
- Create: `src/lib/data-evidence.js`
- Create: `src/lib/data-freshness.js`
- Create: `test/data-evidence.test.js`
- Modify: `src/lib/usage-limits.js`
- Modify: `test/usage-limits.test.js`

- [ ] **Step 1: Write failing evidence tests with a fixed clock**

```js
const evidence = normalizeDataEvidence({ source_kind: 'official_api', accuracy: 'exact',
  coverage: 'complete', observed_at: '2026-07-26T00:00:00.000Z',
  source_updated_at: null, stale_after_seconds: 60 });
assert.equal(isEvidenceStale(evidence, Date.parse('2026-07-26T00:01:00.000Z')), true);
assert.throws(() => normalizeDataEvidence({ ...evidence, source_updated_at: 'not-a-date' }));
```

- [ ] **Step 2: Run the test and verify it fails because the evidence module is absent**

Run: `node --require ./test/helpers/home-shim.cjs --test test/data-evidence.test.js`

- [ ] **Step 3: Implement the minimum pure helpers and usage-limit decoration**

```js
function normalizeDataEvidence(input, { nowMs = Date.now() } = {}) { /* validate enums, ISO dates, and recompute is_stale */ }
function isEvidenceStale(evidence, nowMs = Date.now()) { /* observed_at + stale_after_seconds <= nowMs */ }
function decorateUsageLimitsWithEvidence(data, { nowMs = Date.now() } = {}) { /* append provider evidence without removing legacy fields */ }
```

`usage-limits` must call the decorator immediately before caching/returning its data. Successful direct provider values use `official_api`; stale Claude fallback uses `cache` with its original cache timestamp; unavailable providers remain `coverage: "unavailable"` and `accuracy: "unknown"`.

- [ ] **Step 4: Run focused evidence and limits tests**

Run: `node --require ./test/helpers/home-shim.cjs --test test/data-evidence.test.js test/usage-limits.test.js`

### Task 3: Add the shared dashboard Evidence badge

**Files:**
- Create: `dashboard/src/ui/dashboard/components/EvidenceBadge.jsx`
- Create: `dashboard/src/ui/dashboard/components/__tests__/EvidenceBadge.test.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/ui/dashboard/components/UsageLimitsPanel.jsx`

- [ ] **Step 1: Write failing UI tests**

```jsx
render(<EvidenceBadge evidence={staleCachedEvidence} />);
expect(screen.getByText(copy('observability.evidence.cached'))).toBeInTheDocument();
expect(screen.getByTitle(copy('observability.evidence.stale_tooltip'))).toBeInTheDocument();
```

- [ ] **Step 2: Run the test and verify it fails because the component is absent**

Run: `npm --prefix dashboard test -- --run dashboard/src/ui/dashboard/components/__tests__/EvidenceBadge.test.jsx`

- [ ] **Step 3: Implement the minimal accessible badge**

The component maps source/accuracy/coverage/staleness to registered copy keys only. `UsageLimitsPanel` renders it beside a provider with evidence; stale values retain their number and receive a low-emphasis stale indicator.

- [ ] **Step 4: Run focused dashboard test, typecheck, lint, and build**

Run: `npm --prefix dashboard test -- --run dashboard/src/ui/dashboard/components/__tests__/EvidenceBadge.test.jsx && npm --prefix dashboard run typecheck && npm --prefix dashboard run lint && npm --prefix dashboard run build`

- [ ] **Step 5: Commit O1 and write the handoff**

```bash
git add src/lib/data-evidence.js src/lib/data-freshness.js src/lib/usage-limits.js test/data-evidence.test.js test/usage-limits.test.js dashboard/src/ui/dashboard/components/EvidenceBadge.jsx dashboard/src/ui/dashboard/components/__tests__/EvidenceBadge.test.jsx dashboard/src/ui/dashboard/components/UsageLimitsPanel.jsx dashboard/src/content/copy.csv docs/test-reports/optimization/O1-source-freshness-handoff.md
git commit -m "feat: add usage evidence and freshness"
```

### Task 4: Verify O0/O1 and produce handoffs

**Files:**
- Create: `docs/test-reports/optimization/O0-contract-handoff.md`
- Create: `docs/test-reports/optimization/O1-source-freshness-handoff.md`

- [ ] **Step 1: Run the required focused and regression gates**

Run: `npm test && npm --prefix dashboard run typecheck && npm --prefix dashboard run lint && npm --prefix dashboard test -- --run && npm --prefix dashboard run build && npm run audit:tokens:fixture`

- [ ] **Step 2: Record exact commands, exit codes, test counts, privacy check, known limitations, commits, and rollback commits in both handoffs**

The reports must explicitly state that request-diagnostic/API evidence wiring remains assigned to O5/O6/O8, so no later stage silently relies on an unimplemented endpoint change.
