const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {parseGeminiIncremental,normalizeGeminiTokens}=require('../src/lib/rollout');
// Contract: google-gemini/gemini-cli v0.24.0 chatRecordingService.recordMessageTokens.
test('Gemini input includes cached tokens and tool prompt is not output',()=>{
  const n=normalizeGeminiTokens({input:100,cached:80,output:20,total:120});
  assert.equal(n.input_tokens,20);assert.equal(n.cached_input_tokens,80);assert.equal(n.total_tokens,120);
  const tool=normalizeGeminiTokens({input:100,cached:80,output:20,thoughts:10,tool:5,total:130});
  assert.equal(tool.output_tokens,20);assert.equal(tool.reasoning_output_tokens,10);assert.equal(tool.total_tokens,130);
});
test('Gemini distinct messages sum, a revision replaces its contribution, and copies do not duplicate',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-message-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'session-test.json'),queuePath=path.join(dir,'queue.jsonl'),cursors={files:{}};
  const messages=[100,150].map((input,i)=>({id:`m${i}`,type:'gemini',model:'gemini-3-flash-preview',timestamp:'2026-09-22T01:00:00Z',tokens:{input,output:0,total:input}}));
  const save=()=>fs.writeFile(file,JSON.stringify({sessionId:'s',messages}));
  const total=async()=>JSON.parse((await fs.readFile(queuePath,'utf8')).trim().split('\n').at(-1)).total_tokens;
  const options={sessionFiles:[file],cursors,queuePath};await save();await parseGeminiIncremental(options);assert.equal(await total(),250);
  messages[1].tokens={input:100,output:0,total:100};await save();await parseGeminiIncremental(options);assert.equal(await total(),200);
  messages[0].tokens={input:150,output:0,total:150};await save();await parseGeminiIncremental(options);await parseGeminiIncremental(options);assert.equal(await total(),250);
  const copy=file+'.copy.json';await fs.copyFile(file,copy);await parseGeminiIncremental({...options,sessionFiles:[copy,file]});assert.equal(await total(),250);
});

test('Gemini invalid count fields cannot silently normalize to exact zero',()=>{
 for(const tokens of [{input:-1,output:1,total:1},{input:100,output:'bad',total:100},{input:1.5,output:0,total:1},{input:100,output:0,tool:-1,total:100}]) assert.throws(()=>normalizeGeminiTokens(tokens));
});

for (const order of [['new','old'],['old','new']]) test('Gemini revision ordering '+order.join(' -> '),async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-revision-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files={old:path.join(dir,'old.json'),new:path.join(dir,'new.json'),low:path.join(dir,'low.json')};
 const save=(file,input,lastUpdated)=>fs.writeFile(file,JSON.stringify({sessionId:'same',lastUpdated,messages:[{id:'m',type:'gemini',model:'gemini-3-flash-preview',timestamp:'2026-09-22T01:00:00Z',tokens:{input,output:0,total:input}}]}));
 await save(files.old,100,'2026-09-22T01:01:00Z');await save(files.new,150,'2026-09-22T01:02:00Z');
 const queuePath=path.join(dir,'queue.jsonl'),cursors={files:{}};
 const run=async names=>parseGeminiIncremental({sessionFiles:names.map(n=>files[n]),queuePath,cursors});
 const total=async()=>JSON.parse((await fs.readFile(queuePath,'utf8')).trim().split('\n').at(-1)).total_tokens;
 await run(order);assert.equal(await total(),150);
 await run([...order].reverse());assert.equal(await total(),150);
 await save(files.low,80,'2026-09-22T01:03:00Z');await run(['low',...order]);assert.equal(await total(),80);
 await run([...order,'low']);assert.equal(await total(),80);
});
test('Gemini conflicting copies without revision evidence fail without publishing',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-conflict-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files=[path.join(dir,'a.json'),path.join(dir,'b.json')];
 for(const [i,file]of files.entries())await fs.writeFile(file,JSON.stringify({sessionId:'same',messages:[{id:'m',model:'gemini',timestamp:'2026-09-22T01:00:00Z',tokens:{input:100+i*50,output:0,total:100+i*50}}]}));
 for(const sessionFiles of [files,[...files].reverse()]){
  const cursors={files:{}},queuePath=path.join(dir,'queue.jsonl');
  await assert.rejects(parseGeminiIncremental({sessionFiles,cursors,queuePath}),/revision.*conflict/i);
  assert.deepEqual(cursors,{files:{}});await assert.rejects(fs.stat(queuePath),{code:'ENOENT'});
 }
});

