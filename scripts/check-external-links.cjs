#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const {
  SafeOutboundError,
  SECRET_QUERY_PARAMS,
  readLimitedResponseBody,
  safeOutboundRequest,
  validateOutboundUrl,
} = require("../src/lib/safe-outbound-request");

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const BODY_CAP_BYTES = 512 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOGIN_REQUIRED_STATUSES = new Set([401, 403]);
const ALLOWED_SOURCE_TYPES = new Set([
  "official_announcement",
  "official_console",
  "official_document",
  "official_pricing",
  "official_product",
  "official_repository",
  "third_party_comparison",
]);
const LIVE_FAILURE_CLASSIFICATIONS = new Set([
  "content_drift",
  "http_error",
  "transport_error",
  "unsafe_target",
]);
const SENSITIVE_URL_PARAM_KEYS = new Set([
  ...Array.from(SECRET_QUERY_PARAMS, (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "")),
  "code",
  "authcode",
  "authorizationcode",
  "oauthcode",
  "state",
  "authorizationstate",
  "oauthstate",
  "ticket",
  "authticket",
  "oauthticket",
  "idtoken",
  "idtokenhint",
  "devicecode",
  "usercode",
  "clientassertion",
  "assertion",
  "samlresponse",
  "samlrequest",
  "relaystate",
  "sessionstate",
  "codeverifier",
]);

function canonicalParameterName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveParameterName(value) {
  const key = canonicalParameterName(value);
  return SENSITIVE_URL_PARAM_KEYS.has(key) ||
    key.endsWith("accesstoken") ||
    key.endsWith("refreshtoken") ||
    key.endsWith("idtoken") ||
    key.endsWith("idtokenhint") ||
    key.endsWith("sessiontoken") ||
    key.endsWith("devicecode") ||
    key.endsWith("usercode") ||
    key.endsWith("clientassertion") ||
    key.endsWith("assertion") ||
    key.endsWith("samlresponse") ||
    key.endsWith("samlrequest") ||
    key.endsWith("relaystate") ||
    key.endsWith("sessionstate");
}

function decodeUrlLayer(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, "%20"));
  } catch {
    return String(value);
  }
}

