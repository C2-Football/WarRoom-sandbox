#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run,parseArticle,atomicJson}=require('./cbs/importer.cjs');
async function main(){
 const args=process.argv.slice(2),opt=k=>{const i=args.indexOf('--'+k);return i>=0?args[i+1]:null;};
 const permissionReference=process.env.CBS_PERMISSION_REFERENCE||null,manual=opt('import');
 const dir=path.resolve(opt('out')||'content/markets/cbs');
 // A blocked scheduler does not even fetch the player catalog or NFL state.
 if(!manual&&!permissionReference)return run({dir,season:0,week:0,players:{}});
 const json=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Provider HTTP '+r.status);return r.json();};
 const state=opt('state')?JSON.parse(fs.readFileSync(opt('state'),'utf8')):await json('https://api.sleeper.app/v1/state/nfl');
 const season=Number(state.season),week=Number(state.week); // never display_week
 if(!manual&&state.season_type!=='regular'){atomicJson(path.join(dir,'status.json'),{checkedAt:new Date().toISOString(),status:'offseason',reason:'No regular-season chart check needed.'});console.log('Outside NFL regular season; no chart import.');return;}
 if(!Number.isInteger(season)||!Number.isInteger(week)||week<1||week>18)throw Error('No current NFL regular-season week.');
 const players=opt('players')?JSON.parse(fs.readFileSync(opt('players'),'utf8')):await json('https://api.sleeper.app/v1/players/nfl');
 let chart=null;if(manual){const raw=fs.readFileSync(manual,'utf8');chart=manual.endsWith('.json')?JSON.parse(raw):parseArticle(raw,opt('url'));}
 const aliases=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/markets/cbs/aliases.json'),'utf8'));
 const result=await run({dir,season,week,players,chart,aliases,permissionReference,approveChange:opt('approve-change')});
 console.log(JSON.stringify({changed:result.changed,version:result.snapshot.id,season,week:result.snapshot.chart.week,sourceUrl:result.snapshot.chart.sourceUrl}));
}
main().catch(e=>{const i=process.argv.indexOf('--out'),dir=path.resolve(i>=0?process.argv[i+1]:'content/markets/cbs');atomicJson(path.join(dir,'status.json'),{checkedAt:new Date().toISOString(),status:'blocked',reason:e.message});console.error(e.message);process.exitCode=1;});
