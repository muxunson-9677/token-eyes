# Token Eyes Free-Tier Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a public-readable, login-to-participate leaderboard for 6,000 conservative-capacity users while keeping every local feature login-free and keeping normal infrastructure cost at ¥0.

**Architecture:** The desktop keeps reading local usage. A signed-in client derives one compact current-state document per device and writes it directly to InsForge PostgREST under JWT/RLS. One global 15-minute InsForge job refreshes public snapshots in SQL; a small Cloudflare Worker caches public lists and immutable avatars. No Firebase, no D1, no per-user cron, and no hourly cloud history on the new path.

**Tech Stack:** Node.js CommonJS local runtime, React 18 + TypeScript/Vitest dashboard, InsForge Auth/PostgreSQL/PostgREST/Edge Functions, PostgreSQL RLS/RPC, Cloudflare Workers + Vitest, existing pricing engine.

---

## Delivery invariants

- The desktop dashboard always uses local usage endpoints, whether signed in or not.
- Signed-out users can read the public leaderboard but never upload.
- Signing in means participating; there is no separate participation or cloud-sync toggle.
- Only aggregate numeric usage, source/model identifiers, nickname, avatar, and the explicitly enabled actual-cost summary may leave the machine.
- The compact usage request is at most 8 KiB and contains no project, repository, path, conversation, Skill, MCP, keypress, screenshot, file, quota, or timezone fields.
- The new main path never calls `tokentracker-ingest`, `tokentracker-device-token-issue`, or a leaderboard refresh after a client upload.
- `NUMERIC(30,0)` values cross the JSON boundary as decimal strings.
- Public ranks are assigned only after filtering `leaderboard_public = true`.
- All capacity alarms trigger a controlled TTL/cadence reduction; they never enable a paid plan automatically.

## Phase 0: Isolation and baseline

### Task 1: Create an isolated implementation worktree and record the baseline

**Files:**
- Read: `CLAUDE.md`
- Read: `package.json`
- Read: `dashboard/package.json`
- Create: `docs/operations/leaderboard-free-tier-runbook.md`

- [ ] **Step 1: Use the required worktree skill**

Invoke `superpowers:using-git-worktrees` because the source checkout currently contains unrelated user changes. Create a branch named `codex/leaderboard-free-tier`.

- [ ] **Step 2: Run focused baseline tests**

Run:

```powershell
node --test test/edge-pricing-parity.test.js test/local-api-account-view.test.js test/local-api-security.test.js
npm --prefix dashboard test -- src/pages/LeaderboardPage.test.jsx src/lib/cloud-sync.test.ts
```

Expected: all selected tests pass before implementation. If an unrelated baseline test fails, record the exact command and failure in the runbook and do not weaken the test.

- [ ] **Step 3: Seed the operations runbook**

Create `docs/operations/leaderboard-free-tier-runbook.md` with these fixed sections:

```markdown
# Leaderboard Free-Tier Runbook

## Capacity contract
- Conservative participants: 6,000
- Worst-case daily active participants: 6,000
- Upload target: at most one changed state per active user per day, plus first login
- Public reads: 30,000 requests/day before cache
- Compact request hard limit: 8 KiB
- InsForge database warning line: 350 MB
- InsForge bandwidth warning line: 3.5 GB/month
- InsForge Edge warning line: 70,000 calls/month
- Cloudflare Worker warning line: 70,000 calls/day

## Deployment order
Database schema → pricing seed → refresh RPC → Edge functions → scheduler → Worker → client

## Rollback order
Client upload flag off → Worker origin fallback → scheduler off → retain last public snapshot

## Evidence
Add dated staging and production verification records here.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/operations/leaderboard-free-tier-runbook.md
git commit -m "docs: add leaderboard free tier runbook"
```

## Phase 1: Compact local state

### Task 2: Build the privacy allowlisted four-period state

**Files:**
- Create: `src/lib/leaderboard-state.js`
- Create: `test/leaderboard-state.test.js`
- Read: `src/lib/local-api.js`
- Read: `src/lib/usage-aggregator.js`
- Read: `src/lib/pricing/index.js`

- [ ] **Step 1: Write failing privacy and boundary tests**

Test `buildLeaderboardDeviceState(rows, options)` for:

1. UTC+8 today, Monday-based week, month, and total boundaries.
2. Multi-device-safe cumulative totals grouped by `source + model`.
3. Decimal token fields serialized as strings.
4. Empty numeric components omitted.
5. Forbidden fixture fields (`project`, `cwd`, `conversation_count`, `skill`, `mcp`, `path`, `quota`) absent from serialized output.
6. Stable SHA-256 for semantically identical row order.
7. `assertCompactStateSize` rejects 8,193 bytes and accepts 8,192 bytes.

Use this public contract in the test:

```js
{
  version: 1,
  device_id: "stable-machine-id",
  captured_at: "2026-07-20T08:00:00.000Z",
  periods: {
    today: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    week:  [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    month: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]],
    total: [["codex", "gpt-5.4", "100", "20", "10", "0", "0"]]
  }
}
```

Tuple order is fixed as:

```text
[source, model, input, output, cache_read, cache_write, reasoning_output]
```

Run:

```powershell
node --test test/leaderboard-state.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the minimum pure builder**

Export exactly:

```js
module.exports = {
  COMPACT_STATE_MAX_BYTES,
  assertCompactStateSize,
  buildLeaderboardDeviceState,
  stableStateHash,
};
```

Use `Intl.DateTimeFormat` with `timeZone: "Asia/Shanghai"` only to derive boundaries. Never accept a client-provided timezone. Reuse existing row normalization and pricing-independent token components; do not include cost in this DTO.

- [ ] **Step 3: Run the focused test**

```powershell
node --test test/leaderboard-state.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/leaderboard-state.js test/leaderboard-state.test.js
git commit -m "feat: build compact leaderboard device state"
```

### Task 3: Expose compact state only through the guarded local API

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `test/local-api-security.test.js`
- Create: `test/local-api-leaderboard-state.test.js`

- [ ] **Step 1: Write failing endpoint tests**

Add tests for `GET /functions/tokentracker-leaderboard-state`:

- returns `Cache-Control: no-store`;
- returns `device_id`, `summary_hash`, and the allowlisted state;
- stays below 8 KiB;
- rejects non-GET methods;
- does not return raw queue rows;
- does not expose `TOKENTRACKER_DEVICE_TOKEN`, InsForge keys, local paths, projects, or conversation metadata.

Run:

```powershell
node --test test/local-api-leaderboard-state.test.js test/local-api-security.test.js
```

Expected: FAIL with endpoint not found.

- [ ] **Step 2: Add the read-only endpoint**

Inside `createLocalApiServer`, reuse the already resolved `qp`, `readQueueData(qp)`, and `getOrCreateMachineId(qp)`. Pass rows into `buildLeaderboardDeviceState`. Return:

```json
{
  "ok": true,
  "summary_hash": "sha256-hex",
  "state": {
    "version": 1,
    "device_id": "stable-machine-id",
    "captured_at": "ISO-8601",
    "periods": {}
  }
}
```

This endpoint computes local state only. It must not contact InsForge.

- [ ] **Step 3: Run focused tests**

```powershell
node --test test/local-api-leaderboard-state.test.js test/local-api-security.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/local-api.js test/local-api-leaderboard-state.test.js test/local-api-security.test.js
git commit -m "feat: expose privacy-safe leaderboard state locally"
```

### Task 3A: Derive the four-period actual-cost summary without exposing details

**Files:**
- Create: `src/lib/leaderboard-actual-cost.js`
- Create: `test/leaderboard-actual-cost.test.js`
- Modify: `src/lib/local-api.js`
- Create: `test/local-api-leaderboard-actual-cost.test.js`
- Read: `dashboard/src/hooks/use-cost-accumulation.js`
- Read: `src/lib/local-api.js` spend-timeseries implementation

- [ ] **Step 1: Write failing aggregation and privacy tests**

Test that the builder reuses the same API, Token 套餐/订阅, and other-AI spend totals already shown by Token Eyes, then returns only:

```json
{
  "captured_at": "2026-07-20T08:00:00.000Z",
  "period_costs_usd": {
    "today": 1.25,
    "week": 8.5,
    "month": 31.75,
    "total": 240.0
  }
}
```

Fixtures must include recurring subscriptions, one-time spend, API cost, and an “other AI” entry. Assert the result never contains record IDs, provider account names, plan names, notes, merchants, payment methods, source-level rows, or individual transactions.

Run:

```powershell
node --test test/leaderboard-actual-cost.test.js test/local-api-leaderboard-actual-cost.test.js
```

Expected: FAIL because the builder and endpoint do not exist.

- [ ] **Step 2: Implement a shared local aggregate**

Extract the minimum reusable arithmetic from the existing spend-timeseries path so the dashboard and leaderboard summary cannot drift. Add:

```text
GET /functions/tokentracker-leaderboard-actual-cost
```

Return `Cache-Control: no-store`. Keep the endpoint read-only and local. “Total” means the same lifetime combined cost currently shown by Token Eyes, not the model-list-price leaderboard metric.

- [ ] **Step 3: Test and commit**

```powershell
node --test test/leaderboard-actual-cost.test.js test/local-api-leaderboard-actual-cost.test.js
git add src/lib/leaderboard-actual-cost.js src/lib/local-api.js test/leaderboard-actual-cost.test.js test/local-api-leaderboard-actual-cost.test.js
git commit -m "feat: summarize actual AI cost for leaderboard consent"
```

## Phase 2: InsForge data model and server pricing

### Task 4: Add compact state, actual cost, run metadata, and RLS

**Files:**
- Create: `scripts/ops/leaderboard-device-state.sql`
- Create: `scripts/ops/leaderboard-actual-cost-state.sql`
- Create: `test/leaderboard-schema-contract.test.js`

- [ ] **Step 1: Write failing schema-contract tests**

The test must assert that the SQL contains:

- `tokentracker_leaderboard_device_state`;
- primary key `(user_id, device_id)`;
- `payload jsonb`;
- `octet_length(payload::text) <= 8192`;
- `captured_at`, `summary_hash`, `state_version`;
- RLS enabled and policies bound to `auth.uid() = user_id`;
- no anonymous write policy;
- `tokentracker_actual_cost_state` with one row per user;
- `share_actual_cost boolean not null default false`;
- four nullable `numeric(20,6)` cost columns;
- authenticated RPCs bind writes to `auth.uid()` and never accept `user_id`;
- a delete function that removes both private state and public snapshots.

Run:

```powershell
node --test test/leaderboard-schema-contract.test.js
```

Expected: FAIL because SQL files do not exist.

- [ ] **Step 2: Implement the SQL schema**

Use these table contracts:

```sql
create table if not exists public.tokentracker_leaderboard_device_state (
  user_id uuid not null,
  device_id text not null check (char_length(device_id) between 8 and 128),
  state_version smallint not null default 1 check (state_version = 1),
  summary_hash text not null check (summary_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id),
  check (octet_length(payload::text) <= 8192)
);