function urlContainsSensitiveMaterial(value) {
  let layer = String(value || "");
  const seen = new Set();
  for (let depth = 0; depth < 4 && !seen.has(layer); depth += 1) {
    seen.add(layer);
    const assignment = /(?:^|[?&#;])([^=?&#;]+)=/g;
    let match;
    while ((match = assignment.exec(layer)) !== null) {
      if (isSensitiveParameterName(match[1])) return true;
    }
    const decoded = decodeUrlLayer(layer);
    if (decoded === layer) break;
    layer = decoded;
  }
  return false;
}

function redactUrlForReport(value) {
  const raw = String(value || "");
  if (!urlContainsSensitiveMaterial(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "[redacted-url]";
    const pathname = urlContainsSensitiveMaterial(parsed.pathname) ? "/" : parsed.pathname;
    return `${parsed.origin}${pathname || "/"}?redacted`;
  } catch {
    return "[redacted-url]";
  }
}

function redactUrlRouteForReport(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "[redacted-url]";
    return `${parsed.origin}${parsed.pathname || "/"}?redacted`;
  } catch {
    return "[redacted-url]";
  }
}

function normalizePathname(value) {
  const pathname = String(value || "/");
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function expectedLocation(expectedFinal) {
  if (!expectedFinal || typeof expectedFinal !== "object") {
    throw new Error("invalid_expected_final");
  }
  const expectedUrl = validateOutboundUrl(expectedFinal.url);
  const expectedPath = normalizePathname(expectedFinal.path || expectedUrl.pathname);
  return { expectedUrl, expectedPath };
}

function locationHasDrift(finalValue, expectedFinal) {
  let finalUrl;
  try {
    finalUrl = validateOutboundUrl(finalValue);
  } catch {
    return true;
  }
  const { expectedUrl, expectedPath } = expectedLocation(expectedFinal);
  return finalUrl.origin !== expectedUrl.origin ||
    normalizePathname(finalUrl.pathname) !== expectedPath ||
    finalUrl.search !== expectedUrl.search ||
    finalUrl.hash !== expectedUrl.hash;
}

function isLoginWallUrl(value) {
  try {
    const url = validateOutboundUrl(value);
    const firstHostLabel = url.hostname.toLowerCase().split(".")[0];
    if (["auth", "authenticator", "login", "signin", "accounts"].includes(firstHostLabel)) {
      return true;
    }
    return /\/(?:auth|authentication|authorize|login|oauth2?\/authorize|sign-in|signin)(?:\/|$)/i
      .test(url.pathname);
  } catch {
    return false;
  }
}

function classifyObservation({ expectedFinal, final, status, manualEvidenceRequired }) {
  if (LOGIN_REQUIRED_STATUSES.has(Number(status)) || isLoginWallUrl(final)) {
    return "requires_login";
  }
  if (locationHasDrift(final, expectedFinal)) return "content_drift";
  if (manualEvidenceRequired) return "manual_evidence_required";
  if (Number(status) >= 200 && Number(status) < 300) return "healthy";
  return "http_error";
}

function fixtureResult(testCase) {
  const observed = testCase?.observed || {};
  const body = Buffer.from(String(observed.body || ""), "utf8");
  return liveResult(
    String(testCase?.original || ""),
    String(observed.final || testCase?.original || ""),
    Number.isInteger(observed.status) ? observed.status : null,
    classifyObservation({
      expectedFinal: testCase?.expected_final,
      final: observed.final || testCase?.original,
      status: observed.status,
      manualEvidenceRequired: observed.manual_evidence_required === true ||
        htmlRequiresManualEvidence(observed.headers, body),
    }),
  );
}

function assertFixtureFile(document) {
  if (document?.schema_version !== 2 ||
      !Array.isArray(document.cases) ||
      !Array.isArray(document.registry_cases) ||
      !Array.isArray(document.invalid_registry_cases) ||
      !Array.isArray(document.live_report_cases) ||
      !Array.isArray(document.live_policy_cases) ||
      !Array.isArray(document.secret_redirect_cases)) {
    throw new Error("invalid_fixture_schema");
  }
  const ids = new Set();
  for (const testCase of document.cases) {
    const id = String(testCase?.id || "");
    if (!id || ids.has(id) || !testCase?.expected) {
      throw new Error("invalid_fixture_case");
    }
    ids.add(id);
  }
}

async function runSecretRedirectCase(testCase) {
  const original = "https://vendor.example/plans";
  const location = String(testCase.location || "");
  const finalHostname = new URL(location).hostname;
  const link = {
    url: original,
    allowed_hosts: ["vendor.example", finalHostname],
    expected_final: { url: original, path: "/plans" },
  };
  const responseCase = {
    responses: [{
      url: original,
      status: 302,
      headers: { location },
    }],
  };

  const directFixture = createFixtureRequest(responseCase);
  const directResult = await checkLiveLink(link, {
    safeOutboundRequest: directFixture.request,
  });

  const document = {
    _meta: { schema_version: 1, updated_at: "2026-08-20" },
    links: [{
      link_id: `synthetic-${testCase.id}`,
      source_type: "official_document",
      ...link,
    }],
  };
  const mainFixture = createFixtureRequest(responseCase);
  const emissions = [];
  const exitCode = await main([
    "--live",
    "synthetic-provider-links.json",
    "--output",
    "external-links-report.json",
  ], {
    readJson: () => document,
    safeOutboundRequest: mainFixture.request,
    emitReport: (report, output) => emissions.push({ report, output }),
  });

  let outputPayload = "";
  let stdoutPayload = "";
  let outputPath = null;
  emitReport(emissions[0]?.report || {}, emissions[0]?.output, {
    writeFileSync(filePath, serialized) {
      outputPath = filePath;
      outputPayload = serialized;
    },
    writeStdout(serialized) {
      stdoutPayload += serialized;
    },
  });

  const forbiddenValues = testCase.forbidden_values || [];
  const serializedSurfaces = [
    JSON.stringify(directResult),
    JSON.stringify(emissions),
    outputPayload,
    stdoutPayload,
    ...directFixture.calls.map((call) => call.url),
    ...mainFixture.calls.map((call) => call.url),
  ].join("\n");
  const actual = {
    direct_classification: directResult.classification,
    direct_final: directResult.final,
    direct_request_urls: directFixture.calls.map((call) => call.url),
    main_exit_code: exitCode,
    main_classification: emissions[0]?.report?.results?.[0]?.classification,
    main_final: emissions[0]?.report?.results?.[0]?.final,
    main_request_urls: mainFixture.calls.map((call) => call.url),
    output_path: outputPath ? path.basename(outputPath) : null,
    stdout_matches_output: stdoutPayload === outputPayload,
    forbidden_values_present: forbiddenValues.filter((value) => serializedSurfaces.includes(value)),
  };
  const expectedClassification = String(testCase.expected_classification || "");
  const expected = {
    direct_classification: expectedClassification,
    direct_final: testCase.expected_final,
    direct_request_urls: [original],
    main_exit_code: LIVE_FAILURE_CLASSIFICATIONS.has(expectedClassification) ? 2 : 0,
    main_classification: expectedClassification,
    main_final: testCase.expected_final,
    main_request_urls: [original],
    output_path: "external-links-report.json",
    stdout_matches_output: true,
    forbidden_values_present: [],
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`secret_redirect_fixture_mismatch:${testCase.id}`);
  }

  if (testCase.registry_fail_closed === true) {
    const finalUrl = new URL(location);
    const safeFinal = `${finalUrl.origin}${finalUrl.pathname}`;
    const documents = [
      {
        _meta: { schema_version: 1 },
        links: [{
          link_id: "synthetic-secret-original",
          source_type: "official_document",
          url: location,
          allowed_hosts: [finalUrl.hostname],
          expected_final: { url: safeFinal, path: finalUrl.pathname },
        }],
      },
      {
        _meta: { schema_version: 1 },
        links: [{
          link_id: "synthetic-secret-expected",
          source_type: "official_document",
          url: safeFinal,
          allowed_hosts: [finalUrl.hostname],
          expected_final: { url: location, path: finalUrl.pathname },
        }],
      },
    ];
    for (const registryDocument of documents) {
      let rejected = false;
      try { loadProviderLinks(registryDocument); } catch { rejected = true; }
      if (!rejected) throw new Error(`secret_registry_fixture_accepted:${testCase.id}`);
    }
  }
}

function createFixtureRequest(testCase) {
  const calls = [];
  const responses = [];
  let responseIndex = 0;
  const request = async (url, options) => {
    calls.push({ url, timeoutMs: options?.timeoutMs });
    const fixtureResponse = testCase.responses?.[responseIndex];
    responseIndex += 1;
    if (!fixtureResponse || fixtureResponse.url !== url) {
      throw new Error("fixture_request_mismatch");
    }
    const body = Buffer.from(String(fixtureResponse.body || ""), "utf8");
    let sent = false;
    const response = new Readable({
      autoDestroy: false,
      read() {
        if (sent) return;
        sent = true;
        if (body.length > 0) this.push(body);
        this.push(null);
      },
    });
    response.statusCode = fixtureResponse.status;
    response.headers = fixtureResponse.headers || {};
    responses.push(response);
    return {
      request: {
        destroyed: false,
        destroy() { this.destroyed = true; },
      },
      response,
    };
  };
  return { calls, request, responses };
}

async function runLivePolicyCase(testCase) {
  const fixture = createFixtureRequest(testCase);
  const result = await checkLiveLink(testCase.link, {
    safeOutboundRequest: fixture.request,
  });
  const timeouts = Array.from(new Set(fixture.calls.map((call) => call.timeoutMs)));
  const actual = {
    result,
    request_urls: fixture.calls.map((call) => call.url),
    request_timeout_ms: timeouts.length === 1 ? timeouts[0] : null,
    destroyed_responses: fixture.responses.filter((response) => response.destroyed).length,
  };
  if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
    throw new Error(`live_policy_fixture_mismatch:${testCase.id}`);
  }
}

async function runLiveReportCase(testCase) {
  const fixture = createFixtureRequest(testCase);
  const emissions = [];
  const exitCode = await main([
    "--live",
    "synthetic-provider-links.json",
    "--output",
    "external-links-report.json",
  ], {
    readJson: () => testCase.document,
    safeOutboundRequest: fixture.request,
    emitReport: (report, output) => emissions.push({ report, output }),
  });
  const actual = {
    exit_code: exitCode,
    emitted_reports: emissions.length,
    output: emissions[0]?.output,
    classification: emissions[0]?.report?.results?.[0]?.classification,
  };
  if (Array.isArray(testCase.forbidden_values)) {
    const serializedReport = serializeReport(emissions[0]?.report || {});
    actual.final = emissions[0]?.report?.results?.[0]?.final;
    actual.request_urls = fixture.calls.map((call) => call.url);
    actual.forbidden_values_present = testCase.forbidden_values.filter((value) => (
      serializedReport.includes(value) || actual.request_urls.some((url) => url.includes(value))
    ));
  }
  if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
    throw new Error(`live_report_fixture_mismatch:${testCase.id}`);
  }
}

