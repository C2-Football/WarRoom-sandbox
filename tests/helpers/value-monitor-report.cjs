'use strict';
const H=require('../../reconai-shared/value-history.js');
function reportFixture(){
 const times=Array.from({length:8},(_,i)=>new Date(Date.UTC(2026,9,20+i,12)).toISOString());
 const run={id:'20000000-0000-4000-8000-000000000001',league_id:'L',season:2026,value_type:'redraft',scope:{kind:'players'},player_ids:['p1','p3'],timezone:'America/Chicago',starts_at:times[0],ends_at:times[7],capture_times:times,status:'incomplete'};
 const captures=times.map((t,i)=>({run_id:run.id,capture_index:i,scheduled_at:t,status:i===3?'failed':i===4?'partial':'complete',captured_at:i===3?null:t,attempts:i===3?3:1,error:i===3?'Fixture: source fetch failed':null}));
 const rows=times.flatMap((ts,i)=>i===3?[]:run.player_ids.map((pid,j)=>({...H.normalize({leagueId:'L',playerId:pid,season:2026,week:i<5?8:9,value:j===0?1000+i*100:0,valueType:'redraft',source:'monitor',ts,calculatedAt:ts,captureKey:'monitor:'+run.id+':'+i,runId:run.id,captureIndex:i,status:i===4?'stale':'ok',rosterIds:[1],provenance:{engineVersion:i<6?'fixture-engine-1':'fixture-engine-2',settingsFingerprint:'fixture-settings',sourceFingerprint:'fixture-data-'+i,fixture:true}}),id:pid+'-'+i})));
 return {run,captures,rows,report:H.report(run,captures,rows,Date.parse('2026-10-28T12:00:00Z'))};
}
module.exports={reportFixture};
