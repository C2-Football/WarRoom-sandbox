'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(edit) {
    const league = { league_id: 'fixture', season: '2026', scoring_settings: { rec: 1, rec_yd: 0.1, pass_yd: 0.04, rush_yd: 0.1, rec_td: 6 },
        roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN'],
        settings: { start_week: 1, playoff_week_start: 6, playoff_teams: 2, playoff_seed_type: 0, divisions: 0, league_average_match: 0 },
        rosters: [], users: [] };
    const playersData = {}, statsData = {};
    [1, 2, 3, 4].forEach(id => {
        const pids = [];
        ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'TE'].forEach((position, i) => {
            const pid = id + '-' + i; pids.push(pid);
            playersData[pid] = { full_name: 'Player ' + pid, position, team: ['BUF', 'CHI', 'KC', 'DAL'][id - 1], injury_status: '' };
            const target = 24 - id * 3 + (7 - i) / 2;
            statsData[pid] = { gp: 2, pass_yd: position === 'QB' ? target * 25 * 2 : 0,
                rush_yd: position === 'RB' ? target * 10 * 2 : 0,
                rec: position === 'WR' || position === 'TE' ? target * 2 / 2 : 0,
                rec_yd: position === 'WR' || position === 'TE' ? target * 5 * 2 : 0 };
        });
        league.rosters.push({ roster_id: id, owner_id: 'u' + id, players: pids, starters: pids.slice(0, 6), reserve: [], taxi: [],
            settings: { wins: id <= 2 ? 2 : 0, losses: id <= 2 ? 0 : 2, ties: 0, fpts: id <= 2 ? 240 : 180 } });
        league.users.push({ user_id: 'u' + id, display_name: 'Team ' + id });
    });
    const pairs = { 1: [[1, 3], [2, 4]], 2: [[1, 4], [2, 3]], 3: [[1, 2], [3, 4]], 4: [[1, 3], [2, 4]], 5: [[1, 4], [2, 3]] };
    const input = { league, playersData, statsData, priorData: {}, pairs };
    if (edit) edit(input);
    const sandbox = { console, Set, Map, Promise, Math, Date, JSON, S: { currentWeek: 3, nflState: { season: '2026', week: 3 } },
        fetch: async () => ({ ok: false }), calcFantasyPts: (line, scoring) => Object.entries(scoring).reduce((sum, [stat, amount]) => sum + Number(line[stat] || 0) * amount, 0),
        fetchMatchups: async (_lid, week) => (pairs[week] || []).flatMap((pair, i) => pair.map(id => ({ roster_id: id, matchup_id: i + 1, points: week < 3 ? 140 - id * 10 : 0 }))),
    };
    require('./helpers/production-scorer.cjs')(sandbox);
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    for (const file of ['shared/startsit-engine.js', 'shared/weekly-proj.js', 'shared/luck-engine.js', 'shared/playoff-odds.js', 'shared/matchup.js', 'shared/trade-season-impact.js'])
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox, { filename: file });
    return { ...input, sandbox, api: sandbox.App.TradeSeasonImpact };
}
async function analyze(f, patch = {}) {
    const context = await f.api.prepare(f);
    return { context, result: f.api.analyze({ context, myRosterId: 4, partnerRosterId: 1,
        givePlayerIds: ['4-0'], receivePlayerIds: ['1-0'], sims: 2000, seed: 17, ...patch }) };
}

test('points-only preview shares full-analysis legal lineups and skips Monte Carlo outputs', async () => {
    const f = fixture(), { context, result: full } = await analyze(f);
    const args = { context, myRosterId: 4, partnerRosterId: 1, givePlayerIds: ['4-0'], receivePlayerIds: ['1-0'], pointsOnly: true };
    const points = f.api.analyze(args);
    assert.equal(points.pointsOnly, true);
    assert.equal(points.before, Math.round(full.weeks.reduce((sum, w) => sum + w.beforePoints, 0) * 10) / 10);
    assert.equal(points.after, Math.round(full.weeks.reduce((sum, w) => sum + w.afterPoints, 0) * 10) / 10);
    assert.equal(points.delta, Math.round((points.after - points.before) * 10) / 10);
    assert.equal(JSON.stringify(points.weeks), JSON.stringify(full.weeks));
    assert.equal(points.wins, undefined, 'points-only cannot be mistaken for simulated wins');
    assert.equal(points.playoffs, undefined, 'points-only cannot be mistaken for qualification odds');
    const ordinary = f.api.analyze({ ...args, pointsOnly: false, sims: 2000, seed: 17 });
    assert.equal(JSON.stringify(ordinary), JSON.stringify(full), 'default/full analysis remains byte-for-byte equivalent');
});

