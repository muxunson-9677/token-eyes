const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('usage line reader skips large message envelopes but preserves metadata and partial EOF', async () => {
  const { readCodexUsageLines } = require('../src/lib/codex-usage-lines');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-eyes-usage-lines-'));
  try {
    const file = path.join(root, 'rollout.jsonl');
    const metadata = [
      JSON.stringify({ type: 'session_meta', payload: { id: 's' } }),
      JSON.stringify({ timestamp: '2026-09-12T08:00:00Z', type: 'turn_context', payload: { model: 'm' } }),
      JSON.stringify({ timestamp: '2026-09-12T08:00:02Z', type: 'event_msg', payload: { type: 'agent_event', msg: { type: 'token_count', info: { last_token_usage: { total_tokens: 150 } } } } }),
      JSON.stringify({ timestamp: '2026-09-12T08:00:01Z', type: 'event_msg', payload: { type: 'token_count', info: {} } }),
    ];
    const body = JSON.stringify({ timestamp: '2026-09-12T08:00:00Z', ordinal: 1, type: 'response_item', payload: { type: 'message', content: 'private token_count'.repeat(100000) } });
    const compacted = JSON.stringify({ timestamp: '2026-09-12T08:00:00Z', ordinal: 2, type: 'compacted', payload: { replacement_history: 'private'.repeat(100000) } });
    fs.writeFileSync(file, [metadata[0], body, compacted, ...metadata.slice(1)].join('\r\n'));
    const lines = [];
    for await (const line of readCodexUsageLines(file)) lines.push(line.trim());
    assert.deepEqual(lines, metadata);
    const { extractTokenCount } = require('../src/lib/codex-rollout-parser');
    assert.equal(lines.reduce((sum, line) => sum + (extractTokenCount(JSON.parse(line))?.info?.last_token_usage?.total_tokens || 0), 0), 150);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('timezone metadata reuses a formatter across timestamps', () => {
  const { getZonedParts } = require('../src/lib/codex-rollout-parser');
  const Original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = function (...args) { constructions += 1; return new Original(...args); };
  try {
    for (let index = 0; index < 100; index += 1) getZonedParts(new Date(1789210000000 + index * 1000), { timeZone: 'Pacific/Chatham' });
    assert.ok(constructions <= 1, `constructed ${constructions} formatters`);
  } finally { Intl.DateTimeFormat = Original; }
});