for (const withTimestamp of [true,false]) test(`Gemini v1 contributed state seeds only an unchanged original source (${withTimestamp})`,async t=>{
 const fixture=require('./fixtures/gemini/message-usage-v1.json');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-v1-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'session.json'),queuePath=path.join(dir,'queue.jsonl');
 const session=structuredClone(fixture.input);if(!withTimestamp)delete session.lastUpdated;
 await fs.writeFile(file,JSON.stringify(session));await fs.writeFile(queuePath,fixture.queue);
 const cursors=structuredClone(fixture.cursors);cursors.files[file]={...cursors.files.__SOURCE__,inode:(await fs.stat(file)).ino};delete cursors.files.__SOURCE__;
 const run=()=>parseGeminiIncremental({sessionFiles:[file],queuePath,cursors});
 await run();assert.equal(await fs.readFile(queuePath,'utf8'),fixture.queue,'baseline seeding does not re-add old consumption');
 session.messages[0].tokens={input:150,output:0,total:150};if(withTimestamp)session.lastUpdated='2026-09-22T01:02:00Z';
 await fs.writeFile(file,JSON.stringify(session));await run();await run();
 const {readQueueData}=require('../src/lib/local-api');assert.equal(readQueueData(queuePath).reduce((sum,row)=>sum+row.total_tokens,0),150);
 session.messages[0].tokens={input:0,output:0,total:0};if(withTimestamp)session.lastUpdated='2026-09-22T01:03:00Z';
 await fs.writeFile(file,JSON.stringify(session));await run();assert.equal(readQueueData(queuePath).reduce((sum,row)=>sum+row.total_tokens,0),0);
});

for(const order of [['copy','original'],['original','copy']])test(`Gemini v1 upgrade stages known baseline before revisions: ${order}`,async t=>{
 const fixture=require('./fixtures/gemini/message-usage-v1.json');const {readQueueData}=require('../src/lib/local-api');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-v1-order-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const files={original:path.join(dir,'original.json'),copy:path.join(dir,'copy.json')},queuePath=path.join(dir,'queue.jsonl');
 await fs.writeFile(files.original,JSON.stringify(fixture.input));const updated=structuredClone(fixture.input);updated.lastUpdated='2026-09-22T01:02:00Z';updated.messages[0].tokens={input:150,output:0,total:150};await fs.writeFile(files.copy,JSON.stringify(updated));
 const cursors=structuredClone(fixture.cursors);cursors.files[files.original]={...cursors.files.__SOURCE__,inode:(await fs.stat(files.original)).ino};delete cursors.files.__SOURCE__;await fs.writeFile(queuePath,fixture.queue);
 await parseGeminiIncremental({sessionFiles:order.map(name=>files[name]),queuePath,cursors});assert.equal(readQueueData(queuePath).reduce((n,row)=>n+row.total_tokens,0),150);
});

test('Gemini v1 cannot infer a missing original baseline from an untracked equal copy',async t=>{
 const fixture=require('./fixtures/gemini/message-usage-v1.json');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-v1-guard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'untracked-copy.json'),queuePath=path.join(dir,'queue.jsonl'),cursors=structuredClone(fixture.cursors);delete cursors.files.__SOURCE__;
 await fs.writeFile(file,JSON.stringify(fixture.input));await fs.writeFile(queuePath,fixture.queue);
 const options={sessionFiles:[file],queuePath,cursors};await parseGeminiIncremental(options);await parseGeminiIncremental(options);
 assert.equal(Object.values(cursors.geminiMessageUsage)[0].revision,undefined);
 const changed=structuredClone(fixture.input);changed.lastUpdated='2026-09-22T01:02:00Z';changed.messages[0].tokens={input:150,output:0,total:150};await fs.writeFile(file,JSON.stringify(changed));
 const before=structuredClone(cursors);await assert.rejects(parseGeminiIncremental(options),/revision conflict/);assert.deepEqual(cursors,before);assert.equal(await fs.readFile(queuePath,'utf8'),fixture.queue);
});

test('Gemini v1 original already changed at first upgrade cannot reconstruct an old revision',async t=>{
 const fixture=require('./fixtures/gemini/message-usage-v1.json');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-gemini-v1-changed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'original.json'),queuePath=path.join(dir,'queue.jsonl'),session=structuredClone(fixture.input);
 session.lastUpdated='2026-09-22T01:02:00Z';session.messages[0].tokens={input:150,output:0,total:150};await fs.writeFile(file,JSON.stringify(session));await fs.writeFile(queuePath,fixture.queue);
 const cursors=structuredClone(fixture.cursors);cursors.files[file]={...cursors.files.__SOURCE__,inode:(await fs.stat(file)).ino};delete cursors.files.__SOURCE__;const before=structuredClone(cursors);
 await assert.rejects(parseGeminiIncremental({sessionFiles:[file],queuePath,cursors}),/revision conflict/);assert.deepEqual(cursors,before);assert.equal(await fs.readFile(queuePath,'utf8'),fixture.queue);
});
