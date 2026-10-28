'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(edit) {
    const sandbox = { console, Set, Map, Math, Date, JSON, Promise, S: { currentWeek: 6, currentLeagueId: 'one', nflState: { season: '2026' } } };
    sandbox.window = sandbox; sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const file of ['startsit-engine.js', 'roster-trade-lens.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared', file), 'utf8'), sandbox, { filename: file });
    const players = {
        henry: { full_name: 'Henry', position: 'RB', team: 'BAL', age: 32 },
        brian: { full_name: 'Brian', position: 'RB', team: 'ATL', age: 26 },
        tucker: { full_name: 'Tucker', position: 'WR', team: 'LV', age: 25 },
        wandale: { full_name: 'Robinson', position: 'WR', team: 'TEN', age: 25 },
        adams: { full_name: 'Adams', position: 'WR', team: 'LAR', age: 33 },
        benson: { full_name: 'Benson', position: 'RB', team: 'ARI', age: 24 },
        depth: { full_name: 'Depth', position: 'WR', team: 'CHI', age: 26 },
    };
    const valuesByPid = { henry: 2000, brian: 1000, tucker: 1000, wandale: 1600, adams: 1100, benson: 2000, depth: 1500 };
    const points = { henry: 16.6, brian: 8.1, tucker: 8.8, wandale: 11.6, adams: 16.5, benson: 6.7, depth: 5.0 };
    const projectionsByPid = Object.fromEntries(Object.entries(points).map(([pid, pts]) => [pid, { pid, available: true, injuryStatus: '', statLine: { median: { rec: 1 } }, points: { median: pts } }]));
    const roster = { roster_id: 1, owner_id: 'u1', players: ['henry', 'brian', 'tucker', 'wandale'], reserve: [], taxi: [] };
    const partner = { roster_id: 2, owner_id: 'u2', players: ['adams', 'benson', 'depth'], reserve: [], taxi: [] };
    const league = { league_id: 'one', season: '2026', status: 'in_season', roster_positions: ['RB', 'WR', 'FLEX', 'BN', 'BN'],
        scoring_settings: { rec: 1 }, settings: { type: 2 }, rosters: [roster, partner], users: [{ user_id: 'u2', display_name: 'Northside' }] };
    const opts = { league, roster, rosters: league.rosters, players, valuesByPid, projectionsByPid, userId: 'u1', accountKey: 'account-one',
        skin: { type: 'dynasty', phase: 'in_season', features: { showTrades: true } }, gm: { hasStrategy: true, mode: 'win_now', strategy: { mode: 'win_now' }, untouchable: new Set(), maxOverpayPct: 0.2 },
        assessmentsByRosterId: { 2: { tier: 'REBUILDING' } }, currentWeek: 6 };
    if (edit) edit(opts, sandbox);
    return { opts, sandbox, api: sandbox.App.RosterTradeLens };
}

test('read-only whole-package preview reoptimizes the legal lineup and shows real price and provenance', () => {
    const f = fixture(), original = JSON.stringify(f.opts);
    const result = f.api.build(f.opts);
    assert.equal(result.status, 'ready');
    assert.equal(result.week, 7);
    assert.equal(result.strategy.source, 'saved');
    const adams = result.candidates.find(c => c.incoming[0].pid === 'adams');
    assert(adams);
    assert.equal(adams.weekly.before, 37);
    assert.equal(adams.weekly.after, 44.7);
    assert.equal(adams.weekly.delta, 7.7);
    assert.equal(adams.price.unit, 'DHQ');
    assert.equal(adams.partner.direction.source, 'inferred');
    assert.match(adams.partner.direction.reason, /not their saved GM plan/);
    assert.equal(adams.acceptance, undefined, 'no manufactured acceptance probability');
    assert.equal(adams.builderContext.partnerRosterId, '2');
    assert.deepEqual(Array.from(adams.builderContext.receivePlayerIds), ['adams']);
    assert.equal(JSON.stringify(f.opts), original, 'no roster or GM writes');
});

