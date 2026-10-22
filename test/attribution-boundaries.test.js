const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createConfiguredTokenPlanResolver } = require("../src/lib/usage-attribution");

test("explicit account and credential bindings cannot classify another account", () => {
  const resolve = createConfiguredTokenPlanResolver([{
    source: "hermes", provider_id: "deepseek", account_ref: "account/deepseek/a",
    credential_ref: "provider-api/key-a", plan_ref: "token-plan/deepseek/a",
  }]);
  const row = { source: "hermes", provider_id: "deepseek", occurred_at: "2026-09-22T00:00:00Z" };
  assert.equal(resolve({ ...row, account_ref: "account/deepseek/b", credential_ref: "provider-api/key-a" }).billing_mode, "unknown");
  assert.equal(resolve({ ...row, account_ref: "account/deepseek/a", credential_ref: "provider-api/key-b" }).billing_mode, "unknown");
  assert.equal(resolve(row).billing_mode, "unknown");
  assert.equal(resolve({ ...row, account_ref: "account/deepseek/a", credential_ref: "provider-api/key-a" }).billing_mode, "token_plan");
});

test('provider-only plan cannot override a receipt carrying an unbound account or credential',()=>{
 const resolve=createConfiguredTokenPlanResolver([{source:'hermes',provider_id:'deepseek',plan_ref:'token-plan/deepseek/default'}]);
 for(const identity of [{account_ref:'account/deepseek/another'},{credential_ref:'provider-api/another'}]){
  const row={source:'hermes',provider_id:'deepseek',occurred_at:'2026-09-22T00:00:00Z',...identity};
  assert.equal(resolve(row).billing_mode,'unknown');
  assert.equal(resolve({...row,billing_mode:'api_key',billing_mode_confidence:'provider_receipt'}).billing_mode,'api_key');
 }
});
