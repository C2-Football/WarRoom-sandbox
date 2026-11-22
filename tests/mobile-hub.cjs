#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const { test } = require('node:test');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const pickerSource = app.slice(app.indexOf('        function FranchisePicker('), app.indexOf('        function handleSelectLeague('));
const helpers = app.slice(app.indexOf('        function leagueHealth('), app.indexOf('        // Pro tier icon'));
const empireAccess = app.slice(app.indexOf('    function canEnterEmpire()'), app.indexOf('    window.App.EMPIRE_ENABLED'));
const empireEntry = app.slice(app.indexOf('        function openEmpire()'), app.indexOf('        function changeEmpireWorkspace('));
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)];
const all = (tree, predicate) => walk(tree).filter(predicate);
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.children) : String(node);
const cls = name => node => (node.props.className || '').split(' ').includes(name);
const league = (id, extra = {}) => ({ id, name: 'League ' + id, wins: 1, losses: 1, roster_positions: ['QB', 'RB', 'BN'], rosters: [{ owner_id: 'me', starters: ['1', '2'] }], users: [{ user_id: 'me', metadata: { team_name: 'Team ' + id } }], scoring_settings: { rec: 1 }, settings: { type: 2 }, ...extra });
function fixture(overrides = {}) {
    const events = [];
    const context = vm.createContext({
        React: { createElement(type, props, ...children) { return { type, props: props || {}, children }; } },
        window: { App: { OD: {} }, showProLaunchPage: () => events.push('upgrade') },
        EMPIRE_FREE_PRELIVE: false, EMPIRE_ENABLED: true, COMMISH_ENABLED: true, TIME_LEAGUE_ENABLED: true,
        getUserTier: () => 'free', leagueQuery: '', hubAllLeagues: false, lastLeagueId: null, hubSyncing: false,
        commishCount: 0, pendingInvite: false, error: null, distPrefix: '', ProTierIcon: () => null,
        sleeperUser: { user_id: 'me' }, sleeperLeagues: [], sleeperUsername: 'fixture',
        sleeperCoverage: { status: 'ready', knownCount: 0, unavailable: [] },
        leagueRouteStatus: { status: 'idle' }, cancelLinkedLeagueRoute: () => {},
        accountSessionCurrent: () => true, checkedEmpireStartup: { current: false },
        setEmpireOpenLenses: () => {}, routeUrl: () => '/index.html',
        history: { pushState(state) { this.state = state; } },
        loadSleeperData: () => events.push('retry-sync'),
        setShowSettings: () => events.push('settings'), setShowConnect: () => events.push('connect'),
        setProMode: () => events.push('empire'), openCommishOffice: () => events.push('commissioner'),
        openTimeLeague: () => events.push('vault'), openDuat: () => events.push('duat'), setAllWireOpen: () => events.push('wire'),
        ...overrides,
    });
    context.setLeagueQuery = value => { context.leagueQuery = value; };
    context.setHubAllLeagues = value => { context.hubAllLeagues = value; };
    vm.runInContext(Babel.transform([helpers, empireAccess, empireEntry, pickerSource].join('\n'), { presets: ['react'] }).code, context);
    return { context, events, render: leagues => context.FranchisePicker({ leagues, onSelect: selected => events.push(selected.id) }) };
}

test('hub opens a real league first and resumes the exact previous league before other entries', () => {
    const leagues = [league('1389388885716385792'), league('1389388885716385793')];
    const { render, events, context } = fixture({ sleeperLeagues: leagues });
    let tree = render(leagues);
    let first = all(tree, n => n.type === 'button')[0];
    assert.match(text(first), /Open Team 1389388885716385792/);
    first.props.onClick(); assert.equal(events.pop(), leagues[0].id);
    context.lastLeagueId = leagues[1].id;
    tree = render(leagues); first = all(tree, n => n.type === 'button')[0];
    assert.match(text(first), /Resume Team 1389388885716385793/);
    first.props.onClick(); assert.equal(events.pop(), leagues[1].id);
    assert.equal(text(all(tree, cls('hub-league-card'))[0]).includes('Team ' + leagues[1].id), true);
    all(tree, cls('hub-wire-entry'))[0].props.onClick(); assert.equal(events.pop(), 'wire');
});

