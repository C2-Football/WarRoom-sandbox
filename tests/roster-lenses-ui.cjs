'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');

const compiledLens = Babel.transform(fs.readFileSync('js/components/roster-lenses.js', 'utf8'), { presets: ['react'] }).code;
const compiledRoster = Babel.transform(fs.readFileSync('js/tabs/my-team.js', 'utf8'), { presets: ['react'] }).code;
const walk = value => value == null || typeof value === 'boolean' ? [] : Array.isArray(value) ? value.flatMap(walk) : typeof value === 'object' ? [value, ...walk(value.children)] : [value];
const text = node => walk(node).filter(value => typeof value !== 'object').join('');
const all = (node, predicate) => walk(node).filter(value => value && typeof value === 'object' && predicate(value));
const find = (node, predicate) => all(node, predicate)[0];
const noop = () => {};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

function candidate(id, incomingName, weekly, season, extra = {}) {
    return { id, pid: id, anchorPlayerId: 'bench', dropPid: 'bench',
        incoming: [{ pid: id, name: incomingName, position: 'RB', team: 'CHI', projection: 18 }],
        outgoing: [{ pid: 'bench', name: 'Bench Runner', position: 'RB', projection: 5 }],
        weekly: { status: 'ready', before: 100, after: 100 + weekly, delta: weekly },
        season: { status: 'ready', before: 500, after: 500 + season, delta: season },
        reason: 'Improves the best legal lineup.', cautions: ['Availability requires platform confirmation.'],
        ...extra };
}
const waiverCandidates = () => [candidate('add-a', 'Available Runner', 3, 10), candidate('add-b', 'Other Runner', 2, 20), candidate('add-c', 'Third Runner', 1, 30)];
const tradeCandidates = () => [candidate('trade-a', 'Trade Target', 2, 0, { season: { status: 'unavailable', reason: 'Load the full season.' }, price: { delta: -100, unit: 'DHQ' } }), candidate('trade-b', 'Other Trade Target', 12, 0)];
const ready = candidates => ({ status: 'ready', week: 6, candidates });

function harness({ integrated = false, pro = true, metrics = false } = {}) {
    const slots = [], pending = new Map(), events = [], listeners = new Map(), calls = [], seasonCalls = [], writes = [], navigations = [], acquisition = [], comparisons = [];
    let index = 0, dirty = false, tree, lens, viewer = 'owner', saveFailure = false;
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
    const effect = (fn, deps) => {
        const i = index++, prior = slots[i];
        if (!prior || !same(prior.deps, deps)) { slots[i] = { deps, cleanup: prior?.cleanup }; pending.set(i, fn); }
    };
    const React = {
        Fragment: 'fragment',
        useState(initial) {
            const i = index++; if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
            return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
        },
        useMemo(fn, deps) { const i = index++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
        useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
        useRef(initial) { const i = index++; if (!slots[i]) slots[i] = { current: initial }; return slots[i]; },
        useEffect: effect, useLayoutEffect: effect,
        createElement(type, props, ...children) {
            props = { ...(props || {}), children };
            if (typeof type === 'function') return type(props);
            if (type === 'sheet' || type === 'filter-sheet') return props.open ? { type, props, children: [...(props.sections || []).map(section => section.node), props.footer, ...children] } : null;
            if (type === 'card-list') return { type, props, children: (props.groups || []).flatMap(group => group.rows) };
            return { type, props, children };
        },
    };
    const players = {
        starter: { full_name: 'Starter Receiver', position: 'WR', team: 'MIN', age: 25 },
        bench: { full_name: 'Bench Runner', position: 'RB', team: 'CHI', age: 30 },
        ir: { full_name: 'Reserve Receiver', position: 'WR', team: 'NYJ', age: 24, injury_status: 'IR' },
        taxi: { full_name: 'Taxi Quarterback', position: 'QB', team: 'ATL', age: 22, years_exp: 0 },
    };
    const roster = { roster_id: 1, owner_id: 'owner', players: Object.keys(players), starters: ['starter'], reserve: ['ir'], taxi: ['taxi'], settings: { wins: 0, losses: 0, ties: 0, waiver_budget_used: 25 } };
    const league = { league_id: 'one', season: '2026', roster_positions: ['WR', 'RB', 'BN'], settings: { type: 0, waiver_budget: 100, reserve_slots: 1, taxi_slots: 1 }, scoring_settings: { rec: 1 }, rosters: [roster] };
    const gm = { hasStrategy: true, mode: 'win_now', modeLabel: 'Win now', untouchable: new Set(), targetPositions: new Set(), sellPositions: new Set(), sellRules: [] };
    const plans = new Map([['add-a', { pid: 'add-a', dropPid: 'bench', bid: 7 }]]);
    const root = {
        innerWidth: 390, localStorage,
        S: { currentLeagueId: 'one', platform: 'sleeper', nflState: { season: '2026', week: 6 }, weeklyPlayerPointsScope: 'points:one' },
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) { events.push(event); for (const fn of listeners.get(event.type) || []) fn(event); },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        RosterPlayerStats: 'roster-stats', wrIsPro: () => pro,
        wrComparePlayers: (ids, options) => { comparisons.push({ ids, options }); return true; },
        WR: {
            useViewport: () => ({ width: 390, isPhone: true }),
            GmMode: { useGmEffects: () => gm, getPreset: () => ({}) },
            AssetRow: 'asset-row', CardList: 'card-list', FilterSheet: 'filter-sheet', Sheet: 'sheet',
            WaiverPlans: { account: () => 'account:' + viewer, get: (_league, pid) => plans.get(pid), save: (currentLeague, plan) => { writes.push({ leagueId: currentLeague.league_id, ...plan }); return saveFailure ? null : { ...plan }; } },
            openAcquisition: context => acquisition.push(context),
        },
        App: {
            calcRawPts: stats => stats.pts || 0, normPos: position => position, POS_COLORS: {},
            LI: { playerScores: { starter: 8000, bench: 100, ir: 4000, taxi: 2000 } },
            NFLByes: { seasonFor: () => 2026, label: () => 'Bye 7', rosterWeeks: () => ({ weeks: [], unknown: [] }) },
            WeeklyProj: { currentWeek: () => 6, weeklyPointsScope: id => 'points:' + id, formStats: () => ({ rollingPPG: 11.5 }) },
            RosterWaiverLens: { load: options => { const next = deferred(); calls.push({ mode: 'waivers', options, ...next }); return next.promise; } },
            RosterTradeLens: {
                load: options => { const next = deferred(); calls.push({ mode: 'trades', options, ...next }); return next.promise; },
                loadSeason: options => { const next = deferred(); seasonCalls.push({ options, ...next }); return next.promise; },
                toBuilderContext: (move, result) => ({ kind: 'roster-lens-package', leagueId: 'one', candidateId: move.id, resultWeek: result.week, basis: result.basis || 'projected', givePlayerIds: move.outgoing.map(asset => asset.pid), receivePlayerIds: move.incoming.map(asset => asset.pid) }),
            },
        },
    };
    const context = vm.createContext({ window: root, React, console, CustomEvent: root.CustomEvent, localStorage,
        InlineCareerStats: 'career', getPlayerAnnotation: () => null, wrAlpha: color => color,
        setTimeout: fn => fn(), requestAnimationFrame: noop, document: { querySelector: () => null } });
    if (metrics) { root.React = React; vm.runInContext(fs.readFileSync('js/shared/player-metrics.js', 'utf8'), context); }
    vm.runInContext(compiledLens, context);
    const api = root.WR.RosterLens;
    const input = { league, roster, players, statsData: {}, priorData: {}, userId: 'owner', gm, skin: { type: 'redraft', features: { showTrades: true, showTaxi: true, showWeeklyVerdict: false } }, revision: 1, isPro: pro, setActiveTab: tab => navigations.push(tab) };
    let props;
    if (integrated) {
        vm.runInContext(fs.readFileSync('js/shared/roster-review.js', 'utf8'), context);
        vm.runInContext(compiledRoster, context);
        const useLens = api.useLens; api.useLens = options => (lens = useLens(options));
        props = { myRoster: roster, currentLeague: league, leagueSkin: input.skin, playersData: players,
            statsData: input.statsData, stats2025Data: input.priorData, standings: [], sleeperUserId: input.userId,
            rosterFilter: 'All', rosterSort: { key: 'name', dir: 1 }, visibleCols: ['pos', 'age', 'dhq', 'ppg'], expandedPid: null, showColPicker: false, colPreset: 'default', timeRecomputeTs: 1,
            setActiveTab: input.setActiveTab };
        for (const key of ['rosterFilter', 'rosterSort', 'visibleCols', 'expandedPid', 'showColPicker', 'colPreset']) props['set' + key[0].toUpperCase() + key.slice(1)] = value => { props[key] = typeof value === 'function' ? value(props[key]) : value; dirty = true; };
    }
    function render(commit = true) {
        let passes = 0;
        do {
            assert(++passes < 30, 'Hooks should reach a stable render');
            dirty = false; index = 0;
            if (integrated) tree = context.MyTeamTab(props);
            else {
                lens = api.useLens(input);
                tree = [api.Controls({ lens, inlinePids: new Set(['bench']) }), api.Row({ lens, pid: 'bench' })];
            }
            if (!commit) break;
            const effects = [...pending]; pending.clear();
            for (const [i, fn] of effects) { slots[i].cleanup?.(); slots[i].cleanup = fn(); }
        } while (dirty);
        return tree;
    }
    async function flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty) render(); } return tree; }
    const apiForTest = { root, api, input, props, calls, seasonCalls, writes, events, navigations, acquisition, comparisons, plans, players, roster, league, gm, render, flush,
        get tree() { return tree; }, get lens() { return lens; },
        set viewer(value) { viewer = value; }, set saveFailure(value) { saveFailure = value; },
        click(label) { const button = find(tree, node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)); assert(button, 'button: ' + label); button.props.onClick(); render(); return button; },
        change(label, value) { const control = find(tree, node => node.props['aria-label'] === label); assert(control, 'control: ' + label); control.props.onChange({ target: { value } }); render(); },
    };
    render(); return apiForTest;
}

