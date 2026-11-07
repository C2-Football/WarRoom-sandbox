#!/usr/bin/env node
// Unit tests for js/shared/empire-values.js — MARK TO LEAGUE.
// Hand-built leagues that differ ONLY in the ways the doctrine says may move a
// price (scoring, roster slots, team count), so every assertion is about the
// engine honouring those and nothing else.
'use strict';

const assert = require('assert');
globalThis.fetch = () => Promise.resolve({ ok: false });
global.window = globalThis;
window.S = { currentWeek: 1 };
window.App = {};
const StartSit = require('../js/shared/startsit-engine.js');
const WeeklyProj = require('../js/shared/weekly-proj.js');
window.App.StartSit = window.App.StartSit || StartSit;
window.App.WeeklyProj = window.App.WeeklyProj || WeeklyProj;
window.App.normPos = p => String(p || '').toUpperCase();
// Use the shipped position-aware scorer, including TE reception premiums.
require('../reconai-shared/sleeper-api.js');
require('../js/utils/player-value.js');
const EV = require('../js/shared/empire-values.js');
const PV = window.App.PlayerValue;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixtures ────────────────────────────────────────────────────────
// A realistic pool: the replacement-rank difference between a 1QB league
// (12 QBs start) and a superflex one (~21) only bites if enough quarterbacks
// EXIST to rank that deep. A three-QB fixture clamps both to the same worst
// player and the formats look identical — which is a fixture artifact, not
// engine behaviour.
const PLAYERS = {}, PROJ = {};
function addPool(prefix, pos, n, build) {
  for (let i = 1; i <= n; i++) {
    const id = prefix + i;
    PLAYERS[id] = { position: pos, full_name: pos + ' ' + i, team: 'KC', status: 'Active' };
    PROJ[id] = Object.assign({ gp: 17 }, build(i));
  }
}
// Declining production down each positional ladder.
addPool('qb', 'QB', 32, i => ({ pass_yd: 5000 - i * 90, pass_td: 42 - i * 0.9, pass_int: 8 + i * 0.2, rush_yd: 520 - i * 14, rush_td: 7 - i * 0.18 }));
addPool('rb', 'RB', 60, i => ({ rush_yd: 1450 - i * 18, rush_td: 13 - i * 0.16, rec: 62 - i * 0.7, rec_yd: 520 - i * 6, rec_td: 3 }));
addPool('wr', 'WR', 80, i => ({ rec: 115 - i * 1.0, rec_yd: 1550 - i * 14, rec_td: 11 - i * 0.1 }));
addPool('te', 'TE', 30, i => ({ rec: 88 - i * 2.0, rec_yd: 1050 - i * 26, rec_td: 8 - i * 0.2 }));
const SCORES = {}; Object.keys(PLAYERS).forEach(p => { SCORES[p] = 1000; });

const BASE_SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6 };
const oneQbRoster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];
const superflexRoster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'];

// Every fixture league must read as DRAFTED. The engine deliberately refuses to
// mark a league with ZERO rostered players — a pre-draft book has nobody on any
// roster, so every player trivially reads "still a free agent" there and the
// spread against it is an artifact of the draft not having happened yet, not a
// real cross-league read. See js/shared/empire-values.js `if (!own.rostered.size)`,
// added in 333f22e "Empire Command: exclude pre-draft leagues from arbitrage".
// These two tail players are rostered by a rival in every fixture purely so the
// book counts as drafted; no assertion below ever names them, and ownership is
// provably price-neutral (computePrices never reads league.rosters), so this
// changes which leagues get MARKED and nothing about what they quote.
const FILLER = ['wr80', 'te30'];
const draftedRosters = () => ([
  { roster_id: 1, owner_id: 'me', players: [] },
  { roster_id: 2, owner_id: 'rival', players: [...FILLER] },
]);

const league = (id, name, over) => Object.assign({
  league_id: id, name, total_rosters: 12,
  roster_positions: oneQbRoster,
  scoring_settings: { ...BASE_SCORING },
  settings: { type: 0, playoff_week_start: 15 },
  rosters: draftedRosters(),
}, over || {});

const runBuild = (leagues) => EV.build({
  leagues, playersData: PLAYERS, priorData: {}, projectionsData: PROJ,
  playerScores: SCORES, week: 1,
});

