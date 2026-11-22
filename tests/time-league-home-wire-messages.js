#!/usr/bin/env node
'use strict';
/* global App, WrTimeLeagueHomePanel, WrTimeLeagueRivalsPanel, TimeLeagueMail */
const assert = require('node:assert/strict');
global.window = globalThis;
global.App = {};
for (const module of ['roster', 'rules', 'draft-room', 'era-rules', 'season', 'helmet', 'engine', 'hidden-years', 'rivals']) require('../js/shared/time-league-' + module + '.js');
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useMemo: fn => fn(), useState: initial => [initial, () => {}], useRef: current => ({ current }), useEffect: () => {},
};
global.localStorage = { getItem: () => null, setItem: () => { throw new Error('Read-only views cannot save new mail'); } };
global.TimeLeagueHelmetIcon = () => null;
global.WrTimeLeagueStandingsPanel = () => null;
require('../js/components/time-league-postseason-desk.js');
require('../js/components/time-league-home-panel.js');
require('../js/components/time-league-rivals-panel.js');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.children);
const base = App.TimeLeagueEngine.createTimeLeague({ name: 'Wire proof', seed: 'wire-proof', createdAt: '2026-01-01T00:00:00Z', settings: { hiddenYears: true, rosterSlots: { QB: 1 }, regularSeasonWeeks: 12, playoffTeams: 0, waiversEnabled: true, tradesEnabled: true }, seats: [{ name: 'My club', manager: 'human' }, { name: 'Other desk', manager: 'human' }, { name: 'Third desk', manager: 'human' }] });
const [mine, other, third] = base.teams.map(team => team.teamId);
const entry = (entryId, name) => ({ entryId, name, identity: entryId, slot: 'QB', position: 'QB', hiddenDecade: '1980s', get drawnSeason() { throw new Error('A public story or trade package read a private year'); } });
const league = { ...base, phase: 'season', currentWeek: 1, weekStage: 'claims', teams: base.teams.map((team, index) => ({ ...team, roster: [entry(`p${index}`, ['My legend', 'Their legend', 'Third legend'][index])] })), draftPicks: [{ entryId: 'old', name: 'Drafted legend', position: 'QB', teamId: mine }], trades: [], finalizedWeeks: [], waiverResults: [] };
const trade = (tradeId, fields = {}) => ({ tradeId, fromTeamId: other, toTeamId: mine, giveEntryIds: ['p1'], receiveEntryIds: ['p0'], week: 1, status: 'pending', ...fields });
let count = 0;
const check = (label, fn) => { fn(); count++; console.log(`ok ${label}`); };
check('Wire is grounded in draft records and roster choices without touching a hidden assigned year', () => {
    const stories = App.TimeLeagueHomeWire.storiesFor(league, mine);
    assert(stories.some(row => row.title.includes('Drafted legend')));
    assert(stories.some(row => row.detail.includes('1 draft pick is saved')));
    assert(!JSON.stringify(stories).includes('1984'));
    assert.deepEqual(stories, App.TimeLeagueHomeWire.storiesFor(league, mine));
});
check('Wire includes actual own planning and settled public moves, never private rival offers or raw claim activity', () => {
    const state = { ...league, currentWeek: 2, trades: [trade('own'), trade('rival-private', { fromTeamId: other, toTeamId: third }), trade('public', { fromTeamId: other, toTeamId: third, status: 'accepted', respondedWeek: 2 })], waiverResults: [{ week: 2, identity: 'award', name: 'Awarded legend', winnerTeamId: mine, contenderTeamIds: [mine, other] }], activity: [{ kind: 'waiver', week: 2, message: 'Private $99 bid and hidden drop' }] };
    const stories = App.TimeLeagueHomeWire.storiesFor(state, mine);
    assert.equal(stories.length, 3, 'The editorial surface stays bounded');
    assert(stories.some(row => row.id === 'trade:public'));
    assert(stories.some(row => row.title.includes('Awarded legend') && row.detail.includes('2 teams filed')));
    assert(!JSON.stringify(stories).includes('rival-private') && !JSON.stringify(stories).includes('$99'));
    assert.equal(league.trades.length, 0);
});
check('Compact editorial layout keeps three complete actionable headlines and only the lead excerpt', () => {
    const state = { ...league, trades: [trade('own')], waiverResults: [{ week: 1, identity: 'award', name: 'Awarded legend', winnerTeamId: mine, contenderTeamIds: [mine] }] };
    const destinations = [];
    const tree = WrTimeLeagueHomePanel({ league: state, onNavigate: tab => destinations.push(tab) });
    const stories = walk(tree).filter(node => node.props.className === 'tl-home-wire-story');
    assert.equal(stories.length, 3);
    assert(stories.every(node => walk(node).some(child => child.type === 'strong' && text(child).trim())), 'Every story keeps its full headline');
    assert.equal(stories.filter(node => walk(node).some(child => child.type === 'span')).length, 1, 'Secondary stories omit excerpts in the markup rather than clip or hide overflow');
    stories.forEach(node => node.props.onClick());
    assert.deepEqual(destinations, ['trades', 'waivers', 'draft']);
});
check('Saved game headlines keep exact scoring and open that exact scoring archive', () => {
    const final = { week: 1, results: [{ teamId: mine, total: 100.04, starters: [] }, { teamId: other, total: 100, starters: [] }], matchups: [{ home: mine, away: other, homePoints: 100.04, awayPoints: 100, winner: mine }] };
    const state = { ...league, currentWeek: 2, finalizedWeeks: [final] };
    const stories = App.TimeLeagueHomeWire.storiesFor(state, mine);
    assert(stories[0].detail.includes('100.04–100.00') && stories[0].detail.includes('0.04 points'));
    let inspected;
    const tree = WrTimeLeagueHomePanel({ league: state, onNavigate: () => assert.fail('Scoring receipt should request its saved week'), onInspectScore: week => { inspected = week; } });
    const story = walk(tree).find(node => node.props.className === 'tl-home-wire-story' && text(node).includes('100.04'));
    assert(story); story.props.onClick(); assert.equal(inspected, 1);
    assert.equal(state.finalizedWeeks[0], final);
    const tied = { ...state, finalizedWeeks: [{ ...final, matchups: [{ ...final.matchups[0], homePoints: 100, winner: null }] }] };
    assert(App.TimeLeagueHomeWire.storiesFor(tied, mine)[0].detail.includes('The tied result stands'));
});
check('Future outcomes and later planning records are absent while first-week known proposals remain visible', () => {
    const future = { week: 2, get matchups() { throw new Error('Future outcome was inspected'); } };
    const state = { ...league, currentWeek: 3, finalizedWeeks: [future], trades: [trade('known'), trade('future', { week: 2 }), trade('later-answer', { status: 'accepted', respondedWeek: 2 })], waiverResults: [{ week: 2, identity: 'later', name: 'Later award', winnerTeamId: mine }] };
    const stories = App.TimeLeagueHomeWire.storiesFor(state, mine, 0);
    assert(stories.some(row => row.id === 'trade:known'));
    assert(!stories.some(row => row.id.startsWith('final:') || row.id === 'trade:future' || row.id === 'trade:later-answer' || row.id.startsWith('waiver:')));
    const rows = TimeLeagueMail.tradesForConversation(state, mine, other, 0);
    assert.deepEqual(rows.map(row => row.trade.tradeId), ['known']);
    const tree = WrTimeLeagueHomePanel({ league: { ...state, currentWeek: 2, weekStage: 'postgame', finalizedWeeks: [{ week: 1, get matchups() { throw new Error('Home inspected an undisclosed final'); } }] }, onNavigate: () => {}, throughWeek: 0 });
    assert(!walk(tree).some(node => node.props.className === 'tl-update-results' || node.props.className === 'tl-home-result-explainer'), 'Home itself withholds committed final recaps, scores and leaders past its supplied horizon');
});
check('Conversation packages show direction, deferred and terminal states with durable names and no raw IDs', () => {
    const state = { ...league, trades: [trade('incoming'), trade('outgoing', { fromTeamId: mine, toTeamId: other, giveEntryIds: ['old'], receiveEntryIds: ['gone'], deferredUntilWeek: 2 }), trade('accepted', { status: 'accepted', respondedWeek: 1 }), trade('rejected', { status: 'rejected', respondedWeek: 1 }), trade('withdrawn', { status: 'withdrawn', respondedWeek: 1 }), trade('unrelated', { fromTeamId: other, toTeamId: third })] };
    const rows = TimeLeagueMail.tradesForConversation(state, mine, other, 0);
    assert.equal(rows.length, 5);
    assert.equal(rows.find(row => row.trade.tradeId === 'incoming').sent, false);
    const outgoing = rows.find(row => row.trade.tradeId === 'outgoing');
    assert.equal(outgoing.status, 'Deferred until Week 2');
    assert.deepEqual(outgoing.give, ['Drafted legend']); assert.deepEqual(outgoing.receive, ['Unavailable player']);
    assert.deepEqual(new Set(rows.filter(row => row.trade.status !== 'pending').map(row => row.status)), new Set(['Accepted', 'Rejected', 'Withdrawn']));
    assert.equal(TimeLeagueMail.tradesForConversation(state, 'not-a-seat', other).length, 0);
});
check('Historical snapshot names use only visible weeks, with current ownership taking precedence', () => {
    const state = { ...league, currentWeek: 3, finalizedWeeks: [{ week: 1, results: [{ starters: [{ entryId: 'gone', name: 'Saved starter' }], bench: [{ entryId: 'reserve', name: 'Saved reserve' }] }] }, { week: 2, get results() { throw new Error('Future player snapshot was inspected'); } }], trades: [trade('archive', { giveEntryIds: ['gone', 'reserve'], receiveEntryIds: ['p0'] })] };
    const row = TimeLeagueMail.tradesForConversation(state, mine, other, 1)[0];
    assert.deepEqual(row.give, ['Saved starter', 'Saved reserve']); assert.deepEqual(row.receive, ['My legend']);
});
check('Rendered proposals open the exact existing trade, stay separate from chat and never send or persist a message', () => {
    let reviewed;
    const state = { ...league, trades: [trade('real-offer')] };
    const tree = WrTimeLeagueRivalsPanel({ league: state, teamId: mine, throughWeek: 0, onTrades: id => { reviewed = id; } });
    const proposals = walk(tree).find(node => node.props['aria-label'] === 'Trades with Other desk');
    assert(proposals && text(proposals).includes('You send My legend') && text(proposals).includes('You receive Their legend'));
    assert(!walk(proposals).some(node => node.props.className?.includes('tl-chat-message')));
    const review = walk(proposals).find(node => node.type === 'button'); review.props.onClick(); assert.equal(reviewed, 'real-offer');
    assert.equal(state.rivalMessages?.length || 0, 0);
    assert(walk(tree).some(node => node.props.className === 'tl-inbox-owner-copy' && text(node).includes('Trade · Awaiting your response')));
    const readonly = WrTimeLeagueRivalsPanel({ league: state, teamId: mine, throughWeek: 0 });
    const readProposal = walk(readonly).find(node => node.props['aria-label'] === 'Trades with Other desk');
    assert(!walk(readProposal).some(node => node.type === 'button'), 'No disconnected review control without navigation');
});
console.log(`PASS ${count} Home Wire and Messages trade groups`);
