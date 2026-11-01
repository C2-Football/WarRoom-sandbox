'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const now = Date.parse('2026-10-18T15:00:00Z');
const window = { App: { NFLByes: { weekForPlayer: p => p?.bye_week } }, S: { currentLeagueId: 'lineup-league', nflState: { season: 2026, week: 6 }, user: { user_id: 'owner' } } };
const ctx = vm.createContext({ window, console, Promise, Date });
for (const path of ['js/shared/roster-lens-basis.js', 'js/shared/roster-lineup-lens.js']) vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
const Lens = window.App.RosterLineupLens;
const player = (name, position, more = {}) => ({ full_name: name, position, team: 'KC', ...more });
const players = { qb: player('Starting QB', 'QB'), wr: player('Starting WR', 'WR'), rb: player('Starting RB', 'RB'),
    better: player('Better RB', 'RB'), receiver: player('Bench WR', 'WR'), q2: player('Bench QB', 'QB'),
    reserve: player('IR RB', 'RB'), taxi: player('Taxi RB', 'RB') };
const league = { league_id: 'lineup-league', season: 2026, settings: { type: 2 }, scoring_settings: { rec: 1 }, roster_positions: ['QB', 'WR', 'FLEX', 'BN', 'IR', 'TAXI'] };
const roster = { roster_id: 1, owner_id: 'owner', players: Object.keys(players), starters: ['qb', 'wr', 'rb'], reserve: ['reserve'], taxi: ['taxi'] };
const games = [{ home: 'KC', away: 'LV', state: 'pre', kickoff: '2026-10-18T20:25:00Z' }];
const args = { league, roster, players, userId: 'owner', currentSeason: 2026, currentWeek: 6, week: 6, now,
    games, gamesUpdatedAt: now, scheduleWeek: 6, scheduleSeason: 2026,
    projectionsByPid: { qb: 22, wr: 16, rb: 12, better: 19, receiver: 18, q2: 24, reserve: 50, taxi: 60 } };
const find = (out, incoming, slot = 2) => out.candidates.find(c => c.incoming[0].pid === incoming && c.slotIndex === slot);
let out = Lens.evaluate(args), swap = find(out, 'better');
assert.equal(out.status, 'ready'); assert(swap);
assert.equal(swap.weekly.before, 12); assert.equal(swap.weekly.after, 19); assert.equal(swap.weekly.delta, 7);
assert.equal(swap.anchorPlayerId, 'rb'); assert.equal(swap.outgoing[0].pid, 'rb'); assert.equal(swap.slotName, 'FLEX');
assert.equal(swap.handoff.incomingPid, 'better'); assert.equal(swap.handoff.outgoingPid, 'rb'); assert.equal(swap.handoff.week, 6);
assert.equal(swap.handoff.source, 'roster-lineup-lens'); assert.equal(swap.handoff.rosterId, 1);
assert(!out.candidates.some(c => ['reserve', 'taxi', 'qb', 'wr', 'rb'].includes(c.incoming[0].pid)), 'Reserve, taxi and already-starting players cannot be suggested');
assert(!find(out, 'q2'), 'QB cannot enter ordinary FLEX');
assert(find(out, 'q2', 0), 'QB replacement remains legal');
assert(find(Lens.evaluate({ ...args, league: { ...league, roster_positions: ['QB', 'WR', 'SUPER_FLEX', 'BN'] } }), 'q2'), 'Superflex accepts QB');
assert.equal(Lens.normSlot('OP'), 'SUPER_FLEX'); assert.equal(Lens.normSlot('W/R'), 'WRRB_FLEX');
assert.equal(Lens.normSlot('DST'), 'DEF');
assert.deepEqual(Array.from(Lens.slotEligibility('W/R')), ['WR', 'RB']);
assert.equal(Lens.eligiblePlayer({ position: 'EDGE' }, Lens.slotEligibility('IDP')), true);
out = Lens.evaluate({ ...args, league: { ...league, roster_positions: ['IDP_FLEX', 'BN'] }, roster: { ...roster, starters: ['dl'], players: ['dl', 'db'] },
    players: { dl: player('DL', 'EDGE'), db: player('DB', 'CB') }, projectionsByPid: { dl: 5, db: 10 } });
