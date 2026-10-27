#!/usr/bin/env node
'use strict';
/* global require, global, WrTimeLeagueStatsPanel */
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'player-stats']) require(`../js/shared/time-league-${name}.js`);
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
let states = [], refs = [], cursor = 0, refCursor = 0, phone = false;
global.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef: initial => { const index = refCursor++; return refs[index] ||= { current: initial }; }, useMemo: fn => fn(), useEffect() {},
};
window.WR = { useViewport: () => ({ isPhone: phone }) };
window.WrTimeLeagueStandingsPanel = function Profile() {};
require('../js/components/time-league-stats-panel.js');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null || node === false ? '' : typeof node === 'object' ? Array.isArray(node) ? node.map(text).join(' ') : text(node.children) : String(node);
const byLabel = (tree, label) => walk(tree).find(node => node.props['aria-label'] === label);
const entry = (identity, name) => ({ entryId: identity, identity, name, position: 'QB', drawnSeason: 2000, slot: 'QB' });
const alpha = entry('alpha', 'Alpha'), beta = entry('beta', 'Beta'), free = entry('free', 'Free passer');
let league = E.createTimeLeague({ name: 'Stats ownership', seed: 'stats-ui', settings: { gameDeckVersion: 0, hiddenYears: false, regularSeasonWeeks: 3, rosterSlots: { QB: 1, BN: 1 }, scoring: { passingYd: .04, passTd: 4, rushRecYd: .1, rushRecTd: 6, reception: .5, turnover: -2 }, eraRules: { mode: 'any-era', decades: [] } }, seats: [{ name: 'Atlas', manager: 'human' }, { name: 'Zephyr', manager: 'ai' }] });
const cards = new Map([alpha, beta, free].map(row => [row.identity, { identity: row.identity, name: row.name, position: row.position, peak: 300, seasons: [{ season: 2000, games: 14, points: 300 }, { season: 2001, games: 14, points: 250 }] }]));
const line = points => ({ ...S.emptyStatLine(), passYd: points * 25 });
league = { ...league, phase: 'season', currentWeek: 3, seasonsRevealed: true, teams: league.teams.map((team, i) => ({ ...team, roster: [i ? beta : alpha] })),
    finalizedWeeks: [1, 2].map(week => ({ week, matchups: [], results: [], playerProduction: [alpha, beta].map((player, i) => ({ ...player, points: week === 2 ? 999 : i ? 0 : 10, stats: line(week === 2 ? 999 : i ? 0 : 10) })) })) };
