const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout, window: { AbortController, App: {} } });
vm.runInContext(source.slice(source.indexOf('    async function fetchSleeperPortfolio('), source.indexOf('    // Read-only ownership context')), context);
const load = context.fetchSleeperPortfolio;
const user = { user_id: 'me', username: 'owner' };
const leagues = ['alpha', 'beta'].map(id => ({ league_id: id, name: id, status: 'in_season', settings: { type: 2 } }));
const rows = [{ roster_id: 1, owner_id: 'me', players: ['p1'], settings: { wins: 1, losses: 0 } }];
const ok = body => ({ ok: true, json: async () => body });
function fixture(overrides = {}) {
    const replies = { 'user/owner': user, 'user/me/leagues/nfl/2026': leagues, 'league/alpha/rosters': rows, 'league/beta/rosters': rows, 'league/alpha/users': [user], 'league/beta/users': [user], ...overrides };
    return async (url, options) => {
        const value = replies[url.split('/v1/')[1]];
        if (value instanceof Error) throw value;
        if (typeof value === 'function') return value(options);
        return ok(value);
    };
}
const options = extra => ({ username: 'owner', season: '2026', ...extra });

test('all failed details retain known league count without inventing rosters', async () => {
    const result = await load(options({ fetcher: fixture({ 'league/alpha/rosters': Error('503'), 'league/beta/users': Error('503') }) }));
    assert.equal(result.coverage.knownCount, 2);
    assert.equal(result.coverage.loadedCount, 0);
    assert.equal(result.coverage.status, 'error');
    assert.equal(result.coverage.unavailable.length, 2);
    assert.equal(result.leagues.length, 0);
});

test('partial success publishes usable leagues with an explicit unknown remainder', async () => {
    const result = await load(options({ fetcher: fixture({ 'league/beta/rosters': null }) }));
    assert.equal(result.coverage.status, 'partial');
    assert.equal(result.coverage.knownCount, 2);
    assert.equal(result.coverage.loadedCount, 1);
    assert.equal(result.coverage.failedCount, 1);
    assert.equal(result.leagues[0].id, 'alpha');
    assert.equal(result.coverage.unavailable[0].id, 'beta');
    const retried = await load(options({ fetcher: fixture(), previous: result }));
    assert.equal(retried.coverage.status, 'ready');
    assert.equal(retried.coverage.freshCount, 2);
});

test('normalized leagues retain provider bracket overrides and preserve unknown seeding evidence', async () => {
    const result = await load(options({ fetcher: fixture({
        'user/me/leagues/nfl/2026': [{ ...leagues[0], bracket_overrides_id: null }, leagues[1]],
    }) }));
    assert.equal(result.leagues[0].bracket_overrides_id, null);
    assert.equal(Object.hasOwn(result.leagues[1], 'bracket_overrides_id'), false);
});

test('fast leagues stream before slow ones and final order stays in provider order', async () => {
    let release;
    const seen = [];
    const work = load(options({ fetcher: fixture({ 'league/alpha/rosters': () => new Promise(resolve => { release = () => resolve(ok(rows)); }) }), onProgress: result => seen.push(result) }));
    while (!release || !seen.some(result => result.coverage.freshCount === 1)) await new Promise(resolve => setImmediate(resolve));
    assert.equal(seen.at(-1).leagues[0].id, 'beta');
    assert.equal(seen.at(-1).coverage.pendingCount, 1);
    release();
    const result = await work;
    assert.equal(result.leagues.map(league => league.id).join(','), 'alpha,beta');
    assert.equal(result.coverage.status, 'ready');
});

test('refresh preserves failed leagues as explicitly stale while updating successful ones', async () => {
    const previous = await load(options({ fetcher: fixture() }));
    const result = await load(options({ previous, fetcher: fixture({ 'league/beta/users': Error('offline'), 'league/alpha/rosters': [{ ...rows[0], settings: { wins: 3 } }] }) }));
    assert.equal(result.leagues.length, 2);
    assert.equal(result.leagues[0].wins, 3);
    assert.equal(result.leagues[0]._portfolioStale, false);
    assert.equal(result.leagues[1].wins, 1);
    assert.equal(result.leagues[1]._portfolioStale, true);
    assert.equal(result.coverage.staleCount, 1);
    assert.equal(result.coverage.status, 'partial');
});

test('unavailable or malformed league list retains last data; verified empty list clears removed leagues', async () => {
    const previous = await load(options({ fetcher: fixture() }));
    for (const value of [null, {}, Error('offline')]) {
        const result = await load(options({ previous, fetcher: fixture({ 'user/me/leagues/nfl/2026': value }) }));
        assert.equal(result.coverage.status, 'stale');
        assert.equal(result.coverage.listVerified, false);
        assert.equal(result.leagues.length, 2);
        assert(result.leagues.every(league => league._portfolioStale));
    }
    const empty = await load(options({ previous, fetcher: fixture({ 'user/me/leagues/nfl/2026': [] }) }));
    assert.equal(empty.coverage.status, 'ready');
    assert.equal(empty.coverage.knownCount, 0);
    assert.equal(empty.leagues.length, 0);
});