assert.equal(find(out, 'db', 0).weekly.delta, 5, 'IDP aliases participate in IDP flex');
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, position: 'WR', fantasy_positions: ['RB', 'WR'] } }, league: { ...league, roster_positions: ['QB', 'WR', 'RB', 'BN'] } });
assert(find(out, 'better'), 'Provider multi-position eligibility is honored');

out = Lens.evaluate({ ...args, games: [...games, { home: 'BUF', away: 'NYJ', state: 'in', kickoff: '2026-10-18T14:00:00Z' }] });
assert(find(out, 'better'), 'An unrelated started game does not disable future-game swaps');
out = Lens.evaluate({ ...args, games: [{ ...games[0], state: 'in' }] }); assert.equal(out.candidates.length, 0); assert.equal(out.status, 'empty');
out = Lens.evaluate({ ...args, games: [{ ...games[0], kickoff: '2026-10-18T14:00:00Z' }] }); assert.equal(out.candidates.length, 0, 'Past kickoff locks even if provider state says pregame');
out = Lens.evaluate({ ...args, games: [{ ...games[0], statusName: 'STATUS_POSTPONED' }] }); assert.equal(out.status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, gamesUpdatedAt: now - 90000 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, scheduleWeek: 5 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, scheduleSeason: 2025 }).status, 'unavailable');
out = Lens.evaluate({ ...args, roster: { ...roster, locked_players: ['rb'] } }); assert(!find(out, 'better'));
out = Lens.evaluate({ ...args, lockedPids: ['better'] }); assert(!find(out, 'better'));
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, team: 'UNKNOWN' } } });
assert(!find(out, 'better')); assert.equal(out.readiness.complete, false, 'Unknown candidate game status stays unavailable');

out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, rb: null } });
assert(!find(out, 'better')); assert(find(out, 'q2', 0)); assert.equal(out.readiness.complete, false, 'Missing one baseline does not hide unrelated valid comparisons');
out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, rb: 0 } }); assert.equal(find(out, 'better').weekly.delta, 19);
out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, rb: -4, better: -2 } }); assert.equal(find(out, 'better').weekly.delta, 2, 'Signed negative points are compared as measured');
out = Lens.evaluate({ ...args, projectionsByPid: {} }); assert.equal(out.status, 'unavailable'); assert.equal(out.candidates.length, 0);
out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, better: { available: false, points: { median: 90 } } } }); assert(!find(out, 'better'));
out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, better: { available: true, statLine: { median: null }, points: { median: 0 } } } }); assert(!find(out, 'better'), 'Absent stat line cannot manufacture a scored zero');
out = Lens.evaluate({ ...args, projectionsByPid: { ...args.projectionsByPid, better: { available: true, week: 5, points: { median: 90 } } } }); assert(!find(out, 'better'), 'Prior-week player forecast is rejected');
assert.equal(Lens.evaluate({ ...args, projectionsWeek: 5 }).status, 'unavailable');

out = Lens.evaluate({ ...args, platformStarters: ['qb', 'wr', '0'] }); swap = find(out, 'better');
assert.equal(swap.weekly.before, 0); assert.equal(swap.weekly.delta, 19); assert.equal(swap.outgoing.length, 0); assert.equal(swap.anchorPlayerId, 'better'); assert.equal(swap.priority, 30);
out = Lens.evaluate({ ...args, players: { ...players, rb: { ...players.rb, bye_week: 6, team: 'DAL' } } }); swap = find(out, 'better');
assert.equal(swap.weekly.before, null); assert.equal(swap.weekly.delta, null); assert.equal(swap.priority, 20); assert.match(swap.reason, /bye/);
out = Lens.evaluate({ ...args, players: { ...players, rb: { ...players.rb, injury_status: 'Out' } } }); swap = find(out, 'better');
assert.equal(swap.weekly.before, null); assert.equal(swap.outgoing[0].projection, null); assert.match(swap.reason, /unavailable/);
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, injury_status: 'Out' } } }); assert(!find(out, 'better'));
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, injury_status: 'Questionable' } },
    projectionsByPid: { ...args.projectionsByPid, better: { available: false, points: { median: null }, conditionalPoints: { median: 21 } } } });
swap = find(out, 'better'); assert.equal(swap.weekly.delta, 9); assert.equal(swap.conditional, true); assert.equal(swap.conditionalLabel, 'If they play');
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, injury_status: 'Questionable' } }, projectionsByPid: { ...args.projectionsByPid, better: null } }); assert(!find(out, 'better'), 'Questionable never invents a forecast');
out = Lens.evaluate({ ...args, players: { ...players, better: { ...players.better, injury_status: 'Questionable' } },
    projectionsByPid: { ...args.projectionsByPid, better: { scoringSupported: false, conditionalPoints: { median: 90 } } } });