test('trade projects legal future lineups, both teams, rank and paired qualification odds without mutating inputs', async () => {
    const f = fixture(), originals = JSON.stringify({ league: f.league, players: f.playersData, stats: f.statsData });
    const { context, result } = await analyze(f);
    assert.equal(context.fromWeek, 4);
    assert.equal(context.simulationStart, 3, 'pending current week remains in final record simulation');
    assert.equal(result.status, 'ready');
    assert.equal(result.weeks.length, 2);
    assert.equal(result.weeks[1].opponentRosterId, 1, 'head-to-head with trade partner');
    assert(result.weeks[1].afterPoints > result.weeks[1].beforePoints);
    assert(result.weeks[1].opponentAfterPoints < result.weeks[1].opponentBeforePoints, 'opponent loses the player received by user');
    assert(result.weeks[1].afterWinPct > result.weeks[1].beforeWinPct);
    assert(result.powerRank.after <= result.powerRank.before);
    assert(result.wins.afterRemaining > result.wins.beforeRemaining);
    assert(result.wins.afterFinal >= result.wins.afterRemaining);
    assert.equal(result.playoffs.available, true);
    assert.equal(result.coverage.projected, 2);
    assert.equal(JSON.stringify({ league: f.league, players: f.playersData, stats: f.statsData }), originals);
    for (const week of result.weeks) {
        assert.equal(week.afterStarters.length, 6);
        assert.equal(new Set(week.afterStarters.map(s => s.pid)).size, 6);
        assert(week.afterStarters.some(s => s.slot === 'SUPER_FLEX' && s.pos === 'QB'));
    }
});

test('zero trade and deterministic reruns have exactly equal branches', async () => {
    const f = fixture(), context = await f.api.prepare(f);
    const args = { context, myRosterId: 4, partnerRosterId: 1, givePlayerIds: [], receivePlayerIds: [], sims: 1000, seed: 0 };
    const a = f.api.analyze(args), b = f.api.analyze(args);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.powerRank.before, a.powerRank.after);
    assert.equal(a.wins.beforeFinal, a.wins.afterFinal);
    assert.equal(a.wins.delta, 0);
    assert.equal(a.playoffs.delta, 0);
    assert(a.weeks.every(w => w.pointsDelta === 0 && w.winDelta === 0));
});

test('current week cannot be affected or accidentally dropped from the final forecast', async () => {
    const f = fixture(), { result } = await analyze(f, { givePlayerIds: [], receivePlayerIds: [] });
    assert(result.wins.beforeFinal > result.wins.beforeRemaining, 'current week adds expected wins beyond displayed trade weeks');
    assert(result.assumptions.some(s => s.includes('live scores')));
    assert(result.weeks.every(w => w.week > 3));
    const context = await f.api.prepare({ ...f, fromWeek: 3 });
    assert.equal(context.status, 'unavailable');
});

test('an already final current week is not simulated a second time', async () => {
    const f = fixture(f => f.league.rosters.forEach(r => r.settings.losses++));
    const { context } = await analyze(f);
    assert.equal(context.simulationStart, 4);
    assert(!context.assumptions.some(s => s.includes('live scores')));
});

test('NFL byes replace starters; unresolved future injuries withhold central estimates', async () => {
    const f = fixture(f => { f.playersData['1-0'].bye_week = 4; f.playersData['1-0'].injury_status = 'Q'; });
    const { result } = await analyze(f);
    assert(!result.weeks[0].afterStarters.some(s => s.pid === '1-0'));
    assert.equal(result.weeks[1].afterPoints, null);
    assert(result.warnings.some(s => s.includes('availability')));
});

test('reserve and taxi players are excluded until received; roster capacity does not count them twice', async () => {
    const f = fixture(f => { f.league.rosters[3].reserve = ['4-1']; f.league.rosters[3].taxi = ['4-7']; });
    const { result } = await analyze(f);
    assert(result.weeks.every(w => !w.beforeStarters.some(s => ['4-1', '4-7'].includes(s.pid))));
    assert.notEqual(result.status, 'unavailable');
});

test('unknown traded-player production is unavailable, never a zero projection', async () => {
    const f = fixture(f => delete f.statsData['1-0']);
    const { result } = await analyze(f);
    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, /no usable/);
});

test('an unknown bench player suppresses affected lineups and qualification precision', async () => {
    const f = fixture(f => delete f.statsData['2-7']);
    const { result } = await analyze(f);
    assert.equal(result.status, 'limited');
    assert.equal(result.powerRank.before, null);
    assert.equal(result.playoffs.available, false);
    assert.match(result.playoffs.reason, /lack projections/);
    assert(result.weeks.every(w => w.beforePoints !== null), 'known user lineups are still visible');
});

