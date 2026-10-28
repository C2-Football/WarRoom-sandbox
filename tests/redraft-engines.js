#!/usr/bin/env node
// Unit tests for the redraft add-on engines: luck ledger (all-play / expected
// wins), playoff-odds Monte Carlo, FAAB bid model, and the weekly-proj
// "why this number" ledger. All pure-compute paths — no network (fetch is
// stubbed before the weekly-proj require so its provider cache can't fire).
'use strict';

const assert = require('assert');

// Stub fetch BEFORE requiring weekly-proj: its provider-projection cache
// self-warms via fetch, and a unit test must never touch the network.
globalThis.fetch = () => Promise.resolve({ ok: false });

const StartSit = require('../js/shared/startsit-engine.js');
const WeeklyProj = require('../js/shared/weekly-proj.js');
const Luck = require('../js/shared/luck-engine.js');
const Odds = require('../js/shared/playoff-odds.js');
const Faab = require('../js/shared/faab-engine.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Luck ledger ─────────────────────────────────────────────────────
// 4 teams, 3 weeks, hand-checkable scores. Matchups: (1v2), (3v4) each week.
const luckLeague = {
  rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: 'u' + id })),
  users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
};
const weeklyScores = {
  1: [{ rosterId: 1, points: 130, matchupId: 'a' }, { rosterId: 2, points: 100, matchupId: 'a' },
      { rosterId: 3, points: 120, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
  2: [{ rosterId: 1, points: 80, matchupId: 'a' }, { rosterId: 2, points: 110, matchupId: 'a' },
      { rosterId: 3, points: 125, matchupId: 'b' }, { rosterId: 4, points: 85, matchupId: 'b' }],
  3: [{ rosterId: 1, points: 140, matchupId: 'a' }, { rosterId: 2, points: 95, matchupId: 'a' },
      { rosterId: 3, points: 60, matchupId: 'b' }, { rosterId: 4, points: 100, matchupId: 'b' }],
};

test('luck: all-play records match hand computation', () => {
  const { rows } = Luck.buildLedger({ league: luckLeague, weeklyScores });
  const t1 = rows.find(r => r.rosterId === 1);
  // W1: 130 beats 100,120,90 → 3-0. W2: 80 beats none → 0-3. W3: 140 beats all → 3-0.
  assert.strictEqual(t1.allPlayW, 6, 'team1 all-play wins');
  assert.strictEqual(t1.allPlayL, 3, 'team1 all-play losses');
  assert.strictEqual(t1.wins, 2, 'team1 H2H wins (W1, W3)');
  assert.strictEqual(t1.losses, 1, 'team1 H2H losses (W2)');
});

test('luck: expected wins and luck are consistent', () => {
  const { rows } = Luck.buildLedger({ league: luckLeague, weeklyScores });
  for (const r of rows) {
    const apGames = r.allPlayW + r.allPlayL + r.allPlayT;
    assert.strictEqual(apGames, 9, 'each team plays 3 opponents × 3 weeks');
    assert.ok(Math.abs(r.expWins - r.allPlayPct * 3) < 0.06, 'expWins ≈ allPlayPct × games');
    assert.ok(Math.abs(r.luck - (r.wins + r.ties / 2 - r.expWins)) < 0.06, 'luck = actual − expected');
  }
  // League luck sums to ~0 only when H2H games all pair inside the counted set — true here.
  const total = rows.reduce((s, r) => s + r.luck, 0);
  assert.ok(Math.abs(total) < 0.21, 'league luck sums to ~0, got ' + total);
});

test('luck: unplayed weeks are dropped by the fetch gate, zero-score rows still count in compute', () => {
  const withDead = { ...weeklyScores, 4: [{ rosterId: 1, points: 0, matchupId: 'a' }, { rosterId: 2, points: 0, matchupId: 'a' }] };
  // buildLedger trusts its input; the "≥2 real scores" gate lives in fetchWeeklyScores.
  const { weeks } = Luck.buildLedger({ league: luckLeague, weeklyScores: withDead });
  assert.deepStrictEqual(weeks, [1, 2, 3, 4]);
});

// ── Playoff odds ────────────────────────────────────────────────────
function oddsFixture() {
  const ledger = Luck.buildLedger({ league: luckLeague, weeklyScores });
  // Make team 1 dominant going forward by feeding it a fat scoring history.
  ledger.rows.forEach(r => {
    if (r.rosterId === 1) r.weekly = r.weekly.map(g => ({ ...g, pts: 150 }));
    if (r.rosterId === 4) r.weekly = r.weekly.map(g => ({ ...g, pts: 70 }));
  });
  const futurePairs = { 4: [[1, 3], [2, 4]], 5: [[1, 4], [2, 3]] };
  return { ledger, futurePairs };
}

test('odds: deterministic for a fixed seed', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const a = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 2000, seed: 7 });
  const b = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 2000, seed: 7 });
  assert.deepStrictEqual(a.rows, b.rows, 'same seed → same odds');
});

