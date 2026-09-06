#!/usr/bin/env node
'use strict';
// Diagnostic replay of CURRENT production functions, not historical DHQ scores.
// Run: node scripts/audit-football-logic.cjs [--offline]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/football-audit');
const POS = ['QB', 'RB', 'WR', 'TE'];
const CAP = { QB: 24, RB: 60, WR: 60, TE: 24 };
const SC = { pass_yd: .04, pass_td: 4, pass_int: -2, rush_yd: .1, rush_td: 6, rec_yd: .1, rec_td: 6, rec: 1, fum_lost: -2, pass_2pt: 2, rush_2pt: 2, rec_2pt: 2 };
const pprArg=process.argv.find(x=>x.startsWith('--ppr='));
if(pprArg){SC.rec=Number(pprArg.split('=')[1]);assert([0,.5,1].includes(SC.rec),'PPR must be 0, 0.5 or 1');}
const suffix=pprArg?`-ppr-${SC.rec}`:'';
const FIELDS = { pass_yd: 'passing_yards', pass_td: 'passing_tds', pass_int: 'passing_interceptions', pass_att: 'attempts', pass_cmp: 'completions', rush_yd: 'rushing_yards', rush_td: 'rushing_tds', rush_att: 'carries', rec: 'receptions', rec_yd: 'receiving_yards', rec_td: 'receiving_tds', rec_tgt: 'targets', pass_2pt: 'passing_2pt_conversions', rush_2pt: 'rushing_2pt_conversions', rec_2pt: 'receiving_2pt_conversions' };
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const score = (line, sc = SC) => Object.entries(sc).reduce((s, [k,v]) => s + (Number(line?.[k]) || 0) * v, 0);
const mean = a => a.length ? a.reduce((s,v) => s+v,0)/a.length : null;
const round = x => x == null ? null : +x.toFixed(3);

