'use strict';
const assert = require('node:assert/strict');
global.window = globalThis; global.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'ai', 'gamecast']) require('../js/shared/time-league-' + name + '.js');
let states = [], refs = [], cursor, refCursor;
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => refs[refCursor++] ||= { current: initial },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
};
global.TimeLeagueHelmetIcon = () => null;
global.WrTimeLeagueStandingsPanel = () => null;
require('../js/components/time-league-postseason-desk.js');
require('../js/components/time-league-home-panel.js');
require('../js/components/time-league-gamecast-panel.js');
const E = App.TimeLeagueEngine, G = App.TimeLeagueGamecast, S = App.TimeLeagueSeason;
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.children)];
const words = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(words).join(' ') : words(node.children);
const base = E.createTimeLeague({ name: 'A real scoring bye', seed: 'scoring-bye', createdAt: '2026-01-01',
    settings: { hiddenYears: true, gameDeckVersion: 1, regularSeasonWeeks: 12, playoffTeams: 0, rosterSlots: { QB: 1 },
        scoring: { passingYd: .04, passTd: 4, turnover: -2, rushRecYd: .1, reception: .5 } },
    seats: ['You', 'Rival one', 'Rival two'].map((name, index) => ({ name, manager: index ? 'ai' : 'human' })) });
const mine = base.teams[0].teamId;
const others = base.teams.slice(1).map(team => team.teamId);
const schedule = base.schedule.map(week => week.week === 1 ? { ...week, pairs: [others] } : week);
const teams = base.teams.map((team, index) => ({ ...team, roster: [{ entryId: 'q-' + index, identity: 'qb:' + index, name: 'Saved QB ' + index,
    position: 'QB', slot: 'QB', drawnSeason: 2000 + index, hiddenDecade: '2000s' }] }));
const ready = { ...base, teams, schedule, phase: 'season', seasonsRevealed: true, weekStage: 'ready' };
const results = teams.map((team, index) => ({ teamId: team.teamId, total: 4 + index,
    starters: team.roster.map(entry => ({ ...entry, points: 4 + index, factor: 1, stats: { ...S.emptyStatLine(), passYd: 100 + index * 25 } })) }));
const saved = { week: 1, results, matchups: [{ home: others[0], away: others[1], homePoints: 5, awayPoints: 6, winner: others[1] }], headlines: [] };
const postgame = { ...ready, currentWeek: 2, weekStage: 'postgame', finalizedWeeks: [saved] };
const render = (league, extra = {}) => { cursor = refCursor = 0; return WrTimeLeagueGamecastPanel({ league, cards: new Map(), logIndex: new Map(), active: true, onUpdate() {}, ...extra }); };
const reset = () => { states = []; refs = []; };
let tree = render(ready);
assert(words(tree).includes('still scores this week') && words(tree).includes('no head-to-head win, loss or tie'));
assert(nodes(tree).some(node => node.props['aria-label'] === 'Starting lineup on a regular-season bye'));
assert(!words(tree).includes('Empty slot'), 'A bye does not fabricate an opposing empty lineup');
assert(!/\b2000\b/.test(words(tree)), 'An unpaired starting lineup keeps its assigned year concealed');

reset(); tree = render(postgame);
assert(words(tree).includes('Final lineup points: 4.00'));
nodes(tree).find(node => node.type === 'button' && words(node) === 'BOX SCORE').props.onClick();
tree = render(postgame);
const boxes = nodes(tree).filter(node => node.props.className === 'tl-box-team');
assert.equal(boxes.length, 3, 'Every saved result is reachable, including an unpaired bye team');
assert.equal(boxes[0].props['aria-label'], 'You box score', 'The bye team stays first for its viewer');
assert(words(tree).includes('Regular-season bye') && words(tree).includes('all-play'));
assert(words(boxes[0]).includes('Saved fantasy points') && words(boxes[0]).includes('100 passing yards'));
assert(!/\b2000\b/.test(words(boxes[0])), 'A bye receipt discloses only its authorized decade');
assert(!words(boxes[0]).includes('◆'), 'A bye result is never decorated as a win');

reset();
tree = render(postgame, { autoPlayWeek: 1 });
assert(words(tree).includes('Opening Week 1 gamecast'));
assert(!words(tree).includes('Final lineup points: 4.00') && !words(tree).includes('100 passing yards'), 'The first render before playback effects contains no saved player production or total');
assert(!nodes(tree).some(node => node.props['aria-label'] === 'Saved week archive'), 'Pending playback cannot briefly expose the saved archive');

reset();
states[0] = { timeline: G.buildGamecast({ ...saved, seed: 'presentation', scoring: ready.settings.scoring }), weekData: saved, live: true };
states[1] = 0;
tree = render(postgame);
assert(words(tree).includes('Lineup points so far: 0.00'));
assert(!nodes(tree).some(node => node.props['aria-label'] === 'Saved week archive'), 'First playback cannot expose unpaired final receipts');
assert(!words(tree).includes('100 passing yards'), 'The bye player production waits for its scoring moments too');

let requested;
tree = WrTimeLeagueHomePanel({ league: postgame, onNavigate() {}, onInspectScore: week => { requested = week; } });
assert(words(tree).includes('Your bye week is complete.'));
assert(words(tree).includes('4.00 saved lineup points') && words(tree).includes('all-play'));
nodes(tree).find(node => node.type === 'button' && words(node) === 'Scoring & box scores →').props.onClick();
assert.equal(requested, 1);

// An actual absent playoff matchup is observation, not a regular scoring bye.
const playoffBase = E.createTimeLeague({ name: 'Observe the playoffs', seed: 'observe', createdAt: '2026-01-01',
    settings: { regularSeasonWeeks: 12, playoffTeams: 2, rosterSlots: { QB: 1 } },
    seats: Array.from({ length: 4 }, (_, index) => ({ name: 'Team ' + index, manager: index === 3 ? 'human' : 'ai' })) });
const observerId = playoffBase.teams[3].teamId;
const playoff = { ...playoffBase, phase: 'season', seasonsRevealed: true, currentWeek: 13, weekStage: 'lineup' };
tree = WrTimeLeagueHomePanel({ league: playoff, onNavigate() {}, seatTeamId: observerId });
assert(words(tree).includes('following the playoffs') && !words(tree).includes('BYE'));
reset(); tree = render(playoff, { seatTeamId: observerId });
assert(words(tree).includes('Its lineup does not block kickoff'));
assert(!nodes(tree).some(node => node.props['aria-label'] === 'Starting lineup on a regular-season bye'));
assert(!words(tree).includes('Final lineup points'), 'An observer gets no invented team score');
console.log('PASS: scoring byes show real saved starters, receipts and PF/all-play context; live scores remain concealed until earned; playoff observers get no fake bye, lineup or result.');
