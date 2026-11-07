'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const root = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('ok ' + name); }
function harness(files, phone = true, extra = {}) {
    const slots = []; let cursor = 0;
    const effects = [];
    const React = {
        Fragment: 'fragment',
        createElement(type, props, ...children) { return typeof type === 'function' ? type({ ...props, children }) : { type, props: props || {}, children }; },
        useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }), useEffect: fn => { effects.push(fn); },
    };
    const ctx = vm.createContext({ React, console, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: fn => fn(),
        document: { activeElement: null, querySelector: () => null, getElementById: () => ({}) }, navigator: {},
        location: { search: '', hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} },
        matchMedia: () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }), scrollTo() {}, App: {}, S: {}, ...extra });
    ctx.window = ctx;
    files.forEach(file => vm.runInContext(Babel.transform(fs.readFileSync(path.join(root, file), 'utf8'), { presets: ['react'] }).code, ctx, { filename: file }));
    return { ctx, slots, effects, render: (fn, props) => { cursor = 0; effects.length = 0; return ctx[fn](props); } };
}
function all(tree, pred) { const out = []; const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { if (pred(n)) out.push(n); walk(n.children); } }; walk(tree); return out; }
function text(n) { return n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : typeof n === 'object' ? text(n.children) : String(n); }
function byClass(tree, name) { return all(tree, n => n.props.className?.split(' ').includes(name)); }
function button(tree, name) { const found = all(tree, n => n.type === 'button' && text(n) === name)[0]; assert.ok(found, 'Missing button: ' + name); return found; }
function click(tree, name) { button(tree, name).props.onClick(); }
function nav(tree, label) { return all(tree, n => n.type === 'nav' && n.props['aria-label'] === label)[0]; }

