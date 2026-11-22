'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');
const helper = source.slice(source.indexOf('    async function fetchSleeperLinkedLeague('), source.indexOf('    // Read-only ownership context'));
const user = { user_id: 'owner', username: 'fixture' };
const league = { league_id: '1660000000000000001', name: 'Historical 2025', season: '2025', sport: 'nfl', settings: { type: 2 } };
const rosters = [{ roster_id: 1, owner_id: 'other', co_owners: ['owner'], players: ['p1'], settings: { wins: 12, losses: 2 } }];
const ok = data => ({ ok: true, json: async () => data });
function api(overrides = {}) {
    const requests = [];
    const data = { ['league/' + league.league_id]: league, 'user/fixture': user, 'user/owner/leagues/nfl/2025': [league],
        ['league/' + league.league_id + '/rosters']: rosters, ['league/' + league.league_id + '/users']: [user], ...overrides };
    return { requests, fetcher: async (url, options) => { const key = url.split('/v1/')[1]; requests.push(key); const value = data[key]; return typeof value === 'function' ? value(options) : ok(value); } };
}
const loader = () => { const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController } }); vm.runInContext(helper, context); return context.fetchSleeperLinkedLeague; };
const options = fetcher => ({ username: 'fixture', leagueId: league.league_id, fetcher });

test('historical links resolve the provider season and ownership before loading its roster, including co-owners', async () => {
    const fixture = api(), result = await loader()(options(fixture.fetcher));
    assert.equal(result.league.season, '2025'); assert.equal(result.league.id, league.league_id);
    assert.equal(result.league.myRosterId, 1); assert.equal(result.league.wins, 12); assert.equal(result.league.rosters[0].players[0], 'p1');
    assert.deepEqual(fixture.requests.slice(0, 3), ['league/' + league.league_id, 'user/fixture', 'user/owner/leagues/nfl/2025']);
    assert.equal(fixture.requests.some(path => path.includes('/2026')), false, 'historical details never use current-year league membership');
});

test('unconnected or invalid season links cannot become private league context or trigger roster requests', async () => {
    const disconnected = api({ 'user/owner/leagues/nfl/2025': [] });
    await assert.rejects(loader()(options(disconnected.fetcher)), /not connected/);
    assert.equal(disconnected.requests.some(path => /\/(rosters|users)$/.test(path)), false);
    for (const info of [null, { ...league, league_id: 'different' }, { ...league, season: 'unknown' }, { ...league, sport: 'nba' }]) {
        const fixture = api({ ['league/' + league.league_id]: info });
        await assert.rejects(loader()(options(fixture.fetcher)), /valid football league season/); assert.equal(fixture.requests.length, 1);
    }
    const fixture = api(); await assert.rejects(loader()({ ...options(fixture.fetcher), username: '' }), /Connect your Sleeper/); assert.equal(fixture.requests.length, 0);
});

test('malformed or failed details remain unavailable and the same link can recover on retry', async () => {
    for (const value of [null, {}, [{ roster_id: 1, players: 'wrong' }], [{ roster_id: 1, co_owners: {} }], () => ({ ok: false })]) {
        const fixture = api({ ['league/' + league.league_id + '/rosters']: value });
        await assert.rejects(loader()(options(fixture.fetcher)), /unavailable/);
    }
    const fixture = api(); assert.equal((await loader()(options(fixture.fetcher))).league.wins, 12);
    const slow = api({ ['league/' + league.league_id]: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('timeout'), { name: 'AbortError' })))) });
    await assert.rejects(loader()({ ...options(slow.fetcher), timeoutMs: 5 }), { name: 'AbortError' });
});

test('an account change during metadata lookup prevents membership requests and any result', async () => {
    let release, current = true;
    const fixture = api({ ['league/' + league.league_id]: () => new Promise(resolve => { release = () => resolve(ok(league)); }) });
    const work = loader()({ ...options(fixture.fetcher), isCurrent: () => current });
    current = false; release(); await assert.rejects(work, /Account changed/); assert.equal(fixture.requests.length, 1);
});

function controller(fetcher, installed = false) {
    let principalCurrent = true;
    const location = { hash: '#league=' + league.league_id + '&tab=stats', search: '?dev=true', pathname: '/' };
    const context = vm.createContext({ console, URLSearchParams, setTimeout, clearTimeout,
        sleeperUsername: 'fixture', sleeperUser: user, selectedLeague: null, activeTab: 'dashboard', leagueRouteStatus: { status: 'idle' },
        defaultTab: require('../js/shared/league-workspaces.js').defaultTab({ isInstalledApp: installed }),
        sleeperLeagues: [{ id: 'current', season: '2026' }], linkedLeaguesRef: { current: new Map() }, linkedRouteRequestRef: { current: 0 }, initialRouteAppliedRef: { current: false }, isNavigatingRef: { current: false },
        accountSessionCurrent: () => principalCurrent, AppStorage: { set() {} }, APP_WR_KEYS: {},
        rememberHubLastVisit: (value, owner) => { context.lastVisit = { value, owner }; },
        setActiveLeagueId: value => { context.activeLeagueId = value; }, setSelectedLeague: value => { context.selectedLeague = value; },
        setActiveTab: value => { context.activeTab = value; }, setSleeperUser: value => { context.sleeperUser = value; },
        setLeagueRouteStatus: value => { context.leagueRouteStatus = value; }, setProMode() {},
        window: { location, AbortController, fetch: fetcher }, history: { replaceState: (state, title, url) => { location.hash = new URL(url, 'http://localhost').hash; } },
    });
    vm.runInContext(helper, context);
    vm.runInContext(source.slice(source.indexOf('        function buildHash('), source.indexOf('        useEffect(() => {\n            if (sleeperUsername)')), context);
    return { context, changeAccount: () => { principalCurrent = false; } };
}