async function loadWaivers(h, candidates = waiverCandidates()) { h.click('Waivers'); await h.flush(); const call = h.calls.at(-1); assert.equal(call.mode, 'waivers'); call.resolve(ready(candidates)); await h.flush(); return h.lens; }
async function loadTrades(h, candidates = tradeCandidates()) { h.click('Trades'); await h.flush(); const call = h.calls.at(-1); assert.equal(call.mode, 'trades'); call.resolve({ ...ready(candidates), week: 7, timing: { fromWeek: 7 } }); await h.flush(); return h.lens; }

// Loading recommendations never opens a preview. Existing detail-focused tests
// explicitly choose their move through these helpers instead of relying on a
// default selection; the interaction tests below use the native row buttons.
function chooseMove(h, id = h.lens.options[0]?.id) {
    const move = h.lens.options.find(candidate => candidate.id === id);
    assert(move, 'Choose a loaded current move'); h.lens.choose(move); h.render();
    return h.lens;
}
async function openWaivers(h, candidates = waiverCandidates()) { await loadWaivers(h, candidates); chooseMove(h); await h.flush(); return h.lens; }
async function openTrades(h, candidates = tradeCandidates()) { await loadTrades(h, candidates); chooseMove(h); await h.flush(); return h.lens; }

test('lens is opt-in, read-only, and disabled without the existing recommendation entitlement', async () => {
    const h = harness(), before = JSON.stringify(h.roster), strategy = JSON.stringify(h.gm);
    await h.flush(); assert.equal(h.calls.length, 0); assert.equal(h.seasonCalls.length, 0); assert.equal(h.lens.mode, 'off');
    await openWaivers(h); h.click('Lens off'); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(h.lens.selected == null); assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(h.roster), before); assert.equal(JSON.stringify(h.gm), strategy); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
    const free = harness({ pro: false }); free.lens.setMode('waivers'); free.render(); await free.flush();
    assert.equal(free.lens.enabled, false); assert.equal(free.tree.filter(Boolean).length, 0); assert.equal(free.calls.length, 0);
    const chopped = harness(); chopped.input.skin = { type: 'chopped', features: { showTrades: false } }; chopped.render();
    assert.equal(find(chopped.tree, node => node.type === 'button' && text(node) === 'Trades off').props.disabled, true);
});

test('an explicitly opened add/drop survives horizon reranking and restores its saved bid', async () => {
    const h = harness(); await openWaivers(h);
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(h.lens.ui.bid, '7');
    h.click('Season'); await h.flush();
    assert.equal(h.lens.options[0].id, 'add-c', 'Season alternatives rerank');
    assert.equal(h.lens.selected.id, 'add-a', 'The chosen move stays the same');
    assert.equal(h.lens.selected.dropPid, 'bench'); assert.equal(h.lens.ui.bid, '7'); assert.equal(h.calls.length, 1, 'Horizon is a view on the same snapshot');
    const choices = find(h.tree, node => node.type === 'select' && node.props['aria-label'] === 'Acquisition ideas for Bench Runner');
    assert.equal(all(choices, node => node.type === 'option' && !node.props.disabled).length, 3, 'All same-anchor ideas are reachable');
    h.change('Acquisition ideas for Bench Runner', 'add-c'); assert.equal(h.lens.selected.id, 'add-c'); assert.equal(h.lens.ui.bid, '');
    h.change('Acquisition ideas for Bench Runner', 'add-a'); assert.equal(h.lens.ui.bid, '7');
    h.click('Review claim'); h.click('Save claim plan');
    assert.equal(h.writes.at(-1).bid, 7); assert.equal(h.writes.at(-1).pid, 'add-a'); assert.equal(h.writes.at(-1).dropPid, 'bench');
    assert.match(text(h.tree), /Private claim plan saved\. No claim has been submitted\./);
});

test('Chopped keeps waiver previews week-only instead of relabeling a survival window as the full season', async () => {
    const h = harness(); h.input.skin = { type: 'chopped', features: { showTrades: false } };
    h.input.league = { ...h.league, settings: { ...h.league.settings, type: 3 } }; h.render();
    await openWaivers(h);
    assert(!find(h.tree, node => node.props['aria-label'] === 'Acquisition projection horizon'), 'One supported horizon needs no selector');
    assert(!find(h.tree, node => node.type === 'button' && text(node) === 'Season'), 'Chopped does not offer a misleading season scope');
    assert.equal(h.lens.ui.horizon, 'week');
    h.lens.setHorizon('season'); h.render(); await h.flush();
    assert.equal(h.lens.ui.horizon, 'week', 'A captured or programmatic season action cannot activate the unsupported horizon');
    assert.equal(h.lens.selected.id, 'add-a');
    assert(!text(h.tree).includes('Rest-of-season lineup points'));
    assert(!find(h.tree, node => String(node.props.className || '').includes('wr-lens-other-horizon')), 'No survival-window number appears as an alternate season forecast');
    assert.equal(h.seasonCalls.length, 0);
});

test('compact preview keeps decision facts, shows one preview cue, and avoids repeated names or generic captions', async () => {
    const h = harness({ integrated: true }); await openWaivers(h);
    let preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    const impact = find(h.tree, node => node.props.className === 'wr-lens-impact');
    const controls = find(h.tree, node => node.props['aria-label'] === 'Roster acquisition lenses');
    assert(preview.props.className.split(/\s+/).includes('is-inline'), 'The owned roster source uses the compact inline preview');
    assert(find(preview, node => node === impact), 'The lineup comparison belongs inside the opened player card');
    assert.equal(all(h.tree, node => node.props.className === 'wr-lens-impact').length, 1, 'The comparison is shown once');
    assert(!find(controls, node => node.props.className === 'wr-lens-impact'), 'Opening a player adds no comparison block above the roster');
    assert.equal(all(preview, node => String(node.props.className || '').split(/\s+/).includes('wr-lens-gain')).length, 1, 'The compact preview does not repeat its gain beside the incoming identity');
    for (const fact of ['Available Runner', 'Bench Runner', 'RB', 'CHI', 'Proj', '18.0', 'L5 PPG', '11.5', '$7']) assert(text(preview).includes(fact), 'Decision fact remains visible: ' + fact);
    for (const label of ['Open player details for Bench Runner', 'Compare Available Runner with Bench Runner']) {
        const action = find(preview, node => node.props['aria-label'] === label);
        assert.equal(action?.type, 'button'); assert.equal(action.props.type, 'button', 'Player details and comparison remain separate native actions');
    }
    assert.match(text(impact), /100\.0.*103\.0/); assert.match(text(impact), /\+3\.0lineup pts/);
    assert.equal((text(h.tree).match(/Preview/g) || []).length, 1, 'One preview cue covers the read-only comparison');
    for (const caption of ['Compare legal add / drop moves', 'Try on', 'One move at a time', 'gains are not additive', 'Improves the best legal lineup.']) assert(!text(h.tree).includes(caption), 'No redundant caption: ' + caption);
    assert(!text(preview).includes('Rest of season'), 'A positive alternate horizon does not add another collapsed caption');
    assert(!text(preview).includes('Availability requires platform confirmation.'));
    assert(!find(preview, node => node.props['aria-label'] === 'Planned maximum waiver bid'), 'Bid editing stays behind Review');
    h.click('Review claim'); preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    assert.equal(text(preview).split('Available Runner').length - 1, 1, 'Review does not repeat the incoming identity');
    assert.equal(text(preview).split('Bench Runner').length - 1, 1, 'Review does not repeat the outgoing identity');
    assert.match(text(preview), /Rest of season: \+10\.0 lineup pts/);
    assert(text(preview).includes('Availability requires platform confirmation.'));
    assert(find(preview, node => node.type === 'input' && node.props['aria-label'] === 'Planned maximum waiver bid'));
});