test('rebuild preview promotes existing bench depth rather than subtracting two player projections', () => {
    const f = fixture();
    f.opts.exploreMode = 'rebuild';
    const result = f.api.build(f.opts), benson = result.candidates.find(c => c.incoming[0].pid === 'benson' && c.outgoing[0].pid === 'henry');
    assert(benson);
    assert.equal(result.strategy.savedMode, 'win_now');
    assert.equal(result.strategy.savedLabel, 'Win now');
    assert.equal(result.strategy.exploreMode, 'rebuild');
    assert.equal(benson.weekly.before, 37);
    assert.equal(benson.weekly.after, 28.5);
    assert.equal(benson.weekly.delta, -8.5);
    assert(benson.weekly.afterStarters.some(p => p.pid === 'brian'));
    assert(!benson.weekly.afterStarters.some(p => p.pid === 'benson'));
    assert.equal(benson.futureFit.ageDifference, 8);
    assert.equal(benson.season.status, 'unavailable');
    assert.equal(f.opts.gm.mode, 'win_now', 'hypothetical direction does not save GM mode');
});

test('protected players never leave in generated packages or a stale handoff', () => {
    const f = fixture();
    f.opts.gm.untouchable = new Set(['tucker']);
    const result = f.api.build(f.opts);
    assert(result.candidates.every(c => c.outgoing.every(a => a.pid !== 'tucker')));
    const clean = fixture(), target = clean.api.build(clean.opts).candidates[0].builderContext;
    clean.opts.gm.untouchable.add(target.givePlayerIds[0]);
    assert.equal(clean.api.validateBuilderContext(target, clean.opts).ok, false);
});

test('missing price or projection evidence never becomes a zero-valued bargain or lineup certainty', () => {
    const f = fixture();
    delete f.opts.projectionsByPid.brian;
    assert.equal(f.api.build(f.opts).status, 'unavailable');
    const unpriced = fixture();
    unpriced.opts.valuesByPid = {};
    const result = unpriced.api.build(unpriced.opts);
    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, /priced/);
    const duplicate = fixture();
    duplicate.opts.rosters[1].players.push('tucker');
    assert.match(duplicate.api.build(duplicate.opts).reason, /unique player ownership/);
});

test('format, deadline and future-week gates reject unsupported or locked trading', () => {
    for (const edit of [o => o.skin.type = 'chopped', o => o.league.settings.disable_trades = 1,
        o => o.skin.features.showTrades = false, o => o.league.settings.trade_deadline = 5]) {
        const f = fixture(edit);
        assert.equal(f.api.build(f.opts).status, 'disabled');
    }
    const now = fixture(o => o.week = 6);
    assert.equal(now.api.build(now.opts).status, 'unavailable');
    const noAccount = fixture(o => { delete o.accountKey; delete o.userId; });
    assert.equal(noAccount.api.build(noAccount.opts).status, 'unavailable');
});

test('redraft ignores rebuild goals, uses season prices and current-season partner evidence', () => {
    const f = fixture(o => { o.skin.type = 'redraft'; o.exploreMode = 'rebuild'; });
    const result = f.api.build(f.opts);
    assert.equal(result.strategy.mode, 'win_now');
    assert(result.candidates.length);
    assert(result.candidates.every(c => c.price.unit === 'season value' && !/rebuild/i.test(c.partner.direction.label)));
    assert(result.candidates.every(c => c.weekly.delta > 0));
    assert(result.candidates.every(c => !c.builderContext.givePickIds && !c.builderContext.receivePickIds), 'no fabricated picks');
});

test('atomic handoff checks account, platform, league, season, owner snapshot and full package', () => {
    const f = fixture(), target = f.api.toBuilderContext(f.api.build(f.opts).candidates[0]);
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, true);
    assert.equal(f.api.validateBuilderContext({ ...target, currentWeek: 5 }, f.opts).ok, false);
    for (const [field, value] of [['accountKey', 'other-account'], ['leagueId', 'two'], ['season', '2025'], ['myRosterId', '2'], ['platform', 'espn']]) {
        assert.equal(f.api.validateBuilderContext({ ...target, [field]: value }, f.opts).ok, false, field);
    }
    assert.equal(f.api.validateBuilderContext({ ...target, givePlayerIds: ['not-owned'] }, f.opts).ok, false);
    f.opts.rosters[1].players.pop();
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false, 'revision invalidates a changed roster snapshot');
});