test('browser and installed launches choose their own home while explicit links retain their view', () => {
    for (const installed of [false, true]) {
        const { context } = controller(api().fetcher, installed);
        const expected = installed ? 'dashboard' : 'lenses';
        assert.equal(context.parseHash('#league=' + league.league_id).tab, expected);
        assert.equal(context.buildHash(league.league_id), '#league=' + league.league_id + '&tab=' + expected);
        context.restoreLinkedLeague({ id: league.league_id }, {});
        assert.equal(context.activeTab, expected);
        for (const tab of ['dashboard', 'lenses', 'stats', 'brief']) {
            const route = context.parseHash('#league=' + league.league_id + '&tab=' + tab);
            context.restoreLinkedLeague({ id: league.league_id }, route);
            assert.equal(context.activeTab, tab === 'brief' ? 'dashboard' : tab);
        }
        context.window.location.search = '?leagueId=' + league.league_id + '&tab=lenses';
        assert.equal(context.parseHash('').tab, 'lenses');
    }
});

test('actual route controller recovers after an error without mixing historical leagues into current portfolio', async () => {
    let fails = true;
    const fixture = api({ ['league/' + league.league_id]: () => fails ? { ok: false } : ok(league) });
    const { context } = controller(fixture.fetcher), route = { leagueId: league.league_id, tab: 'stats' };
    context.sleeperUser = null;
    await context.resolveLinkedLeagueRoute(route); assert.equal(context.leagueRouteStatus.status, 'error'); assert.equal(context.selectedLeague, null);
    fails = false; await context.resolveLinkedLeagueRoute(route);
    assert.equal(context.leagueRouteStatus.status, 'idle'); assert.equal(context.selectedLeague.season, '2025'); assert.equal(context.activeTab, 'stats');
    assert.equal(context.lastVisit.owner, 'owner'); assert.equal(context.linkedLeaguesRef.current.size, 1);
    assert.equal(context.sleeperLeagues.length, 1); assert.equal(context.sleeperLeagues[0].season, '2026');
});

test('actual route controller cannot reopen a canceled link or publish a delayed prior-account response', async () => {
    for (const cancel of ['navigation', 'account']) {
        let release;
        const fixture = api({ ['league/' + league.league_id]: () => new Promise(resolve => { release = () => resolve(ok(league)); }) });
        const { context, changeAccount } = controller(fixture.fetcher);
        const work = context.resolveLinkedLeagueRoute({ leagueId: league.league_id, tab: 'stats' });
        if (cancel === 'navigation') context.cancelLinkedLeagueRoute(true); else changeAccount();
        release(); await work;
        assert.equal(context.selectedLeague, null); assert.equal(context.linkedLeaguesRef.current.size, 0); assert.equal(fixture.requests.length, 1);
        if (cancel === 'navigation') { assert.equal(context.leagueRouteStatus.status, 'idle'); assert.equal(context.window.location.hash, ''); }
    }
});

test('initial route reports an unconnected account and allows late provider hydration to supersede lookup', async () => {
    const start = source.indexOf('        React.useEffect(() => {\n            if (initialRouteAppliedRef.current)');
    const end = source.indexOf('\n        useEffect(() => {', start);
    assert.ok(start >= 0 && end > start, 'extract the initial linked-league route effect');
    const effect = source.slice(start, end);
    const fixture = api(), first = controller(fixture.fetcher).context;
    const init = context => Object.assign(context, { React: { useEffect: fn => fn() }, loading: false, sleeperLeagues: [],
        sleeperCoverage: {}, espnLeagues: [], mflLeagues: [], visibleEspnLeagues: [], visibleMflLeagues: [] });
    init(first); first.sleeperUsername = ''; first.loading = true;
    vm.runInContext(effect, first); await new Promise(resolve => setImmediate(resolve));
    assert.equal(first.leagueRouteStatus.status, 'error'); assert.match(first.leagueRouteStatus.message, /Connect your Sleeper/); assert.equal(fixture.requests.length, 0);
    let release;
    const delayed = api({ ['league/' + league.league_id]: () => new Promise(resolve => { release = () => resolve(ok(league)); }) });
    const second = controller(delayed.fetcher).context; init(second);
    vm.runInContext(effect, second); assert.equal(second.leagueRouteStatus.status, 'loading');
    second.visibleEspnLeagues = [{ id: league.league_id, provider: 'espn', name: 'Late provider connection', season: '2026' }];
    vm.runInContext(effect, second); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.selectedLeague.provider, 'espn'); assert.equal(second.selectedLeague.season, '2026');
    assert.equal(second.leagueRouteStatus.status, 'idle'); assert.equal(delayed.requests.length, 1);
});
