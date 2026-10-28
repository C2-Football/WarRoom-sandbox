'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const APP = process.env.RELIABILITY_APP || path.resolve(__dirname, '..');
const SHARED = process.env.RELIABILITY_SHARED || process.env.SHARED_SOURCE || path.resolve(APP, '../dhq-shared');
function harness() {
    let now = Date.parse('2026-10-27T12:00:00Z');
    class Clock extends Date { static now() { return now; } }
    const box = { console, Date: Clock, setTimeout, clearTimeout, Promise, Map, Set, fetch: async()=>({ok:false}),
        S:{currentLeagueId:'L',currentWeek:8,nflState:{season:'2026',week:8,display_week:9}}, App:{}, events:[] };
    box.window=box;box.globalThis=box;box.dispatchEvent=e=>box.events.push(e);box.CustomEvent=function(type,opts){this.type=type;this.detail=opts?.detail;};
    vm.createContext(box);
    const load = file => vm.runInContext(fs.readFileSync(file,'utf8'),box,{filename:file});
    load(path.join(SHARED,'sleeper-api.js'));
    for(const file of ['startsit-engine','weekly-proj','availability-forecast','waiver-roster-read','faab-engine','matchup','trade-season-impact']) load(path.join(APP,'js/shared',file+'.js'));
    load(path.join(SHARED,'player-value.js'));
    box.App.normPos=p=>p;box.App.LeagueSkin={getCurrent:()=>({type:'redraft'})};
    return {box,load,advance:ms=>now+=ms};
}
function fixture() {
    const players={starter:{position:'RB',team:'BUF',full_name:'Starter'},bench:{position:'RB',team:'KC',full_name:'Bench'},add:{position:'RB',team:'CHI',full_name:'Candidate'},other:{position:'RB',team:'DAL',full_name:'Other'}};
    const league={league_id:'L',season:'2026',status:'in_season',total_rosters:2,scoring_settings:{rush_yd:.1},roster_positions:['RB','BN'],settings:{type:0,start_week:1,playoff_week_start:15,playoff_teams:2,playoff_end_week:17,waiver_budget:100,waiver_budget_min:1},
        rosters:[{roster_id:1,owner_id:'u1',players:['starter','bench'],settings:{waiver_budget_used:0,wins:4,losses:3,ties:0,fpts:700}},{roster_id:2,owner_id:'u2',players:['other'],settings:{waiver_budget_used:0,wins:3,losses:4,ties:0,fpts:650}}]};
    return {league,players,roster:league.rosters[0]};
}
function forecast(h,stats,scoring,position='QB') {
    return h.box.App.WeeklyProj.projectPlayer('p',{playersData:{p:{position,team:'BUF'}},statsData:{},priorData:{},week:8,scoring,providerProjections:{p:stats}});
}
test('production WeeklyProj → StartSit → shared scorer: 38-point custom QB, 6-point defense',()=>{
    const h=harness();
    assert.equal(forecast(h,{pass_att:30,pass_cmp:20,pass_fd:10,pass_yd:250,pass_td:2},{pass_yd:.04,pass_td:4,pass_cmp:.5,pass_fd:1}).points.median,38);
    assert.equal(forecast(h,{sack:2,int:2},{sack:1,int:2},'DEF').points.median,6);
});
test('production scorer handles premiums, alias precedence, thresholds and explicit zero without double counting',()=>{
    const h=harness();
    assert.equal(forecast(h,{rec:4,rec_yd:100},{rec:1,rec_yd:.1,bonus_rec_te:.5,bonus_rec_yd_100:3},'TE').points.median,19);
    assert.equal(forecast(h,{rec:4},{rec:0,bonus_rec_te:0},'TE').points.median,0);
    const score=h.box.calcFantasyPts;
    assert.equal(score({idp_sack:2,sack:2,idp_tkl_solo:3,tkl_solo:3},{idp_sack:3,sack:3,idp_tkl_solo:1,tkl_solo:1},'LB'),9);
    assert.equal(score({idp_sack:0,sack:2},{idp_sack:3},'LB'),0);
    assert.equal(score({idp_sack:2,sack:2},{idp_sack:0,sack:3},'LB'),0);
    assert.equal(score({sack:2,int:2},{sack:1,int:2,idp_sack:4,idp_int:4},'DEF'),6);
    assert.equal(score({pts_allow:0},{pts_allow_0:10},'DEF'),10);
    assert.equal(score({fgm_50p:2,fgm_50_59:1,fgm_60p:1},{fgm_50p:5,fgm_50_59:5,fgm_60p:6},'K'),11);
});
test('unsupported custom rule pauses scored recommendations',()=>{
    const out=forecast(harness(),{rush_att:10,rush_yd:100},{rush_yd:.1,unknown_rule:10},'RB');
    assert.equal(out.available,false);assert.equal(out.points.median,null);assert(out.scoringSupport.unsupported.includes('unknown_rule'));
});
test('missing and actual zero remain distinct; redraft values never borrow dynasty; scope changes invalidate',()=>{
    const h=harness(),{box}=h,f=fixture(),PV=box.App.PlayerValue;
    box.S.leagues=[f.league];box.App.LI={playerScores:{starter:8000,bench:7000,add:9000}};
    const ctx={league:f.league,playersData:f.players,statsData:{starter:{gp:1,rush_att:10,rush_yd:100},bench:{gp:1,rush_att:1,rush_yd:0}},skin:{type:'redraft'},noMarketFetch:true};
    assert.equal(PV.getValue('starter'),null);
    const ros=PV.ensureRos(ctx);assert(ros.values.starter>0);assert.equal(PV.getValue('bench'),0);assert.equal(PV.getValue('add'),null);
    box.S.currentLeagueId='OTHER';assert.equal(PV.getValue('starter'),null);box.S.currentLeagueId='L';
    f.league.scoring_settings={rush_yd:.2};assert.equal(PV.getValue('starter'),null);PV.ensureRos(ctx);assert(PV.getValue('starter')>0);
    h.advance(16*60*1000);assert.equal(PV.getValue('starter'),null);
    box.S.nflState.season='2027';assert.equal(PV.getValue('starter'),null);
});
test('injured seasonal value has healthy scenario but no invented central availability',()=>{
    const h=harness(),f=fixture();f.players.add.injury_status='IR';h.box.S.leagues=[f.league];
    const ros=h.box.App.PlayerValue.ensureRos({league:f.league,playersData:f.players,statsData:{starter:{gp:1,rush_yd:100},add:{gp:1,rush_yd:200}},skin:{type:'redraft'},noMarketFetch:true});
    assert(ros.healthyPoints.add>0);assert.equal(ros.values.add,undefined);assert.equal(h.box.App.PlayerValue.getValue('add'),null);assert(ros.availability.add.unresolvedWeeks.length>0);
});
test('IR add/drop scenario preserves 10-point starter over 2-point bench and exposes weekly effect',()=>{
    const h=harness(),f=fixture();f.players.add.injury_status='IR';
    const read=h.box.App.buildFaRosterRead(f.roster,f.league,f.players,pid=>({starter:100,bench:100,add:200})[pid],{week:8,horizon:'season',project:pid=>({starter:10,bench:2})[pid]??null,rosProject:pid=>({starter:100,bench:100,add:200})[pid]});
    const fit=read.fit('RB',200,{pid:'add'});assert.equal(fit.dropPid,'bench');assert.equal(fit.weeklyGain,0);assert.equal(fit.conditional,true);assert.match(fit.label,/IR|availability|timing/);
});
test('partial rosters, disabled additions, owned candidates and exhausted budget withhold moves',()=>{
    const h=harness(),f=fixture(),E=h.box.App.RecommendationEligibility;
    assert.equal(E.check({...f.league,rosters:[f.roster]},f.roster).ok,false);
    assert.equal(E.check({...f.league,settings:{...f.league.settings,disable_adds:1}},f.roster).ok,false);
    f.roster.settings.waiver_budget_used=100;assert.equal(E.check(f.league,f.roster).ok,false);f.roster.settings.waiver_budget_used=0;
    const r=h.box.App.buildFaRosterRead(f.roster,f.league,f.players,()=>100,{project:()=>10});assert.equal(r.fit('RB',200,{pid:'other'}).score,0);
});
test('FAAB suppresses no-history winning odds, observes minimum/zero budget, and includes superflex demand',()=>{
    const h=harness(),f=fixture(),Faab=h.box.App.Faab;
    let out=Faab.analyze({league:f.league,myRosterId:1,playersData:f.players,targetPos:'RB',txns:[]});assert.equal(out.rec,null);assert.equal(out.probabilityCalibrated,false);
    const txns=Array.from({length:5},(_,i)=>({transaction_id:String(i),type:'waiver',status:'complete',league_id:'L',adds:{add:1},settings:{waiver_bid:5+i}}));
    f.roster.settings.waiver_budget_used=100;
    out=Faab.analyze({league:f.league,myRosterId:1,playersData:f.players,targetPos:'RB',txns});assert.equal(out.rec,null);assert.equal(out.ladder.length,0);
    f.league.settings.waiver_budget_min=0;
    out=Faab.analyze({league:f.league,myRosterId:1,playersData:f.players,targetPos:'RB',txns});assert.equal(out.rec.bid,0);assert.equal(out.rec.winPct,undefined);
    assert.notEqual(Faab.needAt({players:[]},'QB',{roster_positions:['SUPER_FLEX']},{}),'LOW');
});
test('weekly projection cache deduplicates, retries failed fetches, expires and isolates league/full-refresh races',async()=>{
    const h=harness(),b=h.box,WP=b.App.WeeklyProj;let calls=0,resolve;
    b.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
    const a=WP.ensureWeekProjections(8),same=WP.ensureWeekProjections(8);await Promise.resolve();assert.equal(calls,1);
    resolve({ok:false});await Promise.all([a,same]);assert.equal(WP.providerLine('p',8),null);
    h.advance(31000);b.fetch=async()=>{calls++;return{ok:true,json:async()=>({p:{rush_att:10,rush_yd:100}})}};
    await WP.ensureWeekProjections(8);assert.equal(calls,2);assert(WP.providerLine('p',8));const first=WP.freshness(8).fetchedAt;
    h.advance(16*60*1000);await WP.ensureWeekProjections(8);assert.equal(calls,3);assert(WP.freshness(8).fetchedAt>first);assert.equal(WP.freshness(8).providerAsOf,null);
    b.fetch=()=>new Promise(r=>resolve=r);const old=WP.ensureWeekProjections(9);await Promise.resolve();b.S.currentLeagueId='NEW';WP.invalidate();resolve({ok:true,json:async()=>({p:{rush_yd:999,rush_att:20}})});await old;assert.equal(WP.providerLine('p',9),null);
});
test('FantasyCalc requests two-QB calibration and a same-league scoring change starts a separate fetch',async()=>{
    const h=harness(),f=fixture();f.league.roster_positions=['QB','QB','BN'];h.box.S.leagues=[f.league];const urls=[];
    h.box.fetch=async url=>{urls.push(url);return{ok:true,json:async()=>[{player:{sleeperId:'starter',position:'RB'},value:100}]}};
    const ctx={league:f.league,playersData:f.players,statsData:{starter:{gp:1,rush_yd:100}},skin:{type:'redraft'}};
    h.box.App.PlayerValue.ensureRos(ctx);await new Promise(r=>setImmediate(r));assert(urls.some(u=>u.includes('numQbs=2')));
    f.league.scoring_settings={rec:1,rush_yd:.1};h.box.App.PlayerValue.ensureRos(ctx);await new Promise(r=>setImmediate(r));assert.equal(urls.length,2);
});
test('actual NFL week beats advanced display week; current and championship benefits persist until games finish',()=>{
    const h=harness(),f=fixture(),WP=h.box.App.WeeklyProj;assert.equal(WP.currentWeek(),8);
    h.box.App.NflContext={gameStatus:g=>g?.state};
    let out=WP.decisionHorizon(f.league,{week:17,games:[{state:'upcoming'}]});assert.deepEqual([...out.weeks],[17]);assert.equal(out.tradeFromWeek,17);
    out=WP.decisionHorizon(f.league,{week:17,games:[{state:'final'}]});assert.equal(out.weeks.length,0);
});
test('high-price trade that harms legal starters has negative roster benefit; explicit required drop is evaluated',async()=>{
    const h=harness(),f=fixture(),b=h.box;f.league.settings.waiver_budget=0;f.league.roster_positions=['RB','WR','BN'];
    f.players.bench.position='WR';f.players.other.position='WR';f.roster.players=['starter','bench'];b.App.PlayoffOdds={fetchFuturePairs:async()=>({9:[[1,2]]})};
    const statsData={starter:{gp:1,rush_yd:200},bench:{gp:1,rec:2},other:{gp:1,rec:10}};f.league.scoring_settings={rush_yd:.1,rec:1};
    const context=await b.App.TradeSeasonImpact.prepare({league:f.league,playersData:f.players,statsData,fromWeek:9});
    const result=b.App.TradeSeasonImpact.analyze({context,myRosterId:1,partnerRosterId:2,givePlayerIds:['starter'],receivePlayerIds:['other'],pointsOnly:true});
    assert(result.delta<0);assert(result.weeks.some(w=>w.unfilledAfter>w.unfilledBefore));
    f.roster.players=['starter','bench','add'];statsData.add={gp:1,rush_yd:10};
    const ctx=await b.App.TradeSeasonImpact.prepare({league:f.league,playersData:f.players,statsData,fromWeek:9});
    const blocked=b.App.TradeSeasonImpact.analyze({context:ctx,myRosterId:1,partnerRosterId:2,givePlayerIds:[],receivePlayerIds:['other'],pointsOnly:true});assert.match(blocked.reason,/capacity/);
    const dropped=b.App.TradeSeasonImpact.analyze({context:ctx,myRosterId:1,partnerRosterId:2,givePlayerIds:[],receivePlayerIds:['other'],dropPlayerIds:['add'],pointsOnly:true});assert.equal(dropped.drops[0],'add');assert(dropped.delta>0);
});
test('future injured roster cannot silently become an all-season healthy or all-season zero forecast',async()=>{
    const h=harness(),f=fixture(),b=h.box;f.players.other.injury_status='IR';b.App.PlayoffOdds={fetchFuturePairs:async()=>({})};
    const context=await b.App.TradeSeasonImpact.prepare({league:f.league,playersData:f.players,statsData:{starter:{gp:1,rush_yd:100},bench:{gp:1,rush_yd:20},other:{gp:1,rush_yd:200}},fromWeek:9});
    assert.equal(context.projectionsByWeek[9].other.points.median,null);
    const result=b.App.TradeSeasonImpact.analyze({context,myRosterId:1,partnerRosterId:2,givePlayerIds:['bench'],receivePlayerIds:['other'],pointsOnly:true});assert.equal(result.status,'unavailable');assert.equal(result.delta,null);
});
test('Trade Center production wrapper never falls back during loading or missing/zero ROS',()=>{
    const h=harness(),b=h.box,src=fs.readFileSync(path.join(APP,'js/trade-calc.js'),'utf8');
    const snippet=src.slice(src.indexOf('        function getPlayerValue(pid)'),src.indexOf('        const getPickValue',src.indexOf('        function getPlayerValue(pid)')));
    b.resolvedLeagueSkin={type:'redraft'};b.App.LI={playerScores:{starter:8000,bench:8000}};vm.runInContext(snippet,b);
    assert.equal(b.getPlayerValue('starter').value,null);
    const f=fixture();b.S.leagues=[f.league];b.App.PlayerValue.ensureRos({league:f.league,skin:{type:'redraft'},playersData:f.players,statsData:{starter:{gp:1,rush_yd:100},bench:{gp:1,rush_yd:0,rush_att:1}},noMarketFetch:true});
    assert.equal(b.getPlayerValue('bench').value,0);b.S.currentLeagueId='OTHER';assert.equal(b.getPlayerValue('starter').value,null);
});
test('production full refresh invalidates players, weekly/season projections, market, NFL and SOS; late responses cannot repopulate',async()=>{
    const h=harness(),b=h.box,src=fs.readFileSync(path.join(APP,'js/core.js'),'utf8');
    const start=src.indexOf('    let _wrPlayersCache'),end=src.indexOf('    // ─── Shared Constants',start);
    const clearStart=src.indexOf('    window.App.clearDataCaches ='),clearEnd=src.indexOf('\n    };',clearStart)+7;
    b.WrIDB={get:async()=>null,set:async()=>{},del:async()=>{}};b.WR_KEYS={PLAYERS_CACHE:'players'};b.SLEEPER_BASE_URL='https://fixture';b.wrLog=()=>{};
    let calls=0,resolve;b.fetchJSON=()=>{calls++;return new Promise(r=>resolve=r);};
    vm.runInContext('let _wrStatsCache={}, _projectionsCache={};\n'+src.slice(start,end)+'\n'+src.slice(clearStart,clearEnd),b);
    const one=b.fetchAllPlayers(),two=b.fetchAllPlayers();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
    let invalidations=0;for(const module of ['WeeklyProj','PlayerValue','NflContext','SOS']) b.App[module]={invalidate:()=>invalidations++};b.Sleeper.clearSeasonCaches=()=>invalidations++;
    b.App.clearDataCaches();assert.equal(invalidations,5);resolve({old:{team:'BUF'}});assert.equal(await one,null);await two;
    b.fetchJSON=async()=>{calls++;return{fresh:{team:'KC'}}};assert((await b.fetchAllPlayers()).fresh);assert.equal(calls,2);
    h.advance(16*60*1000);await b.fetchAllPlayers();assert.equal(calls,3,'memory player cache expires');
});
test('shared season cache failures retry, concurrent requests deduplicate, refresh isolates late requests',async()=>{
    const h=harness(),b=h.box;let calls=0,resolve;
    b.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
    const a=b.Sleeper.fetchSeasonProjections('2026'),same=b.Sleeper.fetchSeasonProjections('2026');await new Promise(r=>setImmediate(r));assert.equal(calls,1);
    resolve({ok:false,status:503});await Promise.allSettled([a,same]);
    b.fetch=async()=>{calls++;return{ok:true,json:async()=>({p:{rush_att:10}})}};await b.Sleeper.fetchSeasonProjections('2026');assert.equal(calls,2);
    b.Sleeper.clearSeasonCaches();b.fetch=()=>new Promise(r=>resolve=r);const old=b.Sleeper.fetchSeasonProjections('2026');await new Promise(r=>setImmediate(r));b.Sleeper.clearSeasonCaches();resolve({ok:true,json:async()=>({p:{rush_att:999}})});await assert.rejects(old,/superseded/);
    b.fetch=async()=>({ok:true,json:async()=>({p:{rush_att:20}})});assert.equal((await b.Sleeper.fetchSeasonProjections('2026')).p.rush_att,20);
});
test('known started or completed games never count as a future full-week waiver gain',()=>{
 const h=harness(),f=fixture();h.box.App.WeeklyProj.gameStatusFor=team=>team==='CHI'?'final':'upcoming';
 const r=h.box.App.buildFaRosterRead(f.roster,f.league,f.players,pid=>({starter:100,bench:20,add:200})[pid],{week:8,horizon:'week',project:pid=>({starter:10,bench:2,add:20})[pid]});
 const fit=r.fit('RB',200,{pid:'add'});assert.equal(fit.score,0);assert.equal(fit.weeklyGain,null);assert.match(fit.label,/started or finished/);
});
test('seasonal format remains active before loads and after season end, never authorizing dynasty callers',()=>{
 const h=harness(),f=fixture();h.box.S.leagues=[f.league];h.box.App.LI={playerScores:{add:8000}};
 assert.equal(h.box.App.PlayerValue.isRedraftActive(),true);assert.equal(h.box.App.PlayerValue.getValue('add'),null);
 h.box.S.nflState.week=18;f.league.status='complete';assert.equal(h.box.App.PlayerValue.isRedraftActive(),true);assert.equal(h.box.App.PlayerValue.getValue('add'),null);
});
test('production weekly forecast preserves uncertain participation as unknown and exposes healthy scenario',()=>{
 const h=harness();const out=h.box.App.WeeklyProj.projectPlayer('p',{playersData:{p:{position:'RB',team:'BUF',injury_status:'Questionable'}},statsData:{},priorData:{},week:8,scoring:{rush_yd:.1},providerProjections:{p:{rush_att:10,rush_yd:100}}});
 assert.equal(out.available,false);assert.equal(out.points.median,null);assert.equal(out.conditionalPoints.median,10);
});
test('CTB custom scoring no longer blocks waiver and trade eligibility',()=>{
    const h=harness(),f=fixture();
    Object.assign(f.league.scoring_settings,{def_forced_punts:1,blk_kick_ret_yd:.1,sack_yd:.1,def_pr_td:6,def_4_and_stop:2,fg_ret_yd:.1,yds_allow_550p:-5,pass_int_td:-6,int_ret_yd:.1,def_2pt:2,def_kr_td:6,def_3_and_out:1,fum_ret_yd:.1});
    for(const kind of ['waiver','trade']) {
        const out=h.box.App.RecommendationEligibility.check(f.league,f.roster,kind);
        assert.equal(out.ok,true,out.reason);
    }
    f.league.scoring_settings.unknown_rule=1;
    assert.equal(h.box.App.RecommendationEligibility.check(f.league,f.roster).ok,false);
});
