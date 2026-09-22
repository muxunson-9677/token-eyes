const assert=require('node:assert/strict');
const {test}=require('node:test');
const {parseRequestUsageBoundary}=require('../src/lib/rollout');
test('date-only request boundaries use the selected zone including 23h and 25h DST days',()=>{
  for(const [day,zone,start,end]of [
    ['2026-09-22','Asia/Shanghai','2026-09-21T16:00:00Z','2026-09-22T15:59:59.999Z'],
    ['2026-03-08','America/Los_Angeles','2026-03-08T08:00:00Z','2026-03-09T06:59:59.999Z'],
    ['2026-11-01','America/Los_Angeles','2026-11-01T07:00:00Z','2026-11-02T07:59:59.999Z'],
  ]) {
    assert.equal(parseRequestUsageBoundary(day,{timeZoneContext:{timeZone:zone}}),Date.parse(start));
    assert.equal(parseRequestUsageBoundary(day,{end:true,timeZoneContext:{timeZone:zone}}),Date.parse(end));
  }
});