test('duplicate league IDs cannot inflate coverage and slow requests eventually release retry', async () => {
    const duplicate = await load(options({ fetcher: fixture({ 'user/me/leagues/nfl/2026': [leagues[0], leagues[0]] }) }));
    assert.equal(duplicate.coverage.knownCount, 1);
    const result = await load(options({ timeoutMs: 5, fetcher: fixture({ 'league/beta/rosters': ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')))) }) }));
    assert.equal(result.coverage.status, 'partial');
    assert.equal(result.coverage.pendingCount, 0);
});

test('previous data cannot cross a provider identity or season', async () => {
    const previous = await load(options({ fetcher: fixture() }));
    for (const changed of [{ username: 'someone-else' }, { season: '2025' }]) {
        const result = await load(options({ previous, fetcher: async () => { throw Error('offline'); }, ...changed }));
        assert.equal(result.leagues.length, 0);
        assert.equal(result.coverage.knownCount, undefined);
        assert.equal(result.coverage.status, 'error');
    }
});

test('app refresh returns actual data even when React defers updater callbacks; concurrent retries share work', async () => {
    let release, calls = 0;
    const appContext = vm.createContext({
        sleeperUsername: 'owner', selectedYear: '2026', window: { App: {} },
        sleeperSnapshotRef: { current: {} }, hubRevalidatingRef: { current: null }, hubSyncedAtRef: { current: 0 },
        setLoading() {}, setError() {}, setSleeperCoverage() {}, setSleeperLeagues() {}, setSleeperUser() {},
        fetchSleeperPortfolio: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    });
    vm.runInContext(source.slice(source.indexOf('        function syncSleeperPortfolio()'), source.indexOf('        // Hub freshness (audit:refresh-stale step 10)')), appContext);
    const first = appContext.revalidateSleeperData();
    const second = appContext.revalidateSleeperData();
    assert.equal(first, second);
    assert.equal(calls, 1);
    const result = { user, leagues: [{ id: 'alpha' }], coverage: { status: 'ready', listVerified: true } };
    release(result);
    assert.equal(await first, result.leagues);
    assert.equal(appContext.sleeperSnapshotRef.current, result);
    assert.equal(appContext.hubRevalidatingRef.current, null);
});

test('late completion from an old season cannot overwrite or finish a newer refresh', async () => {
    const releases = [], applied = [], loading = [];
    const appContext = vm.createContext({
        sleeperUsername: 'owner', selectedYear: '2025', window: { App: {} },
        sleeperSnapshotRef: { current: {} }, hubRevalidatingRef: { current: null }, hubSyncedAtRef: { current: 0 },
        setLoading: value => loading.push(value), setError() {}, setSleeperCoverage() {}, setSleeperLeagues: value => applied.push(value), setSleeperUser() {},
        fetchSleeperPortfolio: () => new Promise(resolve => releases.push(resolve)),
    });
    vm.runInContext(source.slice(source.indexOf('        function syncSleeperPortfolio()'), source.indexOf('        // Hub freshness (audit:refresh-stale step 10)')), appContext);
    const old = appContext.revalidateSleeperData();
    appContext.selectedYear = '2026';
    const current = appContext.revalidateSleeperData();
    releases[0]({ user, leagues: [{ id: 'old' }], coverage: { status: 'ready', listVerified: true } });
    assert.equal(await old, null);
    assert.equal(appContext.hubRevalidatingRef.current, current);
    assert.equal(applied.length, 0);
    assert.equal(loading.includes(false), false);
    const result = { user, leagues: [{ id: 'current' }], coverage: { status: 'ready', listVerified: true } };
    releases[1](result);
    assert.equal(await current, result.leagues);
    assert.equal(applied[0], result.leagues);
});

test('shared player context and Empire mark partial coverage without counting failed rosters as empty', () => {
    vm.runInContext(source.slice(source.indexOf('    function buildPortfolioPlayerContext('), source.indexOf('    window.App.PortfolioContext =')), context);
    const globals = fs.readFileSync(path.join(__dirname, '../js/tabs/global-view.js'), 'utf8');
    vm.runInContext(globals.slice(globals.indexOf('function tierColor('), globals.indexOf('// Scenario math')), context);
    const loaded = [{ id: 'alpha', name: 'Alpha', settings: { type: 2 }, rosters: rows }];
    const coverage = { status: 'partial', knownCount: 2, loadedCount: 1, staleCount: 0 };
    const ownership = context.buildPortfolioPlayerContext(loaded, 'me', 'p1', coverage);
    assert.equal(ownership.count, 1); assert.equal(ownership.totalLeagues, 2); assert.equal(ownership.complete, false);
    const model = context.buildEmpirePortfolioModel({ allLeagues: loaded, sleeperUserId: 'me', playersData: { p1: { full_name: 'Fixture Player', position: 'WR' } }, portfolioCoverage: coverage });
    assert.equal(model.coverage.complete, false);
    assert.equal(model.provinces.length, 1);
    assert(model.dataQuality.items.some(item => item.key === 'coverage' && item.status === 'partial'));
    vm.runInContext(globals.slice(globals.indexOf('function buildCommandBridge('), globals.indexOf("if (typeof window !== 'undefined')", globals.indexOf('function buildCommandBridge('))), context);
    const bridge = context.buildCommandBridge({ model });
    assert.match(bridge.kpis.find(item => item.key === 'value').sub, /loaded leagues/);
    assert.match(bridge.kpis.find(item => item.key === 'exposure').sub, /loaded leagues|incomplete/);
});
