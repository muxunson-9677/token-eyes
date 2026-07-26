# Project Cost & Time Tracking — Phase 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give remote-less local folders a project identity, and extend the project-usage summary API with per-project agents, an active-time span, and a full (non-top-N) list plus editable project aliases — the backend half of Phase 1 in `docs/superpowers/specs/2026-07-12-project-cost-time-tracking-design.md`.

**Architecture:** Three additive backend changes, each independently testable: (A) a `file://`-based local-folder fallback in the Codex `cwd` resolver in `src/lib/rollout.js` so non-git / remote-less working dirs get attributed; (B) extend the `tokentracker-project-usage-summary` handler in `src/lib/local-api.js` with `agents[]`, `first_active_at`, `active_bucket_count`, `estimated_active_minutes`, and a `full=1` mode; (C) a new `tokentracker-project-meta` endpoint persisting aliases/pin/hide/tags to `config.json`, applied as `display_name` in the summary. Cost lanes (subscription proration, custom infra costs, package unit-price) and all UI are OUT of scope here — separate plans.

**Tech Stack:** Node ≥20 CommonJS (`src/`), `node --test` runner, existing local-API handler + rollout parser. No new dependencies.

**Scope note:** This is the Phase 1 **backend** subsystem. The Phase 1 **frontend** (Projects list page, hooks, `api.ts`, `copy.csv`, routing) and Phase 2/3 get their own plans. The local-folder fallback here is intentionally scoped to the Codex/every-code `cwd` path (the only currently-parsed source that carries the real working directory); Claude/other local-folder attribution + the known `parseClaudeFile` `repoRoot` free-variable bug are explicitly deferred.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/rollout.js` | Parse AI CLI logs → queue buckets; resolve project identity | Add `buildLocalProjectContext()`; add `allowLocalFallback` option to `resolveProjectContextForPath()`; pass it from the Codex `cwd` site |
| `src/lib/local-api.js` | Local HTTP API handlers | Extend `tokentracker-project-usage-summary`; add module-level `finalizeProjectSummaryEntry()`; add `readProjectMeta()`/`upsertProjectMeta()` closures + `tokentracker-project-meta` handler |
| `test/rollout-parser.test.js` | Parser tests | Add local-folder fallback test |
| `test/usage-caliber-consistency.test.js` | Summary API tests | Add agents/span/full test |
| `test/project-meta-api.test.js` (new) | Project-meta API + alias application | Create |

---

## Task A: Local-folder fallback for remote-less working dirs

**Files:**
- Modify: `src/lib/rollout.js` (add helper near `resolveProjectContextForPath` ~2092; modify that function 2092–2127; modify Codex `cwd` call site 849–855)
- Test: `test/rollout-parser.test.js`

Background: `enqueueTouchedProjectBuckets` (line 1562) drops any bucket lacking BOTH `project_ref` and `project_key`. Today `resolveProjectContextForPath` returns `projectKey: null` (or `null`) whenever there is no git remote, so remote-less folders never produce project rows. We add an opt-in `file://` fallback used only where we have the real working directory (the Codex `cwd`).

- [ ] **Step A1: Write the failing test**

Append to `test/rollout-parser.test.js`:

```js
test("parseRolloutIncremental attributes remote-less local folders via file:// fallback", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-rollout-local-"));
  try {
    const projectDir = path.join(tmp, "06-local-project");
    await fs.mkdir(projectDir, { recursive: true });

    const rolloutPath = path.join(
      tmp,
      "sessions",
      "rollout-2026-07-06T00-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
    );
    await fs.mkdir(path.dirname(rolloutPath), { recursive: true });

    const usage = {
      input_tokens: 5,
      cached_input_tokens: 0,
      output_tokens: 7,
      reasoning_output_tokens: 0,
      total_tokens: 12,
    };
    const lines = [
      buildTurnContextLine({ model: "gpt-5-codex", cwd: projectDir }),
      buildTokenCountLine({ ts: "2026-07-06T00:10:00.000Z", last: usage, total: usage }),
    ];
    await fs.writeFile(rolloutPath, lines.join("\n") + "\n", "utf8");

    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const cursors = { version: 1, files: {}, updatedAt: null };

    await parseRolloutIncremental({
      rolloutFiles: [rolloutPath],
      cursors,
      queuePath,
      projectQueuePath,
    });

    const projectQueued = await readJsonLines(projectQueuePath);
    assert.equal(projectQueued.length, 1);
    assert.equal(projectQueued[0].project_ref, `file://${projectDir}`);
    assert.equal(projectQueued[0].project_key, `file://${projectDir}`);
    assert.equal(projectQueued[0].repo_root, projectDir);
    assert.equal(projectQueued[0].source, "codex");
    assert.equal(projectQueued[0].total_tokens, usage.total_tokens);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step A2: Run the test to verify it fails**

