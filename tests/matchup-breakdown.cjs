'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
let state = [], cursor = 0, dirty = false, latestProps, latestTree;
const pending = new Map();
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const ctx = { window: {}, React: {
    createElement: h, Fragment: 'fragment',
    useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [state[index].value, next => {
            const value = typeof next === 'function' ? next(state[index].value) : next;
            if (!Object.is(value, state[index].value)) { state[index].value = value; dirty = true; }
        }];
    },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect(fn, deps) {
        const index = cursor++, previous = state[index];
        if (!previous || !same(previous.deps, deps)) {
            state[index] = { deps, cleanup: previous?.cleanup }; pending.set(index, fn);
        }
    },
} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('js/shared/matchup-score-comparison.js', 'utf8'), ctx);
vm.runInContext(babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code, ctx);
const text = node => node == null ? '' : typeof node === 'object' ? node.children.map(text).join(' ').replace(/\s+/g, ' ') : String(node);
const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
const render = (props, reset = false, commit = true) => {
    if (reset) { state.forEach(slot => slot?.cleanup?.()); state = []; pending.clear(); }
    latestProps = props;
    let passes = 0;
    do {
        assert(++passes < 20, 'The hook render should settle');
        cursor = 0; dirty = false; latestTree = ctx.MatchupBreakdown(props);
        if (!commit) break;
        const effects = [...pending]; pending.clear();
        for (const [index, fn] of effects) { state[index].cleanup?.(); state[index].cleanup = fn(); }
    } while (dirty);
    return latestTree;
};
const flush = async () => { for (let pass = 0; pass < 12; pass++) { await Promise.resolve(); if (dirty) render(latestProps); } return latestTree; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const button = (tree, label) => all(tree).find(node => node.type === 'button' && text(node).trim() === label);
const slotRows = tree => all(tree).filter(node => node.props['data-slot-index'] != null);
const props = {
    week: 3, pro: true, pmeta: pid => ({ name: pid }),
    matchup: { fc: { projMe: 80, projOpp: 100, margin: -20, winPct: 25 }, oppName: 'Opponent', oppCurTotal: 90, oppIdealTotal: 100,
        posStrength: [{ pos: 'TE', mine: 20.4, theirs: 8.5 }, { pos: 'WR', mine: 26.3, theirs: 66.6 }, { pos: 'K', mine: 8.9, theirs: 8.4 }],
        h2h: [{ slot: 'TE', myPid: 'Mine', theirPid: 'Theirs', myMed: 12, theirMed: 8.5 }, { slot: 'K', myPid: 'Kicker', theirPid: 'Their kicker', myMed: 8.9, theirMed: 8.4 }, { slot: 'QB', myPid: 'Quarterback', theirPid: 'Their QB', myMed: 10, theirMed: 10 }, { slot: 'WR', myPid: 'Unknown', theirPid: 'Their receiver', myMed: null, theirMed: 20 }],
    },
};
let tree = render(props);
assert.match(text(tree), /TE \+3\.5/);
assert.match(text(tree), /Incomplete data/);
assert.match(text(tree), /2 slots/);
assert.match(text(tree), /You lead 2 of 4 slots/);
assert.match(text(tree), /Projected points · your lineup plan.*Their current lineup:.*Green: your edge/, 'desktop keeps its matchup guidance');
assert.doesNotMatch(text(tree), /Slot by slot/, 'The separate duplicate comparison list is removed');
assert.equal(slotRows(tree).length, 0, 'Position bars appear before opening their player detail');
const groupButton = all(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Show TE player comparisons'));
assert.equal(groupButton.props['aria-expanded'], false);
assert(all(tree).find(node => node.props.id === groupButton.props['aria-controls']).props.hidden, 'Disclosure target exists and is hidden while collapsed');
groupButton.props.onClick(); tree = render(props);
assert.equal(slotRows(tree).length, 1);
assert.match(text(slotRows(tree)[0]), /Mine.*Theirs/);
const expandedButton = all(tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Hide TE player comparisons'));
assert.equal(expandedButton.props['aria-expanded'], true);
assert.equal(all(tree).find(node => node.props.id === expandedButton.props['aria-controls']).props.hidden, false);
assert(!text(tree).includes('Their receiver'), 'Opening TE leaves other position players collapsed');
button(tree, 'Show all players').props.onClick(); tree = render(props);
const rows = slotRows(tree);
assert.deepEqual(rows.map(row => row.props['data-slot-index']).sort(), [0, 1, 2, 3], 'Every comparison is mounted exactly once across the position disclosures');
assert.match(text(rows[0]), /You \+3\.5/);
assert.match(text(rows[1]), /You \+0\.5/);
assert.match(text(rows[2]), /Even/);
assert.match(text(rows[3]), /Unavailable/);
assert.doesNotMatch(rows[3].props.className, /is-behind|is-close/);
assert(all(tree).filter(n => n.props.role === 'img').every(n => n.props['aria-label']), 'position bars have numeric text alternatives');
assert(!all(tree).some(n => ['details', 'dialog'].includes(n.type)));
assert.equal(button(tree, 'Hide all players').props['aria-pressed'], true);
button(tree, 'Hide all players').props.onClick(); tree = render(props);
assert.equal(slotRows(tree).length, 0);
const compact = render({ ...props, compact: true }, true);
assert.match(compact.props.className, /gd-matchup-compact/, 'phone matchup uses the compact layout hook');
assert.match(text(compact), /80\.0.*You.*100\.0.*Them/, 'phone matchup keeps both projected scores');
assert.doesNotMatch(text(compact), /Projected points · your lineup plan|Their current lineup:|Green: your edge/, 'phone matchup omits desktop-only explanatory copy');
assert.equal(slotRows(compact).length, 0, 'phone matchup opens with position bars and no persistent duplicate list');
assert.doesNotMatch(text(render({ ...props, pro: false }, true)), /11\.9|40\.3|Win probability|Your biggest edge|Show all players/);
const zeroOpponent = render({ ...props, pro: false, matchup: { ...props.matchup, oppCurTotal: 0 } }, true);
assert.match(text(zeroOpponent), /0\.0 Them/, 'A valid zero opponent forecast stays visible on the free view');
const negativeOpponent = render({ ...props, pro: false, matchup: { ...props.matchup, oppCurTotal: -2.5 } }, true);
assert.match(text(negativeOpponent), /-2\.5 Them/);

// FLEX matchups can use different player positions on the two sides. Group
// by actual lineup slot so neither pair nor its points is counted twice.
const flexProps = { ...props, compact: true, matchup: { ...props.matchup, h2h: [
    { slot: 'QB', myPid: 'Starting QB', theirPid: 'Their QB', myMed: 10, theirMed: 10 },
    { slot: 'FLEX', myPid: 'Flex RB', theirPid: 'Flex WR', myMed: 0, theirMed: -2 },
    { slot: 'FLEX', myPid: 'Second flex WR', theirPid: 'Second flex TE', myMed: 5, theirMed: null },
    { slot: 'SUPER_FLEX', myPid: 'Second QB', theirPid: 'Superflex TE', myMed: 20, theirMed: 8 },
    { slot: 'REC_FLEX', myPid: null, theirPid: 'Reception flex TE', myMed: 0, theirMed: 4 },
    { slot: 'RB', myPid: 'Fixed RB', theirPid: 'Their RB', myMed: 7, theirMed: 5 },
] } };
tree = render(flexProps, true);
const flexGroup = all(tree).find(node => node.props['data-position'] === 'FLEX');
assert.match(text(flexGroup), /5\.0.*—.*Unavailable/, 'A missing flex projection makes the group incomplete instead of a fabricated partial total');
button(tree, 'Show all players').props.onClick(); tree = render(flexProps);
assert.deepEqual(slotRows(tree).map(row => row.props['data-slot-index']).sort(), [0, 1, 2, 3, 4, 5]);
assert.equal(slotRows(tree).filter(row => row.props['data-slot'] === 'FLEX').length, 2);
assert.match(text(slotRows(tree).find(row => row.props['data-slot-index'] === 1)), /0\.0.*-2\.0/, 'Inline flex detail preserves genuine zero and negative projections');
assert.match(text(all(tree).find(node => node.props['data-position'] === 'SUPER_FLEX')), /SUPER FLEX.*Second QB.*Superflex TE/);
assert.match(text(all(tree).find(node => node.props['data-position'] === 'REC_FLEX')), /REC FLEX.*Empty slot.*0\.0/);
assert.equal(all(tree).filter(node => node.props.className === 'gd-matchup-you' || node.props.className === 'gd-matchup-player gd-matchup-you').length, 6);
const negativeBar = all(tree).find(node => node.props.role === 'img' && node.props['aria-label']?.includes('FLEX: you'));
assert(negativeBar, 'Accessible labels preserve signed group values');
tree = render({ ...flexProps, week: 4 });
assert.equal(slotRows(tree).length, 0, 'Expansions reset when the matchup week changes');
const unavailable = { ...props.matchup, fc: { winPct: null, projMe: null, projOpp: null, margin: null }, posStrength: [{ pos: 'WR', mine: null, theirs: 20 }], h2h: [props.matchup.h2h[3]] };
assert.match(text(render({ ...props, matchup: unavailable }, true)), /Forecast unavailable.*Incomplete data/);
assert.equal(render({ ...props, matchup: null }), null);

// Exercise the rendered view with the real submitted-lineup comparison model.
// The separate planner's names and values deliberately disagree with this feed.
const comparisonOptions = {
    league: { league_id: 'review-league', season: 2026, roster_positions: ['QB', 'FLEX', 'FLEX', 'TE'] }, week: 3, myRosterId: 1,
    currentSeason: 2026, currentWeek: 3, scoresSupported: true, scoreStatus: 'ready', gamesFresh: true,
    rows: [
        { roster_id: 1, matchup_id: 9, starters: ['Actual QB', 'Actual Flex', 'Missing Flex', 'First View TE'], players_points: { 'Actual QB': 0, 'Actual Flex': -2.5, 'First View TE': 5 }, points: 2.5 },
        { roster_id: 2, matchup_id: 9, starters: ['Their actual QB', 'Their flex one', 'Their flex two', 'Their actual TE'], players_points: { 'Their actual QB': 2, 'Their flex one': 5, 'Their flex two': 3, 'Their actual TE': 4 }, points: 14 },
    ],
    forecasts: { players: { 'Actual QB': { kind: 'pregame', points: 0 }, 'Actual Flex': { kind: 'pregame', points: -5 }, 'Missing Flex': { kind: 'pregame', points: 10 }, 'First View TE': { kind: 'first-view', points: 8 } } },
    projections: { 'Their actual QB': 2, 'Their flex one': 5, 'Their flex two': 3, 'Their actual TE': 1 },
    gameState: () => 'final',
};
const buildComparison = extra => ({ ...ctx.window.App.MatchupScoreComparison.build({ ...comparisonOptions, ...extra }), oppName: 'Submitted opponent' });
const completedComparison = buildComparison();
const reviewProps = { ...props, compact: true, comparison: completedComparison };
tree = render(reviewProps, true);
assert.match(tree.props.className, /gd-matchup-review/, 'a started matchup automatically opens actual points');
assert.equal(tree.props['data-score-view'], 'actual');
assert(!button(tree, 'Actual vs proj') && !button(tree, 'Projection'), 'One matchup surface replaces score-mode tabs');
assert.match(text(tree), /Final points.*2\.50 You Proj 13\.0.*14\.00 Them Proj 11\.0/);
assert.doesNotMatch(text(tree), /Win probability|Matchup outlook/, 'actual scores are not presented as a new forecast');
assert.match(text(tree), /Submitted starters.*saved pregame/, 'the rendered comparison retains its baseline source explanation');
button(tree, 'Show all players').props.onClick(); tree = render(reviewProps);
const reviewRows = slotRows(tree);
assert.equal(reviewRows.length, 4);
assert.equal(reviewRows.filter(row => row.props['data-slot'] === 'FLEX').length, 2, 'actual mode retains both FLEX pairs without duplication');
assert.match(text(reviewRows[0]), /Actual QB.*0\.00 Pregame 0\.0.*0\.0 vs pregame/);
assert.match(text(reviewRows[1]), /Actual Flex.*-2\.50 Pregame -5\.0.*\+\s*2\.5 vs pregame/, 'a negative actual is compared against its signed saved baseline');
assert.match(text(reviewRows[2]), /Missing Flex.*— Pregame 10\.0/, 'a missing final stays unavailable instead of a scored zero');
assert.match(text(reviewRows[2]), /You Awaiting score Missing Flex/, 'a missing provider total is not labeled a final player score');
assert.match(text(reviewRows[3]), /First View TE.*5\.00 First view 8\.0/, 'first-view projections stay visibly distinguished from pregame forecasts');
assert.doesNotMatch(text(reviewRows[3]), /vs pregame/, 'a first-view estimate cannot receive a final performance grade');
assert(all(reviewRows[0]).some(node => node.props.className === 'gd-review-player-points is-typical'));
assert(all(reviewRows[1]).some(node => node.props.className === 'gd-review-player-points is-strong'));
assert(all(reviewRows[2]).filter(node => String(node.props.className).startsWith('gd-review-player-points')).every(node => !/is-strong|is-quiet|is-typical/.test(node.props.className)), 'unavailable final values never inherit a grade');
assert.doesNotMatch(text(tree), /Quarterback|Their receiver|Kicker/, 'actual view uses submitted players rather than the optimizer pairs');
tree = render({ ...reviewProps, comparison: { ...completedComparison, totalMine: 3 } });
assert.equal(tree.props['data-score-view'], 'actual');
assert.match(text(tree), /3\.00 You Proj 13\.0/, 'live refresh updates actual alongside the saved projection');

const beforeGame = buildComparison({ rows: comparisonOptions.rows.map(row => ({ ...row, points: 0 })), gameState: () => 'upcoming' });
tree = render({ ...reviewProps, comparison: beforeGame }, true);
assert.doesNotMatch(tree.props.className, /gd-matchup-review/);
assert.equal(tree.props['data-score-view'], 'outlook');
assert(!button(tree, 'Actual vs proj'), 'pregame does not invite comparison against invented zero actuals');
tree = render(reviewProps);
assert.match(tree.props.className, /gd-matchup-review/, 'the untouched pregame view switches to actuals at kickoff');
for (const extra of [{ scoreStatus: 'stale', scoreError: 'Scores could not refresh' }, { scoreStatus: 'refreshing' }, { gamesFresh: false }]) {
    tree = render({ ...reviewProps, comparison: buildComparison(extra) }, true);
    button(tree, 'Show all players').props.onClick(); tree = render({ ...reviewProps, comparison: buildComparison(extra) });
    assert(all(tree).filter(node => String(node.props.className).startsWith('gd-review-player-points')).every(node => !/is-strong|is-quiet|is-typical/.test(node.props.className)), 'stale or unverified data cannot retain a final performance grade');
    assert(!all(tree).some(node => node.type === 'em' && /vs pregame/.test(text(node))), 'stale or unverified values lose final variance claims');
    assert(all(tree).some(node => node.type === 'em' && text(node) === 'Last seen'), 'stale or unverified player values are labeled last seen');
    assert(!all(tree).some(node => node.type === 'em' && text(node) === 'Final'), 'stale or unverified evidence never labels a player final');
    assert(all(tree).some(node => node.props.role === 'status' && node.props.className.includes('is-stale')), 'unverified data keeps visible freshness feedback');
}
tree = render({ ...reviewProps, comparison: buildComparison({ scoreStatus: 'stale', scoreError: 'Offline' }) }, true);
assert.match(text(tree), /Last available points/);
const partialLive = buildComparison({ gameState: pid => pid === 'Actual QB' ? 'live' : 'final' });
tree = render({ ...reviewProps, comparison: partialLive }, true);
button(tree, 'Show all players').props.onClick(); tree = render({ ...reviewProps, comparison: partialLive });
assert.match(text(slotRows(tree)[0]), /You Live Actual QB 0\.00/, 'an in-progress zero is visibly live');
assert(!all(slotRows(tree)[0]).some(node => String(node.props.className).startsWith('gd-review-player-points') && /is-strong|is-quiet|is-typical/.test(node.props.className)), 'a live score is never graded against a full-game estimate');
const changedWeek = render({ ...reviewProps, week: 2 });
assert.equal(slotRows(changedWeek).length, 0, 'reviewing another week resets expanded player detail');
assert.equal(changedWeek.props['data-score-view'], 'actual', 'a different week shows actual alongside projections');
tree = render({ ...reviewProps, matchup: null }, true);
assert.match(text(tree), /Final points/, 'submitted actual review is available even without an optimizer forecast');
const unverifiedPast = buildComparison({ currentWeek: 4, gamesFresh: false, gameState: () => 'unknown',
    rows: comparisonOptions.rows.map(row => ({ ...row, points: 0, players_points: Object.fromEntries(row.starters.map(pid => [pid, 0])) })),
    forecasts: { players: {} }, projections: {} });
assert.equal(unverifiedPast.phase, 'past');
assert.equal(unverifiedPast.headerLabel, 'Actual points · status unverified');
assert.equal(unverifiedPast.totalMine, 0, 'reported historical team zero stays visible with unverified status');
assert.equal(unverifiedPast.hasStarted, false, 'unverified provider zeroes cannot imply kickoff or earned player points');
const unverifiedPastProps = { ...reviewProps, matchup: null, comparison: unverifiedPast };
tree = render(unverifiedPastProps, true);
assert.equal(tree.props['data-score-view'], 'actual', 'an earlier submitted matchup remains in read-only review even if NFL evidence is unavailable');
assert.doesNotMatch(text(tree), /Matchup outlook|Win probability/, 'historical uncertainty never falls back to an empty pregame forecast');
assert(button(tree, 'Show all players'), 'historical submitted slots remain available for inspection');
button(tree, 'Show all players').props.onClick(); tree = render(unverifiedPastProps);
assert.equal(slotRows(tree).length, 4, 'all earlier submitted slots are retained without an optimizer forecast');
assert.match(text(slotRows(tree)[0]), /You Last seen Actual QB 0\.00/, 'an unverified historical provider zero is shown as last seen, never final');
assert(all(tree).filter(node => String(node.props.className).startsWith('gd-review-player-points')).every(node => !/is-strong|is-quiet|is-typical/.test(node.props.className)), 'unverified earlier results never receive a performance grade');
assert(!all(tree).some(node => node.type === 'em' && /vs pregame/.test(text(node))), 'missing historical baselines never produce final variance');
tree = render({ ...reviewProps, pro: false }, true);
assert.match(text(tree), /2\.50.*14\.00/);
assert(!button(tree, 'Show all players'), 'the actual score header preserves the existing free/Pro breakdown boundary');

// Use the real comparison adapter: selection changes only this display, with
// current-season league scoring and defensive position aliases kept intact.
vm.runInContext(fs.readFileSync('js/shared/roster-lens-basis.js', 'utf8'), ctx);
let viewer = 'viewer-a';
ctx.window.WR = { WaiverPlans: { account: () => viewer } };
ctx.window.S = { currentLeagueId: 'basis-one', platform: 'sleeper' };
ctx.window.App.LeagueStats = { score: (raw, scoring, pos) => raw.pts + (pos === 'LB' ? scoring.lb_bonus : 0) };
const basisPlayers = {
    mineLB: { position: 'OLB', team: 'BUF' }, theirLB: { position: 'ILB', team: 'KC' },
    mineDB: { position: 'CB', team: 'BUF' }, theirDL: { position: 'EDGE', team: 'KC' },
    mineQB: { position: 'QB', team: 'BUF' }, theirQB: { position: 'QB', team: 'KC' },
    mineDEF: { position: 'DEF', team: 'BUF' }, theirDEF: { position: 'D/ST', team: 'KC' },
};
const basisLeague = { league_id: 'basis-one', season: '2026', scoring_settings: { pts: 1, lb_bonus: 2 } };
const basisStats = {
    mineLB: { pts: -2, gp: 2, season: 2026 }, theirLB: { pts: 8, gp: 2, season: 2026 },
    mineDB: { pts: -6, gp: 2, season: 2026 }, theirDL: { pts: 12, gp: 3, season: 2026 },
    mineQB: { pts: 100, gp: 4, season: 2026 }, theirQB: { pts: 80, gp: 4, season: 2026 },
    mineDEF: { pts: 8, gp: 4, season: 2026 }, theirDEF: { pts: 4, gp: 4, season: 2026 },
};
const basisProps = { ...props, compact: true, week: 6,
    benchmarkContext: { league: basisLeague, players: basisPlayers, statsData: basisStats, statsSeason: '2026', revision: 1, userId: 'owner' },
    matchup: { ...props.matchup, fc: { projMe: 60, projOpp: 43, margin: 17, winPct: 70 }, h2h: [
        { slot: 'LB', myPid: 'mineLB', theirPid: 'theirLB', myMed: 15, theirMed: 8 },
        { slot: 'IDP_FLEX', myPid: 'mineDB', theirPid: 'theirDL', myMed: 9, theirMed: 10 },
        { slot: 'QB', myPid: 'mineQB', theirPid: 'theirQB', myMed: 30, theirMed: 20 },
        { slot: 'DEF', myPid: 'mineDEF', theirPid: 'theirDEF', myMed: 6, theirMed: 5 },
    ] },
};
const control = value => all(value).find(node => node.type === 'select' && node.props['aria-label'] === 'Matchup point comparison basis');
const totals = value => all(value).find(node => node.props.className === 'gd-matchup-totals');
const changeBasis = (value, input = basisProps) => { assert(control(latestTree), 'Point basis selector is available'); control(latestTree).props.onChange({ target: { value } }); return render(input); };
const sourceBefore = JSON.stringify(basisProps);
tree = render(basisProps, true);
assert.equal(control(tree).props.value, 'projected');
assert.match(text(totals(tree)), /60\.0 You vs 43\.0 Them/);
assert.match(text(tree), /Win probability/);
tree = changeBasis('average');
assert.equal(tree.props['data-score-view'], 'average');
assert.match(text(tree), /2026 average points/);
assert.match(text(totals(tree)), /24\.0 You vs 30\.0 Them/, 'Average totals use signed current-season league points, including LB bonuses');
assert.doesNotMatch(text(tree), /Win probability|Matchup outlook|saved pregame/, 'Historical averages never masquerade as a forecast or saved baseline');
button(tree, 'Show all players').props.onClick(); tree = render(basisProps);
assert.match(text(slotRows(tree)[0]), /mineLB 0\.0 Avg · 2 games.*theirLB 5\.0 Avg · 2 games/);
assert.match(text(slotRows(tree)[1]), /mineDB -3\.0 Avg.*theirDL 4\.0 Avg/, 'A negative empirical average stays signed');
assert(!all(tree).some(node => /is-strong|is-quiet|is-typical/.test(node.props.className || '')), 'Empirical comparisons do not receive saved-pregame performance colors');
tree = changeBasis('idp-average');
assert.match(text(totals(tree)), /33\.0 You vs 34\.0 Them/, 'Hybrid uses averages for OLB/ILB/CB/EDGE and retains QB/DST projections');
assert.match(text(slotRows(tree)[2]), /mineQB 30\.0 Proj.*theirQB 20\.0 Proj/);
assert.match(text(slotRows(tree)[3]), /mineDEF 6\.0 Proj.*theirDEF 5\.0 Proj/, 'D/ST is not an individual defensive player');
tree = changeBasis('projected');
assert.match(text(totals(tree)), /60\.0 You vs 43\.0 Them/);
assert.match(text(tree), /Win probability/);
assert.equal(JSON.stringify(basisProps), sourceBefore, 'Choosing a display basis never changes assigned players, planner projections or source stats');

tree = changeBasis('average');
const missingBasis = { ...basisProps, benchmarkContext: { ...basisProps.benchmarkContext, statsData: { ...basisStats, mineDB: { pts: 99, gp: 0, season: 2026 } } } };
tree = render(missingBasis);
assert.match(text(totals(tree)), /— You vs 30\.0 Them/, 'Missing GP makes the whole side unavailable, not a partial team total');
assert.match(text(slotRows(tree)[1]), /mineDB — Avg/, 'Missing averages remain distinguishable from verified zero');
const previousSeason = { ...basisProps, benchmarkContext: { ...basisProps.benchmarkContext, statsSeason: 2025 } };
tree = render(previousSeason);
assert.match(text(totals(tree)), /— You vs — Them/, 'Prior-season stats cannot be presented as the selected current-season average');

tree = render({ ...basisProps, pro: false }, true);
assert.equal(control(tree), undefined, 'A display basis cannot expose the existing Pro opponent-lineup breakdown through the free header');
viewer = 'viewer-b'; tree = render(basisProps, true); tree = changeBasis('average');
viewer = 'viewer-c'; tree = render(basisProps, false, false);
assert.equal(control(tree).props.value, 'projected', 'A different account never inherits the prior empirical selection before effects');
assert.match(text(totals(tree)), /60\.0 You vs 43\.0 Them/);
viewer = 'viewer-a';

// A started matchup still opens saved actual/projection review. Average mode
// is an alternate display on those exact submitted players, never a snapshot.
const reviewWithBasis = { ...reviewProps, benchmarkContext: basisProps.benchmarkContext };
const savedBefore = JSON.stringify(completedComparison);
tree = render(reviewWithBasis, true);
assert.equal(control(tree), undefined, 'Actual review keeps its existing actual/saved-projection numbers');
assert.equal(tree.props['data-score-view'], 'actual');
assert(!button(tree, 'Projection'), 'Started matchups retain both scores without a second display mode');
assert.equal(JSON.stringify(completedComparison), savedBefore, 'Average display cannot overwrite submitted scores or captured forecasts');

(async () => {
    const requests = [];
    ctx.window.MFL = { loadPlayerStats: (league, options) => { const task = deferred(); requests.push({ league, options, ...task }); return task.promise; } };
    const mflLeague = { ...basisLeague, league_id: 'mfl_a', _platform: 'mfl' };
    const mflProps = { ...basisProps, benchmarkContext: { ...basisProps.benchmarkContext, league: mflLeague, statsData: {} } };
    const nativeStats = value => Object.fromEntries(Object.keys(basisPlayers).map(pid => [pid, { _mflScoring: { average: value, games: 4, season: 2026, week: null, scoringKey: JSON.stringify(Object.entries(mflLeague.scoring_settings).sort(([a], [b]) => a.localeCompare(b))) } }]));
    ctx.window.S.currentLeagueId = 'mfl_a';
    tree = render(mflProps, true); await flush();
    assert.equal(requests.length, 0, 'Projected display makes no native average request');
    tree = changeBasis('average', mflProps); await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].league, mflLeague);
    assert.equal(requests[0].options.players, basisPlayers);
    assert.equal(requests[0].options.week, null, 'Native averages use an explicit season aggregate, never this week as a proxy');
    assert.match(text(latestTree), /Loading averages/);
    assert.match(text(totals(latestTree)), /— You vs — Them/);
    tree = changeBasis('idp-average', mflProps); await flush();
    assert.equal(requests.length, 2);
    requests[0].resolve({ statsByPid: nativeStats(999) }); await flush();
    assert.doesNotMatch(text(latestTree), /999\.0|3996\.0/, 'A late full-average response cannot become a hybrid result');
    requests[1].resolve({ statsByPid: nativeStats(4) }); await flush();
    assert.match(text(totals(latestTree)), /44\.0 You vs 33\.0 Them/, 'Only the currently selected native request populates the IDP display');
    assert.doesNotMatch(text(latestTree), /Loading averages/);

    // Switch league/account while a request is in flight. The previous values
    // disappear during render, before the effect cleanup has committed.
    tree = changeBasis('average', mflProps); await flush();
    const staleAccount = requests.at(-1);
    viewer = 'new-account';
    tree = render(mflProps, false, false);
    assert.equal(control(tree).props.value, 'projected');
    staleAccount.resolve({ statsByPid: nativeStats(888) }); await flush();
    assert.doesNotMatch(text(latestTree), /888\.0|3552\.0/);
    tree = changeBasis('average', mflProps); await flush();
    const staleLeague = requests.at(-1);
    ctx.window.S.currentLeagueId = 'mfl_b';
    const otherLeague = { ...mflProps, benchmarkContext: { ...mflProps.benchmarkContext, league: { ...mflLeague, league_id: 'mfl_b' } } };
    tree = render(otherLeague, false, false);
    assert.equal(control(tree).props.value, 'projected');
    staleLeague.resolve({ statsByPid: nativeStats(777) }); await flush();
    assert.doesNotMatch(text(latestTree), /777\.0|3108\.0/);
    tree = changeBasis('average', otherLeague); await flush();
    requests.at(-1).resolve({ statsByPid: nativeStats(2), error: 'Unrelated raw stats unavailable' }); await flush();
    assert.match(text(totals(latestTree)), /8\.0 You vs 8\.0 Them/, 'Verified current-league official averages remain usable despite unrelated raw-stat errors');
    console.log('PASS matchup breakdown: signed/missing slot disclosures; actual/saved projections; scoped empirical bases; native async races; no forecast grades or source mutation');
})().catch(error => { console.error(error); process.exitCode = 1; });
