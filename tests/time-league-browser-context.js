'use strict';
// Render the real shell and its navigation/header helpers. No browser,
// network, account or durable game mutation is involved in these checks.
const assert = require('node:assert/strict');
global.window = globalThis;
window.App = {};
for (const name of ['roster', 'rules', 'draft-room', 'era-rules', 'types', 'season', 'helmet', 'engine', 'rivals', 'ai', 'actions', 'ui']) require(`../js/shared/time-league-${name}.js`);
const E = window.App.TimeLeagueEngine;
let state = [], refs = [], cursor = 0, refCursor = 0;
global.React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
        const bucket = state, i = cursor++;
        if (!(i in bucket)) bucket[i] = typeof initial === 'function' ? initial() : initial;
        return [bucket[i], next => { bucket[i] = typeof next === 'function' ? next(bucket[i]) : next; }];
    },
    useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
};
window.localStorage = { getItem: () => null };
window.requestAnimationFrame = () => {};
let phone = false;
window.WR = { useViewport: () => ({ isPhone: phone }) };
for (const name of ['Setup', 'Draft', 'Home', 'Team', 'Gamecast', 'Stats', 'Rivals']) window[`WrTimeLeague${name}Panel`] = function Panel() {};
window.WrTimeLeagueWeekGates = function WeekGates() {};
window.App.TimeLeaguePlayerCards = {};
window.TimeLeagueMail = {
    presentation: league => ({ league }),
    readKey: (id, seat) => `${id}:${seat}`,
    readIds: () => [],
    unreadMessages: (league, seat, read, throughWeek) => (league.rivalMessages || []).filter(message => message.toTeamId === seat && !read.includes(message.id) && (throughWeek === undefined || message.week <= throughWeek)),
};
require('../js/tabs/time-league.js');
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.children) : String(node);
const byClass = (tree, value) => walk(tree).find(node => String(node.props?.className || '').split(' ').includes(value));
const component = (tree, name) => walk(tree).find(node => node.type === window[`WrTimeLeague${name}Panel`]);
const button = (tree, label) => walk(tree).find(node => node.type === 'button' && text(node).trim().endsWith(label));
const fixture = (patch = {}) => ({
    ...E.createTimeLeague({ name: 'Header and navigation', seed: 'browser-context', createdAt: '2026-01-01T00:00:00Z',
        seats: [{ name: 'Owner', manager: 'human' }, { name: 'Friend', manager: 'human' }],
        settings: { hiddenYears: true, rosterSlots: { QB: 1, BN: 1 }, regularSeasonWeeks: 12, maxQuarterbacks: 2, tradesEnabled: true } }),
    phase: 'season', currentWeek: 2, weekStage: 'claims', seasonsRevealed: true,
    rivalMessages: [{ id: 'saved-message', fromTeamId: 't2', toTeamId: 't1', name: 'Friend', text: 'Saved conversation', week: 1 }],
    ...patch,
});
function mount(league, tab = 'home', online = null) {
    state = []; refs = [];
    state[1] = league; state[4] = tab; state[5] = 't1'; state[6] = new Map([['fixture-card', {}]]); state[7] = new Map(); state[11] = online;
    const own = state, ownRefs = refs;
    return () => { state = own; refs = ownRefs; cursor = refCursor = 0; return window.TimeLeague({ onClose() {} }); };
}
function renderHelper(node) {
    const own = state, ownRefs = refs;
    state = []; refs = []; cursor = refCursor = 0;
    try { return node.type(node.props); }
    finally { state = own; refs = ownRefs; cursor = refCursor = 0; }
}
const eraNode = tree => walk(tree).find(node => typeof node.type === 'function' && node.type.name === 'LeagueEraSummary');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };

