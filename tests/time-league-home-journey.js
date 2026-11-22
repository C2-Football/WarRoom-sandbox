#!/usr/bin/env node
'use strict';
/* global require, global, WrTimeLeagueHomePanel */
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years']) require('../js/shared/time-league-' + module + '.js');
global.React = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props, children }),
    useMemo: fn => fn(),
};
global.TimeLeagueHelmetIcon = () => null;
global.WrTimeLeagueStandingsPanel = () => null;
global.WrTimeLeagueCeremony = () => ({ type: 'section', props: { 'aria-label': 'Championship ceremony' }, children: ['Saved champion'] });
require('../js/components/time-league-postseason-desk.js');
require('../js/components/time-league-home-panel.js');
const Engine = App.TimeLeagueEngine;
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const content = node => !node ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(content).join(' ') : content(node.children);
const section = (tree, className) => walk(tree).find(node => node.props?.className === className);
let target;
const render = league => WrTimeLeagueHomePanel({ league, onNavigate: tab => { target = tab; } });
const click = (tree, label) => {
    const button = walk(tree).find(node => node.type === 'button' && content(node).includes(label));
    assert(button, `Missing action: ${label}`);
    button.props.onClick();
    return target;
};
const base = Engine.createTimeLeague({
    name: 'Home journey', seed: 'home-journey', createdAt: '2026-01-01T00:00:00Z',
    settings: { hiddenYears: true, rosterSlots: { QB: 1 }, regularSeasonWeeks: 12, playoffTeams: 4, waiversEnabled: true, tradesEnabled: true },
    seats: Array.from({ length: 4 }, (_, index) => ({ name: index ? `Rival ${index}` : 'My team', manager: index ? 'ai' : 'human' })),
});
const mine = base.teams[0].teamId;
const opponent = base.schedule[0].pairs.find(pair => pair.includes(mine)).find(id => id !== mine);
const season = { ...base, phase: 'season', seasonsRevealed: true, weekStage: 'claims', teams: base.teams.map(team => ({ ...team, roster: [{ entryId: `entry-${team.teamId}`, identity: 'qb:legend', name: 'Legend', position: 'QB', slot: 'QB', drawnSeason: 1984, hiddenDecade: '1980s' }] })) };
const before = JSON.stringify(season);
let tree = render(season);
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review waiver claims'), 'waivers');
assert(!content(section(tree, 'tl-home-hero-copy')).includes('head to game day'));
assert.equal(walk(tree).filter(node => node.props?.className?.startsWith('tl-home-action ')).length, 2);
tree = render({ ...season, settings: { ...season.settings, waiversEnabled: false } });
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review trades'), 'trades');
assert.equal(walk(tree).filter(node => node.props?.className?.startsWith('tl-home-action ')).length, 1);
tree = render({ ...season, settings: { ...season.settings, waiversEnabled: false, tradesEnabled: false } });
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review lineup'), 'roster');
assert(!section(tree, 'tl-home-action-grid'));

const offers = [
    { tradeId: 'current', status: 'pending', fromTeamId: opponent, toTeamId: mine },
    { tradeId: 'future', status: 'pending', fromTeamId: opponent, toTeamId: mine, deferredUntilWeek: 2 },
    { tradeId: 'outgoing', status: 'pending', fromTeamId: mine, toTeamId: opponent },
];
tree = render({ ...season, weekStage: 'lineup', trades: offers });
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review lineup'), 'roster');
assert(content(tree).includes('1 offer waiting'));
assert(!content(tree).includes('2 offers waiting'));
assert.equal(walk(tree).filter(node => node.props?.className?.startsWith('tl-home-action ')).length, 1, 'Only current incoming trade decisions remain during lineup');
tree = render({ ...season, weekStage: 'lineup', trades: offers.filter(offer => offer.tradeId !== 'current') });
assert(!section(tree, 'tl-home-action-grid'), 'Deferred trades do not invent open decisions');
tree = render({ ...season, weekStage: 'ready' });
assert(content(section(tree, 'tl-home-hero-copy')).includes('Lineup locked'));
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Go to game day'), 'gameday');
assert(!section(tree, 'tl-home-action-grid'));
const empty = { ...season, weekStage: 'lineup', teams: season.teams.map(team => team.teamId === mine ? { ...team, roster: [] } : team) };
tree = render(empty);
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review roster needs'), 'roster');
assert(content(section(tree, 'tl-home-hero-copy')).includes('cannot fill every required slot'));
tree = render({ ...empty, weekStage: 'ready' });
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Review roster needs'), 'roster');
assert(content(section(tree, 'tl-home-hero-copy')).includes('roster recovery notice'));
assert(!content(section(tree, 'tl-home-hero-copy')).includes('reopen lineups'), 'Assignment changes cannot repair an impossible roster');
tree = render({ ...empty, settings: { ...empty.settings, waiversEnabled: false, tradesEnabled: false } });
assert(content(section(tree, 'tl-home-hero-copy')).includes('both disabled'));
const movable = { ...empty, teams: season.teams.map(team => team.teamId === mine ? { ...team, roster: team.roster.map(entry => ({ ...entry, slot: 'BN' })) } : team) };
tree = render(movable);
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Fix lineup (1)'), 'roster');
assert(content(section(tree, 'tl-home-hero-copy')).includes('1 lineup decision'));

