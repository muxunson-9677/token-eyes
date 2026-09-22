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
