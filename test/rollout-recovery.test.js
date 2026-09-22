const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parseClaudeIncremental, parseRolloutIncremental } = require('../src/lib/rollout');

for (const targetName of ['main','project']) test('process exit during '+targetName+' queue append recovers its torn tail', async t => {
  const f=await fixture(t);await fs.mkdir(path.join(f.dir,'.git'));await fs.writeFile(path.join(f.dir,'.git/config'),'[remote "origin"]\nurl = https://github.com/acme/project.git\n');
  const projectQueuePath=path.join(f.dir,'project.queue.jsonl'),cursorPath=path.join(f.dir,'cursor.json');
  const options={projectFiles:[f.file],queuePath:f.queuePath,projectQueuePath,cursors:f.cursors,publicRepoResolver:async()=>({status:'public_verified',projectKey:'acme/project',projectRef:'https://github.com/acme/project'})};
  await fs.writeFile(f.file,JSON.stringify(claude('first'))+'\n');await parseClaudeIncremental(options);await fs.writeFile(cursorPath,JSON.stringify(f.cursors));await fs.appendFile(f.file,JSON.stringify(claude('second',50))+'\n');
  const script="const fs=require('node:fs/promises');(async()=>{const args=JSON.parse(process.argv[2]),cursors=JSON.parse(await fs.readFile(args.cursorPath,'utf8')),open=fs.open;fs.open=async(file,...a)=>{const h=await open(file,...a);if(file===args.target&&a[0]==='a+'){const append=h.appendFile.bind(h);h.appendFile=async text=>{await append(text.slice(0,20));process.exit(17)};}return h};await require(process.argv[1]).parseClaudeIncremental({...args,cursors,publicRepoResolver:async()=>({status:'public_verified',projectKey:'acme/project',projectRef:'https://github.com/acme/project'})});})()";
  const cp=require('node:child_process');const child=cp.spawnSync(process.execPath,['-e',script,path.resolve('src/lib/rollout.js'),JSON.stringify({projectFiles:[f.file],queuePath:f.queuePath,projectQueuePath,cursorPath,target:targetName==='main'?f.queuePath:projectQueuePath})],{windowsHide:true,timeout:10000});assert.equal(child.status,17);
  options.cursors=JSON.parse(await fs.readFile(cursorPath,'utf8'));await parseClaudeIncremental(options);await parseClaudeIncremental(options);assert.equal(latestTotal(await rows(f.queuePath)),150);assert.equal(latestTotal(await rows(projectQueuePath)),150);
  const backups=(await fs.readdir(f.dir)).filter(name=>name.includes('.torn-'));assert.equal(backups.length,1);assert.equal((await fs.readFile(path.join(f.dir,backups[0]))).length,20);
});

