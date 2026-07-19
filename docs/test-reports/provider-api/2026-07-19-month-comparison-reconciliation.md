# Month-over-month cost comparison reconciliation — 2026-07-19

Worktree: `D:\04-AI-Project\010-Token eye\.worktrees\provider-api`  
Branch: `codex/token-eyes-provider-api`  
Timezone: `Asia/Shanghai`  
As-of: 2026-07-19 (local)

## 1. Locked 口径

**本月至今 vs 上月同期** (`getMonthComparisonRanges`):

| Period | Range |
|---|---|
| current | 本月 1 日 → 今天（本地日） |
| previous | 上月 1 日 → 上月相同日（无该日则钳到上月最后一天） |

Example used below: current `2026-07-01` → `2026-07-19`, previous `2026-06-01` → `2026-06-19`.

Edge case covered in unit tests: March 31 → previous ends Feb 28 (same local day).

## 2. Data source

Live local Token Eyes serve (read-only):

- Process: `token-eyes.exe` (pid 30920) + embedded `tracker.js serve --port 7681`
- Endpoint: `GET http://127.0.0.1:7681/functions/tokentracker-spend-timeseries?from=…&to=…&timeZone=Asia/Shanghai`
- Queried: 2026-07-19

No credentials, prompts, or account secrets were written into this report.

## 3. Component identity (no double-counting)

Backend timeseries totals contract (`src/lib/local-api.js`):

```
combined_usd = api_usd + subscription_usd + other_ai_usd
```

UI mapping (`use-cost-accumulation.js`):

| Ledger bucket | Field |
|---|---|
| API 成本 | `api_usd` → `monthApiCostUsd` |
| Token 套餐订阅成本 | `subscription_usd` → `monthSubscriptionCostUsd` |
| 其他 AI 花销 | `other_ai_usd` → `monthOtherAiCostUsd` |
| 总成本 | `combined_usd` → `monthTotalCostUsd` |

These three buckets are partitioned by source/type in the spend aggregator (`other_ai` vs subscription records vs API usage cost). They are **not** summed twice into `combined_usd`.

## 4. Live ledger totals (USD, redacted)

### 4.1 Current MTD — 2026-07-01 … 2026-07-19

| Bucket | USD |
|---|---:|
| API 成本 | 6555.512581 |
| Token 套餐订阅成本 | 0.000000 |
| 其他 AI 花销 | 146.527778 |
| **总成本** | **6702.040359** |

Check: `6555.512581 + 0 + 146.527778 = 6702.040359` ✓

### 4.2 Previous same-period — 2026-06-01 … 2026-06-19

| Bucket | USD |
|---|---:|
| API 成本 | 463.393724 |
| Token 套餐订阅成本 | 0.000000 |
| 其他 AI 花销 | 8.750000 |
| **总成本** | **472.143724** |

Check: `463.393724 + 0 + 8.75 = 472.143724` ✓

### 4.3 Redacted by-source明细 (combined only)

Sources are product names only (no emails / keys).

**Current MTD**

| source | combined_usd (approx) |
|---|---:|
| codex | 6486.98 |
| other_ai | 146.53 |
| cursor | 67.99 |
| hermes | 0.46 |
| claude | 0.09 |

**Previous same-period**

| source | combined_usd (approx) |
|---|---:|
| codex | 319.76 |
| hermes | 61.31 |
| claude | 55.21 |
| cursor | 27.11 |
| other_ai | 8.75 |

## 5. MoM percentage (correct 口径)

Formula (same as `getMonthComparison` in `CostAccumulation.jsx`):

```
if previous == 0:
  current == 0 → flat copy
  else → new_amount copy (no Infinity %)
else:
  pct = abs((current - previous) / previous * 100) to 1 decimal
  current > previous → increase copy (emerald)
  current < previous → decrease copy (emerald)
```

| Card | current | previous | Direction | % |
|---|---:|---:|---|---:|
| API | 6555.512581 | 463.393724 | increase | 1314.7% |
| Subscription | 0 | 0 | flat | — |
| Other AI | 146.527778 | 8.75 | increase | 1574.6% |
| **Total** | **6702.040359** | **472.143724** | **increase** | **1319.5%** |

## 6. Why the old UI looked like ~401%

Old `getMonthComparisonRanges` compared **full calendar months**:

| Period (old) | Range | combined_usd |
|---|---|---:|
| current (wrong) | 2026-07-01 … 2026-07-31 | 6702.040359 |
| previous (wrong) | 2026-06-01 … 2026-06-30 | 1346.515184 |

Old MoM total: `(6702.040359 - 1346.515184) / 1346.515184 ≈ 397.7%` increase.

That is in the same ballpark as the Task 1 baseline screenshot values (`401.9%` / `405.8%`). Residual gap is expected from capture time / which summary card was photographed / whether other-AI was included in that card — **not** from double-counting of the three ledger buckets.

With MTD vs same elapsed period, the correct total MoM for this ledger is **新增 1319.5%**, not ~401%.

## 7. Double-counting check

| Risk | Result |
|---|---|
| `combined_usd` re-adds API already inside subscription | No — partitions are disjoint |
| Token package UI cards added again into subscription total | No — timeseries `subscription_usd` comes from spend records only |
| Other AI groups section added again into total card | No — total uses `combined_usd`; group cards are a breakdown of `other_ai` |
| Provider API balance / monthSpend mixed into cost MoM | No — balances stay in provider-account section; cost MoM uses spend timeseries only |

## 8. Code / test verification (this task)

```text
npm --prefix dashboard test -- src/lib/date-range.test.ts src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx --run
→ PASS (17 tests)
```

Commit message target: `fix: reconcile month-over-month cost comparison`.
