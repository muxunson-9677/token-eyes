const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { describe, it } = require("node:test");

const cursorConfig = require("../src/lib/cursor-config");
const {
  parseCursorCsv,
  isCursorBillableKind,
  normalizeCursorUsage,
  isCursorInstalled,
  readCursorAccessTokenFromStateDb,
  extractCursorSessionToken,
  resolveCursorPaths,
} = cursorConfig;

function makeCursorJwt(userId = "user_TEST123") {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: `auth0|${userId}` })).toString("base64url");
  return `${header}.${payload}.sig`;
}

const SYNTHETIC_CURSOR_COOKIE =
  "WorkosCursorSessionToken=synthetic-user%3A%3Asynthetic-jwt-never-real";
const CURSOR_CSV_URL = "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";
const CURSOR_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const MIB = 1024 * 1024;

function syntheticPublicDnsLookup(hostname, options, callback) {
  assert.equal(hostname, "cursor.com");
  assert.deepEqual(options, { all: true, verbatim: true });
  callback(null, [{ address: "8.8.8.8", family: 4 }]);
}

function makeNodeRequestSequence(steps) {
  const calls = [];
  const requestImpl = (options, callback) => {
    const step = steps[calls.length];
    assert.ok(step, `unexpected request #${calls.length + 1}`);

    const request = new EventEmitter();
    const call = {
      options,
      request,
      destroyed: false,
    };
    calls.push(call);

    request.destroy = () => {
      call.destroyed = true;
      if (call.response && !call.response.destroyed) call.response.destroy();
    };
    request.end = () => {
      queueMicrotask(() => {
        if (step.error) {
          request.emit("error", new Error(step.error));
          return;
        }

        const response = Readable.from((function* chunks() {
          for (const chunk of step.chunks || []) {
            call.chunksRead = (call.chunksRead || 0) + 1;
            yield chunk;
          }
        })());
        response.statusCode = step.statusCode ?? 200;
        response.headers = step.headers || {};
        call.response = response;
        callback(response);
      });
    };

    return request;
  };

  return { requestImpl, calls };
}

function makeFetchResponse({ status = 200, headers = {}, chunks = [] } = {}) {
  const state = { pulls: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (state.pulls >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[state.pulls];
      state.pulls += 1;
      controller.enqueue(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    response: new Response(body, { status, headers }),
    state,
  };
}

function makeManualFetchResponse({ status = 200, headers = {}, chunks = [] } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  const state = { reads: 0, cancelled: false };
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      headers: {
        get(name) {
          return normalizedHeaders.get(String(name).toLowerCase()) || null;
        },
      },
      body: {
        locked: false,
        getReader() {
          let index = 0;
          return {
            async read() {
              state.reads += 1;
              if (index >= chunks.length) return { done: true, value: undefined };
              const value = chunks[index];
              index += 1;
              return { done: false, value: typeof value === "string" ? Buffer.from(value) : value };
            },
            async cancel() {
              state.cancelled = true;
            },
          };
        },
      },
    },
    state,
  };
}

async function fetchCursorCsvWithMock(steps) {
  assert.equal(
    typeof cursorConfig.fetchCursorAuthenticated,
    "function",
    "fetchCursorAuthenticated must be an injectable request seam",
  );
  const mock = makeNodeRequestSequence(steps);
  const body = await cursorConfig.fetchCursorAuthenticated({
    urlStr: CURSOR_CSV_URL,
    cookie: SYNTHETIC_CURSOR_COOKIE,
    dnsLookup: syntheticPublicDnsLookup,
    requestImpl: mock.requestImpl,
  });
  return { ...mock, body };
}

async function captureRejection(run) {
  let rejection = null;
  try {
    await run();
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection, "expected operation to reject");
  return rejection;
}

