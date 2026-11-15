'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), Babel = require('@babel/standalone');
const { test } = require('node:test');
const source = fs.readFileSync('js/tabs/league-central.js', 'utf8');
const detailSource = fs.readFileSync('js/league-detail.js', 'utf8');
function fixture() {
    const hooks = [], effects = [], events = [];
    let cursor = 0, week = 6;
    const React = { createElement: (type, props, ...children) => ({type, props: props || {}, children}),
        useState(initial) {const i=cursor++; if (!(i in hooks)) hooks[i]=initial; return [hooks[i],value=>hooks[i]=typeof value==='function'?value(hooks[i]):value];}, useEffect(fn){effects.push(fn);} };
    const window = { App: { LeagueLiveScores:{currentWeek:()=>week}, NFLByes:{weekForPlayer:p=>p.testBye}, NflContext:{} }, S:{nflState:{season:2026}}, dispatchEvent:event=>events.push(event) };
    const context = vm.createContext({window,React,console,document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}, setInterval:()=>1,clearInterval(){}, CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
    vm.runInContext(Babel.transform(source,{presets:['react']}).code,context);
    const league = {league_id:'l1',season:2026,roster_positions:['QB','WR','FLEX','BN','IR']};
    const players = {a:{full_name:'Healthy Starter',position:'QB',team:'KC'}, b:{full_name:'Bye Receiver',position:'WR',team:'BUF',testBye:6}, c:{full_name:'Listed Out',position:'RB',team:'NYJ',injury_status:'Out'}};
    const props={currentLeague:league,myRoster:{roster_id:1,starters:['a','b','c']},playersData:players,setActiveTab:tab=>events.push(tab)};
    return {window,events,effects,hooks,props,setWeek:value=>week=value,read:extra=>window.buildLeagueOverviewDecision({league,roster:props.myRoster,playersData:players,week:6,now:Date.parse('2026-10-07T12:00:00Z'),...extra}),render(){cursor=0;effects.length=0;return window.LeagueOverviewDecisions(props);}};
}
const walk = node => node && typeof node==='object' ? [node,...(node.children||[]).flat(Infinity).flatMap(walk)] : [];
const text = node => node == null || typeof node==='boolean' ? '' : typeof node==='object' ? (node.children||[]).flat(Infinity).map(text).join('') : String(node);
const button=(tree,name)=>walk(tree).find(n=>n.type==='button'&&text(n)===name);

test('overview spots loaded empty, bye and unavailable starters without treating unknown players as unsigned',()=>{
    const h=fixture(); let read=h.read(); assert.deepEqual(Array.from(read.flags,f=>f.kind),['bye','out']);
    read=h.read({roster:{starters:['unknown','0']}}); assert.equal(read.flags.length,2); assert(read.flags.every(f=>f.kind==='empty'));
    read=h.read({roster:{players:['a']}}); assert.equal(read.known,false); assert.equal(read.flags.length,0);
    read=h.read({roster:{starters:['a','b','c']},week:7}); assert.deepEqual(Array.from(read.flags,f=>f.kind),['out']);
});

test('scheduled next kickoff requires a future timestamp and excludes postponed and cancelled games',()=>{
    const h=fixture(), game={home:'KC',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'};
    const read=h.read({games:[{...game,statusName:'STATUS_POSTPONED',kickoff:'2026-10-08T10:00:00Z'}, {...game,kickoff:'2026-10-06T12:00:00Z'},game]});
    assert.equal(read.next.kickoff,game.kickoff); assert.equal(read.startersInNext,1);
    assert.equal(h.read({games:[{...game,statusName:'STATUS_CANCELED'}]}).next,null);
    assert.equal(h.read({games:[{...game,kickoff:'bad'}]}).next,null);
});

test('overview prioritizes the next kickoff involving your starters while retaining the NFL schedule fact',()=>{
    const h=fixture(); h.props.myRoster={starters:['a']};
    const earlier={home:'DAL',away:'PHI',state:'pre',kickoff:'2026-10-08T18:00:00Z'};
    const personal={home:'KC',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'};
    const read=h.read({roster:h.props.myRoster,games:[personal,earlier]});
    assert.equal(read.next.kickoff,earlier.kickoff,'The league-wide next kickoff remains available');
    assert.equal(read.nextStarterGame.kickoff,personal.kickoff);
    assert.equal(read.startersInNext,0); assert.equal(read.startersInNextStarterGame,1);
    h.render(); h.hooks[0]={key:'l1|2026|6',status:'ready',games:[earlier,personal],now:Date.parse('2026-10-07T12:00:00Z')};
    let tree=h.render(); assert.match(text(tree),/Your next kickoff/); assert.match(text(tree),/1 starter/);
    button(tree,'Ask Alex').props.onClick();
    assert.match(h.events[0].detail.prompt, /"kickoff":"2026-10-08T20:00:00Z"/);
    assert.match(h.events[0].detail.prompt, /"scope":"your starters"/);
    h.hooks[0]={...h.hooks[0],games:[earlier]}; tree=h.render();
    assert.match(text(tree),/Next NFL kickoff/); assert.doesNotMatch(text(tree),/Your next kickoff/);
    assert.equal(h.read({roster:{starters:['unknown']},games:[{state:'pre',kickoff:personal.kickoff}]}).startersInNext,0,'Missing NFL teams never count as participating starters');
});

test('unavailable starters stop being replacement advice once their game starts',()=>{
    const h=fixture(), upcoming={home:'NYJ',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'};
    const onlyOut={starters:['c']};
    assert.equal(h.read({roster:onlyOut,games:[upcoming]}).flags[0].kind,'out');
    for (const game of [{...upcoming,completed:true}, {...upcoming,state:'in'}, {...upcoming,kickoff:'2026-10-06T20:00:00Z'}]) {
        const read=h.read({roster:onlyOut,games:[game]});
        assert.equal(read.flags.length,0); assert.equal(read.lockedFlags[0].kind,'out');
    }
    assert.equal(h.read({games:[{...upcoming,completed:true}]}).flags.length,0,'Completed week cannot recommend a bye replacement');
    assert.equal(h.read({roster:onlyOut,games:[{...upcoming,statusName:'STATUS_POSTPONED',kickoff:'2026-10-06T20:00:00Z'}]}).lockedFlags.length,0,'Postponed kickoff is not a game lock');
    const alias=h.read({roster:onlyOut,playersData:{c:{...h.props.playersData.c,team:'WSH'}},games:[{...upcoming,home:'WAS',state:'in'}]});
    assert.equal(alias.flags.length,0,'Canonical NFL team aliases preserve locks');
    h.props.myRoster=onlyOut; h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{...upcoming,completed:true}],now:Date.parse('2026-10-09T12:00:00Z')};
    const tree=h.render(); assert.doesNotMatch(text(tree),/Replace Listed Out|Check availability for Listed Out/);
    button(tree,'Ask Alex').props.onClick();
    assert.match(h.events[0].detail.prompt,/lockedStarterChecks/); assert.match(h.events[0].detail.prompt,/Do not recommend replacing players/);
});

test('questionable is a monitoring flag and automatic lineup leagues get a clear roster action',()=>{
    const h=fixture(); const players={a:{full_name:'Questionable QB',team:'KC',injury_status:'Questionable'}};
    assert.equal(h.read({roster:{starters:['a']},playersData:players}).flags[0].kind,'monitor');
    h.props.leagueSkin={type:'best_ball'}; const tree=h.render(); assert.match(text(tree),/sets the scoring lineup automatically/);
    assert(!button(tree,'Game Day →')); button(tree,'Roster →').props.onClick(); assert.equal(h.events[0],'myteam');
});

test('overview names one primary lineup move and keeps waivers and Alex within reach',()=>{
    const h=fixture(); h.render(); h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'NYJ',state:'pre',kickoff:'2099-10-08T20:00:00Z'}],now:Date.now()}; const tree=h.render();
    assert.match(text(tree),/Alex Insights/); assert.match(text(tree),/Replace Bye Receiver\./); assert.match(text(tree),/Bye this week\./); assert.match(text(tree),/\+1 more lineup issue/);
    const primary=walk(tree).find(n=>n.props?.className==='mc-primary-move');
    assert.equal(text(walk(primary).find(n=>n.type==='h3')),'Replace Bye Receiver.','Headline states the action without repeating its explanation');
    assert.equal(text(walk(primary).find(n=>n.type==='p')),'Bye this week.','Decision evidence stays beside the action');
    button(tree,'Game Day →').props.onClick(); button(tree,'Explore waivers').props.onClick(); button(tree,'Ask Alex').props.onClick();
    assert.equal(h.events[0],'lineup'); assert.equal(h.events[1],'fa'); assert.equal(h.events[2].type,'wr:mission-alex-open');
    assert.match(h.events[2].detail.prompt,/"week":6/); assert.match(h.events[2].detail.prompt,/"kind":"bye"/); assert.match(h.events[2].detail.prompt,/no move has been submitted/);
    assert.equal(walk(tree).some(n=>n.type==='details'),false);
});

