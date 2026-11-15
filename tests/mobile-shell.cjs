'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const workspaces = require('../js/shared/league-workspaces.js');
const source = fs.readFileSync('js/league-detail.js', 'utf8');
const compiled = babel.transform(source, { presets: ['react'] }).code;

function fixture({ open = false, phone = true, keyboard = false, activeTab = 'myteam', options = {} } = {}) {
    const updates = [], selections = [], events = {};
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
    let hook = 0;
    const context = {
        console,
        useState: initial => [hook++ === 0 ? open : typeof initial === 'function' ? initial() : initial, value => updates.push(value)],
        useRef: () => ({ current: null }),
        useEffect: fn => fn(),
        React: { createElement: h, Fragment: 'fragment' },
        window: { addEventListener: (name, fn) => { events[name] = fn; }, App: {}, WR: { LeagueWorkspaces: workspaces, Sheet: 'sheet', useViewport: () => ({ isPhone: phone, kbOpen: keyboard }) } },
    };
    vm.createContext(context);
    vm.runInContext(compiled, context);
    context.props = { activeTab, workspaceOptions: { ...options, isPhone: phone }, onSelectTab: tab => selections.push(tab), onOpenLeagueOptions: () => selections.push('league-options') };
    vm.runInContext('props.navItems = buildLeagueNavItems(props.workspaceOptions)', context);
    const tree = vm.runInContext('PhoneDockInner(props)', context);
    const nodes = [];
    function walk(node) { if (!node || typeof node !== 'object') return; nodes.push(node); (node.children || []).forEach(walk); }
    walk(tree);
    const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
    return { context, nodes, text, updates, selections, events };
}

const closed = fixture();
const dock = closed.nodes.filter(n => n.type === 'button' && n.props.className?.includes('wr-dock-chip'));
assert.deepEqual(dock.map(closed.text), ['Lenses', 'Roster', 'League', 'Game Day']);
assert.equal(dock.find(n => n.props['aria-current'] === 'page').children.map(closed.text).join(''), 'Roster');
closed.events['wr:phone-menu']();
assert.deepEqual(closed.updates, [false, false, true]);
const installed = fixture({ options: { isInstalledApp: true } });
assert.deepEqual(installed.nodes.filter(n => n.type === 'button' && n.props.className?.includes('wr-dock-chip')).map(installed.text), ['Overview', 'Roster', 'League', 'Game Day'], 'Installed app keeps the Overview dock default');

const expanded = fixture({ open: true, activeTab: 'stats' });
assert.deepEqual(expanded.nodes.filter(n => n.type === 'h2').map(expanded.text), ['Your team', 'Market & draft', 'League & research', 'Alex & tools']);
const menuDestinations = expanded.nodes.filter(n => n.type === 'button' && expanded.text(n).endsWith('›')).map(expanded.text);
assert.equal(new Set(menuDestinations).size, menuDestinations.length, 'Every destination appears once in the grouped menu');
for (const tab of ['fa', 'trades', 'draft', 'mock-draft', 'draft-review', 'wire', 'stats', 'compare', 'lenses', 'settings', 'gm-settings', 'legend']) {
    const expected = workspaces.resolve(tab,{isPhone:true}).label;
    assert.ok(expanded.nodes.some(n => n.type === 'button' && expanded.text(n) === expected + '›'), `More must retain ${expected}`);
}
for (const label of ['Team outlook','Market review','Players & picks','Custom reports']) assert(!expanded.nodes.some(n=>n.type==='button'&&expanded.text(n)===label+'›'),label+' is removed from phone navigation');
expanded.nodes.find(n => n.type === 'button' && expanded.text(n) === 'Waivers›').props.onClick();
assert.deepEqual(expanded.selections, ['fa']);
assert.deepEqual(expanded.updates, [false, false]);

const restricted = fixture({ open: true, options: { showTrades: false, showGmOffice: false, leagueType: 'chopped' } });
const labels = restricted.nodes.filter(n => n.type === 'button').map(restricted.text);
assert.ok(labels.includes('Waivers›'));
assert.ok(!labels.includes('Trade Desk›'));
assert.ok(labels.includes('Alex preferences›'), 'Global Alex preferences remain reachable in Chopped');
assert.ok(labels.includes('Lenses›'), 'Lenses remains available in seasonal league menus');

for (const opts of [{ phone: false }, { keyboard: true }]) {
    const f = fixture(opts);
    assert.equal(vm.runInContext('PhoneDock(props)', f.context), null);
}
console.log('PASS mobile shell: four destinations, retained routes, capability gates, and phone/keyboard visibility');