test('condensing preserves a negative alternate-horizon tradeoff and actionable primary projection failure', async () => {
    const h = harness(); await openWaivers(h, [candidate('add-a', 'Available Runner', 3, -8)]);
    const preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    assert.match(text(preview), /Rest of season: -8\.0 lineup pts/, 'Loss remains visible without opening review');
    const missing = harness(); await openWaivers(missing, [candidate('add-a', 'Available Runner', 3, 0, { season: { status: 'unavailable', before: null, after: null, delta: null, reason: 'ROS inputs are missing.' } })]);
    assert(!text(missing.tree).includes('ROS inputs are missing.'), 'An unused unavailable horizon adds no caption');
    missing.click('Season'); await missing.flush();
    assert.match(text(missing.tree), /Comparison unavailable/); assert.match(text(missing.tree), /ROS inputs are missing\./, 'The active horizon keeps its concrete missing-evidence reason');
});

test('compact dynasty trade keeps facts and actions without explanatory captions', async () => {
    const h = harness(); h.input.skin = { type: 'dynasty', features: { showTrades: true } }; h.render();
    const move = candidate('trade-a', 'Young Runner', -8.5, 0, { price: { delta: -100, unit: 'DHQ' },
        futureFit: { outgoingAverageAge: 32, incomingAge: 24, ageDifference: 8, label: 'Younger roster asset' },
        partner: { name: 'Northside', direction: { label: 'Competing profile', source: 'inferred', reason: 'Based on this roster’s production, not a declared GM strategy.' } },
        reason: 'Receive a younger asset while giving up immediate production.', cautions: ['You give up projected production now.'] });
    await openTrades(h, [move]); h.click('Future fit'); await h.flush();
    const impact = find(h.tree, node => node.props.className === 'wr-lens-impact');
    assert.match(text(impact), /32.*24/); assert.match(text(impact), /8years younger/); assert.equal(h.seasonCalls.length, 0);
    let preview = find(h.tree, node => node.props['data-lens-preview'] === 'trade-a');
    assert.match(text(preview), /Trade with Northside/); assert.match(text(preview), /-100 DHQ/);
    assert(!text(preview).includes('future performance is not forecast'));
    h.click('Review trade'); preview = find(h.tree, node => node.props['data-lens-preview'] === 'trade-a');
    assert(!text(preview).includes('future performance is not forecast'));
    assert(!text(preview).includes('You give up projected production now.'));
    assert(!text(preview).includes('not a declared GM strategy'));
    assert(!text(preview).includes('Model estimate;'));
    assert(!text(preview).includes('Competing profile'));
    assert.match(text(preview), /Open in Trade Builder/);
});

test('failed plan write is visible inline and never reported as a saved claim', async () => {
    const h = harness(); await openWaivers(h); h.click('Review claim'); h.saveFailure = true; h.click('Save claim plan');
    const preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    const review = find(preview, node => node.props.className === 'wr-lens-review');
    assert(review); assert.match(text(find(review, node => node.props.role === 'alert')), /could not be saved/);
    assert(!text(review).includes('Private claim plan saved'));
    h.lens.setBid('76'); h.render(); const count = h.writes.length; h.click('Save claim plan');
    assert.equal(h.writes.length, count, 'Over-budget values do not reach storage'); assert.match(text(h.tree), /\$0 to \$75/);
    h.input.league = { ...h.league, settings: { ...h.league.settings, waiver_budget: 0 } }; h.render(); await h.flush();
    assert(!find(h.tree, node => node.type === 'input' && node.props['aria-label'] === 'Planned maximum waiver bid'));
});

test('pending work cannot reactivate the lens after off, or leak into another account/league/season', async () => {
    const h = harness(); h.click('Waivers'); await h.flush(); const pending = h.calls[0];
    h.click('Lens off'); pending.resolve(ready(waiverCandidates())); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(h.lens.selected == null); assert.equal(h.calls.length, 1);
    await openWaivers(h); const priorLens = h.lens, priorMove = priorLens.selected;
    h.input.revision = 2; h.render(); await h.flush(); const late = h.calls.at(-1);
    h.viewer = 'second-owner'; h.input.league = { ...h.league, league_id: 'two', season: '2027' }; h.root.S.currentLeagueId = 'two';
    h.render(false);
    assert.equal(h.lens.mode, 'off'); assert.equal(h.lens.result, null); assert(h.lens.selected == null, 'Prior scope is hidden before effects commit');
    priorLens.openModule(priorMove); priorLens.savePlan(priorMove);
    assert.equal(h.acquisition.length, 0); assert.equal(h.writes.length, 0, 'Captured actions reject a changed account');
    h.render(); late.resolve(ready([candidate('late', 'Wrong League Player', 100, 500)])); await h.flush();
    assert.equal(h.lens.mode, 'off'); assert(!text(h.tree).includes('Wrong League Player'));
});

test('a changed roster revision hides earlier results and rejects captured actions before replacement data arrives', async () => {
    const h = harness(); await openWaivers(h); const prior = h.lens, move = prior.selected;
    h.input.roster = { ...h.roster, players: ['starter'] }; h.input.league = { ...h.league, rosters: [h.input.roster] };
    h.render(false); assert.equal(h.lens.loading, true); assert.equal(h.lens.options.length, 0); assert.equal(h.lens.selected, null);
    prior.openReview(move); prior.openModule(move); prior.savePlan(move);
    assert.equal(h.acquisition.length, 0); assert.equal(h.writes.length, 0);
    h.render(); await h.flush(); assert.equal(h.calls.length, 2);
});

test('each independent identity boundary hides old previews before effects and blocks old handoffs', async () => {
    const changes = {
        account: h => { h.viewer = 'new-account'; },
        platform: h => { h.root.S.platform = 'mfl'; },
        league: h => { h.input.league = { ...h.league, league_id: 'two' }; h.root.S.currentLeagueId = 'two'; },
        season: h => { h.input.league = { ...h.league, season: '2027' }; },
        roster: h => { h.input.roster = { ...h.roster, roster_id: 22 }; },
    };
    for (const [name, change] of Object.entries(changes)) {
        const h = harness(); await openWaivers(h); const prior = h.lens, move = prior.selected;
        change(h); h.render(false);
        assert.equal(h.lens.mode, 'off', name + ' boundary'); assert(h.lens.selected == null, name + ' hides selected move');
        prior.openModule(move); prior.savePlan(move);
        assert.equal(h.acquisition.length, 0, name + ' denies captured handoff'); assert.equal(h.writes.length, 0, name + ' denies captured save');
    }
});

test('redraft season work is lazy and its selected clone reaches both impact and inline row', async () => {
    const h = harness(); await openTrades(h);
    assert.equal(h.lens.selected.id, 'trade-a', 'Weekly trade ordering retains service strategy fit');
    assert.equal(h.seasonCalls.length, 0, 'Week-only trade browsing does no season simulation');
    h.click('Season'); await h.flush(); assert.equal(h.seasonCalls.length, 1);
    assert.equal(h.seasonCalls[0].options.candidateId, 'trade-a');
    assert.equal(h.seasonCalls[0].options.revision, h.calls[0].options.revision, 'Lazy model validation receives the same full data signature');
    assert.equal(h.lens.selected.id, 'trade-a'); assert.equal(h.lens.seasonLoading, true);
    h.seasonCalls[0].resolve({ season: { status: 'ready', before: 1000, after: 1042, delta: 42 } }); await h.flush();
    const row = find(h.tree, node => node.props.className === 'wr-lens-row');
    const impact = find(h.tree, node => node.props.className === 'wr-lens-impact');
    assert.match(text(row), /\+42\.0ROS pts/); assert(!text(row).includes('Load the full season'));
    assert.match(text(impact), /1,000\.0.*1,042\.0/); assert.equal(h.lens.selected.season.delta, 42);
    h.click('Next full week'); await h.flush(); h.click('Season'); await h.flush();
    assert.equal(h.seasonCalls.length, 1, 'Same scoped package reuses its season calculation');
});

test('late season result for a previous package cannot replace the newly selected package', async () => {
    const h = harness(); await openTrades(h); h.click('Season'); await h.flush();
    const first = h.seasonCalls[0];
    h.lens.choose(h.lens.options.find(move => move.id === 'trade-b')); h.render(); await h.flush();
    assert.equal(h.seasonCalls.length, 2); const second = h.seasonCalls[1];
    second.resolve({ season: { status: 'ready', before: 1000, after: 1060, delta: 60 } }); await h.flush();
    first.resolve({ season: { status: 'ready', before: 1000, after: 1999, delta: 999 } }); await h.flush();
    assert.equal(h.lens.selected.id, 'trade-b'); assert.equal(h.lens.selected.season.delta, 60);
    assert(!text(h.tree).includes('+999.0')); assert.match(text(h.tree), /\+60\.0ROS pts/);
});