test('two-for-one packages cannot silently exceed either roster capacity', () => {
    const f = fixture(o => o.league.roster_positions = ['RB', 'WR', 'FLEX', 'BN']);
    const result = f.api.build(f.opts);
    for (const candidate of result.candidates) {
        assert(f.opts.rosters[1].players.length - candidate.incoming.length + candidate.outgoing.length <= 4);
    }
    f.opts.rosters[1].players.push('extra');
    f.opts.players.extra = { full_name: 'Extra', position: 'WR', age: 25 };
    f.opts.valuesByPid.extra = 100;
    f.opts.projectionsByPid.extra = { available: true, statLine: { median: { rec: 1 } }, points: { median: 1 } };
    assert(f.api.build(f.opts).candidates.every(c => c.outgoing.length === 1));
});

test('weekly load never prepares season evidence; explicit season compares only the preserved selected package', async () => {
    const f = fixture(); let called = 0;
    f.sandbox.App.TradeSeasonImpact = { prepare: async () => { called++; }, analyze: () => { called++; } };
    await f.api.load(f.opts);
    assert.equal(called, 0);
    f.opts.skin.type = 'redraft';
    const context = { status: 'ready', league: f.opts.league, fromWeek: 7 };
    f.opts.seasonContext = context;
    f.sandbox.App.TradeSeasonImpact.analyze = opts => {
        called++; assert.equal(opts.pointsOnly, true); assert.equal(opts.sims, undefined);
        return { status: 'ready', before: 190, after: 196, delta: 6, unit: 'ROS lineup points', weeks: [{ beforePoints: 100, afterPoints: 104 }, { beforePoints: 90, afterPoints: 92 }] };
    };
    const result = await f.api.load({ ...f.opts, horizon: 'week' });
    assert.equal(called, 0, 'weekly load does not prepare or analyze any season');
    assert(result.candidates.every(c => c.season.status === 'unavailable'));
    const candidateId = result.candidates[0].id;
    const season = await f.api.loadSeason({ ...f.opts, result, candidateId });
    assert.equal(called, 1, 'one selected package, not every alternative');
    assert.equal(season.candidateId, candidateId);
    assert.equal(season.season.before, 190);
    assert.equal(season.season.after, 196);
    assert.equal(season.season.delta, 6);
    assert(result.candidates.every(c => c.season.status === 'unavailable'), 'lazy return does not mutate existing weekly result');
    f.opts.seasonContext = { ...context, league: { ...f.opts.league, league_id: 'other-league' } };
    const wrong = await f.api.loadSeason({ ...f.opts, result, candidateId });
    assert.equal(wrong.season.status, 'unavailable');
    assert.equal(called, 1, 'wrong season scope never reaches analysis');
    f.opts.accountKey = 'another-account';
    assert.equal((await f.api.loadSeason({ ...f.opts, result, candidateId })).status, 'unavailable');
    assert.equal(called, 1, 'wrong account never reaches analysis');
});

test('lazy season refuses evidence changed during asynchronous preparation', async () => {
    const f = fixture(o => o.skin.type = 'redraft');
    const result = await f.api.load({ ...f.opts, horizon: 'week' }), candidateId = result.candidates[0].id;
    let release, called = false;
    f.sandbox.App.TradeSeasonImpact = { prepare: () => new Promise(resolve => { release = resolve; }), analyze: () => { called = true; } };
    const pending = f.api.loadSeason({ ...f.opts, result, candidateId });
    f.opts.roster.players.pop();
    release({ status: 'ready', league: f.opts.league, fromWeek: 7 });
    const answer = await pending;
    assert.equal(answer.status, 'unavailable');
    assert.equal(called, false);
});