Run: `node --test test/rollout-parser.test.js`
Expected: FAIL — `projectQueued.length` is `0` (no project row emitted because the remote-less `cwd` yields `projectKey: null` and the enqueue gate drops it).

- [ ] **Step A3: Add the `buildLocalProjectContext` helper**

In `src/lib/rollout.js`, immediately BEFORE `async function resolveProjectContextForPath({` (line ~2092), add:

```js
function buildLocalProjectContext(dir) {
  if (typeof dir !== "string") return null;
  const cleaned = dir.trim();
  if (!cleaned) return null;
  const ref = `file://${cleaned}`;
  return {
    projectRef: ref,
    projectKey: ref,
    status: "local",
    repoRoot: cleaned,
  };
}
```

- [ ] **Step A4: Add the `allowLocalFallback` option to `resolveProjectContextForPath`**

Replace the whole function (lines 2092–2127) with:

```js
async function resolveProjectContextForPath({
  startDir,
  projectMetaCache,
  publicRepoCache,
  publicRepoResolver,
  projectState,
  allowLocalFallback = false,
}) {
  if (!startDir) return null;
  const projectMeta = await resolveProjectMetaForPath(startDir, projectMetaCache);
  if (!projectMeta) {
    return allowLocalFallback ? buildLocalProjectContext(startDir) : null;
  }
  const resolver =
    typeof publicRepoResolver === "function" ? publicRepoResolver : defaultPublicRepoResolver;
  const meta = await resolver({
    projectRef: projectMeta.projectRef,
    repoRoot: projectMeta.repoRoot,
    cache: publicRepoCache,
  });
  const repoRootHash = projectMeta.repoRoot ? hashRepoRoot(projectMeta.repoRoot) : null;
  const normalized = {
    ...(meta || {}),
    projectRef: meta?.projectRef || projectMeta.projectRef,
    projectKey: meta?.projectKey || null,
    status: meta?.status || "blocked",
    repoRootHash: meta?.repoRootHash || repoRootHash,
  };
  recordProjectMeta(projectState, normalized);
  if (normalized.status !== "public_verified") {
    if (allowLocalFallback) {
      return buildLocalProjectContext(projectMeta.repoRoot || startDir);
    }
    return {
      projectRef: normalized.projectRef,
      projectKey: null,
      status: normalized.status,
      repoRoot: projectMeta.repoRoot,
    };
  }
  return {
    projectRef: normalized.projectRef,
    projectKey: normalized.projectKey,
    status: normalized.status,
    repoRoot: projectMeta.repoRoot,
  };
}
```

- [ ] **Step A5: Opt the Codex `cwd` resolver into the fallback**

In `parseRolloutFile`, the `cwd` resolution block (lines 849–855), add `allowLocalFallback: true`:

```js
          const context = await resolveProjectContextForPath({
            startDir: nextCwd,
            projectMetaCache,
            publicRepoCache,
            publicRepoResolver,
            projectState,
            allowLocalFallback: true,
          });