test('zero and negative valid league-scored projections are retained', async () => {
    const f = fixture(f => { f.league.scoring_settings = { pass_yd: -0.04, rush_yd: 0, rec: 0, rec_yd: 0 };
        f.league.roster_positions = ['QB', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']; });
    const { result } = await analyze(f);
    assert.notEqual(result.status, 'unavailable');
    assert(result.weeks[0].beforePoints < 0, 'eligible negative QB fills the mandatory QB slot');
    assert.equal(result.weeks[0].beforeStarters.length, 1);
    const z = fixture(f => { f.league.scoring_settings = { pass_yd: 0, rush_yd: 0, rec: 0, rec_yd: 0 }; });
    const zero = (await analyze(z)).result;
    assert.equal(zero.weeks[0].beforePoints, 0);
    assert.equal(zero.weeks[0].beforeWinPct, 50);
});

test('missing schedules leave weeks explicit and suppress full-season qualification', async () => {
    const f = fixture(f => delete f.pairs[5]);
    const { result } = await analyze(f);
    assert.equal(result.weeks[1].opponentRosterId, null);
    assert.equal(result.weeks[1].beforeWinPct, null);
    assert.equal(result.wins.beforeRemaining, null);
    assert.equal(result.playoffs.available, false);
    assert.match(result.playoffs.reason, /schedule/);
});

test('incomplete current-week schedule also suppresses odds while retaining future game effects', async () => {
    const f = fixture(f => delete f.pairs[3]);
    const { result } = await analyze(f);
    assert.equal(result.coverage.projected, 2);
    assert.equal(result.playoffs.available, false);
    assert.equal(result.wins.beforeFinal, null);
    assert(result.wins.beforeRemaining != null);
});

test('median leagues draw one score per team and add the second standings decision', async () => {
    const f = fixture(f => { f.league.settings.league_average_match = 1;
        f.league.rosters.forEach(r => { r.settings.wins *= 2; r.settings.losses *= 2; }); });
    const { result } = await analyze(f, { myRosterId: 1, partnerRosterId: 4, givePlayerIds: [], receivePlayerIds: [] });
    assert.equal(result.playoffs.available, true);
    assert.equal(result.wins.decisionsPerWeek, 2);
    assert(result.wins.beforeRemaining > 2, 'dominant team expects more than one decision per future week');
    assert.equal(result.wins.delta, 0);
});

test('divisions, custom seeding and zero playoff slots suppress only qualification odds', async () => {
    for (const edit of [f => f.league.settings.divisions = 2, f => f.league.settings.playoff_seed_type = 1,
        f => delete f.league.settings.playoff_seed_type, f => f.league.settings.playoff_teams = 0]) {
        const f = fixture(edit), { result } = await analyze(f);
        assert.equal(result.playoffs.available, false);
        assert(result.wins.beforeFinal != null);
        assert(result.powerRank.before != null);
    }
});

test('invalid ownership, duplicate pieces, self trades and over-capacity trades fail clearly', async () => {
    const f = fixture(), context = await f.api.prepare(f);
    for (const patch of [ { partnerRosterId: 4 }, { givePlayerIds: ['1-0'] }, { givePlayerIds: ['4-0', '4-0'] },
        { givePlayerIds: [], receivePlayerIds: ['1-0', '1-1'] } ]) {
        const result = f.api.analyze({ context, myRosterId: 4, partnerRosterId: 1, givePlayerIds: ['4-0'], receivePlayerIds: ['1-0'], ...patch });
        assert.equal(result.status, 'unavailable');
        assert(result.reason.length > 0);
    }
});

test('missing traded-player metadata, conflicting owners and unsupported lineup slots are unavailable', async () => {
    const missing = fixture(f => delete f.playersData['1-0']);
    assert.equal((await analyze(missing)).result.status, 'unavailable');
    const conflict = fixture(f => f.league.rosters[1].players.push('1-0'));
    assert.equal((await analyze(conflict)).result.status, 'unavailable');
    const slots = fixture(f => f.league.roster_positions.push('WR_RB_FLEX'));
    assert.equal((await slots.api.prepare(slots)).status, 'unavailable');
});

test('historical seasons, unsupported providers, missing cutoff and no future weeks fail before projection fetches', async () => {
    for (const edit of [f => f.league.season = '2025', f => f.league._mfl = true,
        f => delete f.league.settings.playoff_week_start, f => f.league.settings.playoff_week_start = 4,
        f => f.league.scoring_settings = {}]) {
        const f = fixture(edit), context = await f.api.prepare(f);
        assert.equal(context.status, 'unavailable');
        assert.equal(context.fromWeek, 4);
    }
});

test('official records with inconsistent completed-week coverage suppress final wins and qualification', async () => {
    const f = fixture(f => f.league.rosters[0].settings.wins++), { result } = await analyze(f);
    assert.equal(result.playoffs.available, false);
    assert.equal(result.wins.beforeFinal, null);
    assert.match(result.playoffs.reason, /Official records/);
});

test('weekly snapshots reuse the shared expiring cache without replacing other weeks', async () => {
    const f = fixture(), fetched = [], events = [];
    f.sandbox.dispatchEvent = event => events.push(event);
    f.sandbox.CustomEvent = function (type) { this.type = type; };
    f.sandbox.fetch = async url => {
        fetched.push(url);
        const week = Number(url.split('/').pop());
        return { ok: true, json: async () => ({ '1-0': { pass_att: 30, pass_yd: week * 100 } }) };
    };
    const wp = f.sandbox.App.WeeklyProj;
    await wp.ensureWeekProjections(3);
    const cachedCurrent = JSON.stringify(wp.providerLine('1-0', 3));
    events.length = 0;
    const { context, result } = await analyze(f);
    assert.equal(events.length, 2, 'new future snapshots publish scoped refresh events');
    assert.equal(JSON.stringify(wp.providerLine('1-0', 3)), cachedCurrent);
    assert.equal(fetched.length, 3, 'current-week snapshot is deduplicated; two future weeks load');
    assert.equal(context.projectionsByWeek[4]['1-0'].points.median, 16);
    assert.equal(context.projectionsByWeek[5]['1-0'].points.median, 20);
    assert(result.weeks[0].afterPoints !== result.weeks[1].afterPoints);
});

test('rookies can use meaningful published season stat lines when weekly projections and history are absent', async () => {
    const f = fixture(f => delete f.statsData['1-0']);
    f.projectionsData = { '1-0': { gp: 17, pass_att: 510, pass_yd: 4250 } };
    const { result } = await analyze(f);
    assert.notEqual(result.status, 'unavailable');
    assert(result.weeks.every(w => w.afterPoints != null));
});

test('league scoring honors tight-end reception premium in the same projection pipeline', async () => {
    const f = fixture(f => { f.league.scoring_settings.bonus_rec_te = 1; });
    const { context } = await analyze(f);
    const withoutPremium = fixture(), baseline = await withoutPremium.api.prepare(withoutPremium);
    assert(context.projectionsByWeek[4]['1-6'].points.median > baseline.projectionsByWeek[4]['1-6'].points.median);
    assert.equal(context.projectionsByWeek[4]['1-0'].points.median, baseline.projectionsByWeek[4]['1-0'].points.median);
});

test('exact standings ties share qualification chances instead of favoring low roster IDs', async () => {
    const f = fixture(f => {
        f.league.scoring_settings = { pass_yd: 0, rec: 0, rec_yd: 0, rush_yd: 0, rec_td: 0 }; // real known zero scoring, not an assumed season-long OUT
        f.league.rosters.forEach(r => { r.settings.wins = 1; r.settings.losses = 1; r.settings.fpts = 200; });
    });
    const { result } = await analyze(f, { givePlayerIds: [], receivePlayerIds: [], sims: 4000 });
    assert.equal(result.playoffs.available, true);
    assert(result.playoffs.beforePct > 45 && result.playoffs.beforePct < 55, 'highest roster ID receives about half the two-of-four slots');
    assert.equal(result.playoffs.delta, 0, 'common tiebreak draws preserve zero-trade identity');
    assert(Math.abs(result.wins.beforeRemaining - 1) < .1, 'symmetric zero-scoring teams have approximately one expected win; modeled score variance remains explicit');
    assert(result.assumptions.some(s => s.includes('further official tiebreakers')));
});

test('duplicate matchup assignments invalidate affected weekly rows; an unrelated missing game does not', async () => {
    const duplicate = fixture(f => f.pairs[4].push([3, 2]));
    const affected = (await analyze(duplicate)).result;
    assert.equal(affected.weeks[0].opponentRosterId, null, 'user opponent team 2 is assigned twice');
    assert.equal(affected.weeks[0].beforeWinPct, null);
    assert.equal(affected.playoffs.available, false);
    const partial = fixture(f => f.pairs[4] = [[2, 4]]);
    const unaffected = (await analyze(partial)).result;
    assert.equal(unaffected.weeks[0].opponentRosterId, 2);
    assert(unaffected.weeks[0].beforeWinPct != null);
    assert.equal(unaffected.playoffs.available, false, 'all-team season simulation still needs full schedule');
});

test('preparation snapshots only rostered player maps and ignores later source-map mutations', async () => {
    const f = fixture();
    f.playersData.unrostered = { position: 'QB', team: 'BUF' };
    f.statsData.unrostered = { gp: 2, pass_yd: 600 };
    const context = await f.api.prepare(f), captured = context.playersData['1-0'].team;
    assert.equal(context.playersData.unrostered, undefined);
    assert.equal(context.statsData.unrostered, undefined);
    f.playersData['1-0'].team = 'KC';
    assert.equal(context.playersData['1-0'].team, captured);
});
