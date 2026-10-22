const assert=require('node:assert/strict');
const {test}=require('node:test');
const {auditRows}=require('../scripts/audit-token-correctness.cjs');
const base={source:'claude',model:'m',hour_start:'2026-09-22T01:00:00Z'};
const row=(billing_mode,total_tokens)=>({...base,billing_mode,total_tokens,input_tokens:total_tokens});
test('audit preserves API and plan identities and treats cumulative replacements as revisions',()=>{
  const result=auditRows([row('api_key',100),row('token_plan',200),row('api_key',150)]);
  assert.equal(result.sources.claude.total_tokens,350);
  assert.equal(result.raw.snapshot_revisions,1);
});
test('audit compares independent expected inventory and detects missing, added, and wrong values',()=>{
  const expectedRows=[row('api_key',100),row('token_plan',200)];
  assert.equal(auditRows(expectedRows,{expectedRows}).reconciliation.ok,true);
  for(const rows of [[row('api_key',100)],[...expectedRows,{...row('api_key',50),model:'extra'}],[row('api_key',101),row('token_plan',200)]]){
    assert.equal(auditRows(rows,{expectedRows}).reconciliation.ok,false);
  }
});

test('audit rejects attribution mismatches and ambiguous independent inventories',()=>{
const expected={...row('api_key',100),account_ref:'account/a'};
assert.equal(auditRows([{...expected,account_ref:'account/b'}],{expectedRows:[expected]}).reconciliation.ok,false);
assert.equal(auditRows([expected],{expectedRows:[expected,{...expected,account_ref:'account/b'}]}).reconciliation.ok,false);
});