```

Do NOT add `allowLocalFallback` to the file-path resolver used for the rollout FILE location (that path points at `~/.codex/sessions`, not the user's repo — a fallback there would misattribute).

- [ ] **Step A6: Run the test to verify it passes**

Run: `node --test test/rollout-parser.test.js`
Expected: PASS (new test + all existing rollout tests, including `parseRolloutIncremental emits project usage buckets with canonicalized project_ref` which must still pass — the git path is unchanged).

- [ ] **Step A7: Commit**

```bash
git add src/lib/rollout.js test/rollout-parser.test.js
git commit -m "feat: attribute remote-less local folders to projects via file:// fallback"
```

---

## Task B: Extend project-usage-summary with agents, active-time span, and full list

**Files:**
- Modify: `src/lib/local-api.js` (add module-level `finalizeProjectSummaryEntry` near `rowDayKey` ~408; modify the `tokentracker-project-usage-summary` handler 4866–5060)
- Test: `test/usage-caliber-consistency.test.js`

- [ ] **Step B1: Write the failing test**

Append to `test/usage-caliber-consistency.test.js`:

```js
test("project-usage-summary returns agents, active-time span, and full list", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-project-agents-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    await writeQueue(queuePath, []);
    await writeQueue(projectQueuePath, [
      { project_key: "file://d:/a", project_ref: "file://d:/a", repo_root: "d:/a", source: "codex", model: "gpt-5", hour_start: "2026-07-06T00:00:00.000Z", total_tokens: 100, conversation_count: 1 },
      { project_key: "file://d:/a", project_ref: "file://d:/a", repo_root: "d:/a", source: "claude", model: "sonnet", hour_start: "2026-07-06T00:30:00.000Z", total_tokens: 50, conversation_count: 1 },
      { project_key: "file://d:/a", project_ref: "file://d:/a", repo_root: "d:/a", source: "codex", model: "gpt-5", hour_start: "2026-07-06T00:30:00.000Z", total_tokens: 30, conversation_count: 1 },
      { project_key: "file://d:/b", project_ref: "file://d:/b", repo_root: "d:/b", source: "gemini", model: "gemini-2", hour_start: "2026-07-05T10:00:00.000Z", total_tokens: 10, conversation_count: 1 },
    ]);

    const body = await callEndpoint(
      queuePath,
      "/functions/tokentracker-project-usage-summary?from=2026-07-05&to=2026-07-06&tz=UTC&full=1",
    );

    assert.equal(body.entries.length, 2);

    const a = body.entries.find((e) => e.project_name === "a");
    assert.ok(a, "project a present");
    assert.equal(a.total_tokens, "180");
    assert.equal(a.active_bucket_count, 2);
    assert.equal(a.estimated_active_minutes, 60);
    assert.equal(a.first_active_at, "2026-07-06T00:00:00.000Z");
    assert.equal(a.last_active_at, "2026-07-06T00:30:00.000Z");
    assert.equal(a.agents.length, 2);
    assert.equal(a.agents[0].source, "codex");
    assert.equal(a.agents[0].total_tokens, "130");
    const claudeAgent = a.agents.find((x) => x.source === "claude");
    assert.equal(claudeAgent.total_tokens, "50");
    assert.equal(a.project_id, a.project_key);

    const b = body.entries.find((e) => e.project_name === "b");
    assert.ok(b, "project b present");
    assert.equal(b.active_bucket_count, 1);
    assert.equal(b.estimated_active_minutes, 30);
    assert.equal(b.agents.length, 1);
    assert.equal(b.agents[0].source, "gemini");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step B2: Run the test to verify it fails**

Run: `node --test test/usage-caliber-consistency.test.js`
Expected: FAIL — `a.agents` is `undefined` (and `active_bucket_count`/`first_active_at` absent); with `full=1` still only top-3 today, but there are 2 projects so length may pass — the agents assertion is the definitive failure.

- [ ] **Step B3: Add the shared `finalizeProjectSummaryEntry` helper**

In `src/lib/local-api.js`, immediately AFTER the `rowDayKey` function (ends line ~420), add:

```js
function finalizeProjectSummaryEntry(e) {
  const total = Number(e.priced_tokens || 0) + Number(e.unpriced_tokens || 0);
  let pricingCoverage = "complete";
  if (total > 0) {
    if (Number(e.unpriced_tokens || 0) === 0) pricingCoverage = "complete";
    else if (Number(e.priced_tokens || 0) === 0) pricingCoverage = "unpriced";
    else pricingCoverage = "partial";
  }
  const agents = Array.from(e.agents ? e.agents.entries() : [])
    .map(([source, v]) => ({
      source,
      total_tokens: String(v.total_tokens || 0),
      cost_usd: String(v.cost_usd || 0),
    }))
    .sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens));
  const activeBucketCount = e.active_buckets ? e.active_buckets.size : 0;
  const { agents: _agents, active_buckets: _activeBuckets, ...rest } = e;
  return {
    ...rest,
    project_id: e.project_key,
    total_tokens: String(e.total_tokens),
    billable_total_tokens: String(e.billable_total_tokens),
    cost_usd: String(e.cost_usd),
    priced_tokens: String(e.priced_tokens || 0),
    unpriced_tokens: String(e.unpriced_tokens || 0),
    pricing_coverage: pricingCoverage,
    request_count: String(e.request_count),
    last_active_at: e.last_active_at || null,
    first_active_at: e.first_active_at || null,
    active_bucket_count: activeBucketCount,
    estimated_active_minutes: activeBucketCount * 30,
    agents,
  };
}
```

- [ ] **Step B4: Read the `full` flag**

In the handler, replace (line ~4869):

```js
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 3), 50);
      const timeZoneContext = getTimeZoneContext(url);
```

with:

```js
      const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 3), 50);
      const full = url.searchParams.get("full") === "1";
      const timeZoneContext = getTimeZoneContext(url);
```

- [ ] **Step B5: Track agents + active buckets in the `byProject` branch**

In the `byProject.set(normalizedKey, {...})` init object (lines ~4899–4914), add three fields (after `last_active_at: null,`):

```js
            last_active_at: null,
            first_active_at: null,
            agents: new Map(),
            active_buckets: new Set(),
```

Then inside the `byProject` row loop, AFTER the existing `last_active_at` update block (line ~4946), add:

```js
        if (hourStart) {
          if (!agg.first_active_at || hourStart < agg.first_active_at) {
            agg.first_active_at = hourStart;
          }
          agg.active_buckets.add(hourStart);
        }
        const agentSource = row.source || "unknown";
        const agent = agg.agents.get(agentSource) || { total_tokens: 0, cost_usd: 0 };
        agent.total_tokens += tokens;
        agent.cost_usd += Number(rowCost.cost_usd || 0);
        agg.agents.set(agentSource, agent);
```

- [ ] **Step B6: Track agents + active buckets in the `bySrc` fallback branch**

In the `bySrc.set(src, {...})` init object (lines ~4970–4984), add (after `last_active_at: null,`):

```js
              last_active_at: null,
              first_active_at: null,
              agents: new Map(),
              active_buckets: new Set(),
```

Inside the `bySrc` row loop, AFTER the existing `last_active_at` update block (line ~5007), add:

```js
          if (hourStart) {
            if (!agg.first_active_at || hourStart < agg.first_active_at) {
              agg.first_active_at = hourStart;
            }
            agg.active_buckets.add(hourStart);
          }
          const agent = agg.agents.get(src) || { total_tokens: 0, cost_usd: 0 };
          agent.total_tokens += row.total_tokens || 0;
          agent.cost_usd += Number(rowCost.cost_usd || 0);
          agg.agents.set(src, agent);
```

- [ ] **Step B7: Replace both entry-building blocks with the shared helper + `full` mode**

Replace the entire `let entries; if (byProject.size === 0) { ... } else { ... }` block (lines ~4960–5056) with:

```js
      let entries;
      if (byProject.size === 0) {
        const rows = readQueueData(qp);
        const bySrc = new Map();
        for (const row of rows) {
          const dayKey = rowDayKey(row, timeZoneContext);
          if (from && dayKey < from) continue;
          if (to && dayKey > to) continue;
          const src = row.source || "unknown";
          if (!bySrc.has(src)) {
            bySrc.set(src, {
              project_key: src,
              project_name: getSourceDisplayName(src) || src,
              project_path: "",
              path_kind: "unknown",
              path_status: "not_detected",
              project_ref: "",
              total_tokens: 0,
              billable_total_tokens: 0,
              cost_usd: 0,
              priced_tokens: 0,
              unpriced_tokens: 0,
              request_count: 0,
              last_active_at: null,
              first_active_at: null,
              agents: new Map(),
              active_buckets: new Set(),
            });
          }
          const agg = bySrc.get(src);
          agg.total_tokens += row.total_tokens || 0;
          agg.billable_total_tokens += row.total_tokens || 0;

          const rowCost = computeRowCostDetailed(row, pricingOptions);
          agg.cost_usd += Number(rowCost.cost_usd || 0);
          agg.priced_tokens += Number(rowCost.priced_tokens || 0);
          agg.unpriced_tokens += Number(rowCost.unpriced_tokens || 0);

          const convCount = Number(row.conversation_count || 0);
          if (convCount > 0) {
            agg.request_count += convCount;
          } else {
            agg.request_count += 1;
          }

          const hourStart = row.hour_start;
          if (hourStart) {
            if (!agg.last_active_at || hourStart > agg.last_active_at) {
              agg.last_active_at = hourStart;
            }
            if (!agg.first_active_at || hourStart < agg.first_active_at) {
              agg.first_active_at = hourStart;
            }
            agg.active_buckets.add(hourStart);
          }
          const agent = agg.agents.get(src) || { total_tokens: 0, cost_usd: 0 };
          agent.total_tokens += row.total_tokens || 0;
          agent.cost_usd += Number(rowCost.cost_usd || 0);
          agg.agents.set(src, agent);
        }
        let sorted = Array.from(bySrc.values()).sort(
          (a, b) => b.billable_total_tokens - a.billable_total_tokens,
        );
        if (!full) sorted = sorted.slice(0, limit);
        entries = sorted.map(finalizeProjectSummaryEntry);
      } else {
        let sorted = Array.from(byProject.values()).sort(
          (a, b) => b.billable_total_tokens - a.billable_total_tokens,
        );
        if (!full) sorted = sorted.slice(0, limit);
        entries = sorted.map(finalizeProjectSummaryEntry);
      }
```

- [ ] **Step B8: Run the test to verify it passes**

Run: `node --test test/usage-caliber-consistency.test.js`
Expected: PASS (new test + existing `project-usage-summary respects date range and limit` still green — default mode still slices to `limit`, and `total_tokens`/`request_count` string outputs are unchanged).

- [ ] **Step B9: Commit**

```bash
git add src/lib/local-api.js test/usage-caliber-consistency.test.js
git commit -m "feat: add per-project agents, active-time span, and full list to project-usage-summary"
```

---

## Task C: Project-meta endpoint + alias applied to summary

**Files:**
- Modify: `src/lib/local-api.js` (add `readProjectMeta`/`upsertProjectMeta` closures near `getPricingOptions` ~2019; add `tokentracker-project-meta` handler near `tokentracker-local-settings` ~5994; extend `finalizeProjectSummaryEntry` + summary handler to apply aliases)
- Test: `test/project-meta-api.test.js` (new)

Project id contract: the summary's normalized key (`e.project_key`, exposed as `project_id` from Task B) is the meta key. Git projects → `owner/repo`; local projects → normalized path (e.g. `d:\a`). The frontend upserts meta using `entry.project_id`.

- [ ] **Step C1: Write the failing test**

Create `test/project-meta-api.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

function createRequest({ method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = headers;
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function readJsonResponse(res) {
  return JSON.parse(res.body.toString("utf8") || "{}");
}

async function call(handler, pathName, options) {
  const req = createRequest(options);
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1:7680${pathName}`));
  assert.equal(handled, true);
  return res;
}