test('trade handoff carries both sides and rejects changed-account or wrong active-league actions', async () => {
    const h = harness(); const incoming = tradeCandidates()[0]; incoming.outgoing.push({ pid: 'starter', name: 'Starter Receiver' });
    await openTrades(h, [incoming]); h.click('Review trade'); h.click('Open in Trade Builder');
    assert.equal(h.navigations.at(-1), 'trades'); assert.equal(h.events.at(-1).type, 'wr:open-trade-builder');
    assert.deepEqual(Array.from(h.events.at(-1).detail.givePlayerIds), ['bench', 'starter']); assert.deepEqual(Array.from(h.events.at(-1).detail.receivePlayerIds), ['trade-a']);
    assert.equal(h.events.at(-1).detail.returnTab, 'myteam');
    const prior = h.lens, count = h.events.length;
    h.viewer = 'someone-else'; prior.openModule(prior.selected); assert.equal(h.events.length, count);
    h.viewer = 'owner'; h.root.S.currentLeagueId = 'different'; prior.openModule(prior.selected); assert.equal(h.events.length, count);
    assert.equal(h.writes.length, 0);
});

test('tapping a waiver target compares the exact add/drop immediately without saving or opening Waivers', async () => {
    const h = harness(); await openWaivers(h);
    const before = JSON.stringify(h.roster), bid = h.lens.ui.bid;
    const target = h.click('Compare Available Runner with Bench Runner');
    assert.equal(target.props.type, 'button');
    assert.deepEqual(Array.from(h.comparisons[0].ids), ['bench', 'add-a']);
    assert.equal(h.comparisons[0].options.replace, true);
    assert.equal(h.comparisons[0].options.leagueId, 'one');
    assert.equal(h.comparisons[0].options.season, '2026');
    assert.equal(h.comparisons[0].options.accountKey, 'account:owner');
    assert.equal(h.lens.ui.review, false, 'No review disclosure is needed before comparing');
    assert.equal(h.acquisition.length, 0); assert.equal(h.writes.length, 0);
    assert.equal(h.lens.ui.bid, bid); assert.equal(JSON.stringify(h.roster), before);
    const captured = target.props.onClick;
    h.viewer = 'another-owner'; captured(); assert.equal(h.comparisons.length, 1, 'Captured target cannot cross an account boundary');
    h.viewer = 'owner'; h.root.S.currentLeagueId = 'different'; captured(); assert.equal(h.comparisons.length, 1);
});

test('an open-spot waiver target opens one player and stale point-basis targets cannot navigate', async () => {
    const h = harness(); await openWaivers(h, [candidate('add-a', 'Available Runner', 3, 10, { dropPid: null, anchorPlayerId: null, outgoing: [] })]);
    const target = h.click('Compare Available Runner');
    assert.deepEqual(Array.from(h.comparisons[0].ids), ['add-a'], 'Do not invent a drop for an open roster spot');
    const stale = target.props.onClick;
    h.change('Point comparison basis', 'average'); await h.flush(); stale();
    assert.equal(h.comparisons.length, 1, 'A previous-basis preview cannot open a current comparison');
});

test('tapping any incoming trade player opens the complete suggested calculator package directly', async () => {
    const h = harness(), move = tradeCandidates()[0];
    move.incoming.push({ pid: 'trade-other', name: 'Second Target', position: 'WR' });
    move.outgoing.push({ pid: 'starter', name: 'Starter Receiver' });
    await openTrades(h, [move]);
    const target = h.click('Open trade calculator for Second Target');
    assert.equal(h.navigations.at(-1), 'trades');
    assert.equal(h.events.at(-1).type, 'wr:open-trade-builder');
    assert.deepEqual(Array.from(h.events.at(-1).detail.receivePlayerIds), ['trade-a', 'trade-other']);
    assert.deepEqual(Array.from(h.events.at(-1).detail.givePlayerIds), ['bench', 'starter']);
    assert.equal(h.events.at(-1).detail.returnTab, 'myteam');
    assert.equal(h.lens.ui.review, false); assert.equal(h.writes.length, 0); assert.equal(h.comparisons.length, 0);
    const count = h.events.length;
    h.click('Lens off'); target.props.onClick(); assert.equal(h.events.length, count, 'An old incoming target is inert after the lens closes');
});

test('an unavailable compare entry reports an inline failure instead of silently opening a player card', async () => {
    const h = harness(); await openWaivers(h); delete h.root.wrComparePlayers;
    h.click('Compare Available Runner with Bench Runner');
    assert.match(text(find(h.tree, node => node.props.role === 'alert')), /Player comparison could not be opened/);
    assert.equal(h.writes.length, 0); assert.equal(h.acquisition.length, 0);
});

