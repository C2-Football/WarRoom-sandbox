'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const {database,transport,owner}=require('./helpers/value-monitor-db.cjs');
const H=require('../reconai-shared/value-history.js');
function browser(fetch,source){
 const session={token:'fixture-token',user:{id:owner}};
 const b={document:{querySelector:()=>null,addEventListener(){}},addEventListener(){},location:{pathname:'/'},navigator:{},App:{ValueHistory:H,CONFIG:{supabaseUrl:'http://127.0.0.1:9999',supabaseAnon:'fixture-anon'}},OD:{},supabase:{createClient:(url,key,opts)=>createClient(url,key,{...opts,global:{...opts.global,fetch},auth:{persistSession:false,autoRefreshToken:false}})},localStorage:{getItem:k=>k==='fw_session_v1'?JSON.stringify(session):null,setItem(){}},console,fetch,setTimeout:()=>0,clearTimeout,setInterval:()=>0};b.window=b;vm.createContext(b);vm.runInContext(source||fs.readFileSync('reconai-shared/supabase-client.js','utf8'),b);return b;
}
const row=(extra={})=>({leagueId:'L',playerId:'p',season:2026,week:8,value:0,valueType:'redraft',source:'periodic',ts:'2026-10-28T12:00:00Z',...extra});
test('actual pinned Supabase 2.101.1 reproduces zero dispatched writes before fix; both repaired functions POST and read persisted zero',async()=>{
 assert.equal(require('@supabase/supabase-js/package.json').version,'2.101.1');
 const {db,migrate}=await database();try{
  await migrate();const calls=[],fetch=transport(db,{calls});
  const old=fs.readFileSync('tests/helpers/value-writers-before-fix.js','utf8');
  const before=browser(fetch);vm.runInContext(old,before);before.OD.recordValueSnapshot(row());before.OD.recordValueSnapshots([row()]);await new Promise(r=>setTimeout(r,30));assert.equal(calls.length,0);
  const b=browser(fetch);assert.equal((await b.OD.recordValueSnapshot(row())).verified,true);
  assert.equal((await b.OD.recordValueSnapshots([row({playerId:'p2'})])).rows[0].value,0);
  assert.equal(calls.filter(c=>c.method==='POST').length,2);assert.equal((await b.OD.loadValueSnapshots({leagueId:'L'})).length,2);
 }finally{await db.close();}
});
test('same-week days, idempotent retries, formats, events and older weekly rows coexist after replay-safe migration',async()=>{
 const {db,migrate}=await database();try{
  await db.exec("insert into player_value_snapshots(league_id,player_id,season,week,value,value_type,source,ts) values('L','p',2025,8,9000,'dynasty','trade','2025-10-01')");
  await migrate();await migrate();const b=browser(transport(db));
  await b.OD.recordValueSnapshot(row());await b.OD.recordValueSnapshot(row({value:99}));await b.OD.recordValueSnapshot(row({ts:'2026-10-29T12:00:00Z'}));
  await b.OD.recordValueSnapshot(row({valueType:'dynasty',value:8000}));
  for(const eventId of ['a','b'])await b.OD.recordValueSnapshot(row({source:'trade',eventId}));
  const rows=await b.OD.loadValueSnapshots({leagueId:'L',playerId:'p'});assert.equal(rows.length,6);assert.equal(rows[0].value,9000);
  assert.equal(rows.filter(r=>r.value_type==='redraft'&&r.source==='periodic').length,2);assert.equal(rows.find(r=>r.capture_key==='browser-day:2026-10-28'&&r.value_type==='redraft').value,0);
  assert.equal((await b.OD.loadValueSnapshots({leagueId:'L',valueType:'redraft'})).length,4);
 }finally{await db.close();}
});
test('database failures, rejected transport, missing authentication and validation reject observably',async()=>{
 const {db,migrate}=await database();try{await migrate();let mode='denied';const b=browser(transport(db,{failure:()=>mode}));
 await assert.rejects(b.OD.recordValueSnapshot(row()),/denied/);mode='reject';await assert.rejects(b.OD.recordValueSnapshots([row()]),/network failure|fetch/i);
 mode=null;await assert.rejects(b.OD.recordValueSnapshot(row({value:NaN})),/Invalid/);
 b.localStorage.getItem=()=>null;await assert.rejects(b.OD.recordValueSnapshot(row()),/Sign in/);
 }finally{await db.close();}
});
test('readback failure cannot be reported as verified; missing differs from zero',async()=>{
 const {db,migrate}=await database();try{await migrate();const b=browser(transport(db,{failure:r=>r.method==='GET'?'read denied':null}));await assert.rejects(b.OD.recordValueSnapshot(row({value:null})),/readback failed/);assert.equal((await db.query('select value,calculation_status from player_value_snapshots')).rows[0].value,null);
 }finally{await db.close();}
});
test('finite report flags missing slots, stale/partial coverage, settings/engine changes and undefined zero percentages',()=>{
 const t=Date.parse('2026-10-20T12:00:00Z'),run={id:'r',value_type:'redraft',status:'incomplete',player_ids:['p','q'],capture_times:Array.from({length:8},(_,i)=>new Date(t+i*86400000).toISOString())};
 const rows=[{player_id:'p',capture_index:0,value:0,calculation_status:'ok',provenance:{engineVersion:'1',settingsFingerprint:'a',sourceFingerprint:'x'},roster_ids:[1]},{player_id:'p',capture_index:7,value:2000,calculation_status:'ok',provenance:{engineVersion:'2',settingsFingerprint:'b',sourceFingerprint:'y'},roster_ids:[2]},{player_id:'q',capture_index:7,value:4,calculation_status:'stale'}];
 const r=H.report(run,[{capture_index:7,status:'partial',captured_at:new Date(t+7*86400000).toISOString()}],rows,t+8*86400000);assert.equal(r.complete,false);assert.equal(r.expected,16);assert.equal(r.completed,3);assert.equal(r.movements[0].pct,null);assert.equal(r.movements[0].jump,true);assert.equal(r.movements[0].associations.length,4);assert.equal(r.movements[1].delta,null);assert.equal(r.days[7].stale,1);
});
module.exports={browser,row};
test('history reader paginates beyond a PostgREST page instead of losing older records',async()=>{
 const {db,migrate}=await database();try{await migrate();await db.exec("insert into player_value_snapshots(league_id,player_id,season,week,value,value_type,source,capture_key,ts) select 'L','p',2026,8,0,'dynasty','periodic','fixture:'||i,now()+i*interval '1 second' from generate_series(1,1001) i");
 const b=browser(transport(db));assert.equal((await b.OD.loadValueSnapshots({leagueId:'L',playerId:'p',valueType:'dynasty'})).length,1001);
 }finally{await db.close();}
});
test('browser capture preserves zero/unknown and isolates a late save from a switched league',async()=>{
 let release;const gate=new Promise(r=>release=r),saved=[];
 const S={currentLeagueId:'A',nflState:{season:2026,week:8},leagues:[{league_id:'A',settings:{type:0},scoring_settings:{},roster_positions:[]}],rosters:[{roster_id:1,players:['zero','unknown']}]};
 const board={values:{zero:0},calculatedAt:Date.now()};
 const b={S,App:{LI:{sourceLeagueId:'A',playerScores:{zero:8000,unknown:8000}},PlayerValue:{rosState:()=>board,getSeasonValue:()=>9999},ValueHistory:{fingerprint:()=>gate},ValueEngineVersion:'fixture'},OD:{recordValueSnapshots:async rows=>{saved.push(...rows);return {rows};}},DhqEvents:{on(){}},console,Date,Map,Set,setTimeout};b.window=b;vm.createContext(b);vm.runInContext(fs.readFileSync('js/shared/snapshot-store.js','utf8'),b);
 const pending=b.WrSnapshots.capturePlayerValues();S.currentLeagueId='B';S.rosters=[{roster_id:9,players:['zero']}];release('fixture-settings');await pending;
 assert.equal(saved[0].leagueId,'A');assert.equal(saved[0].value,0);assert.equal(saved[1].value,null);assert.equal(saved[0].rosterIds[0],1);assert.equal(b.WrSnapshots.saveState('A').status,'verified');assert.equal(b.WrSnapshots.saveState('B').status,'idle');
});
