const assert = require('node:assert/strict');
const { test } = require('node:test');

global.App = {};
require('../js/shared/chopped.js');
require('../js/shared/roster-lens-basis.js');
require('../js/shared/league-wire-playoffs.js');
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
    assert.deepEqual(results[0].candidates.map(move => move.weekly.delta), [5, 3, 2, 1]);
    assert.equal(results[0].total, 4);
});

test('combined roster rows use player IDs, keep distinct league moves, and skip filtered and stale results', () => {
    const [a, b, c, d] = lens.list(['a', 'b', 'c', 'd'].map(id => league({ id })), 'mine');
    const move = (id, pid, pos, delta) => ({ id, incoming: [{ pid, pos, name: 'Same Name' }], outgoing: [{ pid: 'outgoing-only', pos }],
        weekly: { delta } });
    const first = move('first', 'target', 'WR', 7);
    const second = move('second', 'target', 'WR', 2);
    const rows = {
        [a.key]: { league: a.league, result: { candidates: [first, second, first, move('def', 'defender', 'EDGE', 1)] } },
        [b.key]: { league: b.league, result: { candidates: [first, move('same-name', 'other', 'WR', null), move('zero', 'zero', 'WR', 0)] } },
        [c.key]: { league: c.league, result: { candidates: [move('filtered', 'target', 'WR', 100)] } },
        [d.key]: { league: d.league, result: { candidates: [move('stale', 'target', 'WR', 200)] } },
    };
    const previous = { ...d, league: { ...d.league } };
    const players = { target: { full_name: 'Target Player', position: 'WR', team: 'KC' } };
    const [wr, dl] = lens.groupPlayers([a, b, previous], rows, players);
    assert.equal(wr.position, 'WR');
    assert.deepEqual(wr.players.map(player => [player.pid, player.bestDelta]), [['target', 7], ['zero', 0], ['other', null]]);
    assert.equal(wr.players[0].name, 'Target Player');
    assert.equal(wr.players[0].team, 'KC');
    assert.equal(wr.players[0].player, players.target);
    assert.deepEqual(wr.players[0].leagues.map(item => [item.entry.key, item.candidates.map(candidate => candidate.id)]), [
        [a.key, ['first', 'second']], [b.key, ['first']],
    ]);
    assert.deepEqual(dl.players.map(player => player.pid), ['defender']);
});

test('Chopped and mathematically eliminated teams are hidden only with verified current evidence', () => {
    const dropped = { ...roster, settings: { eliminated: 9 } };
    const chopped = league({ rosters: [dropped], settings: { type: 3 } });
    const choppedStatus = (overrides, nfl = options.nfl) => lens.elimination(lens.list([{ ...chopped, ...overrides }], 'mine')[0], nfl);
    assert.equal(choppedStatus({}), 'Chopped in Week 9');
    assert.equal(choppedStatus({ _portfolioStale: true }), null);
    assert.equal(choppedStatus({ season: '2025' }), null);
    assert.equal(choppedStatus({}, { ...options.nfl, week: 8 }), null);

    const rosters = [1, 11, 9, 7, 5, 3].map((wins, index) => ({
        roster_id: index + 1, owner_id: index ? 'opponent-' + index : 'mine',
        settings: { wins, losses: 12 - wins, ties: 0 },
    }));
    const race = league({ bracket_overrides_id: null, total_rosters: 6, rosters,
        settings: { playoff_week_start: 14, playoff_teams: 4, playoff_seed_type: 0 } });
    const beforePlayoffs = { ...options.nfl, week: 13 };
    const eliminated = values => lens.elimination(lens.list([values], 'mine')[0], beforePlayoffs);
    assert.equal(eliminated(race), 'Eliminated from playoff contention');
    assert.equal(eliminated({ ...race, bracket_overrides_id: 'custom' }), null);
    assert.equal(eliminated({ ...race, rosters: rosters.slice(0, -1) }), null);
    assert.equal(eliminated({ ...race, settings: { ...race.settings, divisions: 2 } }), null);
    assert.equal(eliminated({ ...race, _espn: true, myRosterId: 1 }), null);
    const { bracket_overrides_id, ...unknownSeeding } = race;
    assert.equal(eliminated(unknownSeeding), null);
});

test('official Sleeper brackets can hide a playoff loss or a verified missed field without deleting recommendations', async () => {
    const current = league({ settings: { playoff_week_start: 14, playoff_teams: 4 } });
    const nfl = { ...options.nfl, week: 15 };
    const [entry] = lens.list([current], 'mine');
    const [stale] = lens.list([{ ...current, _portfolioStale: true }], 'mine');
    const originalLoad = WrWirePlayoffs.load;
    const path = (id, outcome = 'pending') => ({ team: { id: String(id) }, rounds: [{ outcome }] });
    const bracket = { status: 'ready', season: current.season, league: current, provisional: false,
        paths: [path(1, 'eliminated'), path(2), path(3), path(4)] };
    let checks = 0;
    WrWirePlayoffs.load = async () => { checks++; return bracket; };
    const move = { id: 'remains', incoming: [{ pid: 'target', position: 'WR' }], weekly: { delta: 3 } };
    App.RosterWaiverLens = { load: async () => ({ status: 'ready', candidates: [move] }) };
    try {
        const confirmed = await lens.load(entry, { ...options, nfl });
        assert.equal(confirmed.status, 'eliminated');
        assert.equal(confirmed.elimination, 'Eliminated in the playoffs');
        assert.deepEqual(confirmed.candidates, [move]);
        assert.equal((await lens.load(stale, { ...options, nfl })).status, 'unavailable');
        assert.equal(checks, 1);
        bracket.paths = [path(2), path(3), path(4), path(5)];
        assert.equal((await lens.load(entry, { ...options, nfl })).elimination, 'Missed the playoffs');
        bracket.paths.pop();
        assert.equal((await lens.load(entry, { ...options, nfl })).status, 'ready');
        bracket.paths = [path(1, 'eliminated'), path(2), path(3), path(4)];
        bracket.provisional = true;
        assert.equal((await lens.load(entry, { ...options, nfl })).status, 'ready');
    } finally {
        WrWirePlayoffs.load = originalLoad;
    }
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