test("project-meta upsert persists alias and applies it as summary display_name", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-project-meta-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    await fs.writeFile(queuePath, "");
    await fs.writeFile(
      projectQueuePath,
      JSON.stringify({
        project_key: "file://d:/a",
        project_ref: "file://d:/a",
        repo_root: "d:/a",
        source: "codex",
        model: "gpt-5",
        hour_start: "2026-07-06T00:00:00.000Z",
        total_tokens: 100,
        conversation_count: 1,
      }) + "\n",
    );

    const handler = createLocalApiHandler({ queuePath, trackerDataDir: trackerDir });

    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const headers = {
      "content-type": "application/json",
      "x-tokentracker-local-auth": token,
      origin: "http://127.0.0.1:7680",
    };

    // Resolve the project_id the summary uses (normalized key), then alias it.
    const before = readJsonResponse(
      await call(handler, "/functions/tokentracker-project-usage-summary?full=1&tz=UTC"),
    );
    const projectId = before.entries[0].project_id;
    assert.equal(before.entries[0].display_name, before.entries[0].project_name);

    const posted = await call(handler, "/functions/tokentracker-project-meta", {
      method: "POST",
      headers,
      body: JSON.stringify({ project_id: projectId, alias: "托管项目", pinned: true }),
    });
    const postedBody = readJsonResponse(posted);
    assert.equal(postedBody.ok, true);
    assert.equal(postedBody.project_meta[projectId].alias, "托管项目");
    assert.equal(postedBody.project_meta[projectId].pinned, true);

    const got = readJsonResponse(await call(handler, "/functions/tokentracker-project-meta"));
    assert.equal(got.project_meta[projectId].alias, "托管项目");

    const after = readJsonResponse(
      await call(handler, "/functions/tokentracker-project-usage-summary?full=1&tz=UTC"),
    );
    const entry = after.entries.find((e) => e.project_id === projectId);
    assert.equal(entry.display_name, "托管项目");
    assert.equal(entry.alias, "托管项目");
    assert.equal(entry.pinned, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("project-meta POST without project_id returns 400", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-project-meta-bad-"));
  try {
    const trackerDir = path.join(tmp, ".tokentracker", "tracker");
    const handler = createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
      trackerDataDir: trackerDir,
    });
    const auth = await call(handler, "/api/local-auth");
    const token = readJsonResponse(auth).token;
    const bad = await call(handler, "/functions/tokentracker-project-meta", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tokentracker-local-auth": token,
        origin: "http://127.0.0.1:7680",
      },
      body: JSON.stringify({ alias: "no id" }),
    });
    assert.equal(bad.statusCode, 400);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step C2: Run the test to verify it fails**

