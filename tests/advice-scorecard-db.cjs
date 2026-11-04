'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const {database,transport,owner}=require('./helpers/value-monitor-db.cjs'),{fixture}=require('./helpers/advice-fixture.cjs');
const R=require('../scripts/advice/runtime.cjs');
const W=require('../scripts/advice/worker.cjs');
async function setup(){const {db}=await database();await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated;');await db.exec(fs.readFileSync('supabase/migrations/20261104000000_advice_scorecard.sql','utf8'));return db;}
const call=async(db,name,params)=>(await db.query(`select ${name}(${Object.keys(params).map((k,i)=>k+' => $'+(i+1)).join(',')}) r`,Object.values(params).map(x=>x&&typeof x==='object'?JSON.stringify(x):x))).rows[0].r;
async function enrolled(db){const f=fixture(),now=Date.now(),iso=d=>new Date(now+d).toISOString(),config={ownerKey:'account:'+owner,leagueId:'fixture-league',season:2026,engineHash:R.engineHash(),cohort:'validation',endWeek:4,
 weeks:f.c.weeks.map((w,i)=>({...w,freezeAt:iso((i+2)*864e5),firstKickoffAt:iso((i+2)*864e5+36e5),endsAt:iso((i+3)*864e5)})),cases:[{key:'fixture-case',kind:'waiver',firstWeek:1,captureAt:iso(36e5),deadline:iso(864e5),effectiveAt:iso(864e5+36e5)}]};
 const id=await call(db,'enroll_advice_run',{p_config:config});await db.query('update advice_runs set active=true where id=$1',[id]);await db.exec("update advice_jobs set scheduled_at=now()-interval '1 minute',next_at=now()-interval '1 minute' where kind='capture'");
 f.c.decisionId=id+':fixture-case';f.c.deadline=config.cases[0].deadline;f.c.effectiveAt=config.cases[0].effectiveAt;f.c.weeks=config.weeks;f.c.capturedAt=iso(-1000);f.c.sources[0].observedAt=iso(-2000);return {id,f,config};}
test('Supabase default browser grants cannot expose collector-only routines',async()=>{
 const db=await setup();try{
  for(const routine of ['enroll_advice_run(jsonb)','claim_advice_job()','finish_advice_job(bigint,uuid,jsonb,text)','note_advice_readback_failure(bigint,text)']){
   for(const role of ['anon','authenticated','service_role']){
    const allowed=(await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,'public.'+routine])).rows[0].allowed;
    assert.equal(allowed,role==='service_role',role+' permission for '+routine);
   }
  }
 }finally{await db.close();}
});
test('SQL saves actual advice with server receipt, immutable readback and lease fencing through pinned Supabase client',async()=>{
 const db=await setup();try{const {f}=await enrolled(db),calls=[],client=createClient('http://fixture.local','fixture',{global:{fetch:transport(db,{calls})},auth:{persistSession:false}});
 const job=(await client.rpc('claim_advice_job')).data;assert(job);assert.equal((await client.rpc('claim_advice_job')).data,null);
 const record=f.record();let result=await client.rpc('finish_advice_job',{p_id:job.job.id,p_token:job.job.lease_token,p_payload:record});assert.equal(result.error,null,result.error?.message);assert(result.data.receivedAt);
 const read=await client.from('advice_records').select('*').eq('decision_id',record.decisionId);assert.equal(read.error,null);assert.equal(R.hash(read.data[0].payload),R.hash(record));assert(calls.some(c=>c.method==='GET'&&c.url.includes('advice_records')));
 await assert.rejects(db.query("update advice_records set payload='{}'"),/immutable/);
 result=await client.rpc('finish_advice_job',{p_id:job.job.id,p_token:job.job.lease_token,p_payload:record});assert.match(result.error.message,/lease/);
 }finally{await db.close();}
});
test('owner-only browser observation saves deduplicate repeated views, reject mutation, and do real readback',async()=>{
 const db=await setup();try{await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner})]);await db.exec('set role authenticated');
 const record={id:'a'.repeat(64),ownerKey:'account:'+owner,leagueId:'L',kind:'waiver',capturedAt:'2026-11-01',issued:{status:'empty',reason:'Hold/no clear upgrade'}};
 const receipt=await call(db,'observe_advice',{p_record:record});const again=await call(db,'observe_advice',{p_record:{...record,capturedAt:'2026-11-02'}});assert.deepEqual(again,receipt);
 const read=await call(db,'read_advice_data',{p_league_id:'L',p_table:'observations'});assert.equal(read.length,1);assert.equal(read[0].payload.issued.reason,'Hold/no clear upgrade');
 await assert.rejects(call(db,'observe_advice',{p_record:{...record,issued:{status:'ready'}}}),/conflict/);
 await assert.rejects(db.query('select claim_advice_job()'),/permission/);
 await assert.rejects(db.query('select * from advice_records'),/permission/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'10000000-0000-4000-8000-000000000002'})]);await db.exec('set role authenticated');assert.equal((await call(db,'read_advice_data',{p_league_id:'L',p_table:'observations'})).length,0);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");await db.exec('set role anon');await assert.rejects(call(db,'read_advice_data',{p_league_id:'L',p_table:'observations'}),/Authentication/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({app_metadata:{sleeper_username:'legacy-fixture'}})]);await db.exec('set role anon');
 await call(db,'observe_advice',{p_record:{...record,id:'b'.repeat(64),ownerKey:'sleeper:legacy-fixture'}});assert.equal((await call(db,'read_advice_data',{p_league_id:'L',p_table:'observations'})).length,1,'Legacy JWT reads only its own observation');
 }finally{await db.close();}
});
test('failed captures retry with backoff, stop visibly after five failures, and expired intervals become missing',async()=>{
 const db=await setup();try{await enrolled(db);for(let i=0;i<5;i++){const job=await call(db,'claim_advice_job',{});assert(job);await call(db,'finish_advice_job',{p_id:job.job.id,p_token:job.job.lease_token,p_error:'fixture source unavailable'});assert.equal(await call(db,'claim_advice_job',{}),null);await db.exec("update advice_jobs set next_at=now()-interval '1 minute' where kind='capture'");}
 assert.equal((await db.query('select status,error from advice_cases')).rows[0].status,'failed');assert.equal((await db.query('select * from advice_records')).rows.length,0);
 await db.exec("update advice_jobs set deadline=now()-interval '1 minute' where kind='lineup'");await call(db,'claim_advice_job',{});assert.equal((await db.query("select count(*)::int n from advice_jobs where status='missing'")).rows[0].n,4);
 }finally{await db.close();}
});
test('lineup packets never change; identical retries deduplicate and corrected outcomes retain revision history',async()=>{
 const db=await setup();try{const {f}=await enrolled(db);let claim=await call(db,'claim_advice_job',{});await call(db,'finish_advice_job',{p_id:claim.job.id,p_token:claim.job.lease_token,p_payload:f.record()});
 async function job(kind){await db.query("update advice_jobs set next_at=now()-interval '1 minute' where kind=$1 and week=1",[kind]);return call(db,'claim_advice_job',{});}
 claim=await job('lineup');const payload={packets:[{week:1,kind:'lineup',payload:{week:1,players:{f:{projection:9}}}}]};await call(db,'finish_advice_job',{p_id:claim.job.id,p_token:claim.job.lease_token,p_payload:payload});
 await assert.rejects(db.exec("update advice_packets set payload='{}'"),/immutable/);
 for(const points of [0,0,7]){claim=await job('outcome');await call(db,'finish_advice_job',{p_id:claim.job.id,p_token:claim.job.lease_token,p_payload:{packets:[{week:1,kind:'outcome',payload:{players:{f:{status:'final',points}}}}]}});}
 assert.equal((await db.query("select count(*)::int n from advice_packets where kind='outcome'")).rows[0].n,2);
 assert.equal((await db.query("select count(*)::int n from advice_records")).rows[0].n,1);
 }finally{await db.close();}
});
test('autonomous worker ingests actual stat-shaped fixtures, persists grades, resumes idempotently and audits corrections',async()=>{
 const db=await setup();try{
  const f=fixture(),record=f.record(),p=f.packets(record)[0],runId='20000000-0000-4000-8000-000000000001';
  // Explicit historical SIMULATION setup; this is never a production capture.
  await db.query('insert into advice_runs(id,owner_key,league_id,config,active) values($1,$2,$3,$4,true)',[runId,'account:'+owner,'fixture-league',JSON.stringify({engineHash:R.engineHash()})]);
  await db.query('insert into advice_cases(decision_id,run_id,spec,status) values($1,$2,$3,\'captured\')',[record.decisionId,runId,JSON.stringify({kind:'waiver'})]);
  await db.query('insert into advice_records(decision_id,payload,received_at) values($1,$2,$3)',[record.decisionId,JSON.stringify(record),f.entry(record).receivedAt]);
  await db.query('insert into advice_packets(decision_id,week,kind,payload,fingerprint,received_at) values($1,1,\'lineup\',$2,\'fixture\',$3)',[record.decisionId,JSON.stringify(p.lineup),p.lineupReceivedAt]);
  await db.query("insert into advice_jobs(decision_id,week,kind,scheduled_at,deadline,next_at) values($1,1,'outcome',now()-interval '1 minute',now()+interval '1 day',now()-interval '1 minute')",[record.decisionId]);
  let corrected=false;
  const fetcher=async url=>{if(String(url).includes('espn'))return new Response(JSON.stringify({season:{year:2026},week:{number:1},events:[{id:'game',date:f.c.weeks[0].firstKickoffAt,status:{type:{completed:true,state:'post'}},competitions:[{competitors:[{team:{abbreviation:'KC'}},{team:{abbreviation:'BUF'}}]}]}]}));
   if(String(url).includes('/transactions/'))return new Response('[]');
   const stats=Object.fromEntries(Object.keys(f.c.players).map(pid=>[pid,{gp:1,rec:pid==='f'?(corrected?20:2):5}]));return new Response(JSON.stringify(stats));};
  const client=createClient('http://fixture.local','fixture',{global:{fetch:transport(db)},auth:{persistSession:false}});
  let results=await W.collect(client,{fetcher,maxJobs:1});assert.equal(results[0].readbackVerified,true,JSON.stringify(results));
  const first=(await db.query("select payload from advice_packets where kind='grade'")).rows[0].payload;assert.equal(first.grade.horizons[0].status,'complete',JSON.stringify(first.grade.weeks));
  await db.exec("update advice_jobs set next_at=now()-interval '1 minute'");results=await W.collect(client,{fetcher,maxJobs:1});assert.equal(results[0].readbackVerified,true);assert.equal((await db.query("select count(*)::int n from advice_packets where kind='grade'")).rows[0].n,1);
  corrected=true;await db.exec("update advice_jobs set next_at=now()-interval '1 minute'");await W.collect(client,{fetcher,maxJobs:1});
  assert.equal((await db.query("select count(*)::int n from advice_packets where kind='grade'")).rows[0].n,2);
  assert.equal((await db.query("select count(*)::int n from advice_packets where kind='outcome'")).rows[0].n,2);
  assert.equal(R.hash((await db.query('select payload from advice_records')).rows[0].payload),R.hash(record));
 }finally{await db.close();}
});
test('database constraint prevents overlapping jobs for a case; abandoned leases retry with a new fencing token',async()=>{
 const db=await setup();try{await enrolled(db);const first=await call(db,'claim_advice_job',{});
  await assert.rejects(db.exec("update advice_jobs set status='running' where kind='lineup' and week=1"),/unique/);
  await db.query("update advice_jobs set lease_until=now()-interval '1 minute' where id=$1",[first.job.id]);
  const second=await call(db,'claim_advice_job',{});assert.equal(second.job.id,first.job.id);assert.notEqual(second.job.lease_token,first.job.lease_token);
  await assert.rejects(call(db,'finish_advice_job',{p_id:first.job.id,p_token:first.job.lease_token,p_error:'stale worker'}),/lease/);
 }finally{await db.close();}
});