create table if not exists public.tokentracker_actual_cost_state (
  user_id uuid primary key,
  share_actual_cost boolean not null default false,
  today_usd numeric(20,6),
  week_usd numeric(20,6),
  month_usd numeric(20,6),
  total_usd numeric(20,6),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (
    (share_actual_cost and today_usd >= 0 and week_usd >= 0 and month_usd >= 0 and total_usd >= 0)
    or
    (not share_actual_cost and today_usd is null and week_usd is null and month_usd is null and total_usd is null)
  )
);
```

Add `security definer` cleanup RPC `delete_my_leaderboard_data()` with fixed `search_path`, `auth.uid()` lookup, and deletes from device state, actual cost, snapshots, user settings, and custom-avatar metadata. Do not delete the authentication user in this RPC.

Add these authenticated `security definer` RPCs with fixed `search_path` and an explicit null check on `auth.uid()`:

```text
upsert_my_leaderboard_device_state(
  p_device_id text,
  p_state_version smallint,
  p_summary_hash text,
  p_captured_at timestamptz,
  p_payload jsonb
)

set_my_leaderboard_actual_cost(
  p_share boolean,
  p_today_usd numeric,
  p_week_usd numeric,
  p_month_usd numeric,
  p_total_usd numeric,
  p_captured_at timestamptz
)
```

The first derives `user_id` from `auth.uid()`. The second writes all four amounts atomically when `p_share=true`; when false it stores `share_actual_cost=false` and all four amount columns as `null`.

- [ ] **Step 3: Run schema tests**

```powershell
node --test test/leaderboard-schema-contract.test.js
```

Expected: PASS.

- [ ] **Step 4: Apply in InsForge staging**

Apply in this order:

```text
scripts/ops/leaderboard-device-state.sql
scripts/ops/leaderboard-actual-cost-state.sql
```

Verify with authenticated user A that A cannot select, update, or delete user B's state. Add dated evidence to the runbook.

- [ ] **Step 5: Commit**

```powershell
git add scripts/ops/leaderboard-device-state.sql scripts/ops/leaderboard-actual-cost-state.sql test/leaderboard-schema-contract.test.js docs/operations/leaderboard-free-tier-runbook.md
git commit -m "feat: add compact leaderboard state schema"
```

### Task 5: Generate one server pricing seed from the canonical local pricing source

**Files:**
- Modify: `scripts/build-pricing-seed.cjs`
- Create: `scripts/ops/leaderboard-model-pricing.sql`
- Create: `test/leaderboard-pricing-seed.test.js`
- Modify: `test/edge-pricing-parity.test.js`
- Read: `src/lib/pricing/curated-overrides.json`
- Read: `src/lib/pricing/index.js`

- [ ] **Step 1: Write failing generation and parity tests**

The generated SQL must create/upsert:

```sql
public.tokentracker_model_pricing (
  pricing_key text primary key,
  input_usd_per_token numeric(24,12) not null,
  output_usd_per_token numeric(24,12) not null,
  cache_read_usd_per_token numeric(24,12) not null,
  cache_write_usd_per_token numeric(24,12) not null,
  pricing_version text not null
)
```

Tests must cover the regression-prone `gpt-5.4`, `kimi-k2.6`, `mimo-v2.5-pro`, `mimo-v2.5`, and `mimo-v2-flash` mappings. Preserve the five existing Edge copies for account endpoints until they are separately migrated; the updated parity test must continue checking those mirrors against their canonical legacy block.

Run:

```powershell
node --test test/leaderboard-pricing-seed.test.js test/edge-pricing-parity.test.js
```

Expected: FAIL because the SQL output does not exist.

- [ ] **Step 2: Extend the existing generator**

Add a deterministic offline mode:

```powershell
node scripts/build-pricing-seed.cjs --from-existing-snapshot --sql-out scripts/ops/leaderboard-model-pricing.sql
```

The command must read the repository pricing snapshot and curated overrides, emit sorted SQL rows, include a content-hash `pricing_version`, and perform no network request in `--from-existing-snapshot` mode.

- [ ] **Step 3: Regenerate and test**

```powershell
node scripts/build-pricing-seed.cjs --from-existing-snapshot --sql-out scripts/ops/leaderboard-model-pricing.sql
node --test test/leaderboard-pricing-seed.test.js test/edge-pricing-parity.test.js
```

Expected: PASS and a clean second generation (`git diff --exit-code scripts/ops/leaderboard-model-pricing.sql`).

- [ ] **Step 4: Apply the pricing SQL in staging and commit**

```powershell
git add scripts/build-pricing-seed.cjs scripts/ops/leaderboard-model-pricing.sql test/leaderboard-pricing-seed.test.js test/edge-pricing-parity.test.js
git commit -m "feat: generate leaderboard server pricing seed"
```

### Task 6: Move global ranking into one atomic SQL RPC

**Files:**
- Create: `scripts/ops/leaderboard-refresh-rpc.sql`
- Create: `test/leaderboard-refresh-rpc-contract.test.js`
- Read: `scripts/ops/leaderboard-usage-grouped-rpc.sql`

- [ ] **Step 1: Write failing RPC contract tests**

Assert the RPC:

- is named `refresh_leaderboard_snapshots`;
- accepts `p_refresh_month boolean` and `p_refresh_total boolean`;
- expands only the four allowlisted JSON periods;
- sums device states by user/source/model;
- prices with `tokentracker_model_pricing`, never a client amount;
- filters `tokentracker_user_settings.leaderboard_public = true` before `dense_rank`;
- supports `tokens`, `estimated_spend`, and nullable `actual_cost`;
- uses UTC+8 period keys;
- writes a new `snapshot_run_id`, then deletes older rows only after insert succeeds;
- returns row counts, duration, pricing version, and generated time.

Run:

```powershell
node --test test/leaderboard-refresh-rpc-contract.test.js
```

Expected: FAIL.

- [ ] **Step 2: Implement the RPC and snapshot indexes**

Keep the existing `tokentracker_leaderboard_snapshots` table name, but add:

```text
period, metric, source, rank, user_id, total_tokens, estimated_cost_usd,
actual_cost_usd, source_breakdown, display_name, avatar_url, github_url,
pricing_version, generated_at, snapshot_run_id, is_public
```

Required indexes:

```sql
(period, metric, source, snapshot_run_id, rank)
(user_id, period, metric, source, snapshot_run_id)
```

All token totals use `numeric(30,0)`. For the actual-cost metric, exclude users whose value is `null`; never coerce it to zero.

- [ ] **Step 3: Test and apply to staging**

```powershell
node --test test/leaderboard-refresh-rpc-contract.test.js
```

In staging seed:

- one private user with the highest tokens;
- two public users;
- one user with two devices;
- one user without actual-cost sharing.

Verify public ranks are `1, 2`, the private user does not create a rank gap, device totals sum, and actual-cost ranking excludes the non-sharing user.

- [ ] **Step 4: Commit**

```powershell
git add scripts/ops/leaderboard-refresh-rpc.sql test/leaderboard-refresh-rpc-contract.test.js docs/operations/leaderboard-free-tier-runbook.md
git commit -m "feat: refresh leaderboard snapshots in sql"
```

## Phase 3: Client participation without cloud-dashboard mode

### Task 7: Add authenticated direct upsert and local retry state

**Files:**
- Create: `dashboard/src/lib/leaderboard-state-client.ts`
- Create: `dashboard/src/lib/leaderboard-sync-state.ts`
- Create: `dashboard/src/lib/__tests__/leaderboard-state-client.test.ts`
- Create: `dashboard/src/lib/__tests__/leaderboard-sync-state.test.ts`
- Modify: `dashboard/src/lib/cloud-sync-prefs.ts`

- [ ] **Step 1: Write failing client tests**

Cover:

- local state is fetched first;
- no JWT means no write;
- JWT subject is not copied into the request body;
- PostgREST calls only the database RPC `upsert_my_leaderboard_device_state`;
- the RPC body omits `user_id`, and the database binds `auth.uid()`;
- the response uses `Prefer: return=minimal`;
- unchanged `summary_hash` skips the request;
- 8 KiB is checked again before network;
- failure writes `{pending:true}` locally;
- sign-out clears only retry metadata, not local usage.

Run:

```powershell
npm --prefix dashboard test -- src/lib/__tests__/leaderboard-state-client.test.ts src/lib/__tests__/leaderboard-sync-state.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement the state client**