test('actual My Roster places review inside its player row and restores untouched filters/sort on lens off', async () => {
    const h = harness({ integrated: true });
    const beforeRoster = JSON.stringify(h.roster), beforeSort = JSON.stringify(h.props.rosterSort), beforeColumns = JSON.stringify(h.props.visibleCols);
    const controls = find(h.tree, node => node.props['aria-label'] === 'Roster acquisition lenses');
    const playerSection = find(h.tree, node => node.props.className === 'wr-roster-mobile-players');
    const flat = walk(h.tree); assert(flat.indexOf(controls) < flat.indexOf(playerSection));
    await openWaivers(h);
    const anchor = find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench');
    const trigger = find(anchor, node => node.props.className === 'wr-roster-mobile-player-trigger');
    const preview = find(anchor, node => node.props['data-lens-preview'] === 'add-a');
    assert(preview); assert.equal(all(h.tree, node => node.props['data-lens-preview'] === 'add-a').length, 1, 'One visible copy of the selected preview');
    assert(walk(anchor).indexOf(trigger) < walk(anchor).indexOf(preview));
    h.click('Review claim'); assert(find(find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench'), node => node.props.className === 'wr-lens-review'));
    assert(find(h.tree, node => node.type === 'details' && node.props.className === 'wr-lens-roster-settings'));
    h.props.rosterFilter = 'Starters'; h.render();
    assert(!find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench'));
    assert.equal(h.lens.selected.id, 'add-a', 'Filtering retains the chosen move without promoting it');
    assert(!find(h.tree, node => node.props['data-lens-preview'] === 'add-a'), 'A filtered owned source keeps its preview hidden');
    assert(!text(h.tree).includes('Available Runner'));
    h.props.rosterFilter = 'All'; h.render();
    const restored = find(h.tree, node => node.props['data-wr-roster-pid'] === 'bench');
    assert.equal(restored.props['data-wr-lens-state'], 'active');
    assert(find(restored, node => node.props['data-lens-preview'] === 'add-a'), 'Restoring the source restores its preview in place');
    assert(find(restored, node => node.props.className === 'wr-lens-review'), 'The existing review state survives a filter change');
    h.props.rosterFilter = 'Starters'; h.render();
    h.click('Lens off'); await h.flush();
    assert.equal(h.props.rosterFilter, 'Starters'); assert.equal(JSON.stringify(h.props.rosterSort), beforeSort); assert.equal(JSON.stringify(h.props.visibleCols), beforeColumns);
    assert.equal(JSON.stringify(h.roster), beforeRoster); assert(!find(h.tree, node => node.props.className === 'wr-lens-roster-settings'));
    assert(!find(h.tree, node => node.props['data-lens-preview'])); assert(!text(h.tree).includes('Starting lineup'), 'Roster lenses do not mount a second Game Day lineup workflow');
});

test('the active source row and leading outgoing identity follow the selected waiver move', async () => {
    const h = harness({ integrated: true }), original = JSON.stringify(h.roster);
    const next = candidate('new-receiver', 'Available Receiver', 2, 5, { anchorPlayerId: 'starter', dropPid: 'starter', outgoing: [{ pid: 'starter', name: 'Starter Receiver' }] });
    await openWaivers(h, [...waiverCandidates(), next]);
    const marked = () => all(h.tree, node => !!node.props['data-wr-lens-source']);
    const state = pid => find(h.tree, node => node.props['data-wr-roster-pid'] === pid)?.props['data-wr-lens-state'];
    assert.deepEqual(marked().map(node => node.props['data-wr-roster-pid']), ['bench']);
    assert.equal(state('bench'), 'active'); assert.equal(state('starter'), 'available');
    assert.equal(state('ir'), undefined, 'An unrelated roster player has no availability highlight');
    assert.equal(marked()[0].props['data-wr-lens-source'], 'waivers');
    assert.match(text(find(marked()[0], node => node.props.className === 'wr-roster-mobile-player-trigger')), /Bench Runner.*In lens/);
    let preview = find(h.tree, node => node.props['data-lens-preview'] === 'add-a');
    const source = find(preview, node => node.props.className === 'wr-lens-source');
    assert.match(text(source), /You dropBench Runner/);
    assert(walk(preview).indexOf(source) < walk(preview).findIndex(node => node?.props?.className === 'wr-lens-incoming'), 'Your player is named before the incoming player');
    assert.equal(text(preview).split('Bench Runner').length - 1, 1, 'The old muted lower outgoing caption is removed');
    assert.match(text(find(preview, node => node.props.className === 'wr-lens-target-label')), /You add/);
    const choices = find(h.tree, node => node.props['aria-label'] === 'Acquisition ideas for Bench Runner');
    assert(choices, 'Alternate selection names its owned source');
    h.lens.choose(next); h.render();
    assert.deepEqual(marked().map(node => node.props['data-wr-roster-pid']), ['starter']);
    assert.equal(state('starter'), 'active'); assert.equal(state('bench'), 'available', 'The previous selection returns to available');
    preview = find(h.tree, node => node.props['data-lens-preview'] === 'new-receiver');
    assert.match(text(find(preview, node => node.props.className === 'wr-lens-source')), /You dropStarter Receiver/);
    h.click('Close'); assert.equal(marked().length, 0);
    assert.equal(state('bench'), 'available'); assert.equal(state('starter'), 'available', 'Close leaves all current suggestions available');
    h.lens.choose(next); h.render(); h.change('Point comparison basis', 'average');
    assert.equal(marked().length, 0, 'Loading the next basis cannot retain the old source highlight');
    assert.equal(state('bench'), undefined); assert.equal(state('starter'), undefined, 'Loading hides stale availability too');
    h.click('Lens off'); assert.equal(marked().length, 0);
    assert.equal(state('bench'), undefined); assert.equal(state('starter'), undefined);
    assert.equal(JSON.stringify(h.roster), original); assert.equal(h.writes.length, 0);
});

test('filtered sources stay hidden while visible multi-player trade and open-slot previews state exactly what leaves the roster', async () => {
    const h = harness({ integrated: true }); await openWaivers(h);
    h.props.rosterFilter = 'Starters'; h.render();
    assert.equal(all(h.tree, node => !!node.props['data-wr-lens-source']).length, 0);
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(previewNodes(h).length, 0);
    assert(!text(h.tree).includes('Available Runner'), 'Filtering a known owned source does not create a standalone preview');
    const trade = harness({ integrated: true }), move = tradeCandidates()[0];
    move.outgoing.push({ pid: 'starter', name: 'Starter Receiver' });
    await openTrades(trade, [move]);
    assert.deepEqual(all(trade.tree, node => !!node.props['data-wr-lens-source']).map(node => node.props['data-wr-roster-pid']), ['bench'], 'Only the preview anchor receives the badge');
    let preview = find(trade.tree, node => node.props['data-lens-preview'] === 'trade-a');
    assert.match(text(find(preview, node => node.props.className === 'wr-lens-source')), /You sendBench Runner \+ Starter Receiver/);
    assert.equal(text(preview).split('Bench Runner').length - 1, 1); assert.equal(text(preview).split('Starter Receiver').length - 1, 1);
    assert.match(text(find(preview, node => node.props.className === 'wr-lens-target-label')), /You get/);
    trade.props.rosterFilter = 'Starters'; trade.render();
    assert.equal(trade.lens.selected.id, move.id); assert.equal(previewNodes(trade).length, 0);
    assert(!text(trade.tree).includes('Trade Target'), 'A visible secondary outgoing player does not promote the hidden source package');
    trade.props.rosterFilter = 'All'; trade.render();
    assert.equal(rosterPlayer(trade, 'bench').props['data-wr-lens-state'], 'active');
    assert(find(rosterPlayer(trade, 'bench'), node => node.props['data-lens-preview'] === move.id));
    const open = harness({ integrated: true });
    await openWaivers(open, [candidate('open-add', 'Open Spot Add', 2, 5, { anchorPlayerId: null, dropPid: null, outgoing: [] })]);
    preview = find(open.tree, node => node.props['data-lens-preview'] === 'open-add');
    assert.equal(preview.props['data-lens-state'], 'active', 'An open-slot selection is active without inventing a source row');
    assert.equal(text(find(preview, node => node.props.className === 'wr-lens-source')), 'Open roster spot');
    assert.equal(all(open.tree, node => !!node.props['data-wr-lens-source']).length, 0);
    assert(!text(preview).includes('You drop'), 'An open roster spot never invents an outgoing player');
});

test('changing point basis clears the old scenario until a newly optimized comparison arrives', async () => {
    const h = harness(), original = JSON.stringify(h.roster); await openWaivers(h);
    const prior = h.lens, move = prior.selected;
    assert.equal(h.lens.ui.basis, 'projected'); assert.equal(h.calls[0].options.basis, 'projected');
    const basis = find(h.tree, node => node.type === 'select' && node.props['aria-label'] === 'Point comparison basis');
    assert.deepEqual(all(basis, node => node.type === 'option').map(node => node.props.value), ['projected', 'average', 'idp-average']);
    h.change('Point comparison basis', 'average');
    assert.equal(h.lens.ui.basis, 'average'); assert.equal(h.lens.loading, true); assert(h.lens.selected == null); assert.equal(h.lens.options.length, 0);
    assert(!find(h.tree, node => node.props['data-lens-preview']));
    prior.savePlan(move); prior.openModule(move); assert.equal(h.writes.length, 0); assert.equal(h.acquisition.length, 0, 'Captured projected actions cannot operate under the average label');
    await h.flush(); assert.equal(h.calls[1].options.basis, 'average');
    const averaged = candidate('avg-a', 'Average Runner', 5, 0, { basis: 'average',
        incoming: [{ pid: 'avg-a', name: 'Average Runner', position: 'RB', team: 'CHI', projection: 12.5, comparisonBasis: 'average', averageGames: 4, averageSeason: '2026' }],
        outgoing: [{ pid: 'bench', name: 'Bench Runner', projection: 7.5, comparisonBasis: 'average' }],
        weekly: { status: 'ready', before: 70, after: 75, delta: 5 }, season: { status: 'unavailable', delta: null } });
    h.calls[1].resolve({ ...ready([averaged]), basis: 'average' }); await h.flush();
    assert.equal(h.lens.selected, null, 'New average results require another explicit open'); chooseMove(h, 'avg-a');
    const preview = find(h.tree, node => node.props['data-lens-preview'] === 'avg-a');
    const impact = find(h.tree, node => node.props.className === 'wr-lens-impact');
    assert.match(text(impact), /2026 avg lineup.*70\.0.*75\.0.*\+5\.0avg pts/);
    assert.match(text(preview), /Avg\s*12\.54 games/); assert(!text(preview).includes('Proj'));
    assert.match(text(preview), /Bench Runner.*Avg 7\.5/, 'Outgoing average stays explicit beside the incoming average, independent of roster projection columns');
    assert.equal(h.lens.selected.id, 'avg-a'); assert.equal(h.lens.ui.horizon, 'week');
    assert(!find(h.tree, node => node.props['aria-label'] === 'Acquisition projection horizon'));
    h.lens.setHorizon('season'); h.render(); await h.flush(); assert.equal(h.lens.ui.horizon, 'week'); assert.equal(h.seasonCalls.length, 0);
    assert.equal(JSON.stringify(h.roster), original);
});

test('a late projected result cannot be relabeled as averages or overwrite the average selection', async () => {
    const h = harness(); h.click('Waivers'); await h.flush(); const projected = h.calls[0];
    h.change('Point comparison basis', 'average'); await h.flush(); const averaged = h.calls[1];
    assert.equal(projected.options.basis, 'projected'); assert.equal(averaged.options.basis, 'average');
    const move = candidate('same-asset', 'Average Selection', 4, 0, { basis: 'average', incoming: [{ pid: 'same-asset', name: 'Average Selection', position: 'RB', projection: 10, comparisonBasis: 'average', averageGames: 5, averageSeason: '2026' }] });
    averaged.resolve({ ...ready([move]), basis: 'average' }); await h.flush(); chooseMove(h, move.id);
    projected.resolve(ready([candidate('same-asset', 'Late Projected Selection', 999, 999)])); await h.flush();
    assert.equal(h.lens.ui.basis, 'average'); assert.equal(h.lens.selected.weekly.delta, 4); assert.equal(h.lens.selected.incoming[0].name, 'Average Selection');
    assert(!text(h.tree).includes('Late Projected Selection')); assert(!text(h.tree).includes('+999.0'));
});

test('IDP average mode labels each asset source and keeps offensive projections distinct', async () => {
    const h = harness(); await openWaivers(h); h.change('Point comparison basis', 'idp-average'); await h.flush();
    assert.equal(h.calls.at(-1).options.basis, 'idp-average');
    const idp = candidate('idp-a', 'Tackle Leader', 3, 0, { basis: 'idp-average',
        incoming: [{ pid: 'idp-a', name: 'Tackle Leader', position: 'LB', projection: 0, comparisonBasis: 'average', averageGames: 5, averageSeason: '2026' }], season: { status: 'unavailable', delta: null } });
    const offense = candidate('offense-a', 'Offense Receiver', 2, 0, { basis: 'idp-average',
        incoming: [{ pid: 'offense-a', name: 'Offense Receiver', position: 'WR', projection: 12.3, comparisonBasis: 'projected' }], season: { status: 'unavailable', delta: null } });
    h.calls.at(-1).resolve({ ...ready([idp, offense]), basis: 'idp-average' }); await h.flush(); chooseMove(h, idp.id);
    assert.match(text(find(h.tree, node => node.props.className === 'wr-lens-impact')), /IDP avg \+ projections/);
    let preview = find(h.tree, node => node.props['data-lens-preview'] === 'idp-a');
    assert.match(text(preview), /LB/); assert.match(text(preview), /Avg\s*0\.05 games/, 'A measured zero remains visible with its observed-game count');
    h.lens.choose(h.lens.options.find(move => move.id === 'offense-a')); h.render();
    preview = find(h.tree, node => node.props['data-lens-preview'] === 'offense-a');
    assert.match(text(preview), /WR/); assert.match(text(preview), /Proj\s*12\.3/); assert(!text(preview).includes('Avg'));
    assert(!find(h.tree, node => node.props['aria-label'] === 'Acquisition projection horizon'));
});

test('average trade scenarios retain age-fit exploration and hand off the selected basis', async () => {
    const h = harness(), originalStrategy = JSON.stringify(h.gm);
    h.input.skin = { type: 'dynasty', features: { showTrades: true } }; h.render(); h.click('Trades'); await h.flush();
    const first = h.calls[0]; h.change('Point comparison basis', 'average'); await h.flush(); const next = h.calls[1];
    assert.equal(next.options.basis, 'average');
    const move = candidate('average-trade', 'Younger Defender', -4, 0, { basis: 'average',
        incoming: [{ pid: 'average-trade', name: 'Younger Defender', position: 'DB', projection: 8.5, comparisonBasis: 'average', averageGames: 6, averageSeason: '2026' }],
        futureFit: { outgoingAverageAge: 32, incomingAge: 24, ageDifference: 8 }, season: { status: 'unavailable', delta: null } });
    next.resolve({ ...ready([move]), basis: 'average', week: 7 }); await h.flush(); chooseMove(h, move.id); first.resolve(ready(tradeCandidates())); await h.flush();
    h.click('Future fit'); await h.flush();
    assert.equal(h.lens.ui.horizon, 'season'); assert.match(text(find(h.tree, node => node.props.className === 'wr-lens-impact')), /32.*24/);
    assert.equal(h.seasonCalls.length, 0, 'Age fit is not a fabricated average-based season simulation');
    h.click('Review trade'); h.click('Open in Trade Builder');
    assert.equal(h.events.at(-1).detail.basis, 'average'); assert.equal(h.events.at(-1).detail.candidateId, 'average-trade');
    assert.deepEqual(Array.from(h.events.at(-1).detail.receivePlayerIds), ['average-trade']); assert.equal(JSON.stringify(h.gm), originalStrategy);
    const old = h.lens, eventCount = h.events.length; h.change('Point comparison basis', 'idp-average');
    old.openModule(old.selected); assert.equal(h.events.length, eventCount, 'A prior-basis trade cannot open after switching the comparison');
});

const secondSourceMove = () => candidate('new-receiver', 'Available Receiver', 2.5, 5, {
    anchorPlayerId: 'starter', dropPid: 'starter',
    outgoing: [{ pid: 'starter', name: 'Starter Receiver', position: 'WR', projection: 8 }],
});
const rosterPlayer = (h, pid) => find(h.tree, node => node.props['data-wr-roster-pid'] === pid);
const rosterTrigger = (h, pid) => find(rosterPlayer(h, pid), node => node.props.className === 'wr-roster-mobile-player-trigger');
const previewNodes = h => all(h.tree, node => !!node.props['data-lens-preview']);
const activeSources = h => all(h.tree, node => !!node.props['data-wr-lens-source']);

for (const mode of ['waivers', 'trades']) test(mode + ' activation, opening, alternatives, switching and closing highlight players in their existing order and groups', async () => {
    const h = harness({ integrated: true, metrics: true });
    h.props.rosterSort = { key: 'age', dir: 1 }; h.render();
    const controls = () => find(h.tree, node => node.props['aria-label'] === 'Roster acquisition lenses');
    const playerOrder = () => all(h.tree, node => !!node.props['data-wr-roster-pid']).map(node => node.props['data-wr-roster-pid']);
    const groupHeadings = () => all(h.tree, node => node.props.className === 'wr-roster-mobile-group-heading').map(text);
    const beforeOrder = playerOrder(), beforeGroups = groupHeadings(), beforeFilter = h.props.rosterFilter, beforeSort = JSON.stringify(h.props.rosterSort);
    const assertRosterStable = () => {
        assert.deepEqual(playerOrder(), beforeOrder, 'Activating or choosing a lens move never reorders the original roster rows');
        assert.deepEqual(groupHeadings(), beforeGroups, 'Lens highlights stay in the original roster groups');
        assert.equal(h.props.rosterFilter, beforeFilter); assert.equal(JSON.stringify(h.props.rosterSort), beforeSort);
    };
    const moves = [...(mode === 'waivers' ? waiverCandidates() : tradeCandidates()), secondSourceMove()];
    await (mode === 'waivers' ? loadWaivers(h, moves) : loadTrades(h, moves));
    assertRosterStable();
    const controlShape = () => all(controls(), node => node.type !== 'fragment').map(node => [node.type,
        node.props.className || '', node.props['aria-label'] || '', node.props.value ?? '', node.props['aria-pressed'] ?? '', node.props.role || '']);
    const beforeShape = controlShape(), beforeText = text(controls());
    const assertStable = () => {
        assertRosterStable();
        assert.deepEqual(controlShape(), beforeShape, 'Choosing a move inserts no new controls above the roster');
        assert.equal(text(controls()), beforeText, 'The top controls keep the same visible text');
        assert(!find(controls(), node => node.props.className === 'wr-lens-impact'));
        assert(!find(controls(), node => !!node.props['data-lens-preview']), 'A visible source owns its preview rather than adding it above the list');
    };
    h.click('Preview move for Bench Runner'); assertStable();
    const preview = previewNodes(h)[0];
    assert.equal(previewNodes(h).length, 1); assert(find(rosterPlayer(h, 'bench'), node => node === preview));
    assert(find(preview, node => node.props.className === 'wr-lens-impact'), 'The selected card retains its comparison evidence');
    if (mode === 'waivers') h.change('Acquisition ideas for Bench Runner', moves[1].id);
    else {
        const alternate = find(h.tree, node => node.type === 'button' && node.props['data-lens-peek'] === moves[1].id);
        assert(alternate); alternate.props.onClick(); h.render();
    }
    assert.equal(h.lens.selected.id, moves[1].id); assertStable();
    h.click('Preview move for Starter Receiver'); assert.equal(h.lens.selected.id, 'new-receiver'); assertStable();
    h.click('Close'); assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0); assertStable();
    h.click('Preview move for Bench Runner'); h.click('Collapse move for Bench Runner');
    assert.equal(h.lens.selected, null); assertStable();
    h.click('Lens off'); assertRosterStable();
    assert.equal(h.writes.length, 0); assert.equal(h.comparisons.length, 0); assert.equal(h.events.length, 0);
});

test('the metric sorting header stays above the original position groups as lenses highlight players in place', async () => {
    const h = harness({ integrated: true, metrics: true });
    const playerList = () => find(h.tree, node => node.props['aria-label'] === 'Roster players');
    const sortHeaders = () => all(playerList(), node => String(node.props.className || '').split(/\s+/).includes('wr-roster-sort-header'));
    const groups = () => all(playerList(), node => node.props.className === 'wr-roster-mobile-player-group');
    const headerFirst = () => {
        assert.equal(sortHeaders().length, 1);
        assert(walk(playerList()).indexOf(sortHeaders()[0]) < walk(playerList()).indexOf(groups()[0]), 'The stat header remains above the unchanged roster groups');
    };
    headerFirst();
    const originalLabels = all(sortHeaders()[0], node => node.props.className === 'mc-sort-label').map(text);
    const originalGroups = groups().map(group => text(find(group, node => node.props.className === 'wr-roster-mobile-group-heading')));
    await loadWaivers(h, [...waiverCandidates(), secondSourceMove()]);
    headerFirst();
    assert.deepEqual(groups().map(group => text(find(group, node => node.props.className === 'wr-roster-mobile-group-heading'))), originalGroups, 'No synthetic Suggestions section replaces the position groups');
    assert.deepEqual(all(sortHeaders()[0], node => node.props.className === 'mc-sort-label').map(text), originalLabels, 'Lens activation preserves the current league metric labels');
    assert.equal(all(sortHeaders()[0], node => node.type === 'button').length, 4, 'All four stat sort actions remain available');
    const orderPicker = find(sortHeaders()[0], node => node.type === 'select' && node.props['aria-label'] === 'Roster order');
    assert(orderPicker, 'The original player-header space exposes roster ordering without adding a row');
    assert.deepEqual(all(orderPicker, node => node.type === 'option').slice(0, 3).map(node => node.props.value), ['sleeper', 'name', 'pos'], 'Sleeper, Player and Position sorting stay reachable while a lens is active');
    h.click('Preview move for Bench Runner'); headerFirst();
    h.click('Close'); headerFirst();
    h.click('Lens off'); headerFirst();
});

test('yellow player bars replace stats with the gain while open and neutral players retain their four stat columns', async () => {
    const h = harness({ integrated: true, metrics: true }), moves = [...waiverCandidates(), secondSourceMove()];
    const metricCells = metric => all(metric, node => node.type === 'span' && !!node.props.title)
        .map(cell => ({ value: text(find(cell, node => node.type === 'strong')), label: text(find(cell, node => node.type === 'small')) }));
    const originalMetrics = new Map(Object.keys(h.players).map(pid => [pid, metricCells(find(rosterTrigger(h, pid), node => node.props.className === 'mc-roster-metrics'))]));
    const assertOriginalMetrics = pid => {
        const trigger = rosterTrigger(h, pid), metric = find(trigger, node => node.props.className === 'mc-roster-metrics');
        assert(metric); assert(trigger.children.includes(metric), 'The metric group remains a direct player-bar child');
        assert.equal(metricCells(metric).length, 4, 'All four selected stat columns remain visible');
        assert.deepEqual(metricCells(metric), originalMetrics.get(pid), 'Player stats keep their original values and labels');
        assert(!find(trigger, node => node.props.className === 'wr-lens-bar-gain'), 'The gain replaces stats only for a closed suggested source');
    };
    for (const pid of Object.keys(h.players)) assertOriginalMetrics(pid);
    await loadWaivers(h, moves);
    assert.equal(h.lens.selected, null, 'Receiving recommendations never opens the first candidate');
    assert.equal(activeSources(h).length, 0); assert.equal(previewNodes(h).length, 0);
    for (const [pid, name, gain] of [['bench', 'Bench Runner', '+3.0'], ['starter', 'Starter Receiver', '+2.5']]) {
        const row = rosterPlayer(h, pid), trigger = rosterTrigger(h, pid);
        assert.equal(row.props['data-wr-lens-state'], 'available', 'The entire source row has the yellow availability state');
        assert.equal(trigger.type, 'button'); assert.equal(trigger.props.type, 'button', 'The entire player bar stays one native activation target');
        assert.equal(trigger.props['aria-label'], 'Preview move for ' + name); assert.equal(trigger.props['aria-expanded'], false);
        assert.equal(trigger.props['data-wr-lens-gain'], '1');
        const summary = find(trigger, node => node.props.className === 'wr-lens-bar-gain');
        assert(summary, 'Potential gain is visible inside the owned player bar');
        assert(text(summary).includes('Potential gain')); assert(text(summary).includes(gain));
        assert(!find(trigger, node => node.props.className === 'mc-roster-metrics'), 'The closed source shows its gain instead of four stat columns');
        assert(!find(trigger, node => node.props.className === 'wr-roster-mobile-player-value'), 'The legacy single stat is replaced too');
        assert.equal(all(trigger, node => node.type === 'button').length, 1, 'The inline gain does not create a nested button');
        assert(!find(row, node => node.props.className === 'wr-lens-row'), 'A collapsed bar has no separate lower lens row');
        assert(!find(row, node => node.props.className === 'wr-lens-peek'), 'Potential gain does not add another lower launcher');
        assert(!find(row, node => node.props.className === 'wr-lens-actions'));
        assert(!find(row, node => node.props['aria-label'] === 'Acquisition ideas for ' + name), 'A collapsed source has no replacement menu');
    }
    for (const move of moves) for (const asset of move.incoming) {
        assert(!text(h.tree).includes(asset.name), 'Replacement names are absent until their source opens: ' + asset.name);
    }
    assert(!find(h.tree, node => node.props.className === 'wr-lens-impact'), 'A closed lens does not show a comparison headline');
    for (const pid of ['ir', 'taxi']) assertOriginalMetrics(pid);
    h.click('Preview move for Bench Runner');
    assertOriginalMetrics('bench');
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'active');
    assert(!find(rosterTrigger(h, 'starter'), node => node.props.className === 'mc-roster-metrics'));
    h.click('Preview move for Starter Receiver');
    assertOriginalMetrics('starter');
    assert(!find(rosterTrigger(h, 'bench'), node => node.props.className === 'mc-roster-metrics'), 'The previous source returns to gain-only when another move opens');
    h.click('Lens off');
    for (const pid of Object.keys(h.players)) assertOriginalMetrics(pid);
    assert.equal(h.writes.length, 0); assert.equal(h.comparisons.length, 0); assert.equal(h.events.length, 0);
});

test('native source buttons open one move, switch the green source, and collapse without exposing previous alternatives', async () => {
    const h = harness({ integrated: true }); await loadWaivers(h, [...waiverCandidates(), secondSourceMove()]);
    const beforeRoster = JSON.stringify(h.roster), beforeSort = JSON.stringify(h.props.rosterSort);
    h.click('Preview move for Bench Runner');
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(h.lens.ui.bid, '7', 'The saved maximum belongs to the explicitly opened move');
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'active');
    assert.equal(rosterTrigger(h, 'bench').props['aria-label'], 'Collapse move for Bench Runner');
    assert.equal(rosterTrigger(h, 'bench').props['aria-expanded'], true);
    assert.equal(previewNodes(h).length, 1); assert(text(h.tree).includes('Available Runner'));
    assert(find(h.tree, node => node.props['aria-label'] === 'Acquisition ideas for Bench Runner'), 'Only the open source exposes its alternatives');
    for (const name of ['Other Runner', 'Third Runner', 'Available Receiver']) assert(!text(h.tree).includes(name), 'Unselected replacement names stay hidden even beside an open preview: ' + name);
    h.click('Preview move for Starter Receiver');
    assert.equal(h.lens.selected.id, 'new-receiver');
    assert.deepEqual(activeSources(h).map(node => node.props['data-wr-roster-pid']), ['starter']);
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
    assert.equal(rosterTrigger(h, 'bench').props['aria-expanded'], false);
    for (const name of ['Available Runner', 'Other Runner', 'Third Runner']) assert(!text(h.tree).includes(name), 'Previous replacement detail is fully closed: ' + name);
    assert(!find(h.tree, node => node.props['aria-label'] === 'Acquisition ideas for Bench Runner'));
    assert.equal(previewNodes(h).length, 1); assert(text(h.tree).includes('Available Receiver'));
    h.click('Collapse move for Starter Receiver');
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0); assert.equal(activeSources(h).length, 0);
    assert.equal(rosterPlayer(h, 'starter').props['data-wr-lens-state'], 'available');
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
    assert(!text(h.tree).includes('Available Receiver'));
    assert.equal(JSON.stringify(h.roster), beforeRoster); assert.equal(JSON.stringify(h.props.rosterSort), beforeSort);
    assert.equal(h.writes.length, 0);
});

