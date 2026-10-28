'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createClient}=require('@supabase/supabase-js');
const {database,transport,owner}=require('./helpers/value-monitor-db.cjs');
const {fixture}=require('./helpers/value-monitor-inputs.cjs');
const {collect,engineFiles,H}=require('../scripts/value-monitor/worker.cjs');
const runtime=require('../reconai-shared/value-monitor-runtime.cjs');
const config=()=>({league_id:'L',value_type:'redraft',season:2026,player_ids:['p1','p3'],scope:{kind:'players'},timezone:'America/Chicago',starts_at:new Date(Date.now()-60000).toISOString(),user_id:owner});
const rpc=async(db,name,arg)=> (await db.query(`select ${name}($1::jsonb) as r`,[JSON.stringify(arg)])).rows[0].r;
const claim=async db=>(await db.query('select claim_value_monitor_capture() as r')).rows[0].r;
test('server canonical calculations match separately loaded app dynasty and redraft engines',async()=>{
 for(const variant of [{type:'redraft'},{type:'dynasty'},{type:'redraft',custom:true}]){
  const {type}=variant,f=fixture(type),now=Date.now(),run={...config(),value_type:type,id:'fixture',capture_index:0};
  if(variant.custom){f.league.roster_positions=['QB','QB','RB','WR','TE','SUPER_FLEX','BN'];Object.assign(f.league.scoring_settings,{pass_cmp:.25,pass_fd:.5,bonus_rec_te:1});run.player_ids=['p0','p1','p3'];}
  const result=await runtime.calculate({run,fetcher:f.fetcher,files:engineFiles(),dataDir:process.cwd(),now});
  // Independent browser-style script host, production modules loaded directly.
  const state={currentLeagueId:'L',season:2026,leagues:[f.league],rosters:f.rosters,players:f.players,nflState:f.nflState,platform:'sleeper'};
  const b={App:{S:state},S:state,console:{log(){},warn(){}},Date,URL,URLSearchParams,performance,setTimeout,clearTimeout,fetch:async url=>String(url).startsWith('draft-war-room/')?new Response(fs.readFileSync(String(url))):f.fetcher(url),DhqStorage:{get:(_,d)=>d,set(){}},STORAGE_KEYS:{HIST_KEY:id=>'h'+id},isSandbox:()=>true};b.window=b;b.globalThis=b;vm.createContext(b);
  for(const name of runtime.MODULES)vm.runInContext(fs.readFileSync(engineFiles()[name]||path.join('reconai-shared',name),'utf8'),b);
  vm.runInContext(fs.readFileSync(engineFiles()['availability-forecast.js'],'utf8'),b);
  let values;
  if(type==='dynasty'){await b.App.loadRookieProspects();await b.App.loadLeagueIntel();values=b.App.LI.playerScores;}else{
   b.App.LeagueSkin={getCurrent:()=>({type:'redraft'})};const market=Object.fromEntries(f.market.map(r=>[r.player.sleeperId,r.value]));
   values=b.App.PlayerValue.ensureRos({league:f.league,leagueId:'L',playersData:f.players,statsData:f.stats,priorData:f.stats,projectionsData:f.projections,marketRedraft:market,noMarketFetch:true,skin:{type}}).values;
  }
  for(const row of result.rows){assert.equal(row.value,values[row.player_id],type+' '+row.player_id);assert.equal(row.calculation_status,'ok');assert(row.provenance.engineVersion);assert(row.provenance.sources);}
 }
});
test('fresh reads are required; stale responses and missing redraft values stay explicit',async()=>{
 const f=fixture(),run={...config(),id:'fixture',capture_index:0};f.players.p1.injury_status='IR';
 const r=await runtime.calculate({run,files:engineFiles(),dataDir:process.cwd(),fetcher:async url=>{const response=await f.fetcher(url);response.headers.set('Age','3600');return response;}});
 assert.equal(r.rows[0].value,null);assert.equal(r.rows[0].calculation_status,'missing');assert.equal(r.rows[1].calculation_status,'stale');
 await assert.rejects(runtime.calculate({run,files:engineFiles(),dataDir:process.cwd(),fetcher:async()=>{throw Error('input offline');}}),/offline/);
 f.league.season='2025';await assert.rejects(runtime.calculate({run,files:engineFiles(),dataDir:process.cwd(),fetcher:f.fetcher}),/season/);
});
test('database enrollment is explicit, claims exclude overlap, token fences late writes and atomic finish verifies rows',async()=>{
 const {db,migrate}=await database();try{await migrate();const id=await rpc(db,'enroll_value_monitor',config());
 await assert.rejects(rpc(db,'enroll_value_monitor',config()),/unique/);
 const job=await claim(db);assert.equal(job.run.id,id);assert.equal(job.capture.capture_index,0);assert.equal(await claim(db),null);
 const rows=['p1','p3'].map(pid=>H.normalize({leagueId:'L',playerId:pid,season:2026,week:8,value:0,valueType:'redraft',source:'monitor',captureKey:'unused',ts:new Date().toISOString(),calculatedAt:new Date().toISOString(),status:'ok'}));
 const finish=(token,values=rows)=>db.query('select finish_value_monitor_capture($1,$2,$3,$4::jsonb) as r',[id,0,token,JSON.stringify(values)]);
 await assert.rejects(finish('00000000-0000-4000-8000-000000000001'),/lease/);
 await assert.rejects(finish(job.capture.lease_token,rows.slice(0,1)),/coverage/);
 assert.equal((await finish(job.capture.lease_token)).rows[0].r.stored,2);
 assert.equal((await db.query('select value from player_value_snapshots')).rows.length,2);
 await assert.rejects(finish(job.capture.lease_token),/lease/);
 // Emulate expired scheduler windows in a controlled database, not historical live captures.
 await db.query("update value_monitor_captures set scheduled_at=now()-interval '8 hours' where run_id=$1 and capture_index>0",[id]);
 await db.query("update value_monitor_runs set ends_at=now()-interval '1 hour' where id=$1",[id]);
 assert.equal(await claim(db),null);assert.equal((await db.query('select status from value_monitor_runs')).rows[0].status,'incomplete');assert.equal((await db.query("select count(*) as n from value_monitor_captures where status='missing'")).rows[0].n,7);
 }finally{await db.close();}
});
test('worker performs autonomous fresh calculation, database save and explicit readback through pinned client',async()=>{
 const {db,migrate}=await database();try{await migrate();await rpc(db,'enroll_value_monitor',config());const calls=[];
 const client=createClient('http://127.0.0.1:9999','fixture',{global:{fetch:transport(db,{calls})},auth:{persistSession:false}});
 const results=await collect(client,{fetcher:fixture().fetcher,buildVersion:'fixture-only',maxCaptures:1});assert.equal(results[0].readbackVerified,true,JSON.stringify(results));
 assert.equal(results[0].stored,2);assert(calls.some(c=>c.method==='GET'&&c.url.includes('player_value_snapshots')));
 assert.equal((await collect(client,{maxCaptures:1})).length,0);
 }finally{await db.close();}
});
test('failed collection records attempt/error, retries are delayed, three failures stop that slot',async()=>{
 const {db,migrate}=await database();try{await migrate();const id=await rpc(db,'enroll_value_monitor',config());
 for(let i=0;i<3;i++){const job=await claim(db);assert(job);await db.query('select finish_value_monitor_capture($1,0,$2,$3::jsonb,$4)',[id,job.capture.lease_token,'[]','fixture input failure']);assert.equal(await claim(db),null);await db.query('update value_monitor_captures set lease_until=now()-interval \'1 minute\' where run_id=$1',[id]);}
 assert.equal((await db.query('select status,error from value_monitor_captures where capture_index=0')).rows[0].status,'failed');assert.equal((await db.query('select * from player_value_snapshots')).rows.length,0);
 }finally{await db.close();}
});
test('owner RLS preserved; anonymous/other owners cannot read run reports, browsers cannot enroll or forge captures',async()=>{
 const {db,migrate}=await database();try{await migrate();await rpc(db,'enroll_value_monitor',config());
 await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner})]);await db.exec('set role authenticated');assert.equal((await db.query('select * from value_monitor_runs')).rows.length,1);
 await assert.rejects(db.query('select claim_value_monitor_capture()'),/permission/);
 await assert.rejects(db.query("insert into player_value_snapshots(league_id,player_id,season,week,value,value_type,source,capture_key,user_id) values('L','p',2026,8,0,'redraft','monitor','forged',$1)",[owner]),/row-level security/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");await db.exec('set role anon');assert.equal((await db.query('select * from value_monitor_runs')).rows.length,0);assert.equal((await db.query('select * from value_monitor_captures')).rows.length,0);
 }finally{await db.close();}
});
test('complete eight-slot fixture retires the finite run; original observations cannot be rewritten',async()=>{
 const {db,migrate}=await database();try{await migrate();const id=await rpc(db,'enroll_value_monitor',config());
 // Dated fixtures exercise terminal reporting only; never advertise them as captures.
 const {reportFixture}=require('./helpers/value-monitor-report.cjs'),f=reportFixture();
 const fullRows=f.run.capture_times.flatMap((ts,i)=>f.run.player_ids.map(pid=>({player_id:pid,capture_index:i,ts,value:i?100:0,calculation_status:'ok',provenance:{engineVersion:'fixture',settingsFingerprint:'fixture'},roster_ids:[1]})));
 const report=H.report({...f.run,status:'complete'},f.run.capture_times.map((ts,i)=>({capture_index:i,status:'complete',captured_at:ts})),fullRows);
 assert.equal(report.complete,true);assert.equal(report.completed,16);assert.equal(report.movements[0].pct,null);
 await db.query("update value_monitor_captures set status='complete',captured_at=scheduled_at where run_id=$1",[id]);await db.query("update value_monitor_runs set ends_at=now()-interval '1 minute' where id=$1",[id]);assert.equal(await claim(db),null);assert.equal((await db.query('select status from value_monitor_runs')).rows[0].status,'complete');
 await db.exec("insert into player_value_snapshots(league_id,player_id,season,week,value,value_type,source,capture_key) values('L','p',2026,8,0,'dynasty','periodic','fixture')");await assert.rejects(db.exec('update player_value_snapshots set value=100'),/immutable/);
 }finally{await db.close();}
});
test('malformed provider structures are rejected even when the canonical dynasty loader would swallow a fetch error',async()=>{
 const f=fixture('dynasty'),run={...config(),id:'fixture',value_type:'dynasty',capture_index:0};
 const r=await runtime.calculate({run,files:engineFiles(),dataDir:process.cwd(),fetcher:url=>String(url).includes('/stats/')?Promise.resolve(new Response(JSON.stringify({error:'invalid response'}))):f.fetcher(url)});
 assert(r.rows.every(r=>r.calculation_status==='error'||r.value==null));assert(r.rows[0].provenance.failures.some(f=>f.error.includes('structure')));
});
