'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture() {
    const window = { App: { NFLByes: { weekForPlayer: p => p?.bye } }, S: { currentLeagueId: 'one', currentWeek: 6, season: 2026, nflState: { season: 2026 }, user: { user_id: 'u1' } }, _playerTags: {} };
    const sandbox = { window, console, Set, Map, Promise, Math, Date, JSON }; vm.createContext(sandbox);
    for (const file of ['league-stats.js', 'startsit-engine.js', 'roster-lens-basis.js', 'waiver-roster-read.js', 'roster-waiver-lens.js', 'roster-trade-lens.js'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared', file), 'utf8'), sandbox, { filename: file });
    const roster = { roster_id: 1, owner_id: 'u1', players: ['old', 'bench'] }, other = { roster_id: 2, owner_id: 'u2', players: ['target'] };
    const players = { old: { full_name: 'Old', position: 'WR', team: 'KC', age: 30 }, bench: { full_name: 'Bench', position: 'WR', team: 'KC', age: 26 },
        target: { full_name: 'Target', position: 'WR', team: 'BUF', age: 24 }, add: { full_name: 'Add', position: 'WR', team: 'CHI', age: 25 } };
    const league = { league_id: 'one', season: 2026, status: 'in_season', total_rosters: 2, roster_positions: ['WR', 'BN'],
        scoring_settings: { rec: 1, fum_lost: -2 }, settings: { type: 2 }, rosters: [roster, other] };
    const statsData = { old: { season: 2026, gp: 2, rec: 10 }, bench: { season: 2026, gp: 2, rec: 2 }, target: { season: 2026, gp: 2, rec: 20 }, add: { season: 2026, gp: 2, rec: 24 } };
    const projectionsByPid = Object.fromEntries(Object.entries({ old: 20, bench: 2, target: 9, add: 8 }).map(([pid, points]) => [pid,
        { available: true, points: { median: points }, statLine: { median: { rec: points } } }]));
    const args = { league, roster, rosters: league.rosters, players, statsData, projectionsByPid, userId: 'u1', accountKey: 'account-one', currentWeek: 6,
        valuesByPid: { old: 1000, bench: 100, target: 1000, add: 1100 }, skin: { type: 'dynasty', phase: 'in_season', features: { showTrades: true } },
        gm: { hasStrategy: true, mode: 'win_now', strategy: { mode: 'win_now' }, untouchable: new Set() } };
    return { window, sandbox, args, basis: window.App.RosterLensBasis, trade: window.App.RosterTradeLens, waiver: window.App.RosterWaiverLens };
}
test('current-season league scoring retains signed and zero averages, position bonuses and unknown prior-only data', () => {
    const f = fixture(), opts = f.args;
    opts.statsData.old = { season: 2026, gp: 2, rec: 0, fum_lost: 2 };
    assert.equal(f.basis.currentAverage('old', opts).value, -2);
    opts.statsData.old = { season: 2026, gp: 2, rec: 0 };
    assert.equal(f.basis.currentAverage('old', opts).value, 0);
    opts.statsData.old = { season: 2025, gp: 2, rec: 50 };
    assert.equal(f.basis.currentAverage('old', opts).value, null);
    opts.statsData.old = { gp: 0, rec: 50 }; opts.priorData = { old: { season: 2025, gp: 17, rec: 100 } };
    assert.equal(f.basis.currentAverage('old', opts).value, null);
    opts.statsData.old = { gp: 2, rec: 4 }; opts.players.old.position = 'TE'; opts.league.scoring_settings = { rec: 1, bonus_rec_te: 0.5 };
    assert.equal(f.basis.currentAverage('old', opts).value, f.window.App.LeagueStats.score(opts.statsData.old, opts.league.scoring_settings, 'TE') / 2);
});
test('IDP avg normalizes all individual-defense aliases and leaves D/ST and offense projected', () => {
    const f = fixture();
    for (const pos of ['DL', 'DE', 'DT', 'NT', 'IDL', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'SS', 'FS']) {
        f.args.players.old.position = pos;
        const point = f.basis.comparison('old', { ...f.args, basis: 'idp-average', week: 6, projected: f.args.projectionsByPid.old });
        assert.equal(point.comparisonBasis, 'average', pos); assert.equal(point.points.median, 5, pos);
        assert.equal(point.averageGames, 2); assert.equal(point.averageSeason, '2026');
    }
    for (const pos of ['WR', 'RB', 'QB', 'TE', 'K', 'DEF', 'DST']) {
        f.args.players.old.position = pos;
        const point = f.basis.comparison('old', { ...f.args, basis: 'idp-average', projected: f.args.projectionsByPid.old });
        assert.equal(point.comparisonBasis, 'projected', pos); assert.equal(point.points.median, 20);
    }
});
test('scoped completed-game season form takes precedence and never uses an unrelated league history', () => {
    const f = fixture(); let formMode;
    f.window.App.WeeklyProj = { weeklyPointsScope: () => 'exact-scope', formStats: (_pid, mode) => { formMode = mode; return { rollingPPG: -0.5, games: 4 }; } };
    f.window.S.weeklyPlayerPointsScope = 'exact-scope';
    assert.equal(f.basis.currentAverage('old', f.args).value, -0.5); assert.equal(formMode, 'season');
    f.window.S.weeklyPlayerPointsScope = 'another-league';
    assert.equal(f.basis.currentAverage('old', f.args).value, 5);
});
function weeklyFixture(f) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared/weekly-proj.js'), 'utf8'), f.sandbox, { filename: 'weekly-proj.js' });
    f.args.currentWeek = 8;
    const values = [30, 40, 20, 10, 0, -2, 8, 999];
    Object.assign(f.window.S, { currentWeek: 8, weeklyPlayerPointsLeagueId: 'one', weeklyPlayerPointsSeason: 2026,
        weeklyPlayerPointsThroughWeek: 7, weeklyPlayerPointsComplete: true,
        weeklyPlayerPointsScope: f.window.App.WeeklyProj.weeklyPointsScope('one', 2026, f.args.league.scoring_settings),
        weeklyPlayerPoints: Object.fromEntries(values.map((points, i) => [i + 1, { old: points, bench: 1, target: 20, add: 25 }])),
        weeklyPlayerPlayed: Object.fromEntries(values.map((_, i) => [i + 1, { old: true, bench: true, target: true, add: true }])) });
}
test('last 3, last 5 and season use completed games, signed zeros, and the actual chosen sample count', () => {
    const f = fixture(); weeklyFixture(f);
    for (const [averageWindow, value, games] of [['3', 2, 3], ['5', 7.2, 5], ['season', 15.1, 7]]) {
        const observed = f.basis.currentAverage('old', { ...f.args, averageWindow, week: 15 });
        assert.equal(observed.value, value); assert.equal(observed.games, games); assert.equal(observed.averageWindow, averageWindow);
    }
    f.window.S.weeklyPlayerPlayed[6].old = false;
    assert.equal(f.basis.currentAverage('old', { ...f.args, averageWindow: '3' }).value, 6, 'DNP is skipped; genuine played zero counts');
    for (const week of [1, 3, 4, 5, 6]) delete f.window.S.weeklyPlayerPoints[week].old;
    const partial = f.basis.currentAverage('old', { ...f.args, averageWindow: '5' });
    assert.equal(partial.value, 24); assert.equal(partial.games, 2, 'Fewer played games remain a truthful smaller sample');
});
test('recent windows never fall back to season totals or unrelated/incomplete history', () => {
    const f = fixture(); weeklyFixture(f);
    f.window.S.weeklyPlayerPointsScope = 'wrong-scoring';
    assert.equal(f.basis.currentAverage('old', { ...f.args, averageWindow: '3' }).value, null);
    f.window.S.weeklyPlayerPointsScope = f.window.App.WeeklyProj.weeklyPointsScope('one', 2026, f.args.league.scoring_settings);
    f.window.S.weeklyPlayerPointsComplete = false;
    assert.equal(f.basis.currentAverage('old', { ...f.args, averageWindow: '3' }).value, null);
    assert.equal(f.basis.currentAverage('old', f.args).value, 5, 'Partial loaded history cannot masquerade as the season; original scored season aggregate remains usable');
    f.window.S.weeklyPlayerPointsComplete = true; f.window.S.weeklyPlayerPointsThroughWeek = 8;
    assert.equal(f.basis.currentAverage('old', { ...f.args, averageWindow: '3' }).value, null, 'A live-week cutoff is rejected');
    f.window.S.weeklyPlayerPointsThroughWeek = 7; f.args.league._mfl = true;
    assert.equal(f.basis.currentAverage('old', { ...f.args, averageWindow: '3' }).value, null, 'MFL recent native scoring is not inferred from flattened stats');
});
test('IDP recent window changes only defenders and keeps offensive projections intact', () => {
    const f = fixture(); weeklyFixture(f);
    f.args.players.old.position = 'EDGE';
    let compared = f.basis.comparison('old', { ...f.args, averageWindow: '3', basis: 'idp-average', projected: f.args.projectionsByPid.old });
    assert.equal(compared.points.median, 2); assert.equal(compared.averageGames, 3); assert.equal(compared.averageWindow, '3');
    f.args.players.old.position = 'WR';
    compared = f.basis.comparison('old', { ...f.args, averageWindow: '3', basis: 'idp-average', projected: f.args.projectionsByPid.old });
    assert.equal(compared.points.median, 20); assert.equal(compared.averageWindow, null);
});
test('recent preparation loads a completed history once per account/league/scoring/cutoff and never uses selected future week', async () => {
    const f = fixture(); weeklyFixture(f); f.window.S.weeklyPlayerPointsComplete = false;
    let calls = 0;
    f.window.App.WeeklyProj.loadWeeklyPoints = async request => {
        calls++; assert.equal(request.throughWeek, 7);
        return { complete: true, points: f.window.S.weeklyPlayerPoints, played: f.window.S.weeklyPlayerPlayed };
    };
    const request = { ...f.args, basis: 'average', averageWindow: '3', week: 15 };
    const prepared = await f.basis.prepare(request);
    assert.equal(f.basis.currentAverage('old', prepared).value, 2); assert.equal(calls, 1);
    assert.equal(f.basis.currentAverage('old', await f.basis.prepare({ ...request, averageWindow: '5' })).value, 7.2); assert.equal(calls, 1);
    await f.basis.prepare({ ...request, accountKey: 'different' }); assert.equal(calls, 2);
    await f.basis.prepare({ ...request, league: { ...request.league, scoring_settings: { rec: 2 } } }); assert.equal(calls, 3);
    f.window.S.weeklyPlayerPointsComplete = true;
    const reused = await f.basis.prepare(request); assert.equal(reused.averageHistory, undefined); assert.equal(calls, 3, 'Complete current history is reused');
});
test('failed recent history never turns missing weeks into a usable average and can retry', async () => {
    const f = fixture(); weeklyFixture(f); f.window.S.weeklyPlayerPointsComplete = false;
    let calls = 0;
    f.window.App.WeeklyProj.loadWeeklyPoints = async () => ({ complete: ++calls > 1, points: f.window.S.weeklyPlayerPoints, played: f.window.S.weeklyPlayerPlayed });
    const request = { ...f.args, basis: 'average', averageWindow: '3' };
    assert.equal(f.basis.currentAverage('old', await f.basis.prepare(request)).value, null);
    assert.equal(f.basis.currentAverage('old', await f.basis.prepare(request)).value, 2); assert.equal(calls, 2);
});
test('average windows propagate through waiver/trade assets and reject captured trade actions from another window', () => {
    const f = fixture(); weeklyFixture(f);
    const request = { ...f.args, basis: 'average', averageWindow: '3' };
    const trade = f.trade.build(request), waiver = f.waiver.evaluate(request);
    assert.equal(trade.status, 'ready'); assert.equal(waiver.status, 'ready');
    for (const result of [trade, waiver]) {
        assert.equal(result.averageWindow, '3'); assert.equal(result.candidates[0].averageWindow, '3');
        assert.equal(result.candidates[0].incoming[0].averageGames, 3); assert.equal(result.candidates[0].incoming[0].averageWindow, '3');
        assert.equal(result.candidates[0].weekly.averageWindow, '3');
    }
    assert.equal(f.trade.validateBuilderContext(trade.candidates[0].builderContext, request).ok, true);
    assert.equal(f.trade.validateBuilderContext(trade.candidates[0].builderContext, { ...request, averageWindow: '5' }).ok, false);
    assert.notEqual(trade.scope, f.trade.build({ ...request, averageWindow: '5' }).scope);
    assert.notEqual(waiver.scope, f.waiver.evaluate({ ...request, averageWindow: '5' }).scope);
});
test('official MFL average requires current-league provenance, never estimates absent AVG from NFL GP', async () => {
    const f = fixture(); f.args.league._mfl = true;
    const context = f.basis.sourceContext(f.args), raw = { gp: 8, _mflScoring: { scoringKey: context.scoringKey, season: '2026', week: null, points: 100, average: 0 } };
    f.args.statsData.old = raw;
    assert.equal(f.basis.currentAverage('old', f.args).value, null, 'metadata alone has no league provenance');
    let opts = { ...f.args, statsContext: context };
    assert.equal(f.basis.currentAverage('old', opts).value, 0); assert.equal(f.basis.currentAverage('old', opts).games, null, 'NFL GP is not necessarily the official AVG sample');
    raw._mflScoring.average = null;
    assert.equal(f.basis.currentAverage('old', opts).value, null);
    raw._mflScoring.average = -1.2;
    assert.equal(f.basis.currentAverage('old', { ...opts, statsContext: { ...context, leagueId: 'other' } }).value, null);
    f.window.MFL = { loadPlayerStats: async (league, request) => { assert.equal(league.league_id, 'one'); assert.equal(request.week, null); return { statsByPid: { old: raw }, error: 'Detailed NFL stats unavailable' }; } };
    opts = await f.basis.prepare({ ...f.args, basis: 'average' });
    assert.equal(f.basis.currentAverage('old', opts).value, -1.2, 'official AVG remains available when unrelated detailed stats fail');
});
test('old pinned MFL connectors cannot promote flattened-rule history to an official average', async () => {
    for (const identity of [{ _mfl: true }, { _platform: 'mfl' }, { league_id: 'mfl_2026_one' }]) {
        const f = fixture(); Object.assign(f.args.league, identity);
        f.window.App.WeeklyProj = { weeklyPointsScope: () => 'matching-scope', formStats: () => ({ rollingPPG: 99, games: 4 }) };
        f.window.S.weeklyPlayerPointsScope = 'matching-scope';
        const opts = await f.basis.prepare({ ...f.args, basis: 'average' });
        assert.equal(f.basis.currentAverage('old', opts).value, null, 'no native AVG API at the shared pin');
        delete opts.statsData.old;
        assert.equal(f.basis.currentAverage('old', opts).value, null, 'even scoped completed history cannot prove native MFL scoring');
        const context = f.basis.sourceContext(opts);
        opts.statsData.old = { _mflScoring: { scoringKey: context.scoringKey, season: '2026', week: null, average: 0 } };
        assert.equal(f.basis.currentAverage('old', opts).value, null, 'native metadata still needs current-league provenance');
        assert.equal(f.basis.currentAverage('old', { ...opts, statsContext: context }).value, 0, 'verified official native AVG remains available');
    }
});
test('average comparisons retain current bye/OUT eligibility and missing averages remain unknown', () => {
    const f = fixture();
    f.args.players.old.bye = 6;
    let point = f.basis.comparison('old', { ...f.args, basis: 'average', week: 6 });
    assert.equal(point.points.median, 5); assert.equal(point.available, false); assert.equal(point.injuryStatus, 'BYE');
    delete f.args.players.old.bye; f.args.players.old.injury_status = 'OUT';
    assert.equal(f.basis.comparison('old', { ...f.args, basis: 'average', week: 6 }).available, false);
    delete f.args.statsData.old;
    point = f.basis.comparison('old', { ...f.args, basis: 'average', week: 6 });
    assert.equal(point.points.median, null); assert.equal(point.available, false);
});
test('trade eligibility and legal lineup totals use the selected basis, with isolated context and no average ROS forecast', async () => {
    const f = fixture(), projected = f.trade.build(f.args);
    assert.equal(projected.status, 'empty', 'target forecast is lower than current starter');
    const average = f.trade.build({ ...f.args, basis: 'average' });
    assert.equal(average.status, 'ready'); assert.equal(average.basisLabel, 'Avg points');
    const candidate = average.candidates[0];
    assert.equal(candidate.weekly.before, 5); assert.equal(candidate.weekly.after, 10); assert.equal(candidate.weekly.delta, 5);
    assert.equal(candidate.incoming[0].comparisonBasis, 'average'); assert.equal(candidate.incoming[0].projection, 10);
    assert.equal(candidate.incoming[0].averageGames, 2);
    assert.notEqual(average.scope, projected.scope);
    assert.equal(f.trade.validateBuilderContext(candidate.builderContext, { ...f.args, basis: 'average' }).ok, true);
    assert.equal(f.trade.validateBuilderContext(candidate.builderContext, f.args).ok, false, 'changing basis invalidates an old action');
    const season = await f.trade.loadSeason({ ...f.args, basis: 'average', result: average, candidateId: candidate.id });
    assert.equal(season.status, 'unavailable'); assert.match(season.reason, /historical benchmarks/);
});
test('waiver fit and incoming asset use average before optimization, with no false ROS or prior-season PPG', () => {
    const f = fixture(), projected = f.waiver.evaluate({ ...f.args, week: 6 });
    assert.equal(projected.status, 'empty');
    const average = f.waiver.evaluate({ ...f.args, basis: 'average', week: 6 });
    assert.equal(average.status, 'ready'); const candidate = average.candidates.find(c => c.pid === 'add'); assert(candidate);
    assert.equal(candidate.weekly.before, 5); assert.equal(candidate.weekly.after, 12); assert.equal(candidate.weekly.delta, 7);
    assert.equal(candidate.incoming[0].projection, 12); assert.equal(candidate.incoming[0].comparisonBasis, 'average');
    assert.equal(candidate.season.delta, null); assert.match(candidate.season.reason, /historical benchmarks/);
    assert.notEqual(average.scope, projected.scope); assert.match(candidate.reason, /current-season average/);
    f.args.statsData.old.season = 2025;
    const missing = f.waiver.evaluate({ ...f.args, basis: 'average', week: 6 });
    assert.equal(missing.readiness.weekly, true, 'The other known starter still supports a measured comparison');
    const partial = missing.candidates.find(c => c.pid === 'add');
    assert.equal(partial.weekly.before, 1, 'Prior-season data never becomes a current average');
    assert.equal(partial.weekly.delta, 11); assert.equal(partial.weekly.partial, true);
});
test('MLB/NT/IDL candidates fill their legal LB/DL slots in the canonical waiver read', () => {
    const f = fixture();
    for (const [alias, slot] of [['MLB', 'LB'], ['NT', 'DL'], ['IDL', 'DL']]) {
        f.args.league.roster_positions = [slot, 'BN']; f.args.players.old.position = alias; f.args.players.bench.position = alias; f.args.players.add.position = alias;
        const result = f.waiver.evaluate({ ...f.args, basis: 'idp-average', week: 6 });
        assert(result.candidates.some(c => c.pid === 'add'), alias);
        assert.equal(result.candidates.find(c => c.pid === 'add').incoming[0].comparisonBasis, 'average');
    }
});
test('redraft average load keeps scoped prices for safe drops without turning them into average ROS metrics', async () => {
    const f = fixture(); let prices = 0;
    f.args.league.settings.type = 0; f.args.skin.type = 'redraft';
    f.window.App.PlayerValue = { computePrices: opts => { prices++; assert.equal(opts.leagueId, 'one'); return { leagueId: 'one', week: 6, values: f.args.valuesByPid, points: { old: 200, bench: 20, add: 240 } }; } };
    const result = await f.waiver.load({ ...f.args, basis: 'average', week: 6, valuesByPid: undefined, rosState: undefined });
    assert.equal(prices, 1); assert.equal(result.status, 'ready');
    assert.equal(result.candidates.find(c => c.pid === 'add').weekly.delta, 7);
    assert.equal(result.candidates.find(c => c.pid === 'add').season.delta, null);
    assert.equal(result.readiness.season, false);
});
test('MFL trade average load reaches the scoped official stats read after an unknown preflight', async () => {
    const f = fixture(); f.args.league._mfl = true; let requests = 0;
    const context = f.basis.sourceContext(f.args);
    f.window.MFL = { loadPlayerStats: async () => { requests++; return { statsByPid: Object.fromEntries(Object.entries({ old: 5, bench: 1, target: 10, add: 12 }).map(([pid, average]) =>
        [pid, { _mflScoring: { scoringKey: context.scoringKey, season: '2026', week: null, average } }])) }; } };
    const result = await f.trade.load({ ...f.args, basis: 'average', projectionsByPid: undefined });
    assert.equal(requests, 1); assert.equal(result.status, 'ready'); assert.equal(result.candidates[0].weekly.delta, 5);
    assert.equal(result.candidates[0].incoming[0].averageGames, null);
});
test('hybrid legal totals combine offensive projections and empirical IDP average before eligibility', () => {
    const f = fixture(); f.args.league.roster_positions = ['WR', 'DL', 'BN']; f.args.roster.players = ['old', 'bench'];
    f.args.players.bench.position = 'IDL'; f.args.players.target.position = 'NT'; f.args.players.add.position = 'EDGE';
    f.args.league.scoring_settings = { rec: 1, idp_tkl_solo: 1 };
    f.args.statsData.bench = { gp: 2, idp_tkl_solo: 2 }; f.args.statsData.target = { gp: 2, idp_tkl_solo: 20 }; f.args.statsData.add = { gp: 2, idp_tkl_solo: 24 };
    f.args.valuesByPid.bench = 1000;
    const trade = f.trade.build({ ...f.args, basis: 'idp-average' });
    assert.equal(trade.status, 'ready'); assert.equal(trade.candidates[0].weekly.before, 21); assert.equal(trade.candidates[0].weekly.after, 30);
    assert.equal(trade.candidates[0].incoming[0].comparisonBasis, 'average');
    assert.equal(trade.candidates[0].outgoing[0].comparisonBasis, 'average');
    const waiver = f.waiver.evaluate({ ...f.args, basis: 'idp-average', week: 6 });
    assert.equal(waiver.candidates.find(c => c.pid === 'add').weekly.before, 21);
    assert.equal(waiver.candidates.find(c => c.pid === 'add').weekly.after, 32);
});

test('IDP comparison availability follows defensive roster slots, excluding team defense', () => {
    const { basis } = fixture();
    for (const slot of ['DL','DE','DT','NT','IDL','EDGE','LB','MLB','ILB','OLB','DB','CB','S','SS','FS','IDP','IDP_FLEX'])
        assert.equal(basis.hasIdp({ roster_positions: ['QB', slot, 'BN'] }), true, slot);
    assert.equal(basis.hasIdp({ roster_positions: ['QB','FLEX','K','DEF','DST','D/ST','BN'], scoring_settings: { idp_tkl: 1 } }), false);
});
