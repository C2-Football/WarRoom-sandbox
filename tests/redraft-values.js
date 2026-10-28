#!/usr/bin/env node
// Unit tests for the REDRAFT value model v2 (player-value.js ensureRos +
// weekly-proj buildSeasonBaseline). Doctrine under test (owner ruling
// 2026-08-02): the only league-specific inputs are SCORING and ROSTER
// settings; the baseline (provider season projections + public stats +
// capped FantasyCalc REDRAFT calibration) is identical for everyone, and
// dynasty concepts never touch redraft values.
'use strict';

const assert = require('assert');

// Stub fetch BEFORE requires: weekly-proj self-warms a provider cache, and
// ensureRos fires the FantasyCalc redraft fetch — a unit test never networks.
globalThis.fetch = () => Promise.resolve({ ok: false });
global.window = globalThis;
window.S = { currentWeek: 1 };
window.App = {};
const StartSit = require('../js/shared/startsit-engine.js');
const WeeklyProj = require('../js/shared/weekly-proj.js');
window.App.StartSit = window.App.StartSit || StartSit;
window.App.WeeklyProj = window.App.WeeklyProj || WeeklyProj;
window.App.normPos = p => String(p || '').toUpperCase();
require('./helpers/production-scorer.cjs')();
require('../js/utils/player-value.js');
const PV = window.App.PlayerValue;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixtures ────────────────────────────────────────────────────────
const SCORING = { rec: 0.5, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6 };
const LEAGUE = {
  league_id: 'L1', season: '2026',
  scoring_settings: SCORING,
  settings: { playoff_week_start: 15 },
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
};
const PLAYERS = {
  vet:    { position: 'WR', team: 'BUF', full_name: 'Vet Wideout' },
  rook:   { position: 'RB', team: 'KC', full_name: 'Rookie Back' },
  ghost:  { position: 'WR', team: 'BUF', full_name: 'Ghost Shell' },
  stash:  { position: 'WR', team: 'BUF', full_name: 'Dynasty Stash' },
  wr2:    { position: 'WR', team: 'BUF', full_name: 'Second Wideout' },
};
// Vet: real 2025 history. Stash: dynasty-scored but no data at all.
const PRIOR = { vet: { gp: 17, rec: 100, rec_yd: 1400, rec_td: 8 }, wr2: { gp: 17, rec: 70, rec_yd: 900, rec_td: 5 } };
// Rookie: projection line only. Ghost: an all-zero projection shell.
const PROJ = {
  vet:  { gp: 18, rec: 90, rec_yd: 1250, rec_td: 7, rec_tgt: 130 },
  rook: { gp: 18, rec: 45, rec_yd: 380, rec_td: 2, rush_att: 220, rush_yd: 1000, rush_td: 7 },
  ghost: { gp: 18, rec: 0, rec_yd: 0 },
  wr2:  { gp: 18, rec: 65, rec_yd: 820, rec_td: 4, rec_tgt: 95 },
};
function freshCtx(over) {
  return Object.assign({
    leagueId: 'L1', league: LEAGUE, playersData: PLAYERS,
    statsData: {}, priorData: PRIOR, projectionsData: PROJ,
    skin: { type: 'redraft' }, noMarketFetch: true,
  }, over || {});
}
function resetState() {
  window.S = { currentWeek: 1 };
  window.App.LI = { playerScores: { stash: 8000, vet: 6000 }, starterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 } };
  // bust the (league, week) cache between tests by alternating league ids
}
let lid = 0;
function build(over) {
  resetState();
  lid++;
  const league = Object.assign({}, LEAGUE, { league_id: 'L' + lid }, (over && over.league) || {});
  return PV.ensureRos(freshCtx(Object.assign({}, over, { leagueId: 'L' + lid, league })));
}

// ── buildSeasonBaseline (weekly-proj) ───────────────────────────────
test('buildSeasonBaseline: rookie with projection only → pure projection line', () => {
  const line = WeeklyProj.buildSeasonBaseline('rook', null, null, PROJ.rook, SCORING, 1);
  assert.ok(line, 'line exists');
  assert.ok(Math.abs(line.rush_yd - 1000 / 18) < 0.01, 'per-game projection: ' + line.rush_yd);
});
test('buildSeasonBaseline: preseason vet blends proj 0.85 / history 0.15', () => {
  const line = WeeklyProj.buildSeasonBaseline('vet', null, PRIOR.vet, PROJ.vet, SCORING, 1);
  const projPG = 1250 / 18, histPG = 1400 / 17;
  const want = projPG * 0.85 + histPG * 0.15;
  assert.ok(Math.abs(line.rec_yd - want) < 0.01, `blend ${line.rec_yd} ≈ ${want}`);
});
test('buildSeasonBaseline: projection influence decays to zero by 6 games played', () => {
  const season = { gp: 6, rec: 30, rec_yd: 480, rec_td: 2 };
  const withProj = WeeklyProj.buildSeasonBaseline('vet', season, PRIOR.vet, PROJ.vet, SCORING, 8);
  const histOnly = WeeklyProj.buildBaseline('vet', season, PRIOR.vet, SCORING, 8);
  assert.ok(Math.abs(withProj.rec_yd - histOnly.rec_yd) < 0.001, 'gp≥6 → identical to history path');
});
test('buildSeasonBaseline: preW override is honored', () => {
  const line = WeeklyProj.buildSeasonBaseline('vet', null, PRIOR.vet, PROJ.vet, SCORING, 1, 1.0);
  assert.ok(Math.abs(line.rec_yd - 1250 / 18) < 0.01, 'preW=1 → pure projection');
});