Use an authenticated RPC rather than a trusted body user ID:

```ts
export type LeaderboardSyncReason =
  | "first-login"
  | "leaderboard-open"
  | "daily-catchup"
  | "manual-list-refresh"
  | "app-exit";

export async function syncLeaderboardState(options: {
  getAccessToken: () => Promise<string | null>;
  reason: LeaderboardSyncReason;
  force?: boolean;
}): Promise<{ status: "uploaded" | "unchanged" | "deferred"; summaryHash?: string }>;
```

The SQL RPC accepts only `device_id`, `state_version`, `summary_hash`, `captured_at`, and `payload`; it derives `user_id` from `auth.uid()`.

Keep legacy exports in `cloud-sync-prefs.ts` temporarily for old account-view tests, but mark them internal-deprecated and stop all new callers from using them.

- [ ] **Step 3: Run tests and commit**

```powershell
npm --prefix dashboard test -- src/lib/__tests__/leaderboard-state-client.test.ts src/lib/__tests__/leaderboard-sync-state.test.ts
git add dashboard/src/lib/leaderboard-state-client.ts dashboard/src/lib/leaderboard-sync-state.ts dashboard/src/lib/__tests__/leaderboard-state-client.test.ts dashboard/src/lib/__tests__/leaderboard-sync-state.test.ts dashboard/src/lib/cloud-sync-prefs.ts
git commit -m "feat: upload leaderboard state with jwt and rls"
```