const claude = (id, input = 100) => ({ type: 'assistant', timestamp: '2026-09-22T01:10:00Z', message: { id, model: 'claude-sonnet-4', usage: { input_tokens: input, output_tokens: 0 } }, marker: '中文' });
const codex = (id, input = 100) => ({ type: 'event_msg', timestamp: `2026-09-22T01:${id}:00Z`, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 0, total_tokens: input }, last_token_usage: { input_tokens: input, total_tokens: input } } }, marker: '中文' });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'rollout-test.jsonl'), queuePath: path.join(dir, 'queue.jsonl'), cursors: { version: 1, files: {} } };
}
async function rows(file) { return (await fs.readFile(file, 'utf8').catch(e => { if(e.code === 'ENOENT') return ''; throw e; })).trim().split('\n').filter(Boolean).map(JSON.parse); }
function latestTotal(records) {
  const latest = new Map(records.map(r => [[r.source,r.model,r.hour_start,r.billing_mode].join('|'), r.total_tokens]));
  return [...latest.values()].reduce((a,b) => a+b,0);
}
for (const [name, parse, entry, field] of [['Claude', parseClaudeIncremental, () => claude('a'), 'projectFiles'], ['Codex', parseRolloutIncremental, () => codex('10'), 'rolloutFiles']]) {
  test(`${name}: incomplete UTF-8 tail resumes exactly once, CRLF and complete no-newline records work`, async t => {
    const f = await fixture(t); const bytes = Buffer.from(JSON.stringify(entry()));
    const cut = bytes.indexOf(Buffer.from('中文')) + 1;
    await fs.writeFile(f.file, bytes.subarray(0, cut));
    const options = { ...f, [field]: [f.file] };
    await parse(options);
    assert.equal(f.cursors.files[f.file].offset, 0);
    await fs.appendFile(f.file, Buffer.concat([bytes.subarray(cut), Buffer.from('\r\n')]));
    await parse(options); await parse(options);
    assert.equal(latestTotal(await rows(f.queuePath)), 100);
    assert.equal(f.cursors.files[f.file].offset, bytes.length + 2);
    const next = name === 'Claude' ? claude('b', 50) : codex('11', 150);
    await fs.appendFile(f.file, JSON.stringify(next));
    await parse(options); await parse(options);
    assert.equal(latestTotal(await rows(f.queuePath)), 150);
  });
  test(`${name}: complete corrupt line does not block following usage`, async t => {
    const f=await fixture(t); await fs.writeFile(f.file, '{broken}\n'+JSON.stringify(entry())+'\n');
    await parse({...f,[field]:[f.file]}); assert.equal(latestTotal(await rows(f.queuePath)),100);
  });
  test(`${name}: append failure leaves caller state unchanged and retry does not lose usage`, async t => {
    const f=await fixture(t); await fs.writeFile(f.file, JSON.stringify(entry())+'\n');
    const before=structuredClone(f.cursors); const originalOpen=fs.open;
    fs.open=async (file,...args) => { if(file===f.queuePath) throw Object.assign(new Error('injected write failure'),{code:'ENOSPC'}); return originalOpen(file,...args); };
    try { await assert.rejects(parse({...f,[field]:[f.file]}),/injected/); } finally { fs.open=originalOpen; }
    assert.deepEqual(f.cursors,before);
    await parse({...f,[field]:[f.file]}); assert.equal(latestTotal(await rows(f.queuePath)),100);
  });
}
test('Claude: project context is passed to the production project branch', async t => {
  const f=await fixture(t); await fs.mkdir(path.join(f.dir,'.git')); await fs.writeFile(path.join(f.dir,'.git/config'),'[remote "origin"]\nurl = https://github.com/acme/project.git\n');
  await fs.writeFile(f.file, JSON.stringify(claude('project'))+'\n');
  const projectQueuePath=path.join(f.dir,'project.queue.jsonl');
  await parseClaudeIncremental({...f,projectFiles:[f.file],projectQueuePath,publicRepoResolver:async()=>({status:'public_verified',projectKey:'acme/project',projectRef:'https://github.com/acme/project'})});
  const projectRows=await rows(projectQueuePath); assert.equal(latestTotal(projectRows),100); assert.equal(projectRows[0].repo_root,f.dir);
});
test('Claude: Windows subagent path keeps tokens but excludes user conversation counts', {skip:process.platform!=='win32'}, async t => {
  const f=await fixture(t); const file=path.join(f.dir,'中文 路径','subagents','child.jsonl'); await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file, JSON.stringify({type:'user',timestamp:'2026-09-22T01:10:00Z',message:{content:'fixture'}})+'\n'+JSON.stringify(claude('child'))+'\n');
  await parseClaudeIncremental({...f,projectFiles:[file]}); const result=await rows(f.queuePath);
  assert.equal(latestTotal(result),100); assert.equal(result.reduce((s,r)=>s+r.conversation_count,0),0);
});

test('Claude: same-inode rewrite and atomic replacement resume without duplicating old usage', async t => {
  const f=await fixture(t); const options={...f,projectFiles:[f.file]};
  await fs.writeFile(f.file,JSON.stringify(claude('old'))+'\n'); await parseClaudeIncremental(options);
  await fs.writeFile(f.file,JSON.stringify(claude('new'))+'\n'); await parseClaudeIncremental(options);
  assert.equal(latestTotal(await rows(f.queuePath)),200);
  const replacement=f.file+'.new'; await fs.writeFile(replacement,JSON.stringify(claude('old'))+'\n'+JSON.stringify(claude('new'))+'\n'+JSON.stringify(claude('third',25))+'\n');
  await fs.rename(replacement,f.file); await parseClaudeIncremental(options); await parseClaudeIncremental(options);
  assert.equal(latestTotal(await rows(f.queuePath)),225);
});

