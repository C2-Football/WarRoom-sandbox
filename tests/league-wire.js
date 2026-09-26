#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const journalSource = fs.readFileSync('js/shared/league-wire-journal.js', 'utf8');
const source = babel.transform(fs.readFileSync('js/components/league-wire.js', 'utf8'), { presets: ['react'] }).code;
function harness({ reduced = false, phone = false, week = 1 } = {}) {
    let states = [], cursor = 0, effects = [], intervals = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        useState: initial => { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: () => ({ current: null }),
    };
    const context = { React, console, setInterval: () => { intervals++; return intervals; }, clearInterval() {}, window: { App: { LeagueLiveScores: { useScores: () => ({ week, rows: [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }] }), rosterPoints: r => typeof r.custom_points === 'number' ? r.custom_points : typeof r.points === 'number' ? r.points : null, supported: () => true } }, WR: { useViewport: () => ({ isPhone: phone }) }, matchMedia: () => ({ matches: reduced }) } };
    vm.createContext(context); vm.runInContext(fs.readFileSync('js/shared/league-wire-reading.js', 'utf8'), context); vm.runInContext(journalSource, context); vm.runInContext(source, context);
    const props = { currentLeague: { league_id: 'test', season: '2026', rosters: [] }, standings: [], transactions: [] };
    const render = () => { cursor = 0; effects = []; return context.window.WrLeagueWire(props); };
    render();
    states[10] = [{ state: 'pre', away: 'AAA', home: 'BBB', shortDetail: 'Sunday' }, { state: 'in', away: 'CCC', home: 'DDD', awayScore: 7, homeScore: 3 }];
    return { props, render, rotate: () => effects.at(-1)(), intervals: () => intervals, engine: context.window.WrWireStories, setArchive: value => { states[4] = value; } };
}
function nodes(node) { return node && typeof node === 'object' ? [node, ...node.children.flatMap(nodes)] : []; }
function text(node) { return node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.children.map(text).join(' '); }
const app = harness();
let tree = app.render();
const find = predicate => nodes(tree).find(predicate);
assert.match(text(find(n => n.props.className === 'wr-wire-headline')), /CCC 7/);
app.rotate(); assert.equal(app.intervals(), 1, 'automatic rotation starts');
find(n => n.props['aria-label'] === 'Pause automatic updates').props.onClick();
tree = app.render(); app.rotate(); assert.equal(app.intervals(), 1, 'pause prevents rotation');
find(n => n.props['aria-label'] === 'Next update').props.onClick();
tree = app.render(); assert.doesNotMatch(text(find(n => n.props.className === 'wr-wire-headline')), /CCC 7/, 'manual navigation works while paused');
find(n => n.type === 'select').props.onChange({ target: { value: 'trends' } });
tree = app.render(); assert.match(text(tree), /Open The Wire for league stories and the season archive/);
assert.doesNotMatch(text(tree), /won on|BIGGEST WIN|UGLIEST WIN/, 'unfinished scores are not called wins');
const accessible = harness({ reduced: true }); accessible.render(); accessible.rotate(); assert.equal(accessible.intervals(), 0, 'reduced motion disables rotation');
const phoneTree = harness({ phone: true }).render();
assert(nodes(phoneTree).some(n => n.props.className === 'wr-wire-mobile-launch'), 'phone has an inline edition launcher');
assert(!nodes(phoneTree).some(n => n.props.className === 'wr-wire-headline'), 'phone has no fixed ticker over its navigation');
console.log('PASS league wire: priority, pause, navigation, filters, reduced motion, phone launcher');

