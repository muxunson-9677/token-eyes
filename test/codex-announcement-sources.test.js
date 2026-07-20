"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const X_EPOCH_MS = 1_288_834_974_657n;
const NOW = Date.parse("2026-07-20T08:00:00.000Z");

function statusIdAt(timeMs, sequence = 0n) {
  return (((BigInt(timeMs) - X_EPOCH_MS) << 22n) + sequence).toString();
}

async function loadModule() {
  return import("../scripts/lib/codex-announcement-sources.mjs");
}

test("allowlist accepts only exact OpenAI and thsottiaux numeric X status URLs", async () => {
  const {
    CODEX_ANNOUNCEMENT_X_AUTHORS,
    parseAllowlistedXStatusUrl,
  } = await loadModule();
  assert.deepEqual(
    CODEX_ANNOUNCEMENT_X_AUTHORS.map(({ username, role }) => ({ username, role })),
    [
      { username: "OpenAI", role: "company" },
      { username: "thsottiaux", role: "head_of_codex" },
    ],
  );

  const id = statusIdAt(NOW - 60_000);
  assert.deepEqual(
    parseAllowlistedXStatusUrl(`https://x.com/OPENAI/status/${id}`),
    {
      source_author: "OpenAI",
      source_post_id: id,
      source_url: `https://x.com/OpenAI/status/${id}`,
    },
  );
  assert.equal(
    parseAllowlistedXStatusUrl(`https://x.com/thsottiaux/status/${id}`)?.source_author,
    "thsottiaux",
  );
  for (const url of [
    `http://x.com/OpenAI/status/${id}`,
    `https://twitter.com/OpenAI/status/${id}`,
    `https://x.com/OpenAI_support/status/${id}`,
    `https://x.com/Tibo/status/${id}`,
    "https://x.com/OpenAI",
    "https://x.com/OpenAI/status/not-a-number",
    `https://x.com/OpenAI/status/${id}/photo/1`,
    `https://x.com/OpenAI/status/${id}?s=20`,
  ]) {
    assert.equal(parseAllowlistedXStatusUrl(url), null, url);
  }
});

test("classification requires Codex, a reset concept, exact authorship, and age <= 48h", async () => {
  const { classifyCodexResetCandidate } = await loadModule();
  const recentId = statusIdAt(NOW - 47 * 60 * 60_000);
  const base = {
    id: recentId,
    text: "Codex usage limit reset with additional usage credit",
    author_username: "thsottiaux",
    created_at: new Date(NOW - 47 * 60 * 60_000).toISOString(),
    source_url: `https://x.com/thsottiaux/status/${recentId}`,
  };
  const candidate = classifyCodexResetCandidate(base, { nowMs: NOW });
  assert.equal(candidate.source_author, "thsottiaux");
  assert.equal(candidate.source_post_id, recentId);
  assert.equal(candidate.review_status, "pending");

  assert.equal(classifyCodexResetCandidate({ ...base, text: "Codex desktop update" }, { nowMs: NOW }), null);
  assert.equal(classifyCodexResetCandidate({ ...base, text: "ChatGPT quota reset" }, { nowMs: NOW }), null);
  assert.equal(classifyCodexResetCandidate({ ...base, author_username: "thsottiaux_" }, { nowMs: NOW }), null);
  assert.equal(classifyCodexResetCandidate({ ...base, is_reply: true }, { nowMs: NOW }), null);
  assert.equal(classifyCodexResetCandidate({ ...base, is_quote: true }, { nowMs: NOW }), null);
  assert.equal(classifyCodexResetCandidate({ ...base, is_repost: true }, { nowMs: NOW }), null);
  assert.equal(
    classifyCodexResetCandidate({
      ...base,
      text: "Codex 额度已重置",
    }, { nowMs: NOW })?.source_post_id,
    recentId,
  );

  const oldId = statusIdAt(NOW - 48 * 60 * 60_000 - 1);
  assert.equal(
    classifyCodexResetCandidate({
      ...base,
      id: oldId,
      source_url: `https://x.com/thsottiaux/status/${oldId}`,
      created_at: new Date(NOW - 48 * 60 * 60_000 - 1).toISOString(),
    }, { nowMs: NOW }),
    null,
  );
});

