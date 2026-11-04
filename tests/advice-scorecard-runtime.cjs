'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../scripts/advice/runtime.cjs'),{fixture}=require('./helpers/value-monitor-inputs.cjs');
const {fixture:adviceFixture}=require('./helpers/advice-fixture.cjs');
const teams='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
function feed(){const f=fixture();f.rosters[0].owner_id='owner';f.rosters[1].owner_id='partner';f.rosters[0].settings.waiver_budget_used=0;f.league.settings.waiver_budget=100;Object.values(f.players).forEach(p=>p.depth_chart_order=1);
 const kickoff=new Date(Date.now()+3*864e5).toISOString(),scheduled=teams.filter(t=>!['PIT','TEN'].includes(t)),events=[];
 for(let i=0;i<scheduled.length;i+=2)events.push({id:String(i),date:kickoff,status:{type:{state:'pre',completed:false}},competitions:[{competitors:scheduled.slice(i,i+2).map(team=>({team:{abbreviation:team}}))}]});
 const schedule={season:{year:2026},week:{number:9},events},fetcher=async url=>String(url).includes('espn')?new Response(JSON.stringify(schedule)):f.fetcher(url);
 return {...f,fetcher,schedule,plan:{week:9,firstKickoffAt:kickoff,freezeAt:new Date(Date.parse(kickoff)-2*36e5).toISOString(),endsAt:new Date(Date.parse(kickoff)+5*864e5).toISOString(),teamKickoffs:Object.fromEntries(teams.map(t=>[t,['PIT','TEN'].includes(t)?null:kickoff]))}};
}
test('headless capture executes actual valuation, projection and waiver/trade lens calculations on the same frozen context',async()=>{
 for(const kind of ['waiver','trade']){const f=feed(),config={leagueId:'L',rosterId:1,ownerKey:'account:fixture',season:2026,endWeek:9,weeks:[f.plan],cohort:'validation',engineHash:R.engineHash()};
  const record=await R.capture({run:{config},case:{decision_id:'fixture-'+kind,spec:{kind,firstWeek:9,deadline:new Date(Date.now()+864e5).toISOString(),effectiveAt:new Date(Date.now()+2*864e5).toISOString()}}},{fetcher:f.fetcher});
  assert(['ready','empty'].includes(record.context.issued.status),record.context.issued.reason);assert(record.context.calculations.projectionsByPid.p0);assert(record.context.sources.length>4);assert.equal(record.engineInputs.current,record.engineInputs.candidate);assert.equal(record.choices.current.kind,record.context.issued.candidates.length?kind:'hold');
  if(record.context.issued.candidates.length)assert.equal(record.choices.current.incoming[0],record.context.issued.candidates[0].incoming[0].pid);
  assert(record.context.calculations.rosState||Object.keys(record.context.calculations.valuesByPid).length,'Real calculation evidence retained');
 }
});
test('raw stats are scored with captured custom rules; absent player rows stay missing and zero stays zero',async()=>{
 const f=adviceFixture(),r=f.record(),entry=f.entry(r),plan={...f.c.weeks[0],week:9},source=feed();r.context.season=2026;r.context.players.f.position='TE';r.context.league.scoring_settings={rec:1,bonus_rec_te:1,rush_yd:.1};
 source.schedule.events.forEach(e=>e.status.type={state:'post',completed:true});
 const fetcher=async url=>String(url).includes('/stats/')?new Response(JSON.stringify({f:{gp:1,rec:3,rush_yd:10},g:{gp:1,rec:0,rush_yd:0}})):source.fetcher(url);
 const out=await R.outcomes(entry,plan,{players:{f:{team:'BUF'},g:{team:'BUF'},missing:{team:'BUF'}}},{fetcher});assert.equal(out.players.f.points,7);assert.equal(out.players.g.status,'zero');assert.equal(out.players.g.points,0);assert.equal(out.players.missing.status,'missing');assert.equal(out.players.missing.points,null);
});
test('schedule metadata failures and changed kickoffs reject capture rather than inventing deadlines',async()=>{
 await assert.rejects(R.schedule(2026,9,async()=>new Response(JSON.stringify({events:[]}))),/coverage/);const f=feed(),actual=await R.schedule(2026,9,f.fetcher);assert.throws(()=>R.verifySchedule({...f.plan,firstKickoffAt:'2026-01-01'},actual,require('../js/utils/nfl-byes.js'),2026),/changed/);
});
test('browser save really awaits RPC and readback; failures remain owner-bound in the outbox',async()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},calls=[],rows=[];let fail=true,account='account:one';
 const b={App:{AdviceScorecard:R.A},crypto:require('node:crypto').webcrypto,TextEncoder,Date,console};b.window=b;vm.createContext(b);vm.runInContext(fs.readFileSync('js/shared/advice-capture.js','utf8'),b);
 const db={rpc:async(name,arg)=>{calls.push(name);if(name==='observe_advice'){if(fail)return {error:{message:'fixture unavailable'}};rows.push({observation_id:arg.p_record.id,payload:arg.p_record});return {data:{id:arg.p_record.id,receivedAt:new Date().toISOString()}};}return {data:rows};}};
 const c=b.App.AdviceCapture.createClient({client:()=>db,token:()=>account,principal:()=>account,storage:()=>storage});
 await assert.rejects(c.save({kind:'waiver',leagueId:'L',issued:{status:'empty'}}),/unavailable/);assert.equal(JSON.parse(store.get('dhq-advice-outbox-v1:account:one')).length,1);
 account='account:two';fail=false;await c.flush();assert.equal(rows.length,0,'Another account never uploads the first account outbox');account='account:one';await c.flush();assert.equal(rows.length,1);assert(calls.includes('read_advice_data'));assert.equal(JSON.parse(store.get('dhq-advice-outbox-v1:account:one')).length,0);
});
test('unsent hypothetical trades remain acceptance-unknown; an observed completed transaction is separate',async()=>{
 const f=adviceFixture('trade'),r=f.record();let o=await R.transactions(f.entry(r),1,{fetcher:async()=>new Response('[]')});assert.equal(o.accepted,'unknown');assert.equal(o.completedAcquisition,false);
 o=await R.transactions(f.entry(r),1,{fetcher:async()=>new Response(JSON.stringify([{transaction_id:'fixture',created:Date.parse(f.c.capturedAt)+1000,type:'trade',status:'complete',adds:{f:1,d:2},drops:{d:1,f:2}}]))});assert.equal(o.accepted,true);assert.equal(o.completedAcquisition,true);assert.equal(o.causalWins,null);
});
test('cross-table report reads abort on an account change instead of mixing private evidence',async()=>{
 const b={App:{AdviceScorecard:R.A},crypto:require('node:crypto').webcrypto,TextEncoder,Date,console};b.window=b;vm.createContext(b);vm.runInContext(fs.readFileSync('js/shared/advice-capture.js','utf8'),b);
 let account='account:one';const client=b.App.AdviceCapture.createClient({principal:()=>account,token:()=>account,client:()=>({rpc:async()=>{account='account:two';return {data:[]};}})});
 await assert.rejects(client.read('L'),/Account changed/);
});