test('owned dossier and incoming compare actions remain separate from source collapse and switching closes the old dossier', async () => {
    const h = harness({ integrated: true }); await loadWaivers(h, [...waiverCandidates(), secondSourceMove()]);
    h.click('Preview move for Bench Runner');
    const owned = find(h.tree, node => node.props['aria-label'] === 'Open player details for Bench Runner');
    assert.equal(owned.type, 'button'); assert.equal(owned.props.type, 'button');
    let stops = 0; owned.props.onClick({ stopPropagation: () => { stops++; } }); h.render();
    assert.equal(stops, 1); assert.equal(h.props.expandedPid, 'bench');
    assert(find(h.tree, node => node.props.id === 'roster-detail-bench'), 'The original roster dossier is still reachable');
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'active');
    const incoming = find(h.tree, node => node.props['aria-label'] === 'Compare Available Runner with Bench Runner');
    incoming.props.onClick({ stopPropagation: () => { stops++; } }); h.render();
    assert.equal(stops, 2); assert.deepEqual(Array.from(h.comparisons[0].ids), ['bench', 'add-a']);
    assert.equal(h.lens.selected.id, 'add-a'); assert.equal(h.props.expandedPid, 'bench', 'The incoming action does not toggle the owned dossier or source');
    h.click('Preview move for Starter Receiver');
    assert.equal(h.props.expandedPid, null); assert(!find(h.tree, node => node.props.id === 'roster-detail-bench'));
    assert.equal(h.lens.selected.id, 'new-receiver'); assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
    assert.equal(h.writes.length, 0);
});