test('Trades precedes Player stats in the real desktop and mobile overflow navigation across season contexts', () => {
    for (const phase of ['season', 'complete']) for (const weekStage of ['claims', 'lineup', 'ready', 'postgame']) {
        const draw = mount(fixture({ phase, weekStage }));
        let tree = draw();
        const nav = byClass(tree, 'tl-sidenav');
        const labels = walk(nav).filter(node => node.type === 'button').map(text);
        const trades = labels.findIndex(value => value.includes('TRADES')), stats = labels.findIndex(value => value.includes('PLAYER STATS'));
        assert(trades >= 0 && stats > trades, `${phase}/${weekStage}: desktop Trades before stats`);
        const mobileNode = walk(tree).find(node => node.type?.name === 'MobileGameNav');
        phone = true;
        const mobile = renderHelper(mobileNode), more = walk(mobile).find(node => node.type === 'dialog');
        const mobileLabels = walk(more).filter(node => node.type === 'button').map(text);
        assert(mobileLabels.findIndex(value => value.trim().endsWith('Trades')) < mobileLabels.findIndex(value => value.trim().endsWith('Player stats')));
        button(more, 'Trades').props.onClick(); tree = draw();
        assert.equal(component(tree, 'Team').props.section, 'trades', 'The ordered destination still opens its actual workspace');
        assert.equal(byClass(tree, 'tl-sidenav').children.flat(Infinity).find(node => node?.type === 'button' && text(node).includes('TRADES')).props['aria-current'], 'page');
        phone = false;
    }
});

test('Home has no compact conversation in any stage or viewport, while Messages remains a working separate destination', () => {
    for (const isPhone of [false, true]) for (const phase of ['season', 'complete']) for (const weekStage of ['claims', 'lineup', 'ready', 'postgame']) {
        phone = isPhone;
        const league = fixture({ phase, weekStage }), before = JSON.stringify(league), draw = mount(league);
        let tree = draw();
        assert(!component(tree, 'Rivals'), `No Home conversation at ${isPhone}/${phase}/${weekStage}`);
        const nav = byClass(tree, 'tl-sidenav'); button(nav, 'MESSAGES 1').props.onClick(); tree = draw();
        const messages = component(tree, 'Rivals');
        assert(messages); assert.equal(messages.props.teamId, 't1'); assert.equal(messages.props.isPrivate, false); assert.notEqual(messages.props.compact, true);
        assert.equal(typeof messages.props.onSend, 'function'); assert.equal(typeof messages.props.onRead, 'function');
        const fieldset = walk(tree).find(node => node.type === 'fieldset'); assert(!component(fieldset, 'Rivals'), 'Message access stays outside game-write disabling');
        assert.equal(JSON.stringify(league), before, 'Navigation does not alter saved conversations or game state');
    }
    phone = false;
});

test('header unread action opens the correct message thread; online Messages keeps the claimed owner and privacy', () => {
    let draw = mount(fixture()), tree = draw();
    const unread = walk(byClass(tree, 'tl-league-bar')).find(node => node.type === 'button' && node.props.title === 'Unread messages');
    assert(unread); assert.match(unread.props['aria-label'], /^1 unread messages/);
    unread.props.onClick(); tree = draw();
    assert.equal(component(tree, 'Rivals').props.threadRequest.teamId, 't2');
    assert(!walk(byClass(tree, 'tl-league-bar')).some(node => node.props?.title === 'Unread messages'), 'Messages does not repeat the same header trigger');
    draw = mount(fixture(), 'messages', { role: 'member', seatTeamId: 't2', draftStarted: true, members: [] }); tree = draw();
    assert.equal(component(tree, 'Rivals').props.teamId, 't2'); assert.equal(component(tree, 'Rivals').props.isPrivate, true);
});

test('first-time playback keeps the message horizon and returning Home no longer remounts the compact inbox', () => {
    const league = fixture(), draw = mount(league, 'messages'); let tree = draw();
    const cast = component(tree, 'Gamecast'); assert(cast);
    cast.props.onPlaybackChange({ leagueId: league.leagueId, week: 1, done: false, replay: false }); tree = draw();
    assert.equal(component(tree, 'Rivals').props.throughWeek, 0);
    assert(!walk(byClass(tree, 'tl-league-bar')).some(node => node.props?.title === 'Unread messages'));
    cast.props.onPlaybackChange({ leagueId: league.leagueId, week: 1, done: true, replay: false }); tree = draw();
    assert.equal(tree.props['data-vault-tab'], 'home'); assert(!component(tree, 'Rivals'));
    button(byClass(tree, 'tl-sidenav'), 'MESSAGES 1').props.onClick(); tree = draw();
    assert.equal(component(tree, 'Rivals').props.throughWeek, undefined);
});