test('Builder receiver replaces complete packages and rejects another account before any side changes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/trade-calc.js'), 'utf8');
    const marker = source.indexOf("if (target?.kind === 'roster-lens-package')");
    const block = source.slice(source.lastIndexOf('const open = event => {', marker), source.indexOf("window.addEventListener('wr:open-trade-builder'", marker));
    assert(block.includes('setTradePickIds({ A: [], B: [] })'));
    const f = fixture(), result = f.api.build(f.opts), candidate = result.candidates[0], calls = [];
    const state = { ...f.sandbox, currentLeague: f.opts.league, myRoster: f.opts.roster, allRosters: f.opts.rosters,
        sleeperUserId: 'u1', resolvedLeagueSkin: f.opts.skin, playersData: f.opts.players, tradeOwner: { A: 'old', B: 'other' },
        revealTradeBuilder: () => calls.push(['reveal']), window: f.sandbox };
    f.sandbox.WR = { WaiverPlans: { account: () => 'account-one' }, GmMode: { effects: () => f.opts.gm } };
    for (const key of ['setDealHqNotice', 'setTradeOwner', 'setTradeIds', 'setTradePickIds', 'setTradeFaab', 'setSearchText', 'setPhBuilderSide', 'setBuilderPlayerContext', 'setPhBuilderOpen']) state[key] = value => calls.push([key, value]);
    vm.createContext(state);
    vm.runInContext(block + '\nthis.openPackage = open;', state);
    state.openPackage({ detail: { ...candidate.builderContext, accountKey: 'wrong-account' } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'setDealHqNotice');
    calls.length = 0;
    state.openPackage({ detail: candidate.builderContext });
    const value = name => JSON.parse(JSON.stringify(calls.find(row => row[0] === name)?.[1]));
    assert.deepEqual(value('setTradeOwner'), { A: 'u1', B: 'u2' });
    assert.deepEqual(value('setTradeIds'), { A: Array.from(candidate.builderContext.givePlayerIds), B: Array.from(candidate.builderContext.receivePlayerIds) });
    assert.deepEqual(value('setTradePickIds'), { A: [], B: [] });
    assert.deepEqual(value('setTradeFaab'), { A: 0, B: 0 });
    assert.equal(value('setBuilderPlayerContext'), null, 'a whole-package entry has no fake player-details context');
    assert.equal(value('setPhBuilderOpen'), true);
    calls.length = 0;
    state.openPackage({ detail: { ...candidate.builderContext, basis: 'average' } });
    assert(calls.some(row => row[0] === 'setTradeIds'), 'the receiver preserves an average-basis package instead of validating it as projected');
    calls.length = 0;
    state.openPackage({ detail: { ...candidate.builderContext, basis: 'not-a-basis' } });
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'setDealHqNotice', 'unknown comparison basis cannot load a package');
});

test('opposite inferred timelines add a transparent ranking preference without pretending the owner declared a plan', () => {
    const f = fixture(), result = f.api.build(f.opts), adams = result.candidates.find(c => c.incoming[0].pid === 'adams');
    assert.equal(adams.timelineFit.matched, true);
    assert.equal(adams.timelineFit.source, 'inferred');
    assert.match(adams.reason, /may fit/);
    const other = { ...adams, id: 'other', timelineFit: { matched: false } };
    assert.equal(f.api.rank([other, adams], { mode: 'win_now' })[0].id, adams.id);
    f.opts.exploreMode = 'rebuild'; f.opts.assessmentsByRosterId[2].tier = 'CONTENDER';
    const rebuilding = f.api.build(f.opts).candidates.find(c => c.incoming[0].pid === 'benson');
    assert.equal(rebuilding.timelineFit.matched, true);
    assert.match(rebuilding.reason, /may value/);
});

test('canonical eager App assessor works without a trade-tab bridge and refuses another league snapshot', () => {
    const f = fixture(); delete f.opts.assessmentsByRosterId;
    f.sandbox.App.LI_LOADED = true; f.sandbox.App.LI = { sourceLeagueId: 'one' };
    f.sandbox.S.rosters = f.opts.rosters;
    let reads = 0;
    f.sandbox.App.assessTeamFromGlobal = () => { reads++; return { tier: 'REBUILDING' }; };
    const result = f.api.build(f.opts);
    assert(reads > 0);
    assert.equal(result.candidates[0].partner.direction.label, 'Rebuilding profile');
    f.sandbox.S.currentLeagueId = 'other'; reads = 0;
    const changed = f.api.build(f.opts);
    assert.equal(reads, 0);
    assert(changed.candidates.every(c => c.partner.direction.source === 'unavailable'));
});