test('odds: dominant team clears the field; probabilities are coherent', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const r = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 4000, seed: 11 });
  const t1 = r.rows.find(x => x.rosterId === 1);
  const t4 = r.rows.find(x => x.rosterId === 4);
  assert.ok(t1.playoffPct > 85, 'dominant team makes playoffs, got ' + t1.playoffPct);
  assert.ok(t4.playoffPct < 30, 'weak team mostly misses, got ' + t4.playoffPct);
  const titleSum = r.rows.reduce((s, x) => s + x.titlePct, 0);
  assert.ok(titleSum >= 97 && titleSum <= 103, 'title odds sum ≈ 100, got ' + titleSum);
  const playoffSum = r.rows.reduce((s, x) => s + x.playoffPct, 0);
  assert.ok(Math.abs(playoffSum - 200) <= 4, '2 playoff slots → playoff pcts sum ≈ 200, got ' + playoffSum);
});

test('odds: leverage brackets the unconditional probability', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const r = Odds.simulate({ league, ledger, futurePairs, myRosterId: 2, sims: 4000, seed: 3 });
  assert.ok(r.leverage, 'leverage computed for a team with a current-week game');
  assert.ok(r.leverage.ifWin >= r.leverage.current, 'winning cannot hurt');
  assert.ok(r.leverage.ifLose <= r.leverage.current, 'losing cannot help');
  assert.ok(r.leverage.ifWin > r.leverage.ifLose, 'leverage is a real spread');
});

test('odds: division winners are seeded when rosters carry divisions', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = {
    ...luckLeague,
    settings: { playoff_teams: 2, divisions: 2 },
    rosters: luckLeague.rosters.map(r => ({ ...r, settings: { division: r.roster_id <= 2 ? 1 : 2 } })),
  };
  const r = Odds.simulate({ league, ledger, futurePairs, sims: 2000, seed: 5 });
  assert.ok(r.usedDivisions, 'division seeding engaged');
  // Team 3 is the only real competition in division 2 (team 4 is weak): with 2
  // slots and 2 divisions, team 3 makes it far more often than open seeding.
  const t3 = r.rows.find(x => x.rosterId === 3);
  assert.ok(t3.playoffPct > 55, 'division winner slot lifts team 3, got ' + t3.playoffPct);
});

// ── FAAB ────────────────────────────────────────────────────────────
function faabLeague() {
  return {
    settings: { waiver_budget: 100, divisions: 0 },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    rosters: [1, 2, 3, 4].map(id => ({
      roster_id: id, owner_id: 'u' + id,
      settings: { waiver_budget_used: id === 2 ? 80 : 30 },
      players: id === 3 ? ['rb1'] : ['rb1', 'rb2', 'rb3'],   // team 3 thin at RB
    })),
    users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
  };
}
const faabPlayers = {
  rb1: { position: 'RB', injury_status: '' },
  rb2: { position: 'RB', injury_status: '' },
  rb3: { position: 'RB', injury_status: 'OUT' },
};
function bidTxn(rosterId, bid, week, failed) {
  faabPlayers['p' + week + rosterId] = {position:'RB'};
  return { type: 'waiver', status: failed ? 'failed' : 'complete', leg: week, settings: { waiver_bid: bid }, roster_ids: [rosterId], adds: { ['p' + week + rosterId]: rosterId } };
}

