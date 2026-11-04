'use strict';
const {engine,hash}=require('../../scripts/lib/advice-evaluation.cjs');
function fixture(kind='waiver') {
 const A=engine(),start=Date.parse('2026-09-03T20:00:00Z'),iso=n=>new Date(n).toISOString();
 const names={q:['QB',20],r:['RB',12],w:['WR',15],t:['TE',8],b:['WR',3],d:['RB',4],x:['TE',1],f:['RB',19],g:['WR',21]};
 const players=Object.fromEntries(Object.entries(names).map(([pid,[position]])=>[pid,{position,team:'KC',fantasy_positions:[position]}]));
 const projections=Object.fromEntries(Object.entries(names).map(([pid,[,projection]])=>[pid,{projection,status:'available',kickoff:iso(start),team:'KC'}]));
 const roster={roster_id:1,owner_id:'owner',players:['q','r','w','t','b','d','x'],settings:{waiver_budget_used:0}},other={roster_id:2,owner_id:'partner',players:kind==='trade'?['f','g']:[]};
 const weeks=Array.from({length:4},(_,i)=>({week:i+1,freezeAt:iso(start+i*7*864e5-2*36e5),firstKickoffAt:iso(start+i*7*864e5),endsAt:iso(start+i*7*864e5+5*864e5),teamKickoffs:{KC:iso(start+i*7*864e5)}}));
 const c={schemaVersion:1,decisionId:'fixture:case1',kind,season:2026,format:'redraft',cohort:'validation',policy:A.POLICY,capturedAt:'2026-09-01T10:00:00Z',deadline:'2026-09-02T10:00:00Z',effectiveAt:'2026-09-02T12:00:00Z',weeks,
  league:{league_id:'fixture-league',season:2026,roster_positions:['QB','RB','WR','TE','FLEX','BN','BN'],scoring_settings:{rec:1,rush_yd:0.1},settings:{type:0,waiver_budget:100},total_rosters:2},roster,rosters:[roster,other],players,eligiblePlayerIds:kind==='trade'?['f','g']:['f','g'],locks:Object.fromEntries(Object.keys(players).map(p=>[p,false])),budget:{minimum:1,remaining:100,assumedBid:3},initialWeek:{week:1,players:projections},scheduleSource:'synthetic fixture, not NFL data',versions:{current:'fixture-current',candidate:A.CANDIDATE},maxInputAgeSeconds:3600,
  sources:[{source:'synthetic fixture',observedAt:'2026-09-01T09:59:00Z'}],issued:{status:'ready',candidates:[{incoming:[{pid:'f'}],outgoing:[{pid:kind==='trade'?'d':'d'}],partner:kind==='trade'?{rosterId:2}:undefined,weekly:{delta:15},reason:'Fixture advice; not real recommendations'}]},explanationAudit:{status:'fixture',unsupportedClaims:[]}};
 function record(){return A.makeRecord(c,hash);}
 function packets(r=record()) {return weeks.map(w=>({week:w.week,lineupReceivedAt:iso(Date.parse(w.freezeAt)+1000),lineup:{...w,season:2026,policy:A.POLICY,configHash:r.configHash,observedAt:w.freezeAt,players:Object.fromEntries(Object.entries(projections).map(([pid,p])=>[pid,{...p,kickoff:w.firstKickoffAt}])),sources:[{source:'synthetic fixture',observedAt:w.freezeAt}]},outcome:{week:w.week,season:2026,configHash:r.configHash,scoringHash:hash(c.league.scoring_settings),observedAt:w.endsAt,contentVersion:'fixture-v1',players:Object.fromEntries(Object.entries({q:20,r:10,w:12,t:8,b:100,d:6,x:0,f:5,g:14}).map(([p,points])=>[p,{status:points===0?'zero':'final',points}]))}}));}
 return {A,c,record,packets,entry:r=>({record:r||record(),receivedAt:'2026-09-01T10:00:01Z'}),hash};
}
module.exports={fixture};