async function runFixtureDocument(document) {
  assertFixtureFile(document);
  const results = [];
  for (const testCase of document.cases) {
    const actual = fixtureResult(testCase);
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      throw new Error(`fixture_mismatch:${testCase.id}`);
    }
    results.push(actual);
  }
  for (const testCase of document.registry_cases) {
    const links = loadProviderLinks(testCase.document);
    const actual = {
      url: links[0]?.url,
      expected_final_path: links[0]?.expected_final?.path,
    };
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) {
      throw new Error(`registry_fixture_mismatch:${testCase.id}`);
    }
  }
  for (const testCase of document.invalid_registry_cases) {
    let rejected = false;
    try {
      loadProviderLinks(testCase.document || {
        _meta: { schema_version: 1 },
        links: [testCase.link],
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`invalid_registry_fixture_accepted:${testCase.id}`);
  }
  for (const testCase of document.live_report_cases) {
    await runLiveReportCase(testCase);
  }
  for (const testCase of document.live_policy_cases) {
    await runLivePolicyCase(testCase);
  }
  for (const testCase of document.secret_redirect_cases) {
    await runSecretRedirectCase(testCase);
  }
  return createReport(
    "fixtures",
    results,
    null,
    document.live_policy_cases.length,
    document.registry_cases.length,
    document.invalid_registry_cases.length,
    document.live_report_cases.length,
    document.secret_redirect_cases.length,
  );
}

function normalizeAllowedHosts(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("invalid_allowed_hosts");
  }
  const hosts = value.map((item) => String(item || "").trim().toLowerCase());
  for (const host of hosts) {
    let parsed;
    try {
      parsed = new URL(`https://${host}/`);
    } catch {
      throw new Error("invalid_allowed_hosts");
    }
    if (!host || host.endsWith(".") || host.includes(":") || host.includes("/") ||
        host.includes("@") || parsed.hostname.toLowerCase() !== host || parsed.port) {
      throw new Error("invalid_allowed_hosts");
    }
  }
  return Array.from(new Set(hosts));
}