test('many leagues collapse after three while team and format search can reach every league', () => {
    const leagues = Array.from({ length: 12 }, (_, i) => league('id-' + i, i === 11 ? { roster_positions: ['QB', 'SUPER_FLEX'] } : {}));
    const { render, context, events } = fixture();
    let tree = render(leagues);
    const firstGrid = all(tree, cls('hub-league-grid'))[0];
    assert.equal(all(firstGrid, n => cls('hub-league-card')(n) && !cls('hub-league-overflow')(n)).length, 3);
    const more = all(tree, cls('hub-more-leagues'))[0];
    assert.match(text(more), /Show all 12 leagues/);
    assert.equal(more.props['aria-expanded'], false);
    assert.equal(all(firstGrid, cls('hub-league-overflow')).length, 9);
    more.props.onClick(); tree = render(leagues);
    assert.equal(all(tree, cls('is-expanded')).length, 9);
    assert.equal(all(tree, cls('hub-more-leagues'))[0].props['aria-expanded'], true);
    const search = all(tree, n => n.type === 'input')[0];
    search.props.onChange({ target: { value: 'superflex' } });
    tree = render(leagues);
    assert.equal(all(tree, cls('hub-more-leagues')).length, 0);
    const results = all(tree, cls('hub-league-card'));
    assert.equal(results.length, 1);
    results[0].props.onClick(); assert.equal(events.pop(), 'id-11');
    context.leagueQuery = 'TEAM ID-10';
    assert.equal(all(render(leagues), cls('hub-league-card')).length, 1);
    context.leagueQuery = 'not-a-league'; tree = render(leagues);
    assert.match(text(tree), /No matching leagues/);
    all(tree, n => n.type === 'button' && text(n) === 'Clear search')[0].props.onClick();
    assert.equal(context.leagueQuery, '');
});

test('unknown record stays absent and loading, empty, error and invite states remain actionable', () => {
    const { render, context, events } = fixture({ hubSyncing: true });
    let tree = render([]);
    assert.match(text(tree), /Bringing your leagues together/);
    assert.equal(all(tree, cls('hub-resume')).length, 0);
    context.hubSyncing = false; tree = render([]);
    all(tree, n => n.type === 'button' && text(n) === 'Connect a league')[0].props.onClick();
    assert.equal(events.pop(), 'connect');
    context.error = 'Connection interrupted'; context.pendingInvite = true;
    context.sleeperCoverage = { status: 'error', error: 'Connection interrupted', knownCount: null, unavailable: [] };
    tree = render([league('unknown', { wins: undefined, losses: undefined })]);
    assert.match(text(tree), /Connection interrupted/);
    assert(!/undefined|NaN/.test(text(tree)));
    assert.equal(all(tree, cls('hub-focus-record')).length, 0);
    const invite = all(tree, n => n.type === 'a' && text(n).includes('Sign in to join'))[0];
    assert.equal(invite.props.href, 'login.html?vault=1');
    all(tree, n => n.type === 'button' && text(n) === 'Manage connection')[0].props.onClick();
    assert.equal(events.pop(), 'connect');
});

test('compact product entries keep paid routing and commissioner eligibility', () => {
    const { render, context, events } = fixture();
    let tree = render([]);
    all(tree, cls('empire-hero'))[0].props.onClick(); assert.equal(events.pop(), 'upgrade');
    let commissioner = all(tree, cls('commish-hero'))[0];
    assert.equal(commissioner.props.disabled, true);
    assert.match(text(commissioner), /Requires a commissioner league/);
    context.hubSyncing = true;
    assert.match(text(all(render([]), cls('commish-hero'))[0]), /Checking commissioner access/);
    context.getUserTier = () => 'pro'; context.commishCount = 1; tree = render([]);
    all(tree, cls('empire-hero'))[0].props.onClick(); assert.equal(events.pop(), 'empire');
    assert.equal(context.history.state.view, 'pro');
    assert.equal(context.history.state.empireLenses, false);
    commissioner = all(tree, cls('commish-hero'))[0];
    assert.equal(commissioner.props.disabled, false);
    commissioner.props.onClick(); assert.equal(events.pop(), 'commissioner');
    all(tree, cls('time-league-hero'))[0].props.onClick(); assert.equal(events.pop(), 'vault');
    all(tree, cls('hub-duat-card'))[0].props.onClick(); assert.equal(events.pop(), 'duat');
});