### Task 8: Replace the visible cloud-sync lifecycle with event-driven participation

**Files:**
- Create: `dashboard/src/hooks/use-leaderboard-participation-sync.ts`
- Create: `dashboard/src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/contexts/InsforgeAuthContext.jsx`
- Modify: `dashboard/src/contexts/AccountViewContext.jsx`
- Modify: `dashboard/src/contexts/__tests__/InsforgeAuthContext.test.jsx`
- Create: `dashboard/src/contexts/AccountViewContext.test.jsx`
- Delete after callers migrate: `dashboard/src/hooks/use-cloud-usage-sync.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Prove:

- signed out never uploads;
- first transition to signed in requests `first-login`;
- opening `/leaderboard` requests `leaderboard-open`;
- app start requests `daily-catchup` only when the last success is older than 24 hours and the hash changed;
- no fixed 10/15-minute client timer exists;
- localhost/Tauri `accountView` remains local even when signed in;
- a non-local public web dashboard may retain its existing authenticated cloud view.

Run:

```powershell
npm --prefix dashboard test -- src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx src/contexts/AccountViewContext.test.jsx src/contexts/__tests__/InsforgeAuthContext.test.jsx
```

Expected: FAIL.

- [ ] **Step 2: Implement the hook and local-first account view**

Mount `useLeaderboardParticipationSync()` once in `App.jsx`. Do not make `InsforgeAuthContext` perform network writes; use it only as the signed-in signal. In `AccountViewContext`, resolve:

```js
const accountView = authEnabled && signedIn && !localHost;
const resolving = authLoading && authEnabled && !localHost;
```

Remove cloud-sync preference mirroring from the local dashboard.

- [ ] **Step 3: Remove old refresh coupling**

Delete new-path calls to:

```text
runCloudUsageSyncIfDue
runCloudUsageSyncNow
triggerLeaderboardRefresh
tokentracker-device-token-issue
tokentracker-local-sync with drain=true
```

Keep legacy CLI ingest code server-side for one release only; no UI caller may reach it.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix dashboard test -- src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx src/contexts/AccountViewContext.test.jsx src/contexts/__tests__/InsforgeAuthContext.test.jsx
git add dashboard/src/App.jsx dashboard/src/hooks dashboard/src/contexts
git commit -m "feat: make leaderboard participation event driven"
```

### Task 9: Simplify account settings to profile, actual-cost consent, and deletion

**Files:**
- Modify: `dashboard/src/components/settings/AccountSection.jsx`
- Modify: `dashboard/src/components/settings/AccountSectionParts.jsx`
- Modify: `dashboard/src/components/settings/useAccountProfileSettings.js`
- Create: `dashboard/src/components/settings/AccountSection.test.jsx`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/__tests__/api-public-visibility.test.ts`
- Create: `dashboard/edge-patches/tokentracker-avatar.ts`
- Create: `test/leaderboard-avatar-edge.test.js`
- Create: `scripts/ops/leaderboard-avatar-storage.sql`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing account tests**

Assert:

- signed-out copy says “登录 · 参与排行榜”;
- signed-in settings contain nickname, avatar, GitHub, “公开实际总成本”, sign out, and “退出排行榜并删除数据”;
- there is no “云同步”, “公开主页”, or anonymous toggle;
- login bootstrap sets `leaderboard_public=true`;
- actual-cost consent defaults false;
- turning consent off deletes/nulls cloud cost before UI confirms off;
- turning consent on first reads the local four-period actual-cost endpoint and sends only its four numbers;
- deletion requires confirmation and calls cleanup RPC;
- sign out does not delete participation data.

Run:

```powershell
npm --prefix dashboard test -- src/components/settings/AccountSection.test.jsx src/lib/__tests__/api-public-visibility.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement profile and consent APIs**

Replace the public-visibility payload with:

```ts
{
  leaderboard_public?: true;
  display_name?: string;
  github_url?: string | null;
  show_github_url?: boolean;
  share_actual_cost?: boolean;
  period_costs_usd?: {
    today: number;
    week: number;
    month: number;
    total: number;
  };
}
```

No UI path sets `leaderboard_public=false`; leaving requires the destructive cleanup action. When `share_actual_cost=false`, send no amounts and invoke the server-side nulling path.

- [ ] **Step 3: Add avatar upload constraints**

Create the custom-avatar UI in `AccountSectionParts.jsx` using browser canvas:

- output 96×96 WebP;
- maximum 16 KiB;
- strip metadata by decode/re-encode;
- content-hash filename;
- accept only image input;
- fall back to OAuth avatar if compression cannot meet the limit.

Add tests with a mocked canvas/blob proving the 16 KiB rejection and immutable hash name.

Create private bucket `tokentracker-leaderboard-avatars` and policies in `scripts/ops/leaderboard-avatar-storage.sql`. The authenticated `tokentracker-avatar` Edge endpoint:

- accepts only `PUT image/webp` and `DELETE`;
- limits the decoded request body to 16 KiB;
- validates the RIFF/WEBP signature;
- computes the SHA-256 server-side and ignores any client filename;
- writes `<auth.uid()>/<sha256>.webp`;
- updates the user's avatar metadata only after storage succeeds;
- returns a Cloudflare-facing immutable URL;
- deletes the previous custom object after metadata switches;
- never accepts `user_id`, a remote URL, SVG, HTML, or multipart metadata.

Run:

```powershell
node --test test/leaderboard-avatar-edge.test.js
```

Expected: PASS after the endpoint and policy contract are implemented.

- [ ] **Step 4: Update copy through the canonical CSV**

Add copy keys for consent, deletion, privacy summary, pending sync, and avatar constraints. Mark obsolete cloud-sync/public-profile keys inactive rather than manually editing generated JSON. Run:

```powershell
npm run copy:pull
npm run validate:copy
```

Expected: PASS.

- [ ] **Step 5: Run tests and commit**

```powershell
npm --prefix dashboard test -- src/components/settings/AccountSection.test.jsx src/lib/__tests__/api-public-visibility.test.ts
node --test test/leaderboard-avatar-edge.test.js
git add dashboard/src/components/settings dashboard/src/lib/api.ts dashboard/src/lib/__tests__/api-public-visibility.test.ts dashboard/edge-patches/tokentracker-avatar.ts scripts/ops/leaderboard-avatar-storage.sql test/leaderboard-avatar-edge.test.js dashboard/src/content
git commit -m "feat: simplify leaderboard profile and consent"
```

## Phase 4: Scheduled snapshots and public cache

### Task 10: Reduce the InsForge refresh Edge function to a scheduler wrapper

**Files:**
- Modify: `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`
- Create: `test/leaderboard-refresh-edge.test.js`
- Modify: `docs/operations/leaderboard-free-tier-runbook.md`

- [ ] **Step 1: Write failing wrapper tests**

Assert:

- only a scheduler secret may call it;
- client JWTs are rejected;
- the function calls `refresh_leaderboard_snapshots`;
- every run refreshes today/week;
- `floor(epoch / 900) % 4 === 0` refreshes month;
- `floor(epoch / 900) % 96 === 0` refreshes total;
- it never selects `tokentracker_hourly`;
- it returns counts/duration but no user rows.

Run:

```powershell
node --test test/leaderboard-refresh-edge.test.js
```

Expected: FAIL against the current full-memory implementation.

- [ ] **Step 2: Replace the function**

The Edge handler must be a small authenticated RPC wrapper. Remove the pricing table and user-row loops from this file only after Task 5 moves leaderboard pricing to SQL. Keep legacy pricing mirrors used by account endpoints intact.

- [ ] **Step 3: Configure one global schedule**

Configure `*/15 * * * *` in InsForge, store its secret only in server environment, and disable all client-triggered refresh calls. Record the schedule ID and a successful staging invocation in the runbook.

- [ ] **Step 4: Test and commit**

```powershell
node --test test/leaderboard-refresh-edge.test.js test/edge-pricing-parity.test.js
git add dashboard/edge-patches/tokentracker-leaderboard-refresh.ts test/leaderboard-refresh-edge.test.js docs/operations/leaderboard-free-tier-runbook.md
git commit -m "feat: schedule one global leaderboard refresh"
```

### Task 11: Harden public list and authenticated self-rank endpoints

**Files:**
- Modify: `dashboard/edge-patches/tokentracker-leaderboard.ts`
- Create: `dashboard/edge-patches/tokentracker-leaderboard-me.ts`
- Create: `test/leaderboard-read-edge.test.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/dashboard-preload.js`
- Modify: `dashboard/src/lib/dashboard-preload.d.ts`
- Modify: `dashboard/src/lib/dashboard-preload.leaderboard.test.js`

- [ ] **Step 1: Write failing read-contract tests**

Public endpoint:

- permits `period=today|week|month|total`;
- permits `metric=tokens|estimated_spend|actual_cost`;
- normalizes `source=all|known-source`;
- uses bounded `limit <= 100` and `offset`;
- filters `is_public=true`;
- never accepts or returns a private `user_id` lookup;
- returns `generated_at`, `pricing_version`, and `stale`.

Self endpoint:

- requires JWT;
- derives the user from JWT;
- returns only that user's row/rank;
- sends `Cache-Control: private, no-store`.

Run:

```powershell
node --test test/leaderboard-read-edge.test.js
npm --prefix dashboard test -- src/lib/dashboard-preload.leaderboard.test.js
```

Expected: FAIL.

- [ ] **Step 2: Implement split APIs**

Change dashboard APIs to:

```ts
getLeaderboard({ baseUrl, period, metric, source, limit, offset })
getMyLeaderboardRank({ accessToken, period, metric, source })
```

Remove `user_id` from public preload context and cache keys.

- [ ] **Step 3: Test and commit**