test('an empty starter has a clear short action without duplicated slot wording',()=>{
    const h=fixture(); h.props.myRoster={starters:['0','b','c']}; h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'NYJ',state:'pre',kickoff:'2099-10-08T20:00:00Z'}],now:Date.now()};
    const tree=h.render();
    assert.match(text(tree),/Fill your QB slot\./); assert.doesNotMatch(text(tree),/slot slot/);
    assert.match(text(tree),/Your starting lineup has an open spot\./);
});

test('live overview switches from lineup preparation to the personal week outlook',()=>{
    const h=fixture(); h.props.myRoster={starters:['a']}; h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'NYJ',state:'live'}],now:Date.now()};
    const tree=h.render();
    assert.match(text(tree),/Live week/);
    assert.doesNotMatch(text(tree),/matchup forecast|Game Day →/);
    assert.doesNotMatch(text(tree),/Replace|Explore waivers|Your next kickoff/);
});

test('loading or unavailable kickoff data never surfaces stale replacement advice',()=>{
    const h=fixture(); h.props.myRoster={starters:['c']};
    assert.doesNotMatch(text(h.render()),/Listed Out|listed unavailable|Replace/);
    h.hooks[0]={key:'l1|2026|6',status:'unavailable',games:[],now:Date.now()};
    assert.doesNotMatch(text(h.render()),/Listed Out|listed unavailable|Replace/);
    button(h.render(),'Ask Alex').props.onClick();
    assert.match(h.events[0].detail.prompt,/"starterChecks":\[\]/); assert.match(h.events[0].detail.prompt,/unverifiedStarterChecks/);
});

