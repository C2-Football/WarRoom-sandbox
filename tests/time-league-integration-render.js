#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.window = globalThis; global.App = {};
for (const module of ['roster','rules','draft-room','era-rules','season','helmet','engine','ai','ui','gamecast']) require('../js/shared/time-league-' + module + '.js');
let state=[],refs=[],effects=[],stateIndex=0,refIndex=0;
global.React={createElement:(type,props,...children)=>({type,props,children}),Fragment:'fragment',useState:value=>{const i=stateIndex++;if(!(i in state))state[i]=typeof value==='function'?value():value;return[state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},useRef:value=>{const i=refIndex++;refs[i]??={current:value};return refs[i];},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:fn=>effects.push(fn)};
const reset=()=>{state=[];refs=[];effects=[];};
const render=fn=>{stateIndex=0;refIndex=0;effects=[];return fn();};
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.children)];
const text=node=>JSON.stringify(node);
const button=(tree,label)=>walk(tree).find(node=>node.type==='button'&&text(node.children).includes(label));
require('../js/components/time-league-week-gates.js');
require('../js/components/time-league-gamecast-panel.js');
for (const name of ['Setup','Draft','Home','Team']) window['WrTimeLeague'+name+'Panel']=()=>null;
App.TimeLeaguePlayerCards={};
require('../js/tabs/time-league.js');
let league=App.TimeLeagueEngine.createTimeLeague({name:'Integration',seed:'render',createdAt:'2026-01-01T00:00:00Z',settings:{rosterSlots:{QB:1},regularSeasonWeeks:12,playoffTeams:4,scoring:{passTd:4,reception:.5,rushRecYd:.1,passingYd:.04,turnover:-2}},seats:Array.from({length:4},(_,i)=>({name:'Team '+i,manager:'human'}))});
const cards=new Map([['example',{}]]);
function rootFor(phase,tab,online){reset();state[1]={...league,phase,weekStage:'claims'};state[4]=tab;state[6]=cards;state[7]=new Map();state[11]=online;return render(()=>TimeLeague({onClose:()=>{}}));}
assert(walk(rootFor('draft','draft',null)).some(node=>node.type===WrTimeLeagueDraftPanel));
assert(walk(rootFor('season','home',null)).some(node=>node.type===WrTimeLeagueHomePanel));
assert(!text(rootFor('season','home',null)).includes('COMMAND CENTRAL'));
assert(walk(rootFor('season','home',{role:'commissioner',seatTeamId:league.teams[0].teamId,draftStarted:true})).some(node=>node.type===WrTimeLeagueWeekGates));
league={...league,phase:'season',weekStage:'claims',settings:{...league.settings,advancementMode:'majority'}};
let called;
function gates(meta){return render(()=>WrTimeLeagueWeekGates({league,onlineMeta:meta,saving:false,dataReady:true,onAction:a=>{called=a;},onNavigate:()=>{}}));}
reset();let tree=gates({role:'member',seatTeamId:league.teams[0].teamId});
button(tree,'Vote to advance').props.onClick();assert.equal(called.type,'vote-advance');assert(!button(tree,'Commissioner override'));
reset();tree=gates({role:'commissioner',seatTeamId:league.teams[0].teamId});
walk(tree).find(node=>node.props?.['aria-label']==='Week options').props.onClick();tree=gates({role:'commissioner'});assert(button(tree,'Commissioner override'));
// Incoming offers are reachable from the user's roster, without opening More.
const withOffer = { ...league, settings: { ...league.settings, tradesEnabled: true }, trades: [{ tradeId: 'tr1', fromTeamId: league.teams[1].teamId, toTeamId: league.teams[0].teamId, status: 'pending' }] };
reset(); tree = render(() => WrTimeLeagueWeekGates({ league: withOffer, teamId: league.teams[0].teamId, currentTab: 'roster', dataReady: true, onNavigate: tab => { called = tab; } }));
button(tree, '1 trade offer').props.onClick(); assert.equal(called, 'trades');
reset(); tree = render(() => WrTimeLeagueWeekGates({ league: withOffer, teamId: league.teams[1].teamId, currentTab: 'roster', dataReady: true, onNavigate() {} }));
assert(!button(tree, '1 trade offer'), 'The inbox count belongs only to the active manager');
league={...league,settings:{...league.settings,advancementMode:'timed'}};reset();tree=gates({role:'commissioner'});assert(text(tree).includes('Deadline:'));walk(tree).find(node=>node.props?.['aria-label']==='Week options').props.onClick();tree=gates({role:'commissioner'});assert(text(tree).includes('Time per stage'));
const week={week:1,headlines:[],results:league.teams.map(team=>({teamId:team.teamId,total:0,starters:[],bench:[]})),matchups:[{home:league.teams[0].teamId,away:league.teams[1].teamId,homePoints:0,awayPoints:0,winner:null}]};
league={...league,currentWeek:2,weekStage:'postgame',finalizedWeeks:[week]};
// Ending a week is only offered on the recap; shared rooms retain their advancement rules.
const recapGate = extra => render(() => WrTimeLeagueWeekGates({ league, currentTab: 'home', dataReady: true, onAction: action => { called = action; }, onNavigate: tab => { called = tab; }, ...extra }));
reset(); tree = recapGate({}); button(tree, 'End week').props.onClick(); assert.equal(called.type, 'advance-week');
reset(); tree = recapGate({ currentTab: 'waivers' }); assert(!button(tree, 'End week')); button(tree, 'Week recap').props.onClick(); assert.equal(called, 'home');
reset(); tree = recapGate({ onlineMeta: { role: 'member', seatTeamId: league.teams[0].teamId } }); assert(button(tree, 'Waiting for commissioner').props.disabled);
reset(); tree = recapGate({ league: { ...league, settings: { ...league.settings, advancementMode: 'majority' } }, onlineMeta: { role: 'member', seatTeamId: league.teams[0].teamId } });
button(tree, 'Vote to end week').props.onClick(); assert.equal(called.type, 'vote-advance');
reset(); tree = recapGate({ saving: true }); assert(button(tree, 'Saving…').props.disabled);
reset(); tree = recapGate({ saveError: true, onRetrySave: () => { called = 'retry'; } });
assert(!button(tree, 'Saving…'), 'A failed save is never presented as an in-flight save');
assert(!button(tree, 'Retry save').props.disabled, 'The failed-save dock provides an available recovery action');
button(tree, 'Retry save').props.onClick(); assert.equal(called, 'retry');
assert(text(tree).includes('Save needs attention'));
reset(); tree = recapGate({ saveError: true, saveConflict: true, onRetrySave: () => { called = 'load-latest'; } });
assert(!button(tree, 'Retry save'), 'Conflicts offer reload instead of replaying the stale move');
button(tree, 'Load latest save').props.onClick(); assert.equal(called, 'load-latest');
// Planning still advances through the same authoritative action when optional
// mechanics are off; the controls must lead to the enabled decision screen.
const quietLeague = { ...league, weekStage: 'claims', settings: { ...league.settings, waiversEnabled: false, tradesEnabled: false } };
const quietGate = currentTab => render(() => WrTimeLeagueWeekGates({ league: quietLeague, currentTab, dataReady: true, onAction: action => { called = action; }, onNavigate: tab => { called = tab; } }));
reset(); tree = quietGate('home'); button(tree, 'Review team').props.onClick(); assert.equal(called, 'roster');
assert(!button(tree, 'Trades') && !button(tree, 'Waiver bids') && !button(tree, 'Run waivers'));
reset(); tree = quietGate('roster'); button(tree, 'Continue to lineup').props.onClick(); assert.equal(called.type, 'process-claims');
assert(text(tree).includes('1 OF 4'), 'The adapted stage retains its real progression index');
reset();const cast=()=>render(()=>WrTimeLeagueGamecastPanel({league,cards,logIndex:new Map(),onUpdate:()=>{},autoPlayWeek:1}));cast();effects[0]();tree=cast();assert.equal(state[2],true);assert.equal(state[3],300);assert(state[0].live);assert.equal(state[0].weekData.week,1);
state[1]=35;effects[0]();assert.equal(state[1],35,'Autoplay must not rewind same week on rerender');
reset(); cast(); effects[0](); tree=cast();
const savedLeague=JSON.stringify(league);
button(tree,'1 MIN').props.onClick(); tree=cast(); assert.equal(state[3],60);
for (const boundary of [15,30,45,60]) {
    button(tree,'NEXT QUARTER').props.onClick(); tree=cast();
    assert.equal(state[1],boundary); assert.equal(state[2],false,'Quarter stepping pauses at the break');
    const hero=walk(tree).find(node=>typeof node.type==='function' && node.type.name==='HeroMatchup');
    assert.equal(hero.props.quarterScore.props.clock,boundary,'The retained quarter table uses the same committed playback clock');
    assert(!text(tree).includes('Scoring moments & quarter recap'),'The removed feed disclosure cannot remain in the game day view');
}
assert(!button(tree,'NEXT QUARTER'),'Finished playback replaces running controls with final actions');
assert(button(tree,'REPLAY FROM START') && button(tree,'CLOSE GAMECAST'));
assert(!walk(tree).some(node=>node.props?.className==='tl-cast-controls') && !walk(tree).some(node=>node.props?.className==='tl-cast-pace'),'Final controls do not retain playback pace or disabled time controls');
assert.equal(JSON.stringify(league),savedLeague,'Playback controls never mutate the saved result');
button(tree,'REPLAY FROM START').props.onClick(); tree=cast(); assert.equal(state[1],0);
button(tree,'RESUME').props.onClick(); tree=cast();
let callback,stamp=performance.now();
window.requestAnimationFrame=fn=>{callback=fn;return 1;}; window.cancelAnimationFrame=()=>{};
effects[1]();
for(let i=0;i<151;i++){stamp+=100;callback(stamp);}
assert(state[1]>=14.9&&state[1]<=15.2,'One-minute mode spends about 15 seconds on each quarter');
tree=cast(); button(tree,'PAUSE').props.onClick(); tree=cast(); assert.equal(state[2],false);
// A saved final reopened without playback must not look ready for kickoff.
const finalWeek={...week,week:14,matchups:week.matchups.map(match=>({...match,homePoints:42,awayPoints:36,winner:match.home}))};
const completedLeague={...league,phase:'complete',currentWeek:14,finalizedWeeks:[finalWeek],championTeamId:league.teams[0].teamId};
const staticCast=current=>render(()=>WrTimeLeagueGamecastPanel({league:current,cards,logIndex:new Map(),onUpdate(){}}));
const heroOf=page=>walk(page).find(node=>node.type?.name==='HeroMatchup');
for (const phase of ['season','complete']) {
    reset();const page=staticCast({...completedLeague,phase});const hero=heroOf(page);
    assert.equal(hero.props.clockLabel,'FINAL');assert.equal(hero.props.statusLabel,'FINAL');
    assert(text(hero.props.spotlight).includes('FINAL · WEEK 14') && text(hero.props.spotlight).includes('Week Archive'));
    assert(!text(page).includes('READY FOR KICKOFF') && !text(page).includes('scores and win estimate update'));
    assert(!text(hero.type(hero.props)).includes('Illustrative estimate'), 'Final results do not carry a live prediction disclaimer');
}
button(staticCast(completedLeague),'REPLAY').props.onClick();
tree=staticCast(completedLeague);
assert.equal(heroOf(tree).props.statusLabel,'SIMULATION');
assert.equal(heroOf(tree).props.clockLabel,'Q1 · 15:00');
assert(text(heroOf(tree).props.spotlight).includes('READY FOR KICKOFF'), 'Explicit replay still begins with the kickoff presentation');
reset();tree=staticCast({...league,phase:'season',weekStage:'ready',currentWeek:1,finalizedWeeks:[]});
assert(text(heroOf(tree).props.spotlight).includes('READY FOR KICKOFF'), 'An unplayed matchup keeps its pregame copy');
console.log('PASS: root draft/home renders, weekly gate role/mode controls, postgame autoplay and replay deduplication');

