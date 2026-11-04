'use strict';
const R=require('./runtime.cjs'),{engine,packetsFor,report}=require('../lib/advice-evaluation.cjs');
async function checked(query){const {data,error}=await query;if(error)throw Error(error.message);return data;}
async function all(db,table,field,value){let rows=[];for(let offset=0;;offset+=100){const page=await checked(db.from(table).select('*').eq(field,value).order(table==='advice_packets'?'id':table==='advice_jobs'?'id':'decision_id').range(offset,offset+99));rows.push(...page);if(page.length<100)return rows;}}
async function collect(db,{maxJobs=12,...options}={}) {
 const results=[],A=engine();for(let i=0;i<maxJobs;i++) {
  const task=await checked(db.rpc('claim_advice_job'));if(!task)break;
  const {job,run}=task;
  try{
   if(run.config.engineHash!==R.engineHash())throw Error('Pinned runtime differs; no silent engine replacement');
   let payload;
   if(job.kind==='capture'){
    // Recovery after an uncertain response reuses the original bytes, never
    // recalculates a different recommendation for the same decision ID.
    const prior=await all(db,'advice_records','decision_id',job.decision_id);
    payload=prior[0]?.payload||await R.capture(task,options);
   }
   else {
    const saved=(await all(db,'advice_records','decision_id',job.decision_id))[0];if(!saved)throw Error('Recommendation readback missing');
    const entry={record:saved.payload,receivedAt:saved.received_at},plan=entry.record.context.weeks.find(w=>w.week===job.week);
    if(!plan)throw Error('Unregistered scoring week');
    if(job.kind==='lineup')payload={packets:[{kind:'lineup',week:job.week,payload:await R.freezeWeek(entry,plan,run.config,options)}]};
    else {
     const rows=await all(db,'advice_packets','decision_id',job.decision_id),packets=packetsFor(rows),week=packets.find(p=>p.week===job.week);
     if(!week?.lineup)throw Error('Missing pre-kickoff lineup interval; cannot reconstruct it after games');
     let outcome=await R.outcomes(entry,plan,week.lineup,options);
     if(week.outcome?.contentVersion===outcome.contentVersion)outcome=week.outcome;
     let observed=await R.transactions(entry,job.week,options);
     if(week.transactions&&R.hash({...observed,observedAt:null})===R.hash({...week.transactions,observedAt:null}))observed=week.transactions;
     week.outcome=outcome;const grade=A.evaluate(entry,packets,{hash:R.hash,now:new Date().toISOString()});
     payload={packets:[{kind:'outcome',week:job.week,payload:outcome},{kind:'transactions',week:job.week,payload:observed},{kind:'grade',week:job.week,payload:{evaluatorVersion:A.VERSION,inputHash:entry.record.inputHash,outcomeVersions:packets.map(p=>[p.week,p.outcome?.contentVersion||null]),grade}}]};
    }
   }
   const receipt=await checked(db.rpc('finish_advice_job',{p_id:job.id,p_token:job.lease_token,p_payload:payload}));
   // Await the transport and independently READ the persisted bytes. A builder is not a save.
   const rows=await all(db,job.kind==='capture'?'advice_records':'advice_packets','decision_id',job.decision_id);
   if(job.kind==='capture'?R.hash(rows[0]?.payload)!==R.hash(payload):!payload.packets.every(p=>rows.some(r=>r.week===p.week&&r.kind===p.kind&&R.hash(r.payload)===R.hash(p.payload))))throw Error('Persisted advice readback failed');
   results.push({decisionId:job.decision_id,kind:job.kind,week:job.week,...receipt,readbackVerified:true});
  }catch(e){let failureRecorded=true;try{await checked(db.rpc('finish_advice_job',{p_id:job.id,p_token:job.lease_token,p_error:e.message}));}catch(_){try{await checked(db.rpc('note_advice_readback_failure',{p_id:job.id,p_error:e.message}));}catch(_){failureRecorded=false;}}
   results.push({decisionId:job.decision_id,kind:job.kind,error:e.message,failureRecorded});}
 }return results;
}
async function prepare(seed,{fetcher=fetch}={}){
 const byes=require('../../js/utils/nfl-byes.js'),teams='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '),weeks=[];
 const first=Math.min(...seed.cases.map(c=>c.firstWeek));
 for(let week=first;week<=seed.endWeek;week++){
  const actual=await R.schedule(seed.season,week,fetcher),teamKickoffs={};
  for(const team of teams){if(actual.teams[team])teamKickoffs[team]=actual.teams[team].kickoff;else if(byes.weekForPlayer({team},seed.season)===week)teamKickoffs[team]=null;else throw Error('No complete schedule/bye evidence for '+team+' week '+week);}
  weeks.push({week,firstKickoffAt:actual.firstKickoffAt,freezeAt:new Date(Date.parse(actual.firstKickoffAt)-2*3600000).toISOString(),endsAt:new Date(Math.max(...Object.values(actual.teams).map(t=>Date.parse(t.kickoff)))+8*3600000).toISOString(),teamKickoffs,source:actual.source});
 }
 return {...seed,policy:R.A.POLICY,engineHash:R.engineHash(),maxInputAgeSeconds:seed.maxInputAgeSeconds||3600,weeks};
}
async function validateEnrollment(config,{fetcher=fetch}={}) {
 if(config.engineHash!==R.engineHash())throw Error('Use the local immutable engine fingerprint');
 if(config.policy!==R.A.POLICY||config.platform!=='sleeper'||!['redraft','dynasty'].includes(config.format)||!['tuning','validation'].includes(config.cohort))throw Error('Unsupported platform, format, cohort or policy');
 if(config.cohort==='validation'&&(!config.tuningEndsAt||Date.parse(config.validationStartsAt)<=Date.parse(config.tuningEndsAt)))throw Error('Validation must begin strictly after the frozen tuning cutoff');
 if(!Array.isArray(config.weeks)||!config.weeks.length||!Array.isArray(config.cases)||!config.cases.length)throw Error('Explicit cases and scoring calendar required');
 const league=await(await fetcher('https://api.sleeper.app/v1/league/'+config.leagueId)).json();
 if(Number(league.season)!==Number(config.season)||({0:'redraft',2:'dynasty'})[league.settings?.type]!==config.format)throw Error('Enrollment season/format mismatch');
 const rosterRows=await(await fetcher('https://api.sleeper.app/v1/league/'+config.leagueId+'/rosters')).json();
 if(!rosterRows.some(r=>String(r.roster_id)===String(config.rosterId)))throw Error('Registered roster unavailable');
 const byes=require('../../js/utils/nfl-byes.js');
 for(const [i,w]of config.weeks.entries()){
  if(i&&w.week!==config.weeks[i-1].week+1||Date.parse(w.freezeAt)>=Date.parse(w.firstKickoffAt)||Date.parse(w.endsAt)<=Date.parse(w.firstKickoffAt))throw Error('Invalid continuous evaluation calendar');
  R.verifySchedule(w,await R.schedule(config.season,w.week,fetcher),byes,config.season);
 }
 if(config.weeks.at(-1).week!==config.endWeek)throw Error('Calendar must cover the declared fantasy season end');
 for(const s of config.cases){const w=config.weeks.find(w=>w.week===s.firstWeek);
  if(!w||!['waiver','trade'].includes(s.kind)||!(Date.parse(s.captureAt)>Date.now())||!(Date.parse(s.deadline)>Date.parse(s.captureAt))||Date.parse(s.deadline)>Date.parse(w.freezeAt)||!(Date.parse(s.effectiveAt)<=Date.parse(w.freezeAt))||!Number.isFinite(Date.parse(s.effectiveAt)))throw Error('Register future capture, deadline and effective times before the first eligible weekly freeze');
  if(config.cohort==='validation'&&Date.parse(s.captureAt)<Date.parse(config.validationStartsAt)||config.cohort==='tuning'&&(!config.tuningEndsAt||Date.parse(s.captureAt)>Date.parse(config.tuningEndsAt)))throw Error('Case violates tuning/validation split');
 }
 return config;
}
async function readReport(db,runId){const run=await checked(db.from('advice_runs').select('*').eq('id',runId).single()),cases=await all(db,'advice_cases','run_id',runId);const data={run,cases,records:[],packets:[],jobs:[]};for(const c of cases){for(const [key,table]of [['records','advice_records'],['packets','advice_packets'],['jobs','advice_jobs']])data[key].push(...await all(db,table,'decision_id',c.decision_id));}return {data,report:report(data)};}
module.exports={checked,all,collect,prepare,validateEnrollment,readReport};
