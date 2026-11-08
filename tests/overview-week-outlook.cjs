'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const { test } = require('node:test');
const Cup = require('../js/shared/woeppel-cup.js');
const window = { App: {}, WoeppelCup: Cup };
const context = vm.createContext({ window, console });
vm.runInContext(fs.readFileSync('js/shared/league-live-scores.js','utf8'),context);
vm.runInContext(fs.readFileSync('js/shared/chopped.js','utf8'),context);
vm.runInContext(Babel.transform(fs.readFileSync('js/tabs/league-central.js','utf8'),{ presets:['react'] }).code,context);
window.App.NflContext = { gameStatus: game => game?.completed ? 'final' : game?.state === 'in' ? 'live' : game?.state === 'pre' ? 'upcoming' : 'unknown' };
const league = { league_id:'l1',season:2026,settings:{playoff_teams:2,playoff_week_start:15},rosters:[1,2,3,4].map(roster_id=>({roster_id})) };
const name = id => 'Owner ' + id;
const playersData = { a:{team:'KC'}, b:{team:'BUF'}, c:{team:'DAL'}, d:{team:'PHI'} };
const games = [{home:'KC',away:'BUF',completed:true},{home:'DAL',away:'PHI',state:'pre'}];
const forecast = points => ({points:{median:points},statLine:{median:{rush_yd:10}}});
const board = {supported:true,week:6,status:'ready',rows:[
    {roster_id:1,matchup_id:1,points:20,starters:['a','c'],players_points:{a:20,c:0}},
    {roster_id:2,matchup_id:1,points:10,starters:['b','d'],players_points:{b:10,d:0}},
]};
const odds = {status:'ready',sim:{leverage:{week:6,current:50,ifWin:72,ifLose:31}}};
const run = extra => window.buildLeagueOverviewOutlook({board,roster:{roster_id:1},league,week:6,games,playersData,
    projections:{c:forecast(15),d:forecast(20)},odds,name,...extra});

test('live week uses earned completed scores plus unfinished starter forecasts and conditional playoff impact',()=>{
    const read=run();
    assert.equal(read.result,'win'); assert.equal(read.final,false);
    assert.equal(read.headline,'You’re projected to win.');
    assert.match(read.detail,/35.0–30.0 vs Owner 2 projected finish/);
    assert.equal(read.playoff.projected,72); assert.equal(read.playoff.ifLose,31);
    assert.equal(read.finishes['1'],35);
    const loss=run({projections:{c:forecast(1),d:forecast(30)}});
    assert.equal(loss.result,'loss'); assert.equal(loss.playoff.projected,31);
    const tie=run({projections:{c:forecast(10),d:forecast(20)}});
    assert.equal(tie.result,'tie'); assert.equal(tie.playoff.projected,null);
});

test('missing forecasts, stale/foreign-week boards, absent rosters, byes and multi-team groups never invent a result',()=>{
    assert.equal(run({projections:{}}).result,null);
    for(const changed of [{...board,status:'stale'},{...board,error:'offline'},{...board,week:5},{...board,supported:false}]){
        const read=run({board:changed});assert.equal(read.result,null);assert.equal(Object.keys(read.finishes).length,0);
    }
    assert.equal(run({roster:{roster_id:3}}).result,null);
    assert.match(run({board:{...board,rows:[{...board.rows[0],matchup_id:null}]}}).detail,/bye/);
    assert.equal(run({board:{...board,rows:[...board.rows,{...board.rows[1],roster_id:3}]}}).result,null);
    assert.equal(run({odds:{...odds,sim:{leverage:{...odds.sim.leverage,week:5}}}}).playoff,null);
    assert.equal(run({odds:{status:'loading'}}).playoff,null);
});

test('final matchup result replaces a projection only after both sets of starters finish',()=>{
    const read=run({games:[...games.slice(0,1),{...games[1],completed:true}]});
    assert.equal(read.final,true); assert.equal(read.headline,'You won this week.');
    assert.match(read.detail,/20.0–10.0.*awaiting official results/);
    const unknown=run({games:games.slice(0,1)});assert.equal(unknown.final,false);assert.equal(unknown.result,null);
});