test("manual mode derives age from the X status ID and rejects timestamp mismatch", async () => {
  const {
    classifyCodexResetCandidate,
    xStatusIdCreatedAt,
  } = await loadModule();
  const recentId = statusIdAt(NOW - 2 * 60 * 60_000, 42n);
  assert.equal(
    xStatusIdCreatedAt(recentId),
    new Date(NOW - 2 * 60 * 60_000).toISOString(),
  );
  const manual = classifyCodexResetCandidate({
    text: "Codex quota reset",
    source_url: `https://x.com/OpenAI/status/${recentId}`,
  }, { nowMs: NOW });
  assert.equal(manual.published_at, new Date(NOW - 2 * 60 * 60_000).toISOString());

  assert.equal(classifyCodexResetCandidate({
    id: recentId,
    text: "Codex quota reset",
    author_username: "OpenAI",
    created_at: new Date(NOW - 24 * 60 * 60_000).toISOString(),
  }, { nowMs: NOW }), null);
});

test("merge deduplicates post IDs and groups an assigned campaign into one review item", async () => {
  const {
    classifyCodexResetCandidate,
    mergeCodexResetCandidates,
  } = await loadModule();
  const firstId = statusIdAt(NOW - 60_000, 1n);
  const secondId = statusIdAt(NOW - 30_000, 2n);
  const first = classifyCodexResetCandidate({
    id: firstId,
    text: "Codex quota reset",
    author_username: "OpenAI",
    campaign_key: "summer-reset",
  }, { nowMs: NOW });
  const second = classifyCodexResetCandidate({
    id: secondId,
    text: "Codex extra usage credit",
    author_username: "thsottiaux",
    campaign_key: "summer-reset",
  }, { nowMs: NOW });

  const merged = mergeCodexResetCandidates([], [first, first, second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].campaign_key, "summer-reset");
  assert.deepEqual(
    merged[0].sources.map((source) => source.source_post_id).sort(),
    [firstId, secondId].sort(),
  );
});

test("recent-search adapter fixes its query, starts exactly 48h back, and returns sanitized data", async () => {
  const {
    X_RECENT_QUERY,
    collectXRecentCandidates,
  } = await loadModule();
  const id = statusIdAt(NOW - 60_000);
  let request;
  const candidates = await collectXRecentCandidates({
    bearerToken: "top-secret",
    nowMs: NOW,
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return {
        ok: true,
        json: async () => ({
          data: [{
            id,
            text: "Codex rate limit reset",
            author_id: "1",
            created_at: new Date(NOW - 60_000).toISOString(),
          }],
          includes: { users: [{ id: "1", username: "OpenAI" }] },
          meta: { newest_id: id },
        }),
      };
    },
  });

  assert.equal(request.url.searchParams.get("query"), X_RECENT_QUERY);
  assert.equal(request.url.searchParams.get("max_results"), "100");
  assert.equal(
    request.url.searchParams.get("start_time"),
    new Date(NOW - 48 * 60 * 60_000).toISOString(),
  );
  assert.equal(request.url.searchParams.get("tweet.fields"), "id,text,author_id,created_at");
  assert.equal(request.url.searchParams.get("expansions"), "author_id");
  assert.equal(request.url.searchParams.get("user.fields"), "username");
  assert.equal(request.options.headers.Authorization, "Bearer top-secret");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_post_id, id);
  assert.doesNotMatch(JSON.stringify(candidates), /top-secret|authorization|headers/i);
});

test("collector provides a free manual path and a neutral missing-token exit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-eyes-x-candidates-"));
  try {
    const textPath = path.join(root, "post.txt");
    const outputPath = path.join(root, "candidates.json");
    const id = statusIdAt(Date.now() - 60_000);
    fs.writeFileSync(textPath, "Codex quota reset", "utf8");
    const manual = spawnSync(process.execPath, [
      "scripts/collect-codex-reset-candidates.mjs",
      "--manual",
      `https://x.com/OpenAI/status/${id}`,
      "--text-file",
      textPath,
      "--output",
      outputPath,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(manual.status, 0, manual.stderr);
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(output.review_items.length, 1);
    assert.equal(output.review_items[0].sources[0].source_post_id, id);

    const env = { ...process.env };
    delete env.X_BEARER_TOKEN;
    const api = spawnSync(process.execPath, [
      "scripts/collect-codex-reset-candidates.mjs",
      "--x-api",
      "--output",
      outputPath,
    ], { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" });
    assert.equal(api.status, 2);
    assert.match(api.stderr, /not configured/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