function loadProviderLinks(document) {
  if (document?._meta?.schema_version !== 1 ||
      !Array.isArray(document.links) ||
      document.links.length === 0) {
    throw new Error("invalid_provider_links_schema");
  }
  const ids = new Set();
  const urls = new Set();
  return document.links.map((rawLink) => {
    const linkId = String(rawLink?.link_id || "");
    const sourceType = String(rawLink?.source_type || "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(linkId) ||
        ids.has(linkId) ||
        !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      throw new Error("invalid_provider_link");
    }
    ids.add(linkId);
    if (urlContainsSensitiveMaterial(rawLink.url) ||
        urlContainsSensitiveMaterial(rawLink?.expected_final?.url)) {
      throw new Error("invalid_provider_link");
    }
    const originalUrl = validateOutboundUrl(rawLink.url);
    if (originalUrl.port || urls.has(originalUrl.href)) {
      throw new Error("invalid_provider_link");
    }
    urls.add(originalUrl.href);
    const allowedHosts = normalizeAllowedHosts(rawLink.allowed_hosts);
    if (typeof rawLink?.expected_final?.path !== "string" ||
        !rawLink.expected_final.path.startsWith("/")) {
      throw new Error("invalid_expected_final");
    }
    const { expectedUrl, expectedPath } = expectedLocation(rawLink.expected_final);
    if (expectedUrl.port || normalizePathname(expectedUrl.pathname) !== expectedPath) {
      throw new Error("invalid_expected_final");
    }
    if (!allowedHosts.includes(originalUrl.hostname.toLowerCase()) ||
        !allowedHosts.includes(expectedUrl.hostname.toLowerCase())) {
      throw new Error("provider_link_host_not_allowed");
    }
    return {
      link_id: linkId,
      source_type: sourceType,
      url: String(rawLink.url),
      allowed_hosts: allowedHosts,
      expected_final: {
        url: expectedUrl.href,
        path: expectedPath,
      },
    };
  });
}

