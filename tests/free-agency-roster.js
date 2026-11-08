#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/shared/waiver-roster-read.js','utf8');
const window={App:{NFLByes:{weekForPlayer:p=>p.bye}},_playerTags:{}};
const ctx=vm.createContext({window});
vm.runInContext(src,ctx);
ctx.buildFaRosterRead=window.App.buildFaRosterRead;
const players={q1:{position:'QB',full_name:'Mahomes',team:'KC',depth_chart_order:1},q2:{position:'QB',full_name:'Stafford',team:'LA',depth_chart_order:1},backupUpgrade:{position:'QB',full_name:'Better backup',team:'XX',depth_chart_order:1},starterUpgrade:{position:'QB',full_name:'Better starter',team:'YY',depth_chart_order:1}};
const values={q1:5000,q2:3000,backupUpgrade:4000,starterUpgrade:6000};
const projection={q1:22,q2:18,backupUpgrade:20,starterUpgrade:25};
const league={settings:{type:0},roster_positions:['QB','BN']};
const roster={players:['q1','q2']};
const read=(r=roster, l=league, opts={})=>ctx.buildFaRosterRead({...r,roster_id:1},{total_rosters:1,scoring_settings:{pass_yd:.04},...l,rosters:[{...r,roster_id:1}]},players,pid=>values[pid],{week:3,project:pid=>projection[pid],...opts});
let r=read();
assert.equal(r.coverage,1);
assert.equal(r.fit('QB',4000,{pid:'backupUpgrade'}).score,0,'beating the backup is not a starting lineup upgrade');
let fit=r.fit('QB',6000,{pid:'starterUpgrade'});
assert.equal(fit.weeklyGain,3);
assert.equal(fit.dropPid,'q2','equal starter gains preserve the stronger reserve');
assert.equal(fit.seasonGain,1000);
window._playerTags.q2='untouchable';
assert.equal(read().fit('QB',6000,{pid:'starterUpgrade'}).dropPid,'q1');
assert.equal(read(roster,league,{protectedPids:['q1','q2']}).fit('QB',6000,{pid:'starterUpgrade'}).score,0);
window._playerTags={};
players.q1.injury_status='Out';players.q2.bye=3;
r=read();assert.equal(r.coverage,0,'injury and bye do not cover the starting slot');
fit=r.fit('QB',4000,{pid:'backupUpgrade'});assert.equal(fit.weeklyGain,20);assert.equal(fit.dropPid,'q2','injured star is not the automatic drop');
delete players.q1.injury_status;delete players.q2.bye;
assert.equal(read({players:['q1','q2'],reserve:['q1'],taxi:['q2']}).coverage,0,'reserve and taxi do not fill active slots');
projection.q1=null;
fit=read().fit('QB',6000,{pid:'starterUpgrade'});assert.equal(fit.weeklyGain,null,'missing projection is not zero');assert.equal(fit.seasonGain,1000);
values.q1=null;assert.equal(read().fit('QB',6000,{pid:'starterUpgrade'}).score,0,'incomplete comparison has no invented improvement');
values.q1=5000;projection.q1=22;
assert.equal(read({players:['q1']}).fit('QB',6000,{pid:'starterUpgrade'}).dropPid,null,'open roster slot requires no drop');
players.w={position:'WR',team:'A'};players.rb={position:'RB',team:'B'};players.add={position:'RB',team:'C'};
Object.assign(values,{w:4000,rb:3000,add:3500});Object.assign(projection,{w:20,rb:15,add:18});
const flexLeague={settings:{type:0},roster_positions:['WR','FLEX','BN']};
r=read({players:['w','rb']},flexLeague);
assert.equal(r.beforeWeekly.total,35,'FLEX does not double-count WR');
assert.equal(r.fit('RB',3500,{pid:'add'}).weeklyGain,3,'available roster matching finds the FLEX improvement');
assert.equal(read({players:['missing']}).known,false);
console.log('PASS usable coverage, before/after FLEX matching, real drops, protected players, missing evidence and bench-only rejection');
// Horizon selection uses fantasy-point differences for the same add/drop.
const ros={q1:200,q2:250,starterUpgrade:210};
const full={settings:{type:0},roster_positions:['QB']};
const one={players:['q1']};
values.starterUpgrade=6000;projection.starterUpgrade=25;
let options={horizon:'week',rosProject:pid=>ros[pid]};
fit=read(one,full,options).fit('QB',6000,{pid:'starterUpgrade'});
assert.equal(fit.weeklyGain,3);assert.equal(fit.rosGain,10);assert.equal(fit.dropPid,'q1');
ros.starterUpgrade=180;
fit=read(one,full,options).fit('QB',6000,{pid:'starterUpgrade'});
assert.equal(fit.rosGain,-20,'week choice exposes ROS loss');
assert.equal(read(one,full,{...options,horizon:'both'}).fit('QB',6000,{pid:'starterUpgrade'}).score,0,'both excludes tradeoffs');
ros.starterUpgrade=240;projection.starterUpgrade=20;
fit=read(one,full,{...options,horizon:'season'}).fit('QB',6000,{pid:'starterUpgrade'});
assert.equal(fit.weeklyGain,-2);assert.equal(fit.rosGain,40,'season choice exposes week loss and season gain');
ros.starterUpgrade=null;
assert.equal(read(one,full,{...options,horizon:'season'}).fit('QB',6000,{pid:'starterUpgrade'}).score,0,'missing ROS cannot claim improvement');
assert.equal(read(one,full,{...options,horizon:'week'}).fit('QB',6000,{pid:'starterUpgrade'}).score,0,'no weekly improvement is not a stream');
console.log('PASS week, season, both, signed tradeoffs, and missing ROS boundaries');