// ── Slot derivation (the mechanism superflex pricing rests on) ──────
test('slotsFromRoster: superflex creates real QB demand; bench is ignored', () => {
  const one = PV.slotsFromRoster(oneQbRoster);
  const sf = PV.slotsFromRoster(superflexRoster);
  assert.strictEqual(one.QB, 1, '1QB league starts one quarterback');
  assert.ok(sf.QB > one.QB, 'superflex starts more: ' + sf.QB);
  assert.ok(sf.QB >= 1.7 && sf.QB <= 1.8, 'SUPER_FLEX is overwhelmingly a QB slot: ' + sf.QB);
  assert.ok(!('BN' in one), 'bench slots never count as starters');
});

// ── The headline: same player, different books ─────────────────────
test('superflex prices quarterbacks above an otherwise identical 1QB league', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  assert.ok(out, 'built');
  const qbOne = out.priceOf('qb1', 'ONE'), qbSf = out.priceOf('qb1', 'SF');
  const rbOne = out.priceOf('rb1', 'ONE'), rbSf = out.priceOf('rb1', 'SF');
  assert.ok(qbSf > qbOne, `elite QB is worth more in superflex (${qbSf} vs ${qbOne})`);
  // And it is specifically a QB effect, not the whole board drifting.
  assert.ok((qbSf / qbOne) > (rbSf / rbOne), 'QBs gain relative to RBs, which is the actual difference between the formats');
});

test('a scoring change moves the position it touches — and only that position', () => {
  const out = runBuild([
    league('STD', 'Standard TE'),
    league('PREM', 'TE premium', { scoring_settings: { ...BASE_SCORING, bonus_rec_te: 1 } }),
  ]);
  const teStd = out.priceOf('te1', 'STD'), tePrem = out.priceOf('te1', 'PREM');
  const wrStd = out.priceOf('wr1', 'STD'), wrPrem = out.priceOf('wr1', 'PREM');
  assert.ok(tePrem > teStd, `TE premium lifts the TE (${tePrem} vs ${teStd})`);
  assert.ok((tePrem / teStd) > (wrPrem / wrStd), 'and lifts him relative to a receiver it does not touch');
});

test('identical leagues quote identical prices — nothing drifts on its own', () => {
  const out = runBuild([league('A', 'Alpha'), league('B', 'Bravo')]);
  Object.keys(PLAYERS).forEach(pid => {
    assert.strictEqual(out.priceOf(pid, 'A'), out.priceOf(pid, 'B'), pid + ' must price the same in two identical leagues');
  });
  assert.strictEqual(out.arbitrage.length, 0, 'and there is no arbitrage between identical books');
});

// ── Robust anchoring (the outlier defence) ─────────────────────────
test('one freak valuation cannot rescale a league board', () => {
  // A league that scores a single stat absurdly — the shape of the real
  // IDP-scored-team-defense artifact that compressed a whole board.
  const freakPlayers = { ...PLAYERS, freak: { position: 'K', full_name: 'Freak Kicker', team: 'KC' } };
  const freakProj = { ...PROJ, freak: { gp: 17, fgm: 400 } };
  const out = EV.build({
    leagues: [
      league('CLEAN', 'Clean'),
      league('FREAK', 'Freak', { scoring_settings: { ...BASE_SCORING, fgm: 50 } }),
    ],
    playersData: freakPlayers, priorData: {}, projectionsData: freakProj,
    playerScores: { ...SCORES, freak: 1000 }, week: 1,
  });
  const a = out.byLeague.CLEAN, b = out.byLeague.FREAK;
  assert.ok(a && b, 'both priced');
  // The skill board must survive the outlier essentially intact.
  const ratio = b.values.rb1 / a.values.rb1;
  assert.ok(ratio > 0.8 && ratio < 1.25, 'the elite RB is not crushed by an unrelated freak: ratio ' + ratio.toFixed(2));
});

test('every league is re-anchored to the common scale', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
    league('DEEP', 'Deep', { total_rosters: 32 }),
  ]);
  Object.keys(out.byLeague).forEach(lid => {
    assert.ok(out.byLeague[lid].anchor > 0, lid + ' reports its anchor');
    assert.ok(out.byLeague[lid].rescale > 0, lid + ' reports its rescale factor');
  });
});

// ── Arbitrage board ────────────────────────────────────────────────
test('arbitrage names the high and low book and the capturable gap', () => {
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  assert.ok(out.arbitrage.length > 0, 'two genuinely different formats produce spreads');
  const row = out.arbitrage[0];
  assert.ok(row.high.value > row.low.value, 'high book really is higher');
  assert.strictEqual(row.gap, row.high.value - row.low.value, 'gap is the capturable difference');
  assert.ok(row.spreadPct >= EV.MIN_SPREAD_PCT, 'every row clears the noise floor');
  for (let i = 1; i < out.arbitrage.length; i++) {
    assert.ok(out.arbitrage[i - 1].gap >= out.arbitrage[i].gap, 'sorted by gap descending');
  }
});