test('missing lineup and schedule data never claim lineup readiness or an invented deadline',()=>{
    const h=fixture(); h.props.myRoster=null; let tree=h.render(); assert.match(text(tree),/Starter details have not loaded/i);
    h.effects[0](); tree=h.render(); assert.match(text(tree),/Kickoff times unavailable/);
    assert.doesNotMatch(text(tree),/Wednesday|Thursday|ready to go|all set|waivers close/i);
});

test('schedule load uses current week and suppresses a late result after leaving the page',async()=>{
    const h=fixture(); let resolve, args;
    h.window.App.NflContext.loadScoreboard=(...a)=>{args=a;return new Promise(r=>resolve=r);};
    h.render(); const cleanup=h.effects[0](); assert.deepEqual(args,[6,2026,2]);
    cleanup(); resolve([{home:'KC',away:'LV',state:'pre',kickoff:'2026-10-08T20:00:00Z'}]); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.hooks[0].key,'','Late schedule does not update an unmounted page');
});

test('the proactive section is rendered above full scoreboard and outside dashboard disclosure',()=>{
    const start=source.indexOf('if (overview && isPhone) return');
    const end=source.indexOf('\n    return (',start);
    const overview=source.slice(start,end);
    assert(overview.indexOf('<LeagueOverviewDecisions')<overview.indexOf('mc-overview-summary'));
    assert(overview.indexOf('<LeagueOverviewDecisions')<overview.indexOf('{renderScoreboard()}'));
    assert(!overview.includes('<details'));
});

