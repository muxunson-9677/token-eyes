"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  createAccessKeyCredential,
  getCredentialRedactions,
  parseAccessKeyCredential,
  createAliyunRpcSignature,
  signAliyunRpcRequest,
  signVolcengineRequest,
} = require("../src/lib/provider-api-signing");
const { executeFinancialRequest } = require("../src/lib/provider-api-executor");

test("access-key credentials use a versioned envelope and can be read back", () => {
  const secret = createAccessKeyCredential("test-access-id", "test-access-secret");

  assert.deepEqual(JSON.parse(secret), {
    version: 1,
    type: "access_key_pair",
    accessKeyId: "test-access-id",
    accessKeySecret: "test-access-secret",
  });
  assert.deepEqual(parseAccessKeyCredential(secret), {
    accessKeyId: "test-access-id",
    accessKeySecret: "test-access-secret",
  });
});

test("access-key parser rejects raw keys, incomplete pairs, and unknown envelope versions", () => {
  assert.equal(parseAccessKeyCredential("raw-api-key"), null);
  assert.equal(parseAccessKeyCredential(JSON.stringify({
    version: 1,
    type: "access_key_pair",
    accessKeyId: "only-id",
  })), null);
  assert.equal(parseAccessKeyCredential(JSON.stringify({
    version: 2,
    type: "access_key_pair",
    accessKeyId: "id",
    accessKeySecret: "secret",
  })), null);
});

test("credential redactions cover the stored envelope and both access-key parts", () => {
  const secret = createAccessKeyCredential("redact-id", "redact-secret");
  assert.deepEqual(getCredentialRedactions(secret), [secret, "redact-id", "redact-secret"]);
});

test("Alibaba RPC signing matches the official HMAC-SHA1 example", () => {
  const signature = createAliyunRpcSignature({
    AccessKeyId: "testid",
    Action: "DescribeRegions",
    Format: "XML",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
    SignatureVersion: "1.0",
    Timestamp: "2016-02-23T12:46:24Z",
    Version: "2014-05-26",
  }, "testsecret");

  assert.equal(signature, "OLeaidS1JvxuMvnyHOwuJ+uX5qY=");
});

test("Alibaba account-balance request adds signed common parameters without changing the endpoint", () => {
  const signed = signAliyunRpcRequest(
    "https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14",
    { accessKeyId: "testid", accessKeySecret: "testsecret" },
    {
      now: new Date("2026-01-02T03:04:05.000Z"),
      nonce: "test-nonce",
    }
  );
  const parsed = new URL(signed.url);

  assert.equal(parsed.origin, "https://business.aliyuncs.com");
  assert.equal(parsed.searchParams.get("Action"), "QueryAccountBalance");
  assert.equal(parsed.searchParams.get("Version"), "2017-12-14");
  assert.equal(parsed.searchParams.get("Format"), "JSON");
  assert.equal(parsed.searchParams.get("AccessKeyId"), "testid");
  assert.equal(parsed.searchParams.get("Timestamp"), "2026-01-02T03:04:05Z");
  assert.equal(parsed.searchParams.get("SignatureNonce"), "test-nonce");
  assert.ok(parsed.searchParams.get("Signature"));
  assert.deepEqual(signed.headers, {});
});

test("Volcengine billing signing produces the deterministic HMAC-SHA256 request", () => {
  const signed = signVolcengineRequest(
    "https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01",
    { accessKeyId: "test-ak", accessKeySecret: "test-secret" },
    { now: new Date("2026-01-02T03:04:05.000Z") }
  );

  assert.equal(
    signed.url,
    "https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01"
  );
  assert.equal(signed.headers["X-Date"], "20260102T030405Z");
  assert.equal(
    signed.headers["X-Content-Sha256"],
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    signed.headers.Authorization,
    "HMAC-SHA256 Credential=test-ak/20260102/cn-north-1/billing/request, " +
      "SignedHeaders=host;x-content-sha256;x-date, " +
      "Signature=35cf612ac7fc9bf32d2cec3cb9b3684e50490bf94d15223b5a8aeef339d51581"
  );
});

test("signed providers reject an unstructured API key before making a request", async () => {
  const result = await executeFinancialRequest({
    requestUrl: "https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14",
    requestMethod: "GET",
    authType: "aliyun_rpc",
  }, "raw-model-api-key", { timeoutMs: 25 });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "invalid_config");
});
