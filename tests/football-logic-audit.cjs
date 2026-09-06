'use strict';
const assert=require('node:assert/strict');
const {csv,ranks,corr,aggregate,score,engine,structural,redraft,dynastyProduction}=require('../scripts/audit-football-logic.cjs');
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
test('CSV preserves commas, escaped quotes and embedded newlines',()=>{
  assert.deepEqual(csv('id,name\n1,"Smith, John"\n2,"A ""B""\nC"\n'),[{id:'1',name:'Smith, John'},{id:'2',name:'A "B"\nC'}]);
  assert.throws(()=>csv('a,b\n1,2,3\n'));
});
test('Rank ties and correlations',()=>{assert.deepEqual(ranks([4,2,2,8]),[2,0.5,0.5,3]);assert.equal(corr([1,2,3],[3,2,1]),-1);assert.equal(corr([1,1],[2,3]),null);});
test('Scoring sums gains and negative events, missing future is zero',()=>{
  assert.equal(score({rec:5,rec_yd:70,rec_td:1,pass_int:1,fum_lost:1}),14);
  assert.equal(score(aggregate([])),0);
});
function fixture(){
  const data={};for(let y=2021;y<=2025;y++){
    const rows=Array.from({length:18},(_,i)=>({pid:'a',name:'Test',pos:'WR',team:'T',week:i+1,line:{rec:5,rec_yd:50}}));
    data[y]={players:{a:rows},schedule:{T:new Set(rows.map(r=>r.week))}};
  }return data;
}
test('Engine fixture produces constant production with expected horizon',()=>{
  const {records}=redraft(fixture(),engine());assert.equal(records.length,12);
  assert.equal(records[0].dhq,110);assert.equal(records[0].actual,110);
});
test('Future performance cannot alter predictions or cohort at earlier cutoff',()=>{
  const a=fixture(),b=fixture();
  for(const r of b[2023].players.a)if(r.week>6)r.line={rec:50,rec_yd:900};
  b[2023].players.future=[{pid:'future',name:'Future only',pos:'WR',team:'T',week:7,line:{rec:100,rec_yd:1000}}];
  const before=redraft(a,engine()).records.filter(r=>r.year===2023&&r.cutoff===6);
  const after=redraft(b,engine()).records.filter(r=>r.year===2023&&r.cutoff===6);
  assert.equal(after.length,before.length);assert.notEqual(after[0].actual,before[0].actual);
  for(const key of ['pid','dhq','prior','season','blended','noRecentForm','availabilityDiagnostic'])assert.equal(after[0][key],before[0][key]);
});
test('Disappearing players remain in redraft outcomes with zero production',()=>{
  const data=fixture();data[2023].players.a=data[2023].players.a.filter(r=>r.week<=6);
  const row=redraft(data,engine()).records.find(r=>r.year===2023&&r.cutoff===6);
  assert.equal(row.actual,0);assert(row.dhq>0);
});
test('Dynasty production diagnostic retains exits across multiple years',()=>{
  const data=fixture();data[2022].players={};data[2023].players={};data[2024].players={};
  const row=dynastyProduction(data,engine()).find(r=>r.origin===2021&&r.horizon===3);
  assert.equal(row.actual,0);assert.equal(row.prior,10);assert.equal(row.allSeasonsPresent,false);
});
test('Current known structural gaps reproduce in isolated production engine',()=>{
  const r=structural(engine());assert.equal(r.availability.points.healthy,r.availability.points.ir);assert.equal(r.availability.points.ir,r.availability.points.unsigned);
  assert.notEqual(r.calendar.august,r.calendar.september);assert.equal(r.unknownAge,5000);
});
console.log(`${count} audit integrity tests passed. Structural checks document known gaps, not desired scoring behavior.`);