test('Claude: partial queue append rolls back disk and deep state before retry', async t => {
  const f=await fixture(t); const options={...f,projectFiles:[f.file]};
  await fs.writeFile(f.file,JSON.stringify(claude('first'))+'\n'); await parseClaudeIncremental(options);
  await fs.appendFile(f.file,JSON.stringify(claude('second',50))+'\n');
  const before=structuredClone(f.cursors), disk=await fs.readFile(f.queuePath,'utf8'); const originalOpen=fs.open;
  fs.open=async(file,...args)=>{const h=await originalOpen(file,...args); if(file===f.queuePath && args[0]==='a+') {const append=h.appendFile.bind(h);h.appendFile=async data=>{await append(data.slice(0,25));throw new Error('partial append');};} return h;};
  try {await assert.rejects(parseClaudeIncremental(options),/partial append/);} finally {fs.open=originalOpen;}
  assert.deepEqual(f.cursors,before); assert.equal(await fs.readFile(f.queuePath,'utf8'),disk);
  await parseClaudeIncremental(options); assert.equal(latestTotal(await rows(f.queuePath)),150);
});

test('Claude: project queue failure retracts main append and preserves both cursors', async t => {
  const f=await fixture(t); await fs.mkdir(path.join(f.dir,'.git')); await fs.writeFile(path.join(f.dir,'.git/config'),'[remote "origin"]\nurl = https://github.com/acme/project.git\n');
  await fs.writeFile(f.file,JSON.stringify(claude('first'))+'\n');
  const options={...f,projectFiles:[f.file],projectQueuePath:path.join(f.dir,'project.queue.jsonl'),publicRepoResolver:async()=>({status:'public_verified',projectKey:'acme/project',projectRef:'https://github.com/acme/project'})};
  const originalOpen=fs.open,before=structuredClone(f.cursors);
  fs.open=async(file,...args)=>{if(file===options.projectQueuePath)throw new Error('project append');return originalOpen(file,...args);};
  try {await assert.rejects(parseClaudeIncremental(options),/project append/);} finally {fs.open=originalOpen;}
  assert.deepEqual(f.cursors,before); assert.equal(latestTotal(await rows(f.queuePath)),0);
  await parseClaudeIncremental(options); assert.equal(latestTotal(await rows(f.queuePath)),100); assert.equal(latestTotal(await rows(options.projectQueuePath)),100);
});

test('read-only Codex collection shares cumulative reset and duplicate semantics without creating a queue',async t=>{
  const {collectRolloutQueueRows}=require('../src/lib/rollout');
  const f=await fixture(t);const meta={type:'session_meta',payload:{id:'s'}};
  await fs.writeFile(f.file,[meta,codex('10',100),codex('10',100),codex('11',150),codex('12',20)].map(JSON.stringify).join('\n')+'\n');
  const copy=f.file+'.copy';await fs.copyFile(f.file,copy);
  const result=await collectRolloutQueueRows([f.file,copy]);
  assert.equal(result.reduce((sum,row)=>sum+row.total_tokens,0),170);
  await assert.rejects(fs.stat(f.queuePath),{code:'ENOENT'});
});

test('request collector uses cumulative/reset accounting and deduplicates archive copies',async t=>{
  const {collectRolloutRequestUsageRecords}=require('../src/lib/rollout');const f=await fixture(t);
  await fs.writeFile(f.file,[{type:'session_meta',payload:{id:'request-session',model:'gpt-5'}},codex('10',100),codex('10',100),codex('11',150),codex('12',20)].map(JSON.stringify).join('\n')+'\n');
  const copy=f.file+'.copy';await fs.copyFile(f.file,copy);
  const result=await collectRolloutRequestUsageRecords({rolloutFiles:[f.file,copy],source:'codex',limit:1000});
  assert.equal(result.totals.total_tokens,170);
});

