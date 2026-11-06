'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const source = babel.transform(fs.readFileSync('js/tabs/lineup.js', 'utf8'), { presets: ['react'] }).code;

// Render the real mobile branch with state/effects, so navigation and lock
// behavior are checked alongside score provenance and absent projections.
async function fixture({ upcoming = false, matchupId = 7, width = 390, rosterView = false, noProjection = false, supported = true, stale = false, withMatchup = false, withBasis = false, withMetrics = false, pro = true, storage = new Map(), seasonData = null, seasonView = null, initialView = 'week', forecasts = {}, forecastsByWeek = {}, scoreRowsByWeek = {}, scoreStatus = 'ready', scoreError = null, lensContext = null } = {}) {
    const state = [], deps = [], pending = [];
    const events = {};
    const loadedForm = {};
    const projectionWeeks = [], scoreWeeks = [], contextWeeks = [], opponentWeeks = [], scoreFeedCalls = [], forecastCaptures = [], planWrites = [];
    let cursor = 0, effectCursor = 0, changed = true, out, refresh;
    const h = (type, props, ...children) => typeof type === 'function'
        ? type({ ...(props || {}), children }) : { type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) };
    const React = {
        createElement: h, Fragment: 'fragment',
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
            return [state[index], update => { const next = typeof update === 'function' ? update(state[index]) : update; if (next !== state[index]) { state[index] = next; changed = true; } }];
        },
        useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect(fn, next = []) {
            const index = effectCursor++;
            if (!deps[index] || next.some((x, i) => x !== deps[index][i])) { deps[index] = next; pending.push(fn); }
        },
    };
    const projection = points => ({ available: true, points: { median: points, floor: points, ceiling: points }, matchupGrade: 'B' });
    const result = { week: 2, objective: 'median', mode: 'balanced', projections: { a: projection(0), b: projection(-2.5), c: { available: false, points: { median: 100, floor: 100, ceiling: 100 } }, d: projection(12) }, optimal: { total: 20, starters: [{ slot: 'QB', pid: 'a' }, { slot: 'RB', pid: 'b' }, { slot: 'WR', pid: 'c' }] } };
    const games = ['KC', 'BUF', 'ATL', 'NYJ'].map(team => ({ home: team, away: 'MIA', state: upcoming ? 'upcoming' : 'final', kickoff: new Date(Date.now() + 86400000).toISOString() }));
    const ctx = {
        React, console, setInterval: fn => { refresh = fn; return 1; }, clearInterval() {},
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        window: {
            addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {},
            wrIsPro: () => pro,
            S: { nflState: { season: 2026 } },
            localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => { planWrites.push({ key, value }); storage.set(key, value); } },
            WR: {
                lineupLensContext: lensContext,
                WaiverPlans: { account: () => 'account:viewer' },
                useViewport: () => ({ width, isPhone: width < 768 }), HeroCard: true, AssetRow: true, CardList: true,
                Sheet: ({ open, children }) => open ? h('dialog', {}, children) : null,
                ActionBar: ({ visible, ...props }) => visible ? h('actionbar', props) : null,
            },
            App: {
                WeeklyProj: { optimalForRoster: (roster, league, options) => { projectionWeeks.push(options.week); return noProjection ? null : { ...result, week: options.week, projections: options.week > 2 ? { ...result.projections, d: projection(30) } : result.projections }; }, formStats: (pid, win) => typeof loadedForm[pid] === 'function' ? loadedForm[pid](win) : loadedForm[pid] || (pid === 'c' ? null : { rollingPPG: pid === 'a' ? 0 : -2.5, high: 0, low: -2.5, games: 2, recentCount: 2 }) },
                StartSit: { normSlot: s => s, FLEX_ALLOWED: {}, BASE_POSITIONS: new Set(['QB', 'RB', 'WR']) },
                NflContext: { loadScores: async week => { scoreWeeks.push(week); return stale ? [] : week > 2 ? games.map(game => ({ ...game, state: 'upcoming', away: 'SEA' })) : games; }, load: async weeks => { contextWeeks.push(...weeks); return {}; }, gameStatus: game => game?.state || 'unknown' },
                Schedule: seasonData ? { buildSeason: async () => seasonData } : undefined,
                LeagueLiveScores: {
                    currentWeek: () => 2,
                    useScores: ({ week, enabled = true }) => { scoreFeedCalls.push({ week, enabled }); return { supported, week, status: scoreStatus, error: scoreError, updatedAt: 1789484400000, rows: scoreRowsByWeek[week] || [
                        { roster_id: 1, matchup_id: matchupId, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -2.5 }, points: upcoming ? 0 : -2.5 },
                        { roster_id: 2, matchup_id: matchupId, starters: ['d'], players_points: { d: 0 }, points: 0 },
                    ] }; },
                    rosterPoints: row => row.points,
                    playerPoints: (row, pid) => typeof row?.players_points?.[pid] === 'number' ? row.players_points[pid] : null,
                },
            },
        },
    };
    vm.createContext(ctx);
    const corePositions=fs.readFileSync('js/core.js','utf8');
    vm.runInContext(corePositions.slice(corePositions.indexOf('    // Position colors —'),corePositions.indexOf('    // Age curves default')),ctx);
    vm.runInContext(corePositions.slice(corePositions.indexOf('    window.App.normPos ='),corePositions.indexOf('    // posLabel —')),ctx);
    vm.runInContext(fs.readFileSync('js/shared/scoring-visuals.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('js/shared/matchup-score-comparison.js', 'utf8'), ctx);
    if (withBasis) {
        ctx.window.App.LeagueStats = { score: raw => raw.pts };
        vm.runInContext(fs.readFileSync('js/shared/roster-lens-basis.js', 'utf8'), ctx);
    }
    const savedForecasts = { players: forecasts, persistent: true };
    const forecastsForWeek = week => forecastsByWeek[week] ? { players: forecastsByWeek[week], persistent: true } : savedForecasts;
    ctx.window.App.LineupForecastSnapshots = { read: (league, week) => forecastsForWeek(week), capture: options => { forecastCaptures.push(options.week); return forecastsForWeek(options.week); } };
    delete ctx.window.App.StartSit;
    vm.runInContext(fs.readFileSync('js/shared/startsit-engine.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('js/shared/roster-lineup-lens.js', 'utf8'), ctx);
    if (withMetrics) {
        ctx.window.React = React;
        vm.runInContext(fs.readFileSync('js/shared/player-metrics.js', 'utf8'), ctx);
    }
    if (withMatchup) {
        vm.runInContext(fs.readFileSync('js/shared/matchup.js', 'utf8'), ctx);
        ctx.window.App.Matchup.resolveOpponentRosterId = async ({ week }) => { opponentWeeks.push(week); return 2; };
    }
    vm.runInContext(source, ctx);
    const props = {
        initialView,
        seasonView,
        rosterView,
        myRoster: { roster_id: 1, starters: ['a', 'b', 'c'], players: ['a', 'b', 'c', 'd'] },
        currentLeague: { league_id: '123', season: 2026, scoring_settings: { pts: 1 }, roster_positions: ['QB', 'RB', 'WR'], rosters: [{ roster_id: 2, owner_id: 'owner2' }], users: [{ user_id: 'owner2', display_name: 'Opponent Name' }] },
        playersData: { a: { full_name: 'Zero Starter', team: 'KC', position: 'QB' }, b: { full_name: 'Negative Starter', team: 'BUF', position: 'RB' }, c: { full_name: 'Missing Starter', team: 'ATL', position: 'WR' }, d: { full_name: 'Bench Option', team: 'NYJ', position: 'QB' } },
        statsData: { a: { pts: 40, gp: 4, season: 2026 }, b: { pts: -8, gp: 4, season: 2026 }, c: { pts: 0, gp: 4, season: 2026 }, d: { pts: 20, gp: 4, season: 2026 } },
        statsSeason: 2026,
    };
    async function render() {
        for (let cycle = 0; cycle < 12; cycle++) {
            changed = false; cursor = 0; effectCursor = 0;
            out = ctx.LineupTab(props);
            pending.splice(0).forEach(fn => fn());
            await Promise.resolve(); await Promise.resolve();
            await new Promise(setImmediate);
            if (!changed) return out;
        }
        throw Error('Render did not settle');
    }
    await render();
    return { get out() { return out; }, render, games, props, result, storage, projectionWeeks, scoreWeeks, contextWeeks, opponentWeeks, scoreFeedCalls, forecastCaptures, planWrites, async openLens(context) { events['wr:open-lineup-lens']({ detail: context }); await render(); }, scorePresentation: values => ctx.lineupScorePresentation(values), async loadForm(pid, value) { loadedForm[pid] = value; events['wr:weekly-points-loaded']({ detail: { leagueId: '123' } }); await render(); }, async kickoff(team) { games.find(g => g.home === team).state = 'live'; await refresh(); await render(); } };
}
const all = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(all)] : [];
const textOf = node => node == null ? '' : typeof node === 'object' ? (node.children || []).map(textOf).join('') : String(node);
const select = (out, predicate) => all(out).find(predicate);
const button = (out, label) => select(out, n => n.type === 'button' && textOf(n) === label);
const matchupPanel = node => String(node?.props?.className || '').split(/\s+/).includes('gd-matchup');

(async () => {
    {
    const handoff = { source: 'roster-lineup-lens', accountKey: 'account:viewer', leagueId: '123', season: '2026', rosterId: '1',
        week: 2, slotIndex: 0, incomingPid: 'd', outgoingPid: 'a', ts: Date.now() };
    const review = await fixture({ upcoming: true, lensContext: handoff, initialView: 'matchup' });
    assert.match(textOf(review.out), /From Lineup lens: start Bench Option over Zero Starter/);
    assert.match(textOf(review.out), /LINEUP LENS/);
    assert.equal(review.planWrites.length, 0, 'Reviewing the lens never changes a saved lineup');
    await review.kickoff('NYJ');
    assert.match(textOf(review.out), /suggested swap changed or is locked/);
    assert.doesNotMatch(textOf(review.out), /From Lineup lens: start/);
    const futureReview = await fixture({ upcoming: true, lensContext: { ...handoff, week: 3 } });
    assert.equal(select(futureReview.out, node => node.props['aria-label'] === 'Lineup week').props.value, 3);
    assert.match(textOf(futureReview.out), /From Lineup lens: start Bench Option/);
    assert.equal(futureReview.planWrites.length, 0, 'Future-week handoff is also read-only');
    for (const [basis, averageWindow, label, buttonLabel] of [
        ['average', '3', 'last 3 games average', 'L3'],
        ['average', 'season', 'season average', 'SZN'],
        ['idp-average', '5', 'IDP last 5 games average + projections', 'L5'],
        ['average', 'invalid', 'season average', 'SZN'],
    ]) {
        const averageReview = await fixture({ upcoming: true, lensContext: { ...handoff, basis, averageWindow, comparison: { before: 6, after: 16, delta: 10 } } });
        assert(textOf(averageReview.out).includes('From Lineup lens (' + label + '): start Bench Option'), 'Review names the exact average window');
        assert.match(textOf(averageReview.out), /6\.0 → 16\.0\(\+10\.0\)|6\.0 → 16\.0 \(\+10\.0\)/, 'The original average comparison remains visible beside independent projection metrics');
        const formControls = all(averageReview.out).filter(node => ['Player form window', 'Optimizer form window'].includes(node.props['aria-label']));
        assert(formControls.length > 0);
        for (const controls of formControls) assert.equal(button(controls, buttonLabel)?.props['aria-pressed'], true, 'The Game Day picker uses the same average window');
        assert.equal(averageReview.planWrites.length, 0, 'Choosing an average window for review does not write a lineup');
    }
    const projectedReview = await fixture({ upcoming: true, lensContext: { ...handoff, basis: 'projected', averageWindow: '3' } });
    const projectedForm = select(projectedReview.out, node => node.props['aria-label'] === 'Optimizer form window');
    assert.equal(button(projectedForm, 'L5')?.props['aria-pressed'], true, 'Projected review does not change the independent form window');
    for (const invalid of [{ accountKey: 'account:other' }, { leagueId: 'elsewhere' }, { season: '2025' }, { rosterId: '99' }, { week: 1 }, { ts: Date.now() - 600000 }]) {
        const rejected = await fixture({ upcoming: true, lensContext: { ...handoff, ...invalid } });
        assert(!select(rejected.out, node => node.props.className === 'gd-mobile-sheet'), 'A stale or out-of-scope handoff cannot open a picker');
        assert.equal(rejected.planWrites.length, 0);
    }
    const mountedReview = await fixture({ upcoming: true });
    await mountedReview.openLens(handoff);
    assert.match(textOf(mountedReview.out), /From Lineup lens: start Bench Option/);
    const multiPosition = await fixture({ upcoming: true });
    multiPosition.props.playersData.d.position = 'LB';
    multiPosition.props.playersData.d.fantasy_positions = ['LB', 'QB'];
    await multiPosition.openLens(handoff);
    assert.match(textOf(multiPosition.out), /From Lineup lens: start Bench Option/);
    const multiSheet = select(multiPosition.out, node => node.props.className === 'gd-mobile-sheet');
    select(multiSheet, node => node.type === 'button' && textOf(node).includes('Bench Option')).props.onClick();
    await multiPosition.render();
    assert.equal(JSON.parse(multiPosition.planWrites.at(-1).value)['0'], 'd', 'The same secondary-position swap remains legal when explicitly added to the plan');
    const aliasReview = await fixture({ upcoming: true });
    aliasReview.props.currentLeague.roster_positions = ['QB', 'RB', 'WRRB_FLEX'];
    aliasReview.props.playersData.d.position = 'RB';
    await aliasReview.render();
    await aliasReview.openLens({ ...handoff, slotIndex: 2, outgoingPid: 'c' });
    assert.match(textOf(aliasReview.out), /From Lineup lens: start Bench Option over Missing Starter/);
    }

    const fromOverview = await fixture({ initialView: 'matchup', withMatchup: true });
    assert.equal(button(fromOverview.out, 'Matchup').props['aria-pressed'], true, 'Overview entry opens the matchup immediately');
    assert(select(fromOverview.out, matchupPanel));
    assert(!select(fromOverview.out, n => n.props.id === 'gameday-starting-lineup'), 'Overview entry does not show lineup planning first');
    assert.match(textOf(fromOverview.out), /vs Opponent Name/, 'The selected league opponent is retained');
    button(fromOverview.out, 'Lineup').props.onClick(); await fromOverview.render();
    assert(select(fromOverview.out, n => n.props.id === 'gameday-starting-lineup'), 'Lineup remains available from the matchup');
    assert(!button(fromOverview.out, 'Season') && !button(fromOverview.out, 'Odds'), 'Game Day keeps only Lineup and Matchup');
    button(fromOverview.out, 'Matchup').props.onClick(); await fromOverview.render();
    fromOverview.props.initialView = 'week'; await fromOverview.render();
    assert.equal(button(fromOverview.out, 'Lineup').props['aria-pressed'], true, 'Ordinary entry resets a mounted destination to Lineup');
    const withoutOpponent = await fixture({ initialView: 'matchup', matchupId: null });
    assert.equal(button(withoutOpponent.out, 'Matchup').props['aria-pressed'], true);
    assert.match(textOf(withoutOpponent.out), /The matchup appears when an opponent and projections are available/, 'Missing opponent context stays in the requested view');

    const idp = await fixture({upcoming:true});
    idp.props.currentLeague.roster_positions=['DL','LB','DB'];
    idp.props.playersData.a.position='EDGE';idp.props.playersData.b.position='MLB';idp.props.playersData.c.position='SS';
    await idp.render();
    for(const [alias,color] of [['EDGE','var(--k-e67e22, #e67e22)'],['MLB','var(--k-1abc9c, #1abc9c)'],['SS','var(--k-e91e63, #e91e63)']]) {
        const badge=select(idp.out,n=>n.props.className==='gd-player-initial gd-pos-'+alias.toLowerCase());
        assert(badge,'Game Day retains '+alias+' as a visible player role');assert.equal(textOf(badge),alias);
        assert.equal(badge.props.style['--gd-position-ink'],color,'Game Day uses the same defensive family color as My Roster');
    }
    const active = await fixture();
    const currentWeekOption = all(active.out).find(node => node.type === 'option' && textOf(node) === 'Wk 2 · Current');
    assert(currentWeekOption, 'the phone week picker identifies the current week with its compact label');
    assert.equal(all(active.out).filter(n => n.props.className === 'gd-scoreboard').length, 1, 'one scoreboard in the existing lineup');
    assert.doesNotMatch(textOf(active.out), /FOLLOW YOUR LINEUP|Submitted starters/);
    assert.equal(select(active.out, n => n.props.className === 'gd-planning-focus'), undefined, 'mobile lineup opens directly on the actionable lineup surface');
    const plan = select(active.out, n => n.props.className === 'gd-working-lineup');
    assert(plan); assert.match(textOf(plan), /partial/);
    const controls = select(active.out, n => n.props.className === 'gd-lineup-controls');
    assert(select(controls, n => n.props['aria-label'] === 'Lineup week'), 'The compact controls keep week navigation');
    assert(select(controls, n => n.props['aria-label'] === 'Optimizer form window'), 'The same compact control group keeps the PPG window');
    assert(select(select(plan, n => n.props.className === 'gd-list-heading mc-lineup-heading'), n => n.props.className === 'mc-lineup-total'), 'Lineup total shares the heading instead of a separate control row');
    assert.doesNotMatch(textOf(plan), /Plan here\. Set your final starters|Only players with verified upcoming games/, 'redundant planning instructions stay out of the mobile lineup');
    assert(select(plan, n => n.props.className === 'gd-scoreboard'), 'live scores stay inside starting lineup');
    assert.match(textOf(plan), /Locked0\.00Final pts/);
    assert.match(textOf(plan), /Locked-2\.50Final pts/);
    const missingRow = select(plan, n => n.type === 'button' && textOf(n).includes('Missing Starter'));
    assert.match(textOf(missingRow), /—Proj—L5 PPG/);
    const starter = select(plan, n => n.type === 'button' && textOf(n).includes('Zero Starter'));
    assert(select(starter, n => n.props.className === 'gd-player-initial gd-pos-qb'), 'Game Day uses the quarterback position color hook');
    assert.match(textOf(starter), /0\.0Proj0\.0L5 PPG/, 'projection and zero PPG are visible without opening the player');
    assert.match(textOf(missingRow), /—Proj—L5 PPG/, 'missing PPG stays unavailable');
    const negativeRow = select(plan, n => n.type === 'button' && textOf(n).includes('Negative Starter'));
    assert(select(negativeRow, n => n.props.className === 'gd-player-initial gd-pos-rb'), 'Game Day uses the running-back position color hook');
    assert(select(missingRow, n => n.props.className === 'gd-player-initial gd-pos-wr'));
    assert.match(textOf(negativeRow), /-2\.5Proj-2\.5L5 PPG/, 'negative PPG is preserved');
    assert.equal(select(starter, n => n.props.className === 'gd-player-actual is-neutral').children[0].children[0], '0.00', 'real zero actual leads the row without a fabricated grade');
    assert(select(missingRow, n => n.props.className === 'gd-player-actual is-neutral' && textOf(n) === '—Final pts'), 'missing final remains a dash in the actual score card');
    assert(!select(starter, n => String(n.props.className).includes('gd-score-comparison')), 'no saved pregame means no comparison');

    const graded = await fixture({ forecasts: { a: { kind: 'pregame', points: 0 }, b: { kind: 'pregame', points: -5 }, c: { kind: 'pregame', points: 12 } } });
    const gradedRows = all(graded.out).filter(n => n.type === 'button' && String(n.props.className).includes('has-actual-score'));
    assert(select(gradedRows[0], n => n.props.className === 'gd-player-actual is-typical'), 'a completed zero can be near a zero forecast');
    assert.match(textOf(gradedRows[0]), /Near forecast · vs saved pregame 0\.0/);
    assert(select(gradedRows[1], n => n.props.className === 'gd-player-actual is-strong'), 'a negative actual above a more negative forecast preserves signed comparison');
    assert(select(gradedRows[2], n => n.props.className === 'gd-player-actual is-neutral'), 'missing final actual cannot be graded');
    const compare = values => active.scorePresentation({ tracking: true, submitted: true, state: 'final', gamesFresh: true, scoreStatus: 'ready', scoreError: null, scoresSupported: true, actual: 20, forecast: { kind: 'pregame', points: 10 }, ...values });
    assert.equal(compare({}).tone, 'strong');
    assert.equal(compare({ actual: 2 }).tone, 'quiet');
    assert.equal(compare({ actual: 12 }).tone, 'typical', 'the twenty percent boundary stays in the typical band');
    for (const values of [{ state: 'live' }, { state: 'locked' }, { state: 'unknown' }, { gamesFresh: false }, { scoreStatus: 'stale' }, { scoreStatus: 'refreshing' }, { scoreStatus: 'error' }, { scoreError: 'Refresh failed' }, { scoresSupported: false }, { forecast: { kind: 'first-view', points: 10 } }, { forecast: { kind: 'pregame', points: null } }, { actual: null }]) {
        assert.equal(compare(values).tone, 'neutral', 'only a fresh final with a finite saved pregame score can receive a grade');
        assert.equal(compare(values).comparison, null);
    }
    assert.equal(compare({ state: 'upcoming' }), null, 'a later kickoff never becomes an invented zero actual');
    assert.equal(compare({ submitted: false }), null, 'a locally assigned bench player cannot inherit submitted starter points');
    assert.equal(compare({ tracking: false }), null, 'future planning cannot display current actual points');
    const staleFantasy = await fixture({ forecasts: { a: { kind: 'pregame', points: 12 } }, scoreStatus: 'stale', scoreError: 'Refresh failed' });
    const staleFantasyRow = select(staleFantasy.out, n => n.type === 'button' && textOf(n).includes('Zero Starter'));
    assert(select(staleFantasyRow, n => n.props.className === 'gd-player-actual is-neutral' && textOf(n) === '0.00Last available pts'), 'fresh final NFL status cannot grade an old fantasy-feed zero');
    assert(!select(staleFantasyRow, n => String(n.props.className).includes('gd-score-comparison')), 'stale fantasy feed removes the pregame comparison');
    await graded.kickoff('KC');
    const liveCard = select(graded.out, n => n.props.className === 'gd-player-actual is-neutral' && /Live pts/.test(textOf(n)));
    assert(liveCard, 'the live card stays neutral blue even with a saved pregame forecast');
    starter.props.onClick(); await active.render();
    assert.equal(button(active.out, 'Empty this slot').props.disabled, true);
    assert(!all(active.out).some(n => n.type === 'button' && textOf(n).includes('Bench Option')));

    const roster = await fixture({ rosterView: true });
    const board = select(roster.out, n => n.props.className === 'gd-scoreboard');
    assert.match(textOf(board), /Week 2.*Opponent Name/);
    assert.match(textOf(board), /-2\.50/);
    assert.match(textOf(board), /0\.00/);
    const rows = out => all(out).filter(n => n.props.className === 'roster-lineup-row');
    assert.equal(rows(roster.out).length, 3);
    assert(rows(roster.out).every(n => n.props.disabled));
    assert.match(textOf(rows(roster.out)[0]), /Final · Locked.*0\.00Actual/);
    assert.match(textOf(rows(roster.out)[1]), /-2\.50Actual/);
    assert.match(textOf(rows(roster.out)[2]), /—Actual/);
    assert(select(roster.out, n => n.type === 'details' && textOf(n).includes('Scoring & lineup rules')));

    await roster.loadForm('a', { rollingPPG: 8.3, high: 8.3, low: 8.3, games: 1, recentCount: 1 });
    assert.match(textOf(roster.out), /8\.3L5 PPG/, 'weekly history arrival updates roster PPG without leaving the page');
    const pregame = await fixture({ upcoming: true, rosterView: true });
    assert.equal(select(pregame.out, n => n.props.className === 'gd-scoreboard'), undefined, 'no scoreboard before kickoff');
    assert.doesNotMatch(textOf(pregame.out), /Actual|Saved proj/);
    assert(rows(pregame.out).every(n => !n.props.disabled));
    assert.match(textOf(rows(pregame.out)[0]), /0\.0Proj0\.0L5 PPG/);
    rows(pregame.out)[0].props.onClick(); await pregame.render();
    const replacement = rows(pregame.out).find(n => textOf(n).includes('Bench Option'));
    assert(replacement, 'pregame picker offers eligible bench player');
    replacement.props.onClick(); await pregame.render();
    assert.match(textOf(rows(pregame.out)[0]), /Bench Option.*Local plan/);
    await pregame.kickoff('KC');
    assert.match(textOf(rows(pregame.out)[0]), /Zero Starter.*Live · Locked/);
    assert(rows(pregame.out)[0].props.disabled, 'submitted starter replaces unsubmitted draft at kickoff');
    assert(!rows(pregame.out)[1].props.disabled, 'later game remains editable');
    assert(select(pregame.out, n => n.props.className === 'gd-scoreboard'), 'scoreboard appears automatically at kickoff');
    assert.match(textOf(rows(pregame.out)[1]), /—Actual/, 'later games are not misleading zero scores');

    const stale = await fixture({ upcoming: true, rosterView: true, stale: true });
    assert(rows(stale.out).every(n => n.props.disabled), 'unknown status cannot unlock players');
    const missing = await fixture({ rosterView: true, noProjection: true });
    assert.match(textOf(missing.out), /Zero Starter.*0\.00Actual/);
    const unsupported = await fixture({ rosterView: true, supported: false });
    assert.match(textOf(unsupported.out), /Scoring unavailable/);
    const bye = await fixture({ matchupId: null, rosterView: true });
    assert.doesNotMatch(textOf(select(bye.out, n => n.props.className === 'gd-scoreboard')), /Opponent Name/);
    const desktop = await fixture({ width: 1280 });
    assert.doesNotMatch(textOf(desktop.out), /FOLLOW YOUR LINEUP/);
    assert(select(select(desktop.out, n => n.props.id === 'gameday-starting-lineup'), n => n.props.className === 'gd-scoreboard'));
    const beforeKickoff = await fixture({ upcoming: true });
    assert(!select(beforeKickoff.out, n => n.props.className === 'gd-scoreboard'), 'no pregame score panel');
    const upcomingRow = select(beforeKickoff.out, n => n.type === 'button' && textOf(n).includes('Zero Starter'));
    const upcomingKickoff = new Date(beforeKickoff.games[0].kickoff).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    assert(textOf(upcomingRow).includes(upcomingKickoff), 'scheduled players show their verified game date and kickoff time');
    assert.doesNotMatch(textOf(upcomingRow), /Upcoming/, 'scheduled player rows no longer use the vague upcoming label');
    const tablet = await fixture({ width: 768, rosterView: true });
    assert.match(textOf(tablet.out), /Starting lineup/);
    assert.equal(select(tablet.out, n => n.props.className === 'gd-mobile'), undefined);
    for (const width of [390, 1280]) {
        const forecast = await fixture({ width, withMatchup: true });
        if (width < 768) {
            assert(!select(forecast.out, matchupPanel), 'lineup opens directly without a duplicate matchup analysis above players');
            button(forecast.out, 'Matchup').props.onClick(); await forecast.render();
        }
        const breakdown = select(forecast.out, matchupPanel);
        assert(breakdown, 'matchup is visible on both viewport branches');
        assert.match(textOf(breakdown), /Position strength.*Show all players/);
        assert.doesNotMatch(textOf(breakdown), /Slot by slot/);
        assert.equal(all(breakdown).filter(n => n.props['data-slot-index'] != null).length, 0, 'Player comparisons wait inside their position rows');
        button(forecast.out, 'Show all players').props.onClick(); await forecast.render();
        const expandedBreakdown = select(forecast.out, matchupPanel);
        const comparisonRows = all(expandedBreakdown).filter(n => n.props['data-slot-index'] != null);
        assert.equal(comparisonRows.length, 3);
        assert.equal(new Set(comparisonRows.map(n => n.props['data-slot-index'])).size, 3, 'The unified comparison covers each actual starting slot once');
        if (width < 768) {
            assert.match(breakdown.props.className, /gd-matchup-compact/, 'phone matchup uses the denser layout');
            assert.doesNotMatch(textOf(breakdown), /Projected points · your lineup plan|Their current lineup:|Green: your edge/, 'phone matchup leaves desktop-only explanations out');
        } else {
            assert.doesNotMatch(breakdown.props.className, /gd-matchup-compact/, 'desktop matchup keeps its full layout');
            assert.match(textOf(breakdown), /Submitted starters.*actual points against their saved projections/, 'desktop actual review identifies the submitted lineup and baseline');
        }
        assert(!all(forecast.out).some(n => ['details', 'dialog'].includes(n.type) && textOf(n).includes('Position strength')), 'analysis requires no expansion or sheet');
        assert.doesNotMatch(textOf(forecast.out), /view their lineup|View opponent breakdown/);
        const free = await fixture({ width, withMatchup: true, pro: false });
        if (width < 768) { button(free.out, 'Matchup').props.onClick(); await free.render(); }
        assert(select(free.out, matchupPanel));
        assert.doesNotMatch(textOf(free.out), /Your biggest edge|Win probability|Show all players|Slot by slot/);
        const pregameForecast = await fixture({ width, withMatchup: true, upcoming: true });
        if (width < 768) { button(pregameForecast.out, 'Matchup').props.onClick(); await pregameForecast.render(); }
        const pregameBreakdown = select(pregameForecast.out, matchupPanel);
        assert(pregameBreakdown && !button(pregameBreakdown, 'Actual vs proj'), 'pregame keeps the projection outlook without fake actuals');
        if (width >= 768) assert.match(textOf(pregameBreakdown), /Projected points · your lineup plan/, 'desktop pregame still retains its original projection guidance');
    }

    // Reviewing actuals uses the submitted score feed even when the optimizer
    // or the local starting plan disagrees. A mode change keeps those players.
    const review = await fixture({ initialView: 'matchup', withMatchup: true, forecasts: { a: { kind: 'pregame', points: 0 }, b: { kind: 'pregame', points: -5 }, c: { kind: 'first-view', points: 10 }, d: { kind: 'pregame', points: 12 } } });
    review.result.optimal.starters[0].pid = 'd';
    await review.render();
    let reviewPanel = select(review.out, matchupPanel);
    assert.equal(button(reviewPanel, 'Actual vs proj').props['aria-pressed'], true, 'started submitted scores automatically select actual review');
    assert.match(textOf(reviewPanel), /-2\.50You.*0\.00Them/, 'review header preserves provider zero and negative team totals');
    assert.doesNotMatch(textOf(reviewPanel), /Final points/, 'an incomplete opponent lineup cannot promote the whole matchup to a final');
    assert(!textOf(reviewPanel).includes('Win probability'), 'final actual totals are not mixed with a fresh win forecast');
    button(reviewPanel, 'Show all players').props.onClick(); await review.render();
    const ownReviewNames = out => all(select(out, matchupPanel)).filter(node => node.props.className === 'gd-matchup-player gd-matchup-you').map(node => textOf(node.children[1]));
    assert.deepEqual(ownReviewNames(review.out), ['Zero Starter', 'Negative Starter', 'Missing Starter'], 'the actual panel reads submitted starters rather than the optimizer’s preferred quarterback');
    const actualReviewRows = all(select(review.out, matchupPanel)).filter(node => node.props['data-slot-index'] != null);
    assert.match(textOf(actualReviewRows[0]), /Zero Starter0\.00Pregame\s*0\.0/, 'a submitted zero keeps its saved zero baseline');
    assert.match(textOf(actualReviewRows[1]), /Negative Starter-2\.50Pregame\s*-5\.0/, 'signed individual actuals stay distinct from projections');
    assert.match(textOf(actualReviewRows[2]), /Missing Starter—First view\s*10\.0/, 'missing actuals and non-pregame sources stay explicit');
    assert.match(textOf(actualReviewRows[1]), /Opponent.*Not reported—/, 'a truncated submitted opponent list stays unreported rather than an empty zero slot');
    button(review.out, 'Projection').props.onClick(); await review.render();
    assert.equal(button(review.out, 'Projection').props['aria-pressed'], true);
    assert.deepEqual(ownReviewNames(review.out), ['Zero Starter', 'Negative Starter', 'Missing Starter'], 'projection mode reuses the submitted pairing instead of switching to the draft or ideal roster');
    button(review.out, 'Actual vs proj').props.onClick(); await review.render();
    assert.equal(button(review.out, 'Actual vs proj').props['aria-pressed'], true);
    const staleReview = await fixture({ initialView: 'matchup', withMatchup: true, scoreStatus: 'stale', scoreError: 'Refresh failed', forecasts: { a: { kind: 'pregame', points: 20 }, b: { kind: 'pregame', points: 20 } } });
    assert.match(textOf(select(staleReview.out, matchupPanel)), /Last available points/);
    button(staleReview.out, 'Show all players').props.onClick(); await staleReview.render();
    assert(!all(select(staleReview.out, matchupPanel)).some(node => String(node.props.className).startsWith('gd-review-player-points') && /is-strong|is-quiet|is-typical/.test(node.props.className)), 'stale actuals cannot keep final-performance coloring');
    assert(!all(select(staleReview.out, matchupPanel)).some(node => node.type === 'em' && /vs pregame/.test(textOf(node))), 'stale actuals lose final variance claims');
    const actualWithoutProjection = await fixture({ initialView: 'matchup', withMatchup: true, noProjection: true });
    assert.match(textOf(select(actualWithoutProjection.out, matchupPanel)), /-2\.50You.*0\.00Them/, 'submitted actual review does not depend on optimizer projections being available');

    // Both MyLineupTab render branches supply the selected league's current
    // stats and players. The benchmark switch stays local to the comparison;
    // assignments and stored actual/pregame records remain untouched.
    for (const noProjection of [false, true]) {
        const basis = await fixture({ initialView: 'matchup', withMatchup: true, withBasis: true, noProjection });
        const sourceRoster = JSON.stringify(basis.props.myRoster);
        const sourceProjections = JSON.stringify(basis.result.projections);
        const savedBefore = JSON.stringify([...basis.storage]);
        button(basis.out, 'Projection').props.onClick(); await basis.render();
        const picker = select(basis.out, node => node.props['aria-label'] === 'Matchup point comparison basis');
        assert(picker, noProjection ? 'Read-only actual review receives benchmark context without the optimizer' : 'Normal Game Day matchup receives benchmark context');
        picker.props.onChange({ target: { value: 'average' } }); await basis.render();
        const panel = select(basis.out, matchupPanel);
        assert.equal(panel.props['data-score-view'], 'average');
        assert.match(textOf(panel), /2026 average points/);
        assert.match(textOf(select(panel, node => node.props.className === 'gd-matchup-totals')), /8\.0You.*—Them/, 'Unreported opponent slots do not become invented empirical zeroes');
        button(basis.out, 'Show all players').props.onClick(); await basis.render();
        const myRows = all(select(basis.out, matchupPanel)).filter(node => node.props['data-slot-index'] != null);
        assert.match(textOf(myRows[0]), /Zero Starter10\.0Avg · 4 games/);
        assert.match(textOf(myRows[1]), /Negative Starter-2\.0Avg · 4 games/);
        assert.match(textOf(myRows[2]), /Missing Starter0\.0Avg · 4 games/, 'A verified average zero remains readable');
        assert.doesNotMatch(textOf(select(basis.out, matchupPanel)), /Win probability|vs pregame/);
        basis.props.statsSeason = 2025; await basis.render();
        assert.match(textOf(select(select(basis.out, matchupPanel), node => node.props.className === 'gd-matchup-totals')), /—You.*—Them/, 'The explicitly supplied stats season takes precedence over the league label');
        basis.props.statsSeason = 2026; await basis.render();
        button(basis.out, 'Actual vs proj').props.onClick(); await basis.render();
        assert.match(textOf(select(basis.out, matchupPanel)), /-2\.50You.*0\.00Them/, 'Returning to actuals restores the provider scores');
        assert.equal(JSON.stringify(basis.props.myRoster), sourceRoster);
        assert.equal(JSON.stringify(basis.result.projections), sourceProjections);
        assert.equal(JSON.stringify([...basis.storage]), savedBefore, 'Display selection cannot write lineup plans or captured pregame records');
    }

    // Past matchup review has its own score read and archived baseline. It must
    // not create a past lineup plan or move the live planner into a closed week.
    const historicalRows = [
        { roster_id: 1, matchup_id: 4, starters: ['d', 'b', 'c'], players_points: { d: 23, b: -3, c: 0 }, points: 20 },
        { roster_id: 2, matchup_id: 4, starters: ['a'], players_points: { a: 0 }, points: 0 },
    ];
    const history = await fixture({ initialView: 'matchup', withMatchup: true, scoreRowsByWeek: { 1: historicalRows }, forecastsByWeek: { 1: { d: { kind: 'pregame', points: 20 }, b: { kind: 'pregame', points: -5 }, c: { kind: 'pregame', points: 0 }, a: { kind: 'pregame', points: 0 } } } });
    const rosterBeforeReview = JSON.stringify(history.props.myRoster);
    const matchupWeek = select(history.out, node => node.type === 'select' && node.props['aria-label'] === 'Matchup week');
    assert(matchupWeek && all(matchupWeek).some(node => node.type === 'option' && node.props.value === 1), 'completed weeks are discoverable in the dedicated matchup picker');
    matchupWeek.props.onChange({ target: { value: '1' } }); await history.render();
    let historyPanel = select(history.out, matchupPanel);
    assert.equal(select(historyPanel, node => node.type === 'select' && node.props['aria-label'] === 'Matchup week').props.value, 1);
    assert.match(textOf(historyPanel), /Week 1.*20\.00You.*0\.00Them/, 'a completed matchup displays its own provider totals');
    assert(history.scoreFeedCalls.some(call => call.week === 1 && call.enabled), 'historical review requests the chosen submitted score week');
    assert(history.scoreWeeks.includes(1), 'historical game-final evidence uses the selected past week');
    assert(!history.projectionWeeks.includes(1), 'reviewing a past week never requests a new historical lineup optimization');
    assert(!history.forecastCaptures.includes(1), 'reviewing cannot overwrite the archived baseline with a new estimate');
    assert(!history.planWrites.some(write => write.key.startsWith('wr-lineup-plan-v1|') && write.key.endsWith('|1')), 'past review never creates or changes a closed-week lineup plan');
    assert.equal(JSON.stringify(history.props.myRoster), rosterBeforeReview, 'read-only review never mutates the managed roster');
    button(history.out, 'Show all players').props.onClick(); await history.render();
    assert.deepEqual(ownReviewNames(history.out), ['Bench Option', 'Negative Starter', 'Missing Starter'], 'past review displays that week’s submitted players');
    assert.match(textOf(select(history.out, matchupPanel)), /Bench Option23\.00Pregame\s*20\.0/, 'past player details use the archived week’s projection');
    button(history.out, 'Lineup').props.onClick(); await history.render();
    const primaryWeek = select(history.out, node => node.type === 'select' && node.props['aria-label'] === 'Lineup week');
    assert.equal(primaryWeek.props.value, 2, 'returning to Lineup keeps the live planning week');
    assert(all(primaryWeek).filter(node => node.type === 'option').every(node => node.props.value >= 2), 'past weeks are absent from the primary planning picker');
    primaryWeek.props.onChange({ target: { value: '1' } }); await history.render();
    assert.equal(select(history.out, node => node.type === 'select' && node.props['aria-label'] === 'Lineup week').props.value, 2, 'a forged earlier planning selection is clamped to the live week');
    assert(!history.planWrites.some(write => write.key.startsWith('wr-lineup-plan-v1|') && write.key.endsWith('|1')), 'the primary planner cannot write a historical plan through its change handler');

    // Apply Optimal must follow the selected history window even when the
    // weekly projection ranks the two quarterbacks in the opposite order.
    for (const view of [{ rosterView: true, width: 390 }, { rosterView: true, width: 1280 }, { width: 390 }, { width: 1280 }]) {
        const f = await fixture({ ...view, upcoming: true });
        f.result.projections.c.available = true;
        f.props.playersData.b.injury_status = 'Questionable';
        f.props.playersData.c.injury_status = 'Doubtful';
        const form = value => ({ rollingPPG: value, high: value, low: value, games: 8, recentCount: 5 });
        await f.loadForm('a', win => form(({ 3: 5, 5: 20, 8: 6, season: 22 })[win]));
        await f.loadForm('d', win => form(({ 3: 30, 5: 10, 8: 25, season: 2 })[win]));
        await f.loadForm('c', form(0));
        assert(select(f.out, n => n.props.className === 'lineup-injury is-danger' && textOf(n) === 'Doubtful'));
        assert(select(f.out, n => n.props.className === 'lineup-injury is-caution' && textOf(n) === 'Questionable'));
        const apply = async () => {
            const applyButton = button(f.out, 'Apply Optimal') || button(f.out, 'Use optimal in my plan');
            if (applyButton) { assert(!applyButton.props.disabled); applyButton.props.onClick(); await f.render(); }
            const done = button(f.out, 'Done');
            if (done) { done.props.onClick(); await f.render(); }
        };
        const starterArea = () => select(f.out, n => n.props.className === (view.rosterView ? 'roster-lineup-players' : view.width === 390 ? 'gd-player-list' : 'lineup-slot-0'));
        const chosen = () => {
            if (view.rosterView || view.width === 390) return textOf(starterArea());
            // Desktop starter rows are the clickable divs above the bench table.
            return all(f.out).filter(n => n.type === 'div' && n.props.onClick && n.props.style?.cursor === 'pointer').map(textOf).join('|');
        };
        await apply();
        assert.match(chosen(), /Zero Starter/, 'default L5 keeps higher rolling average despite lower weekly projection');
        button(f.out, 'L3').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Bench Option/, 'L3 uses the quarterback leading over that window');
        assert.match(chosen(), /Negative Starter/, 'real negative PPG remains eligible');
        assert.match(chosen(), /Missing Starter/, 'real zero PPG remains eligible');
        button(f.out, 'L5').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Zero Starter/, 'changing the window recomputes the applied lineup');
        button(f.out, 'L8').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Bench Option/);
        button(f.out, 'SZN').props.onClick(); await f.render();
        await apply();
        assert.match(chosen(), /Zero Starter/);
        await f.kickoff('KC');
        const lockedApply = button(f.out, 'Apply Optimal');
        assert(!lockedApply || lockedApply.props.disabled, 'auto-fill cannot bypass kickoff locks');
    }

    const sorted = await fixture({ upcoming: true, rosterView: true });
    await sorted.loadForm('a', { rollingPPG: 20 });
    await sorted.loadForm('d', { rollingPPG: 10 });
    rows(sorted.out)[0].props.onClick(); await sorted.render();
    let picker = select(sorted.out, n => n.props.className === 'roster-lineup-picker');
    assert(textOf(picker).indexOf('Zero Starter') < textOf(picker).indexOf('Bench Option'), 'picker sorts highest average first, not projection');
    await sorted.loadForm('d', { rollingPPG: 30 });
    picker = select(sorted.out, n => n.props.className === 'roster-lineup-picker');
    assert(textOf(picker).indexOf('Bench Option') < textOf(picker).indexOf('Zero Starter'), 'new history reorders the picker');
    assert(button(sorted.out, 'Apply Optimal').props.disabled, 'missing history cannot silently become zero or blank a slot');
    assert.match(textOf(sorted.out), /More eligible players with game history/);
    const flex = await fixture({ upcoming: true, rosterView: true });
    flex.result.projections.c.available = true;
    flex.props.currentLeague.roster_positions = ['QB', 'RB', 'WR', 'SUPER_FLEX'];
    await flex.loadForm('a', { rollingPPG: 10 });
    await flex.loadForm('d', { rollingPPG: 20 });
    await flex.loadForm('c', { rollingPPG: 0 });
    assert(!button(flex.out, 'Apply Optimal').props.disabled);
    button(flex.out, 'Apply Optimal').props.onClick(); await flex.render();
    const flexRows = rows(flex.out);
    assert.equal(flexRows.length, 4);
    assert.match(textOf(flexRows[0]), /QB.*Bench Option/);
    assert.match(textOf(flexRows[3]), /SUPER FLEX.*Zero Starter/, 'remaining quarterback fills superflex without duplication');
    flex.props.myRoster.taxi = ['d']; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'taxi players cannot fill active slots');
    flex.props.myRoster.taxi = []; flex.props.myRoster.reserve = ['d']; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'reserve players cannot fill active slots');
    flex.props.myRoster.reserve = []; flex.props.playersData.d.injury_status = 'Out'; await flex.render();
    assert(button(flex.out, 'Apply Optimal').props.disabled, 'out players cannot fill active slots despite strong history');

    // Week planning follows the selected NFL week without unlocking the live
    // lineup. Plans remain independent across weeks, leagues and page reloads.
    const nextWeek = out => select(out, node => node.type === 'button' && node.props['aria-label'] === 'Next lineup week');
    const prevWeek = out => select(out, node => node.type === 'button' && node.props['aria-label'] === 'Previous lineup week');
    const planList = out => select(out, node => node.props.className === 'gd-player-list');
    const future = await fixture({ withMatchup: true });
    assert(prevWeek(future.out).props.disabled, 'cannot navigate before the live week');
    nextWeek(future.out).props.onClick(); await future.render();
    assert.match(textOf(future.out), /Future lineup · saved on this device/);
    assert(future.projectionWeeks.includes(3), 'projections request the selected future week');
    assert(future.scoreWeeks.includes(3), 'kickoff states request the selected future week');
    assert(future.contextWeeks.includes(3), 'NFL opponents request the selected future week');
    assert(future.opponentWeeks.includes(3), 'fantasy opponent requests the selected future week');
    assert(!select(future.out, node => node.props.className === 'gd-scoreboard'), 'future plan never displays this week’s actual scoreboard');
    select(planList(future.out), node => node.type === 'button' && textOf(node).includes('Zero Starter')).props.onClick(); await future.render();
    const futurePick = select(future.out, node => node.type === 'button' && textOf(node).includes('Bench Option'));
    assert(futurePick && !futurePick.props.disabled, 'current-week finals do not lock a future-week replacement');
    assert.match(textOf(futurePick), /30\.0Proj/, 'replacement uses the future-week projection');
    futurePick.props.onClick(); await future.render();
    assert.match(textOf(planList(future.out)), /Bench Option/);
    nextWeek(future.out).props.onClick(); await future.render();
    assert.match(textOf(planList(future.out)), /Zero Starter/, 'a different future week has its own starting plan');
    prevWeek(future.out).props.onClick(); await future.render();
    assert.match(textOf(planList(future.out)), /Bench Option/, 'switching back restores that week’s plan');
    prevWeek(future.out).props.onClick(); await future.render();
    assert.match(textOf(planList(future.out)), /Zero Starter.*Locked0\.00Final pts/, 'the live week keeps submitted-player locks');
    const reloaded = await fixture({ storage: future.storage });
    nextWeek(reloaded.out).props.onClick(); await reloaded.render();
    assert.match(textOf(planList(reloaded.out)), /Bench Option/, 'the week plan survives a page reload');
    reloaded.props.currentLeague.league_id = '456'; await reloaded.render();
    nextWeek(reloaded.out).props.onClick(); await reloaded.render();
    assert.match(textOf(planList(reloaded.out)), /Zero Starter/, 'saved plans cannot leak into another league');
    const unverifiedFuture = await fixture({ stale: true });
    nextWeek(unverifiedFuture.out).props.onClick(); await unverifiedFuture.render();
    select(planList(unverifiedFuture.out), node => node.type === 'button' && textOf(node).includes('Zero Starter')).props.onClick(); await unverifiedFuture.render();
    assert(!select(unverifiedFuture.out, node => node.type === 'button' && textOf(node).includes('Bench Option')).props.disabled, 'a local future plan remains editable before the future schedule loads');
    assert(!button(unverifiedFuture.out, 'Use optimal in my plan'), 'missing schedule evidence cannot enable auto-fill');

    const coverage = await fixture({ upcoming: true, seasonView: 'season', seasonData: { byeWatch: [{ week: 8, count: 2, positions: ['WR', 'WR'] }, { week: 4, count: 1, positions: ['QB'] }, { week: 12, count: 1, positions: ['TE'] }] } });
    assert(!select(coverage.out, n => n.props['aria-label'] === 'Game Day views'), 'League season view omits Game Day navigation');
    assert(!select(coverage.out, n => n.props.id === 'gameday-starting-lineup'));
    coverage.props.seasonView = 'odds'; await coverage.render();
    assert.match(textOf(coverage.out), /Season odds are unavailable/);
    coverage.props.seasonView = 'season'; await coverage.render();
    const unprojected = await fixture({ noProjection: true, seasonView: 'odds' });
    assert.match(textOf(unprojected.out), /Season odds are unavailable/);
    assert.doesNotMatch(textOf(unprojected.out), /Projections unavailable/);
    assert.equal(coverage.planWrites.length, 0, 'League season browsing never writes a lineup plan');
    assert.equal(coverage.forecastCaptures.length, 0, 'League season browsing never captures Game Day forecasts');
    const coverageText = textOf(coverage.out);
    assert.match(coverageText, /Wk 4.*Wk 8.*Wk 12/, 'all coverage weeks appear directly in chronological order');
    assert.doesNotMatch(coverageText, /Later coverage weeks|weeks to review/);

    // Tap sorting changes the visible player order, never the legal slot
    // assignments or saved plan. The eligible-player sheet sorts independently.
    const sortable = await fixture({ upcoming: true, withMetrics: true });
    const headerFor = (out, name) => select(out, node => String(node.props.className || '').split(' ').includes(name));
    const headerButton = (header, label) => select(header, node => node.type === 'button' && textOf(node).trim().startsWith(label));
    const visiblePlayers = out => all(select(out, node => node.props.className === 'gd-player-list')).filter(node => node.type === 'button' && String(node.props.className || '').split(' ').includes('gd-plan-player'));
    const playerNames = out => visiblePlayers(out).map(node => textOf(select(node, child => child.props.className === 'gd-player-main').children[0]));
    const beforeSortRoster = JSON.stringify(sortable.props.myRoster), beforeSortPlan = JSON.stringify([...sortable.storage]);
    assert.deepEqual(playerNames(sortable.out), ['Zero Starter', 'Negative Starter', 'Missing Starter'], 'untouched Game Day keeps the familiar slot order');
    headerButton(headerFor(sortable.out, 'gd-player-sort-heading'), 'PROJ').props.onClick({ stopPropagation() {} }); await sortable.render();
    assert.deepEqual(playerNames(sortable.out), ['Zero Starter', 'Negative Starter', 'Missing Starter'], 'descending projections retain real zero above negative and unknown');
    headerButton(headerFor(sortable.out, 'gd-player-sort-heading'), 'PROJ').props.onClick({ stopPropagation() {} }); await sortable.render();
    assert.deepEqual(playerNames(sortable.out), ['Negative Starter', 'Zero Starter', 'Missing Starter'], 'a second tap reverses numeric order while unknown stays last');
    headerButton(headerFor(sortable.out, 'gd-player-sort-heading'), 'Player').props.onClick({ stopPropagation() {} }); await sortable.render();
    assert.deepEqual(playerNames(sortable.out), ['Missing Starter', 'Negative Starter', 'Zero Starter'], 'name sorting is alphabetical');
    assert.equal(JSON.stringify(sortable.props.myRoster), beforeSortRoster);
    assert.equal(JSON.stringify([...sortable.storage]), beforeSortPlan, 'header taps never write the local lineup plan');
    visiblePlayers(sortable.out).find(node => textOf(node).includes('Zero Starter')).props.onClick(); await sortable.render();
    const sheet = () => select(sortable.out, node => node.props.className === 'gd-mobile-sheet');
    headerButton(headerFor(sheet(), 'gd-picker-sort-heading'), 'PROJ').props.onClick({ stopPropagation() {} }); await sortable.render();
    const eligibleNames = all(sheet()).filter(node => node.type === 'button' && String(node.props.className || '').split(' ').includes('gd-plan-player')).map(node => textOf(select(node, child => child.props.className === 'gd-player-main').children[0]));
    assert.deepEqual(eligibleNames, ['Bench Option', 'Zero Starter'], 'eligible players sort by the projection shown in the picker');
    assert.deepEqual(playerNames(sortable.out), ['Missing Starter', 'Negative Starter', 'Zero Starter'], 'picker sort does not replace the main list sort');
    assert.equal(JSON.stringify([...sortable.storage]), beforeSortPlan, 'picker header taps are also display-only');
    select(sheet(), node => node.type === 'button' && textOf(node).includes('Bench Option')).props.onClick(); await sortable.render();
    const plannedQuarterback = visiblePlayers(sortable.out).find(node => textOf(node).includes('Bench Option'));
    assert.match(textOf(plannedQuarterback), /QB.*Bench Option/, 'an action from a sorted row retains its original QB slot instead of its display index');
    assert.match(textOf(visiblePlayers(sortable.out).find(node => textOf(node).includes('Missing Starter'))), /WR.*Missing Starter/, 'the unrelated starting slot remains intact');

    console.log('PASS roster and Game Day: live locks, saved plans, submitted actual/projection review, archived read-only matchup weeks, score-source and stale-grade boundaries, PPG and responsive routes');
})().catch(error => { console.error(error); process.exitCode = 1; });