test('Chopped uses the survival cutline rather than a head-to-head win or playoff odds',()=>{
    const localLeague={...league,rosters:league.rosters.slice(0,2)};
    const read=run({league:localLeague,chopped:true});
    assert.match(read.headline,/above the chop line/);assert.equal(read.result,null);assert.equal(read.playoff,null);
    assert.match(run({league:localLeague,chopped:true,roster:{roster_id:2}}).headline,/at the chop line/);
    assert.match(run({chopped:true}).headline,/loading/,'Every surviving team needs a forecast');
});

test('live-week mode persists between early and Sunday games, excludes postponed and cancelled kickoffs',()=>{
    const read=games=>window.buildLeagueOverviewDecision({league,week:6,roster:{starters:[]},games,now:100});
    assert.equal(read([{...games[0]},{...games[1]}]).started,true);
    assert.equal(read([{state:'in'}]).started,true);
    assert.equal(read([{state:'pre',kickoff:'2099-01-01'}]).started,false);
    assert.equal(read([{state:'in',statusName:'STATUS_POSTPONED'}]).started,false);
    assert.equal(read([{state:'in',statusName:'STATUS_CANCELED'}]).started,false);
});

const cupFixture = (format='points', n=4) => {
    const value=Cup.configure({...league,rosters:Array.from({length:n},(_,i)=>({roster_id:i+1}))},format);
    Object.assign(value,{enabled:true,locked:true});return value;
};
const cupRun=(cup,week,extra={})=>window.buildLeagueOverviewCup({cup,week,rosterId:1,finishes:Object.fromEntries(cup.teams.map((id,i)=>[id,150-i*20])),name,...extra});
const fill=(cup,weeks)=>weeks.forEach(w=>cup.weeks[w]={final:true,scores:Object.fromEntries(cup.teams.map((id,i)=>[id,100-i*10]))});