test('Overview restores the original mobile surface and Lenses has an explicit separate route',()=>{
    assert.match(detailSource, /showLeagueOverview = alexPhone && isCurrentYear && leagueSkin\?\.phase === 'in_season'/);
    assert.match(detailSource, /viewTab === 'lenses' \? dashboardEl\(selectedWidgets\) : showLeagueOverview \?/);
    const start = detailSource.indexOf(' : showLeagueOverview ?');
    const end = detailSource.indexOf(' : dashboardEl(overviewWidgets, true)', start);
    assert(start >= 0 && end > start);
    assert.match(detailSource.slice(start, end), /LeagueCentralTabLazy.*overview=\{true\}/);
    const canvasSource = fs.readFileSync('js/tabs/dashboard.js', 'utf8');
    assert.match(canvasSource, /if \(props.overview\) return <DashboardCanvas/);
    assert.match(canvasSource, /window\.WR\.DashboardLenses/);
    assert.doesNotMatch(canvasSource, /Customize Home|WrDashReorder|Remove widget/);
});

test('Alex flags finished-game deviations and streaks for the manager’s current roster', async () => {
    const h = fixture();
    const player = (full_name, team = 'KC') => ({ full_name, team });
    h.props.playersData = {
        hot: player('Hot Receiver'), cold: player('Cold Runner'), steadyCold: player('Steady Cold'),
        dnp: player('Did Not Play'), live: player('Still Playing', 'BUF'), newcomer: player('New Starter'),
        opponent: player('Opponent Standout'), dropped: player('Former Player'), ordinary: player('Ordinary Game'),
    };
    h.props.myRoster = { roster_id: '1', starters: ['hot', 'steadyCold'], players: ['hot', 'cold', 'dnp', 'steadyCold', 'live', 'newcomer', 'ordinary'] };
    h.props.scoreBoard = { supported: true, status: 'ready', week: 6, rows: [
        { roster_id: 1, players_points: { hot: 27, cold: 0, dnp: 0, steadyCold: 9, live: 35, newcomer: 35, dropped: 60, ordinary: 11 } },
        { roster_id: 2, players_points: { hot: 47, opponent: 55 } },
    ] };
    const games = {
        hot: [5, 5, 10, 10, 10], cold: [30, 30, 10, 10, 10], steadyCold: [16, 16, 8, 8, 8],
        dnp: [30, 30, 10, 10, 10], live: [8, 8, 8], newcomer: [10, 10], opponent: [8, 8, 8], dropped: [9, 9, 9], ordinary: [10, 10, 10],
    };
    h.window.App.WeeklyProj = {
        weeklyPointsScope: () => 'l1-scoring',
        weeklyHistory: pid => [...games[pid].map((pts, i) => ({ week: i + 1, pts })), { week: 6, pts: 999 }],
    };
    h.window.App.SOS = { getWeekStats: async () => ({ cold: { off_snp: 25 }, dnp: { gp: 0 } }) };
    Object.assign(h.window.S, { weeklyPlayerPointsScope: 'l1-scoring', weeklyPlayerPointsComplete: true, weeklyPlayerPointsThroughWeek: 5 });
    h.render();
    h.hooks[0] = { key: 'l1|2026|6', status: 'ready', games: [{ home: 'KC', away: 'LV', completed: true }, { home: 'BUF', away: 'NYJ', state: 'in' }], now: Date.now() };
    assert.doesNotMatch(text(h.render()), /Cold Runner/, 'An unverified zero stays out');
    const dispose = h.effects[2]();
    await new Promise(setImmediate);
    const tree = h.render();
    const standouts = walk(tree).find(n => n.props?.className === 'mc-overview-form');
    assert.equal(walk(standouts).filter(n => n.type === 'li').length, 5);
    assert.match(text(standouts), /New Starter/);
    assert.match(text(standouts), /Ordinary Game/);
    assert.match(text(standouts), /2 more player results/);
    assert.match(text(standouts), /Hot Receiver27.08.0\+19.0/);
    assert.match(text(standouts), /Cold Runner0.018.0−18.0/);
    assert.match(text(standouts), /Steady Cold.*−2.2/, 'A sustained streak can qualify without a big single-game swing');
    assert.doesNotMatch(text(standouts), /prior games|straight|Bench|Starter ·/);
    assert(walk(standouts).some(n => n.props?.['aria-label'] === 'Cold Runner, bench'), 'Bench players remain identified accessibly');
    assert.doesNotMatch(text(standouts), /Did Not Play|Still Playing|Opponent Standout|Former Player/);
    button(tree, 'Ask Alex').props.onClick();
    assert.match(h.events[0].detail.prompt, /"finishedPlayerForm":.*"pid":"hot"/);
    assert.doesNotMatch(h.events[0].detail.prompt, /"pid":"(?:opponent|dropped)"/);
    const roster = h.props.myRoster;
    h.props.myRoster = null;
    assert.doesNotMatch(text(h.render()), /standouts|Opponent Standout/, 'No roster means no personal insights');
    h.props.myRoster = { ...roster, roster_id: 3 };
    assert.doesNotMatch(text(h.render()), /standouts|Opponent Standout/, 'Another row cannot stand in for missing personal scores');
    h.props.myRoster = roster;
    h.props.scoreBoard.status = 'stale';
    assert.doesNotMatch(text(h.render()), /Hot Receiver/);
    h.props.scoreBoard.status = 'ready'; h.props.scoreBoard.week = 5;
    assert.doesNotMatch(text(h.render()), /Hot Receiver/, 'A historical scoreboard never produces current-week insights');
    h.props.scoreBoard.week = 6; h.window.S.weeklyPlayerPointsScope = 'other-scoring';
    assert.doesNotMatch(text(h.render()), /Hot Receiver/, 'History from another scoring scope never leaks into the comparison');
    dispose();
});