```powershell
node --test test/leaderboard-read-edge.test.js
npm --prefix dashboard test -- src/lib/dashboard-preload.leaderboard.test.js
git add dashboard/edge-patches/tokentracker-leaderboard.ts dashboard/edge-patches/tokentracker-leaderboard-me.ts dashboard/src/lib/api.ts dashboard/src/lib/dashboard-preload.js dashboard/src/lib/dashboard-preload.d.ts dashboard/src/lib/dashboard-preload.leaderboard.test.js test/leaderboard-read-edge.test.js
git commit -m "feat: split public leaderboard and private self rank"
```

### Task 12: Add the Cloudflare Free cache layer

**Files:**
- Create: `cloudflare/leaderboard-cache/package.json`
- Create: `cloudflare/leaderboard-cache/wrangler.toml`
- Create: `cloudflare/leaderboard-cache/src/index.ts`
- Create: `cloudflare/leaderboard-cache/src/index.test.ts`
- Modify: `dashboard/src/lib/config.ts`
- Modify: `dashboard/src/vite-env.d.ts`
- Modify: `docs/operations/leaderboard-free-tier-runbook.md`

- [ ] **Step 1: Write failing Worker tests**

Cover:

- only `/leaderboard` and `/avatars/<sha256>.webp` are proxied;
- query keys are canonicalized to `period + metric + source + limit + offset`;
- success TTL is 900 seconds;
- avatar TTL is one year with `immutable`;
- auth headers and cookies are stripped;
- origin timeout/error returns cached stale data with `stale:true`;
- arbitrary origin paths and avatar traversal are rejected;
- no D1, KV, R2, Durable Object, or paid binding exists.

Run:

```powershell
npm --prefix cloudflare/leaderboard-cache test
```

Expected: FAIL before package/source creation.

- [ ] **Step 2: Implement the Worker**

Use Cache API only. `wrangler.toml` contains environment variables for the InsForge public origin and no storage binding. Add `VITE_LEADERBOARD_PUBLIC_BASE_URL` and make `getLeaderboardBaseUrl()` prefer it, retaining InsForge as emergency build-time fallback.

- [ ] **Step 3: Test and deploy staging**

```powershell
npm --prefix cloudflare/leaderboard-cache install
npm --prefix cloudflare/leaderboard-cache test
npx --prefix cloudflare/leaderboard-cache wrangler deploy --env staging
```

Verify two identical reads yield cache MISS then HIT, and the origin never receives cookies or authorization. Record the staging URL and evidence.

- [ ] **Step 4: Commit**

```powershell
git add cloudflare/leaderboard-cache dashboard/src/lib/config.ts dashboard/src/vite-env.d.ts docs/operations/leaderboard-free-tier-runbook.md
git commit -m "feat: cache public leaderboard on cloudflare"
```

## Phase 5: Leaderboard product UI

### Task 13: Ship four periods, three metrics, source filters, and signed-out viewing

**Files:**
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Modify: `dashboard/src/pages/LeaderboardPage.test.jsx`
- Modify: `dashboard/src/lib/mock-data.ts`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/App.preload.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Write failing UI tests**

Assert:

- visiting while signed out does not auto-open the login modal;
- “登录 · 参与排行榜” opens it only on click;
- period tabs are today/week/month/total with no placeholders;
- metric tabs are Token/预估费用/实际总成本;
- changing period/metric/source changes API params and preload keys;
- actual-cost `null` renders “未公开”, not `0`;
- `generated_at` is visible and stale data shows “更新延迟”;
- signed-in self rank comes from `getMyLeaderboardRank`;
- no cloud-sync enable prompt/button is rendered.

Run:

```powershell
npm --prefix dashboard test -- src/pages/LeaderboardPage.test.jsx src/App.preload.test.jsx
```

Expected: FAIL.

- [ ] **Step 2: Replace placeholders and remove forced login**

Remove the signed-out auto-open effect, `cloudSyncOn`, `handleEnableSync`, and `refreshLeaderboard` calls. Keep the public list functional without auth. Render the selected metric as the primary right-aligned value while retaining source breakdown where relevant.

- [ ] **Step 3: Add the login disclosure**

The login modal must state:

1. login automatically participates and uploads aggregate Token statistics;
2. code, conversations, projects, paths, Skills, MCPs, and files are never uploaded;
3. participation data can be deleted from account settings.

- [ ] **Step 4: Update canonical copy, test, and commit**

```powershell
npm run copy:pull
npm run validate:copy
npm --prefix dashboard test -- src/pages/LeaderboardPage.test.jsx src/App.preload.test.jsx
git add dashboard/src/pages/LeaderboardPage.jsx dashboard/src/pages/LeaderboardPage.test.jsx dashboard/src/lib/mock-data.ts dashboard/src/App.jsx dashboard/src/App.preload.test.jsx dashboard/src/content
git commit -m "feat: complete public leaderboard ui"
```

## Phase 6: Migration, capacity, and release gate

### Task 14: Disable the legacy main path without deleting recovery code

**Files:**
- Modify: `dashboard/src/lib/cloud-sync.ts`
- Modify: `dashboard/src/lib/cloud-sync.test.ts`
- Modify: `src/lib/local-api.js`
- Modify: `test/local-api-account-view.test.js`
- Modify: `test/cloud-sync-prefs.test.js`
- Modify: `dashboard/edge-patches/tokentracker-ingest.ts`
- Modify: `dashboard/edge-patches/tokentracker-device-token-issue.ts`
- Modify: `docs/operations/leaderboard-free-tier-runbook.md`

