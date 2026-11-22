'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'player-stats', 'player-cards', 'ui', 'ai', 'gamecast']) require('../js/shared/time-league-' + name + '.js');
let cursor = 0, state = [];
global.React = { Fragment: 'fragment', useRef: value => ({ current: value }), useEffect: () => {}, useMemo: fn => fn(), useCallback: fn => fn,
    useState: value => { const id = cursor++; if (!(id in state)) state[id] = typeof value === 'function' ? value() : value; return [state[id], next => { state[id] = typeof next === 'function' ? next(state[id]) : next; }]; },
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }) };
window.WR = { useViewport: () => ({ isPhone: true }) };
require('../js/components/time-league-team-panel.js'); require('../js/components/time-league-stats-panel.js');
for (const name of ['draft', 'gamecast', 'standings', 'home']) require('../js/components/time-league-' + name + '-panel.js');
require('../js/components/time-league-ceremony.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
const scoring = { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 };
const entries = Array.from({ length: 4 }, (_, i) => ({ entryId: `e${i + 1}`, editionId: `e${i + 1}`, hiddenDecade: '1990s', identity: `p${i + 1}`,
    name: ['Steve Young', 'Joe Montana', 'Dan Marino', 'Free Quarterback'][i], position: 'QB', slot: i === 1 ? 'BN' : 'QB', drawnSeason: 1993, acquiredVia: 'draft', acquiredWeek: 1 }));
const cards = new Map(entries.map(entry => [entry.identity, { ...entry, peak: 100, seasons: [1992, 1993, 1994].map(season => ({ season, games: 2, points: 24, passYd: 300, passTd: 3, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0 })) }]));
const logs = S.buildGameLogIndex(entries.flatMap(entry => [1992, 1993, 1994].flatMap(season => [1, 2].map(week => ({ identity: entry.identity, name: entry.name, position: 'QB', season, week, stats: { ...S.emptyStatLine(), passYd: week * 100, passTd: week } })))));
let league = E.createTimeLeague({ name: 'Hidden roster', seed: 'hidden-ui', createdAt: '2026-09-15T12:00:00Z', seats: [{ name: 'Home', manager: 'human' }, { name: 'Away', manager: 'human' }],
    settings: { gameDeckVersion: 1, hiddenYears: true, regularSeasonWeeks: 12, maxQuarterbacks: 3, rosterSlots: { QB: 1, BN: 1 }, scoring, waiversEnabled: true, tradesEnabled: true, eraRules: { mode: 'selected-decades', decades: ['1990s'] } } });
league = { ...league, phase: 'season', currentWeek: 2, weekStage: 'claims', seasonsRevealed: true, teams: league.teams.map((team, i) => ({ ...team, roster: i ? [entries[2]] : entries.slice(0, 2) })),
    finalizedWeeks: [{ week: 1, results: [], matchups: [], headlines: [], playerProduction: entries.slice(0, 3).map(entry => ({ ...entry, points: 8, factor: 1, stats: { ...S.emptyStatLine(), passYd: 100, passTd: 1 } })) }] };
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const classes = (tree, cls) => walk(tree).filter(node => node.props.className?.split(' ').includes(cls));
const render = (section, overrides = {}) => { cursor = 0; return WrTimeLeagueTeamPanel({ league, cards, logIndex: logs, section, activeTeamId: 't1', onUpdate: async () => true, ...overrides }); };
let tree = render('roster');
const rows = classes(tree, 'tl-lineup-row');
assert(rows.every(row => !text(row).includes('1993')), 'The true year does not appear in local roster rows');
const editions = classes(rows, 'tl-roster-edition');
assert(editions.every(node => text(node).includes('1990s') && text(node).includes('3 possible years')), 'Compact roster metadata keeps the public decade and uncertainty visible');
assert(editions.every(node => node.props['aria-label'].startsWith('1990s · hidden year · 3 possible years') && node.props.title === node.props['aria-label']), 'The complete hidden-year explanation remains available to assistive text and hover');
assert(rows.every(row => walk(row).some(node => node.props['aria-describedby'] === classes(row, 'tl-roster-edition')[0].props.id)), 'The history control is connected to its public edition description');
assert.equal(classes(tree, 'tl-player-signals').length, 2);
assert(text(tree).includes('8.0') && text(tree).includes('3 possible years'));
assert(text(rows).includes('Avg pts / game') && !text(rows).includes('Archive est. / game'), 'Observed game averages take priority over archive estimates');
assert.equal(text(classes(tree, 'tl-week-stars')[0]).includes('★'), App.TimeLeaguePlayerStats.signals(league, entries[0], logs).currentStars != null, 'Only the authorized current-week clue appears');
walk(tree).find(node => node.props['aria-label'] === "Explore Steve Young's history").props.onClick(); tree = render('roster');
const dossier = classes(tree, 'tl-roster-dossier')[0];
assert(text(dossier).includes('1992') && text(dossier).includes('1993') && text(dossier).includes('1994'), 'Every matching candidate is available to explore');
assert(text(dossier).includes('Completed game log') && text(dossier).includes('Vault W1 · 8.0 pts'));
assert(!text(dossier).includes('Your edition: 1993'));
walk(tree).find(node => node.props['aria-label'] === 'Move Steve Young').props.onClick(); tree = render('roster');
const sheet = classes(tree, 'tl-roster-move-sheet')[0];
assert(text(sheet).includes('8.0') && text(sheet).includes('3 possible years')); assert(!text(sheet).includes('1993'));
state = []; tree = render('waivers');
assert(text(tree).includes('1990s · hidden year')); assert(!text(tree).includes('1993 season'));
assert(text(tree).includes('Archive est. / game') && text(tree).includes('Across possible years'), 'Unplayed waiver players show an explicitly labeled comparable PPG estimate inline');
walk(tree).find(node => node.props['aria-label'] === 'Claim Free Quarterback').props.onClick(); tree = render('waivers');
assert(classes(tree, 'tl-hidden-year-research').length, 'The waiver decision includes the candidate-year explorer');
assert(text(tree).includes('one year from the displayed decade') && text(tree).includes('If only one year remains, it is identified.'));
state = []; tree = render('trades');
assert(text(tree).includes('EST. PTS / GAME')); assert(!text(tree).includes('1993 season'));
state = []; cursor = 0; tree = WrTimeLeagueStatsPanel({ league, cards, logIndex: logs });
assert(text(tree).includes('1990s · hidden year')); assert(!text(tree).includes('1993'));
assert(!text(tree).includes('Recorded season · reference scoring'), 'The stats page does not substitute the true season total for observed points');
state = []; cursor = 0; tree = WrTimeLeagueDraftPanel({ league, cards, onUpdate() {} });
assert(text(tree).includes('Draft complete · hidden-year mode'));
assert(!text(tree).includes('1993') && !text(tree).includes('Your grade'), 'The draft recap cannot grade or reveal actual editions');
// Scout files retain research without repeating the removed reveal tutorial.
for (const hiddenYears of [true, false]) {
    state = []; cursor = 0;
    const draft = { ...league, phase: 'draft', seasonsRevealed: false, settings: { ...league.settings, hiddenYears } };
    tree = WrTimeLeagueDraftPanel({ league: draft, cards, onUpdate() {} });
    assert(classes(tree, 'tl-scout-season-table').length, 'Removing tutorial copy keeps the candidate-season research usable');
    assert(!text(tree).includes('One fixed year is drawn') && !text(tree).includes('One of these seasons is drawn'), 'Scout files omit the requested repeated reveal tutorial in both modes');
    assert(!text(tree).includes('Your edition: 1993'), 'Condensed research never identifies the private assigned year');
}
state = []; cursor = 0; tree = WrTimeLeagueGamecastPanel({ league, cards, logIndex: logs, onUpdate() {} });
assert(text(tree).includes('1990s · hidden year') && !text(tree).includes('1993'), 'Pregame lineups preserve hidden years');
// A single candidate is an identification, never a read of the private edition.
// Deliberately make the public evidence identify 1992 while drawnSeason is 1993.
const distinctRows = entries.flatMap(entry => [1992, 1993, 1994].flatMap(season => [1, 2].map(week => ({
    identity: entry.identity, name: entry.name, position: entry.position, season, week,
    stats: { ...S.emptyStatLine(), passYd: week * (season === 1992 ? 100 : 300), passTd: week },
}))));
const distinctLogs = S.buildGameLogIndex(distinctRows);
const infer = (overrides = {}) => WrTimeLeagueIdentifiedYear(overrides.league || league, overrides.entry || entries[0], overrides.cards === undefined ? cards : overrides.cards,
    overrides.logIndex === undefined ? distinctLogs : overrides.logIndex, undefined, overrides.throughWeek);
assert.equal(infer(), 1992, 'One public matching year is identified even if a private field disagrees');
assert.equal(infer({ throughWeek: 0 }), null, 'No later game evidence enters the preseason viewer');
assert.equal(infer({ league: { ...league, currentWeek: 1 } }), null, 'Future saved weeks cannot identify a year before they are completed');
assert.equal(infer({ logIndex: logs }), null, 'Several matching years remain ambiguous');
assert.equal(infer({ logIndex: null }), null, 'Unloaded game logs cannot eliminate candidates');
assert.equal(infer({ cards: new Map() }), null, 'An unloaded candidate archive cannot invent a year');
assert.equal(infer({ logIndex: S.buildGameLogIndex(distinctRows.filter(row => row.season === 1992)) }), null, 'A partial archive cannot eliminate missing seasons');
assert.equal(infer({ league: { ...league, seasonsRevealed: false } }), null, 'The existing sealed-draft boundary is retained');
assert.equal(infer({ league: { ...league, settings: { ...league.settings, hiddenYears: false } } }), null, 'Classic seasons do not use hidden-year inference');
assert.equal(infer({ league: { ...league, yearsRevealed: true } }), null, 'The final acknowledged reveal retains its existing authoritative label');
const privateEntry = { ...entries[0] }, privateLeague = { ...league };
Object.defineProperty(privateEntry, 'drawnSeason', { get() { throw new Error('Private edition was read'); } });
for (const field of ['seed', 'hiddenYearAssignments', 'gameAssignments']) Object.defineProperty(privateLeague, field, { get() { throw new Error('Private assignment was read'); } });
assert.equal(infer({ league: privateLeague, entry: privateEntry }), 1992, 'Inference never reads seed, selected season, or future assignments');
state = []; tree = render('roster', { logIndex: distinctLogs });
assert(classes(tree, 'tl-lineup-row').every(row => classes(row, 'tl-roster-edition')[0]?.children[0] === 1992), 'The discovered year is shown once beneath the name without identified prose');
assert(!text(classes(tree, 'tl-lineup-row')).includes('1993'), 'The private edition is still absent from identified roster rows');
assert(!text(tree).includes('1 possible year'), 'The last candidate is named rather than left as a count');
assert(classes(tree, 'tl-week-stars').every(node => /this week|this Vault week|current game/i.test(node.props['aria-label'])), 'Accessible scouting describes the current clue, not the discovered year');
assert.equal(text(classes(tree, 'tl-week-stars')[0]).includes('★'), App.TimeLeaguePlayerStats.signals(league, entries[0], distinctLogs).currentStars != null, 'Identification and the authorized current-week clue are separate');
walk(tree).find(node => node.props['aria-label'] === "Explore Steve Young's history").props.onClick(); tree = render('roster', { logIndex: distinctLogs });
assert(text(classes(tree, 'tl-roster-dossier')).includes('1992'));
assert(!text(classes(tree, 'tl-hidden-year-research')).includes('not your confirmed year'), 'Research no longer contradicts an identified year');
walk(tree).find(node => node.props['aria-label'] === 'Move Steve Young').props.onClick(); tree = render('roster', { logIndex: distinctLogs });
assert(text(classes(tree, 'tl-roster-move-sheet')).includes('1992'), 'Replacement comparisons retain the identified year');
state = []; tree = render('trades', { logIndex: distinctLogs });
assert(text(tree).includes('1992') && !text(tree).includes('1993 season'), 'Trade comparisons use only the public identification');
state = []; cursor = 0; tree = WrTimeLeagueStatsPanel({ league, cards, logIndex: distinctLogs });
assert(text(tree).includes('1992') && !text(tree).includes('1993'), 'Player stats retain the identified year without private edition totals');
state = []; cursor = 0; tree = WrTimeLeagueDraftPanel({ league, cards, logIndex: distinctLogs, throughWeek: 1, onUpdate() {} });
assert(text(tree).includes('1992') && !text(tree).includes('1993'), 'Draft recap labels use the same visible evidence');
state = []; cursor = 0; tree = WrTimeLeagueDraftPanel({ league, cards, logIndex: distinctLogs, throughWeek: 0, onUpdate() {} });
assert(!text(tree).includes('1992'), 'Draft recap respects the playback cap');

// The initially advertised public pool can itself contain only one year, even
// without complete game logs. It does not need fake ambiguity until a game plays.
const initialSingle = { ...league, currentWeek: 1, finalizedWeeks: [], hiddenYearCandidates: { p1: [1994], p4: [1994] } };
assert.equal(infer({ league: initialSingle, logIndex: null }), 1994);
assert.equal(infer({ league: initialSingle, cards: new Map(), logIndex: null }), 1994, 'An explicit original public singleton remains known while archive records load');
state = []; tree = render('waivers', { league: initialSingle, logIndex: null });
assert(text(classes(tree, 'tl-waiver-edition')).includes('1994'));
assert(text(tree).includes('1994 archive'), 'Single-season estimates are labeled as that archive, not across possible years');
walk(tree).find(node => node.props['aria-label'] === 'Claim Free Quarterback').props.onClick(); tree = render('waivers', { league: initialSingle, logIndex: null });
assert(text(classes(tree, 'tl-hidden-year-research')).includes('1994'));
assert(text(tree).includes('Complete game records are not available'), 'Identification does not hide missing scoring/archive evidence');
assert(text(classes(tree, 'tl-waiver-drop-option')).includes('1994'), 'Drop comparisons agree with the public candidate pool');

// Complete loaded evidence can reject even the original single candidate.
const inconsistent = { ...league, hiddenYearCandidates: { p1: [1994] } };
assert.equal(infer({ league: inconsistent }), null, 'Zero loaded matches never fall back to the initial singleton');
state = []; tree = render('roster', { league: inconsistent, logIndex: distinctLogs });
assert(!text(classes(tree, 'tl-lineup-row')[0]).includes('identified'));
walk(tree).find(node => node.props['aria-label'] === "Explore Steve Young's history").props.onClick(); tree = render('roster', { league: inconsistent, logIndex: distinctLogs });
assert(text(classes(tree, 'tl-hidden-year-research')).includes('No candidate in the loaded archive matches'), 'Zero-match recovery remains explicit');
for (const overrides of [{ logIndex: null }, { cards: new Map() }]) {
    state = []; tree = render('roster', overrides);
    assert(!text(classes(tree, 'tl-lineup-row')).includes('identified'), 'Loading ambiguity is never presented as identification');
}

// Public observer snapshots and replay viewers get only their completed games.
const publicLeague = JSON.parse(JSON.stringify(league));
publicLeague.publicSnapshotVersion = 1; delete publicLeague.seed;
for (const team of publicLeague.teams) for (const entry of team.roster) delete entry.drawnSeason;
for (const week of publicLeague.finalizedWeeks) for (const entry of week.playerProduction) delete entry.drawnSeason;
assert.equal(infer({ league: publicLeague, entry: publicLeague.teams[0].roster[0], throughWeek: 1 }), 1992);
assert.equal(infer({ league: publicLeague, entry: publicLeague.teams[1].roster[0], throughWeek: 0 }), null, 'Another seat cannot use evidence beyond the viewer cap');
for (const throughWeek of [0, 1]) {
    state = []; tree = render('roster', { league: publicLeague, logIndex: distinctLogs, throughWeek });
    assert.equal(text(classes(tree, 'tl-lineup-row')).includes('1992'), throughWeek === 1, 'The same observer snapshot respects both historical and current views');
}

const shownWeek = { week: 13, results: league.teams.map(team => ({ teamId: team.teamId, total: team.teamId === 't1' ? 24 : 8, starters: team.roster.map(entry => ({ ...entry, points: 8, stats: { passYd: 100, passTd: 1 } })) })),
    matchups: [{ home: 't1', away: 't2', homePoints: 24, awayPoints: 8, winner: 't1' }], headlines: [] };
const finale = { ...league, phase: 'complete', currentWeek: 14, championTeamId: 't1', finalizedWeeks: [shownWeek] };
state = []; cursor = 0; tree = WrTimeLeagueHomePanel({ league: finale, onNavigate() {} });
assert(text(tree).includes('1990s · hidden year') && !text(tree).includes('1993'), 'Home leaders and championship MVP stay concealed before acknowledgement');
state = []; cursor = 0; tree = WrTimeLeagueGamecastPanel({ league: finale, cards, logIndex: logs, onUpdate() {} });
const boxButton = walk(tree).find(node => node.type === 'button' && text(node) === 'BOX SCORE');
assert(boxButton, 'The archived final game has a box score');
boxButton.props.onClick(); cursor = 0; tree = WrTimeLeagueGamecastPanel({ league: finale, cards, logIndex: logs, onUpdate() {} });
assert(text(classes(tree, 'tl-box-scores')).includes('1990s') && !text(classes(tree, 'tl-box-scores')).includes('1993'), 'Archived box scores omit true years');
league = { ...league, phase: 'complete', currentWeek: 13, yearsRevealed: false };
state = []; tree = render('roster'); assert(!text(classes(tree, 'tl-lineup-row')).includes('1993'), 'The final replay does not reveal years before acknowledgement');
league = { ...league, yearsRevealed: true };
state = []; tree = render('roster'); assert(text(classes(tree, 'tl-lineup-row')).includes('1993'), 'The acknowledged recap reveals the fixed true year');
console.log('PASS: hidden-year roster, candidate explorer, completed log, substitution, waivers, trade comparison, stats and explicit finale reveal.');