// ── ensureRos v2 ────────────────────────────────────────────────────
test('universe union: a projected rookie the dynasty engine never scored gets a value', () => {
  const ros = build();
  assert.ok(ros, 'built');
  assert.ok(ros.values.rook > 0, 'rookie priced: ' + ros.values.rook);
  assert.ok(ros.points.rook > 0, 'rookie ROS points shown');
});
test('missing seasonal evidence is absent, never zero-pinned', () => {
  const ros = build();
  assert.strictEqual(ros.values.stash, undefined, 'stash value unavailable');
  assert.strictEqual(ros.points.stash, undefined, 'stash points unavailable');
});
test('empty projection shells stay out of the universe', () => {
  const ros = build();
  assert.ok(!(ros.values.ghost > 0), 'ghost has no value');
});
test('builds from projections alone — no dynasty engine loaded (other platforms)', () => {
  resetState(); lid++;
  window.App.LI = { starterCounts: { QB: 1, RB: 2, WR: 2, TE: 1 } }; // no playerScores at all
  const ros = PV.ensureRos(freshCtx({ leagueId: 'L' + lid, league: Object.assign({}, LEAGUE, { league_id: 'L' + lid }) }));
  assert.ok(ros, 'built without playerScores');
  assert.ok(ros.values.vet > 0 && ros.values.rook > 0);
  assert.strictEqual(ros.bestDHQ, 9500, 'constant ceiling anchors the scale');
});
test('horizon runs through the fantasy playoffs: week 15 still builds (old model went null)', () => {
  resetState(); lid++;
  window.S.currentWeek = 15;
  const ros = PV.ensureRos(freshCtx({ leagueId: 'L' + lid, league: Object.assign({}, LEAGUE, { league_id: 'L' + lid }) }));
  assert.ok(ros, 'built during fantasy playoffs');
  assert.strictEqual(ros.remainingWeeks, 3, 'upcoming current week 15 plus weeks 16-17 remain');
});
test('horizon: season truly over (week 18) → null, no fabricated values', () => {
  resetState(); lid++;
  window.S.currentWeek = 18;
  const ros = PV.ensureRos(freshCtx({ leagueId: 'L' + lid, league: Object.assign({}, LEAGUE, { league_id: 'L' + lid }) }));
  assert.strictEqual(ros, null);
});
test('window.S fallbacks: callers that cannot thread maps still build correctly', () => {
  resetState(); lid++;
  window.S.statsData = {}; window.S.priorData = PRIOR; window.S.projectionsData = PROJ; window.S.players = PLAYERS;
  const league = Object.assign({}, LEAGUE, { league_id: 'L' + lid });
  const ros = PV.ensureRos({ leagueId: 'L' + lid, league, skin: { type: 'redraft' }, noMarketFetch: true });
  assert.ok(ros && ros.values.rook > 0, 'built entirely from the hydrate bridge');
});
test('market calibration: capped 25% pull toward FantasyCalc redraft, unpriced players untouched', () => {
  const base = build();
  const vBase = { vet: base.values.vet, wr2: base.values.wr2, rook: base.values.rook };
  // Market: prices ONLY vet and rook — massively higher on rook, lower on vet.
  const market = { rook: 10000, vet: 1000 };
  const ros = build({ marketRedraft: market });
  assert.ok(ros.marketApplied, 'market flagged');
  assert.ok(ros.values.rook >= vBase.rook, 'rookie pulled up toward market');
  // wr2 unpriced: its VOR is unchanged, but the shared scale ceiling can move —
  // compare RATIOS to a fellow unpriced player-free anchor instead of absolutes.
  const shiftVet = Math.abs(ros.values.vet / ros.values.wr2 - vBase.vet / vBase.wr2) / (vBase.vet / vBase.wr2);
  assert.ok(shiftVet > 0.02 && shiftVet < 0.5, 'vet moved a capped amount relative to unpriced wr2: ' + shiftVet.toFixed(3));
});
test('keeper leagues keep the dynasty blend (getKeeperValue) untouched', () => {
  resetState(); lid++;
  window.S.currentLeagueId = 'L' + lid;
  const league = Object.assign({}, LEAGUE, { league_id: 'L' + lid });
  const ros = PV.ensureRos(freshCtx({ leagueId: 'L' + lid, league, skin: { type: 'keeper' } }));
  assert.ok(ros, 'keeper builds the map for the blend');
  const kv = PV.getKeeperValue('vet');
  const expect = Math.round(0.6 * 6000 + 0.4 * ros.values.vet);
  assert.strictEqual(kv, expect, 'keeper = 60% dynasty + 40% ROS');
});
test('seasonal skins use current ROS values, including projection-only players, without dynasty fallback', () => {
  for (const skin of [{ type: 'redraft' }, { type: 'chopped' }, { type: 'best_ball' }, { type: 'dfs' }, { type: 'custom', features: { showAgeCurve: false } }]) {
    const ros = build({ skin });
    const id = 'L' + lid;
    window.S.currentLeagueId = id;
    window.App.LeagueSkin = { getCurrent: () => skin };
    assert.ok(ros && ros.values.rook > 0, skin.type + ': projected rookie is priced');
    assert.strictEqual(PV.getValue('rook', { skin }), ros.values.rook, skin.type + ': explicit skin reads ROS');
    assert.strictEqual(PV.valueMap({ skin }).rook, ros.values.rook, skin.type + ': value map reads ROS');
    assert.ok(Object.keys(PV.valueMap({ skin })).includes('rook'), skin.type + ': projection-only ids enumerate');
    assert.strictEqual(PV.getValue('stash'), null, skin.type + ': missing seasonal production cannot expose 8000 dynasty value');
    assert.strictEqual(PV.getValue('missing'), null, skin.type + ': missing evidence is unavailable');
    assert.strictEqual(PV.isRedraftActive(), true, skin.type + ': current seasonal map is active');
    window.S.currentLeagueId = 'other';
    assert.strictEqual(PV.getValue('vet', { skin }), null, skin.type + ': another league cannot use the cached values');
    assert.strictEqual(PV.isRedraftActive(), true, 'seasonal format still forbids dynasty fallback');
    delete window.App.LeagueSkin;
  }
});
test('keeper stays on its explicit blend when age curves are hidden', () => {
  const skin = { type: 'keeper', features: { showAgeCurve: false } };
  const ros = build({ skin });
  window.S.currentLeagueId = 'L' + lid;
  window.App.LeagueSkin = { getCurrent: () => skin };
  assert.ok(ros, 'keeper still builds seasonal inputs for the blend');
  assert.strictEqual(PV.getValue('vet', { skin }), 6000, 'ordinary keeper value remains dynasty');
  assert.strictEqual(PV.getKeeperValue('vet', { skin }), Math.round(0.6 * 6000 + 0.4 * ros.values.vet));
  assert.strictEqual(PV.isRedraftActive(), false, 'keeper cannot activate pure seasonal pricing');
  assert.ok(!Object.keys(PV.valueMap({ skin })).includes('rook'), 'ordinary keeper map keeps its dynasty universe');
  delete window.App.LeagueSkin;
});
test('isRedraftActive gates the format even when the current league has no values', () => {
  resetState(); lid++;
  const id = 'L' + lid;
  window.S.currentLeagueId = id;
  window.App.LeagueSkin = { getCurrent: () => ({ type: 'redraft' }) };
  PV.ensureRos(freshCtx({ leagueId: id, league: Object.assign({}, LEAGUE, { league_id: id }) }));
  assert.strictEqual(PV.isRedraftActive(), true, 'active for current league');
  window.S.currentLeagueId = 'someOtherLeague';
  assert.strictEqual(PV.isRedraftActive(), true, 'missing current league prices must not activate dynasty callers');
  assert.equal(PV.getValue('vet'), null);
  delete window.App.LeagueSkin;
});
test('league scoring is the differentiator: doubling PPR moves the WR/RB ratio', () => {
  const half = build();
  const full = build({ league: { scoring_settings: Object.assign({}, SCORING, { rec: 1.5 }) } });
  const rHalf = half.values.vet / half.values.rook;
  const rFull = full.values.vet / full.values.rook;
  assert.ok(rFull > rHalf * 1.05, `receptions premium lifts the WR relative to the RB (${rHalf.toFixed(2)} → ${rFull.toFixed(2)})`);
});