Run: `node --test test/project-meta-api.test.js`
Expected: FAIL — the `/functions/tokentracker-project-meta` route is unhandled (the `call()` assertion `handled === true` fails), and `display_name`/`alias` are absent from summary entries.

- [ ] **Step C3: Add `readProjectMeta` / `upsertProjectMeta` closures**

In `createLocalApiHandler`, immediately AFTER the `getPricingOptions` function (ends line ~2026), add:

```js
  function readProjectMeta() {
    const config = readTrackerConfig();
    return config.projectMeta && typeof config.projectMeta === "object" ? config.projectMeta : {};
  }

  function upsertProjectMeta(body) {
    const payload = body && typeof body === "object" ? body : {};
    const projectId = String(payload.project_id ?? "").trim();
    if (!projectId) {
      const error = new Error("project_id is required");
      error.statusCode = 400;
      error.error_code = "missing_project_id";
      throw error;
    }
    const config = readTrackerConfig();
    const meta =
      config.projectMeta && typeof config.projectMeta === "object"
        ? { ...config.projectMeta }
        : {};
    const prev = meta[projectId] && typeof meta[projectId] === "object" ? meta[projectId] : {};
    const next = { ...prev };
    if (payload.alias !== undefined) next.alias = String(payload.alias ?? "").trim();
    if (payload.pinned !== undefined) next.pinned = Boolean(payload.pinned);
    if (payload.hidden !== undefined) next.hidden = Boolean(payload.hidden);
    if (payload.tags !== undefined) {
      next.tags = Array.isArray(payload.tags)
        ? payload.tags.map((t) => String(t).trim()).filter(Boolean)
        : [];
    }
    next.updated_at = new Date().toISOString();
    meta[projectId] = next;
    config.projectMeta = meta;
    writeTrackerConfig(config);
    return { project_meta: meta };
  }
```