test('live Alex panel renders the personal matchup, win/loss playoff impact and optional Cup together',()=>{
    const h=fixture();
    Object.assign(h.props.currentLeague.settings={}, {playoff_teams:4,playoff_week_start:15});
    h.props.myRoster={roster_id:1,players:['a'],starters:['a']};
    h.props.scoreBoard={supported:true,week:6,status:'ready',rows:[{roster_id:1,matchup_id:1,forecast:125},{roster_id:2,matchup_id:1,forecast:115}]};
    h.props.odds={status:'ready',sim:{leverage:{week:6,current:50,ifWin:72,ifLose:31}}};
    h.props.getOwnerName=()=> 'The opponent';
    h.window.App.LeagueLiveScores.projectedFinish=row=>row.forecast;
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    const tree=h.render();
    assert.doesNotMatch(text(tree),/You’re projected to win|125.0–115.0|Game Day →|matchup forecast/);
    assert.match(text(tree),/50% entering the week · 72% with a win · 31% with a loss/);
    assert.match(text(tree),/projected result points toward 72% playoff odds/);
    assert.doesNotMatch(text(tree),/Replace|Explore waivers|Your Cup outlook/);
    button(tree,'Ask Alex').props.onClick();assert.match(h.events[0].detail.prompt,/"playoff":\{"current":50/);
    h.props.leagueSkin={type:'chopped',features:{showPlayoffOdds:false}};
    assert.doesNotMatch(text(h.render()),/Playoff outlook|% with a win/);
    h.props.leagueSkin=null;h.props.scoreBoard.status='stale';
    assert.doesNotMatch(text(h.render()),/You’re projected to win|125.0/);
});

test('Cup load is read-only and discards a response after navigation',async()=>{
    const h=fixture();let resolve,request;
    h.window.App.OD={getClient:()=>({functions:{invoke:(name,args)=>{request={name,...args};return new Promise(r=>resolve=r);}}})};
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    h.render();const cleanup=h.effects[3]();
    assert.equal(request.name,'league-cup');assert.equal(request.body.action,'load');
    assert.equal(request.body.leagueId,'l1');assert.equal(request.body.season,'2026');
    cleanup();resolve({data:{cup:{state:{locked:true}}}});await new Promise(setImmediate);
    assert.equal(h.hooks[3].key,'','A late Cup response is not applied after navigation');
});

test('Cup discovery errors and explicit no-Cup leagues stay silent',async()=>{
    for (const response of [{error:{message:'No session'}}, {data:{cup:null}}, {data:{}},
        {data:{cup:{state:{version:2,locked:true,enabled:true,teams:{bad:'shape'}}}}},
        {data:{cup:{state:{locked:true,groups:{A:{bad:'shape'},B:[],C:[]}}}}}]) {
        const h=fixture();
        h.window.App.OD={getClient:()=>({functions:{invoke:async()=>response}})};
        h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
        h.render();const cleanup=h.effects[3]();await new Promise(setImmediate);
        assert.doesNotMatch(text(h.render()),/Cup outlook|League Cup/);
        assert.equal(h.hooks[3].cup,null,'Discovery never invents a Cup');
        button(h.render(),'Ask Alex').props.onClick();
        assert.doesNotMatch(h.events.at(-1).detail.prompt,/Cup outlook|Cup forecasts/,'Alex is not asked to discuss an unconfirmed Cup');
        cleanup();
    }
});

test('a confirmed personal Cup still renders and reaches Ask Alex',async()=>{
    const h=fixture(),Cup=require('../js/shared/woeppel-cup.js');
    h.props.currentLeague.rosters=Array.from({length:4},(_,i)=>({roster_id:i+1}));
    const cup=Cup.configure(h.props.currentLeague,'points');
    Object.assign(cup,{locked:true,enabled:true,name:'Our Cup'});
    h.window.WoeppelCup=Cup;
    h.window.App.OD={getClient:()=>({functions:{invoke:async()=>({data:{cup:{state:cup}}})}})};
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    h.render();const cleanup=h.effects[3]();await new Promise(setImmediate);
    const tree=h.render();assert.match(text(tree),/Our Cup/);
    button(tree,'Ask Alex').props.onClick();assert.match(h.events.at(-1).detail.prompt,/Cup outlook/);
    assert.match(h.events.at(-1).detail.prompt,/"cup":\{"title":"Our Cup"/);
    assert.match(h.events.at(-1).detail.prompt,/Cup forecasts are hypothetical/);
    cleanup();
});

test('a known Cup retains refresh status but a confirmed absence clears it',async()=>{
    const h=fixture();let response={data:{cup:{state:{version:2,teams:['1'],locked:true,enabled:true,name:'Our Cup'}}}};
    h.window.App.OD={getClient:()=>({functions:{invoke:async()=>response}})};
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    const refresh=async()=>{h.render();const cleanup=h.effects[3]();await new Promise(setImmediate);cleanup();return h.render();};
    await refresh();
    for (const failure of [{error:{message:'Offline'}},{data:{}},{data:{cup:{state:[]}}},
        {data:{cup:{state:{version:2,locked:true,enabled:true,teams:{bad:'shape'}}}}},
        {data:{cup:{state:{locked:true,enabled:true,groups:{A:{bad:'shape'},B:[],C:[]}}}}},
        {data:{cup:{state:{locked:true,groups:['1','2']}}}},
        {data:{cup:{state:{locked:true,groups:{A:['1']}}}}}]) {
        response=failure;
        assert.match(text(await refresh()),/Cup outlook could not refresh/);
        assert.equal(h.hooks[3].cup.name,'Our Cup','Failed or malformed responses retain the known Cup');
    }
    response={data:{cup:null}};
    assert.doesNotMatch(text(await refresh()),/Cup outlook/);
    response={error:{message:'Offline'}};
    assert.doesNotMatch(text(await refresh()),/Cup outlook/,'A no-Cup league stays silent on subsequent outages');
});

test('malformed Cup participants cannot crash a mounted overview before engine validation',()=>{
    const h=fixture();h.window.WoeppelCup=require('../js/shared/woeppel-cup.js');h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    for (const cup of [
        {version:2,locked:true,enabled:true,teams:{bad:'shape'}},
        {locked:true,enabled:true,groups:{A:{bad:'shape'},B:[],C:[]}},
        {locked:true,enabled:true,groups:['1','2']},
        {version:2,locked:true,enabled:true,teams:[null]},
    ]) {
        h.hooks[3]={key:'l1|2026',status:'ready',cup};
        assert.doesNotThrow(()=>h.render());
        assert.doesNotMatch(text(h.render()),/Cup outlook|League Cup/);
        button(h.render(),'Ask Alex').props.onClick();
        assert.doesNotMatch(h.events.at(-1).detail.prompt,/Cup outlook|Cup forecasts/);
    }
});

test('Cup status is scoped to the active league and season before effects run',async()=>{
    const h=fixture();h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    h.hooks[3]={key:'l1|2026',status:'unavailable',cup:{version:2,teams:['1'],locked:true,enabled:true,name:'Old Cup'}};
    assert.match(text(h.render()),/Cup outlook could not refresh/);
    h.props.currentLeague={...h.props.currentLeague,league_id:'l2'};
    h.hooks[0]={...h.hooks[0],key:'l2|2026|6'};
    assert.doesNotMatch(text(h.render()),/Cup outlook/,'Prior league errors do not flash while the new league loads');
    h.props.currentLeague={...h.props.currentLeague,league_id:'l1',season:2025};
    h.window.S.nflState.season=2025;h.hooks[0]={...h.hooks[0],key:'l1|2025|6'};
    assert.doesNotMatch(text(h.render()),/Cup outlook/,'Prior season errors do not flash either');
});

test('Cup errors are hidden when its tournament is a draft, paused or the topic is disabled',()=>{
    const h=fixture();h.render();
    h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    for (const cup of [{version:2,teams:['1'],locked:false},{version:2,teams:['1'],locked:true,enabled:false},{version:2,teams:['2'],locked:true,enabled:true},{groups:{A:['2']},locked:true,enabled:true}]) {
        h.hooks[3]={key:'l1|2026',status:'unavailable',cup};
        assert.doesNotMatch(text(h.render()),/Cup outlook/);
    }
    h.window.WR={AlexSettings:{isTopicEnabled:topic=>topic!=='cups'}};
    h.hooks[3]={key:'l1|2026',status:'unavailable',cup:{version:2,teams:['1'],locked:true,enabled:true}};
    let requests=0;
    h.window.App.OD={getClient:()=>({functions:{invoke:async()=>{requests++;return {data:{cup:null}};}}})};
    assert.doesNotMatch(text(h.render()),/Cup outlook/);
    h.effects[3]();assert.equal(requests,0,'Disabled Cup topics do not poll');
});

test('global Alex topics filter live content and Ask Alex evidence together',()=>{
    const h=fixture();let disabled=new Set();
    h.window.WR={AlexSettings:{isTopicEnabled:topic=>!disabled.has(topic)}};
    h.props.currentLeague.settings={playoff_teams:4,playoff_week_start:15};
    h.props.myRoster={roster_id:1,players:['a'],starters:['a']};
    h.props.scoreBoard={supported:true,week:6,status:'ready',rows:[{roster_id:1,matchup_id:1,forecast:125,players_points:{a:30}},{roster_id:2,matchup_id:1,forecast:115}]};
    h.props.odds={status:'ready',sim:{leverage:{week:6,current:50,ifWin:72,ifLose:31}}};
    h.window.App.LeagueLiveScores.projectedFinish=row=>row.forecast;
    h.window.App.WeeklyProj={weeklyPointsScope:()=> 'l1-scoring',weeklyHistory:()=>[{week:1,pts:10},{week:2,pts:10},{week:3,pts:10}]};
    Object.assign(h.window.S,{weeklyPlayerPointsScope:'l1-scoring',weeklyPlayerPointsComplete:true,weeklyPlayerPointsThroughWeek:5});
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    let tree=h.render();assert.match(text(tree),/Healthy Starter/);assert.match(text(tree),/Playoff outlook/);
    disabled=new Set(['performance','leagueOutlook']);tree=h.render();
    assert.doesNotMatch(text(tree),/Healthy Starter|Playoff outlook|League outlook/);
    button(tree,'Ask Alex').props.onClick();
    assert.doesNotMatch(h.events.at(-1).detail.prompt,/finishedPlayerForm|finished-player performance|"matchup"|"playoff"|"survival"|league outlook/);
    h.props.leagueSkin={type:'chopped'};h.window.App.Chopped={survivalInsight:()=>({title:'Chop danger',detail:'Risky',message:'Caption'})};
    tree=h.render();assert.doesNotMatch(text(tree),/Chop danger/);
    button(tree,'Ask Alex').props.onClick();assert.doesNotMatch(h.events.at(-1).detail.prompt,/Chop danger|"survival"/);
});

test('global lineup and waiver topics remove pregame advice and its prompt evidence',()=>{
    const h=fixture();h.window.WR={AlexSettings:{isTopicEnabled:topic=>!['startSit','waivers'].includes(topic)}};
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'NYJ',state:'pre',kickoff:'2099-10-08T20:00:00Z'}],now:Date.now()};
    const tree=h.render();assert.doesNotMatch(text(tree),/Replace|Game Day|kickoff|Explore waivers/);
    button(tree,'Ask Alex').props.onClick();
    assert.doesNotMatch(h.events.at(-1).detail.prompt,/"lineup"|starterChecks|nextKickoff|rosterKnown/);
});

