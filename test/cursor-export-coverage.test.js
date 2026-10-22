const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {parseCursorApiIncremental} = require('../src/lib/rollout');
const {readQueueData} = require('../src/lib/local-api');

const row = (minute, count, account = 'a') => ({date:`2026-09-22T01:${minute}:00Z`,model:'gpt-5',provider_id:'cursor',account_ref:`account/cursor/${account}`,inputTokens:count,outputTokens:0,totalTokens:count});
const coverage = account => [{account_ref:`account/cursor/${account}`,from:'2026-09-22T01:00:00Z',to:'2026-09-22T01:30:00Z',complete:true,evidence:'isolated-complete-export'}];
async function setup(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-cursor-coverage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const cursors={},queuePath=path.join(dir,'queue.jsonl'),collectionStatus={};
 return {cursors,queuePath,collectionStatus,run:(records,extra={})=>parseCursorApiIncremental({records,cursors,queuePath,collectionStatus,...extra}),total:()=>readQueueData(queuePath).reduce((sum,r)=>sum+r.total_tokens,0)};
}

test('Cursor partial exports retain absent events, reject ambiguous revisions, and accept explicit complete low/empty revisions',async t=>{
 const s=await setup(t);
 await s.run([row('01',100),row('02',200)]);
 await s.run([row('02',200),row('03',50)]);assert.equal(s.total(),350,'a partial overlapping page cannot replace a full bucket');
 const before=await fs.readFile(s.queuePath,'utf8');await s.run([row('03',50),row('02',200)]);assert.equal(await fs.readFile(s.queuePath,'utf8'),before);
 const conflict=await s.run([row('02',80)]);assert.equal(s.total(),350);assert.ok(conflict.readErrorCodes.includes('cursor_export_coverage_unknown'));
 await s.run([row('02',80)],{coverage:coverage('a')});assert.equal(s.total(),80,'proven complete lower correction is not max(old,new)');
 await s.run([]);assert.equal(s.total(),80,'unknown empty does not erase history');
 await s.run([row('01',90,'b')]);assert.equal(s.total(),170);
 await s.run([],{coverage:coverage('a')});assert.equal(s.total(),90,'complete empty retracts only the covered account');
 const empty=await fs.readFile(s.queuePath,'utf8');await s.run([],{coverage:coverage('a')});assert.equal(await fs.readFile(s.queuePath,'utf8'),empty);
 await s.run([row('02',80)]);assert.equal(s.total(),90,'an unknown old page cannot revive a proven-empty historical bucket');
});

test('Cursor legacy anonymous overlap is previewed while a new nonoverlapping bucket continues collection',async t=>{
 const s=await setup(t);const old=row('01',100);delete old.account_ref;delete old.provider_id;
 await s.run([old]);const original=structuredClone(s.cursors),before=await fs.readFile(s.queuePath,'utf8');
 const next={...row('01',70),date:'2026-09-22T02:01:00Z'};
 const preview=await s.run([row('01',150),next],{previewOnly:true});
 assert.deepEqual(s.cursors,original);assert.equal(await fs.readFile(s.queuePath,'utf8'),before);
 assert.ok(preview.reconciliation.some(r=>r.reason==='cursor_legacy_account_unresolved'&&r.previous_tokens===100&&r.observed_tokens===150));
 const result=await s.run([row('01',150),next]);assert.equal(s.total(),170);assert.ok(result.readErrorCodes.includes('cursor_legacy_account_unresolved'));
 await s.run([next,row('01',150)]);assert.equal(s.total(),170);
 assert.equal(s.collectionStatus.cursor.status,'error');
});

test('Cursor accountBuckets without event detail are preserved until complete coverage is supplied',async t=>{
 const s=await setup(t);await s.run([row('01',100),row('02',200)]);delete s.cursors.cursorApi.eventGroups;
 await s.run([row('02',200),row('03',50)]);assert.equal(s.total(),300);
 await s.run([row('02',80)],{coverage:coverage('a')});assert.equal(s.total(),80);
 const before=structuredClone(s.cursors),queue=await fs.readFile(s.queuePath,'utf8');
 await assert.rejects(s.run([row('02',20)],{coverage:[{...coverage('a')[0],to:'bad'}]}),/coverage/);
 assert.deepEqual(s.cursors,before);assert.equal(await fs.readFile(s.queuePath,'utf8'),queue);
});

test('Cursor strict CSV rejects malformed counts and preserves legitimate zero events',()=>{
 const {parseCursorCsv}=require('../src/lib/cursor-config');
 const csv=n=>`Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-09-22T01:00:00Z,gpt-5,${n},${n},0,0,${n},0\n`;
 for(const value of ['bad','-1','1.5',''])assert.throws(()=>parseCursorCsv(csv(value),{strict:true}),/count/);
 assert.throws(()=>parseCursorCsv('',{strict:true}),/empty/);
 assert.equal(parseCursorCsv(csv(0),{strict:true}).length,1);
});

test('Cursor legacy unknown-model migration must retain history without replacement coverage',async t=>{
 const s=await setup(t);const old={...row('01',100),model:'unknown'};delete old.account_ref;delete old.provider_id;
 await s.run([old]);const before=await fs.readFile(s.queuePath,'utf8');
 const {migrateCursorUnknownBuckets}=require('../src/commands/sync');
 await migrateCursorUnknownBuckets({cursors:s.cursors,queuePath:s.queuePath});
 assert.equal(s.total(),100);assert.equal(await fs.readFile(s.queuePath,'utf8'),before);
 const result=await s.run([row('01',150)]);assert.equal(s.total(),100,'new model labels cannot double-count unknown legacy history');assert.ok(result.readErrorCodes.includes('cursor_legacy_account_unresolved'));
});

test('Cursor staged event state survives failed queue append then retry',async t=>{
 const s=await setup(t);await s.run([row('01',100)]);const before=structuredClone(s.cursors),queue=await fs.readFile(s.queuePath,'utf8');
 const open=fs.open;fs.open=async(file,...args)=>{const handle=await open(file,...args);if(file===s.queuePath&&args[0]==='a+')handle.appendFile=async()=>{throw new Error('isolated-write-failure');};return handle;};
 try {await assert.rejects(s.run([row('02',200)]),/isolated-write-failure/);}finally{fs.open=open;}
 assert.deepEqual(s.cursors,before);assert.equal(await fs.readFile(s.queuePath,'utf8'),queue);
 await s.run([row('02',200)]);assert.equal(s.total(),300);await s.run([row('02',200)]);assert.equal(s.total(),300);
});
