const assert = require('node:assert/strict');
const { test } = require('node:test');

global.App = {};
const lens = require('../js/shared/empire-lenses.js');
const roster = { owner_id: 'mine', roster_id: 1, players: ['starter'] };
const league = overrides => ({ id: 'one', season: '2026', scoring_settings: { rec: 1 }, rosters: [roster], ...overrides });
const options = { mode: 'waivers', basis: 'projected', players: {}, accountKey: 'sleeper:mine',
    nfl: { season: '2026', season_type: 'regular', week: 11 }, statsData: {}, priorData: {}, projectionsData: {} };

test('identical roster IDs are isolated by league, season, and provider', () => {
    const coOwned = { roster_id: 1, owner_id: 'other', co_owners: ['mine'], players: ['bench'] };
    const [first, second, third] = lens.list([
        league(),
        league({ id: 'two', rosters: [coOwned] }),
        league({ _mfl: true }),
    ], 'mine');
    assert.notEqual(first.key, second.key);
    assert.notEqual(first.key, third.key);
    assert.equal(first.roster, roster);
    assert.equal(second.roster, coOwned);
    assert.equal(third.roster, undefined);
    assert.equal(third.provider, 'mfl');
});

test('waiver comparisons retain each league scoring and ownership and rank verified gains', async () => {
    const current = league();
    const second = league({ id: 'two', scoring_settings: { rec: .5 } });
    const observed = [];
    App.LeagueSkin = { build: ({ league }) => ({ type: league.id === 'two' ? 'redraft' : 'dynasty' }) };
    App.RosterWaiverLens = { load: async input => {
        observed.push(input);
        return { status: 'ready', candidates: [0, 1, 5, null, 2, 3, -1].map((delta, index) => ({ id: index, weekly: { delta } })) };
    } };
    const results = await Promise.all(lens.list([current, second], 'mine').map(item => lens.load(item, options)));
    assert.deepEqual(observed.map(input => [input.league.id, input.league.scoring_settings.rec, input.week, input.rostersLeagueId]), [
        ['one', 1, 11, 'one'], ['two', .5, 11, 'two'],
    ]);
    assert.deepEqual(results[0].candidates.map(move => move.weekly.delta), [5, 3, 2]);
    assert.equal(results[0].total, 4);
});

test('historical, stale, and account-changed snapshots cannot yield recommendations', async () => {
    const [old, stale, current] = lens.list([
        league({ season: '2025' }),
        league({ id: 'two', _portfolioStale: true }),
        league({ id: 'three' }),
    ], 'mine');
    assert.equal((await lens.load(old, options)).status, 'unavailable');
    assert.equal((await lens.load(stale, options)).status, 'unavailable');
    let signedIn = true;
    App.RosterWaiverLens = { load: async () => { signedIn = false; return { status: 'ready', candidates: [] }; } };
    assert.match((await lens.load(current, { ...options, isCurrent: () => signedIn })).reason, /Account context changed/);
});

test('trade forecasts stay in the future week with explicit league scoring and verified pricing', async () => {
    const current = league();
    App.LeagueSkin.build = () => ({ type: 'dynasty' });
    App.LI_LOADED = true;
    App.LI = { sourceLeagueId: 'other-league', playerScores: { starter: 9999 } };
    App.WeeklyProj = {
        ensureWeekProjections: async (week, { season }) => {
            assert.equal(week, 12);
            assert.equal(season, '2026');
            return { starter: { rec: 1 } };
        },
        projectPlayer: (pid, input) => {
            assert.equal(input.scoring, current.scoring_settings);
            assert.equal(input.week, 12);
            return { available: true, points: { median: 1 } };
        },
    };
    App.RosterTradeLens = { load: async input => {
        assert.deepEqual(input.valuesByPid, {});
        assert.equal(input.projectionsByPid.starter.points.median, 1);
        return { status: 'unavailable' };
    } };
    const [entry] = lens.list([current], 'mine');
    const result = await lens.load(entry, { ...options, mode: 'trades' });
    assert.match(result.reason, /this league/);
    assert.equal(lens.modes.trades.tab, 'trades');
    assert.equal(lens.modes.lineup.tab, 'lineup');
    assert.equal(lens.modes.waivers.tab, 'fa');
});

test('verified prices remain isolated by account, league, season and settings and expire', () => {
    const cache = lens.createPriceCache();
    const current = league({ roster_positions: ['WR', 'BN'], total_rosters: 10 });
    const sameAccount = 'account:one', otherAccount = 'account:two';
    const time = Date.parse('2026-11-22T13:00:00Z');
    const intel = { sourceLeagueId: 'one', builtAt: new Date(time).toISOString(), playerScores: { starter: 1200 } };
    assert.equal(cache.capture(current, sameAccount, intel, { ...current, id: 'two' }, time), null);
    assert.equal(cache.capture(current, sameAccount, { ...intel, _projectedYear: 2027 }, current, time), null);
    assert.deepEqual(cache.capture(current, sameAccount, intel, current, time), { starter: 1200 });
    intel.playerScores.starter = 0;
    assert.deepEqual(cache.read(current, sameAccount, time + 1000), { starter: 1200 });
    assert.equal(cache.read(current, otherAccount, time + 1000), null);
    assert.equal(cache.read({ ...current, season: '2027' }, sameAccount, time + 1000), null);
    assert.equal(cache.read({ ...current, scoring_settings: { rec: .5 } }, sameAccount, time + 1000), null);
    assert.equal(cache.read(current, sameAccount, time + 15 * 60 * 1000), null);
});
