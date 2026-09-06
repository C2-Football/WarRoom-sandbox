'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createArchive} = require('../js/shared/forecast-archive.js');
let n = 0;
async function test(name, fn) {await fn(); console.log('PASS ' + name); n++;}
function entry(i) {const id = i.toString(16).padStart(64,'0'); return {record:{id,leagueId:'L'},receipt:{id,receivedAt:'2026-09-06T12:00:00Z'}};}
async function main() {
await test('No authenticated session means no network calls', async () => {
    const archive = createArchive({token:()=>null, client:()=>{throw Error('must not connect');}});
    await assert.rejects(archive.save(entry(1).record), /Sign in/);
    await assert.rejects(archive.read('L'), /Sign in/);
});
await test('Save returns the server receipt without mutating the forecast', async () => {
    const e = entry(1), before = JSON.stringify(e.record);
    const archive = createArchive({token:()=> 'session',client:()=>({rpc:async(name,args)=>{
        assert.equal(name,'archive_forecast'); assert.deepEqual(args,{p_record:e.record});
        return {data:e.receipt};
    }})});
    assert.deepEqual(await archive.save(e.record), e.receipt);
    assert.equal(JSON.stringify(e.record),before);
});
await test('Missing migration, network failures and invalid receipts do not pretend success', async () => {
    for (const response of [{error:{message:'function unavailable'}},{data:{id:'wrong',receivedAt:'2026-09-06'}},{data:{id:entry(1).record.id,receivedAt:'bad'}}]) {
        const archive = createArchive({token:()=> 'session',client:()=>({rpc:async()=>response})});
        await assert.rejects(archive.save(entry(1).record));
    }
});
await test('Recovery follows all pages and preserves original receipts', async () => {
    const expected = Array.from({length:51},(_,i)=>entry(i+1));
    const archive = createArchive({token:()=> 'session',client:()=>({rpc:async(name,args)=>{
        assert.equal(name,'read_forecast_archive'); assert.equal(args.p_league_id,'L');
        return {data:expected.filter(e=>e.record.id>args.p_after).slice(0,25)};
    }})});
    assert.deepEqual(await archive.read('L'),expected);
});
await test('Wrong league, repeated cursor and bad receipt abort recovery', async () => {
    for (const page of [[{...entry(1),record:{...entry(1).record,leagueId:'OTHER'}}],[entry(1),entry(1)],[{...entry(1),receipt:{id:'wrong'}}]]) {
        const archive = createArchive({token:()=> 'session',client:()=>({rpc:async()=>({data:page})})});
        await assert.rejects(archive.read('L'),/Invalid/);
    }
});
await test('Account switching during recovery aborts rather than merging owners', async () => {
    let session='first';
    const archive = createArchive({token:()=>session,client:()=>({rpc:async()=>{session='second';return {data:[entry(1)]};}})});
    await assert.rejects(archive.read('L'),/Account changed/);
});
await test('Migration contract denies table mutation and derives owner and receipt server-side', () => {
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260906000000_forecast_archive.sql'),'utf8');
    assert.match(sql,/enable row level security/);
    assert.match(sql,/revoke all on public.forecast_archive from public, anon, authenticated/);
    assert.match(sql,/default clock_timestamp\(\)/);
    assert.match(sql,/on conflict \(owner_key, forecast_id\) do nothing/);
    assert.match(sql,/saved.payload <> p_record/);
    assert.match(sql,/owner_key = principal and league_id = p_league_id/);
    assert.doesNotMatch(sql,/grant (?:all|update|delete|insert|select) on public.forecast_archive /i);
});
console.log(`${n} forecast archive checks passed (SQL contract only; database runtime not exercised).`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