test('mixed account evidence never assigns the whole bucket to its last account', async t => {
  const f=await fixture(t); const a=codex('10',100),b=codex('11',300);
  Object.assign(a.payload.info,{billing_mode:'api_key',provider_id:'deepseek',account_ref:'account/deepseek/a'});
  Object.assign(b.payload.info,{billing_mode:'api_key',provider_id:'deepseek',account_ref:'account/deepseek/b'});
  await fs.writeFile(f.file,[a,b].map(JSON.stringify).join('\n')+'\n');
  await parseRolloutIncremental({...f,rolloutFiles:[f.file]});
  const final=(await rows(f.queuePath)).at(-1);
  assert.equal(final.total_tokens,300);assert.equal(final.account_ref,undefined);
});

test('Codex: data appended during a read is consumed only by the next checkpoint', async t => {
  const f=await fixture(t);const first=JSON.stringify(codex('10',100))+'\n';await fs.writeFile(f.file,first);
  const originalOpen=fs.open;let appended=false;
  fs.open=async(file,...args)=>{const h=await originalOpen(file,...args);if(file===f.file&&args[0]==='r'){const read=h.read.bind(h);h.read=async(...args)=>{const result=await read(...args);if(!appended){appended=true;await fs.appendFile(f.file,JSON.stringify(codex('11',150))+'\n');}return result;};}return h;};
  const options={...f,rolloutFiles:[f.file]};
  try{await parseRolloutIncremental(options);}finally{fs.open=originalOpen;}
  assert.equal(f.cursors.files[f.file].offset,Buffer.byteLength(first));assert.equal(latestTotal(await rows(f.queuePath)),100);
  await parseRolloutIncremental(options);assert.equal(latestTotal(await rows(f.queuePath)),150);
});
for(const commitCursor of [false,true]) test('process exit '+(commitCursor?'after':'before')+' cursor commit preserves exactly-once latest snapshots on restart',async t=>{
  const cp=require('node:child_process');const f=await fixture(t);await fs.writeFile(f.file,JSON.stringify(claude('restart'))+'\n');
  const cursorFile=path.join(f.dir,'cursors.json');await fs.writeFile(cursorFile,JSON.stringify(f.cursors));
  // Separate process owns memory; no persisted cursor means it is deliberately lost.
  const scriptWithCommit='const fs=require("node:fs");const [modulePath,file,queue,cursor,commit]=process.argv.slice(1);const cursors=JSON.parse(fs.readFileSync(cursor,"utf8"));require(modulePath).parseClaudeIncremental({projectFiles:[file],queuePath:queue,cursors}).then(()=>{if(commit==="true")fs.writeFileSync(cursor,JSON.stringify(cursors));process.exit(17)});';
  const child=cp.spawnSync(process.execPath,['-e',scriptWithCommit,path.resolve('src/lib/rollout.js'),f.file,f.queuePath,cursorFile,String(commitCursor)],{windowsHide:true});assert.equal(child.status,17);
  const cursors=JSON.parse(await fs.readFile(cursorFile,'utf8'));await parseClaudeIncremental({projectFiles:[f.file],queuePath:f.queuePath,cursors});
  assert.equal(latestTotal(await rows(f.queuePath)),100);
});

test('a complete queue row without a final newline is preserved before retry append',async t=>{
 const f=await fixture(t),options={...f,projectFiles:[f.file]};await fs.writeFile(f.file,JSON.stringify(claude('first'))+'\n');await parseClaudeIncremental(options);
 const original=await fs.readFile(f.queuePath,'utf8');await fs.writeFile(f.queuePath,original.trimEnd());await fs.appendFile(f.file,JSON.stringify(claude('second',50))+'\n');await parseClaudeIncremental(options);assert.equal(latestTotal(await rows(f.queuePath)),150);assert.ok((await fs.readFile(f.queuePath,'utf8')).startsWith(original));
});