test('era summary is in the league header after the draft, including completed seasons, and never during the draft', () => {
    const sample = fixture({ teams: [{ teamId: 't1', name: 'Owner', manager: 'human', roster: [{ hiddenDecade: '1980s' }] }, { teamId: 't2', name: 'Friend', manager: 'human', roster: [] }] });
    for (const phase of ['season', 'complete']) {
        const tree = mount({ ...sample, phase })(), header = byClass(tree, 'tl-league-bar'), node = eraNode(header);
        assert(node); const summary = renderHelper(node);
        assert.equal(summary.props.role, 'group'); assert.equal(summary.props['aria-label'], 'Eras on the field'); assert(text(summary).includes('1980s'));
        assert(!eraNode(byClass(header, 'tl-league-menu')), 'The public era context is visible outside the closed options menu');
    }
    const draft = mount({ ...sample, phase: 'draft', seasonsRevealed: false }, 'draft')();
    assert(!eraNode(draft), 'Draft disclosure remains inside its existing reveal/board surfaces');
});

test('era context preserves the phase, saved-week and active-playback header labels', () => {
    for (const [patch, expected] of [
        [{ phase: 'season', currentWeek: 5, weekStage: 'ready' }, 'WEEK 5'],
        [{ phase: 'season', currentWeek: 5, weekStage: 'postgame' }, 'FINAL · WEEK 4'],
        [{ phase: 'complete', currentWeek: 15 }, 'COMPLETE'],
    ]) {
        const header = byClass(mount(fixture(patch))(), 'tl-league-bar');
        assert(text(byClass(header, 'tl-league-context')).includes(expected));
        assert(eraNode(header));
    }
    const league = fixture({ currentWeek: 5 }), before = JSON.stringify(league), draw = mount(league);
    const cast = component(draw(), 'Gamecast');
    cast.props.onPlaybackChange({ leagueId: league.leagueId, week: 2, done: false, replay: false, playing: true });
    assert(text(byClass(draw(), 'tl-league-context')).includes('PLAYING · WEEK 2'));
    cast.props.onPlaybackChange({ leagueId: league.leagueId, week: 2, done: false, replay: true, playing: false });
    assert(text(byClass(draw(), 'tl-league-context')).includes('REPLAY · WEEK 2'));
    assert.equal(JSON.stringify(league), before, 'Header presentation never advances or rewrites the season');
});

test('hidden canonical and public snapshots use only advertised roster decades, never the private drawn year', () => {
    const helper = eraNode(mount(fixture())()); assert(helper);
    let secretReads = 0;
    const entry = decade => Object.defineProperty({ hiddenDecade: decade }, 'drawnSeason', { enumerable: true, get() { secretReads++; throw new Error('Private assigned year accessed'); } });
    const hidden = fixture({ teams: [{ roster: [entry('2020s'), entry('1980s')] }, { roster: [entry('1970s'), entry('1980s'), entry('invalid'), entry(undefined)] }],
        draftPicks: [{ hiddenDecade: '1990s' }], settings: { ...fixture().settings, hiddenYears: true, eraRules: { mode: 'selected-decades', decades: ['1990s', '2010s'] } } });
    for (const phase of ['season', 'complete']) {
        const summary = helper.type({ league: { ...hidden, phase, yearsRevealed: false } });
        assert.deepEqual(walk(summary).filter(node => node.props?.title).map(text), ['1970s', '1980s', '2020s']);
        assert(!text(summary).includes('1990s') && !text(summary).includes('2010s'), 'Allowed pool/history is not the current roster');
    }
    assert.equal(secretReads, 0);
    const publicCopy = { ...hidden, teams: hidden.teams.map(team => ({ roster: team.roster.map(row => ({ hiddenDecade: row.hiddenDecade })) })) };
    assert.deepEqual(helper.type({ league: publicCopy }), helper.type({ league: hidden }));
    assert.equal(secretReads, 0, 'Comparison still does not inspect a canonical private edition');
    assert.equal(helper.type({ league: { ...hidden, teams: [{ roster: [entry(undefined)] }, {}] } }), null, 'Missing public decades never fall back to private years');
});

