#!/usr/bin/env node
'use strict';
const assert = require('assert');
global.window = globalThis; global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'ai', 'ui', 'player-stats']) require('../js/shared/time-league-' + module + '.js');
let states = [], cursor = 0;
global.React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props, children }),
    useMemo: fn => fn(), useState: value => { const i = cursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], next => { states[i] = next; }]; },
    useRef: () => ({ current: null }), useEffect: () => {}, Fragment: 'fragment',
};
global.TimeLeagueHelmetIcon = () => null;
require('../js/components/time-league-postseason-desk.js');
for (const module of ['standings', 'home', 'team']) require('../js/components/time-league-' + module + '-panel.js');
const E = App.TimeLeagueEngine, S = App.TimeLeagueSeason;
let league = E.createTimeLeague({ name: 'UI smoke', seed: 'ui', createdAt: '2026-01-01', settings: { gameDeckVersion: 0, hiddenYears: false, rosterSlots: { QB: 1, BN: 1 }, regularSeasonWeeks: 12, playoffTeams: 4, scoring: { passTd: 4, reception: .5, rushRecYd: .1, passingYd: .04, turnover: -2 } }, seats: Array.from({ length: 4 }, (_, i) => ({ name: 'Team ' + i, manager: i ? 'ai' : 'human' })) });
league = { ...league, phase: 'season', weekStage: 'lineup', seasonsRevealed: true, currentWeek: 7 };
const render = fn => { cursor = 0; return fn(); };
const home = JSON.stringify(render(() => WrTimeLeagueHomePanel({ league, onNavigate: () => {} })));
assert(home.includes('Playoff Hunt')); assert(!home.includes('League briefing')); assert(!home.includes('Command Central'));
states = [];
assert(!JSON.stringify(render(() => WrTimeLeagueHomePanel({ league: { ...league, currentWeek: 1 }, onNavigate: () => {} }))).includes('Playoff Hunt'));

function verifyPostseasonDesk(count) {
    const playoffRounds = Math.log2(count);
    const regularSeasonWeeks = 14 - playoffRounds;
    const game = E.createTimeLeague({
        name: `${count}-team bracket`, seed: `desk-${count}`, createdAt: '2026-01-01',
        settings: { ...league.settings, regularSeasonWeeks, playoffTeams: count, draftOrderMode: 'random' },
        seats: Array.from({ length: Math.max(count, 4) }, (_, index) => ({ name: `Club ${index + 1}`, manager: index ? 'ai' : 'human' })),
    });
    const strength = new Map(game.teams.map((team, index) => [team.teamId, 100 - index * 7]));
    const teamId = game.teams[0].teamId;
    const finals = game.schedule.map(({ week, pairs }) => ({
        week,
        results: game.teams.map(team => ({
            teamId: team.teamId,
            total: strength.get(team.teamId),
            starters: [{ name: 'Visible starter', position: 'QB', points: strength.get(team.teamId),
                get drawnSeason() { throw new Error('The Desk opened a sealed edition'); } }],
        })),
        matchups: pairs.map(([home, away]) => ({
            home, away, homePoints: strength.get(home), awayPoints: strength.get(away),
            winner: strength.get(home) > strength.get(away) ? home : away,
        })),
    }));
    const state = { ...game, phase: 'season', currentWeek: regularSeasonWeeks, finalizedWeeks: finals.slice(0, -1) };
    const { buildDesk } = App.TimeLeaguePostseasonDesk;
    const race = buildDesk(state, teamId);
    assert.equal(race.remaining, 1);
    assert.equal(race.field[0].status, 'Clinched');
    if (count < game.teams.length) assert.equal(race.field.at(-1).status, 'Eliminated');
    assert.equal(race.rounds.length, 0);

    state.finalizedWeeks = finals;
    state.currentWeek = regularSeasonWeeks + 1;
    const bracket = buildDesk(state, teamId);
    assert.equal(bracket.rounds[0].matches.length, count / 2);
    assert.equal(bracket.rounds[0].past, false);
    assert.equal(bracket.rounds[0].matches[0].positionEdge.position, 'QB');
    assert.equal(bracket.rounds[0].matches[0].home.recent.games, 3);
    assert(bracket.rounds[0].matches[0].opponentRates.every(Number.isFinite));
    assert(bracket.rounds[0].matches[0].lastMeeting.includes('Last meeting'));
    assert(!JSON.stringify(bracket).includes('drawnSeason'));

    const hiddenFinal = { week: state.currentWeek, get matchups() { throw new Error('The Desk read an undisclosed result'); } };
    const hidden = buildDesk({ ...state, currentWeek: state.currentWeek + 1, finalizedWeeks: [...finals, hiddenFinal] }, teamId, regularSeasonWeeks);
    assert.deepStrictEqual(hidden, bracket);

    for (let round = 0; round < playoffRounds; round++) {
        const week = state.currentWeek;
        const pairs = E.playoffPairs(state, week);
        state.finalizedWeeks = [...state.finalizedWeeks, { week, results: [], matchups: pairs.map(([home, away], index) => ({
            home, away, homePoints: index === 0 ? 95 : 94.96, awayPoints: 95, winner: index === 0 ? home : away,
        })) }];
        state.currentWeek++;
    }
    state.phase = 'complete';
    const recap = buildDesk(state, teamId);
    assert.equal(recap.rounds.length, playoffRounds);
    assert.equal(recap.rounds.at(-1).name, 'Championship');
    assert.equal(recap.champion, game.teams[0].name);
    assert.equal(recap.rounds[0].matches[0].margin, 0);
    if (count > 2) {
        assert.equal(recap.rounds[0].matches[1].margin, 4);
        assert(recap.rounds[0].matches[1].upset);
    }
    const opened = [];
    const recapView = WrTimeLeaguePostseasonDesk({ desk: recap, onInspectScore: week => opened.push(week) });
    const boxScore = walk(recapView).find(node => node.type === 'button' && node.children.includes('Week 14 box scores →'));
    boxScore.props.onClick();
    assert.deepStrictEqual(opened, [14]);
}