test('the superflex premium lands on MARGINAL quarterbacks, not elite ones', () => {
  // The real economics, and a good guard against a naive "QBs are worth more"
  // implementation: in a 12-team 1QB league QB12 IS replacement level, so
  // superflex turns him into a starter and his price roughly doubles. An
  // elite QB was already valuable in both formats and barely moves.
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  const elite = out.spread('qb1'), marginal = out.spread('qb12');
  assert.ok(elite && marginal, 'both priced in both books');
  assert.strictEqual(marginal.high.name, 'Superflex', 'the marginal QB is worth more in superflex');
  assert.ok(marginal.spreadPct > elite.spreadPct * 3,
    `marginal QB moves far more than the elite one (${marginal.spreadPct}% vs ${elite.spreadPct}%)`);
  // And the other side of the same coin: superflex spends roster room on QBs,
  // so elite running backs are relatively CHEAPER there.
  const rb = out.spread('rb1');
  assert.strictEqual(rb.high.name, 'One QB', 'elite RB is worth more where QBs are not scarce');
});

test('spread() returns null for a player only one league prices', () => {
  const out = runBuild([league('A', 'Alpha')]);
  assert.strictEqual(out.spread('qb1'), null, 'one book is not a spread');
  assert.strictEqual(out.arbitrage.length, 0);
});

// ── Ownership: leagues are disjoint player pools, so the engine states
// facts (mine / rostered elsewhere / free agent) rather than issuing a
// buy-here-sell-there instruction nobody could actually execute. ──────
// The rival always holds the filler picks too, so a league in which the player
// under test is owned by NOBODY still reads as drafted (see FILLER above) —
// otherwise the engine skips the whole book and there is no spread to assert on.
const rostersOwning = (myPid, otherPid) => [
  { roster_id: 1, owner_id: 'me', players: [myPid].filter(Boolean) },
  { roster_id: 2, owner_id: 'rival', players: [otherPid, ...FILLER].filter(Boolean) },
];

test('ownership: a shared player owned in both books is framed as leverage, not a trade instruction', () => {
  // runBuild() does not thread myUserId — call build() directly.
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning('qb1', null) }),
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning('qb1', null) }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.ok(s.high.mine && s.low.mine, 'owned in both books');
  assert.ok(/foundational piece/.test(s.note) && /throw-in/.test(s.note), 'states leverage, not a move: ' + s.note);
  assert.ok(!/[Ss]ell/.test(s.note) && !/[Bb]uy/.test(s.note), 'never instructs a cross-league move that is not possible');
});

test('ownership: owned in the high book, free agent in the low book', () => {
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning(null, null) }),      // qb1 unrostered
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning('qb1', null) }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.strictEqual(s.high.name, 'Superflex');
  assert.ok(s.high.mine, 'mine in the high (superflex) book');
  assert.ok(s.low.freeAgent, 'and a free agent in the low book');
  assert.ok(/free agent/.test(s.note));
});

test('ownership: owned by a rival in the other book reads as intel, not an instruction', () => {
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning('qb1', null) }),
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning(null, 'qb1') }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.ok(s.low.mine, 'mine in the cheap book');
  assert.ok(s.high.rosteredElsewhere, 'a rival holds him in the dear book');
  assert.ok(/rival already holds him/.test(s.note));
});

test('ownership: rows touching your roster sort ahead of pure market intel', () => {
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning('rb1', null) }),   // you own rb1
      // Drafted, but rb1 is nobody's there — a bare `rosters: []` would make
      // this a pre-draft book the engine declines to mark at all.
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: draftedRosters() }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const rb1Idx = out.arbitrage.findIndex(a => a.pid === 'rb1');
  const marketOnlyIdx = out.arbitrage.findIndex(a => a.mineCount === 0);
  assert.ok(rb1Idx >= 0, 'rb1 spread present');
  assert.strictEqual(out.arbitrage[rb1Idx].mineCount, 1);
  if (marketOnlyIdx >= 0) assert.ok(rb1Idx < marketOnlyIdx, 'owned row ranks ahead of a market-only row');
});