test('public assigned seasons determine decades only after the permitted reveal; empty or invalid rosters invent no era', () => {
    const helper = eraNode(mount(fixture())());
    const league = fixture({ teams: [{ roster: [{ hiddenDecade: '2020s', drawnSeason: 1984 }, { drawnSeason: 2012 }, { drawnSeason: 2018 }] }, { roster: [] }] });
    const hidden = helper.type({ league }); assert.deepEqual(walk(hidden).filter(node => node.props?.title).map(text), ['2020s']);
    for (const settings of [{ ...league.settings, hiddenYears: false }, league.settings]) {
        const current = { ...league, settings, yearsRevealed: settings.hiddenYears };
        const before = JSON.stringify(current), summary = helper.type({ league: current });
        assert.deepEqual(walk(summary).filter(node => node.props?.title).map(text), ['1980s', '2010s']);
        assert(!text(summary).includes('1984') && !text(summary).includes('2012') && !text(summary).includes('2018'));
        assert.equal(JSON.stringify(current), before);
    }
    assert.equal(helper.type({ league: { ...league, teams: [{ roster: [] }, {}] } }), null);
    assert.equal(helper.type({ league: { ...league, teams: [{ roster: [{ hiddenDecade: 'invalid' }] }] } }), null);
});
test('Messages review opens the exact owned, visible trade without changing a saved offer', () => {
    const sample = fixture({ trades: [
        { tradeId: 'own-offer', fromTeamId: 't2', toTeamId: 't1', status: 'pending', week: 1 },
        { tradeId: 'foreign-offer', fromTeamId: 't3', toTeamId: 't4', status: 'pending', week: 1 },
        { tradeId: 'withheld-offer', fromTeamId: 't1', toTeamId: 't2', status: 'accepted', week: 8 },
    ] });
    const before = JSON.stringify(sample);
    // The inbox projection supplies visibility; the shell must honor it as well
    // as ownership when a stale or invalid link is invoked.
    const original = TimeLeagueMail.tradesForConversation;
    TimeLeagueMail.tradesForConversation = (room, owner, other) => room.trades.filter(trade =>
        trade.tradeId !== 'withheld-offer' && [trade.fromTeamId, trade.toTeamId].includes(owner)
        && [trade.fromTeamId, trade.toTeamId].includes(other)).map(trade => ({ trade }));
    try {
        const draw = mount(sample, 'messages');
        const inbox = component(draw(), 'Rivals');
        inbox.props.onTrades('foreign-offer');
        assert.equal(draw().props['data-vault-tab'], 'messages');
        inbox.props.onTrades('withheld-offer');
        assert.equal(draw().props['data-vault-tab'], 'messages');
        inbox.props.onTrades('own-offer');
        let tree = draw(), request = component(tree, 'Team').props.tradeRequest;
        assert.equal(tree.props['data-vault-tab'], 'trades');
        assert.deepEqual(request, { leagueId: sample.leagueId, teamId: 't1', tradeId: 'own-offer', requestId: 1 });
        inbox.props.onTrades('own-offer');
        assert.equal(component(draw(), 'Team').props.tradeRequest.requestId, 2, 'Reopening an offer schedules a fresh focus request');
        const online = mount(sample, 'messages', { role: 'member', seatTeamId: 't2', draftStarted: true });
        component(online(), 'Rivals').props.onTrades('own-offer');
        request = component(online(), 'Team').props.tradeRequest;
        assert.equal(request.teamId, 't2', 'The claimed seat owns the review context');
        assert.equal(JSON.stringify(sample), before, 'Navigation never files, accepts or duplicates an offer');
    } finally {
        if (original) TimeLeagueMail.tradesForConversation = original;
        else delete TimeLeagueMail.tradesForConversation;
    }
});
console.log(`PASS ${passed} Vault navigation, Home mail, phase context and public-era groups`);
