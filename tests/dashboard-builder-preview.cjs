'use strict';
// Execute real widget effects: rendering a preview must not publish recommendations
// or change a user's global view preference. Normal Home keeps those behaviors.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function harness() {
    let index = 0, effects = [];
    const state = [];
    const React = {
        createElement(type, props, ...children) { return { type, props: props || {}, children }; },
        useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }]; },
        useEffect(fn) { effects.push(fn); },
        useMemo(fn) { return fn(); },
        useRef(value) { return { current: value }; },
    };
    const published = [], navigated = [], helperOptions = [], writes = [];
    const storage = { getItem() { return null; }, setItem(...args) { writes.push(args); } };
    const window = {
        React, App: {}, WR: {}, S: {}, localStorage: storage,
        wrIsPro: () => true, addEventListener() {}, removeEventListener() {},
    };
    const ctx = vm.createContext({ window, React, ...React, console, localStorage: storage, Set, Map });
    return {
        ctx, window, published, navigated, helperOptions, writes,
        load(file) { vm.runInContext(Babel.transform(source(file), { presets: ['react'] }).code, ctx, { filename: file }); },
        render(component, props) { index = 0; effects = []; return component(props); },
        flush() { effects.forEach(effect => effect()); },
    };
}
const roster = { roster_id: 1, owner_id: 'owner', players: ['r'], starters: ['r'], settings: {} };
const league = { total_rosters: 2, scoring_settings: { rec: 1 }, league_id: '1234567890123456789', settings: { type: 2 }, roster_positions: ['RB', 'WR', 'BN'], rosters: [roster, { roster_id: 2, owner_id: 'other', players: [] }] };

for (const readOnly of [true, false]) {
    const h = harness();
    h.window.WR.GmMode = { useGmEffects: () => ({ hasStrategy: false, mode: 'compete', faFilters: {}, targetPositions: new Set() }) };
    h.window.App = {
        LeagueSkin: { build: () => ({ type: 'dynasty', features: { showTrades: true } }) },
        getFreeAgencyBriefTarget: options => { h.helperOptions.push(options); return null; },
        WeeklyProj: { optimalForRoster: () => ({ week: 8, delta: { delta: 3, isOptimal: false, startInstead: [{ pid: 'r', pos: 'RB', slot: 'RB' }] } }) },
        Intelligence: {
            buildLineupRecommendation: value => value, buildTradeRecommendation: value => value,
            publishRecommendations: (...args) => h.published.push(args),
        },
    };
    h.window.assessTeamFromGlobal = id => id === 1
        ? { tier: 'contender', needs: ['WR'], strengths: ['RB'] }
        : { tier: 'contender', ownerName: 'Other owner', needs: ['RB'], strengths: ['WR'] };
    h.load('js/tabs/flash-brief.js');
    const tree = h.render(h.window.IntelligenceBriefWidget, { size: 'md', currentLeague: league, myRoster: roster, playersData: { r: { full_name: 'Roster Player', position: 'RB' } }, statsData: {}, readOnly, navigateWidget: value => h.navigated.push(value) });
    h.flush();
    assert.equal(h.helperOptions[0].readOnly, readOnly, 'Intel propagates preview flag into the waiver helper');
    assert.deepEqual(h.published.map(row => row[0]), readOnly ? [] : ['lineup', 'trade'], 'Preview never publishes lineup/trade; normal Home still does');
    assert(JSON.stringify(tree).includes('3.0 pts on your bench'), 'Preview retains the actual briefing content');
    tree.props.onClick();
    assert.deepEqual(h.navigated, readOnly ? [] : ['alex']);
}
console.log('PASS Intel preview keeps evidence without publishing lineup/trade or navigating');

for (const readOnly of [true, false]) {
    const h = harness();
    h.window.App.Intelligence = { publishRecommendations: (...args) => h.published.push(args) };
    vm.runInContext(source('js/shared/waiver-roster-read.js'), h.ctx);
    h.window.App.buildFaRosterRead = () => ({ known: true, rows: [], owned: [] });
    const faSource = source('js/free-agency.js');
    vm.runInContext(faSource.slice(0, faSource.indexOf('    // ── UDFA craze')), h.ctx);
    const result = h.ctx.buildFreeAgencyActionBoard({ currentLeague: league, myRoster: roster, playersData: {}, readOnly });
    assert.equal(result.priorityAdds.length, 0);
    assert.equal(h.published.length, readOnly ? 0 : 1, 'Even an empty preview must not clear the shared waiver recommendation stream');
}
console.log('PASS waiver preview cannot publish or clear the shared recommendation stream');

for (const readOnly of [true, false]) {
    const h = harness();
    h.load('js/widgets/power-rankings.js');
    h.render(h.window.PowerRankingsWidget, { size: 'sm', currentLeague: league, playersData: {}, readOnly });
    h.flush();
    assert.equal(h.window._wrPrView, readOnly ? undefined : 'blended');
}
console.log('PASS rankings preview does not write the global view preference');

for (const readOnly of [true, false]) {
    const h = harness();
    h.window.__wrModuleGroupsLoaded = { draft: true };
    const pool = [{ pid: 'r', name: 'Roster Player', pos: 'RB', dhq: 5000, consensusRank: 1 }];
    const state = { leagueId: league.league_id, variant: 'startup', rounds: 1, leagueSize: 1, userRosterId: 1, userSlot: 1, pool };
    h.window.DraftCC = { state: {
        initialDraftState: () => state,
        buildPickOrder: () => [{ round: 1, slot: 1, overall: 1, teamIdx: 0, rosterId: 1 }],
    } };
    h.load('js/draft/analyst-mock.js');
    h.load('js/widgets/analyst-mock.js');
    const props = { size: 'sm', currentLeague: league, myRoster: roster, readOnly, navigateWidget: value => h.navigated.push(value) };
    const before = JSON.stringify(state);
    h.render(h.window.AnalystMockWidget, props);
    h.flush();
    const tree = h.render(h.window.AnalystMockWidget, props);
    assert(JSON.stringify(tree).includes('Roster Player'), 'Projection still renders in preview');
    assert.equal(JSON.stringify(state), before, 'Projection does not mutate shared draft state');
    assert.equal(h.writes.length, 0, 'Projection does not persist any draft state');
    tree.props.onClick();
    assert.deepEqual(h.navigated, readOnly ? [] : ['draft']);
}
console.log('PASS analyst preview computes locally without mutating draft state, persisting, or navigating');
