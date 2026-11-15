'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/standalone');
const workspaces = require('../js/shared/league-workspaces.js');
const source = fs.readFileSync('js/league-detail.js', 'utf8');
const selections = [];
const context = vm.createContext({
    console,
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) },
    window: { App: {}, WR: { LeagueWorkspaces: workspaces } },
});
vm.runInContext(babel.transform(source, { presets: ['react'] }).code, context);
const plain = value => JSON.parse(JSON.stringify(value));
const groups = options => {
    context.options = options;
    return plain(vm.runInContext('buildLeagueCommandGroups(options)', context));
};
const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(walk)] : [];
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const allowedTabs = options => workspaces.navigation(options).flatMap(item => workspaces.views(item.workspace, options)).map(view => view.tab);
const tabs = result => result.flatMap(group => group.views.map(view => view.tab));
const render = (activeTab, workspaceOptions) => {
    context.props = { activeTab, workspaceOptions, onSelectTab: tab => selections.push(tab) };
    return vm.runInContext('DesktopCommandNav(props)', context);
};
const buttons = tree => walk(tree).filter(node => node.type === 'button');
const primaryButtons = tree => buttons(tree).filter(node => node.props.className === 'wr-desktop-command-workspace');
const secondaryButtons = tree => buttons(tree).filter(node => node.props.className === 'wr-desktop-command-view');
const currentButtons = tree => buttons(tree).filter(node => node.props['aria-current'] === 'page');
const click = button => {
    const before = selections.length;
    button.props.onClick();
    assert.equal(selections.length, before + 1, 'A navigation click selects one destination');
    return selections.at(-1);
};

for (const options of [
    { isPhone: false, leagueType: 'dynasty' },
    { isPhone: false, leagueType: 'redraft', showTrades: false },
    { isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false },
    { isPhone: true, leagueType: 'dynasty' },
]) {
    const result = groups(options), actual = tabs(result);
    assert.deepEqual(result.map(group => group.label), ['Your team', 'Market & draft', 'League & research', 'Alex & tools']);
    assert.equal(new Set(actual).size, actual.length, 'Every allowed destination appears once');
    assert.deepEqual([...actual].sort(), allowedTabs(options).sort(), 'Groups retain every permitted route for this format and viewport');
}
const desktop = tabs(groups({ isPhone: false, leagueType: 'dynasty' }));
for (const tab of ['team-outlook', 'market-review', 'research-players', 'research-reports']) assert(desktop.includes(tab), 'Browser retains ' + tab);
assert(!desktop.includes('mock-draft'), 'Phone-only mock-draft stays out of browser navigation');
const chopped = tabs(groups({ isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false }));
for (const tab of ['trades', 'strategy', 'decisions', 'patterns', 'lineup']) assert(!chopped.includes(tab), 'Capability gate excludes ' + tab);
assert(chopped.includes('gm-settings'), 'Global Alex preferences remain available in Chopped');

for (const options of [
    { isPhone: false, leagueType: 'dynasty' },
    { isPhone: false, leagueType: 'redraft', showTrades: false },
    { isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false },
]) {
    const initial = render('lenses', options);
    assert.equal(initial.type, 'nav');
    assert.equal(initial.props['aria-label'], 'Your command center');
    assert.equal(primaryButtons(initial).length, 9, 'Browser shows nine compact workspaces');
    assert.equal(secondaryButtons(initial).length, 0, 'Inactive workspaces do not expose their secondary links');
    const reachable = new Set();
    for (const workspace of workspaces.navigation(options)) {
        const entry = primaryButtons(initial).find(button => text(button) === workspace.label);
        assert(entry, workspace.label + ' remains directly discoverable');
        const selected = click(entry);
        assert.equal(selected, workspace.tab, 'Workspace click opens its primary destination');
        const tree = render(selected, options);
        const permittedViews = workspaces.views(workspace.workspace, options);
        assert.deepEqual(secondaryButtons(tree).map(text), permittedViews.filter(view => view.tab !== workspace.tab).map(view => view.label),
            'Only the selected workspace exposes its permitted secondary destinations');
        const subgroups = walk(tree).filter(node => node.props.role === 'group');
        assert.equal(subgroups.length, permittedViews.length > 1 ? 1 : 0, 'At most one contextual submenu is visible');
        for (const view of permittedViews) {
            const visibleLabel = view.tab === workspace.tab ? workspace.label : view.label;
            const destination = buttons(tree).find(button => text(button) === visibleLabel);
            assert(destination, view.label + ' is reachable after opening its workspace');
            assert.equal(click(destination), view.tab, 'Destination click retains the exact route');
            reachable.add(view.tab);
            const activeTree = render(view.tab, options);
            const current = currentButtons(activeTree);
            assert.equal(current.length, 1, 'Only the exact selected route is current');
            assert.equal(text(current[0]), visibleLabel);
            if (view.tab !== workspace.tab) {
                assert(!primaryButtons(activeTree).find(button => text(button) === workspace.label).props['aria-current'],
                    'A workspace parent is not marked as the current page when its subview is active');
            }
        }
    }
    assert.deepEqual([...reachable].sort(), allowedTabs(options).sort(), 'Every permitted browser route remains reachable');
    assert(!reachable.has('mock-draft'), 'Phone-only mock draft stays outside browser navigation');
}

const outlook = render('team-outlook', { isPhone: false, leagueType: 'dynasty' });
assert.equal(text(currentButtons(outlook)[0]), 'Team outlook', 'A deep link opens its matching contextual submenu');
assert(secondaryButtons(outlook).some(button => text(button) === 'GM plan'), 'Roster retains the GM plan entry');
assert(!secondaryButtons(outlook).some(button => text(button) === 'Trade Desk'), 'Another workspace stays compact');
const restricted = { isPhone: false, leagueType: 'chopped', showTrades: false, showGmOffice: false, showGameDay: false };
assert.equal(text(currentButtons(render('trades', restricted))[0]), 'Market', 'A disallowed route follows its allowed workspace fallback');

context.window.WR.LeagueWorkspaces = {
    ...workspaces,
    resolve: (tab, options) => tab.startsWith('future-') ? { tab, workspace: 'future' } : workspaces.resolve(tab, options),
    navigation: options => [...workspaces.navigation(options), { workspace: 'future', tab: 'future-report', label: 'Future' }],
    views: (workspace, options) => workspace === 'future' ? [{ tab: 'future-report', label: 'Future report' }, { tab: 'future-audit', label: 'Future audit' }] : workspaces.views(workspace, options),
};
const future = groups({ isPhone: false });
assert(future.find(group => group.label === 'Alex & tools').views.some(view => view.tab === 'future-report'), 'New allowed destinations remain reachable');
assert.equal(tabs(future).filter(tab => tab === 'future-report').length, 1);
const futureTree = render('lenses', { isPhone: false });
const futureGroup = walk(futureTree).find(node => node.type === 'section' && node.props['aria-label'] === 'Tools');
const futureEntry = primaryButtons(futureGroup).find(button => text(button) === 'Future');
assert(futureEntry, 'An uncurated workspace appears in the final group');
assert.equal(click(futureEntry), 'future-report');
assert.deepEqual(secondaryButtons(render('future-report', { isPhone: false })).map(text), ['Future audit']);
const futureAudit = render('future-audit', { isPhone: false });
assert.equal(text(currentButtons(futureAudit)[0]), 'Future audit', 'Future deep links retain exact current state');
assert.equal(click(secondaryButtons(futureAudit)[0]), 'future-audit');
console.log('PASS desktop command center: compact workspaces, contextual destinations, complete route reachability, format gates, exact selection, and future fallback');