assert(!find(out, 'better'), 'Conditional points cannot override unsupported scoring');

window.App.LeagueStats = { score: (raw, scoring) => raw.rec * scoring.rec };
const statsData = Object.fromEntries(Object.keys(players).map(pid => [pid, { gp: 4, rec: pid === 'better' ? 80 : 40 }]));
out = Lens.evaluate({ ...args, basis: 'average', statsData }); swap = find(out, 'better'); assert.equal(swap.weekly.delta, 10); assert.equal(swap.incoming[0].comparisonBasis, 'average');
out = Lens.evaluate({ ...args, basis: 'idp-average', statsData }); assert.equal(find(out, 'better').weekly.delta, 7, 'Offense retains projections in IDP average mode');
assert.equal(Lens.evaluate({ ...args, basis: 'average', statsData, statsSeason: 2025 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, platformStarters: ['qb', 'wr', 'wr'] }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, roster: { ...roster, starters: [] } }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, userId: 'stranger' }).status, 'disabled');
assert.equal(Lens.evaluate({ ...args, currentSeason: 2025 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, week: 5 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, week: 19 }).status, 'unavailable');
assert.equal(Lens.evaluate({ ...args, skin: { type: 'best_ball' } }).status, 'disabled');
assert.equal(Lens.evaluate({ ...args, league: { ...league, scoring_settings: {} } }).status, 'unavailable');
window.wrIsPro = () => false; assert.equal(Lens.evaluate(args).status, 'disabled'); delete window.wrIsPro;
const future = { ...args, week: 7, scheduleWeek: 7, games: [{ ...games[0], kickoff: '2026-10-25T20:25:00Z' }] };
assert.equal(Lens.evaluate(future).status, 'unavailable', 'Future projections require exact week and season evidence');
assert(find(Lens.evaluate({ ...future, projectionsWeek: 7, projectionsSeason: 2026 }), 'better'));
assert.equal(Lens.evaluate({ ...future, projectionsWeek: 6, projectionsSeason: 2026 }).status, 'unavailable');
console.log('PASS lineup lens: legal individual swaps, FLEX/IDP, reserves, per-player locks, null/zero/negative, conditional forecasts, scoped weeks and averages');