describe("SEC-04 Cursor authenticated redirects", () => {
  it("follows one relative same-origin redirect and keeps the synthetic Cookie on cursor.com", async () => {
    const { calls, body } = await fetchCursorCsvWithMock([
      {
        statusCode: 302,
        headers: { location: "/api/dashboard/download.csv?fixture=1" },
        chunks: [Buffer.from("redirect-body-must-not-be-read")],
      },
      {
        statusCode: 200,
        chunks: [Buffer.from("Date,Model\n")],
      },
    ]);

    assert.equal(body, "Date,Model\n");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.hostname, "cursor.com");
    assert.equal(calls[1].options.hostname, "cursor.com");
    assert.equal(typeof calls[0].options.lookup, "function");
    assert.equal(typeof calls[1].options.lookup, "function");
    assert.equal(calls[1].options.path, "/api/dashboard/download.csv?fixture=1");
    assert.equal(calls[0].options.headers.Cookie, SYNTHETIC_CURSOR_COOKIE);
    assert.equal(calls[1].options.headers.Cookie, SYNTHETIC_CURSOR_COOKIE);
    assert.equal(calls[0].destroyed, true);
    assert.equal(calls[0].response.destroyed, true);
    assert.equal(calls[0].chunksRead || 0, 0);
  });

  it("allows at most one redirect", async () => {
    assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
    const mock = makeNodeRequestSequence([
      { statusCode: 302, headers: { location: "/first.csv" } },
      { statusCode: 302, headers: { location: "/second.csv" } },
    ]);

    await assert.rejects(
      () =>
        cursorConfig.fetchCursorAuthenticated({
          urlStr: CURSOR_CSV_URL,
          cookie: SYNTHETIC_CURSOR_COOKIE,
          dnsLookup: syntheticPublicDnsLookup,
          requestImpl: mock.requestImpl,
        }),
      /redirect/i,
    );
    assert.equal(mock.calls.length, 2);
  });

  it("rejects a non-cursor.com initial URL before sending any request", async () => {
    assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
    const mock = makeNodeRequestSequence([]);

    await assert.rejects(() =>
      cursorConfig.fetchCursorAuthenticated({
        urlStr: "https://www.cursor.com/api/usage-summary",
        cookie: SYNTHETIC_CURSOR_COOKIE,
        dnsLookup: syntheticPublicDnsLookup,
        requestImpl: mock.requestImpl,
      }));

    assert.equal(mock.calls.length, 0);
  });

  for (const [name, location] of [
    ["cross-origin", "https://attacker.example/collect"],
    ["lookalike suffix", "https://cursor.com.attacker.example/collect"],
    ["subdomain", "https://www.cursor.com/collect"],
    ["cross-port", "https://cursor.com:444/collect"],
    ["HTTPS-to-HTTP downgrade", "http://cursor.com/collect"],
    ["URL credentials", "https://synthetic-user@cursor.com/collect"],
  ]) {
    it(`rejects ${name} Location before a second request and never leaks the Cookie`, async () => {
      assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
      const mock = makeNodeRequestSequence([
        { statusCode: 302, headers: { location } },
      ]);

      const error = await captureRejection(() =>
        cursorConfig.fetchCursorAuthenticated({
          urlStr: CURSOR_CSV_URL,
          cookie: SYNTHETIC_CURSOR_COOKIE,
          dnsLookup: syntheticPublicDnsLookup,
          requestImpl: mock.requestImpl,
        }));

      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0].options.headers.Cookie, SYNTHETIC_CURSOR_COOKIE);
      assert.doesNotMatch(String(error?.message || error), /synthetic-jwt-never-real/);
    });
  }

  for (const [name, headers] of [
    ["missing", {}],
    ["invalid", { location: "https://[invalid" }],
  ]) {
    it(`rejects ${name} Location before a second request`, async () => {
      assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
      const mock = makeNodeRequestSequence([{ statusCode: 302, headers }]);

      await assert.rejects(() =>
        cursorConfig.fetchCursorAuthenticated({
          urlStr: CURSOR_CSV_URL,
          cookie: SYNTHETIC_CURSOR_COOKIE,
          dnsLookup: syntheticPublicDnsLookup,
          requestImpl: mock.requestImpl,
        }));
      assert.equal(mock.calls.length, 1);
    });
  }

  for (const statusCode of [401, 500]) {
    it(`destroys a ${statusCode} response without draining its body`, async () => {
      assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
      const mock = makeNodeRequestSequence([
        {
          statusCode,
          chunks: [Buffer.from("error-body-must-not-be-read")],
        },
      ]);

      await assert.rejects(() =>
        cursorConfig.fetchCursorAuthenticated({
          urlStr: CURSOR_CSV_URL,
          cookie: SYNTHETIC_CURSOR_COOKIE,
          dnsLookup: syntheticPublicDnsLookup,
          requestImpl: mock.requestImpl,
        }));

      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0].destroyed, true);
      assert.equal(mock.calls[0].response.destroyed, true);
      assert.equal(mock.calls[0].chunksRead || 0, 0);
    });
  }
});