function finalState(homePoints, awayPoints, winner, week = 1) {
    const points = new Map([[mine, homePoints], [opponent, awayPoints]]);
    return { ...season, currentWeek: week + 1, weekStage: 'postgame', finalizedWeeks: [{
        week, headlines: [], matchups: [{ home: mine, away: opponent, homePoints, awayPoints, winner }],
        results: season.teams.map(team => ({ teamId: team.teamId, total: points.get(team.teamId) || 0, starters: team.teamId === mine ? [
            { entryId: 'star', identity: 'qb:legend', name: 'My top starter', position: 'QB', drawnSeason: 1984, points: Math.round((homePoints - 20) * 100) / 100 },
            { entryId: 'other', identity: 'rb:other', name: 'Other starter', position: 'RB', drawnSeason: 2006, points: 20 },
        ] : [] })),
    }] };
}
const closeWin = finalState(100.04, 100.02, mine);
const finalBefore = JSON.stringify(closeWin);
tree = render(closeWin);
assert(content(tree).includes('Won by 0.02 points'));
assert(content(tree).includes('100.04') && content(tree).includes('100.02'), 'Close finals retain the precision used to decide the result');
assert(content(tree).includes('My top starter') && content(tree).includes('80.04 points'));
assert(content(tree).includes('Recorded historical game statistics'));
assert(content(tree).includes('league’s scoring'));
assert(!content(tree).includes('1984'), 'The recap does not expose a concealed season');
assert.equal(click(tree, 'Scoring & box scores'), 'gameday');
let inspectedWeek;
target = null;
tree = WrTimeLeagueHomePanel({ league: closeWin, onNavigate: tab => { target = tab; }, onInspectScore: week => { inspectedWeek = week; } });
click(tree, 'Scoring & box scores');
assert.equal(inspectedWeek, 1, 'The recap requests its exact saved week, including when the current week has advanced');
assert.equal(target, null, 'The parent handles opening and focusing the requested scoring archive');
assert.equal(JSON.stringify(closeWin), finalBefore, 'Reading results and navigating never changes the saved final');
tree = render(finalState(100.02, 100.04, opponent));
assert(content(tree).includes('Lost by 0.02 points'));
tree = render(finalState(100.02, 100.02, null));
assert(content(tree).includes('A tied score. Regular-season ties stand.'));
tree = render(finalState(100.02, 100.02, mine, 13));
assert(content(tree).includes('The higher seed wins the playoff tiebreaker.'));
assert(content(tree).includes('A win in the books.'));

const eliminated = finalState(90, 100, opponent, 13);
const otherTeams = eliminated.teams.filter(team => team.teamId !== mine && team.teamId !== opponent);
eliminated.finalizedWeeks[0].matchups.push({ home: otherTeams[0].teamId, away: otherTeams[1].teamId, homePoints: 20, awayPoints: 10, winner: otherTeams[0].teamId });
tree = render({ ...eliminated, weekStage: 'claims' });
assert.equal(click(section(tree, 'tl-home-hero-actions'), 'Follow the playoffs'), 'gameday');
assert(content(tree).includes('Your team is out of this playoff round'));
assert(!section(tree, 'tl-home-action-grid'), 'Eliminated teams are not prompted to make irrelevant claims for the playoff round');

const completed = { ...closeWin, phase: 'complete', championTeamId: opponent };
tree = render(completed);
assert(content(tree).includes('Saved champion'));
assert(content(tree).includes('Your season is saved.'));
assert.equal(click(tree, 'My career'), 'career');
assert.equal(click(tree, 'Review my team'), 'roster');
assert(content(tree).includes('Switch league'));
const narrowFinal = finalState(100.04, 100, mine);
const narrowBefore = JSON.stringify(narrowFinal);
tree = render(narrowFinal);
let resultRows = walk(tree).find(node => node.props?.['aria-label'] === 'Week 1 results');
assert(content(resultRows).includes('100.04') && content(resultRows).includes('100.00'), 'Postgame league finals cannot round a narrow win into an apparent tie');
tree = render({ ...narrowFinal, weekStage: 'claims' });
assert(content(tree).includes('0.04-point margin')); assert(!content(tree).includes('0.0-point margin'));
resultRows = walk(tree).find(node => node.props?.['aria-label'] === 'Week 1 results');
assert(content(resultRows).includes('100.04') && content(resultRows).includes('100.00'), 'Returning Home keeps the prior saved final precise');
const winnerRow = walk(resultRows).find(node => node.props?.className === 'winner');
assert(content(winnerRow).includes('My team') && content(winnerRow).includes('100.04'));
assert.equal(JSON.stringify(narrowFinal), narrowBefore);
tree = render({ ...finalState(100.04, 100.04, null), weekStage: 'claims' });
assert(content(tree).includes('Tie game')); assert(!content(tree).includes('0.00-point margin'), 'An actual tied score stays a tie rather than a misleading zero margin');
assert.equal(JSON.stringify(season), before, 'Home reads preserve the league');
console.log('PASS Home journey: legal stage actions, current offers, exact saved results and closest margins, tied finals, hidden years, playoff observers, completed-season routes and no mutation');
