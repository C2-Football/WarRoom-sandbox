'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createHost}=require('../../reconai-shared/value-monitor-runtime.cjs');
const {engineFiles}=require('../value-monitor/worker.cjs');
const {hash}=require('../advice/runtime.cjs');
function engine(){const {b}=createHost({state:{},files:engineFiles(),fetcher:()=>{throw Error('Evaluation never fetches fresh inputs');}});
 for(const file of ['js/shared/waiver-roster-read.js','server/generated/advice-scorecard.js'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8'),b);return b.App.AdviceScorecard;}
function packetsFor(rows){const weeks=new Map();for(const p of rows.slice().sort((a,b)=>Number(a.id)-Number(b.id))){if(!weeks.has(p.week))weeks.set(p.week,{week:p.week});const w=weeks.get(p.week);if(p.kind==='lineup'){w.lineup=p.payload;w.lineupReceivedAt=p.received_at;}if(p.kind==='outcome')w.outcome=p.payload;if(p.kind==='transactions')w.transactions=p.payload;}return [...weeks.values()];}
function report(data){const A=engine(),entries=data.records.map(r=>({record:r.payload,receivedAt:r.received_at}));const evaluations=entries.map(e=>{
 const packets=packetsFor(data.packets.filter(p=>p.decision_id===e.record.decisionId)),result=A.evaluate(e,packets,{hash});
 const observed=packets.map(p=>p.transactions).filter(Boolean);if(observed.length)result.feasibility={...result.feasibility,observations:observed,completedAcquisition:observed.some(o=>o.completedAcquisition),accepted:observed.some(o=>o.accepted===true)?true:'unknown',offerSent:observed.some(o=>o.offerSent==='observed')?'observed':'unknown'};return result;
 });
 return {...A.summarize(entries,evaluations,data.cases),evaluations,jobs:data.jobs||[],observations:data.observations||[],claim:'Conditional roster simulation; no causal win or calibrated acceptance claim.',probabilities:A.probabilityScore([],[])};}
module.exports={engine,packetsFor,report,hash};