- [ ] **Step 1: Write failing retirement tests**

Prove that the shipped dashboard has no caller for device-token issue, hourly ingest, local drain sync, or client refresh. Legacy endpoints must return a migration response for unsupported new clients and must reject forbidden compact-state fields.

- [ ] **Step 2: Add a one-release compatibility flag**

Use a server-side-only environment flag:

```text
TOKENTRACKER_LEGACY_HOURLY_INGEST_ENABLED
```

Default it to false for new deployment. Do not expose it in dashboard settings. Keep the old code for rollback through one release, then schedule deletion in the runbook.

- [ ] **Step 3: Test and commit**

```powershell
node --test test/local-api-account-view.test.js test/cloud-sync-prefs.test.js
npm --prefix dashboard test -- src/lib/cloud-sync.test.ts
git add dashboard/src/lib/cloud-sync.ts dashboard/src/lib/cloud-sync.test.ts src/lib/local-api.js test/local-api-account-view.test.js test/cloud-sync-prefs.test.js dashboard/edge-patches/tokentracker-ingest.ts dashboard/edge-patches/tokentracker-device-token-issue.ts docs/operations/leaderboard-free-tier-runbook.md
git commit -m "chore: retire legacy leaderboard upload path"
```

### Task 15: Prove the 6,000-user free-tier envelope

**Files:**
- Create: `scripts/leaderboard-capacity-model.cjs`
- Create: `test/leaderboard-capacity-model.test.js`
- Modify: `docs/operations/leaderboard-free-tier-runbook.md`

- [ ] **Step 1: Write failing capacity assertions**

The deterministic model must assert:

```text
participants = 6000
uploads_per_month <= 180000 + first_login_allowance
upload_payload_bytes <= 8192
upload_bandwidth_gib <= 1.5
global_refresh_calls_per_month <= 2880
worker_requests_per_day <= 30000
estimated_database_megabytes <= 300
avatar_megabytes <= 100
```

Run:

```powershell
node --test test/leaderboard-capacity-model.test.js
```

Expected: FAIL.

- [ ] **Step 2: Implement the model and 70% actions**

Output JSON and a readable table. Map threshold breaches to:

- public TTL 15 → 30 → 60 minutes;
- month refresh hourly → every 4 hours;
- total refresh daily → every 2 days;
- retain today/week at 15 minutes unless Edge calls breach 70%;
- never disable local features or auto-enable billing.

- [ ] **Step 3: Run all verification**

```powershell
node --test test/leaderboard-state.test.js test/local-api-leaderboard-state.test.js test/leaderboard-actual-cost.test.js test/local-api-leaderboard-actual-cost.test.js test/leaderboard-schema-contract.test.js test/leaderboard-pricing-seed.test.js test/leaderboard-refresh-rpc-contract.test.js test/leaderboard-refresh-edge.test.js test/leaderboard-read-edge.test.js test/leaderboard-avatar-edge.test.js test/leaderboard-capacity-model.test.js test/edge-pricing-parity.test.js test/local-api-security.test.js
npm --prefix dashboard test -- src/pages/LeaderboardPage.test.jsx src/components/settings/AccountSection.test.jsx src/lib/__tests__/leaderboard-state-client.test.ts src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx src/contexts/AccountViewContext.test.jsx src/lib/dashboard-preload.leaderboard.test.js
npm --prefix cloudflare/leaderboard-cache test
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npm test
```

Expected: all pass.

- [ ] **Step 4: Run staging acceptance**

Verify:

1. signed-out fresh install works offline;
2. signed-out public leaderboard works;
3. login creates profile and one compact state;
4. second unchanged load performs no write;
5. two devices aggregate;
6. actual cost stays absent until checked and is removed when unchecked;
7. private/deleted users never affect rank numbering;
8. failed cron serves the last stale snapshot;
9. client network capture contains only the allowlisted DTO;
10. InsForge and Cloudflare remain below the runbook warning lines.

- [ ] **Step 5: Commit**

```powershell
git add scripts/leaderboard-capacity-model.cjs test/leaderboard-capacity-model.test.js docs/operations/leaderboard-free-tier-runbook.md
git commit -m "test: verify leaderboard free tier capacity"
```

## Release stop conditions

Do not deploy the client if any of these is true:

- RLS cross-user denial has not been manually verified.
- The compact request can exceed 8 KiB.
- Public rank is computed before the privacy filter.
- Any client upload triggers a global refresh.
- `actual_cost_usd` uses zero for non-consenting users.
- Public traffic bypasses Cloudflare without an explicit incident rollback.
- Capacity evidence projects database, bandwidth, Edge, or Worker usage above the 70% warning line.

## Final handoff

After every task passes, use `superpowers:requesting-code-review`, address findings with `superpowers:receiving-code-review`, then use `superpowers:verification-before-completion`. Because implementation touches `src/` and `dashboard/`, follow the repository release workflow in `CLAUDE.md`; do not publish or deploy production without the user's explicit release authorization.