const logs = new Map([[S.gameLogKey('free', E.waiverSeason(league, cards.get('free')), 1), { stats: { ...S.emptyStatLine(), passInt: 1 } }]]);
const render = (props = {}) => { cursor = 0; refCursor = 0; return WrTimeLeagueStatsPanel({ league, cards, logIndex: logs, throughWeek: 1, ...props }); };
const rowFor = (tree, name) => walk(tree).find(node => node.type === 'tr' && text(node).includes(name));
const ownColumn = row => row.children[4];
let tree = render(), before = JSON.stringify(league);
assert(!walk(tree).some(node => node.props.className === 'tl-stats-glossary'));
const ownerHeader = walk(tree).find(node => node.type === 'th' && text(node).includes('Owned by'));
assert(ownerHeader); assert(text(ownerHeader).includes('Owned by'));
const alphaRow = rowFor(tree, 'Alpha');
assert.equal(walk(alphaRow).filter(node => node.props['aria-label'] === 'View Atlas team profile').length, 1, 'A player has exactly one ownership link');
assert(!byLabel(alphaRow.children[0], 'View Atlas team profile'), 'Ownership is separate from player identity');
assert(byLabel(ownColumn(alphaRow), 'View Atlas team profile'));
assert(text(alphaRow.children[1]).includes('10.0')); assert(!text(alphaRow).includes('999'));
assert(text(byLabel(alphaRow, 'Recorded stats for Alpha')).includes('Stats'));
assert(text(alphaRow).includes('Pass yd 250'), 'The compact row retains recorded statistics in its native disclosure');
const pointsHead = walk(tree).find(node => node.type === 'button' && text(node).startsWith('FPTS'));
assert(pointsHead.props.title.includes('including bench production'));
assert(!walk(byLabel(tree, 'Stats period')).some(node => node.props.value === 2), 'Unwatched saved finals remain unavailable as periods');
let restored = 0;
byLabel(tree, 'View Atlas team profile').props.onClick({ currentTarget: { focus() { restored++; } } }); tree = render();
const profile = walk(tree).find(node => node.type === WrTimeLeagueStandingsPanel);
assert.equal(profile.props.profileTeamId, 't1'); assert.deepEqual(profile.props.league.finalizedWeeks.map(row => row.week), [1]);
byLabel(tree, 'Atlas team profile').props.onCancel({ preventDefault() {} }); tree = render(); assert.equal(restored, 1);
walk(ownerHeader).find(node => node.type === 'button').props.onClick(); tree = render();
assert.equal(walk(tree).find(node => node.type === 'th' && text(node).includes('Owned by')).props['aria-sort'], 'ascending');
byLabel(tree, 'Filter stats by team').props.onChange({ target: { value: 't2' } }); tree = render(); assert(rowFor(tree, 'Beta')); assert(!rowFor(tree, 'Alpha'));
assert.equal(JSON.stringify(league), before, 'Sorting, ownership inspection and filtering never change the saved room');
console.log('PASS: compact Stats retains one explicit ownership column, real profile links, filters, sort, recorded detail and playback horizon.');

states = []; phone = true; tree = render({ logIndex: null });
const mobile = name => walk(tree).find(node => node.props.className === 'tl-stats-mobile-row' && text(node).includes(name));
assert(text(mobile('Alpha').children[0]).includes('Atlas'), 'Current ownership is visible before expanding a phone row');
assert(text(mobile('Alpha').children[0]).includes('10.0')); assert(text(mobile('Beta').children[0]).includes('0.0'));
assert(text(mobile('Free passer').children[0]).includes('—'), 'Missing records never become a scored zero');
assert(text(mobile('Alpha')).includes('Owned by')); assert(byLabel(mobile('Alpha'), 'View Atlas team profile'));
assert(!walk(tree).some(node => node.props.className === 'tl-stats-glossary'));
assert.equal(JSON.stringify(league), before);
console.log('PASS: phone ownership stays visible while zero/missing values and profile access remain distinct.');

states = []; phone = false;
league = { ...league, publicSnapshotVersion: 1, settings: { ...league.settings, hiddenYears: true }, yearsRevealed: false,
    teams: league.teams.map(team => ({ ...team, roster: team.roster.map(player => {
        const visible = { entryId: player.entryId, identity: player.identity, name: player.name, position: player.position, slot: player.slot, hiddenDecade: '2000s' };
        Object.defineProperty(visible, 'drawnSeason', { get() { throw new Error('Stats consulted a private assigned year'); } });
        return visible;
    }) })), finalizedWeeks: league.finalizedWeeks.map(week => ({ ...week, playerProduction: week.playerProduction.map(({ drawnSeason: _private, ...visible }) => visible) })) };
for (const field of ['seed', 'gameAssignments', 'hiddenYearAssignments']) Object.defineProperty(league, field, { configurable: true, get() { throw new Error('Stats consulted a private assignment or future deck'); } });
tree = render();
assert(text(rowFor(tree, 'Alpha')).includes('10.0')); assert(text(rowFor(tree, 'Beta')).includes('0.0'));
assert(text(tree).includes('2000s · hidden year')); assert(!text(tree).includes('999'));
assert(!walk(tree).some(node => node.type === 'th' && text(node).includes('SZN')), 'Unrevealed assigned-season totals are not added to the condensed table');
assert(byLabel(ownColumn(rowFor(tree, 'Alpha')), 'View Atlas team profile'));
console.log('PASS: hidden Stats uses public completed production and ownership without private years, future decks or unseen finals.');
