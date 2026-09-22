const assert = require("node:assert/strict");
const { test } = require("node:test");
const { collectCursorAccountUsage } = require("../src/lib/cursor-config");

// Only this isolated fixture explicitly proves the complete half-hour snapshot.
const full = (account, hour='00') => [{account_ref:account,from:'2026-09-22T'+hour+':00:00Z',to:'2026-09-22T'+hour+':30:00Z',complete:true,evidence:'isolated-complete-export'}];
const csv = count => `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-09-22T00:00:00Z,gpt-5,${count},${count},0,0,${count},0\n`;
test("Cursor combines distinct accounts once and rejects a partial account fetch", async () => {
  let calls = 0;
  const options = { homes: ["a", "a-copy", "b"], isInstalled: () => true,
    readAuth: ({appDir}) => ({userId: appDir.startsWith("a") ? "a" : "b", cookie: appDir}),
    fetchCsv: async ({cookie}) => { calls++; return csv(cookie === "b" ? 200 : 100); } };
  const result = await collectCursorAccountUsage(options);
  assert.equal(calls, 2);
  assert.equal(result.records.reduce((sum, row) => sum + row.inputTokens, 0), 300);
  assert.equal(result.accountKeys.length, 2);
  await assert.rejects(collectCursorAccountUsage({...options, fetchCsv: async ({cookie}) => { if(cookie === "b") throw new Error("offline"); return csv(100); }}), /offline/);
  const switched = await collectCursorAccountUsage({...options, homes:["a"],previousAccountKeys: result.accountKeys});
  assert.equal(switched.records.length,1);
});

test('Cursor A -> B -> A preserves isolated account history and does not duplicate rereads',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {parseCursorApiIncremental}=require('../src/lib/rollout');
 const {readQueueData}=require('../src/lib/local-api');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-cursor-switch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl'),cursors={files:{}};
 let previousAccountKeys=[];
 for(const [userId,count,total]of [['a',100,100],['b',200,300],['a',150,350],['a',150,350],['b',80,230]]){
  const snapshot=await collectCursorAccountUsage({homes:['same-install'],previousAccountKeys,isInstalled:()=>true,readAuth:()=>({userId,cookie:'fixture'}),fetchCsv:async()=>csv(count)});
  assert.ok(snapshot.records.every(r=>r.account_ref?.startsWith('account/cursor/')));
  await parseCursorApiIncremental({records:snapshot.records,coverage:full(snapshot.records[0].account_ref),cursors,queuePath});previousAccountKeys=snapshot.accountKeys;
  const rows=readQueueData(queuePath);assert.equal(rows.reduce((sum,row)=>sum+row.total_tokens,0),total);
  const latest=JSON.parse((await fs.readFile(queuePath,'utf8')).trim().split('\n').at(-1));
  assert.equal(latest.total_tokens,total,'legacy readers retain base total');
  assert.equal(rows.length,total===100?1:2,'new readers retain independent account slices');
 }
 const before=await fs.readFile(queuePath,'utf8');
 const snapshot=await collectCursorAccountUsage({homes:['same-install'],isInstalled:()=>true,readAuth:()=>({userId:'b',cookie:'fixture'}),fetchCsv:async()=>csv(80)});
 await parseCursorApiIncremental({records:snapshot.records,coverage:full(snapshot.records[0].account_ref),cursors,queuePath});assert.equal(await fs.readFile(queuePath,'utf8'),before);
});

test('Cursor attribution-only revisions replace account slices without changing totals',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {parseCursorApiIncremental}=require('../src/lib/rollout');const {readQueueData}=require('../src/lib/local-api');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-cursor-attribution-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const queuePath=path.join(dir,'queue.jsonl'),cursors={files:{}};
 const base={date:'2026-09-22T01:00:00Z',model:'gpt-5',provider_id:'cursor',account_ref:'account/cursor/a',inputTokens:100,outputTokens:0,totalTokens:100};
 await parseCursorApiIncremental({records:[{...base,credential_ref:'provider-api/key-a'}],coverage:full(base.account_ref,'01'),queuePath,cursors});
 await parseCursorApiIncremental({records:[{...base,credential_ref:'provider-api/key-b'}],coverage:full(base.account_ref,'01'),queuePath,cursors});
 const rows=readQueueData(queuePath);assert.equal(rows.length,1);assert.equal(rows[0].total_tokens,100);assert.equal(rows[0].credential_ref,'provider-api/key-b');
 await parseCursorApiIncremental({records:[{...base,billing_mode:'token_plan',plan_ref:'token-plan/cursor/pro'}],coverage:full(base.account_ref,'01'),queuePath,cursors});
 const moved=readQueueData(queuePath);assert.equal(moved.reduce((sum,row)=>sum+row.total_tokens,0),100);
 assert.equal(moved.find(row=>row.billing_mode==='token_plan').total_tokens,100);
 const before=await fs.readFile(queuePath,'utf8');
 await parseCursorApiIncremental({records:[{...base,billing_mode:'token_plan',plan_ref:'token-plan/cursor/pro'}],coverage:full(base.account_ref,'01'),queuePath,cursors});
 assert.equal(await fs.readFile(queuePath,'utf8'),before,'mode revision rereads do not append');
 await parseCursorApiIncremental({records:[base],coverage:full(base.account_ref,'01'),queuePath,cursors});
 assert.equal(readQueueData(queuePath).reduce((sum,row)=>sum+row.total_tokens,0),100,'returning to the old mode retracts the plan snapshot');
});