test('the selected trade source keeps its owned dossier and full calculator package as distinct native actions', async () => {
    const h = harness({ integrated: true }), move = tradeCandidates()[0];
    move.outgoing.push({ pid: 'starter', name: 'Starter Receiver' });
    await loadTrades(h, [move]);
    assert.equal(h.lens.selected, null); assert(!text(h.tree).includes('Trade Target'));
    h.click('Preview move for Bench Runner'); h.click('Open player details for Bench Runner');
    assert.equal(h.props.expandedPid, 'bench'); assert.equal(h.lens.selected.id, move.id);
    h.click('Open trade calculator for Trade Target');
    assert.equal(h.lens.selected.id, move.id); assert.equal(h.props.expandedPid, 'bench');
    assert.deepEqual(Array.from(h.events.at(-1).detail.givePlayerIds), ['bench', 'starter']);
    assert.deepEqual(Array.from(h.events.at(-1).detail.receivePlayerIds), ['trade-a']);
    assert.equal(h.navigations.at(-1), 'trades'); assert.equal(h.writes.length, 0);
    h.click('Close'); assert.equal(h.lens.selected, null); assert.equal(h.props.expandedPid, null);
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
});

test('an open roster spot is an owned-context fallback and reveals its incoming player only after an explicit click', async () => {
    const h = harness({ integrated: true }), move = candidate('open-add', 'Open Spot Add', 2, 5, { anchorPlayerId: null, dropPid: null, outgoing: [] });
    await loadWaivers(h, [move]);
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0); assert(!text(h.tree).includes('Open Spot Add'));
    const fallback = find(h.tree, node => node.props['data-lens-peek'] === move.id);
    assert.equal(fallback.type, 'button'); assert.equal(fallback.props.type, 'button');
    assert.equal(fallback.props['aria-label'], 'Preview move for Open roster spot'); assert.match(text(fallback), /Open roster spot.*\+2\.0/);
    h.click('Preview move for Open roster spot');
    assert.equal(h.lens.selected.id, move.id); assert(text(h.tree).includes('Open Spot Add')); assert.equal(previewNodes(h).length, 1);
    assert.equal(activeSources(h).length, 0, 'An open roster spot does not invent an owned source');
    h.click('Compare Open Spot Add'); assert.deepEqual(Array.from(h.comparisons[0].ids), ['open-add']);
    h.click('Close'); assert.equal(previewNodes(h).length, 0); assert(!text(h.tree).includes('Open Spot Add'));
    assert(find(h.tree, node => node.props['aria-label'] === 'Preview move for Open roster spot'));
});

