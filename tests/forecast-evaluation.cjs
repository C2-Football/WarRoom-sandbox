'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {engine} = require('../scripts/audit-football-logic.cjs');
const {checkRecord,evaluateExport} = require('../scripts/lib/forecast-evaluation.cjs');
const clone = x => JSON.parse(JSON.stringify(x));
let n = 0;
async function test(name,fn) {await fn();n++;console.log('PASS '+name);}
async function fixture() {
    const e=engine();e.crypto=webcrypto;e.TextEncoder=TextEncoder;
    for (const file of ['availability-forecast.js','forecast-ledger.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/shared',file),'utf8'),e);
    e.S={currentLeagueId:'L',season:2026,nflState:{season:2026}};
    const records=[];
    const journal=e.App.ForecastLedger.createLedger({store:{async addOnce(r){records.push(clone(r));return true;}},now:()=> '2026-09-06T12:00:00Z'});
    const ctx={leagueId:'L',skin:{type:'redraft'},league:{season:2026,scoring_settings:{rec:1}},playersData:{a:{team:'IND',position:'WR'}}};
    const result={week:1,remainingWeeks:16,points:{a:160},values:{a:5000}};
    await journal.capture(ctx,result,{a:10});
    const r=records[0];assert(r);
    const outcomes=Array.from({length:16},(_,i)=>({leagueId:'L',season:2026,week:i+2,configHash:r.configHash,complete:true,asOf:'2027-02-01T00:00:00Z',points:{a:8}}));
    const registration={receipts:[{id:r.id,receivedAt:'2026-09-07T00:00:00Z'}],cutoffs:[{season:2026,week:2,firstKickoffAt:'2026-09-13T00:00:00Z',completeSchedule:true,source:'synthetic schedule, not NFL evidence'}]};
    const options={registration,evaluatedAt:'2027-02-02T00:00:00Z'};
    return {e,r,ledger:{records},outcomes,options,journal,ctx,result};
}
async function main() {
await test('Actual capture fingerprints verify and receipt-gated comparison runs',async()=>{
    const f=await fixture();assert.equal(checkRecord(f.r),null);
    const report=evaluateExport(f.ledger,f.outcomes,f.options);
    assert.equal(report.matureRuns,1);assert.equal(report.results[0].baseline.mae,32);
    assert.equal(report.evaluationMode,'receipt_cutoff_checked');assert.equal(report.externalEvidenceAuthenticated,false);
});
await test('Changed predictions, scoring, runtime, and IDs fail integrity checking',async()=>{
    const f=await fixture();
    for(const change of [r=>r.rows[0].baseline.points=128,r=>r.config.scoring.rec=2,r=>r.runtimeSignatures.price='different',r=>r.id='a'.repeat(64)]) {
        const r=clone(f.r);change(r);assert.equal(checkRecord(r),'fingerprint_mismatch');
        assert.equal(evaluateExport({records:[r]},f.outcomes,f.options).distinctRuns,0);
    }
});
await test('Invalid player rows and duplicate IDs cannot inflate sample size',async()=>{
    const f=await fixture();const r=clone(f.r);r.rows.push(clone(r.rows[0]));assert.equal(checkRecord(r),'invalid_player_rows');
    const report=evaluateExport({records:[f.r,f.r]},f.outcomes,f.options);
    assert.equal(report.distinctRuns,1);assert.equal(report.duplicateRecordIds.length,1);
});
await test('Local-only evaluation is explicitly exploratory',async()=>{
    const f=await fixture();const report=evaluateExport(f.ledger,f.outcomes,{evaluatedAt:f.options.evaluatedAt});
    assert.equal(report.matureRuns,1);assert.equal(report.evaluationMode,'exploratory');assert.match(report.warning,/do not establish/);
});
await test('Late upload and exact kickoff boundary are rejected despite early client time',async()=>{
    const f=await fixture();
    for(const time of ['2026-09-13T00:00:00Z','2026-09-14T00:00:00Z']) {
        f.options.registration.receipts[0].receivedAt=time;
        const report=evaluateExport(f.ledger,f.outcomes,f.options);
        assert.equal(report.matureRuns,0);assert.equal(report.rejected[0].reason,'received_at_or_after_first_kickoff');
    }
});
await test('Missing, duplicate and impossible receipts fail closed',async()=>{
    const f=await fixture();const receipt=f.options.registration.receipts[0];
    for(const receipts of [[],[receipt,receipt],[{...receipt,receivedAt:'2026-09-05'}],[{...receipt,receivedAt:'2028-01-01'}]]) {
        f.options.registration.receipts=receipts;assert.equal(evaluateExport(f.ledger,f.outcomes,f.options).matureRuns,0);
    }
});
await test('Missing or uncertified schedule and wrong season/week cannot pass the gate',async()=>{
    const f=await fixture();const cutoff=f.options.registration.cutoffs[0];
    for(const cutoffs of [[],[cutoff,cutoff],[{...cutoff,completeSchedule:false}],[{...cutoff,source:''}],[{...cutoff,season:2025}],[{...cutoff,week:3}]]) {
        f.options.registration.cutoffs=cutoffs;assert.equal(evaluateExport(f.ledger,f.outcomes,f.options).matureRuns,0);
    }
});
await test('Shared league settings never permit another league’s results',async()=>{
    const f=await fixture();for(const o of f.outcomes)o.leagueId='OTHER';
    assert.equal(evaluateExport(f.ledger,f.outcomes,f.options).matureRuns,0);
    assert.equal(f.e.App.ForecastLedger.evaluate(f.r,f.outcomes,{evaluatedAt:f.options.evaluatedAt}).ready,false);
});
await test('Invalid outcomes remain failures, not zero-filled success',async()=>{
    const f=await fixture();
    for(const points of [[], 'not a map', {a:null}]) {
        f.outcomes[0].points=points;
        const report=evaluateExport(f.ledger,f.outcomes,f.options);assert.equal(report.matureRuns,0);
    }
});
await test('Earliest registered run wins even when the later run scores better',async()=>{
    const f=await fixture();f.result.points.a=128;await f.journal.capture(f.ctx,f.result,{a:8});
    const newer=f.ledger.records[1];f.options.registration.receipts.push({id:newer.id,receivedAt:'2026-09-08T00:00:00Z'});
    const report=evaluateExport({records:[newer,f.r]},f.outcomes,f.options);
    assert.equal(report.distinctRuns,1);assert.equal(report.results[0].recordId,f.r.id);
    assert.equal(report.results[0].baseline.mae,32);assert.deepEqual(report.supersededRecordIds,[newer.id]);
});
await test('Malformed envelopes are rejected without hiding other usable records',async()=>{
    const f=await fixture();const report=evaluateExport({records:[null,{},f.r]},f.outcomes,f.options);
    assert.equal(report.rejected.length,2);assert.equal(report.matureRuns,1);
    assert.throws(()=>evaluateExport(f.ledger,f.outcomes,{registration:{}}),/receipts and cutoffs/);
});
console.log(`${n} evaluation integrity checks passed.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
