'use strict';
const assert = require('node:assert/strict');
require('../js/shared/league-live-scores');
require('../js/shared/league-wire-journal');
require('../js/shared/league-wire-playoffs');
require('../js/shared/wire-hunt');
const odds = require('../js/shared/playoff-odds');
const api = global.WrWireHunt;
const league = {season:'2026', settings:{start_week:1, playoff_teams:2, playoff_week_start:5, playoff_seed_type:0}, rosters:[1,2,3,4].map(i => ({roster_id:i, owner_id:'o'+i}))};
const weeks = [1,2,3,4].map(week => ({week,rows:league.rosters.map((r,i) => ({...r, matchup_id:i<2?1:2, points:100+i+week}))}));
const ledger = api.ledger(league,weeks,3);
assert.deepEqual(ledger.rows.map(t => t.weekly.length),[3,3,3,3]);
assert.equal(api.ledger(league,weeks.slice(1),3),null);
const race = {rows:ledger.rows.map(r => ({id:r.rosterId})), throughWeek:3, remainingWeeks:1};
const futurePairs = {4:[[1,3],[2,4]]};
assert.ok(api.fullSchedule(futurePairs,race));
assert.equal(api.fullSchedule({4:[[1,2],[2,4]]},race),false);
assert.equal(api.fullSchedule({},race),false);
const result = odds.simulate({league,ledger,futurePairs,sims:500,weeklyExit:true});
for (const row of result.rows) {
    assert.ok(Math.abs(row.playoffPct+row.weeklyExitPct-100)<=1);
    if (row.firstOpponent) assert.notEqual(row.firstOpponent.id,row.rosterId);
}
const a={weekly:[{pts:10},{pts:20}]}, b={weekly:[{pts:10},{pts:10}]};
assert.equal(api.advantage(a,b),75);
assert.equal(api.advantage(b,a),25);
const older = {...league,season:'2025',rosters:league.rosters.map(r => ({...r,owner_id:r.roster_id===1?'old':r.owner_id}))};
const prior = api.history(league,3,[{league:older,weeks},{league,weeks}]);
assert.equal(prior.get('o1'),undefined);
assert.equal(prior.get('old').record,'0–3');
assert.equal(prior.get('old').status,'Eliminated');
assert.equal(prior.get('o2').status,'Clinched');
console.log('PASS Wire playoff hunt: edition cutoff, verified schedule, weekly elimination, simulated draws, matchup odds and owner history');

// Render the normal desk for both halves of the handoff, including the first
// render before asynchronous schedule and bracket data are available.
const babel = require('@babel/standalone');
const source = babel.transform(require('fs').readFileSync('js/components/wire-hunt.js','utf8'),{presets:['react']}).code;
const context = {window:global, React:{
    createElement: (tag,props,...children) => ({tag,props,children}),
    useMemo: fn => fn(), useEffect: () => {}, useState: initial => [initial, () => {}],
}};
require('vm').runInNewContext(source,context);
const raceTable = ledger.rows.map(t => ({rid:t.rosterId,...t})).sort((x,y) => y.wins-x.wins || y.pf-x.pf);
const editionRace = global.WrWirePlayoffs.race({league,edition:{table:raceTable,completedThrough:3}});
function render(postseason, states) {
    let index=0;
    context.React.useState = () => [states[index++], () => {}];
    return JSON.stringify(global.WrWireHuntDesk({league,weeks,race:editionRace,seasons:[],postseason,teamFilter:'all'}));
}
assert.match(render(false,[null,null,null,false]),/Checking remaining matchups/);
assert.match(render(false,[futurePairs,null,null,false]),/The Verdict/);
const champion={team:{id:'2',name:'Sunday Drivers'},champion:true,rounds:[]};
assert.match(render(true,[null,{paths:[champion],rounds:[]},null,false]),/Sunday Drivers takes the title/);