test('Alex Settings opens the shared settings route and saved preferences trigger updates',()=>{
    const h=fixture();let listener,unsubscribed=false,enabled=true;
    h.window.WR={AlexSettings:{isTopicEnabled:()=>enabled,subscribe:fn=>{listener=fn;return ()=>{unsubscribed=true;};}}};
    const tree=h.render();button(tree,'Settings').props.onClick();assert.equal(h.events[0],'gm-settings');
    const cleanup=h.effects[4]();const before=h.hooks[4];enabled=false;listener();
    assert.equal(h.hooks[4],before+1);
    assert.doesNotMatch(text(h.render()),/Game Day|Explore waivers/);
    button(h.render(),'Ask Alex').props.onClick();
    assert.match(h.events.at(-1).detail.prompt,/My proactive topics are off/);
    cleanup();assert.equal(unsubscribed,true);
});

test('a schedule outage after kickoff retains live-week mode and withholds the forecast',async()=>{
    const h=fixture();h.window.App.NflContext.loadScoreboard=async()=>{throw Error('offline');};
    h.render();h.hooks[0]={key:'l1|2026|6',status:'ready',games:[{home:'KC',away:'LV',completed:true}],now:Date.now()};
    h.render();const cleanup=h.effects[0]();await new Promise(setImmediate);
    const tree=h.render();assert.match(text(tree),/Live week/);assert.doesNotMatch(text(tree),/forecast|Game Day →/);
    assert.doesNotMatch(text(tree),/Replace|Explore waivers|You’re projected to win/);
    cleanup();
});