(async () => {
    const calls = [], actualNow = Date.now();
    const liveGames = [{ ...games[0], kickoff: new Date(actualNow + 3600000).toISOString() }];
    window.App.NflContext = { loadScores: async (week, season) => { calls.push(['schedule', week, season]); return liveGames; } };
    window.App.WeeklyProj = { currentWeek: () => 6, ensureWeekProjections: async week => { calls.push(['provider', week]); return Object.fromEntries(Object.keys(players).map(pid => [pid, { rec_tgt: 8 }])); },
        projectPlayer: (pid, opts) => { calls.push(['project', pid, opts.week, opts.scoring.rec]); return { available: true, week: opts.week, points: { median: args.projectionsByPid[pid] } }; } };
    let unsubscribed = 0;
    window.App.LeagueLiveScores = { currentWeek: () => 6, supported: () => true, createClient: () => {
        let listener;
        return { subscribe: (league, week, fn) => { calls.push(['submitted', week]); listener = fn; fn({ status: 'loading' }); return () => { unsubscribed++; }; },
            refresh: async () => { listener({ status: 'ready', rows: [{ roster_id: 1, starters: ['qb', 'wr', 'better'] }] }); } };
    } };
    const loadArgs = { ...args, now: undefined, games: undefined, gamesUpdatedAt: undefined, projectionsByPid: undefined, statsData, priorData: {} };
    let loaded = await Lens.load(loadArgs);
    assert.equal(loaded.status, 'ready'); assert(!find(loaded, 'better'), 'Live platform starter row overrides stale roster starters');
    assert.equal(unsubscribed, 1, 'One-shot platform reader leaves no polling subscription');
    assert(calls.some(call => call[0] === 'schedule' && call[1] === 6 && call[2] === 2026));
    assert(calls.filter(call => call[0] === 'project').every(call => call[2] === 6 && call[3] === 1), 'Forecasts use selected week and exact league scoring');
    window.App.LeagueLiveScores.createClient = () => ({ subscribe: (league, week, fn) => { fn({ status: 'error', rows: [] }); return () => {}; }, refresh: async () => {} });
    loaded = await Lens.load(loadArgs); assert.equal(loaded.status, 'unavailable', 'Failed current submitted lineup refresh cannot silently use stale roster starters');
    window.App.WeeklyProj.ensureWeekProjections = async () => ({});
    loaded = await Lens.load({ ...loadArgs, week: 7 }); assert.equal(loaded.status, 'unavailable'); assert.equal(loaded.candidates.length, 0, 'Future week never borrows historical or current-week forecasts');
    let release;
    window.App.WeeklyProj.ensureWeekProjections = () => new Promise(resolve => { release = resolve; });
    const pending = Lens.load({ ...loadArgs, platformStarters: roster.starters });
    window.S.user = { user_id: 'changed-account' }; release({});
    loaded = await pending; assert.equal(loaded.status, 'unavailable'); assert.match(loaded.reason, /account changed/);
    window.S.user = { user_id: 'owner' };
    // Exercise the actual shared platform client, not only its mocked seam.
    window.setTimeout = setTimeout; window.clearTimeout = clearTimeout; window.AbortController = AbortController;
    const realFetches = [];
    window.fetch = async url => { realFetches.push(url); return { ok: true, json: async () => [{ roster_id: 1, starters: ['qb', 'wr', 'better'] }] }; };
    vm.runInContext(fs.readFileSync('js/shared/league-live-scores.js', 'utf8'), ctx, { filename: 'js/shared/league-live-scores.js' });
    loaded = await Lens.load({ ...loadArgs, projectionsByPid: args.projectionsByPid });
    assert.equal(loaded.status, 'ready'); assert(!find(loaded, 'better'));
    assert.equal(realFetches.length, 1, 'Actual subscribe/refresh shares one provider request');
    assert.match(realFetches[0], /league\/lineup-league\/matchups\/6$/);
    // Future provider reads are isolated from the single live WeeklyProj cache.
    let sharedFutureCalls = 0, futureFetches = 0;
    window.App.WeeklyProj.ensureWeekProjections = async () => { sharedFutureCalls++; throw new Error('Future reads must not evict live cache'); };
    const fetcher = async url => { futureFetches++; assert.match(url, /projections\/nfl\/regular\/2026\/8$/); return { ok: true, json: async () => Object.fromEntries(Object.keys(players).map(pid => [pid, { rec_tgt: 8 }])) }; };
    loaded = await Lens.load({ ...loadArgs, week: 8, platformStarters: roster.starters, fetcher });
    assert.equal(loaded.status, 'ready'); assert(find(loaded, 'better'));
    assert.equal(sharedFutureCalls, 0); assert.equal(futureFetches, 1);
    await Lens.load({ ...loadArgs, week: 8, platformStarters: roster.starters, fetcher });
    assert.equal(futureFetches, 1, 'Future refresh uses its isolated short-lived cache');
    let receivedSeasonBaseline;
    window.App.WeeklyProj.ensureWeekProjections = async () => ({});
    window.App.WeeklyProj.projectPlayer = (pid, opts) => { receivedSeasonBaseline = opts.projectionsData; return { available: true, points: { median: args.projectionsByPid[pid] } }; };
    const projectionsData = Object.fromEntries(Object.keys(players).map(pid => [pid, { rec_tgt: 80 }]));
    loaded = await Lens.load({ ...loadArgs, platformStarters: roster.starters, statsData: {}, priorData: {}, projectionsData });
    assert.equal(loaded.status, 'ready'); assert.equal(receivedSeasonBaseline, projectionsData, 'Usable current-season rookie baseline reaches the shared scorer');
    console.log('PASS lineup lens loader: current submitted starters, exact week/scoring, subscription cleanup, failed-refresh isolation, future evidence and stale account guards');

    // Real production projection + scorer path. Only provider transport and
    // schedule transport are fixtures; no projection/point method is mocked.
    const statLines = { runner: { rush_att: 15, rush_yd: 70 }, catcher: { rec_tgt: 8, rec: 6, rec_yd: 40 }, tight: { rec_tgt: 4, rec: 2, rec_yd: 40 } };
    const realRoot = { App: { NFLByes: { weekForPlayer: () => null }, NflContext: { loadScores: async () => liveGames } },
        S: { currentLeagueId: 'lineup-league', currentWeek: 6, nflState: { season: 2026, week: 6 }, user: { user_id: 'owner' } },
        dispatchEvent: () => {} };
    const requests = [];
    const transport = async url => { requests.push(url); return { ok: true, json: async () => statLines }; };
    realRoot.fetch = transport;
    const realContext = vm.createContext({ window: realRoot, fetch: transport, console, Promise, Date, CustomEvent: function (type) { this.type = type; } });
    for (const path of ['reconai-shared/sleeper-api.js', 'js/shared/startsit-engine.js', 'js/shared/weekly-proj.js', 'js/shared/roster-lineup-lens.js']) {
        vm.runInContext(fs.readFileSync(path, 'utf8'), realContext, { filename: path });
    }
    const realPlayers = { runner: player('Runner', 'RB'), catcher: player('Catcher', 'WR'), tight: player('Tight end', 'TE'), missing: player('No forecast', 'RB') };
    const realRoster = { roster_id: 1, owner_id: 'owner', players: ['runner', 'catcher'], starters: ['runner'] };
    const realArgs = { league: { ...league, roster_positions: ['FLEX', 'BN'], scoring_settings: { rush_yd: 0.1, rec_yd: 0.1, rec: 0 } },
        roster: realRoster, platformStarters: ['runner'], players: realPlayers, userId: 'owner', currentSeason: 2026, currentWeek: 6, week: 6, statsData: {}, priorData: {} };
    const realLens = realRoot.App.RosterLineupLens;
    let scored = await realLens.load(realArgs);
    assert.equal(scored.status, 'empty', 'Standard scoring keeps 7 rushing points over 4 receiving points');
    const pprArgs = { ...realArgs, league: { ...realArgs.league, scoring_settings: { ...realArgs.league.scoring_settings, rec: 1 } } };
    scored = await realLens.load(pprArgs);
    let realSwap = scored.candidates[0];
    assert.equal(realSwap.incoming[0].pid, 'catcher'); assert.equal(realSwap.weekly.before, 7); assert.equal(realSwap.weekly.after, 10); assert.equal(realSwap.weekly.delta, 3);
    const teArgs = { ...pprArgs, roster: { ...realRoster, players: ['runner', 'tight'] } };
    assert.equal((await realLens.load(teArgs)).status, 'empty', 'Without TE premium, the 6-point TE stays on the bench');
    scored = await realLens.load({ ...teArgs, league: { ...teArgs.league, scoring_settings: { ...teArgs.league.scoring_settings, bonus_rec_te: 1 } } });
    assert.equal(scored.candidates[0].weekly.after, 8); assert.equal(scored.candidates[0].weekly.delta, 1, 'Actual StartSit scorer applies TE premium to a legal FLEX swap');
    scored = await realLens.load({ ...pprArgs, players: { ...realPlayers, catcher: { ...realPlayers.catcher, injury_status: 'Questionable' } } });
    realSwap = scored.candidates[0];
    assert.equal(realSwap.incoming[0].pid, 'catcher'); assert.equal(realSwap.conditional, true); assert.equal(realSwap.conditionalLabel, 'If they play');
    assert.equal(realSwap.weekly.delta, 2.2, 'Real Questionable path remains usable with the existing 0.92 injury multiplier');
    assert(Math.abs(realSwap.weekly.after - 9.2) < 0.00001);
    scored = await realLens.load({ ...pprArgs, roster: { ...realRoster, players: ['runner', 'missing'] } });
    assert.equal(scored.status, 'unavailable'); assert.equal(scored.candidates.length, 0, 'No baseline for an eligible bench player remains unknown');
    scored = await realLens.load({ ...pprArgs, roster: { ...realRoster, players: ['missing', 'catcher'], starters: ['missing'] }, platformStarters: ['missing'] });
    assert.equal(scored.status, 'unavailable'); assert.equal(scored.candidates.length, 0, 'A missing starter baseline cannot manufacture a gain from zero');
    assert.equal(requests.length, 1, 'Actual WeeklyProj cache reuses the exact same week stat lines across league scoring comparisons');
    assert.match(requests[0], /projections\/nfl\/regular\/2026\/6$/);
    console.log('PASS real scorer integration: standard/PPR/TE-premium swaps, actual Questionable availability, and absent baselines remain unknown');
})().catch(error => { console.error(error); process.exitCode = 1; });