const entries = [{ entryId: 'start', identity: 'qb:a', name: 'Starter', position: 'QB', drawnSeason: 2000, slot: 'QB' }, { entryId: 'bench', identity: 'qb:b', name: 'Reserve', position: 'QB', drawnSeason: 2000, slot: 'BN' }];
league.teams[0].roster = entries;
const cards = new Map(entries.map(entry => [entry.identity, { identity: entry.identity, seasons: [{ season: 2000, points: 100 }] }]));
const index = new Map();
for (const entry of entries) for (let week = 1; week <= 14; week++) index.set(S.gameLogKey(entry.identity, 2000, week), { stats: { ...S.emptyStatLine(), passYd: week * 10 } });
let applied;
states = [];
const roster = () => render(() => WrTimeLeagueTeamPanel({ league, cards, section: 'roster', activeTeamId: league.teams[0].teamId, onSelectTeam: () => {}, onUpdate: (next, action) => { applied = { next, action }; }, logIndex: index }));
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
[2, 4, 8].forEach(verifyPostseasonDesk);
let tree = roster();
assert(JSON.stringify(tree).includes('Avg pts / game')); assert(JSON.stringify(tree).includes('W7 game rating'));
assert(!JSON.stringify(tree).includes('Lineup tips & scouting'));
const currentKey = S.gameLogKey(entries[0].identity, 2000, 7), currentLog = index.get(currentKey);
index.delete(currentKey); tree = roster();
const warning = walk(tree).find(node => node.props?.className === 'tl-roster-game-warning');
assert(JSON.stringify(warning).includes('Starter') && JSON.stringify(warning).includes('0 pts'), 'The actual no-game status stays concise and names its affected player');
walk(warning).find(node => node.props?.['aria-label'] === 'Compare replacements for Starter').props.onClick();
assert(walk(roster()).some(node => node.props?.role === 'dialog' && node.props['aria-label'] === 'Move Starter'), 'The warning still opens real legal replacement choices');
walk(roster()).find(node => node.props?.['aria-label'] === 'Close lineup choices').props.onClick();
index.set(currentKey, currentLog); tree = roster();
let rows = walk(tree).filter(node => node.props?.draggable);
assert.equal(rows.length, 2);
rows[1].props.onDragStart({ dataTransfer: { setData: () => {} } });
rows = walk(roster()).filter(node => node.props?.draggable);
rows[0].props.onDrop({ preventDefault: () => {} });
assert.equal(applied.action.targetEntryId, 'start');
assert.equal(applied.next.teams[0].roster.find(entry => entry.entryId === 'bench').slot, 'QB');
assert.equal(applied.next.teams[0].roster.find(entry => entry.entryId === 'start').slot, 'BN');
league = { ...league, weekStage: 'ready' };
assert.equal(walk(roster()).filter(node => node.props?.draggable).length, 0);
states = [];
const finalWeek = { week: 6, headlines: [], results: league.teams.map(team => ({ teamId: team.teamId, total: 20, starters: [], bench: [] })), matchups: [{ home: league.teams[0].teamId, away: league.teams[1].teamId, homePoints: 20, awayPoints: 10, winner: league.teams[0].teamId }] };
const finalHome = JSON.stringify(render(() => WrTimeLeagueHomePanel({ league: { ...league, weekStage: 'postgame', finalizedWeeks: [finalWeek] }, onNavigate: () => {} })));
assert(finalHome.includes('FINAL')); assert(finalHome.includes('Week 6 recap')); assert(!finalHome.includes('UPCOMING'));
assert(finalHome.includes('Around the league') && finalHome.includes('UP NEXT · WEEK 7'));
assert(finalHome.includes('End week opens the next planning window'));
assert(!finalHome.includes('tl-home-action-grid'), 'The postgame view is a recap, not the normal planning dashboard'); assert(finalHome.includes('The scores are final.'));
assert(finalHome.includes('Around the league')); assert(!finalHome.includes('tl-home-pulse')); assert(!finalHome.includes('PRESEASON EDITION'));

