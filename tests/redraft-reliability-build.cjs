'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),shared=path.resolve(process.env.SHARED_SOURCE||path.join(base,'../dhq-shared'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const [source,target] of [['sleeper-api.js','reconai-shared/sleeper-api.js'],['trade-engine.js','reconai-shared/trade-engine.js'],['player-value.js','js/utils/player-value.js'],['startsit-engine.js','js/shared/startsit-engine.js'],['weekly-proj.js','js/shared/weekly-proj.js'],['nfl-context.js','js/shared/nfl-context.js']])assert.equal(hash(path.join(shared,source)),hash(path.join(base,target)),source+' must exactly match canonical shared source');
const b={App:{},S:{currentLeagueId:'fixture',nflState:{season:'2026',week:8}},console,Date,Map,Set,fetch:async()=>({ok:false}),setTimeout,clearTimeout};b.window=b;b.globalThis=b;vm.createContext(b);
// Pages packaging copies reconai-shared unchanged, then overlays minified local JS.
for(const p of ['reconai-shared/sleeper-api.js','dist-deploy/js/shared/startsit-engine.js','dist-deploy/js/shared/weekly-proj.js'])vm.runInContext(fs.readFileSync(path.join(base,p),'utf8'),b,{filename:p});
const project=(line,scoring,position)=>b.App.WeeklyProj.projectPlayer('p',{playersData:{p:{position,team:'BUF'}},statsData:{},priorData:{},week:8,scoring,providerProjections:{p:line}}).points.median;
assert.equal(project({pass_att:30,pass_yd:250,pass_td:2,pass_cmp:20,pass_fd:10},{pass_yd:.04,pass_td:4,pass_cmp:.5,pass_fd:1},'QB'),38);
assert.equal(project({sack:2,int:2},{sack:1,int:2},'DEF'),6);
assert.equal(project({rec:4,rec_yd:100},{rec:1,rec_yd:.1,bonus_rec_te:.5,bonus_rec_yd_100:3},'TE'),19);
assert.equal(project({pass_att:30,pass_yd:250,pass_int_td:1},{pass_yd:.04,pass_int_td:-6,def_forced_punts:1,yds_allow_550p:-5},'QB'),4);
assert.equal(project({sack:1,yds_allow:550,def_forced_punts:8},{yds_allow_550p:-5,def_forced_punts:1},'DEF'),3);
for(const entry of ['index.html','draft-warroom.html','free-agency.html','trade-calculator.html','draft-war-room/index.html','reminder-unsubscribe.html']){
 const html=fs.readFileSync(path.join(base,'dist-deploy',entry),'utf8');assert(!html.includes('type="text/babel"'),entry+' contains no browser Babel scripts');
}
console.log('PASS all six production entrypoints compiled; canonical shared hashes match; minified WeeklyProj → StartSit → scorer returns QB38, D/ST6, TE19. Local artifact proof only.');