// Phone disclosure moves secondary analysis, retaining the saved score and full lineups.
window.WR = { useViewport: () => ({ isPhone: true }) };
reset(); tree = staticCast(completedLeague);
const beforePhoneRead = JSON.stringify(completedLeague);
const phoneHero = heroOf(tree);
assert.equal(phoneHero.props.row.homePoints, 42);
assert.equal(phoneHero.props.row.awayPoints, 36);
const phoneHeroTree = phoneHero.type(phoneHero.props);
const analysis = walk(phoneHeroTree).find(node => node.type === 'details');
assert(analysis && !analysis.props.open);
assert(text(analysis).includes('FINAL RESULT'));
assert(text(analysis).includes('Week Archive'));
const phoneChildren = tree.children.filter(Boolean);
const phonePrimary = phoneChildren.find(node => node.props?.className === 'tl-gameday-primary');
const phonePrimaryChildren = phonePrimary.children.filter(Boolean);
const phoneScoreRail = phonePrimaryChildren.find(node => node.props?.className === 'tl-gameday-score-rail');
assert.equal(phoneScoreRail.children.filter(Boolean)[0].type.name, 'HeroMatchup', 'The phone hero still leads inside the primary score rail');
assert(phonePrimaryChildren.findIndex(node => node.type?.name === 'LiveLineups') > phonePrimaryChildren.indexOf(phoneScoreRail), 'The complete starting lineups follow the score rail');
assert(phoneChildren.indexOf(phonePrimary) < phoneChildren.findIndex(node => node.type === 'details'), 'Primary score and lineups precede secondary matchup details');
assert(phoneChildren.indexOf(phonePrimary) < phoneChildren.findIndex(node => node.props?.className === 'tl-card tl-gamecast-archive'), 'The saved week archive remains after the primary matchup');
assert(text(phoneScoreRail).includes('Fantasy points use recorded historical games'), 'Score provenance stays in the primary view');
const upcomingPhone = heroOf(staticCast({ ...league, phase: 'season', weekStage: 'ready', currentWeek: 1, finalizedWeeks: [] }));
const upcomingDetails = walk(upcomingPhone.type(upcomingPhone.props)).find(node => node.type === 'details');
assert(text(upcomingDetails).includes('not a calibrated prediction'));
assert.equal(JSON.stringify(completedLeague), beforePhoneRead, 'Reading phone details leaves the fixture unchanged');
console.log('PASS: phone matchup leads; optional analysis retains score provenance and forecast disclaimer');