const leagueTwelve = E.createTimeLeague({ name: 'Phone league', seed: 'phone-ui', createdAt: '2026-01-01', settings: { ...league.settings, draftOrderMode: undefined, draftTeamOrder: undefined },
    seats: Array.from({ length: 12 }, (_, i) => ({ name: i === 0 ? 'The Very Long Named Phone Test Champions' : `Manager ${i + 1}`, manager: i ? 'ai' : 'human' })) });
const resultRows = leagueTwelve.teams.map((team, i) => ({ teamId: team.teamId, total: 100-i, starters: [{ entryId: `star-${i}`, name: `Standout ${i + 1}`, drawnSeason: 2000+i, points: 20+i, stats: S.emptyStatLine() }], bench: [] }));
const matchRows = leagueTwelve.schedule[0].pairs.map(([home, away]) => {
    const homePoints = resultRows.find(row => row.teamId === home).total, awayPoints = resultRows.find(row => row.teamId === away).total;
    return { home, away, homePoints, awayPoints, winner: homePoints > awayPoints ? home : away };
});
const phoneLeague = { ...leagueTwelve, settings: { ...leagueTwelve.settings, waiversEnabled: true, tradesEnabled: true }, phase: 'season', currentWeek: 2, weekStage: 'claims', finalizedWeeks: [{ week: 1, results: resultRows, matchups: matchRows }], activity: [{ id: 'move-1', kind: 'trade', week: 2, message: 'A current-week trade update.' }] };
let target;
states = [];
tree = render(() => WrTimeLeagueHomePanel({ league: phoneLeague, onNavigate: tab => { target = tab; } }));
const flattened = walk(tree);
const actions = flattened.filter(node => node.type === 'button' && node.props?.className?.startsWith('tl-home-action '));
assert.equal(actions.length, 2);
actions[0].props.onClick(); assert.equal(target, 'waivers');
actions[1].props.onClick(); assert.equal(target, 'trades');
assert.equal(flattened.filter(node => node.props?.className === 'tl-update-match').length, 6, 'Every matchup remains in the weekly result grid');
const update = flattened.find(node => node.props?.className === 'tl-card tl-league-update');
assert(JSON.stringify(update).includes('Standout 12')); assert(JSON.stringify(update).includes('31.0 pts'));
assert(!JSON.stringify(update).includes('A current-week trade update.'), 'The weekly score summary no longer repeats the raw activity feed');
assert.equal(flattened.filter(node => node.props?.className === 'tl-matchup-helmet is-left').length, 1, 'Only the left Home helmet is mirrored');
const links = walk(update).filter(node => node.type === 'button');
links.find(node => JSON.stringify(node.children).includes('Replays & box scores')).props.onClick(); assert.equal(target, 'gameday');
links.find(node => JSON.stringify(node.children).includes('All activity')).props.onClick(); assert.equal(target, 'activity');
states = [];
const drawStandings = () => render(() => WrTimeLeagueStandingsPanel({ league: phoneLeague, embedded: true }));
tree = drawStandings();
const phoneRows = walk(tree).filter(node => node.props?.className?.startsWith('tl-standings-mobile-row'));
assert.equal(phoneRows.length, 12, 'Phone standings retain all twelve teams without relying on horizontal table columns');
assert(phoneRows[0].props['aria-label'].includes('The Very Long Named Phone Test Champions'));
phoneRows[0].props.onClick({ currentTarget: { focus() {} } }); tree = drawStandings();
assert(walk(tree).some(node => node.props?.className === 'tl-command-intel tl-card'));
walk(tree).find(node => node.props?.['aria-label'] === 'Close team details').props.onClick(); tree = drawStandings();
assert(!walk(tree).some(node => node.props?.className === 'tl-command-intel tl-card'));
console.log('PASS: native weekly results and links, left-only Home helmet, and twelve-team phone standings with details');
console.log('PASS: unified Home, halfway Playoff Hunt, star rendering, exact drop swap, and game-day roster lock');