// Completed-score journalism: records require a baseline, gaps stop claims,
// custom scoring overrides raw totals, and ties never become wins.
const row = (id, score, matchup = 1, extra = {}) => ({ roster_id: id, points: score, matchup_id: matchup, ...extra });
const weeks = [
    { week: 1, rows: [row(1, 100), row(2, 99), row(3, 80, 2), row(4, 70, 2)] },
    { week: 2, rows: [row(1, 120), row(2, 110), row(3, 90, 2), row(4, 70, 2)] },
    { week: 3, rows: [row(1, 140, 1, { starters: ['p1', 'bench'], players_points: { p1: 30, bench: 20, unused: 60 } }), row(2, 139), row(3, 85, 2), row(4, 80, 2)] },
];
const build = (data = weeks, end = 3, extras = {}) => app.engine.build({ weeks: data, start: 1, end, nameFor: id => 'Team ' + id, playerName: id => 'Player ' + id, ...extras });
const edition = build();
assert.equal(edition.high, 140);
assert.equal(edition.stories.filter(s => s.kind === 'recap').length, 6);
assert(!edition.stories.some(s => s.week === 1 && s.kind === 'record'), 'opening baseline is not a broken record');
assert(edition.stories.some(s => /3 straight/.test(s.text)));
assert(edition.stories.some(s => /No justice|cruel draw|score big/.test(s.text)));
assert(edition.stories.some(s => /Player p1 led/.test(s.body)));
assert(!edition.stories.some(s => /unused/.test(s.body)), 'bench players cannot earn winning-starter credit');
assert.equal(build(weeks, 2).high, 120, 'current and future weeks excluded');
assert.equal(build([weeks[0], weeks[2]]).high, 100, 'missing week stops record and streak claims');
assert.equal(build([{ week: 1, rows: [row(1, 500, 1, { custom_points: 50 }), row(2, 60)] }], 1).high, 60);
const ties = build([{ week: 1, rows: [row(1, 100), row(2, 100)] }, { week: 2, rows: [row(1, 100), row(2, 100)] }], 2);
assert(ties.stories.some(s => /finish level/.test(s.text)));
assert(ties.stories.some(s => /Season scoring high matched/.test(s.text)));
assert(!ties.stories.some(s => /winning margin|straight|winning starters/.test(s.body + s.text)));
assert.equal(ties.records.length, 4, 'all tied record holders retained');
assert.equal(build([{ week: 1, rows: [row(1, null), row(2, 80)] }], 1).stories.length, 0);
assert(!build(weeks, 3, { headToHead: false }).stories.some(s => s.kind === 'recap' || /straight/.test(s.text)), 'non-head-to-head formats do not get game narratives');
const archiveApp = harness();
archiveApp.setArchive({ key: 'test|2026|1|0', status: 'ready', weeks: [] });
let archiveTree = archiveApp.render();
nodes(archiveTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
archiveTree = archiveApp.render();
assert.match(text(archiveTree), /first chapter is still being written/);
assert(nodes(archiveTree).some(n => n.props['aria-label'] === 'Story week'));
console.log('PASS league stories: recaps, record ties, custom totals, streaks, missing weeks, format boundaries, archive controls');

const scoped = harness({ week: 4 });
scoped.setArchive({ key: 'test|2026|1|3', status: 'ready', weeks });
let scopedTree = scoped.render();
nodes(scopedTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
scopedTree = scoped.render();
nodes(scopedTree).find(n => n.props['aria-label'] === 'Story week').props.onChange({ target: { value: '1' } });
scopedTree = scoped.render();
const recordBook = nodes(scopedTree).find(n => n.props.className === 'wr-journal-record');
assert.match(text(recordBook), /100.00/);
assert.doesNotMatch(text(recordBook), /140.00/, 'reading an old edition cannot leak later records');
assert.match(text(scopedTree), /THROUGH WK  1/);
scoped.props.currentLeague = { ...scoped.props.currentLeague, league_id: 'another-league' };
scopedTree = scoped.render();
assert.doesNotMatch(text(nodes(scopedTree).find(n => n.props.className === 'wr-journal-record')), /100.00/, 'league switch cannot reuse another league archive');
console.log('PASS Wire reading scope: as-of-week records and league isolation');

// NFL desk: actual score parsing, phase boundaries and rendered box scores.
const nflRoot = { App: {}, AbortController };
const nflContext = { window: nflRoot, console, setTimeout, clearTimeout, fetch: async () => { throw Error('unexpected fetch'); } };
vm.createContext(nflContext);
vm.runInContext(fs.readFileSync('js/shared/nfl-context.js', 'utf8'), nflContext);
const NC = nflRoot.App.NflContext;
const event = { id: '12345', date: '2026-09-20T17:00:00Z', competitions: [{ status: { type: { name: 'STATUS_FINAL_OVERTIME', state: 'post', completed: true, shortDetail: 'Final/OT' } }, competitors: [
    { id: '1', homeAway: 'home', team: { abbreviation: 'WSH', displayName: 'Washington Commanders' }, score: '24', linescores: [{ period: 1, value: 0 }, { period: 2, value: 7 }, { period: 3, value: 7 }, { period: 4, value: 7 }, { period: 5, value: 3 }] },
    { id: '2', homeAway: 'away', team: { abbreviation: 'JAC', displayName: 'Jacksonville Jaguars' }, score: '21', linescores: [{ period: 1, value: 7 }, { period: 2, value: 0 }, { period: 3, value: 7 }, { period: 4, value: 7 }, { period: 5, value: 0 }] },
], leaders: [{ name: 'passingYards', leaders: [{ athlete: { displayName: 'Sample Quarterback' }, team: { id: '1' }, displayValue: '20/30, 250 YDS, 2 TD' }] }], broadcasts: [{ names: ['FOX'] }] }] };
const game = NC.parseScores({ events: [event] })[0];
assert.equal(game.home, 'WAS'); assert.equal(game.away, 'JAX');
assert.equal(game.homePeriods[0].value, 0, 'scoreless quarters stay zero');
assert.equal(game.homePeriods[4].period, 5, 'overtime retained');
assert.equal(game.leaders[0].team, 'WAS');
assert.equal(game.boxScoreUrl, 'https://www.espn.com/nfl/boxscore/_/gameId/12345');
assert.equal(NC.previousPhase({ season: '2026', week: 3, seasontype: 2 }).week, 2);
assert.equal(NC.previousPhase({ season: '2026', week: 1, seasontype: 2 }), null);
assert.equal(NC.previousPhase({ season: '2026', week: 1, seasontype: 1 }), null);
const playoffPrior = NC.previousPhase({ season: '2026', week: 1, seasontype: 3 });
assert.equal(playoffPrior.week, 18); assert.equal(playoffPrior.seasontype, 2);
const emptyScore = structuredClone(event); emptyScore.competitions[0].competitors[0].score = '';
assert.equal(NC.parseScores({ events: [emptyScore] })[0].homeScore, null, 'missing scores never become zero');
const ui = { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) }, window: {} };
vm.createContext(ui); vm.runInContext(source, ui);
const upcoming = { ...game, id: 'upcoming', completed: false, state: 'pre', statusName: 'STATUS_SCHEDULED', shortDetail: 'Sunday', homeScore: 0, awayScore: 0 };
const nflDesk = { phase: { season: '2026', week: 3, seasontype: 2 }, previousPhase: { season: '2026', week: 2, seasontype: 2 }, current: { status: 'ready', games: [upcoming] }, previous: { status: 'ready', games: [game] } };
const nflTree = ui.WrNflDesk({ desk: nflDesk });
assert.match(text(nflTree), /This week/); assert.match(text(nflTree), /Last week’s results/);
assert.match(text(nflTree), /Sample Quarterback/); assert.match(text(nflTree), /24–21 in overtime/);
assert(nodes(nflTree).some(n => n.type === 'th' && text(n) === 'OT'));
const thisWeekTree = nodes(nflTree).find(n => n.props['aria-label'] === 'This week');
assert(!nodes(thisWeekTree).some(n => n.type === 'details'), 'scheduled games have no fabricated box score');
assert(nodes(thisWeekTree).filter(n => n.type === 'strong').every(n => text(n) === '—'));
const cancelled = ui.WrNflDesk({ desk: { ...nflDesk, current: { status: 'ready', games: [{ ...upcoming, state: 'post', statusName: 'STATUS_CANCELED', shortDetail: 'Canceled' }] } } });
assert.match(text(cancelled), /Canceled/);
assert(!nodes(nodes(cancelled).find(n => n.props['aria-label'] === 'This week')).some(n => n.type === 'details'), 'canceled games are not finals');
assert.match(text(ui.WrNflDesk({ desk: { ...nflDesk, previous: { status: 'error', games: [game] } } })), /last available scores/);
assert.match(text(ui.WrNflDesk({ desk: { ...nflDesk, previousPhase: null, previous: { status: 'ready', games: [] } } })), /No earlier games in this phase/);
const nflTab = harness(); let tabTree = nflTab.render();
nodes(tabTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
tabTree = nflTab.render();
nodes(tabTree).find(n => n.type === 'button' && text(n) === 'NFL').props.onClick();
tabTree = nflTab.render();
assert(nodes(tabTree).some(n => typeof n.type === 'function' && n.type.name === 'WrNflDesk'));
assert(!nodes(tabTree).some(n => n.props.className === 'wr-journal-empty'), 'NFL tab does not show an empty fantasy edition');
assert(!nodes(tabTree).some(n => n.props['aria-label'] === 'Story week'), 'fantasy archive filters do not mislabel current NFL games');
(async () => {
    let calls = 0;
    nflContext.fetch = async url => { calls++; assert.match(url, /week=2&seasontype=2&season=2026/); return { ok: true, json: async () => ({ events: [event] }) }; };
    const [one, two] = await Promise.all([NC.loadScoreboard(2, '2026', 2), NC.loadScoreboard(2, '2026', 2)]);
    assert.equal(calls, 1, 'in-flight requests share a cache'); assert.equal(one[0].homeScore, two[0].homeScore);
    nflContext.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(NC.loadScoreboard(3, '2026', 2), /503/);
    nflContext.fetch = async () => ({ ok: true, json: async () => ({ events: [] }) });
    assert.equal((await NC.loadScoreboard(3, '2026', 2)).length, 0, 'failed requests can retry');
    nflContext.fetch = async () => ({ ok: true, json: async () => ({ error: 'unavailable' }) });
    await assert.rejects(NC.loadScoreboard(4, '2026', 2), /Invalid NFL scoreboard/);
    console.log('PASS NFL desk: quarter scores, leaders, week boundaries, missing data, UI states, caching and retries');
})().catch(error => { console.error(error); process.exitCode = 1; });

const editorialApp = harness({ week: 3 });
const underlyingBuild = editorialApp.engine.build;
editorialApp.engine.build = opts => {
    const result = underlyingBuild(opts);
    result.stories.push({ id: 'archived-title', kind: 'story', category: 'Championship history', documentary: true, eventSeason: 2024, season: '2026', week: 2, label: '2024 · FROM THE ARCHIVE', text: 'Looking back: old champion', body: 'The 2024 championship.', rosterIds: [], weight: 999 });
    return result;
};
editorialApp.setArchive({ key: 'test|2026|1|2', status: 'ready', weeks: weeks.slice(0, 2) });
let editorialTree = editorialApp.render();
nodes(editorialTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
editorialTree = editorialApp.render();
const sidebar = nodes(editorialTree).find(n => n.props.className === 'wr-journal-headlines');
assert(sidebar && !text(sidebar).includes('old champion'), 'current headline rail excludes documentary facts');
const retrospective = nodes(editorialTree).find(n => n.props['aria-label'] === 'This week’s lookback');
assert(retrospective && text(retrospective).includes('old champion'), 'documentary feature has a separate labeled slot');
nodes(editorialTree).find(n => n.type === 'button' && text(n) === 'Stories').props.onClick();
editorialTree = editorialApp.render();
assert(!text(editorialTree).includes('Looking back: old champion'), 'stories section remains current');
console.log('PASS current-news UI: separate lookback, current-only headline rail and Stories section');

// A same-season archive cannot inherit this week's transactions or live records.
const archiveCutoff = harness({ week: 4 });
archiveCutoff.props.transactions = [{type:'waiver',status:'complete',created:Date.now(),settings:{waiver_bid:99},adds:{p1:1},roster_ids:[1]}];
archiveCutoff.setArchive({ key:'test|2026|1|3', status:'ready', weeks });
let cutoffTree = archiveCutoff.render();
nodes(cutoffTree).find(n => n.props.className === 'wr-wire-brand').props.onClick();
cutoffTree = archiveCutoff.render();
nodes(cutoffTree).find(n => n.props['aria-label'] === 'Wire topic').props.onChange({target:{value:'stories'}});
cutoffTree = archiveCutoff.render();
assert.match(text(cutoffTree), /FAAB splash/);
nodes(cutoffTree).find(n => n.props['aria-label'] === 'Story week').props.onChange({target:{value:'1'}});
cutoffTree = archiveCutoff.render();
assert.doesNotMatch(text(cutoffTree), /FAAB splash|LAST 7 DAYS|RECORD WATCH/);
nodes(cutoffTree).find(n => n.props['aria-label'] === 'Search this Wire').props.onChange({target:{value:'not-a-real-story'}});
cutoffTree = archiveCutoff.render();
assert.match(text(cutoffTree),/No matching stories/);
assert(!nodes(cutoffTree).some(n => n.props.className === 'wr-journal-story is-lead'));
console.log('PASS archive chronology and searchable story reading');