describe("SEC-04 Cursor CSV response limits", () => {
  it("routes the production CSV wrapper through the injectable authenticated request seam", async () => {
    const mock = makeNodeRequestSequence([
      { statusCode: 200, chunks: [Buffer.from("Date,Model\n")] },
    ]);

    const body = await cursorConfig.fetchCursorUsageCsv({
      cookie: SYNTHETIC_CURSOR_COOKIE,
      dnsLookup: syntheticPublicDnsLookup,
      requestImpl: mock.requestImpl,
    });

    assert.equal(body, "Date,Model\n");
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].options.hostname, "cursor.com");
    assert.equal(typeof mock.calls[0].options.lookup, "function");
  });

  it("pre-rejects Content-Length above 25 MiB and destroys the request", async () => {
    assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
    const mock = makeNodeRequestSequence([
      {
        statusCode: 200,
        headers: { "content-length": String(25 * MIB + 1) },
        chunks: [Buffer.from("must-not-be-buffered")],
      },
    ]);

    const error = await captureRejection(() =>
      cursorConfig.fetchCursorAuthenticated({
        urlStr: CURSOR_CSV_URL,
        cookie: SYNTHETIC_CURSOR_COOKIE,
        dnsLookup: syntheticPublicDnsLookup,
        requestImpl: mock.requestImpl,
      }));

    assert.equal(error.code, "response_too_large");
    assert.equal(mock.calls[0].destroyed, true);
    assert.equal(mock.calls[0].response.destroyed, true);
    assert.doesNotMatch(String(error.message), /synthetic-jwt-never-real/);
  });

  it("destroys the request as soon as streamed CSV bytes exceed 25 MiB", async () => {
    assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
    const mock = makeNodeRequestSequence([
      {
        statusCode: 200,
        chunks: [Buffer.alloc(20 * MIB), Buffer.alloc(6 * MIB)],
      },
    ]);

    const error = await captureRejection(() =>
      cursorConfig.fetchCursorAuthenticated({
        urlStr: CURSOR_CSV_URL,
        cookie: SYNTHETIC_CURSOR_COOKIE,
        dnsLookup: syntheticPublicDnsLookup,
        requestImpl: mock.requestImpl,
      }));

    assert.equal(error.code, "response_too_large");
    assert.equal(mock.calls[0].destroyed, true);
    assert.equal(mock.calls[0].response.destroyed, true);
  });
});

