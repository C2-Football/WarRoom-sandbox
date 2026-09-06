'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {engine} = require('../scripts/audit-football-logic.cjs');
const ROOT = path.resolve(__dirname,'..');
function setup() {
    const e = engine(); e.crypto = webcrypto; e.TextEncoder = TextEncoder;
    for (const file of ['availability-forecast.js','forecast-ledger.js']) vm.runInContext(fs.readFileSync(path.join(ROOT,'js/shared',file),'utf8'),e);
    e.S = {currentLeagueId: 'L', season: 2026, nflState: {season: 2026}};
    const saved = new Map();
    const store = {async addOnce(r){if(saved.has(r.id))return false;saved.set(r.id,JSON.parse(JSON.stringify(r)));return true;},async all(){return [...saved.values()].map(r=>JSON.parse(JSON.stringify(r)));}};
    const journal = e.App.ForecastLedger.createLedger({store,now:()=> '2026-09-06T12:00:00Z'});
    const ctx = {leagueId:'L',skin:{type:'redraft'},league:{season:'2026',total_rosters:12,roster_positions:['QB','RB','WR','TE'],scoring_settings:{rec:1}},playersData:{a:{team:'IND',position:'WR'},b:{team:null,position:'RB'},zero:{team:'IND'},missing:{team:'IND'}},statsData:{a:{gp:1,rec:10}}};
    const result = {week:1,remainingWeeks:16,points:{a:160,b:160,zero:0,missing:0},values:{a:5000,b:5000,zero:0,missing:0}};
    return {e,journal,saved,ctx,result,healthy:{a:10,b:10,zero:0}};
}
let n=0;async function test(name,fn){await fn();n++;console.log('PASS '+name);}
async function main(){
await test('Healthy status quo and byes are explicit assumptions',()=>{
    const {e}=setup();const r=e.App.AvailabilityForecast.forecast({player:{team:'IND',bye_week:3},weeks:[2,3,4],healthyPerWeek:10,capturedAt:'2026-09-06'});
    assert.equal(r.expectedPoints,20);assert.equal(r.expectedActiveWeeks,2);assert.equal(r.calibrated,false);
});
await test('IR, OUT and unsigned do not imply a fabricated full-season zero or return',()=>{
    const {e}=setup();for(const player of [{team:'IND',injury_status:'IR'},{team:'IND',injury_status:'Out'},{team:null}]){
        const r=e.App.AvailabilityForecast.forecast({player,weeks:[2,3],healthyPerWeek:10,capturedAt:'2026-09-06'});
        assert.equal(r.expectedPoints,null);assert.equal(r.scenarioLowPoints,0);assert.equal(r.scenarioHighPoints,20);
    }
});
await test('Explicit week evidence can model a return without overriding a bye',()=>{
    const {e}=setup();const r=e.App.AvailabilityForecast.forecast({player:{team:'IND',injury_status:'IR',bye_week:4},season:2026,weeks:[2,3,4],healthyPerWeek:10,capturedAt:'2026-09-06',evidence:{season:2026,source:'test fixture only',asOf:'2026-09-05',probabilityByWeek:{2:0,3:.5,4:1}}});
    assert.equal(r.expectedPoints,5);assert.equal(r.expectedActiveWeeks,.5);
});
await test('Future-dated evidence rejected and missing baseline distinguished from zero',()=>{
    const {e}=setup();const r=e.App.AvailabilityForecast.forecast({player:{team:null},season:2026,weeks:[2],healthyPerWeek:null,capturedAt:'2026-09-06',evidence:{season:2026,source:'test',asOf:'2026-09-07',probabilityByWeek:{2:1}}});
    assert.equal(r.evidenceRejected,true);assert.equal(r.baselineKnown,false);assert.equal(r.scenarioLowPoints,null);
});
await test('Hash ordering stable, first-write immutable, input changes create new records',async()=>{
    const {journal,ctx,result,healthy,saved}=setup();const first=await journal.capture(ctx,result,healthy);assert(first.inserted);
    ctx.statsData.a={rec:10,gp:1};assert.equal((await journal.capture(ctx,result,healthy)).inserted,false);
    ctx.statsData.a.rec=11;assert.equal((await journal.capture(ctx,result,healthy)).inserted,true);assert.equal(saved.size,2);
    assert.equal([...saved.values()][0].rows.find(r=>r.pid==='a').inputs.currentStats.rec,10);
});
await test('Zero and missing players survive capture; identity and league settings recorded',async()=>{
    const {journal,ctx,result,healthy}=setup();await journal.capture(ctx,result,healthy);const r=(await journal.read('L'))[0];
    assert.equal(r.rows.length,4);assert.equal(r.config.scoring.rec,1);assert.equal(r.config.leagueType,'redraft');assert.equal(r.inputHash.length,64);assert.equal(r.runtimeHash.length,64);assert.equal(r.provenance.sourceTimestampsVerified,false);
});
await test('Snapshots copy inputs before asynchronous hashing',async()=>{
    const {journal,ctx,result,healthy}=setup();const p=journal.capture(ctx,result,healthy);ctx.playersData.a.team='DAL';await p;
    assert.equal((await journal.read('L'))[0].rows.find(r=>r.pid==='a').inputs.player.team,'IND');
});
await test('Historical, projected and cross-league captures are rejected',async()=>{
    for(const change of [s=>s.ctx.league.season='2025',s=>s.ctx.playersData.a._projected=true,s=>s.ctx.leagueId='OTHER',s=>s.ctx.skin.type='chopped']){
        const s=setup();change(s);assert.equal(await s.journal.capture(s.ctx,s.result,s.healthy),null);assert.equal(s.saved.size,0);
    }
});
await test('Storage failure is visible and cannot masquerade as successful capture',async()=>{
    const {e,ctx,result,healthy}=setup();const j=e.App.ForecastLedger.createLedger({store:{async addOnce(){throw Error('quota');}},now:()=> '2026-09-06'});
    assert.equal(await j.capture(ctx,result,healthy),null);assert.equal(j.status.error,'quota');assert.equal(j.status.lastCapture,null);
});
await test('Evidence cannot leak across seasons',()=>{
    const {e}=setup();const r=e.App.AvailabilityForecast.forecast({player:{team:null},season:2026,weeks:[2],healthyPerWeek:10,capturedAt:'2026-09-06',evidence:{season:2025,source:'test',asOf:'2025-09-01',probabilityByWeek:{2:1}}});
    assert.equal(r.evidenceRejected,true);assert.equal(r.expectedPoints,null);
});
await test('A new runtime implementation creates a new version fingerprint',async()=>{
    const {e,journal,ctx,result,healthy}=setup();const first=await journal.capture(ctx,result,healthy);
    e.App.StartSit.projectPlayerWeek=function changedModelForTest(){};
    const second=await journal.capture(ctx,result,healthy);assert.notEqual(first.id,second.id);
});
await test('Dynasty scenario outputs are frozen without applying them to scores',async()=>{
    const {e,journal,ctx,result,healthy}=setup();ctx.skin.type='dynasty';ctx.playersData.a.age=22;e.App.LI={playerScores:{a:7000}};
    await journal.capture(ctx,result,healthy);const r=(await journal.read())[0].rows.find(r=>r.pid==='a');
    assert.equal(Object.keys(r.dynastyScenario.valuesBySeason).join(','),'2027,2028,2029');assert.equal(e.App.LI.playerScores.a,7000);
});
await test('Evaluation requires completed, correctly-scored outcomes and reports coverage',async()=>{
    const {e,journal,ctx,result,healthy}=setup();await journal.capture(ctx,result,healthy);const r=(await journal.read())[0];
    const outcomes=Array.from({length:16},(_,i)=>({leagueId:'L',season:2026,week:i+2,complete:true,asOf:'2027-02-01',configHash:r.configHash,points:{a:8}}));
    assert.equal(e.App.ForecastLedger.evaluate(r,outcomes.slice(1)).ready,false);
    const evaluated=e.App.ForecastLedger.evaluate(r,outcomes,{evaluatedAt:'2027-02-02'});assert.equal(evaluated.ready,true);assert.equal(evaluated.totalPlayers,4);assert.equal(evaluated.pairedPlayers,2);assert.equal(evaluated.coverage,.5);assert.equal(evaluated.baseline.mae,16);assert.equal(evaluated.challenger.mae,16);assert.equal(evaluated.unresolvedPlayers,1);assert.equal(evaluated.missingBaselinePlayers,1);assert.equal(evaluated.baselineAllKnown.n,3);
    outcomes[0].complete=false;assert.equal(e.App.ForecastLedger.evaluate(r,outcomes).ready,false);
});
await test('Shadow capture failure leaves public prices byte-for-byte unchanged',()=>{
    const {e,ctx}=setup();const pv=e.App.PlayerValue;
    const input={...ctx,week:1,scoring:{rec:1},playerScores:{a:5000},projectionsData:{a:{gp:17,rec:170}}};
    const before=JSON.stringify(pv.computePrices(input));let calls=0;e.App.ForecastLedger.capture=()=>{calls++;throw Error('failure');};
    assert.equal(JSON.stringify(pv.computePrices({...input,_captureForecast:true})),before);assert.equal(calls,1);
});
await test('Changed availability is compared on the same sample, without promotion',async()=>{
    const {e,journal,ctx,result,healthy}=setup();ctx.availabilityEvidence={a:{season:2026,source:'synthetic comparison fixture',asOf:'2026-09-05',probabilityByWeek:Object.fromEntries(Array.from({length:16},(_,i)=>[i+2,.5]))}};
    await journal.capture(ctx,result,healthy);const r=(await journal.read())[0];
    const outcomes=Array.from({length:16},(_,i)=>({leagueId:'L',season:2026,week:i+2,complete:true,asOf:'2027-02-01',configHash:r.configHash,points:{a:8}}));
    const scored=e.App.ForecastLedger.evaluate(r,outcomes,{evaluatedAt:'2027-02-02'});
    assert.equal(scored.baseline.mae,16);assert.equal(scored.challenger.mae,24);assert.equal(result.points.a,160);
    assert.equal(e.App.ForecastLedger.evaluate(r,outcomes,{evaluatedAt:'2026-09-07'}).ready,false);
    assert.equal(e.App.ForecastLedger.evaluate(r,[...outcomes,outcomes[0]],{evaluatedAt:'2027-02-02'}).ready,false);
});
await test('Dynasty production shadow neither rewrites DHQ nor populates ROS cache',()=>{
    const {e,ctx}=setup();e.App.LeagueSkin={getCurrent:()=>({type:'dynasty'})};e.S={...e.S,currentWeek:1,players:ctx.playersData,statsData:ctx.statsData,leagues:[{...ctx.league,league_id:'L'}]};e.App.LI={playerScores:{a:7000}};
    const before=JSON.stringify(e.App.LI);e.App.ForecastLedger.capture=()=>null;
    assert(e.App.ForecastLedger.captureCurrent());assert.equal(JSON.stringify(e.App.LI),before);assert.equal(e.App.PlayerValue.rosState(),null);
});
console.log(`${n} shadow-forecast checks passed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