test('an unresolved source retains its explicit fallback without inventing a visible owned row', async () => {
    const h = harness({ integrated: true }), move = candidate('unresolved-add', 'Unresolved Source Target', 2, 5, {
        anchorPlayerId: 'unresolved-source', dropPid: 'unresolved-source', outgoing: [{ pid: 'unresolved-source', name: 'Unresolved Source' }],
    });
    await loadWaivers(h, [move]);
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0); assert(!text(h.tree).includes('Unresolved Source Target'));
    const fallback = find(h.tree, node => node.props['data-lens-peek'] === move.id);
    assert.equal(fallback?.type, 'button'); assert.equal(fallback.props['aria-label'], 'Preview move for Unresolved Source');
    h.click('Preview move for Unresolved Source');
    assert.equal(h.lens.selected.id, move.id); assert.equal(previewNodes(h).length, 1);
    assert.equal(activeSources(h).length, 0, 'An unresolved source does not mark an unrelated roster player');
    assert.match(text(find(previewNodes(h)[0], node => node.props.className === 'wr-lens-source')), /You dropUnresolved Source/);
    h.click('Close'); assert.equal(previewNodes(h).length, 0); assert(!text(h.tree).includes('Unresolved Source Target'));
    assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
});

test('owned-source recommendations obey roster filters and search without becoming top-of-list fallbacks', async () => {
    const h = harness({ integrated: true }); h.props.rosterFilter = 'Starters'; h.render(); await loadWaivers(h, [waiverCandidates()[0]]);
    assert(!rosterPlayer(h, 'bench')); assert.equal(h.lens.selected, null); assert(!text(h.tree).includes('Available Runner'));
    assert(!find(h.tree, node => node.props['data-lens-peek'] === 'add-a'), 'A known owned source gets no fallback outside its filtered row');
    assert(!find(h.tree, node => node.props['aria-label'] === 'Preview move for Bench Runner'));
    assert.equal(previewNodes(h).length, 0);
    h.props.rosterFilter = 'All'; h.render();
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
    assert.equal(h.lens.selected, null); assert(!text(h.tree).includes('Available Runner'), 'Restoring the row still requires an explicit open');
    h.click('Preview move for Bench Runner');
    assert(find(rosterPlayer(h, 'bench'), node => node.props['data-lens-preview'] === 'add-a'));
    h.change('Search your roster', 'Starter Receiver');
    assert(!rosterPlayer(h, 'bench')); assert.equal(h.lens.selected.id, 'add-a'); assert.equal(previewNodes(h).length, 0);
    assert(!text(h.tree).includes('Available Runner')); assert(!find(h.tree, node => node.props['data-lens-peek'] === 'add-a'));
    h.change('Search your roster', '');
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'active');
    assert(find(rosterPlayer(h, 'bench'), node => node.props['data-lens-preview'] === 'add-a'));
    assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
});

test('point-basis reload and lens re-entry return suggestions to closed yellow rows without auto-selection', async () => {
    const h = harness({ integrated: true }), moves = [...waiverCandidates(), secondSourceMove()]; await loadWaivers(h, moves);
    h.click('Preview move for Bench Runner'); h.change('Point comparison basis', 'average');
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0); assert.equal(h.lens.loading, true);
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], undefined, 'Old available highlights are hidden during a new-basis read');
    await h.flush(); h.calls.at(-1).resolve({ ...ready(moves), basis: 'average' }); await h.flush();
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0);
    assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'available');
    assert.equal(rosterPlayer(h, 'starter').props['data-wr-lens-state'], 'available');
    assert(!text(h.tree).includes('Available Runner')); assert(!text(h.tree).includes('Available Receiver'));
    h.click('Preview move for Starter Receiver'); h.click('Lens off');
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0);
    await loadWaivers(h, moves);
    assert.equal(h.lens.selected, null); assert.equal(rosterPlayer(h, 'starter').props['data-wr-lens-state'], 'available');
    assert(!text(h.tree).includes('Available Receiver')); assert.equal(h.writes.length, 0);
});

test('season trade analysis does no work before a source opens and a closed source stays closed after a late result', async () => {
    const h = harness(); await loadTrades(h, [tradeCandidates()[0]]);
    assert.equal(h.lens.selected, null); assert.equal(h.seasonCalls.length, 0);
    h.click('Season'); await h.flush();
    assert.equal(h.lens.selected, null); assert.equal(h.seasonCalls.length, 0, 'Changing the horizon alone cannot select or simulate a move');
    assert(!text(h.tree).includes('Trade Target')); assert(!text(h.tree).includes('Other Trade Target'));
    h.click('Preview move for Bench Runner'); await h.flush();
    assert.equal(h.lens.selected.id, 'trade-a'); assert.equal(h.seasonCalls.length, 1);
    const pending = h.seasonCalls[0]; h.click('Close'); await h.flush();
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0);
    pending.resolve({ season: { status: 'ready', before: 1000, after: 1999, delta: 999 } }); await h.flush();
    assert.equal(h.lens.selected, null); assert.equal(previewNodes(h).length, 0);
    assert(!text(h.tree).includes('Trade Target')); assert(!text(h.tree).includes('+999.0'));
});

test('a same-source alternate exposes only its gain until clicked and closes the previous owned dossier', async () => {
    const h = harness({ integrated: true }); await loadTrades(h);
    h.click('Preview move for Bench Runner'); h.click('Open player details for Bench Runner');
    assert.equal(h.lens.selected.id, 'trade-a'); assert.equal(h.props.expandedPid, 'bench');
    assert(!text(h.tree).includes('Other Trade Target'), 'The unopened alternate does not reveal its incoming player');
    const alternate = find(h.tree, node => node.props['data-lens-peek'] === 'trade-b');
    assert.equal(alternate.type, 'button'); assert.equal(alternate.props.type, 'button');
    assert.match(text(alternate), /Other move.*\+12\.0/); assert(!text(alternate).includes('Other Trade Target'));
    alternate.props.onClick(); h.render();
    assert.equal(h.lens.selected.id, 'trade-b'); assert.equal(h.props.expandedPid, null);
    assert.equal(previewNodes(h).length, 1); assert.equal(rosterPlayer(h, 'bench').props['data-wr-lens-state'], 'active');
    assert(find(h.tree, node => node.props['aria-label'] === 'Open trade calculator for Other Trade Target'));
    assert(!find(h.tree, node => node.props['aria-label'] === 'Open trade calculator for Trade Target'));
    h.click('Close');
    assert.equal(previewNodes(h).length, 0); assert(!text(h.tree).includes('Other Trade Target'));
});