describe("SEC-04 Cursor summary manual redirects and response limits", () => {
  it("uses redirect=manual and follows one relative same-origin Location", async () => {
    const first = makeFetchResponse({
      status: 302,
      headers: { location: "/api/usage-summary-v2" },
    });
    const second = makeFetchResponse({
      status: 200,
      chunks: [JSON.stringify({ membershipType: "synthetic-pro" })],
    });
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? first.response : second.response;
    };

    const body = await cursorConfig.fetchCursorUsageSummary({
      cookie: SYNTHETIC_CURSOR_COOKIE,
      fetchImpl,
    });

    assert.deepEqual(body, { membershipType: "synthetic-pro" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, CURSOR_SUMMARY_URL);
    assert.equal(calls[1].url, "https://cursor.com/api/usage-summary-v2");
    assert.equal(calls[0].options.redirect, "manual");
    assert.equal(calls[1].options.redirect, "manual");
    assert.equal(calls[0].options.headers.Cookie, SYNTHETIC_CURSOR_COOKIE);
    assert.equal(calls[1].options.headers.Cookie, SYNTHETIC_CURSOR_COOKIE);
  });

  it("summary allows at most one redirect", async () => {
    const first = makeFetchResponse({ status: 302, headers: { location: "/first" } });
    const second = makeFetchResponse({ status: 302, headers: { location: "/second" } });
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1 ? first.response : second.response;
    };

    await assert.rejects(() =>
      cursorConfig.fetchCursorUsageSummary({
        cookie: SYNTHETIC_CURSOR_COOKIE,
        fetchImpl,
      }), /redirect/i);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.redirect, "manual");
    assert.equal(calls[1].options.redirect, "manual");
  });

  for (const [name, location] of [
    ["cross-origin", "https://attacker.example/collect"],
    ["lookalike suffix", "https://cursor.com.attacker.example/collect"],
    ["subdomain", "https://www.cursor.com/collect"],
    ["cross-port", "https://cursor.com:444/collect"],
    ["HTTPS-to-HTTP", "http://cursor.com/collect"],
    ["URL credentials", "https://synthetic-user@cursor.com/collect"],
    ["invalid", "https://[invalid"],
    ["missing", null],
  ]) {
    it(`summary rejects ${name} redirect without a second fetch`, async () => {
      const headers = location === null ? {} : { location };
      const redirect = makeFetchResponse({ status: 302, headers });
      const calls = [];
      const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        return redirect.response;
      };

      const error = await captureRejection(() =>
        cursorConfig.fetchCursorUsageSummary({
          cookie: SYNTHETIC_CURSOR_COOKIE,
          fetchImpl,
        }));

      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.redirect, "manual");
      assert.doesNotMatch(String(error?.message || error), /synthetic-jwt-never-real/);
    });
  }

  it("pre-rejects summary Content-Length above 1 MiB without reading the body", async () => {
    const oversized = makeManualFetchResponse({
      status: 200,
      headers: { "content-length": String(MIB + 1) },
      chunks: [Buffer.from("{}")],
    });

    const error = await captureRejection(() =>
      cursorConfig.fetchCursorUsageSummary({
        cookie: SYNTHETIC_CURSOR_COOKIE,
        fetchImpl: async () => oversized.response,
      }));

    assert.equal(error.code, "response_too_large");
    assert.equal(oversized.state.reads, 0);
    assert.equal(oversized.state.cancelled, true);
  });

  it("cancels the summary stream as soon as bytes exceed 1 MiB", async () => {
    const oversized = makeManualFetchResponse({
      status: 200,
      chunks: [Buffer.alloc(700 * 1024), Buffer.alloc(400 * 1024)],
    });

    const error = await captureRejection(() =>
      cursorConfig.fetchCursorUsageSummary({
        cookie: SYNTHETIC_CURSOR_COOKIE,
        fetchImpl: async () => oversized.response,
      }));

    assert.equal(error.code, "response_too_large");
    assert.equal(oversized.state.cancelled, true);
  });
});