test('ownership: spreadMine ALWAYS agrees with the note — a THIRD league does not count', () => {
  // The exact bug this regression test exists for: a player owned in a
  // league that is neither the displayed high NOR low leg still counted
  // toward mineCount, so the "YOURS" badge fired next to a note reading
  // "not on your roster in either league" — a self-contradicting row.
  // Add a third, middling-value league where the player IS owned, but make
  // sure the displayed high/low pair (ONE vs SF) has him as a free agent
  // in both.
  // Three genuinely different books for qb1 (verified empirically: SF prices
  // him highest, a 24-team league lowest, ONE lands in between) — ownership
  // sits on the MIDDLE one, which sort() guarantees is never high[0] nor
  // low[last] once there are 3+ distinct-priced legs. If the engine's
  // internals ever shift these numbers, this assertion (not a hardcoded
  // ordering) is what catches whether the fixture still proves the point.
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning('qb1', null) }),
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning(null, null) }),
      league('DEEP', 'Deep', { total_rosters: 24, rosters: rostersOwning(null, null) }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.ok(![s.high.leagueId, s.low.leagueId].includes('ONE'),
    'fixture precondition: ONE must be the middle-priced leg, never displayed as high or low — got high=' + s.high.leagueId + ' low=' + s.low.leagueId);
  assert.strictEqual(s.mineCount, 1, 'owned in exactly one league overall (ONE)');
  assert.strictEqual(s.spreadMine, false, 'but the DISPLAYED spread does not touch your roster');
  // The note describes high/low (SF vs DEEP, both free agents for 'me') and
  // is correct to say so — the regression this guards against is the note
  // EVER claiming ownership ("Yours in...") while spreadMine is false.
  assert.ok(!/^Yours in/.test(s.note), 'note must never claim ownership spreadMine denies: ' + s.note);
  assert.ok(/Free agent in both/.test(s.note), 'both displayed legs are genuinely free agents here: ' + s.note);
});

test('ownership: spreadMine is true exactly when the note describes your roster', () => {
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning('qb1', null) }),
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning(null, null) }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.strictEqual(s.spreadMine, true);
  assert.ok(/[Yy]ours in/.test(s.note));
});

test('ownership: with no myUserId, nobody reads as yours and nothing crashes', () => {
  // runBuild() threads no myUserId at all, so no roster can resolve to the
  // caller however the leagues are filled. Nothing may be flagged `mine`, and
  // an unowned player must read as a plain free agent rather than throwing.
  const out = runBuild([
    league('ONE', 'One QB'),
    league('SF', 'Superflex', { roster_positions: superflexRoster }),
  ]);
  const s = out.spread('qb1');
  assert.strictEqual(s.high.mine, false);
  assert.strictEqual(s.mineCount, 0);
  assert.ok(s.high.freeAgent && s.low.freeAgent, 'nobody rosters qb1 in either fixture book');
  assert.ok(/Free agent in both/.test(s.note));
});

