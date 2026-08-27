"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { transformSync } = require("esbuild");

const EDGE_PATH = path.join(
  __dirname,
  "../dashboard/edge-patches/tokentracker-codex-reset-collector.ts",
);

function loadCollectorInternals(fetchImpl = globalThis.fetch) {
  const source = fs.readFileSync(EDGE_PATH, "utf8")
    .replace(
      'import { createClient } from "npm:@insforge/sdk";',
      "const createClient = () => ({ database: null });",
    )
    .replace("export default async function", "async function edgeHandler");
  const instrumented = `${source}\nexport { classifyResetScope, correlateTiboResetPosts, tiboCandidate, verifyTiboAnnouncement };`;
  const transformed = transformSync(instrumented, {
    format: "cjs",
    loader: "ts",
    target: "es2022",
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(transformed, {
    URL,
    Response,
    TextDecoder,
    TextEncoder,
    atob,
    btoa,
    console,
    crypto: globalThis.crypto,
    fetch: fetchImpl,
    module,
    exports: module.exports,
    require,
  });
  return module.exports;
}

const REAL_SCHEDULE_ID = "2091407991736332689";
const REAL_LANDED_ID = "2091688655828246890";
const REAL_SCHEDULE_BODY = [
  "Update on rate limits in Codex.",
  "We’ve found (a) some inefficiencies when using images in long sessions with multiple compactions (b) high p95+ usage for Computer History (c) a feature that was meant to generate conversation titles that was draining a bit more usage than intended. And we have a tiger team combing through everything and shipping fixes tomorrow. We also found a novel approach to drive efficiency up significantly that is completely unrelated and we will be working on next week.",
  "As part of some of the fixes tomorrow, we will also do a full reset of the usage for all paid subscriptions.",
  "See you then.",
].join("\n\n");
const REAL_LANDED_BODY = "Good Sunday. Reset has been propagated to accounts and we landed some fixes to usage for things mentioned yesterday as issues we found. You should feel a positive difference. More to come tomorrow and will keep communicating.";
const REAL_QUOTE_SHORT_URL = "https://t.co/6mgUetJnhg";

function xPage(postId, body) {
  const sourceUrl = `https://x.com/thsottiaux/status/${postId}`;
  return `<html><body><article itemID="${sourceUrl}" itemScope="" itemType="https://schema.org/SocialMediaPosting"><div dir="auto"><span>${body.replaceAll("\n", "<br>")}</span></div></article></body></html>`;
}

function xOembed(postId, text, shortUrl = null) {
  const sourceUrl = `https://x.com/thsottiaux/status/${postId}`;
  const link = shortUrl ? ` <a href="${shortUrl}">${shortUrl}</a>` : "";
  return {
    url: sourceUrl,
    author_url: "https://x.com/thsottiaux",
    provider_name: "X",
    html: `<blockquote><p>${text}${link}</p>&mdash; Tibo (@thsottiaux)</blockquote>`,
  };
}

function authoritativeXFetch({ quoteTargetId = REAL_SCHEDULE_ID, scheduleBody = REAL_SCHEDULE_BODY } = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://publish.x.com") {
      const sourceUrl = new URL(url.searchParams.get("url"));
      const postId = sourceUrl.pathname.split("/").at(-1);
      if (postId === REAL_LANDED_ID) {
        return Response.json(xOembed(postId, REAL_LANDED_BODY, REAL_QUOTE_SHORT_URL));
      }
      if (postId === REAL_SCHEDULE_ID) {
        return Response.json(xOembed(
          postId,
          "Update on rate limits in Codex. We’ve found (a) some inefficiencies when using images in long sessions with multiple compactions (b) high p95+ usage for Computer History (c) a feature that was meant to generate conversation titles that was draining a bit more usage than…",
        ));
      }
    }
    if (url.hostname === "x.com") {
      const postId = url.pathname.split("/").at(-1);
      if (postId === REAL_LANDED_ID) return new Response(xPage(postId, REAL_LANDED_BODY));
      if (postId === REAL_SCHEDULE_ID) return new Response(xPage(postId, scheduleBody));
    }
    if (url.href === REAL_QUOTE_SHORT_URL && init.redirect === "manual") {
      return new Response(null, {
        status: 301,
        headers: { location: `https://twitter.com/thsottiaux/status/${quoteTargetId}` },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

function tiboResult(id, text, quoteId = null) {
  return {
    url: `https://x.com/thsottiaux/status/${id}`,
    text,
    author: {
      screen_name: "thsottiaux",
      url: "https://x.com/thsottiaux",
    },
    ...(quoteId ? { quote: { id: quoteId } } : {}),
  };
}

test("collector discovers Tibo posts without a paid search dependency and verifies each match through X", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /LEADERBOARD_SCHEDULER_SECRET/u);
  assert.match(source, /Authorization/u);
  assert.match(source, /https:\/\/status\.openai\.com\/api\/v2\/incidents\.json/u);
  assert.match(source, /https:\/\/api\.fxtwitter\.com\/2\/profile\/thsottiaux\/statuses/u);
  assert.match(source, /https:\/\/publish\.x\.com\/oembed/u);
  assert.match(source, /author_url/u);
  assert.match(source, /https:\/\/x\.com\/thsottiaux/u);
  assert.doesNotMatch(source, /TAVILY_API_KEY/u);
  assert.match(source, /CODEX_RESET_SIGNING_KEY_PKCS8_B64/u);
  assert.match(source, /Ed25519/u);
  assert.match(source, /tokentracker_codex_reset_feed_state/u);
  assert.match(source, /x_status:\s*xStatus/u);
  assert.doesNotMatch(source, /pay-as-you-go|billing|credit card/iu);
});

test("collector backfills and retains exact Tibo reset announcements for 30 days", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");

  assert.match(source, /url\.pathname\.match\(\/\^\\\/thsottiaux\\\/status\\\//u);
  assert.match(source, /\(\[0-9\]\+\)/u);
  assert.match(source, /X_WINDOW_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60_000/u);
  assert.match(source, /ANNOUNCEMENT_RETENTION_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60_000/u);
  assert.match(source, /cursor\?\.bottom/u);
  assert.match(source, /searchParams\.set\("cursor"/u);
  assert.match(source, /MAX_X_PAGES/u);
  assert.match(source, /\.slice\(0,\s*100\)/u);
  assert.match(source, /RESET_CONCEPT/u);
  assert.match(source, /CODEX_CONCEPT/u);
  assert.match(source, /reset_kind/u);
  assert.match(source, /reset_scope/u);
  assert.match(source, /classifyResetKind/u);
  assert.match(source, /classifyResetScope/u);
  assert.match(source, /CONFIRMED_RESET_CONCEPT/u);
  assert.match(source, /SCHEDULED_RESET_CONCEPT/u);
  assert.match(source, /correlateTiboResetPosts/u);
  assert.match(source, /state\s*!==\s*"confirmed"/u);
  assert.doesNotMatch(source, /body:\s*candidate\.text/u);
  assert.doesNotMatch(source, /summary:\s*candidate\.text\.slice\(0,\s*240\)/u);
  assert.match(source, /filter\(isConfirmedRetainedAnnouncement\)/u);
  assert.doesNotMatch(source, /!CODEX_CONCEPT\.test\(text\)[\s\S]{0,120}!GLOBAL_RESET_CONCEPT\.test\(text\)/u);
});

test("collector semantics classify the real schedule and landing states separately", () => {
  const source = fs.readFileSync(EDGE_PATH, "utf8");
  const readRegex = (name) => {
    const line = source.split(/\r?\n/u).find((value) => value.startsWith(`const ${name} = /`));
    assert.ok(line, `${name} must exist`);
    return vm.runInNewContext(line.slice(line.indexOf("=") + 1, -1).trim());
  };
  const confirmed = readRegex("CONFIRMED_RESET_CONCEPT");
  const scheduled = readRegex("SCHEDULED_RESET_CONCEPT");
  const scheduleText = "The banked reset will be there by 8pm PST. For all paid users of ChatGPT Work and Codex.";
  const landedText = "The banked reset has landed, I repeat, the banked reset has landed. Have an amazing weekend.";
  assert.equal(scheduled.test(scheduleText), true);
  assert.equal(confirmed.test(scheduleText), false);
  assert.equal(confirmed.test(landedText), true);
});

test("collector correlates the real 18.5875-hour quoted reset while keeping a bounded proof window", () => {
  const {
    correlateTiboResetPosts,
    tiboCandidate,
  } = loadCollectorInternals();
  const nowMs = Date.parse("2026-08-27T08:00:00.000Z");
  const scheduleId = REAL_SCHEDULE_ID;
  const landedId = REAL_LANDED_ID;
  const schedule = tiboCandidate(tiboResult(
    scheduleId,
    "Update on rate limits in Codex. As part of the fixes tomorrow, we will also do a full reset of the usage for all paid subscriptions.",
  ), nowMs);
  const landed = tiboCandidate(tiboResult(
    landedId,
    "Good Sunday. Reset has been propagated to accounts and we landed some fixes to usage for things mentioned yesterday.",
    scheduleId,
  ), nowMs);

  assert.ok(schedule);
  assert.ok(landed);
  const correlationHours = (landed.publishedMs - schedule.publishedMs) / (60 * 60_000);
  assert.ok(correlationHours > 18.58 && correlationHours < 18.59);
  const correlated = correlateTiboResetPosts([schedule, landed]);
  assert.equal(correlated.length, 1);
  assert.equal(correlated[0].postId, landedId);

  const unrelated = { ...landed, quotedPostId: null };
  assert.equal(correlateTiboResetPosts([schedule, unrelated]).length, 0);
  const beyondBound = {
    ...landed,
    publishedMs: schedule.publishedMs + 24 * 60 * 60_000 + 1,
  };
  assert.equal(correlateTiboResetPosts([schedule, beyondBound]).length, 0);
});

test("collector signs only X-authoritative text and proves the real quoted schedule through t.co", async () => {
  const {
    correlateTiboResetPosts,
    tiboCandidate,
    verifyTiboAnnouncement,
  } = loadCollectorInternals(authoritativeXFetch());
  const nowMs = Date.parse("2026-08-27T08:00:00.000Z");
  const schedule = tiboCandidate(tiboResult(
    REAL_SCHEDULE_ID,
    `${REAL_SCHEDULE_BODY}\nFORGED DISCOVERY APPENDIX`,
  ), nowMs);
  const landed = tiboCandidate(tiboResult(
    REAL_LANDED_ID,
    `${REAL_LANDED_BODY} FORGED DISCOVERY APPENDIX`,
    REAL_SCHEDULE_ID,
  ), nowMs);
  const [correlated] = correlateTiboResetPosts([schedule, landed]);

  const announcement = await verifyTiboAnnouncement(correlated);

  assert.ok(announcement);
  assert.equal(announcement.body, REAL_LANDED_BODY);
  assert.equal(announcement.summary, REAL_LANDED_BODY.slice(0, 240));
  assert.equal(announcement.reset_kind, "hard");
  assert.equal(announcement.reset_scope, "all_paid_users");
  assert.doesNotMatch(announcement.body, /FORGED DISCOVERY APPENDIX/u);
});

test("collector rejects a landing when X cannot prove its quoted schedule or schedule body", async () => {
  const nowMs = Date.parse("2026-08-27T08:00:00.000Z");
  const scheduleResult = tiboResult(REAL_SCHEDULE_ID, REAL_SCHEDULE_BODY);
  const landedResult = tiboResult(REAL_LANDED_ID, REAL_LANDED_BODY, REAL_SCHEDULE_ID);

  for (const fetchImpl of [
    authoritativeXFetch({ quoteTargetId: "2091407991736332690" }),
    authoritativeXFetch({ scheduleBody: "Update on rate limits in Codex, but no reset was announced." }),
  ]) {
    const {
      correlateTiboResetPosts,
      tiboCandidate,
      verifyTiboAnnouncement,
    } = loadCollectorInternals(fetchImpl);
    const correlated = correlateTiboResetPosts([
      tiboCandidate(scheduleResult, nowMs),
      tiboCandidate(landedResult, nowMs),
    ]);
    assert.equal(correlated.length, 1);
    assert.equal(await verifyTiboAnnouncement(correlated[0]), null);
  }
});

test("collector classifies an explicit all-paid-subscriptions reset scope", () => {
  const { classifyResetScope } = loadCollectorInternals();
  assert.equal(
    classifyResetScope("We will do a full reset of usage for all paid subscriptions."),
    "all_paid_users",
  );
});
