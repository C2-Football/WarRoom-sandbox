const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const W = require('../js/shared/league-workspaces.js');
test('Overview remains home while Lenses is a separate workspace', () => {
    assert.deepEqual(W.navigation().filter(w => !w.utility).map(w => w.label), ['Overview', 'Roster', 'Market', 'Draft', 'League', 'Research', 'Lenses']);
    for (const [tab, group] of Object.entries({ lineup: 'team', strategy: 'team', decisions: 'team', fa: 'market', trades: 'market', calendar: 'league', trophies: 'league', stats: 'research', compare: 'research', lenses: 'lenses' })) {
        assert.equal(W.workspace(tab).id, group);
        assert.ok(W.views(group).some(v => v.tab === tab));
    }
});
test('every format defaults to Lenses in browsers and Overview when installed without changing saved dock choices', () => {
    for (const isInstalledApp of [false, true]) for (const isPhone of [false, true]) for (const leagueType of ['dynasty', 'redraft', 'chopped', 'unknown']) {
        const options = { isInstalledApp, isPhone, leagueType, showTrades: false, showGmOffice: false };
        const expectedDefault = isInstalledApp ? 'dashboard' : 'lenses';
        assert.equal(W.defaultTab(options), expectedDefault);
        assert.equal(W.resolve(undefined, options).tab, expectedDefault);
        assert.equal(W.resolve('dashboard', options).label, 'Overview');
        assert.equal(W.resolve('lenses', options).tab, 'lenses');
        assert.equal(W.workspace('lenses', options).id, 'lenses');
        assert.deepEqual(W.views('home', options).map(route => route.tab), ['dashboard']);
        assert(W.navigation(options).some(item => item.tab === 'lenses'));
        assert(W.dockChoices(options).some(item => item.tab === 'lenses'));
        assert.deepEqual(W.dockDefaults(options), [expectedDefault, 'myteam', 'central', 'lineup']);
        assert.deepEqual(W.dockSelection(null, options), [expectedDefault, 'myteam', 'central', 'lineup']);
        assert.deepEqual(W.dockSelection(['dashboard', 'myteam', 'central', 'lineup'], options), ['dashboard', 'myteam', 'central', 'lineup']);
        assert.deepEqual(W.dockSelection(['lenses', 'fa'], options), ['lenses', 'fa']);
    }
});
test('installed detection supports standalone display mode and iOS without treating browser fullscreen as installed', () => {
    const source = fs.readFileSync(require.resolve('../js/shared/league-workspaces.js'), 'utf8');
    for (const [environment, installed] of [
        [{}, false],
        [{ navigator: { standalone: false }, matchMedia: () => ({ matches: false }) }, false],
        [{ navigator: { standalone: true } }, true],
        [{ matchMedia: query => ({ matches: query === '(display-mode: standalone)' }) }, true],
        [{ matchMedia: query => ({ matches: query === '(display-mode: fullscreen)' }) }, false],
    ]) {
        const sandbox = { window: environment };
        vm.runInNewContext(source, sandbox);
        const api = environment.WR.LeagueWorkspaces;
        assert.equal(api.isInstalledApp(), installed);
        assert.equal(api.defaultTab(), installed ? 'dashboard' : 'lenses');
        assert.equal(api.resolve(undefined).tab, installed ? 'dashboard' : 'lenses');
        assert.equal(api.defaultTab({ isInstalledApp: !installed }), installed ? 'lenses' : 'dashboard');
    }
});
test('legacy analytics links retain their selected report in its new home', () => {
    for (const [view, target] of Object.entries(W.analysisRoutes)) {
        assert.equal(W.resolve('analytics', { legacyAnalyticsView: view }).tab, target);
        assert.equal(W.resolve(target).analysis, view);
    }
    assert.equal(W.resolve('league').tab, 'research-players');
    assert.equal(W.resolve('alex').workspace, 'team');
    assert.equal(W.resolve('unknown-tab').tab, 'dashboard');
});
test('blocked deep links and navigation use the same format rules', () => {
    const chopped = { showTrades: false, showGmOffice: false, showGameDay: true, leagueType: 'chopped' };
    assert.equal(W.resolve('trades', chopped).tab, 'fa');
    assert.equal(W.resolve('strategy', chopped).tab, 'myteam');
    assert.equal(W.resolve('patterns', chopped).tab, 'myteam');
    assert.equal(W.views('market', chopped).some(v => v.tab === 'trades'), false);
    assert.equal(W.views('team', chopped).some(v => v.alex), false);
    assert.equal(W.resolve('lineup', { showGameDay: false }).tab, 'myteam');
    assert.equal(W.views('team', { showGameDay: false }).some(v => v.tab === 'lineup'), false);
});
test('callers cannot mutate shared routing metadata', () => {
    const route = W.resolve('calendar'); route.workspace = 'help';
    const nav = W.navigation(); nav[0].tab = 'trades';
    assert.equal(W.resolve('calendar').workspace, 'league');
    assert.equal(W.navigation()[0].tab, 'dashboard');
});
test('global Alex preferences stay reachable when the league has no GM office', () => {
    for (const isPhone of [true, false]) {
        const options = { isPhone, showGmOffice: false, leagueType: 'chopped' };
        assert.equal(W.resolve('gm-settings', options).tab, 'gm-settings');
        assert.equal(W.resolve('gm-settings', options).alex, 'settings');
        assert(W.views('settings', options).some(route => route.tab === 'gm-settings'));
        assert.equal(W.resolve('strategy', options).tab, 'myteam');
    }
});
test('phone navigation has focused destinations and its own mock draft route', () => {
    const phone={isPhone:true};
    for (const [tab,fallback] of Object.entries({'team-outlook':'myteam','market-review':'fa','research-players':'stats','research-reports':'stats'})) {
        assert.equal(W.resolve(tab,phone).tab,fallback);
        assert(!W.views(W.workspace(tab).id,phone).some(route=>route.tab===tab));
        assert.equal(W.resolve(tab).tab,tab,'Desktop keeps its full workspace');
    }
    assert.equal(W.resolve('mock-draft',phone).tab,'mock-draft');
    assert(W.views('draft',phone).some(route=>route.tab==='mock-draft'));
    assert.equal(W.resolve('mock-draft').tab,'draft');
    assert.equal(W.resolve('stats',phone).label,'Stats hub');
    assert.equal(W.workspace('stats',phone).label,'Stats hub');
    assert(W.views('league',phone).some(route=>route.tab==='wire'),'Wire remains in the menu');
    assert(!W.dockChoices(phone).some(route=>route.tab==='wire'),'Wire is only a menu destination');
});
test('only an untouched previous starter layout receives the new defaults', () => {
    const defaults = [{ id: 'brief', key: 'intel-brief', size: 'xl' }];
    const league = [{ id: 'league-kpi', key: 'weekly-matchups', size: 'sm' }];
    const previous = [...league,
        { id: 'dw0', key: 'intel-brief', size: 'tall' },
        { id: 'dw1', key: 'roster-pulse', size: 'sm', primaryMetric: 'health-score' },
        { id: 'dw2', key: 'power-rankings', size: 'sm' },
        { id: 'dw3', key: 'roster-pulse', size: 'md', primaryMetric: 'elite-count' },
        { id: 'dw4', key: 'market-radar', size: 'md' },
    ];
    assert.deepEqual(W.upgradeStarter(previous, defaults, league), defaults);
    const resized = previous.map(w => ({ ...w })); resized[1].size = 'md';
    assert.equal(W.upgradeStarter(resized, defaults, league), resized);
    const reordered = [...previous].reverse();
    assert.equal(W.upgradeStarter(reordered, defaults, league), reordered);
    const removed = previous.slice(1);
    assert.equal(W.upgradeStarter(removed, defaults, league), removed);
    assert.equal(W.upgradeStarter(defaults, defaults, league), defaults);
});