// A defender upgrade must not silently fund itself with the owner's QB cover.
Object.assign(players,{
 mainQ:{position:'QB',team:'KC',depth_chart_order:1}, reserveQ:{position:'QB',team:'BUF',depth_chart_order:1},
 defender:{position:'DEF',team:'SEA'}, newDefender:{position:'DEF',team:'DET'},
 reserveW:{position:'WR',team:'LA'}, mainW:{position:'WR',team:'DAL'},
 thirdQ:{position:'QB',team:'ATL',depth_chart_order:1}, fourthQ:{position:'QB',team:'NYJ',depth_chart_order:1},
});
Object.assign(values,{mainQ:5000,reserveQ:100,defender:500,newDefender:1000,reserveW:100,mainW:5000,thirdQ:80,fourthQ:60});
Object.assign(projection,{mainQ:22,reserveQ:18,defender:3,newDefender:8,reserveW:5,mainW:20,thirdQ:15,fourthQ:12});
const defenseLeague={settings:{type:0},roster_positions:['QB','DEF','BN']};
fit=read({players:['mainQ','reserveQ','defender']},defenseLeague,{horizon:'week'}).fit('DEF',1000,{pid:'newDefender'});
assert.equal(fit.dropPid,'defender','Replace the weaker defense and retain the backup quarterback');
assert.equal(fit.weeklyGain,5);
for (const pos of ['LB','DL','DB']) {
 players.defender.position=pos;players.newDefender.position=pos;
 fit=read({players:['mainQ','reserveQ','defender']},{...defenseLeague,roster_positions:['QB',pos,'BN']},
  {horizon:'week'}).fit(pos,1000,{pid:'newDefender'});
 assert.equal(fit.dropPid,'defender',pos+': replace the existing defender and retain quarterback cover');
}
players.defender.position='DEF';players.newDefender.position='DEF';
const receiverLeague={settings:{type:0},roster_positions:['WR','DEF','BN']};
fit=read({players:['mainW','reserveW','defender']},receiverLeague,{horizon:'week'}).fit('DEF',1000,{pid:'newDefender'});
assert.equal(fit.dropPid,'defender','Equal lineup gains prefer replacing the player at the incoming position');
for (const slots of [['QB','QB','DEF','BN'],['QB','SUPER_FLEX','DEF','BN']]) {
 fit=read({players:['mainQ','reserveQ','thirdQ','defender']},{...defenseLeague,roster_positions:slots},
  {horizon:'week',protectedPids:['defender']}).fit('DEF',1000,{pid:'newDefender'});
 assert.equal(fit.score,0,'Two-QB and superflex leagues retain starter demand plus a backup');
}
players.mainQ.bye=3; players.mainW.bye=3;
for (const [pid,slot] of [['mainQ','QB'],['mainW','WR']]) {
 fit=read({players:[pid,'defender']},{...defenseLeague,roster_positions:[slot,'DEF']},
  {horizon:'week',protectedPids:['defender']}).fit('DEF',1000,{pid:'newDefender'});
 assert.equal(fit.score,0,'A bye cannot make the only future starter at '+slot+' disposable');
}
delete players.mainQ.bye;delete players.mainW.bye;
fit=read({players:['mainQ','reserveQ','thirdQ','fourthQ','defender']},
 {...defenseLeague,roster_positions:['QB','DEF','BN','BN','BN']},{horizon:'week',protectedPids:['defender']})
 .fit('DEF',1000,{pid:'newDefender'});
assert.equal(fit.dropPid,'fourthQ','Genuine QB surplus remains an option when it improves the lineup and preserves depth');
console.log('PASS position-aware drops: QB reserves, superflex demand, future bye coverage, equivalent defender swaps and genuine surplus');
