const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const { parseWorkbuddyIncremental } = require("../src/lib/rollout");

// Numeric values are synthetic. Field nesting was checked read-only on 2026-09-22.
test("WorkBuddy observed providerData.rawUsage shape preserves disjoint totals on reread", async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tt-workbuddy-shape-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,"session.jsonl"),queuePath=path.join(dir,"queue.jsonl"),cursors={files:{}};
 await fs.writeFile(file,JSON.stringify({type:"message",role:"assistant",uuid:"synthetic-message",sessionId:"synthetic-session",timestamp:Date.parse("2026-09-22T01:00:00Z"),providerData:{model:"hy3-preview-agent",rawUsage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:80},cached_tokens:80,cache_read_input_tokens:80,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,cache_creation_input_tokens:0,prompt_cache_write_tokens:0,completion_tokens_details:{reasoning_tokens:5},completion_thinking_tokens:5}}})+"\n");
 const options={projectFiles:[file],queuePath,cursors};await parseWorkbuddyIncremental(options);await parseWorkbuddyIncremental(options);
 const rows=(await fs.readFile(queuePath,"utf8")).trim().split("\n").map(JSON.parse);assert.equal(rows.length,1);
 const row=rows[0];assert.equal(row.source,"workbuddy");assert.equal(row.model,"hy3-preview-agent");assert.equal(row.input_tokens,20);assert.equal(row.cached_input_tokens,80);assert.equal(row.output_tokens,15);assert.equal(row.reasoning_output_tokens,5);assert.equal(row.total_tokens,120);
});