test('missing, stale and zero seasonal values never become dynasty scores', () => {
  build();
  window.S.currentLeagueId = 'L' + lid;
  window.App.LeagueSkin = {getCurrent: () => ({type:'redraft'})};
  assert.strictEqual(PV.getValue('stash'), null);
  assert.strictEqual(PV.getValue('missing'), null);
  assert.ok(Object.keys(PV.valueMap()).includes('rook'), 'projection-only player remains enumerable');
  window.S.currentLeagueId = 'another';
  assert.strictEqual(PV.getValue('vet'), null);
  window.S.currentLeagueId = 'L' + lid;
  const currentWeek = window.App.WeeklyProj.currentWeek;
  window.App.WeeklyProj.currentWeek = () => 99;
  assert.strictEqual(PV.getValue('vet'), null);
  window.App.WeeklyProj.currentWeek = currentWeek;
  delete window.App.LeagueSkin;
});
test('same-league scoring edits refresh the seasonal map', () => {
  resetState(); lid++;
  const league = {...LEAGUE, league_id:'L'+lid, scoring_settings:{...SCORING}};
  const ctx=freshCtx({league,leagueId:league.league_id});
  const first=PV.ensureRos(ctx);
  league.scoring_settings.rec=2;
  const second=PV.ensureRos(ctx);
  assert.notStrictEqual(first,second);
  assert.notStrictEqual(first.points.vet,second.points.vet);
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