const headerSource = source.slice(source.indexOf('<div className="wr-mobile-workspace">'), source.indexOf('<div className="wr-workspace-heading">')).trim();
for (const activeTab of ['myteam', 'alex']) {
    const f = fixture({ activeTab });
    Object.assign(f.context, {
        workspaceRoute: workspaces.resolve(activeTab),
        workspace: workspaces.workspace(activeTab),
        workspaceViews: workspaces.views('team'),
        viewTab: activeTab,
        setActiveTab: tab => f.selections.push(tab),
    });
    const header = vm.runInContext(babel.transform('(' + headerSource + ')', { presets: ['react'] }).code, f.context);
    const title = header.children[0];
    assert.equal(title.type, 'h1');
    assert.equal(f.text(title), workspaces.resolve(activeTab).label);
    assert.ok(!title.children.some(node => node?.type === 'select'), 'Mobile shows a stable workspace title instead of a route selector');
}
assert.match(source, /!\['dashboard', 'lenses'\]\.includes\(viewTab\) && \(!alexPhone \|\| viewTab === 'wire'\)/, 'Overview and Lenses stay clear of the Wire; phones open it from its menu destination');
console.log('PASS mobile titles: stable route labels and My Team phone focus');

const leagueOptions = fixture({ open: true });
leagueOptions.nodes.find(node => node.type === 'button' && leagueOptions.text(node) === 'League options').props.onClick();
assert.deepEqual(leagueOptions.selections, ['league-options']);
assert.equal(leagueOptions.updates.at(-1), false, 'Menu closes before the secondary league options sheet opens');

const switchStart = source.indexOf('<button type="button" className="mc-league-switch"');
const switchEnd = source.indexOf('</button>', switchStart) + '</button>'.length;
const switchFixture = fixture();
let switchOptions;
Object.assign(switchFixture.context, { currentLeague: { name: 'Shootout League' }, phaseColor: 'green', onBack: options => { switchOptions = options; } });
const switchButton = vm.runInContext(babel.transform('(' + source.slice(switchStart, switchEnd) + ')', { presets: ['react'] }).code, switchFixture.context);
assert.equal(switchButton.type, 'button', 'Native button supports tap, Enter, and Space');
assert.equal(switchButton.props['aria-label'], 'Switch league');
switchButton.props.onClick();
assert.equal(switchOptions.leagueSelector, true, 'Header directly requests the league selector');
assert.doesNotMatch(source.slice(switchStart, switchEnd), /setPhHdrSheetOpen/);

const appSource = fs.readFileSync('js/app.js', 'utf8');
const backStart = appSource.indexOf('onBack={(navigation) => {') + 'onBack={'.length;
const backEnd = appSource.indexOf('}}\n                        activeTab', backStart);
assert(backStart > 0 && backEnd > backStart);
for (const isInstalledApp of [false, true]) for (const proMode of [false, true]) {
    const actions = [], routes = [];
    let allowed = true;
    const defaultTab = workspaces.defaultTab({ isInstalledApp });
    const navigationContext = vm.createContext({ window: { App: { NavigationGuard: { canNavigate: () => allowed } } }, proMode, defaultTab,
        cancelLinkedLeagueRoute: () => actions.push('cancel'), setSelectedLeague: league => actions.push(['league', league]),
        setActiveTab: tab => actions.push(['tab', tab]), setProMode: value => actions.push(['pro', value]),
        isNavigatingRef: { current: false }, routeUrl: () => '/', history: { pushState: state => routes.push(state.view) },
    });
    const leaveLeague = vm.runInContext('(' + appSource.slice(backStart, backEnd + 1) + ')', navigationContext);
    leaveLeague({ leagueSelector: true });
    assert.deepEqual(routes, ['hub'], 'Explicit league switching opens the selector even from Empire mode');
    assert(actions.some(action => Array.isArray(action) && action[0] === 'pro' && action[1] === false));
    assert(actions.some(action => Array.isArray(action) && action[0] === 'tab' && action[1] === defaultTab));
    actions.length = 0; routes.length = 0; allowed = false;
    leaveLeague({ leagueSelector: true });
    assert.equal(actions.length, 0, 'League switching retains the existing unsaved-work guard');
    assert.equal(routes.length, 0);
}
console.log('PASS phone league switch: direct selector, native keyboard control, retained options, and navigation guard');