function getHeader(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function destroyResponse(request, response) {
  try { response?.destroy?.(); } catch { /* best effort */ }
  try { request?.destroy?.(); } catch { /* best effort */ }
}

function readBodyWithTimeout(response, request) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      destroyResponse(request, response);
      reject(new SafeOutboundError("request_timeout", "外链响应体读取超时"));
    }, REQUEST_TIMEOUT_MS);
  });
  return Promise.race([
    readLimitedResponseBody(response, {
      maxBytes: BODY_CAP_BYTES,
      request,
    }),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

function htmlRequiresManualEvidence(headers, body) {
  const contentType = String(getHeader(headers, "content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) return false;
  const html = body.toString("utf8");
  const hasApplicationShell = /<(?:div|main)[^>]+id=["'](?:root|app|__next)["']/i.test(html) ||
    /<script\b/i.test(html);
  if (!hasApplicationShell) return false;
  const visibleText = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return visibleText.length < 80;
}

function errorClassification(error) {
  if (error instanceof SafeOutboundError &&
      (error.code === "unsafe_outbound_url" || error.code === "unsafe_outbound_address")) {
    return "unsafe_target";
  }
  return "transport_error";
}

async function checkLiveLink(link, dependencies = {}) {
  const request = dependencies.safeOutboundRequest || safeOutboundRequest;
  let current = link.url;
  let status = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const outbound = await request(current, {
        method: "GET",
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
          "User-Agent": "Token-Eyes-External-Link-Checker/1",
        },
      });
      const { request: nodeRequest, response } = outbound;
      status = Number(response?.statusCode) || null;

      if (REDIRECT_STATUSES.has(status)) {
        const location = getHeader(response.headers, "location");
        destroyResponse(nodeRequest, response);
        if (!location || hop === MAX_REDIRECTS) {
          return liveResult(link.url, current, status, "transport_error");
        }
        const resolvedLocation = new URL(String(location), current).href;
        if (urlContainsSensitiveMaterial(resolvedLocation)) {
          const redactedFinal = redactUrlForReport(resolvedLocation);
          const classification = isLoginWallUrl(redactedFinal)
            ? "requires_login"
            : "unsafe_target";
          return liveResult(link.url, redactedFinal, status, classification);
        }
        const nextUrl = validateOutboundUrl(resolvedLocation);
        const { expectedUrl } = expectedLocation(link.expected_final);
        const routeMatchesExpected = nextUrl.search === expectedUrl.search &&
          nextUrl.hash === expectedUrl.hash;
        if (!routeMatchesExpected) {
          const hasUnregisteredRoute = Boolean(nextUrl.search || nextUrl.hash);
          const reportFinal = hasUnregisteredRoute
            ? redactUrlRouteForReport(nextUrl.href)
            : nextUrl.href;
          const classification = isLoginWallUrl(reportFinal)
            ? "requires_login"
            : (hasUnregisteredRoute ? "unsafe_target" : "content_drift");
          return liveResult(link.url, reportFinal, status, classification);
        }
        current = nextUrl.href;
        if (isLoginWallUrl(current)) {
          return liveResult(link.url, current, status, "requires_login");
        }
        if (!link.allowed_hosts.includes(nextUrl.hostname.toLowerCase())) {
          return liveResult(link.url, current, status, "content_drift");
        }
        continue;
      }

      if (LOGIN_REQUIRED_STATUSES.has(status)) {
        destroyResponse(nodeRequest, response);
        return liveResult(link.url, current, status, "requires_login");
      }

      if (!(status >= 200 && status < 300)) {
        destroyResponse(nodeRequest, response);
        return liveResult(link.url, current, status, "http_error");
      }

      const body = await readBodyWithTimeout(response, nodeRequest);
      const classification = classifyObservation({
        expectedFinal: link.expected_final,
        final: current,
        status,
        manualEvidenceRequired: htmlRequiresManualEvidence(response.headers, body),
      });
      return liveResult(link.url, current, status, classification);
    }
  } catch (error) {
    return liveResult(link.url, current, status, errorClassification(error));
  }
  return liveResult(link.url, current, status, "transport_error");
}

function liveResult(original, final, status, classification) {
  return {
    original: redactUrlForReport(original),
    final: redactUrlForReport(final),
    status: Number.isInteger(status) ? status : null,
    classification,
  };
}

function createReport(
  mode,
  results,
  checkedAt = new Date().toISOString(),
  fixturePolicyChecks = null,
  fixtureRegistryChecks = null,
  fixtureInvalidRegistryChecks = null,
  fixtureLiveReportChecks = null,
  fixtureSecretRedirectChecks = null,
) {
  const report = {
    schema_version: 1,
    mode,
    checked_at: checkedAt,
    limits: {
      request_timeout_ms: REQUEST_TIMEOUT_MS,
      max_redirects: MAX_REDIRECTS,
      body_cap_bytes: BODY_CAP_BYTES,
    },
    results,
  };
  if (fixturePolicyChecks !== null) report.fixture_policy_checks = fixturePolicyChecks;
  if (fixtureRegistryChecks !== null) report.fixture_registry_checks = fixtureRegistryChecks;
  if (fixtureInvalidRegistryChecks !== null) {
    report.fixture_invalid_registry_checks = fixtureInvalidRegistryChecks;
  }
  if (fixtureLiveReportChecks !== null) {
    report.fixture_live_report_checks = fixtureLiveReportChecks;
  }
  if (fixtureSecretRedirectChecks !== null) {
    report.fixture_secret_redirect_checks = fixtureSecretRedirectChecks;
  }
  return report;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function parseArgs(argv) {
  const options = { mode: null, input: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures" || arg === "--live") {
      if (options.mode || !argv[index + 1]) throw new Error("invalid_arguments");
      options.mode = arg.slice(2);
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === "--output") {
      if (options.output || !argv[index + 1]) throw new Error("invalid_arguments");
      options.output = argv[index + 1];
      index += 1;
    } else {
      throw new Error("invalid_arguments");
    }
  }
  if (!options.mode || !options.input) throw new Error("invalid_arguments");
  return options;
}

function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function emitReport(report, outputPath, dependencies = {}) {
  const serialized = serializeReport(report);
  const writeFileSync = dependencies.writeFileSync || fs.writeFileSync;
  const writeStdout = dependencies.writeStdout || ((value) => process.stdout.write(value));
  if (outputPath) writeFileSync(path.resolve(outputPath), serialized, "utf8");
  writeStdout(serialized);
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const loadJson = dependencies.readJson || readJson;
  const emit = dependencies.emitReport || emitReport;
  if (options.mode === "fixtures") {
    emit(await runFixtureDocument(loadJson(options.input)), options.output);
    return 0;
  }

  const links = loadProviderLinks(loadJson(options.input));
  const results = [];
  for (const link of links) results.push(await checkLiveLink(link, dependencies));
  const report = createReport("live", results);
  emit(report, options.output);
  return results.some((result) => LIVE_FAILURE_CLASSIFICATIONS.has(result.classification)) ? 2 : 0;
}

if (require.main === module) {
  main().then(
    (exitCode) => { process.exitCode = exitCode; },
    () => {
      process.stderr.write("external_link_check_failed\n");
      process.exitCode = 1;
    },
  );
}

module.exports = {
  BODY_CAP_BYTES,
  MAX_REDIRECTS,
  REQUEST_TIMEOUT_MS,
  checkLiveLink,
  classifyObservation,
  fixtureResult,
  htmlRequiresManualEvidence,
  loadProviderLinks,
  locationHasDrift,
  main,
  parseArgs,
  runFixtureDocument,
  serializeReport,
};