function csv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
    else if(!quoted && (c===',' || c==='\n')) {row.push(cell.replace(/\r$/, ''));cell='';if(c==='\n'){rows.push(row);row=[];}}
    else cell+=c;
  }
  if(quoted) throw Error('Unterminated CSV quote');
  if(cell || row.length) {row.push(cell.replace(/\r$/, ''));rows.push(row);}
  const header=rows.shift();
  return rows.filter(r=>r.length>1).map(r=>{assert.equal(r.length,header.length);return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});
}
function ranks(xs) {
  const sorted=xs.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v); const r=[];
  for(let i=0;i<sorted.length;) {let j=i+1;while(j<sorted.length && sorted[j].v===sorted[i].v)j++;for(let k=i;k<j;k++)r[sorted[k].i]=(i+j-1)/2;i=j;}
  return r;
}
function corr(x,y) {const mx=mean(x),my=mean(y);let n=0,a=0,b=0;for(let i=0;i<x.length;i++){n+=(x[i]-mx)*(y[i]-my);a+=(x[i]-mx)**2;b+=(y[i]-my)**2;}return a*b ? n/Math.sqrt(a*b):null;}
function metrics(rows, key) {
  return { n:rows.length, mae:round(mean(rows.map(r=>Math.abs(r[key]-r.actual)))), bias:round(mean(rows.map(r=>r[key]-r.actual))), rmse:round(Math.sqrt(mean(rows.map(r=>(r[key]-r.actual)**2)))) };
}
function grouped(rows, field, keys) {
  return Object.fromEntries([...new Set(rows.map(r=>r[field]))].map(v=>[v,Object.fromEntries(keys.map(k=>[k,metrics(rows.filter(r=>r[field]===v),k)]))]));
}
function aggregate(rows) {
  if(!rows.length)return null;
  const out={gp:rows.length};
  for(const r of rows)for(const k of [...Object.keys(FIELDS),'fum_lost'])out[k]=(out[k]||0)+r.line[k];
  return out;
}
function select(rows, strength) {
  return POS.flatMap(pos=>rows.filter(r=>r.pos===pos).sort((a,b)=>strength(b)-strength(a)||a.pid.localeCompare(b.pid)).slice(0,CAP[pos]));
}
function engine() {
  const sandbox={console:{log(){},warn(){}},fetch:()=>Promise.resolve({ok:false}),setTimeout(){},clearTimeout(){},Date,App:{},S:{}};
  sandbox.window=sandbox; sandbox.globalThis=sandbox;
  sandbox.calcFantasyPts=score;
  vm.createContext(sandbox);
  for(const file of ['js/shared/startsit-engine.js','js/shared/weekly-proj.js','js/utils/player-value.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),sandbox,{filename:file});
  sandbox.App.calcPPG=(s,sc)=>s?.gp ? score(s,sc)/s.gp:0;
  sandbox.App.normPos=p=>p;
  // Extract the exact pure production functions, without starting the networked engine.
  const source=fs.readFileSync(path.join(ROOT,'reconai-shared/dhq-engine.js'),'utf8');
  const reliability=source.slice(source.indexOf('function _dhqPpgReliability('),source.indexOf('function _dhqStarterCountsFromRoster('));
  const production=source.slice(source.indexOf('function _dhqComputeProductionPPG('),source.indexOf('// Depth-chart role'));
  assert(reliability.includes('function _dhqPpgReliability') && production.includes('return{'));
  vm.runInContext('const DHQ_CORE=null;\n'+reliability+'\n'+production,sandbox);
  return sandbox;
}
async function load(year,manifest) {
  const url=`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`;
  const file=path.join(OUT,`stats_player_week_${year}.csv`);
  if(!fs.existsSync(file)) {
    if(process.argv.includes('--offline'))throw Error(`Missing cached ${file}`);
    const response=await fetch(url);if(!response.ok)throw Error(`${url}: ${response.status}`);
    fs.writeFileSync(file,await response.text());
  }
  const raw=fs.readFileSync(file,'utf8'); const all=csv(raw);
  assert(all.length>1000,`Incomplete ${year}`);
  assert(all.every(r=>Number(r.season)===year));
  manifest.push({year,url,sha256:hash(raw),rows:all.length});
  const regular=all.filter(r=>r.season_type==='REG');
  assert.equal(Math.max(...regular.map(r=>Number(r.week))),18,`Incomplete season ${year}`);
  const schedule={};
  for(const r of regular) {const team=r.team||r.recent_team;(schedule[team]??=new Set()).add(Number(r.week));}
  const players={}; const seen=new Set();
  for(const r of regular.filter(r=>POS.includes(r.position))) {
    const key=r.player_id+'|'+r.week;assert(!seen.has(key),`Duplicate ${key}`);seen.add(key);
    const line=Object.fromEntries(Object.entries(FIELDS).map(([a,b])=>[a,Number(r[b])||0]));
    line.fum_lost=['sack_fumbles_lost','rushing_fumbles_lost','receiving_fumbles_lost'].reduce((s,k)=>s+(Number(r[k])||0),0);
    (players[r.player_id]??=[]).push({pid:r.player_id,name:r.player_display_name,pos:r.position,team:r.team||r.recent_team,week:Number(r.week),line});
  }
  for(const rows of Object.values(players)) rows.sort((a,b)=>a.week-b.week);
  return {players,schedule};
}
function redraft(data,e) {
  const records=[];const boards=[];
  for(const year of [2022,2023,2024,2025])for(const cutoff of [6,10,14]) {
    const prior=data[year-1].players, current=data[year].players;
    const ids=new Set([...Object.keys(prior),...Object.keys(current).filter(id=>current[id].some(r=>r.week<=cutoff))]);
    const pool=[];const statsData={},priorData={},playersData={},universe={};
    e.S={weeklyPlayerPoints:{}};
    for(const pid of ids) {
      const before=(current[pid]||[]).filter(r=>r.week<=cutoff);
      assert(before.every(r=>r.week<=cutoff));
      const old=prior[pid]||[];const stat=aggregate(before),prev=aggregate(old);
      const last=before.at(-1)||old.at(-1); if(!last)continue;
      if(stat)statsData[pid]=stat;if(prev)priorData[pid]=prev;
      // Team membership is from observed PRE-CUTOFF stats, never future rows.
      const teamWeeks=data[year].schedule[last.team];
      const bye=teamWeeks ? Array.from({length:18},(_,i)=>i+1).find(w=>!teamWeeks.has(w)):0;
      playersData[pid]={position:last.pos,team:last.team,bye_week:bye||0};universe[pid]=1;
      for(const r of before)(e.S.weeklyPlayerPoints[r.week]??={})[pid]=score(r.line);
      const pp=prev ? score(prev)/prev.gp:0, cp=stat ? score(stat)/stat.gp:0;
      if((old.length>=4||before.length>=2) && Math.max(pp,cp)>0)pool.push({pid,name:last.name,pos:last.pos,pp,cp,before:before.length,old:old.length,team:last.team,strength:Math.max(pp*Math.min(old.length/8,1),cp*Math.min(before.length/4,1))});
    }
    const ctx={leagueId:'audit',league:{total_rosters:12,settings:{playoff_week_start:15}},week:cutoff,playersData,statsData,priorData,projectionsData:{},playerScores:universe,scoring:SC,perTeamSlots:e.App.PlayerValue.slotsFromRoster(['QB','RB','RB','WR','WR','TE','FLEX'])};
    const result=e.App.PlayerValue.computePrices(ctx);
    const calcPPG=e.App.calcPPG;
    e.App.calcPPG=undefined;
    const withoutForm=e.App.PlayerValue.computePrices(ctx);
    e.App.calcPPG=calcPPG;
    assert(result && result.remainingWeeks===17-cutoff);
    const selected=select(pool,r=>r.strength);
    for(const r of selected) {
      const future=(current[r.pid]||[]).filter(x=>x.week>cutoff&&x.week<=17);
      const bye=playersData[r.pid].bye_week;
      const games=17-cutoff-(bye>cutoff&&bye<=17?1:0);
      const playedBefore=[...(data[year].schedule[r.team]||[])].filter(w=>w<=cutoff).length;
      const dhq=result.points[r.pid]||0;
      records.push({year,cutoff,pid:r.pid,name:r.name,pos:r.pos,cohort:r.old?'veteran':'no_prior_stat_rows',presence:r.before?'observed_this_season':'no_current_stat_rows',actual:score(aggregate(future)),dhq,noRecentForm:withoutForm.points[r.pid]||0,prior:r.pp*games,season:r.cp*games,blended:((r.old&&r.before)?(r.pp+r.cp)/2:(r.pp||r.cp))*games,availabilityDiagnostic:dhq*Math.min(1,r.before/Math.max(1,playedBefore)),futureStatGames:future.length});
    }
    for(const pos of POS) {
      const rows=records.filter(r=>r.year===year&&r.cutoff===cutoff&&r.pos===pos);
      boards.push({year,cutoff,pos,n:rows.length,...Object.fromEntries(['dhq','prior','season','blended','noRecentForm'].map(k=>[k,round(corr(ranks(rows.map(r=>r[k])),ranks(rows.map(r=>r.actual))))]))});
    }
  }
  return {records,boards};
}
function dynastyProduction(data,e) {
  const out=[];
  for(const origin of [2021,2022,2023,2024]) {
    const pool=Object.entries(data[origin].players).map(([pid,rows])=>({pid,rows,pos:rows.at(-1).pos,name:rows.at(-1).name,stat:aggregate(rows)})).filter(r=>r.stat.gp>=4&&score(r.stat)>0);
    const selected=select(pool,r=>score(r.stat));
    for(const r of selected) {
      const history={};
      for(let year=2021;year<=origin;year++){const st=aggregate(data[year].players[r.pid]||[]);if(st)history[year]={gp:st.gp,total:score(st),avg:score(st)/st.gp};}
      const production=e._dhqComputeProductionPPG(history).ppg;
      for(const horizon of [1,2,3]) {
        if(origin+horizon>2025)continue;
        const later=Array.from({length:horizon},(_,i)=>aggregate(data[origin+i+1].players[r.pid]||[]));
        out.push({origin,horizon,pid:r.pid,name:r.name,pos:r.pos,dhqProduction:production,prior:score(r.stat)/r.stat.gp,actual:mean(later.map(s=>s?.gp?score(s)/s.gp:0)),allSeasonsPresent:later.every(Boolean)});
      }
    }
  }
  return out;
}
function structural(e) {
  const p=e.App.PlayerValue, line={gp:17,rec:85,rec_yd:1105,rec_td:8,rec_tgt:120};
  const ctx={week:1,league:{settings:{playoff_week_start:15}},scoring:SC,playersData:{healthy:{position:'WR',team:'IND'},ir:{position:'WR',team:'IND',injury_status:'IR'},unsigned:{position:'WR',team:null}},projectionsData:{healthy:line,ir:line,unsigned:line},playerScores:{healthy:5000,ir:5000,unsigned:5000},perTeamSlots:{WR:3}};
  const availability=p.computePrices(ctx);
  e.Date=class extends Date {getMonth(){return 7;}};const august=p.projectPlayerValue('x',5000,21,'WR',3);
  e.Date=class extends Date {getMonth(){return 8;}};const september=p.projectPlayerValue('x',5000,21,'WR',3);
  e.Date=Date;
  return {availability:{points:availability.points,values:availability.values},calendar:{august,september},unknownAge:p.projectPlayerValue('x',5000,0,'WR',3)};
}
async function main() {
  fs.mkdirSync(OUT,{recursive:true});
  const manifest=[], data={};
  await Promise.all([2021,2022,2023,2024,2025].map(async y=>{data[y]=await load(y,manifest);}));
  const e=engine(),red=redraft(data,e),dyn=dynastyProduction(data,e);
  const keys=['dhq','prior','season','blended','noRecentForm','availabilityDiagnostic'];
  const summary={generatedAt:new Date().toISOString(),scope:'Current production components replayed on historical stats; NOT full DHQ, archived forecasts, provider projections, market price accuracy, or fitted out-of-sample validation.',scoring:SC,inputs:manifest.sort((a,b)=>a.year-b.year),codeHashes:Object.fromEntries(['js/utils/player-value.js','js/shared/weekly-proj.js','js/shared/startsit-engine.js','reconai-shared/dhq-engine.js', 'scripts/audit-football-logic.cjs'].map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f)))])),redraft:{overall:Object.fromEntries(keys.map(k=>[k,metrics(red.records,k)])),byYear:grouped(red.records,'year',keys),byPosition:grouped(red.records,'pos',keys),byCutoff:grouped(red.records,'cutoff',keys),byCohort:grouped(red.records,'cohort',keys),withinPositionRank: Object.fromEntries(keys.filter(k=>k!=='availabilityDiagnostic').map(k=>[k,round(mean(red.boards.map(b=>b[k]).filter(v=>v!=null)))])),largestDhqMisses:red.records.slice().sort((a,b)=>Math.abs(b.dhq-b.actual)-Math.abs(a.dhq-a.actual)).slice(0,20)},dynastyProduction:{byHorizon:grouped(dyn,'horizon',['dhqProduction','prior']),survivors:grouped(dyn.filter(r=>r.allSeasonsPresent),'horizon',['dhqProduction','prior']),byPosition:grouped(dyn,'pos',['dhqProduction','prior'])},structural:structural(e)};
  summary.redraft.byPresence=grouped(red.records,'presence',keys);
  fs.writeFileSync(path.join(OUT,`results${suffix}.json`),JSON.stringify(summary,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,`redraft-records${suffix}.json`),JSON.stringify(red.records,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,`dynasty-production-records${suffix}.json`),JSON.stringify(dyn,null,2)+'\n');
  fs.writeFileSync(path.join(OUT,`rank-boards${suffix}.json`),JSON.stringify(red.boards,null,2)+'\n');
  console.log(JSON.stringify({redraft:summary.redraft.overall,rank:summary.redraft.withinPositionRank,dynastyProduction:summary.dynastyProduction.byHorizon,structural:summary.structural},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={csv,ranks,corr,aggregate,score,engine,structural,redraft,dynastyProduction};