- [ ] **Step C4: Extend `finalizeProjectSummaryEntry` to apply meta**

Replace the `finalizeProjectSummaryEntry` signature and its `return` (from Task B) so it accepts a meta map and emits alias fields. Change the first line to:

```js
function finalizeProjectSummaryEntry(e, projectMetaMap = {}) {
```

and replace the `return { ... };` object's tail (the part from `agents,` onward) so the full return is:

```js
  const meta =
    projectMetaMap && typeof projectMetaMap === "object" ? projectMetaMap[e.project_key] : null;
  const alias = meta && typeof meta.alias === "string" && meta.alias.trim() ? meta.alias.trim() : null;
  return {
    ...rest,
    project_id: e.project_key,
    display_name: alias || e.project_name,
    alias,
    pinned: Boolean(meta && meta.pinned),
    hidden: Boolean(meta && meta.hidden),
    tags: meta && Array.isArray(meta.tags) ? meta.tags : [],
    total_tokens: String(e.total_tokens),
    billable_total_tokens: String(e.billable_total_tokens),
    cost_usd: String(e.cost_usd),
    priced_tokens: String(e.priced_tokens || 0),
    unpriced_tokens: String(e.unpriced_tokens || 0),
    pricing_coverage: pricingCoverage,
    request_count: String(e.request_count),
    last_active_at: e.last_active_at || null,
    first_active_at: e.first_active_at || null,
    active_bucket_count: activeBucketCount,
    estimated_active_minutes: activeBucketCount * 30,
    agents,
  };
```

- [ ] **Step C5: Pass the meta map from the summary handler**

In the summary handler, after the `const full = ...` line (from Task B, ~4870), add:

```js
      const projectMetaMap = readProjectMeta();
```

Then update BOTH `.map(finalizeProjectSummaryEntry)` call sites (from Task B Step B7) to:

```js
        entries = sorted.map((e) => finalizeProjectSummaryEntry(e, projectMetaMap));
```

- [ ] **Step C6: Add the `tokentracker-project-meta` handler**

In `handleLocalApi`, immediately BEFORE the `tokentracker-local-settings` block (line ~5994), add:

```js
    if (p === "/functions/tokentracker-project-meta") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, { project_meta: readProjectMeta() });
        return true;
      }
      if (method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        try {
          const body = await readJsonBody(req);
          json(res, { ok: true, ...upsertProjectMeta(body) });
        } catch (e) {
          json(
            res,
            { ok: false, error: e?.message || "Unable to save project meta" },
            e?.statusCode || 500,
          );
        }
        return true;
      }
      json(res, { ok: false, error: "Method Not Allowed" }, 405);
      return true;
    }
```

- [ ] **Step C7: Run the test to verify it passes**

Run: `node --test test/project-meta-api.test.js`
Expected: PASS (both tests).

- [ ] **Step C8: Run the Task B test again to confirm no regression**

Run: `node --test test/usage-caliber-consistency.test.js`
Expected: PASS — Task B's test does not set `trackerDataDir`, so `readProjectMeta()` returns `{}` and `display_name` falls back to `project_name`; the `project_id`/`agents`/span assertions still hold.

- [ ] **Step C9: Commit**

```bash
git add src/lib/local-api.js test/project-meta-api.test.js
git commit -m "feat: add project-meta alias endpoint and apply aliases to project-usage-summary"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all files pass (97+ files). Pay attention to any test that snapshots the `tokentracker-project-usage-summary` entry shape — new additive fields (`project_id`, `display_name`, `alias`, `pinned`, `hidden`, `tags`, `first_active_at`, `active_bucket_count`, `estimated_active_minutes`, `agents`) should not break equality checks that assert specific fields, but WILL break any `assert.deepEqual` on a whole entry. If one exists, update it to assert the new shape.

- [ ] **Run guardrail validators**

Run: `npm run validate:guardrails`
Expected: PASS (no architecture violations; this plan touches only `src/lib/rollout.js` and `src/lib/local-api.js`, both existing modules).

---

## Self-Review (completed during authoring)

**Spec coverage (Phase 1 backend slice):**
- Local-folder identity (`file://` fallback) → Task A. ✅
- `projectMeta` alias store + CRUD → Task C. ✅
- Summary `agents[]` → Task B. ✅
- Summary time span (`first_active_at` + `active_bucket_count` → `estimated_active_minutes`) → Task B. ✅
- API-metered cost per project → already exists (`cost_usd`); surfaced per-agent in Task B. ✅
- Full (non-top-N) list mode → Task B (`full=1`). ✅
- OUT of scope (correctly deferred to later plans): subscription proration, prepaid-package unit price, custom infra `spendRecords.project_id`/`category`, precise session duration, Claude/other local-folder attribution + `parseClaudeFile` `repoRoot` fix, all frontend.

**Placeholder scan:** none — every code step contains complete code; every run step has an exact command + expected result.

**Type/name consistency:** `buildLocalProjectContext` (A) → context shape `{ projectRef, projectKey, status, repoRoot }` matches what the Codex site reads (`context?.projectRef/projectKey/repoRoot`). `finalizeProjectSummaryEntry` is introduced in B with signature `(e)` then widened in C to `(e, projectMetaMap = {})` with call sites updated in the same task — consistent. `project_id` = `e.project_key` is emitted in B and used as the meta key in C's endpoint and test. `readProjectMeta`/`upsertProjectMeta`/`readTrackerConfig`/`writeTrackerConfig` names match the verified closures.

## Follow-up plans (not this document)
1. **Phase 1 frontend** — `ProjectsPage.jsx` list (display_name + agents + accumulated spend + span/hours), `use-project-usage-summary` extension, `getProjectMeta`/`upsertProjectMeta` in `api.ts`, `copy.csv`, `/projects` route, dashboard tab "view all" link.
2. **Phase 2** — subscription proration + prepaid-package unit price + `spendRecords` `project_id`/`category` + project detail page + `tokentracker-project-detail` endpoint.
3. **Phase 1.5 (small)** — Claude/other cwd-bearing sources local-folder fallback + fix `parseClaudeFile` `repoRoot` free variable (line ~1026).
4. **Phase 3 (optional)** — precise session-duration tracking.