test('redraft prices reject a stale ROS week or season before suggesting an offer', () => {
    const f = fixture(o => { o.skin.type = 'redraft'; delete o.valuesByPid; });
    const values = { henry: 2000, brian: 1000, tucker: 1000, wandale: 1600, adams: 1100, benson: 2000, depth: 1500 };
    let state = { leagueId: 'one', week: 5, season: '2026' };
    f.sandbox.App.PlayerValue = { rosState: () => state, getValue: pid => values[pid] };
    assert.equal(f.api.build(f.opts).status, 'unavailable');
    state = { ...state, week: 6, season: '2025' };
    assert.equal(f.api.build(f.opts).status, 'unavailable');
    state = { ...state, season: '2026' };
    assert.equal(f.api.build(f.opts).status, 'ready');
});

test('automatic packages and Builder handoffs respect keepers, locks, reserve, taxi and scoped protected tags', () => {
    for (const field of ['keepers', 'locked_players', 'reserve', 'taxi', 'protected_players']) {
        const f = fixture(), target = f.api.toBuilderContext(f.api.build(f.opts).candidates[0]), pid = target.givePlayerIds[0];
        f.opts.roster[field] = [pid];
        assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false, field + ' invalidates the snapshot');
        assert(f.api.build(f.opts).candidates.every(c => c.outgoing.every(a => a.pid !== pid)), field + ' excluded');
    }
    const f = fixture(), target = f.api.toBuilderContext(f.api.build(f.opts).candidates[0]), pid = target.givePlayerIds[0];
    f.sandbox._playerTags = { [pid]: 'untouchable' };
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false);
    assert(f.api.build(f.opts).candidates.every(c => c.outgoing.every(a => a.pid !== pid)));
});

test('handoff rechecks the passed deadline, provider trade capability, and starting-slot coverage', () => {
    const f = fixture(), target = f.api.toBuilderContext(f.api.build(f.opts).candidates[0]);
    f.opts.league.settings.trade_deadline = 5;
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false);
    delete f.opts.league.settings.trade_deadline;
    f.opts.provider = { capabilities: { hasTrades: false } };
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false);
    delete f.opts.provider;
    const illegal = { ...target, givePlayerIds: ['henry', 'brian'], receivePlayerIds: ['adams'] };
    assert.equal(f.api.validateBuilderContext(illegal, f.opts).ok, false, 'leaves own RB slot empty');
});

test('viewer must own or co-own the active roster for generation and Builder handoff', () => {
    const f = fixture(), target = f.api.toBuilderContext(f.api.build(f.opts).candidates[0]);
    f.opts.userId = 'not-the-owner';
    assert.equal(f.api.build(f.opts).status, 'disabled');
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, false);
    f.opts.roster.co_owners = ['not-the-owner'];
    assert.equal(f.api.build(f.opts).status, 'ready');
    assert.equal(f.api.validateBuilderContext(target, f.opts).ok, true);
});


test('canonical acceptance stays independent of saved floor and filters before target ranking', () => {
    const f = fixture((opts, sandbox) => {
        opts.gm.acceptanceFloor = 70;
        sandbox.App.TradeEngine = { calcAcceptanceLikelihood: () => 72 };
    });
    const result = f.api.build(f.opts);
    assert.equal(result.strategy.acceptanceFloor, 70);
    assert(result.candidates.length);
    assert(result.candidates.every(c => c.acceptance.likelihood === 72));
    assert.equal(result.candidates[0].partner.name, 'Northside');
    f.opts.gm.acceptanceFloor = 73;
    assert.equal(f.api.build(f.opts).candidates.length, 0);
    f.opts.gm.acceptanceFloor = 72;
    assert(f.api.build(f.opts).candidates.length, 'equality meets the floor');
});

test('an explicit floor never promotes packages with unavailable acceptance', () => {
    const f = fixture();
    f.opts.gm.acceptanceFloor = 80;
    assert.equal(f.api.build(f.opts).candidates.length, 0);
});


test('eager shared engine supplies a real estimate without mounting Trade Desk', () => {
    const f = fixture();
    vm.runInContext(fs.readFileSync('reconai-shared/trade-engine.js', 'utf8'), f.sandbox);
    f.opts.gm.acceptanceFloor = 55;
    const result = f.api.build(f.opts);
    for (const c of result.candidates) {
        assert(c.acceptance.likelihood >= 55 && c.acceptance.likelihood <= 95);
    }
    assert.equal(typeof f.sandbox.App.TradeEngine.calcAcceptanceLikelihood, 'function');
});