test('faab: cold start withholds bid advice and probabilities', () => {
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns: [bidTxn(2, 10, 3)], playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.6 });
  assert.ok(a.coldStart, 'under MIN_SAMPLE → coldStart');
  assert.equal(a.rec, null, 'insufficient history');
  assert.equal(a.ladder.length, 0);
});

test('faab: descriptive bid ladder respects budgets without probabilities', () => {
  const txns = [];
  for (let w = 1; w <= 6; w++) { txns.push(bidTxn(2, 8 + w, w), bidTxn(3, 20 + w, w), bidTxn(4, 5, w, true)); }
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.7 });
  assert.ok(!a.coldStart, '18 bids clears MIN_SAMPLE');
  for (let i = 1; i < a.ladder.length; i++) {
    assert.equal(a.ladder[i].winPct, undefined, 'no uncalibrated probability');
    assert.ok(a.ladder[i].bid >= a.ladder[i - 1].bid);
  }
  for (const r of a.rivals) assert.ok(r.estBid <= r.faabLeft, 'no rival bids money they do not have');
  const thin = a.rivals.find(r => r.rosterId === 3);
  assert.strictEqual(thin.need, 'HIGH', 'team 3 (one healthy RB, two RB slots) reads HIGH need');
});

test('faab: only completed claims count as descriptive winning-bid evidence', () => {
  const txns = [];
  for (let w = 1; w <= 5; w++) { txns.push(bidTxn(2, 10, w), bidTxn(3, 12, w), bidTxn(4, 30, w, true)); }
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.5 });
  assert.strictEqual(a.sampleSize, 10, 'only completed same-position winning bids');
  assert.ok(a.comps.every(c => c.bid !== 30), 'comps show WINNING bids only');
});

// ── Why-this-number ledger ──────────────────────────────────────────
const calc = require('./helpers/production-scorer.cjs')();

test('explain: stages reconcile to the final league-scored number', () => {
  const App = globalThis.App;
  App.SOS = { defenseRankings: { DEN: { vsTE: 30 } }, schedule: {} };
  WeeklyProj.setContext({ byTeamWeek: { 'LV|8': { opp: 'DEN', vegas: { impliedTotal: 26, spread: 3.5 }, weather: { indoor: true } } } });
  const playersData = { te1: { position: 'TE', team: 'LV', injury_status: '' } };
  const statsData = { te1: { gp: 7, rec: 42, rec_yd: 490, rec_td: 4.2 } };
  const scoring = { rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 };
  const ex = WeeklyProj.explainPlayer('te1', { playersData, statsData, scoring, week: 8, calcFn: calc });
  assert.ok(ex, 'ledger produced');
  assert.strictEqual(ex.stages[ex.stages.length - 1].pts.toFixed(1), ex.leaguePts.toFixed(1), 'last stage = final');
  const dvp = ex.stages.find(s => s.key === 'dvp');
  assert.ok(dvp && dvp.delta > 0, 'soft TE defense (rank 30) adds points');
  const vegas = ex.stages.find(s => s.key === 'vegas');
  assert.ok(vegas && vegas.delta > 0, 'above-average implied total adds points');
  assert.ok(ex.scoringEdge > 0, 'TE-premium league scores this line above the 0.5-PPR baseline');
  assert.ok(Math.abs((ex.leaguePts - ex.standardPts) - ex.scoringEdge) < 0.06, 'edge = league − standard');
});

// ── Unsigned players (no NFL team) ──────────────────────────────────
// Owner report 2026-09-06: DHQ recommended STARTING Kareem Hunt at ~13 points
// while he was an NFL free agent. Sleeper leaves `team` null for an unsigned
// player, carries no bye_week, and keeps status 'Active' (roster status, not a
// team) — so nothing marked him out and he scored a full projection off his
// prior-season line.

test('availability: FA (no NFL team) is out, like BYE and IR', () => {
  assert.strictEqual(StartSit.availability ? StartSit.availability('FA').available : false, false,
    'FA must be an out-status');
});

