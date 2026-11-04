'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/advice-fixture.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
test('legal fixed-projection lineups include FLEX and exclude a 100-point benched player',()=>{
 const f=fixture(),r=f.record(),grade=f.A.evaluate(f.entry(r),f.packets(r),{hash:f.hash});
 assert.equal(grade.eligible,true);assert.equal(grade.horizons[0].status,'complete');assert.equal(grade.horizons[0].current.versusHold,-1);assert.equal(grade.horizons[0].current.versusSimple,-9);
 assert(!grade.weeks[0].models.current.starters.some(p=>p.pid==='b'));assert.equal(grade.weeks[0].models.current.starters.length,5);
 const flexible=plain(f.c);flexible.players.r.fantasy_positions=['RB','WR'];assert.equal(f.A.lineup(flexible,flexible.roster.players,flexible.initialWeek).starters.length,5);
});
test('frozen records are independent copies and paired engines have identical input identity',()=>{
 const f=fixture(),r=f.record();assert.equal(r.engineInputs.current,r.engineInputs.candidate);assert.equal(r.engineInputs.current,r.engineInputs.simple);
 f.c.players.f.position='QB';assert.equal(r.context.players.f.position,'RB');assert.equal(f.A.checkRecord(r,f.hash),null);
 r.choices.current.incoming=['g'];assert.equal(f.A.checkRecord(r,f.hash),'fingerprint_mismatch');
});
test('late receipts, future sources, stale inputs and late weekly snapshots cannot be prospectively graded',()=>{
 for(const reason of ['late','future','stale']){const f=fixture();if(reason==='future')f.c.sources[0].observedAt='2026-10-01T00:00:00Z';if(reason==='stale')f.c.sources[0].observedAt='2026-08-01T00:00:00Z';const r=f.record(),entry=f.entry(r);if(reason==='late')entry.receivedAt=f.c.deadline;const g=f.A.evaluate(entry,f.packets(r),{hash:f.hash});assert.equal(g.eligible,false,reason);assert.equal(g.horizons[0].status,'excluded');}
 const f=fixture(),r=f.record(),p=f.packets(r);p[0].lineupReceivedAt=f.c.weeks[0].firstKickoffAt;const g=f.A.evaluate(f.entry(r),p,{hash:f.hash});assert.equal(g.horizons[0].status,'partial');assert.match(g.weeks[0].reason,/late/);
});
test('missing actuals stay missing while explicit zero grades normally; partial never replaces full horizon',()=>{
 const f=fixture(),r=f.record(),p=f.packets(r);delete p[0].outcome.players.f;let g=f.A.evaluate(f.entry(r),p,{hash:f.hash});assert.equal(g.horizons[0].current,null);assert.equal(g.weeks[0].reason,'missing_player_outcomes');
 p[0].outcome.players.f={status:'zero',points:0};g=f.A.evaluate(f.entry(r),p,{hash:f.hash});assert.equal(g.horizons[0].status,'complete');assert.equal(g.horizons[0].current.versusHold,-6);
 g=f.A.evaluate(f.entry(r),p.slice(0,1),{hash:f.hash});assert.equal(g.horizons[1].status,'partial');assert.equal(g.horizons[1].current,null);assert.equal(g.horizons[1].completedWeeks,1);
});
test('byes use pregame status; required drops, locks, FAAB and partner capacity are legal constraints',()=>{
 const f=fixture();f.c.initialWeek.players.f.status='bye';const r=f.record();assert(!f.A.lineup(f.c,f.A.rosterAfter(f.c,r.choices.current),f.c.initialWeek).starters.some(p=>p.pid==='f'));
 assert(f.A.legality(f.c,{kind:'waiver',incoming:['f'],outgoing:[],drops:[],faab:1}).reasons.includes('required_drop_missing'));
 f.c.locks.d=true;assert.equal(f.A.legality(f.c,r.choices.current).ok,false);f.c.locks.d=false;f.c.budget.remaining=0;assert.equal(f.A.legality(f.c,r.choices.current).ok,false);
 const t=fixture('trade');t.c.rosters[1].players=['f','g','a','b2','c','d2','e'];const m={kind:'trade',incoming:['f'],outgoing:['d','x'],drops:[],faab:0,partnerRosterId:2};assert(t.A.legality(t.c,m).reasons.includes('partner_required_drop_missing'));
});
test('move effective after the weekly freeze contributes no extra points until the next full week',()=>{
 const f=fixture();f.c.effectiveAt='2026-09-04T00:00:00Z';const r=f.record(),g=f.A.evaluate(f.entry(r),f.packets(r),{hash:f.hash});assert.equal(g.horizons[0].current.versusHold,0);assert.equal(g.weeks[0].models.current.moveEffective,false);assert.equal(g.weeks[1].models.current.moveEffective,true);
});
test('hold/no-upgrade cases are retained and candidate failures are exposed rather than filtering current results',()=>{
 const f=fixture();f.c.issued={status:'empty',reason:'No clear upgrade',candidates:[]};f.c.versions.candidate='unavailable-candidate';const r=f.record();assert.equal(r.choices.current.kind,'hold');assert.equal(r.choices.candidate,null);
 const g=f.A.evaluate(f.entry(r),f.packets(r),{hash:f.hash}),summary=f.A.summarize([f.entry(r)],[g],[{status:'captured'},{status:'failed'},{status:'missing'}]);assert.equal(g.horizons[0].current.versusHold,0);assert.equal(summary.groups[0].missingCandidate,1);assert.equal(summary.groups[0].paired.n,0);assert.equal(summary.coverage.missing,2);
});
test('corrections change grades without changing recommendations; hypothetical trades never imply acceptance or wins',()=>{
 const f=fixture('trade'),r=f.record(),before=f.hash(r),p=f.packets(r),g1=f.A.evaluate(f.entry(r),p,{hash:f.hash});p[0].outcome.players.f.points=35;const g2=f.A.evaluate(f.entry(r),p,{hash:f.hash});assert.equal(f.hash(r),before);assert.equal(g2.horizons[0].current.versusHold-g1.horizons[0].current.versusHold,30);assert.equal(g2.feasibility.accepted,'unknown');assert.equal(g2.feasibility.completedAcquisition,false);assert.equal(g2.feasibility.causalWins,null);
});
test('repeated player/week exposure across leagues is clustered, not independent evidence',()=>{
 const f=fixture();const u=f.A.uncertainty(Array.from({length:20},(_,i)=>({value:i,exposures:['2026:1:f']})));assert.equal(u.clusters,1);assert.equal(u.interval,null);assert.equal(u.conclusion,'insufficient evidence');
 const r=f.record(),g=f.A.evaluate(f.entry(r),f.packets(r),{hash:f.hash}),s=f.A.summarize([f.entry(r),f.entry(r)],[g],[]);assert.equal(s.groups[0].distinct.decisions,1);
});
test('only precise probability events are scored; generic confidence never becomes a probability',()=>{
 const f=fixture();const p={eventId:'sent-offer-1-accepted',horizon:'before-week-2',kind:'probability',probability:0.8,receivedAt:'2026-09-01',deadline:'2026-09-02'};
 const result=f.A.probabilityScore([p,{...p,kind:'confidence'}, {...p,eventId:'unsent'}],[{eventId:p.eventId,horizon:p.horizon,occurred:true,observedAt:'2026-09-03'}]);assert.equal(result.n,1);assert(Math.abs(result.brier-.04)<1e-10);assert.equal(result.missing.length,2);
});
