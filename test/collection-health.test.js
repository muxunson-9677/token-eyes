const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {parseGeminiIncremental}=require('../src/lib/rollout');
test('source errors retain the last successful observation and recover after repair',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-health-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'session.json');const collectionStatus={gemini:{status:'ok',last_successful_at:'2026-09-21T00:00:00Z'}};
  const options={sessionFiles:[file],queuePath:path.join(dir,'queue.jsonl'),cursors:{files:{}},collectionStatus};
  await fs.writeFile(file,'{broken');await assert.rejects(parseGeminiIncremental(options));
  assert.equal(collectionStatus.gemini.status,'error');assert.equal(collectionStatus.gemini.last_successful_at,'2026-09-21T00:00:00Z');
  await fs.writeFile(file,JSON.stringify({sessionId:'s',messages:[]}));await parseGeminiIncremental(options);
  assert.equal(collectionStatus.gemini.status,'ok');assert.notEqual(collectionStatus.gemini.last_successful_at,'2026-09-21T00:00:00Z');
});

test('realtime endpoint exposes failed source time without leaking error internals', async t => {
  const {createLocalApiHandler}=require('../src/lib/local-api');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-health-api-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'queue.jsonl'),'');
  await fs.writeFile(path.join(dir,'collection-status.json'),JSON.stringify({gemini:{status:'error',last_successful_at:'2026-09-21T00:00:00Z',error_code:'private-internal'}}));
  const handler=createLocalApiHandler({queuePath:path.join(dir,'queue.jsonl'),trackerDataDir:dir,codexLifecycleProvider:async()=>[],dataDirectoryPathsResolver:()=>({codexHomes:[]}),tokenOnlyDirectoryStatesProvider:()=>({}),workbuddyQuotaProvider:async()=>({signed_in:false,groups:[]})});
  let payload;await handler({method:'GET',headers:{host:'127.0.0.1'}},{writeHead(){},end(body){payload=JSON.parse(body);}},new URL('http://127.0.0.1/functions/tokentracker-realtime-sessions'));
  assert.equal(payload.collection_status.gemini.status,'error');
  assert.equal(payload.collection_status.gemini.last_successful_at,'2026-09-21T00:00:00Z');
  assert.equal(JSON.stringify(payload).includes('private-internal'),false);
});

test('sync cursor corruption persists a tracker error and preserves source success before discovery', async t => {
 const {cmdSync}=require('../src/commands/sync');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-sync-corrupt-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const tracker=path.join(dir,'.tokentracker','tracker');await fs.mkdir(tracker,{recursive:true});
 await fs.writeFile(path.join(tracker,'cursors.json'),'{broken');await fs.writeFile(path.join(tracker,'collection-status.json'),JSON.stringify({claude:{status:'ok',last_successful_at:'2026-09-21T00:00:00Z'}}));
 const homedir=os.homedir;os.homedir=()=>dir;try{await assert.rejects(cmdSync(['--auto']));}finally{os.homedir=homedir;}
 const state=JSON.parse(await fs.readFile(path.join(tracker,'collection-status.json'),'utf8'));assert.equal(state.tracker?.status,'error');assert.equal(state.claude.last_successful_at,'2026-09-21T00:00:00Z');assert.equal(await fs.readFile(path.join(tracker,'cursors.json'),'utf8'),'{broken');
});

test('discovery and file metadata permission failures propagate instead of becoming empty success',async t=>{
 const {listClaudeProjectFiles,parseRolloutIncremental}=require('../src/lib/rollout');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-discovery-error-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const error=Object.assign(new Error('fixture access denied'),{code:'EACCES'});
 const readdir=fs.readdir;fs.readdir=async p=>{if(p===dir)throw error;return readdir(p);};
 try{await assert.rejects(listClaudeProjectFiles(dir),{code:'EACCES'});}finally{fs.readdir=readdir;}
 const stat=fs.stat;const file=path.join(dir,'rollout.jsonl');fs.stat=async p=>{if(p===file)throw error;return stat(p);};
 const cursors={files:{}},collectionStatus={codex:{status:'ok',last_successful_at:'previous'}};
 try{await assert.rejects(parseRolloutIncremental({rolloutFiles:[file],queuePath:path.join(dir,'queue.jsonl'),cursors,collectionStatus}),{code:'EACCES'});}finally{fs.stat=stat;}
 assert.equal(collectionStatus.codex.status,'error');assert.equal(collectionStatus.codex.last_successful_at,'previous');assert.deepEqual(cursors,{files:{}});
});
test('OpenCode malformed complete message fails transaction and valid replacement recovers',async t=>{
 const {parseOpencodeIncremental}=require('../src/lib/rollout');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-opencode-error-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'message.json'),queuePath=path.join(dir,'queue.jsonl');await fs.writeFile(file,'{broken');
 const cursors={files:{}},collectionStatus={opencode:{status:'ok',last_successful_at:'previous'}};
 const options={messageFiles:[file],queuePath,cursors,collectionStatus};
 await assert.rejects(parseOpencodeIncremental(options));assert.equal(collectionStatus.opencode.status,'error');assert.deepEqual(cursors,{files:{}});
 await fs.writeFile(file,JSON.stringify({id:'m',sessionID:'s',modelID:'fixture',time:{created:Date.parse('2026-09-22T01:00:00Z')},tokens:{input:100,output:0}}));
 await parseOpencodeIncremental(options);assert.equal(collectionStatus.opencode.status,'ok');
});

test('DeepSeek Harness read failures remain visible and recover without erasing history',async t=>{
 const {parseDeepSeekHarnessIncremental}=require('../src/lib/rollout');
 const zstd=require('@mongodb-js/zstd');const {readQueueData}=require('../src/lib/local-api');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-dsh-health-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'session.jsonl.zstd'),queuePath=path.join(dir,'queue.jsonl');
 const bytes=Buffer.from(await zstd.compress(Buffer.from(JSON.stringify({type:'assistant/message',time:'2026-09-22T01:00:00Z',data:{turn:1,step:1,usage:{inputTokens:100}}})+'\n')));
 await fs.writeFile(file,bytes);const cursors={files:{}},collectionStatus={};const options={sessionFiles:[file],queuePath,cursors,collectionStatus};
 await parseDeepSeekHarnessIncremental(options);
 const success=collectionStatus['deepseek-harness'].last_successful_at;
 const before=await fs.readFile(queuePath,'utf8');const fileState=structuredClone(cursors.deepseekHarness.files);
 await fs.writeFile(file,'corrupt compressed fixture');await parseDeepSeekHarnessIncremental(options);
 assert.equal(collectionStatus['deepseek-harness'].status,'error');
 assert.equal(collectionStatus['deepseek-harness'].last_successful_at,success);
 assert.deepEqual(cursors.deepseekHarness.files,fileState);assert.equal(await fs.readFile(queuePath,'utf8'),before);
 assert.equal(readQueueData(queuePath).reduce((sum,row)=>sum+row.total_tokens,0),100);
 await fs.writeFile(file,bytes);await parseDeepSeekHarnessIncremental(options);
 assert.equal(collectionStatus['deepseek-harness'].status,'ok');assert.equal(await fs.readFile(queuePath,'utf8'),before);
 await parseDeepSeekHarnessIncremental(options);
 assert.equal(collectionStatus['deepseek-harness'].status,'ok','unchanged readable files are not missing');
});