const players = Object.fromEntries(Array.from({ length: 35 }, (_, i) => ['p' + i, { first_name: 'Player', last_name: String(i).padStart(2, '0'), position: 'WR', age: 25 }]));
const empireProps = { allLeagues: [{ id: 'L1', name: 'A long league name', settings: { type: 2, draft_rounds: 2 }, rosters: [{ roster_id: 1, owner_id: 'me', players: Object.keys(players), settings: { wins: 2, losses: 1 } }] }], playersData: players, sleeperUserId: 'me', onBack() {}, onEnterLeague() {} };
test('Empire asset destinations mount only their selected content and announce selection', () => {
    const h = harness(['js/tabs/global-view.js']);
    let tree = h.render('EmpireDashboard', empireProps); click(nav(tree, 'Empire workspaces'), 'Assets');
    tree = h.render('EmpireDashboard', empireProps);
    assert.equal(button(nav(tree, 'Assets views'), 'Allocation').props['aria-current'], 'page');
    assert.equal(byClass(tree, 'empire-main-grid').length, 1); assert.equal(byClass(tree, 'empire-floor').length, 0); assert.equal(byClass(tree, 'empire-workspace').length, 0);
    click(nav(tree, 'Assets views'), 'Players & picks'); tree = h.render('EmpireDashboard', empireProps);
    assert.equal(button(nav(tree, 'Assets views'), 'Players & picks').props['aria-current'], 'page');
    assert.equal(byClass(tree, 'empire-main-grid').length, 0); assert.equal(byClass(tree, 'empire-floor').length, 0);
    assert.equal(byClass(tree, 'empire-asset-row').length, 24);
    click(tree, 'Show more players · 11 remaining'); tree = h.render('EmpireDashboard', empireProps);
    assert.equal(byClass(tree, 'empire-asset-row').length, 35);
    all(tree, n => n.type === 'input' && n.props.type === 'search')[0].props.onChange({ target: { value: 'Player 34' } });
    tree = h.render('EmpireDashboard', empireProps); assert.equal(byClass(tree, 'empire-asset-row').length, 1); assert.match(text(byClass(tree, 'empire-asset-row')[0]), /Player 34.*A long league name/);
    click(nav(tree, 'Assets views'), 'Exposure'); tree = h.render('EmpireDashboard', empireProps);
    assert.equal(byClass(tree, 'empire-floor').length, 1); assert.equal(byClass(tree, 'empire-workspace').length, 0);
    assert.equal(button(nav(tree, 'Assets views'), 'Exposure').props['aria-current'], 'page');
});
test('Empire filters keep league scope and expose filtered asset rows', () => {
    const h = harness(['js/tabs/global-view.js']);
    let tree = h.render('EmpireDashboard', empireProps); click(nav(tree, 'Empire workspaces'), 'Leagues'); tree = h.render('EmpireDashboard', empireProps);
    click(tree, 'All'); tree = h.render('EmpireDashboard', empireProps); assert.equal(byClass(tree, 'empire-shell')[0].props['data-workspace'], 'leagues');
    click(nav(tree, 'Empire workspaces'), 'Assets'); tree = h.render('EmpireDashboard', empireProps);
    byClass(tree, 'empire-filter-toggle')[0].props.onClick(); tree = h.render('EmpireDashboard', empireProps); click(tree, 'WR'); tree = h.render('EmpireDashboard', empireProps);
    assert.equal(button(nav(tree, 'Assets views'), 'Players & picks').props['aria-current'], 'page'); assert.equal(byClass(tree, 'empire-asset-row').length, 24);
});
test('Empire empty account returns to league connection instead of resetting nonexistent filters', () => {
    const h = harness(['js/tabs/global-view.js']); let returned = 0;
    const tree = h.render('EmpireDashboard', { ...empireProps, allLeagues: [], onBack: () => returned++ });
    assert.match(text(tree), /Your portfolio starts with a league/); assert.doesNotMatch(text(tree), /current lens removes/);
    click(tree, 'Connect a league in the hub'); assert.equal(returned, 1);
    assert.equal(all(tree, n => n.props['data-testid'] === 'empire-command-strip')[0].props.hidden, true);
});
test('mobile People searches all members and preserves personal evidence inside details', () => {
    const h = harness(['js/components/commish-people-panel.js']);
    const people = Array.from({ length: 12 }, (_, i) => ({ userId: 'u' + i, name: 'Person ' + i, status: i === 11 ? 'ACTIVE' : 'DARK_ALL', checkin: 'Check-in ' + i, teams: [{ leagueId: 'L', rosterId: i, leagueName: 'League ' + i, status: 'DARK', signals: { daysSinceTxn: 30 } }] }));
    const props = { phone: true, radar: { people }, seats: [], folders: [] };
    let tree = h.render('WrCommishPeoplePanel', props); assert.equal(byClass(tree, 'co-person').length, 8);
    const person = byClass(tree, 'co-person')[0]; assert.equal(person.type, 'details'); assert.ok(!person.props.open); assert.match(text(person), /League 0.*30d since last move.*Check-in 0/);
    click(tree, 'Show more people · 3 remaining'); tree = h.render('WrCommishPeoplePanel', props); assert.equal(byClass(tree, 'co-person').length, 11);
    click(tree, 'All people (12)'); tree = h.render('WrCommishPeoplePanel', props);
    all(tree, n => n.type === 'input')[0].props.onChange({ target: { value: 'League 11' } });
    tree = h.render('WrCommishPeoplePanel', props); assert.equal(byClass(tree, 'co-person').length, 1); assert.match(text(byClass(tree, 'co-person')[0]), /Person 11/); assert.doesNotMatch(text(byClass(tree, 'co-person')[0]), /Check-in 11/);
    click(tree, 'Open seats (0)'); tree = h.render('WrCommishPeoplePanel', props); assert.equal(byClass(tree, 'co-person').length, 0); assert.match(text(tree), /Every seat is filled/);
});
test('mobile Rule Lab keeps replay impact before optional scoring without losing callbacks', () => {
    const h = harness(['js/components/commish-rulelab-panel.js']); let selected; let analyzed = 0; let staged;
    const props = { phone: true, status: 'empty', leagues: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], selectedLeagueId: 'a', onSelectLeague: id => selected = id,
        baselineScoring: { rec: 0.5 }, editorKeys: ['rec'], proposal: { rec: 1 }, hasUnanalyzedChanges: true, onAnalyze: () => analyzed++, onProposalStage: p => staged = p };
    const tree = h.render('WrCommishRuleLabPanel', props);
    const impact = byClass(tree, 'co-rulelab-impact')[0];
    const optionalScoring = all(tree, n => n.type === 'details' && all(n, child => child.type === 'summary' && text(child).startsWith('All scoring rules')).length > 0)[0];
    assert.match(text(impact), /No completed weeks/);
    assert.ok(optionalScoring && !optionalScoring.props.open, 'Optional scoring rules stay collapsed on the phone');
    const order = all(tree, () => true);
    assert.ok(order.indexOf(impact) < order.indexOf(optionalScoring), 'Replay impact appears before optional scoring controls');
    assert.equal(byClass(tree, 'co-scoring-category')[0].type, 'details'); assert.ok(!byClass(tree, 'co-scoring-category')[0].props.open);
    const selector = byClass(tree, 'co-scope-select')[0]; all(selector, n => n.type === 'select')[0].props.onChange({ target: { value: 'b' } }); assert.equal(selected, 'b');
    click(tree, 'Preview changes'); assert.equal(analyzed, 1);
    const reception = all(tree, n => n.type === 'label' && text(n) === 'Reception (PPR)')[0];
    assert.ok(reception); all(reception, n => n.type === 'input')[0].props.onChange({ target: { value: '1.5' } }); assert.equal(staged.rec, 1.5);
});
test('Wire keeps coverage collapsed and preserves lead stories, provenance, league filters and search', () => {
    const leagues = [0, 1].map(i => ({ id: 'L' + i, name: 'League ' + i, season: 2026 }));
    const stories = [0, 1].map(i => ({ id: i, league: leagues[i], label: 'Record', text: 'Headline ' + i, body: 'Story body', sources: [{ workbook: 'Archive', sheet: 'Scores', range: 'A1:C4' }] }));
    // Match the browser's dependency order. This fixture does not run loading
    // effects; only portfolio selection stays stubbed while reading is real.
    const setup = phone => harness(['js/shared/league-wire-reading.js', 'js/components/league-wire-portfolio.js'], phone, { App: { LeagueLiveScores: { supported: () => true } }, WrWirePortfolio: {
        headlines: (_entries, _topic, filter) => stories.filter(s => filter === 'all' || s.league.id === filter), lookback: () => null,
    } });
    const checkEdition = tree => {
        const coverage = byClass(tree, 'wr-all-wire-coverage')[0];
        assert.equal(coverage.type, 'details'); assert.ok(!coverage.props.open);
        assert.ok(byClass(byClass(tree, 'wr-wire-reader-tools')[0], 'wr-all-wire-coverage').includes(coverage));
        const articles = all(byClass(tree, 'wr-all-wire-stories')[0], n => n.type === 'article');
        assert.equal(articles.length, 2); assert.match(articles[0].props.className, /is-lead/);
        assert.match(text(tree), /Archive · Scores!A1:C4/);
    };
    const h = setup(true); let tree = h.render('WrAllLeaguesWire', { leagues }); checkEdition(tree);
    const leagueSelect = tree => all(tree, n => n.props['aria-label'] === 'Filter Wire by league')[0];
    leagueSelect(tree).props.onChange({ target: { value: 'L0' } }); tree = h.render('WrAllLeaguesWire', { leagues });
    assert.equal(leagueSelect(tree).props.value, 'L0'); assert.equal(byClass(tree, 'wr-all-wire-story').length, 1); assert.match(text(tree), /Headline 0/); assert.doesNotMatch(text(tree), /Headline 1/);
    leagueSelect(tree).props.onChange({ target: { value: 'all' } }); tree = h.render('WrAllLeaguesWire', { leagues });
    all(tree, n => n.props['aria-label'] === 'Search all-league Wire')[0].props.onChange({ target: { value: 'Headline 1' } }); tree = h.render('WrAllLeaguesWire', { leagues });
    assert.equal(byClass(tree, 'wr-all-wire-story').length, 1); assert.match(text(tree), /Headline 1/); assert.doesNotMatch(text(tree), /Headline 0/);
    click(tree, 'Clear search'); tree = h.render('WrAllLeaguesWire', { leagues }); checkEdition(tree);
    checkEdition(setup(false).render('WrAllLeaguesWire', { leagues }));
});
test('Commissioner phone menu uses a modal dialog and restores the opener', () => {
    let focused = 0; let closed = 0; let opened = 0; let cancelled = 0;
    const h = harness(['js/components/commish-sidebar.js'], true, { document: { activeElement: { isConnected: true, focus: () => focused++ } } });
    const tree = h.render('WrCommishSidebar', { phone: true, open: true, groups: [], onClose: () => cancelled++ });
    assert.equal(tree.type, 'dialog'); tree.props.ref.current = { showModal: () => opened++, close: () => closed++ };
    const cleanup = h.effects[0](); assert.equal(opened, 1);
    tree.props.onCancel({ preventDefault() {} }); assert.equal(cancelled, 1); cleanup(); assert.equal(closed, 1); assert.equal(focused, 1);
});
test('phone Decision review exposes every asset in a large trade without changing its valuation', () => {
    const wrapper = kind => props => ({ type: kind, props, children: props.children });
    const playerIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const picks = Array.from({ length: 6 }, (_, i) => ({ season: 2027 + i, round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 }));
    const h = harness(['js/tabs/alex-insights.js'], true, { WR: { Card: wrapper('card'), Badge: wrapper('badge'), useViewport: () => ({ isPhone: true }) },
        wrAlpha: color => color, S: { transactions: { 1: [{ type: 'trade', roster_ids: [1, 2], created: 1700000000000, adds: Object.fromEntries(playerIds.map(id => [id, 1])), draft_picks: picks }] } } });
    const tree = h.render('AlexInsightsTab', { workspaceView: 'review', myRoster: { roster_id: 1, players: [] }, currentLeague: { league_id: 'L', rosters: [{ roster_id: 1 }, { roster_id: 2 }] }, playersData: Object.fromEntries(playerIds.map(id => [id, { full_name: 'Full player ' + id }])) });
    const ledger = byClass(tree, 'gm-history-full-assets')[0]; assert.ok(ledger); assert.equal(ledger.type, 'details'); assert.ok(!ledger.props.open);
    assert.equal(all(ledger, n => n.type === 'li').length, 12); assert.match(text(ledger), /Full player f/); assert.match(text(ledger), /2032 R1/);
    assert.match(text(tree), /DHQ/);
});
test('phone Preferences keeps controls available inside closed sections and announces toggles', () => {
    const wrapper = kind => props => ({ type: kind, props, children: props.children });
    let saved;
    const h = harness(['js/tabs/alex-insights.js'], true, { WR: { Card: wrapper('card'), useViewport: () => ({ isPhone: true }),
        MobileSection: props => ({ type: 'details', props: { open: false }, children: [{ type: 'summary', props: {}, children: props.title }, props.children] }), AlexSettings: { save: value => saved = value } }, wrAlpha: color => color });
    let tree = h.render('AlexInsightsTab', { workspaceView: 'settings', currentLeague: {}, playersData: {}, myRoster: { roster_id: 1, players: [] } });
    const sections = all(tree, n => n.type === 'details'); assert.equal(sections.length, 3); assert.ok(sections.every(n => !n.props.open));
    assert.match(text(sections), /Focus areas & notifications/); assert.match(text(sections), /Asset priorities/);
    const slider = all(tree, n => n.type === 'input' && n.props['aria-label'] === 'Alert threshold')[0]; assert.ok(slider); slider.props.onChange({ target: { value: 80 } }); assert.equal(saved.alertThreshold, 80);
    assert.equal(button(tree, 'Trades').props['aria-pressed'], true); assert.equal(button(tree, 'Email (coming soon)').props.disabled, true);
    const props = { workspaceView: 'settings', currentLeague: {}, playersData: {}, myRoster: { roster_id: 1, players: [] } };
    tree = h.render('AlexInsightsTab', props);
    assert.ok(byClass(tree, 'gm-settings-preset').every(n => n.props['aria-pressed'] === false), 'Custom sensitivity does not falsely select a preset');
    button(tree, 'Injury watch').props.onClick();
    tree = h.render('AlexInsightsTab', props);
    const priorFocus = JSON.stringify(saved.focus), priorChannels = JSON.stringify(saved.channel);
    byClass(tree, 'gm-settings-preset').find(n => text(n).startsWith('Conservative')).props.onClick();
    assert.equal(saved.alertThreshold, 85);
    assert.equal(JSON.stringify(saved.focus), priorFocus, 'Sensitivity presets preserve chosen focus areas');
    assert.equal(JSON.stringify(saved.channel), priorChannels, 'Sensitivity presets preserve notification choices');
    tree = h.render('AlexInsightsTab', props);
    const active = byClass(tree, 'gm-settings-preset').filter(n => n.props['aria-pressed']);
    assert.equal(active.length, 1); assert.match(text(active[0]), /^ConservativeCurrent/);
});
console.log('PASS ' + passed + ' mobile management behavior tests');

for (const phone of [true, false]) for (const type of [0, 1, 2, 3]) {
    test(`GM plan format controls: phone=${phone}, type=${type}`, () => {
        const h = harness(['js/tabs/strategy-editor.js'], phone, {
            WR: { useViewport: () => ({ isPhone: phone }), MobileSection: ({ title, children }) => ({ type: 'section', props: { title }, children }) },
            wrAlpha: color => color,
        });
        const tree = h.render('StrategyEditorTab', { currentLeague: { league_id: 'gm', settings: { type } }, myRoster: { players: [] }, playersData: {}, gmStrategy: { mode: 'custom' } });
        const visible = !phone || type === 2;
        assert.equal(text(tree).includes('GM STRATEGY'), visible);
        assert.equal(all(tree, n => n.props.title === 'Roster Cutdown Day').length > 0, visible);
        assert.equal(all(tree, n => n.props.title === 'Timeline').length > 0, visible);
        assert.equal(all(tree, n => n.props.title === 'Free Agency Filters').length, 1);
        assert.equal(all(tree, n => n.props.title === 'FAAB / Waivers').length, 1);
        assert.equal(all(tree, n => n.props.title === 'Priorities').length, 1);
    });
}