test('projectPlayer: an unsigned player projects zero and is unavailable', () => {
  // projectPlayer scores through the global calcFantasyPts (no calcFn seam),
  // so stand one up the way the app does.
  globalThis.calcFantasyPts = calc;
  const scoring = { rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 };
  // Same prior-season line for both; only the NFL team differs.
  const priorData = { rb1: { gp: 17, rush_yd: 611, rush_td: 8, rec: 18, rec_yd: 143, rec_td: 1 } };
  const statsData = { rb1: {} };

  const signed = WeeklyProj.projectPlayer('rb1', {
    playersData: { rb1: { position: 'RB', team: 'KC', injury_status: '' } },
    statsData, priorData, scoring, week: 3,
  });
  const unsigned = WeeklyProj.projectPlayer('rb1', {
    playersData: { rb1: { position: 'RB', team: null, injury_status: '' } },
    statsData, priorData, scoring, week: 3,
  });

  assert.ok(signed && signed.points.median > 0, 'the same line on a real team still projects');
  assert.ok(unsigned, 'unsigned player still returns a projection object');
  assert.strictEqual(unsigned.injuryStatus, 'FA', 'reason surfaces as FA, not an empty status');
  assert.strictEqual(unsigned.available, false, 'unsigned player is not startable');
  assert.strictEqual(unsigned.points.median, 0, 'unsigned player projects zero, not a prior-season baseline');
});

test("projectPlayer: the literal 'FA' team string is treated the same as null", () => {
  globalThis.calcFantasyPts = calc;
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6 };
  const out = WeeklyProj.projectPlayer('wr1', {
    playersData: { wr1: { position: 'WR', team: 'FA', injury_status: '' } },
    statsData: { wr1: {} },
    priorData: { wr1: { gp: 17, rec: 80, rec_yd: 1000, rec_td: 6 } },
    scoring, week: 3,
  });
  assert.strictEqual(out.available, false, "team 'FA' is also unsigned");
  assert.strictEqual(out.points.median, 0, "team 'FA' projects zero");
});

// ── Async: the weekly-score fetch contract ──────────────────────────
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

(async () => {
  // Analytics passes an explicit throughWeek for a FINISHED season, because
  // currentWeek() reads the live NFL week (1 all offseason) and would report
  // zero played weeks. That contract is what makes the end-of-year luck recap
  // work, so pin it.
  await testAsync('luck: fetchWeeklyScores honors explicit throughWeek and drops dead weeks', async () => {
    const calls = [];
    globalThis.fetchMatchups = (lid, w) => {
      calls.push(w);
      // Weeks 1–3 played; 4–5 all zeros (unplayed) → must be dropped, so an
      // in-progress or future week can't hand everyone an 0-11 all-play line.
      if (w >= 4) return Promise.resolve([{ roster_id: 1, points: 0, matchup_id: 'a' }, { roster_id: 2, points: 0, matchup_id: 'a' }]);
      return Promise.resolve([{ roster_id: 1, points: 100 + w, matchup_id: 'a' }, { roster_id: 2, points: 90, matchup_id: 'a' }]);
    };
    try {
      const league = { league_id: 'L1', rosters: luckLeague.rosters, users: luckLeague.users };
      const got = await Luck.fetchWeeklyScores({ league, throughWeek: 5 });
      assert.deepStrictEqual(calls.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5], 'fetches every week up to throughWeek');
      assert.deepStrictEqual(Object.keys(got).map(Number).sort((a, b) => a - b), [1, 2, 3], 'weeks without two real scores are dropped');
    } finally { delete globalThis.fetchMatchups; }
  });

  await testAsync('luck: no matchups fetcher → empty ledger, never a throw', async () => {
    const league = { league_id: 'L1', rosters: luckLeague.rosters, users: luckLeague.users };
    const got = await Luck.fetchWeeklyScores({ league, throughWeek: 4 });
    assert.deepStrictEqual(got, {}, 'degrades to no weeks');
    const { rows, weeks } = Luck.buildLedger({ league, weeklyScores: got });
    assert.deepStrictEqual(weeks, [], 'no weeks counted');
    assert.strictEqual(rows.length, 4, 'still returns a row per roster');
    assert.ok(rows.every(r => r.expWins === 0 && r.luck === 0), 'zero games → zero expected wins, zero luck');
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();