test('Cup forecast computes potential qualifying place without changing official state',()=>{
    for(const format of ['points','all-play','median','round-robin','groups']){
        const cup=cupFixture(format),week=cup.startWeek;
        const before=JSON.stringify(cup),read=cupRun(cup,week);
        assert.match(read.detail,/If forecasts hold: #1/,'format '+format);
        assert.match(read.detail,/inside the top/);
        assert.equal(JSON.stringify(cup),before,'A preview never finalizes or changes shared results');
    }
});

test('Cup forecast handles configured dates, participation, disabled drafts, missing scores and unfinished prior weeks',()=>{
    const cup=cupFixture(),week=cup.startWeek;
    assert.match(cupRun(cup,week-1).detail,/Starts Week/);
    assert.equal(cupRun(cup,week,{rosterId:99}),null);
    assert.equal(cupRun({...cup,locked:false},week),null);
    assert.equal(cupRun({...cup,enabled:false},week),null);
    assert.match(cupRun(cup,week,{finishes:{1:10}}).detail,/remaining team scores/);
    assert.match(cupRun(cup,week+1).detail,/Earlier Cup results need finalizing/);
});

test('Cup projected ties do not silently assign a qualifier or knockout winner',()=>{
    const cup=cupFixture();
    cup.qualifierCount=2;
    assert.match(cupRun(cup,cup.startWeek,{finishes:{1:10,2:10,3:10,4:10}}).detail,/tied at the qualifying cutline/);
    const ko=cupFixture('knockout'),pair=Cup.knockout(ko)[0][0];
    assert.match(cupRun(ko,ko.startWeek,{rosterId:pair.a,finishes:{1:10,2:10,3:10,4:10}}).detail,/tiebreak remains unresolved/);
});

test('knockout, byes, survivor and double elimination have format-correct consequences',()=>{
    const ko=cupFixture('knockout');
    assert.match(cupRun(ko,ko.startWeek).detail,/beat Owner 4 and advance/);
    assert.match(cupRun(ko,ko.startWeek,{rosterId:4}).detail,/lose to Owner 1 and leave/);
    const odd=cupFixture('knockout',3);assert.match(cupRun(odd,odd.startWeek).detail,/bye into the next round/);
    const survivor=cupFixture('survivor');
    assert.match(cupRun(survivor,survivor.startWeek).detail,/survive into the next round/);
    assert.match(cupRun(survivor,survivor.startWeek,{rosterId:4}).detail,/eliminated/);
    assert.match(cupRun(survivor,survivor.startWeek,{finishes:{1:10,2:10,3:10,4:10}}).detail,/tied at the survival cutoff/);
    const double=cupFixture('round-robin-double');
    fill(double,Array.from({length:double.groupWeeks},(_,i)=>double.startWeek+i));
    assert.match(cupRun(double,double.knockoutStart,{rosterId:4}).detail,/move to the lower bracket/);
});

test('official Cup finals use saved scores instead of hypothetical projections',()=>{
    const cup=cupFixture('knockout'); fill(cup,Cup.schedule(cup));
    assert.match(cupRun(cup,Cup.schedule(cup).at(-1),{finishes:{1:0,2:500,3:0,4:0}}).detail,/You won the Cup/);
    const points=cupFixture();fill(points,[points.startWeek]);
    assert.match(cupRun(points,points.startWeek,{finishes:{1:-100,2:1000,3:1000,4:1000}}).detail,/After the finalized week: #1/);
});

test('a commissioner seeding ruling is retained when previewing a knockout round',()=>{
    const cup=cupFixture(); fill(cup,Array.from({length:cup.groupWeeks},(_,i)=>cup.startWeek+i));
    cup.seedRuling={ids:['4','3','2','1'],reason:'Approved seeding'};
    const read=cupRun(cup,cup.knockoutStart,{rosterId:4});
    assert.match(read.detail,/lose to Owner 1/);
    assert.equal(cup.seedRuling.ids[0],'4');
});

test('legacy Woeppel Cup respects its group draw and wildcard rules',()=>{
    const cup={locked:true,drawMargin:4,weeks:{},groups:{A:['1','2','3','4'],B:['5','6','7','8'],C:['9','10','11','12']}};
    const finishes=Object.fromEntries(Array.from({length:12},(_,i)=>[String(i+1),200-i*10]));
    const read=window.buildLeagueOverviewCup({cup,week:6,rosterId:1,finishes,name});
    assert.match(read.detail,/#1 in Group A/);assert.match(read.detail,/third-place wildcards/);
    assert.equal(Object.keys(cup.weeks).length,0);
});

test('Cup insights use one consistent live-score basis when any forecast is missing',()=>{
    const cup=cupFixture();
    const liveScores={1:20,2:10,3:0,4:-2};
    const read=cupRun(cup,cup.startWeek,{finishes:{1:900,2:300,3:null,4:900},liveScores});
    assert.match(read.detail,/As scores stand: #1/);assert.equal(read.tone,'good');
    assert.equal(read.scoreText,'Your score 20.0');
    assert.doesNotMatch(read.detail,/forecasts|900/);
    const lose=cupRun({...cup,qualifierCount:2},cup.startWeek,{finishes:{},liveScores,rosterId:4});
    assert.equal(lose.tone,'bad');assert.match(lose.detail,/outside the top 2/);
    const original=JSON.stringify(cup);
    cupRun(cup,cup.startWeek,{finishes:{},liveScores});assert.equal(JSON.stringify(cup),original);
});

test('Cup score overlays preserve finals, zeros, negative points and custom totals without changing standings',()=>{
    const cup=cupFixture(),week=cup.startWeek;
    const board={week,supported:true,status:'ready',updatedAt:100,rows:[
        {roster_id:1,points:10,custom_points:0},{roster_id:2,points:-2},{roster_id:3,points:null},{roster_id:4,points:'12'},
        {roster_id:99,points:900},
    ]};
    const original=JSON.stringify(cup),preview=Cup.scorePreview(cup,week,board);
    assert.equal(preview.live,true);assert.deepEqual(preview.scores,{'1':0,'2':-2});
    assert.equal(preview.state.weeks[week].final,false);
    assert.deepEqual(Cup.tables(preview.state),Cup.tables(cup),'Automatic scores never count as finalized results');
    assert.equal(JSON.stringify(cup),original);
    for(const changed of [{...board,status:'stale'},{...board,error:'offline'},{...board,week:week+1},{...board,supported:false}])assert.equal(Cup.scorePreview(cup,week,changed).live,false);
    cup.weeks[week]={final:true,scores:{1:100,2:90,3:80,4:70}};
    const finalized=Cup.scorePreview(cup,week,board);
    assert.equal(finalized.live,false);assert.equal(finalized.state.weeks[week].scores['1'],100);
});

test('legacy Cup live scores include both teams in the manager’s real Cup pairing',()=>{
    const cup={locked:true,drawMargin:4,weeks:{},groups:{A:['1','2','3','4'],B:['5','6','7','8'],C:['9','10','11','12']}};
    const board={week:6,supported:true,status:'ready',rows:Array.from({length:12},(_,i)=>({roster_id:i+1,points:100-i*10}))};
    const preview=Cup.scorePreview(cup,6,board);
    const read=window.buildLeagueOverviewCup({cup,week:6,rosterId:1,liveScores:preview.scores,name});
    assert.match(read.scoreText,/Your score 100.0 · Owner 4 70.0/);
    assert.match(read.detail,/As scores stand/);assert.equal(read.tone,'good');
    assert.equal(Object.keys(cup.weeks).length,0);
});

function chopFixture({week=9,alive=10,points=5}={}){
    const rosters=Array.from({length:18},(_,i)=>({roster_id:i+1,players:['p'+(i+1)],settings:i<alive?{}:{eliminated:i-alive+1}}));
    const league={league_id:'chop',season:2026,total_rosters:18,settings:{type:3,start_week:1,max_subs:0},roster_positions:['QB'],rosters};
    const rows=rosters.slice(0,alive).map(r=>({roster_id:r.roster_id,starters:r.players}));
    return {league,roster:rosters[0],board:{supported:true,status:'ready',week,rows},
        finishes:Object.fromEntries(rows.map((r,i)=>[String(r.roster_id),i===0?points:20+i])),
        playersData:Object.fromEntries(rows.map(r=>[r.players?.[0]||r.starters[0],{team:'KC'}])),games:[{home:'KC',away:'DAL',state:'in'}]};
}
const survival=args=>window.App.Chopped.survivalInsight(args);

test('personal Chop watch triggers only at the bottom or one/two places above it',()=>{
    let args=chopFixture(),read=survival(args);
    assert.equal(read.placesAbove,0);assert.equal(read.noMoves,true);assert.match(read.message,/Hopes and prayers/);
    assert.match(read.detail,/5.0 projected pts · Lowest of 10/);
    read=survival(chopFixture({points:22.5}));assert.equal(read.placesAbove,2);assert.match(read.detail,/2 places above/);
    assert.equal(survival(chopFixture({points:30})),null,'Comfortably clear teams do not get a danger joke');
    args.finishes['2']=5;read=survival(args);assert.match(read.title,/Tied/);
    for(const bad of [{...args.board,status:'stale'},{...args.board,error:'offline'},{...args.board,supported:false}])assert.equal(survival({...args,board:bad}),null);
    args.finishes['3']=null;assert.equal(survival(args),null,'An unknown rival forecast prevents a confident ordinal rank');
});

test('hopes and prayers requires verified locks, never just an empty bench or missing options',()=>{
    for(const change of [
        {games:[{home:'KC',away:'DAL',state:'pre'}]},
        {games:[]},
        {games:[{home:'KC',away:'DAL',state:'in',statusName:'STATUS_POSTPONED'}]},
        {playersData:{p1:{team:'UNKNOWN'}}},
    ]){const read=survival({...chopFixture(),...change});assert.equal(read.noMoves,false);assert.doesNotMatch(read.message,/Hopes and prayers/);assert.match(read.message,/remaining starters/);}
    const args=chopFixture();args.league.settings.max_subs=1;
    assert.equal(survival(args).noMoves,false,'Configured in-game substitutions remain an option');
    args.league.settings.max_subs=0;args.board.rows[0].starters=['0'];
    assert.equal(survival(args).noMoves,false,'An empty slot is not a locked lineup');
});

test('Chop humor distinguishes early risk, late heartbreak and official elimination',()=>{
    const early=chopFixture({week:2,alive:17}),late=chopFixture({week:16,alive:3});
    assert.doesNotMatch(survival(early).message,/next year|chopped|eliminated/,'A projection never writes the farewell speech');
    assert.match(survival(late).message,/trophy.*😢/);
    early.roster.settings.eliminated=2;
    const out=survival(early);assert.equal(out.status,'eliminated');assert.match(out.message,/Better luck next year/);
    late.roster.settings.eliminated=16;assert.match(survival(late).message,/good run.*😢/);
});