test('a pre-draft league is not marked at all — an empty book is not a cheap book', () => {
  // The rule the fixtures above exist to satisfy, asserted head-on. Before
  // 333f22e a league nobody had drafted was priced from its scoring settings
  // alone and every player read as "still a free agent" there, manufacturing a
  // spread against a book with no owners in it. Such a league must now be
  // reported in `unpriced` and kept out of `byLeague` entirely.
  const out = EV.build({
    leagues: [
      league('DRAFTED', 'Drafted', { rosters: rostersOwning('qb1', null) }),
      league('PREDRAFT', 'Pre-draft', {
        roster_positions: superflexRoster,
        rosters: [{ roster_id: 1, owner_id: 'me', players: [] }, { roster_id: 2, owner_id: 'rival', players: [] }],
      }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  assert.ok(out.byLeague.DRAFTED, 'the drafted book is marked');
  assert.ok(!out.byLeague.PREDRAFT, 'the pre-draft book is not');
  assert.ok(out.unpriced.includes('PREDRAFT'), 'and it is reported, not silently dropped');
  assert.strictEqual(out.priceOf('qb1', 'PREDRAFT'), 0, 'nothing is quoted against an undrafted book');
  assert.strictEqual(out.spread('qb1'), null, 'one remaining book is not a spread');
  assert.strictEqual(out.arbitrage.length, 0, 'and it cannot arbitrage against one');

  // `priced` must agree with `unpriced` — it means "in the marked book", not
  // "computePrices succeeded". A pre-draft league prices fine and is still
  // skipped, so the flag has to follow the skip, otherwise
  // `leagues.filter(l => l.priced)` hands you an id whose byLeague[id] is
  // undefined. Every league still gets a meta row either way.
  const metaFor = id => out.leagues.find(l => l.id === id);
  assert.strictEqual(metaFor('DRAFTED').priced, true, 'the drafted league reports priced');
  assert.strictEqual(metaFor('PREDRAFT').priced, false, 'the pre-draft league must NOT report priced');
  assert.strictEqual(out.leagues.length, 2, 'both leagues still get a meta row');
  out.leagues.forEach(l => {
    assert.strictEqual(
      l.priced, !out.unpriced.includes(l.id),
      `priced must be the inverse of unpriced for ${l.id}`
    );
    assert.strictEqual(
      l.priced, !!out.byLeague[l.id],
      `priced must guarantee byLeague[${l.id}] exists`
    );
  });
});

test('ownership: rostered by someone (not me) in both books reads as pure intel', () => {
  const out = EV.build({
    leagues: [
      league('ONE', 'One QB', { rosters: rostersOwning(null, 'qb1') }),
      league('SF', 'Superflex', { roster_positions: superflexRoster, rosters: rostersOwning(null, 'qb1') }),
    ],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
    myUserId: 'me',
  });
  const s = out.spread('qb1');
  assert.strictEqual(s.mineCount, 0);
  assert.ok(/league intel only/.test(s.note));
});

test('formatOf reads Sleeper league types, chopped included', () => {
  assert.strictEqual(EV.formatOf({ settings: { type: 0 } }), 'redraft');
  assert.strictEqual(EV.formatOf({ settings: { type: 1 } }), 'keeper');
  assert.strictEqual(EV.formatOf({ settings: { type: 2 } }), 'dynasty');
  assert.strictEqual(EV.formatOf({ settings: { type: 3 } }), 'chopped');
});

test('a league that cannot be priced is reported, not silently dropped', () => {
  const out = EV.build({
    leagues: [league('A', 'Alpha'), league('DEAD', 'No Data', { scoring_settings: {} })],
    playersData: PLAYERS, priorData: {}, projectionsData: PROJ, playerScores: SCORES, week: 1,
  });
  assert.strictEqual(out.leagues.length, 2, 'both leagues appear in the manifest');
  out.leagues.forEach(l => assert.ok(typeof l.priced === 'boolean', l.id + ' declares whether it priced'));
});

test('build refuses gracefully with no leagues', () => {
  assert.strictEqual(EV.build({ leagues: [] }), null);
  assert.strictEqual(EV.build({}), null);
});

test('current-season evidence excludes historical books and players with only dynasty/history data', () => {
  const projections = { ...PROJ }; delete projections.qb1;
  const out = EV.build({ leagues: [league('NOW', 'Now', { season: '2026' }), league('OLD', 'Old', { season: '2025' })],
    playersData: PLAYERS, priorData: PROJ, projectionsData: projections, playerScores: SCORES, week: 2,
    season: '2026', requireCurrentEvidence: true });
  assert.strictEqual(out.byLeague.NOW.evidence, 'current-season');
  assert.strictEqual(out.byLeague.NOW.season, '2026');
  assert.strictEqual(out.byLeague.NOW.values.qb1, undefined, 'history and dynasty scores do not fill missing current evidence');
  assert.ok(out.byLeague.NOW.values.qb2 > 0);
  assert.strictEqual(out.byLeague.OLD, undefined);
  assert.strictEqual(out.leagues.find(l => l.id === 'OLD').priced, false);
  const empty = EV.build({ leagues: [league('NOW', 'Now', { season: '2026' })], playersData: PLAYERS,
    priorData: PROJ, projectionsData: {}, playerScores: SCORES, week: 2, season: '2026', requireCurrentEvidence: true });
  assert.strictEqual(empty.byLeague.NOW, undefined);
});

test('format metadata honors blank fallthrough, explicit zero and keeper evidence', () => {
  assert.strictEqual(EV.formatOf({ type: '', settings: { type: 2 } }), 'dynasty');
  assert.strictEqual(EV.formatOf({ settings: { type: 0, keeper_count: 2 } }), 'redraft');
  assert.strictEqual(EV.formatOf({ settings: { keeper_count: 2 } }), 'keeper');
  assert.strictEqual(EV.formatOf({}), 'unknown');
});

test('seasonal ownership respects a connected platform roster identity', () => {
  const out = EV.build({ leagues: [league('MFL', 'Mapped account', { myRosterId: 1, rosters: [{ roster_id: 1, owner_id: 'platform-id', players: ['qb1'] }] })],
    playersData: PLAYERS, projectionsData: PROJ, playerScores: SCORES, week: 1, myUserId: 'sleeper-id' });
  assert.ok(out.byLeague.MFL.mine.has('qb1'));
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
