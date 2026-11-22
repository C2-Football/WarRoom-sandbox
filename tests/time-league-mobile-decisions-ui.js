#!/usr/bin/env node
'use strict';
/* global require, global, process, WrTimeLeagueTeamPanel */
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
window.WR = { useViewport: () => ({ isPhone: true }) };
for (const name of ['roster', 'helmet', 'rules', 'draft-room', 'era-rules', 'season', 'engine', 'ai', 'ui', 'hidden-years', 'player-stats']) require(`../js/shared/time-league-${name}.js`);
let states = [], refs = [], cursor = 0, refCursor = 0;
global.React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useMemo: fn => fn(), useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; }, useEffect() {},
};
require('../js/components/time-league-team-panel.js');
const E = App.TimeLeagueEngine, stamp = '2026-10-21T00:00:00Z';
const entry = (id, position, slot = position) => ({ entryId: id, identity: `player:${id}`, name: id.replaceAll('-', ' '), position, slot, drawnSeason: 2000 });
function create() {
    const state = E.createTimeLeague({ name: 'Mobile decisions', seed: 'mobile-ui', createdAt: stamp,
        settings: { gameDeckVersion: 0, hiddenYears: false, eraRules: { mode: 'any-era', decades: [] }, rosterSlots: { QB: 1, RB: 1, WR: 1, BN: 2 }, maxQuarterbacks: 2, regularSeasonWeeks: 3, playoffTeams: 0,
            waiversEnabled: true, tradesEnabled: true, waiverMode: 'faab', faabBudget: 100, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 } },
        seats: [{ name: 'Archive Atlas', manager: 'human' }, { name: 'Morgan', manager: 'human' }] });
    return { ...state, phase: 'season', weekStage: 'claims', seasonsRevealed: true, teams: state.teams.map((team, i) => ({ ...team, roster: [entry(`${i}-QB`, 'QB'), entry(`${i}-RB`, 'RB'), entry(`${i}-WR`, 'WR'), entry(`${i}-Reserve`, 'WR', 'BN'), entry(`${i}-Spare`, 'WR', 'BN')] })) };
}
function cardsFor(state) {
    return new Map([...state.teams.flatMap(team => team.roster), entry('Free-Passer', 'QB'), entry('Free-Runner', 'RB'), entry('Free-Receiver', 'WR')]
        .map(player => [player.identity, { identity: player.identity, name: player.name, position: player.position, peak: 100, seasons: [{ season: 2000, games: 14, points: 100 }] }]));
}
let league, cards, writes, saved, browsed, cleared;
const reset = () => { league = create(); cards = cardsFor(league); writes = []; saved = true; browsed = null; cleared = 0; states = []; refs = []; };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const copy = node => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : copy(node.children);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || copy(node.children) === label));
const region = (tree, label) => walk(tree).find(node => node.props['aria-label'] === label);
const hasClass = (node, name) => (node.props.className || '').split(' ').includes(name);
const context = (overrides = {}) => ({ leagueId: league.leagueId, teamId: 't1', week: league.currentWeek, slot: 'RB', replacementEntryId: '0-RB', requestId: 1, ...overrides });
const render = (section = 'waivers', props = {}) => {
    cursor = 0; refCursor = 0;
    return WrTimeLeagueTeamPanel({ league, cards, section, activeTeamId: 't1', onSelectTeam() {}, logIndex: new Map(),
        onBrowseWaivers: (...args) => { browsed = args; }, onClearWaiverContext: () => { cleared++; },
        onUpdate: async (next, action) => { writes.push({ next, action }); if (saved) league = next; return saved; }, ...props });
};
let count = 0;
async function test(name, fn) { reset(); await fn(); count++; console.log(`  ok ${name}`); }
(async () => {
    await test('trade brief and removable packages precede both pickers; detailed comparison remains below', () => {
        let tree = render('trades');
        region(tree, 'Select 0 QB').props.onChange(); region(tree, 'Select 1 QB').props.onChange(); tree = render('trades');
        const all = walk(tree), brief = region(tree, 'Trade summary'), packages = region(tree, 'Selected trade packages');
        const pickers = all.find(node => hasClass(node, 'tl-trade-sides')), details = all.find(node => hasClass(node, 'tl-trade-comparison-details'));
        assert(all.indexOf(brief) < all.indexOf(packages)); assert(all.indexOf(packages) < all.indexOf(pickers)); assert(all.indexOf(pickers) < all.indexOf(details));
        assert(copy(brief).includes('reference pts')); assert(copy(brief).includes('Value grade')); assert(copy(brief).includes('Current roster checks pass'));
        assert(!copy(brief).includes('received players enter your bench')); assert(copy(details).includes('not a forecast or acceptance guarantee'));
        assert(copy(region(tree, 'Selected send package')).includes('0 QB')); assert(copy(region(tree, 'Selected receive package')).includes('1 QB'));
        for (const label of ['Selected send package', 'Selected receive package']) {
            assert(copy(region(tree, label)).includes('100.0')); assert(copy(region(tree, label)).includes('Reference points'));
        }
        button(packages, 'Remove 0 QB from send package').props.onClick(); tree = render('trades');
        assert.equal(region(tree, 'Select 0 QB').props.checked, false); assert.equal(region(tree, 'Select 1 QB').props.checked, true);
        assert(copy(region(tree, 'Trade summary')).includes('0 for 1')); assert(button(tree, 'Send offer').props.disabled); assert.equal(writes.length, 0);
    });
    await test('impossible package warning is above pickers without changing proposal rules', () => {
        let tree = render('trades'); region(tree, 'Select 0 RB').props.onChange(); region(tree, 'Select 1 WR').props.onChange(); tree = render('trades');
        assert(copy(region(tree, 'Trade summary')).includes('Cannot accept this package with the current rosters'));
        assert(!button(tree, 'Send offer').props.disabled); assert.equal(writes.length, 0);
    });
    await test('unknown public values remain unknown in the brief instead of creating a grade', () => {
        cards.delete('player:0-QB'); let tree = render('trades');
        region(tree, 'Select 0 QB').props.onChange(); region(tree, 'Select 1 QB').props.onChange(); tree = render('trades');
        assert(copy(region(tree, 'Trade summary')).includes('Comparison unavailable')); assert(!copy(region(tree, 'Trade summary')).includes('Steal'));
    });
    await test('hidden trade brief, packages, details and compact evidence never consult private assignments', () => {
        league = { ...league, settings: { ...league.settings, hiddenYears: true }, seasonsRevealed: true, yearsRevealed: false, publicSnapshotVersion: 1 };
        for (const team of league.teams) for (const player of team.roster) {
            delete player.drawnSeason; player.hiddenDecade = '2000s';
            Object.defineProperty(player, 'drawnSeason', { get() { throw new Error('Private assigned year was read'); } });
        }
        for (const field of ['seed', 'hiddenYearAssignments', 'gameAssignments']) Object.defineProperty(league, field, { configurable: true, get() { throw new Error('Private assignment/deck was read'); } });
        let tree = render('trades'); region(tree, 'Select 0 QB').props.onChange(); region(tree, 'Select 1 QB').props.onChange(); tree = render('trades');
        assert(copy(region(tree, 'Trade summary')).includes('est. pts/game')); assert(copy(region(tree, 'Selected send package')).includes('Reference scoring'));
        assert(copy(tree).includes('Candidate archive · Reference scoring')); assert(!copy(tree).includes('projected wins')); assert(!copy(tree).includes('Acceptance estimate'));
        // The shared wire allocator checks whether an identity has an existing
        // assignment before using its public snapshot. Public snapshots omit
        // that map; keep assigned-year and future-deck traps on the actual rows.
        delete league.hiddenYearAssignments;
        states = []; refs = [];
        tree = render('waivers'); assert(copy(tree).includes('Archive estimate · Reference scoring'));
        states = []; refs = [];
        tree = render('roster'); assert(copy(tree).includes('Archive estimate · Reference scoring'));
        assert.equal(writes.length, 0);
    });
    await test('unresolved roster metadata stays concise while its full hidden-year description remains accessible', () => {
        league = { ...league, settings: { ...league.settings, hiddenYears: true }, publicSnapshotVersion: 1 };
        const card = cards.get('player:0-RB'); cards.set(card.identity, { ...card, seasons: [card.seasons[0], { ...card.seasons[0], season: 2001 }] });
        const tree = render('roster'), row = walk(tree).find(node => hasClass(node, 'tl-lineup-row') && copy(node).includes('0 RB'));
        const meta = walk(row).find(node => hasClass(node, 'tl-roster-edition'));
        assert.equal(copy(meta).trim(), '2000s  · 2 possible years'); assert(!copy(meta).includes('hidden year'));
        assert(meta.props['aria-label'].includes('2000s · hidden year · 2 possible years')); assert.equal(meta.props.title, meta.props['aria-label']);
        assert.equal(button(row, "Explore 0 RB's history").props['aria-describedby'], meta.props.id);
    });
    await test('wire removes only a duplicated hidden-year estimate and retains a distinct unused archive pool', () => {
        const S = App.TimeLeagueSeason, card = cards.get('player:Free-Runner');
        league = { ...league, settings: { ...league.settings, hiddenYears: true }, publicSnapshotVersion: 1 };
        cards.set(card.identity, { ...card, seasons: [{ season: 2000, games: 1, points: 10 }, { season: 2001, games: 1, points: 20 }] });
        let logs = S.buildGameLogIndex([{ identity: card.identity, season: 2000, week: 1, stats: { ...S.emptyStatLine(), rushYd: 100 } },
            { identity: card.identity, season: 2001, week: 1, stats: { ...S.emptyStatLine(), rushYd: 200 } }]);
        let tree = render('waivers', { logIndex: logs }), row = walk(tree).find(node => node.type === 'tr' && copy(node).includes('Free Runner'));
        assert(copy(row).includes('45.0 est. pts left')); assert(!walk(row).some(node => hasClass(node, 'tl-player-remaining')));
        cards.set(card.identity, { ...card, seasons: [{ season: 2000, games: 2, points: 30 }] }); states = []; refs = [];
        logs = S.buildGameLogIndex([{ identity: card.identity, season: 2000, week: 1, stats: { ...S.emptyStatLine(), rushYd: 100 } },
            { identity: card.identity, season: 2000, week: 2, stats: { ...S.emptyStatLine(), rushYd: 200 } }]);
        tree = render('waivers', { logIndex: logs }); row = walk(tree).find(node => node.type === 'tr' && copy(node).includes('Free Runner'));
        const archive = walk(row).find(node => hasClass(node, 'tl-player-remaining'));
        assert(copy(archive).includes('30.0')); assert(copy(archive).includes('Unused archive pts')); assert(copy(row).includes('45.0 est. pts left'));
    });
    await test('roster handoff includes the intended replacement, while an empty slot sends null', () => {
        button(render('roster'), 'Move 0 RB').props.onClick(); button(render('roster'), 'Find eligible RB free agents →').props.onClick();
        assert.deepEqual(browsed, ['RB', '0-RB']); assert.equal(writes.length, 0);
        league = { ...league, teams: league.teams.map(team => team.teamId !== 't1' ? team : { ...team, roster: team.roster.filter(row => row.entryId !== '0-RB') }) }; states = []; refs = [];
        button(render('roster'), 'Fill open RB slot').props.onClick(); button(render('roster'), 'Find eligible RB free agents →').props.onClick();
        assert.deepEqual(browsed, ['RB', null]); assert.equal(writes.length, 0);
    });
    await test('fresh owned compatible context preselects a drop, never a filing action', () => {
        const props = { waiverContext: context() };
        let tree = render('waivers', props); assert(copy(region(tree, 'Replacement context')).includes('Replacing 0 RB'));
        assert(!button(tree, 'Claim Free Passer'), 'The current slot filters the available choices');
        button(tree, 'Claim Free Runner').props.onClick(); tree = render('waivers', props);
        assert(button(region(tree, 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']); assert.equal(writes.length, 0); assert.equal(league.pendingClaims.length, 0);
        assert(!button(region(tree, 'Waiver claim'), '⚖ FILE CLAIM').props.disabled);
    });
    await test('manual drop and bid survive closing the same target, including a failed save', async () => {
        const props = { waiverContext: context() };
        button(render('waivers', props), 'Claim Free Runner').props.onClick();
        button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 Reserve').props.onClick();
        region(render('waivers', props), 'FAAB bid').props.onChange({ target: { value: '17' } });
        button(region(render('waivers', props), 'Waiver claim'), 'Close').props.onClick(); button(render('waivers', props), 'Claim Free Runner').props.onClick();
        let dialog = region(render('waivers', props), 'Waiver claim');
        assert(button(dialog, 'Drop 0 Reserve').props['aria-pressed']); assert.equal(region(dialog, 'FAAB bid').props.value, 17);
        assert(copy(dialog).includes('Your current drop choice is kept')); saved = false;
        await button(dialog, '⚖ FILE CLAIM').props.onClick(); dialog = region(render('waivers', props), 'Waiver claim');
        assert(copy(dialog).includes('Claim was not saved')); assert(button(dialog, 'Drop 0 Reserve').props['aria-pressed']); assert.equal(region(dialog, 'FAAB bid').props.value, 17);
        assert(region(render('waivers', props), 'Replacement context')); assert.equal(league.pendingClaims.length, 0); assert.equal(writes.length, 1);
    });
    await test('an existing filed claim takes precedence over replacement context', () => {
        league = E.submitWaiverClaim(league, { teamId: 't1', addIdentity: 'player:Free-Runner', addName: 'Free Runner', addPosition: 'RB', dropEntryId: '0-Reserve', bidAmount: 23 }, stamp);
        const props = { waiverContext: context() }; button(render('waivers', props), 'Review pending claim for Free Runner').props.onClick();
        const dialog = region(render('waivers', props), 'Waiver claim'); assert(button(dialog, 'Drop 0 Reserve').props['aria-pressed']); assert.equal(region(dialog, 'FAAB bid').props.value, 23);
        assert(copy(dialog).includes('replacement context does not edit it')); assert(!button(dialog, '⚖ FILE CLAIM')); assert.equal(writes.length, 0);
        button(dialog, 'Close').props.onClick(); button(render('waivers', props), 'Clear replacement context').props.onClick();
        button(render('waivers', props), 'Review pending claim for Free Runner').props.onClick();
        assert(button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 Reserve').props['aria-pressed']); assert.equal(league.pendingClaims[0].bidAmount, 23);
    });
    await test('foreign Vault, foreign team, expired week and unconfigured slot contexts cannot preselect or force a filter', () => {
        for (const invalid of [{ leagueId: 'another-vault' }, { teamId: 't2' }, { week: 0 }, { slot: 'TE' }]) {
            states = []; refs = []; const props = { waiverContext: context(invalid), waiverSlot: 'RB' };
            let tree = render('waivers', props); assert(button(tree, 'Claim Free Passer')); assert(copy(region(tree, 'Replacement context')).includes('Choose your current roster need'));
            button(tree, 'Claim Free Runner').props.onClick(); tree = render('waivers', props);
            assert(!button(region(tree, 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']); assert.equal(writes.length, 0);
        }
    });
    await test('a missing or foreign replacement never becomes an actionable owned drop', () => {
        for (const id of ['not-on-roster', '1-RB']) {
            states = []; refs = []; const props = { waiverContext: context({ replacementEntryId: id }) };
            let tree = render('waivers', props); assert(copy(region(tree, 'Replacement context')).includes('no longer on this roster'));
            button(tree, 'Claim Free Runner').props.onClick(); tree = render('waivers', props);
            assert(!button(region(tree, 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']); assert.equal(writes.length, 0);
        }
    });
    await test('an incompatible owned replacement explains the mismatch and leaves drop choice open', () => {
        const props = { waiverContext: context({ replacementEntryId: '0-QB' }) };
        assert.equal(E.waiverLandingSlot(league, league.teams[0], 'RB', '0-QB'), null);
        button(render('waivers', props), 'Claim Free Runner').props.onClick(); const dialog = region(render('waivers', props), 'Waiver claim');
        assert(!button(dialog, 'Drop 0 QB').props['aria-pressed']); assert(copy(dialog).includes('0 QB cannot be the drop for this player'));
        assert(button(dialog, '⚖ FILE CLAIM').props.disabled); assert(!button(dialog, 'Drop 0 RB').props.disabled); assert.equal(writes.length, 0);
    });
    await test('empty-slot context suggests no drop, and clearing context preserves explicit choices', () => {
        const props = { waiverContext: context({ replacementEntryId: null }) };
        let tree = render('waivers', props); assert(copy(region(tree, 'Replacement context')).includes('Finding RB-eligible free agents'));
        button(tree, 'Claim Free Runner').props.onClick(); assert(!button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']);
        button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 Reserve').props.onClick();
        button(region(render('waivers', props), 'Waiver claim'), 'Close').props.onClick();
        button(render('waivers', props), 'Clear replacement context').props.onClick(); tree = render('waivers', props);
        button(tree, 'Claim Free Runner').props.onClick(); tree = render('waivers', props);
        assert(!region(tree, 'Replacement context')); assert(button(region(tree, 'Waiver claim'), 'Drop 0 Reserve').props['aria-pressed']); assert.equal(cleared, 1); assert.equal(writes.length, 0);
    });
    await test('clearing context removes only an automatic drop, including when the same form is reopened', () => {
        const props = { waiverContext: context() };
        button(render('waivers', props), 'Claim Free Runner').props.onClick();
        region(render('waivers', props), 'FAAB bid').props.onChange({ target: { value: '9' } });
        button(region(render('waivers', props), 'Waiver claim'), 'Close').props.onClick();
        button(render('waivers', props), 'Clear replacement context').props.onClick();
        button(render('waivers', props), 'Claim Free Runner').props.onClick();
        const dialog = region(render('waivers', props), 'Waiver claim');
        assert(!button(dialog, 'Drop 0 RB').props['aria-pressed']); assert.equal(region(dialog, 'FAAB bid').props.value, 9); assert.equal(writes.length, 0);
    });
    await test('explicitly choosing the suggested drop makes it a manual choice that survives clearing context', () => {
        const props = { waiverContext: context() };
        button(render('waivers', props), 'Claim Free Runner').props.onClick();
        button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 RB').props.onClick();
        button(region(render('waivers', props), 'Waiver claim'), 'Close').props.onClick();
        button(render('waivers', props), 'Clear replacement context').props.onClick();
        button(render('waivers', props), 'Claim Free Runner').props.onClick();
        assert(button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']); assert.equal(writes.length, 0);
    });
    await test('a retained standalone context expires before the next-week target is reopened', () => {
        const props = { waiverContext: context() }; button(render('waivers', props), 'Claim Free Runner').props.onClick();
        league = { ...league, currentWeek: 2 };
        button(render('waivers', props), 'Claim Free Runner').props.onClick(); const tree = render('waivers', props);
        assert(copy(region(tree, 'Replacement context')).includes('has expired')); assert(!button(region(tree, 'Waiver claim'), 'Drop 0 RB').props['aria-pressed']); assert.equal(writes.length, 0);
    });
    await test('an already mounted automatic drop cannot file after a week, Vault or manager change', async () => {
        for (const change of ['week', 'vault', 'manager']) {
            reset(); const props = { waiverContext: context() };
            button(render('waivers', props), 'Claim Free Runner').props.onClick();
            const oldFile = button(region(render('waivers', props), 'Waiver claim'), '⚖ FILE CLAIM'); assert(!oldFile.props.disabled);
            if (change === 'week') league = { ...league, currentWeek: 2 };
            if (change === 'vault') league = { ...league, leagueId: 'another-vault' };
            const freshProps = { waiverContext: null, activeTeamId: change === 'manager' ? 't2' : 't1' };
            let dialog = region(render('waivers', freshProps), 'Waiver claim');
            assert(copy(dialog).includes('Review a current drop before filing')); assert(button(dialog, '⚖ FILE CLAIM').props.disabled);
            assert(!button(dialog, change === 'manager' ? 'Drop 1 RB' : 'Drop 0 RB').props['aria-pressed']);
            await oldFile.props.onClick(); await button(dialog, '⚖ FILE CLAIM').props.onClick();
            assert.equal(writes.length, 0, `${change}: both the held old callback and newly disabled action reject the old automatic drop`);
            button(dialog, change === 'manager' ? 'Drop 1 RB' : 'Drop 0 RB').props.onClick();
            dialog = region(render('waivers', freshProps), 'Waiver claim'); assert(!button(dialog, '⚖ FILE CLAIM').props.disabled);
            await button(dialog, '⚖ FILE CLAIM').props.onClick();
            assert.equal(writes.length, 1); assert.equal(league.pendingClaims[0].week, league.currentWeek);
            assert.equal(league.pendingClaims[0].teamId, freshProps.activeTeamId);
        }
    });
    await test('explicit manual drop and bid stay intact across a week change, while an old held callback is ignored', async () => {
        const props = { waiverContext: context() }; button(render('waivers', props), 'Claim Free Runner').props.onClick();
        button(region(render('waivers', props), 'Waiver claim'), 'Drop 0 Reserve').props.onClick();
        region(render('waivers', props), 'FAAB bid').props.onChange({ target: { value: '11' } });
        const oldFile = button(region(render('waivers', props), 'Waiver claim'), '⚖ FILE CLAIM');
        league = { ...league, currentWeek: 2 }; const dialog = region(render('waivers', { waiverContext: null }), 'Waiver claim');
        assert(button(dialog, 'Drop 0 Reserve').props['aria-pressed']); assert.equal(region(dialog, 'FAAB bid').props.value, 11);
        await oldFile.props.onClick(); assert.equal(writes.length, 0);
    });
    await test('filing rechecks current free-agent ownership even before another render', async () => {
        const props = { waiverContext: context() }; button(render('waivers', props), 'Claim Free Runner').props.onClick();
        const file = button(region(render('waivers', props), 'Waiver claim'), '⚖ FILE CLAIM'); assert(!file.props.disabled);
        league.teams[1].roster.push(entry('Free-Runner', 'RB', 'BN'));
        await file.props.onClick(); assert.equal(writes.length, 0); assert.equal(league.pendingClaims.length, 0);
        assert(copy(region(render('waivers', props), 'Waiver claim')).includes('no longer a free agent'));
    });
    await test('a held filing callback is inert after waivers are disabled', async () => {
        const props = { waiverContext: context() }; button(render('waivers', props), 'Claim Free Runner').props.onClick();
        const file = button(region(render('waivers', props), 'Waiver claim'), '⚖ FILE CLAIM');
        league = { ...league, settings: { ...league.settings, waiversEnabled: false } }; render('waivers', { waiverContext: null });
        await file.props.onClick(); assert.equal(writes.length, 0); assert.equal(league.pendingClaims.length, 0);
    });
    await test('clearing replacement context focuses the persistent free-agent search and retains the filter', () => {
        const props = { waiverContext: context() }; let tree = render('waivers', props), focused = false;
        region(tree, 'Search free agents').props.ref.current = { focus: options => { focused = true; assert.deepEqual(options, { preventScroll: true }); } };
        button(tree, 'Clear replacement context').props.onClick(); tree = render('waivers', props);
        assert(focused); assert.equal(cleared, 1); assert(!region(tree, 'Replacement context'));
        assert(button(tree, 'RB').props['aria-pressed']); assert.equal(writes.length, 0);
    });
    console.log(`PASS: ${count} mobile decision UI cases; trade hierarchy/removal, preserved legality and values, scoped replacement intent, manual/pending precedence, expiry and no automatic writes.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