describe("SEC-04 Cursor secret redaction", () => {
  it("does not expose a synthetic Cookie in returned errors or stderr", { concurrency: false }, async () => {
    assert.equal(typeof cursorConfig.fetchCursorAuthenticated, "function");
    const mock = makeNodeRequestSequence([
      { error: `network failed for ${SYNTHETIC_CURSOR_COOKIE}` },
    ]);
    const stderr = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = function capture(chunk, ...args) {
      stderr.push(String(chunk));
      if (typeof args.at(-1) === "function") args.at(-1)();
      return true;
    };

    try {
      const error = await captureRejection(() =>
        cursorConfig.fetchCursorAuthenticated({
          urlStr: CURSOR_CSV_URL,
          cookie: SYNTHETIC_CURSOR_COOKIE,
          dnsLookup: syntheticPublicDnsLookup,
          requestImpl: mock.requestImpl,
        }));
      assert.doesNotMatch(String(error?.message || error), /synthetic-jwt-never-real/);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.doesNotMatch(stderr.join(""), /synthetic-jwt-never-real/);
  });

  it("redacts a synthetic Cookie from summary fetch errors", { concurrency: false }, async () => {
    const stderr = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = function capture(chunk, ...args) {
      stderr.push(String(chunk));
      if (typeof args.at(-1) === "function") args.at(-1)();
      return true;
    };

    try {
      const error = await captureRejection(() =>
        cursorConfig.fetchCursorUsageSummary({
          cookie: SYNTHETIC_CURSOR_COOKIE,
          fetchImpl: async () => {
            throw new Error(`summary failed for ${SYNTHETIC_CURSOR_COOKIE}`);
          },
        }));
      assert.doesNotMatch(String(error?.message || error), /synthetic-jwt-never-real/);
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.doesNotMatch(stderr.join(""), /synthetic-jwt-never-real/);
  });
});

// ── parseCursorCsv — new format ──

describe("parseCursorCsv — new format", () => {
  const csvText = `Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"2026-03-20T06:56:12.521Z","Included","composer-2-fast","No","160000","159990","578207","2055","740252","0.49"
"2026-03-19T10:00:00.000Z","Included","claude-4.6-sonnet-medium-thinking","Yes","50000","40000","10000","3000","103000","0.32"`;

  it("returns 2 records", () => {
    const records = parseCursorCsv(csvText);
    assert.equal(records.length, 2);
  });

  it("extracts fields correctly for the first record", () => {
    const records = parseCursorCsv(csvText);
    const r = records[0];
    assert.equal(r.date, "2026-03-20T06:56:12.521Z");
    assert.equal(r.model, "composer-2-fast");
    assert.equal(r.kind, "Included");
    assert.equal(r.maxMode, "No");
    assert.equal(r.inputTokens, 159990);
    assert.equal(r.cacheWriteTokens, 10); // 160000 - 159990
    assert.equal(r.cacheReadTokens, 578207);
    assert.equal(r.outputTokens, 2055);
    assert.equal(r.totalTokens, 740252);
    assert.equal(r.cost, 0.49);
  });

  it("extracts fields correctly for the second record", () => {
    const records = parseCursorCsv(csvText);
    const r = records[1];
    assert.equal(r.date, "2026-03-19T10:00:00.000Z");
    assert.equal(r.model, "claude-4.6-sonnet-medium-thinking");
    assert.equal(r.maxMode, "Yes");
    assert.equal(r.inputTokens, 40000);
    assert.equal(r.cacheWriteTokens, 10000); // 50000 - 40000
    assert.equal(r.cacheReadTokens, 10000);
    assert.equal(r.outputTokens, 3000);
    assert.equal(r.totalTokens, 103000);
    assert.equal(r.cost, 0.32);
  });
});

// ── parseCursorCsv — newest format with Cloud Agent ID / Automation ID ──

describe("parseCursorCsv — with Cloud Agent ID columns", () => {
  const csvText = `Date,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
"2026-04-16T03:32:33.284Z","","","On-Demand","composer-2-fast","No","0","3189","194368","1815","199372","0.11"
"2026-04-15T03:39:53.013Z","","","On-Demand","auto","No","0","132586","93728","2303","228617","0.20"`;

  it("resolves model by header name, not fixed index", () => {
    const records = parseCursorCsv(csvText);
    assert.equal(records.length, 2);
    assert.equal(records[0].model, "composer-2-fast");
    assert.equal(records[0].kind, "On-Demand");
    assert.equal(records[0].inputTokens, 3189);
    assert.equal(records[0].cacheReadTokens, 194368);
    assert.equal(records[0].outputTokens, 1815);
    assert.equal(records[0].totalTokens, 199372);
    assert.equal(records[0].sourceScope, "account");
    assert.equal(records[0].billableKind, "billable");
    assert.equal(records[1].model, "auto");
  });
});

describe("Cursor billing kind classification", () => {
  it("treats included and on-demand usage as billable-ish", () => {
    assert.equal(isCursorBillableKind("Included"), true);
    assert.equal(isCursorBillableKind("On-Demand"), true);
  });

  it("treats free and no-charge errored usage as non-billable", () => {
    assert.equal(isCursorBillableKind("Free"), false);
    assert.equal(isCursorBillableKind("Errored, No Charge"), false);
  });
});

// ── parseCursorCsv — old format ──

describe("parseCursorCsv — old format", () => {
  const csvText = `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you
2025-02-01,gpt-4o,1000,500,200,300,2000,$0.10,$0.10`;

  it("parses old format correctly", () => {
    const records = parseCursorCsv(csvText);
    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.date, "2025-02-01");
    assert.equal(r.model, "gpt-4o");
    assert.equal(r.kind, "unknown");
    assert.equal(r.maxMode, "No");
    assert.equal(r.inputTokens, 500);
    assert.equal(r.cacheWriteTokens, 500); // 1000 - 500
    assert.equal(r.cacheReadTokens, 200);
    assert.equal(r.outputTokens, 300);
    assert.equal(r.totalTokens, 2000);
    assert.equal(r.cost, 0.1);
  });
});

// ── parseCursorCsv — empty/invalid ──

describe("parseCursorCsv — empty/invalid", () => {
  it("returns [] for empty string", () => {
    assert.deepStrictEqual(parseCursorCsv(""), []);
  });

  it("returns [] for header only", () => {
    const csv = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";
    assert.deepStrictEqual(parseCursorCsv(csv), []);
  });
});

// ── normalizeCursorUsage ──

describe("normalizeCursorUsage", () => {
  it("produces standard format output", () => {
    const record = {
      inputTokens: 1000,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      outputTokens: 500,
    };
    const norm = normalizeCursorUsage(record);
    assert.equal(norm.input_tokens, 1000);
    assert.equal(norm.cached_input_tokens, 300);
    assert.equal(norm.cache_creation_input_tokens, 200);
    assert.equal(norm.output_tokens, 500);
    assert.equal(norm.reasoning_output_tokens, 0);
    // total = input + output + cacheWrite + cacheRead = 1000 + 500 + 200 + 300
    assert.equal(norm.total_tokens, 2000);
  });
});

// ── normalizeCursorUsage — edge cases ──

describe("normalizeCursorUsage — edge cases", () => {
  it("all zeros produce all zeros", () => {
    const norm = normalizeCursorUsage({
      inputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
    });
    assert.equal(norm.input_tokens, 0);
    assert.equal(norm.cached_input_tokens, 0);
    assert.equal(norm.cache_creation_input_tokens, 0);
    assert.equal(norm.output_tokens, 0);
    assert.equal(norm.total_tokens, 0);
  });

  it("missing fields default to 0", () => {
    const norm = normalizeCursorUsage({});
    assert.equal(norm.input_tokens, 0);
    assert.equal(norm.cached_input_tokens, 0);
    assert.equal(norm.cache_creation_input_tokens, 0);
    assert.equal(norm.output_tokens, 0);
    assert.equal(norm.total_tokens, 0);
  });

  it("negative values are clamped to 0", () => {
    const norm = normalizeCursorUsage({
      inputTokens: -100,
      cacheWriteTokens: -50,
      cacheReadTokens: -30,
      outputTokens: -10,
    });
    assert.equal(norm.input_tokens, 0);
    assert.equal(norm.cached_input_tokens, 0);
    assert.equal(norm.cache_creation_input_tokens, 0);
    assert.equal(norm.output_tokens, 0);
    assert.equal(norm.total_tokens, 0);
  });
});

// ── resolveCursorPaths ──

describe("resolveCursorPaths", () => {
  it("uses an explicit app data directory for token account detection", () => {
    const appDir = "D:\\AgentData\\Cursor";
    const resolved = resolveCursorPaths({
      appDir,
      home: "C:\\Users\\alice",
      platform: "win32",
      env: {},
    });

    assert.equal(resolved.appDir, appDir);
    assert.equal(resolved.stateDbPath, path.win32.join(appDir, "User", "globalStorage", "state.vscdb"));
  });

  it("uses ~/Library/Application Support/Cursor on macOS", () => {
    const { appDir, stateDbPath } = resolveCursorPaths({
      home: "/Users/alice",
      platform: "darwin",
      env: {},
    });
    assert.equal(appDir, "/Users/alice/Library/Application Support/Cursor");
    assert.equal(
      stateDbPath,
      "/Users/alice/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("uses %APPDATA%\\Cursor on Windows when APPDATA is set", () => {
    const { appDir } = resolveCursorPaths({
      home: "C:\\Users\\alice",
      platform: "win32",
      env: { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" },
    });
    // path.join uses the host separator; just check the suffix
    assert.ok(
      appDir.endsWith("Cursor"),
      `expected appDir to end with Cursor, got ${appDir}`,
    );
    assert.ok(
      appDir.includes("AppData") && appDir.includes("Roaming"),
      `expected AppData/Roaming in path, got ${appDir}`,
    );
  });

  it("falls back to <home>/AppData/Roaming/Cursor on Windows when APPDATA is missing", () => {
    const { appDir } = resolveCursorPaths({
      home: "C:\\Users\\alice",
      platform: "win32",
      env: {},
    });
    assert.ok(
      appDir.includes("AppData") && appDir.includes("Roaming") && appDir.endsWith("Cursor"),
      `expected fallback AppData/Roaming/Cursor, got ${appDir}`,
    );
  });

  it("uses XDG_CONFIG_HOME on Linux when set", () => {
    const { appDir } = resolveCursorPaths({
      home: "/home/alice",
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/home/alice/.cfg" },
    });
    assert.equal(appDir, "/home/alice/.cfg/Cursor");
  });

  it("falls back to ~/.config/Cursor on Linux", () => {
    const { appDir } = resolveCursorPaths({
      home: "/home/alice",
      platform: "linux",
      env: {},
    });
    assert.equal(appDir, "/home/alice/.config/Cursor");
  });

  it("keeps cliConfigPath at ~/.cursor/cli-config.json on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"]) {
      const { cliConfigPath } = resolveCursorPaths({
        home: "/h",
        platform,
        env: { APPDATA: "C:\\AppData" },
      });
      assert.ok(
        cliConfigPath.endsWith("cli-config.json") && cliConfigPath.includes(".cursor"),
        `[${platform}] expected ~/.cursor/cli-config.json, got ${cliConfigPath}`,
      );
    }
  });
});

