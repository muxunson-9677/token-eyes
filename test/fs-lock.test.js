const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {test}=require('node:test');
const {openLock}=require('../src/lib/fs');
async function target(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tt-lock-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'sync.lock');}
test('live owner remains locked after the stale threshold on the actual filesystem',async t=>{
  const file=await target(t);const first=await openLock(file,{quietIfLocked:true});
  await fs.utimes(file,new Date(0),new Date(0));const second=await openLock(file,{quietIfLocked:true});
  try{assert.equal(second,null);}finally{await first.release();await second?.release();}
});
test('a crashed child owner is recoverable without waiting five minutes',async t=>{
  const file=await target(t);const modulePath=path.resolve('src/lib/fs.js');
  const child=cp.spawnSync(process.execPath,['-e','require(process.argv[1]).openLock(process.argv[2],{quietIfLocked:true}).then(()=>process.exit(0))',modulePath,file],{windowsHide:true});
  assert.equal(child.status,0);const lock=await openLock(file,{quietIfLocked:true});assert.ok(lock);await lock.release();
});
test('old owner release cannot delete a replacement owner lock',async t=>{
  const file=await target(t);const first=await openLock(file,{quietIfLocked:true});
  const replacement={pid:process.pid,token:'replacement-owner'};
  await fs.writeFile(file,JSON.stringify(replacement));
  await first.release();assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),replacement);
});
test('concurrent sync triggers leave one pending follow-up for the owner',async t=>{
  const file=await target(t);const first=await openLock(file,{quietIfLocked:true,coalesce:true});
  assert.equal(await openLock(file,{quietIfLocked:true,coalesce:true}),null);
  assert.equal(await first.release(),true);
  const followup=await openLock(file,{quietIfLocked:true,coalesce:true});
  assert.equal(await followup.release(),false);
});

test('Windows dead-lock recovery serializes contenders across the check-delete boundary', {skip:process.platform!=="win32"}, async t => {
 const file=await target(t);const child=cp.spawnSync(process.execPath,['-e','process.exit(0)'],{windowsHide:true});
 await fs.writeFile(file,JSON.stringify({pid:child.pid,token:'dead'}));
 const unlink=fs.unlink;let contender,intercepted=false;
 fs.unlink=async p=>{if(p===file&&!intercepted){intercepted=true;contender=await openLock(file,{quietIfLocked:true});}return unlink(p);};
 let owner;try{owner=await openLock(file,{quietIfLocked:true});}finally{fs.unlink=unlink;}
 try{assert.ok(owner);assert.equal(contender,null);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).pid,process.pid);}finally{await owner?.release();await contender?.release();}
});

test('Windows kernel gate excludes another process even if the legacy file disappears', {skip:process.platform!=="win32"}, async t => {
 const file=await target(t);const owner=await openLock(file,{quietIfLocked:true});await fs.unlink(file);
 try {const child=cp.spawnSync(process.execPath,['-e','require(process.argv[1]).openLock(process.argv[2],{quietIfLocked:true}).then(async lock=>{if(lock){await lock.release();process.exit(2)}process.exit(0)})',path.resolve('src/lib/fs.js'),file],{windowsHide:true,timeout:5000});assert.equal(child.status,0);} finally {await owner.release();}
 const recovered=await openLock(file,{quietIfLocked:true});assert.ok(recovered);await recovered.release();
});