// ── isCursorInstalled ──

describe("isCursorInstalled", () => {
  it("returns a boolean", () => {
    const result = isCursorInstalled();
    assert.equal(typeof result, "boolean");
  });

  it("returns false when the resolved appDir does not exist (Windows)", () => {
    const result = isCursorInstalled({
      home: "/tmp/nonexistent-cursor-windows-home",
      platform: "win32",
      env: { APPDATA: "/tmp/nonexistent-cursor-appdata" },
    });
    assert.equal(result, false);
  });

  it("returns false when the resolved appDir does not exist (Linux)", () => {
    const result = isCursorInstalled({
      home: "/tmp/nonexistent-cursor-linux-home",
      platform: "linux",
      env: {},
    });
    assert.equal(result, false);
  });
});

// ── extractCursorSessionToken ──

describe("extractCursorSessionToken", () => {
  it("returns null for non-existent home dir", () => {
    const result = extractCursorSessionToken({
      home: "/tmp/nonexistent-cursor-test-home",
      platform: "linux",
      env: {},
    });
    assert.equal(result, null);
  });

  it("reads the Cursor access token via sqlite3 CLI", () => {
    const jwt = makeCursorJwt();
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-db-")), "state.vscdb");
    fs.writeFileSync(dbPath, "", "utf8");
    const token = readCursorAccessTokenFromStateDb(dbPath, {
      execFileSync: (cmd, args, opts) => {
        assert.equal(cmd, "sqlite3");
        assert.deepEqual(args, [
          "-json",
          dbPath,
          "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';",
        ]);
        assert.equal(opts.encoding, "utf8");
        return JSON.stringify([{ value: jwt }]);
      },
      requireFn: () => {
        throw new Error("node:sqlite should not be used when sqlite3 works");
      },
      env: {},
    });

    assert.equal(token, jwt);
  });

  it("falls back to node:sqlite when sqlite3 CLI is unavailable", () => {
    const jwt = makeCursorJwt();
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-db-")), "state.vscdb");
    fs.writeFileSync(dbPath, "", "utf8");
    let closed = false;
    const token = readCursorAccessTokenFromStateDb(dbPath, {
      execFileSync: () => {
        throw new Error("spawn sqlite3 ENOENT");
      },
      requireFn: (name) => {
        assert.equal(name, "node:sqlite");
        return {
          DatabaseSync: class FakeDatabaseSync {
            constructor(actualDbPath, options) {
              assert.equal(actualDbPath, dbPath);
              assert.deepEqual(options, { readOnly: true });
            }

            prepare(sql) {
              assert.equal(sql, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';");
              return {
                all() {
                  return [{ value: ` ${jwt}\n` }];
                },
              };
            }

            close() {
              closed = true;
            }
          },
        };
      },
      env: {},
    });

    assert.equal(token, jwt);
    assert.equal(closed, true);
  });

  it("returns null when neither sqlite reader can read the token", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-db-")), "state.vscdb");
    fs.writeFileSync(dbPath, "", "utf8");
    const token = readCursorAccessTokenFromStateDb(dbPath, {
      execFileSync: () => {
        throw new Error("spawn sqlite3 ENOENT");
      },
      requireFn: () => {
        throw new Error("No such built-in module: node:sqlite");
      },
      env: {},
      stderr: { write() {} },
    });

    assert.equal(token, null);
  });

  it("builds the Cursor cookie when token reading falls back to node:sqlite", () => {
    const jwt = makeCursorJwt("user_FALLBACK");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-home-"));
    const { stateDbPath } = resolveCursorPaths({ home, env: {} });
    fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
    fs.writeFileSync(stateDbPath, "", "utf8");
    const result = extractCursorSessionToken({
      home,
      env: {},
      deps: {
        execFileSync: () => {
          throw new Error("spawn sqlite3 ENOENT");
        },
        requireFn: () => ({
          DatabaseSync: class FakeDatabaseSync {
            prepare() {
              return {
                all() {
                  return [{ value: jwt }];
                },
              };
            }

            close() {}
          },
        }),
        env: {},
      },
    });

    assert.deepEqual(result, {
      cookie: `WorkosCursorSessionToken=user_FALLBACK%3A%3A${jwt}`,
      userId: "user_FALLBACK",
    });
  });

  it("accepts Google OAuth subject from cli-config.json (issue #88)", () => {
    const subject = "google-oauth2|105551234567890123456";
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-google-"));
    const { stateDbPath, cliConfigPath } = resolveCursorPaths({ home, env: {} });
    fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
    fs.writeFileSync(stateDbPath, "", "utf8");
    fs.mkdirSync(path.dirname(cliConfigPath), { recursive: true });
    fs.writeFileSync(cliConfigPath, JSON.stringify({ authInfo: { authId: subject } }), "utf8");

    const result = extractCursorSessionToken({
      home,
      env: {},
      deps: {
        execFileSync: () => JSON.stringify([{ value: jwt }]),
        requireFn: () => {
          throw new Error("sqlite3 CLI used");
        },
        env: {},
      },
    });

    assert.deepEqual(result, {
      cookie: `WorkosCursorSessionToken=${subject}%3A%3A${jwt}`,
      userId: subject,
    });
  });

  it("falls back to Google OAuth subject from JWT when cli-config is missing", () => {
    const subject = "google-oauth2|987654321098765432109";
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-google-jwt-"));
    const { stateDbPath } = resolveCursorPaths({ home, env: {} });
    fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
    fs.writeFileSync(stateDbPath, "", "utf8");

    const result = extractCursorSessionToken({
      home,
      env: {},
      deps: {
        execFileSync: () => JSON.stringify([{ value: jwt }]),
        requireFn: () => {
          throw new Error("sqlite3 CLI used");
        },
        env: {},
      },
    });

    assert.deepEqual(result, {
      cookie: `WorkosCursorSessionToken=${subject}%3A%3A${jwt}`,
      userId: subject,
    });
  });

  it("accepts github WorkOS subject", () => {
    const subject = "github|42";
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: subject })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-gh-"));
    const { stateDbPath } = resolveCursorPaths({ home, env: {} });
    fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
    fs.writeFileSync(stateDbPath, "", "utf8");

    const result = extractCursorSessionToken({
      home,
      env: {},
      deps: {
        execFileSync: () => JSON.stringify([{ value: jwt }]),
        requireFn: () => {
          throw new Error("sqlite3 CLI used");
        },
        env: {},
      },
    });

    assert.equal(result.userId, subject);
  });

  it("still returns null for unrecognized JWT subjects", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "saml|enterprise-xyz" })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-cursor-unknown-"));
    const { stateDbPath } = resolveCursorPaths({ home, env: {} });
    fs.mkdirSync(path.dirname(stateDbPath), { recursive: true });
    fs.writeFileSync(stateDbPath, "", "utf8");

    const result = extractCursorSessionToken({
      home,
      env: {},
      deps: {
        execFileSync: () => JSON.stringify([{ value: jwt }]),
        requireFn: () => {
          throw new Error("sqlite3 CLI used");
        },
        env: {},
      },
    });

    assert.equal(result, null);
  });
});
