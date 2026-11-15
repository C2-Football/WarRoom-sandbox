/* global module */
(function (root) {
    'use strict';
    const analysisRoutes = { roster: 'team-outlook', draft: 'draft-review', trades: 'market-review', assets: 'research-players', reports: 'research-reports' };
    const routes = [
        { tab: 'dashboard', workspace: 'home', label: 'Overview' },
        { tab: 'myteam', workspace: 'team', label: 'Roster' },
        { tab: 'lineup', workspace: 'team', label: 'Game Day', capability: 'gameDay' },
        { tab: 'team-outlook', workspace: 'team', label: 'Team outlook', analysis: 'roster', phoneHidden: true },
        { tab: 'strategy', workspace: 'team', label: 'GM plan', alex: 'strategy', capability: 'gm' },
        { tab: 'decisions', workspace: 'team', label: 'Decision review', alex: 'history', capability: 'gm' },
        { tab: 'patterns', workspace: 'team', label: 'Patterns', alex: 'patterns', capability: 'patterns' },
        { tab: 'fa', workspace: 'market', label: 'Waivers' },
        { tab: 'trades', workspace: 'market', label: 'Trade Desk', capability: 'trades' },
        { tab: 'targets', workspace: 'market', label: 'Saved targets' },
        { tab: 'market-review', workspace: 'market', label: 'Market review', analysis: 'trades', phoneHidden: true },
        { tab: 'draft', workspace: 'draft', label: 'Draft room' },
        { tab: 'mock-draft', workspace: 'draft', label: 'Mock draft', phoneOnly: true },
        { tab: 'draft-review', workspace: 'draft', label: 'Draft analysis', analysis: 'draft' },
        { tab: 'central', workspace: 'league', label: 'Standings & matchups' },
        { tab: 'league-team', workspace: 'league', label: 'Team profile', legacy: true },
        { tab: 'wire', workspace: 'league', label: 'The Wire', phoneMenuOnly: true },
        { tab: 'calendar', workspace: 'league', label: 'Calendar' },
        { tab: 'trophies', workspace: 'league', label: 'History & trophies' },
        { tab: 'stats', workspace: 'research', label: 'Research', phoneLabel: 'Stats hub' },
        { tab: 'research-players', workspace: 'research', label: 'Players & picks', analysis: 'assets', phoneHidden: true },
        { tab: 'compare', workspace: 'research', label: 'Compare' },
        { tab: 'research-reports', workspace: 'research', label: 'Custom reports', analysis: 'reports', phoneHidden: true },
        { tab: 'lenses', workspace: 'lenses', label: 'Lenses' },
        { tab: 'settings', workspace: 'settings', label: 'Settings' },
        { tab: 'gm-settings', workspace: 'settings', label: 'Alex preferences', alex: 'settings' },
        { tab: 'legend', workspace: 'help', label: 'Help & glossary' },
        // Legacy Office links retain their internal saved view and controls.
        { tab: 'alex', workspace: 'team', label: "GM's Office", alex: null, legacy: true, capability: 'gm' },
    ];
    const workspaces = [
        { id: 'home', label: 'Overview', tab: 'dashboard', iconKey: 'home', description: 'Your next decisions and this week at a glance.' },
        { id: 'team', label: 'Roster', tab: 'myteam', iconKey: 'roster', description: 'Your roster, weekly lineup, and plan for the team.' },
        { id: 'market', label: 'Market', tab: 'fa', iconKey: 'fa', description: 'Find an upgrade, compare options, and plan your next move.' },
        { id: 'draft', label: 'Draft', tab: 'draft', iconKey: 'draft', description: 'Prepare your board, follow the draft, and review your picks.' },
        { id: 'league', label: 'League', tab: 'central', iconKey: 'central', description: 'The competition, important dates, and your league history.' },
        { id: 'research', label: 'Research', phoneLabel: 'Stats hub', tab: 'stats', iconKey: 'analytics', description: 'Explore stats, value, scouting, and comparisons.' },
        { id: 'lenses', label: 'Lenses', tab: 'lenses', iconKey: 'analytics', description: 'Your saved views, built with Alex.' },
        { id: 'settings', label: 'Settings', tab: 'settings', iconKey: 'settings', utility: true },
        { id: 'help', label: 'Help', tab: 'legend', iconKey: 'legend', utility: true },
    ];
    function isInstalledApp() {
        return root.navigator?.standalone === true || root.matchMedia?.('(display-mode: standalone)')?.matches === true;
    }
    function defaultTab(options) {
        const installed = typeof options?.isInstalledApp === 'boolean' ? options.isInstalledApp : isInstalledApp();
        return installed ? 'dashboard' : 'lenses';
    }
    function allowed(route, options) {
        const opts = options || {};
        if (opts.isPhone && route.phoneHidden) return false;
        if (!opts.isPhone && route.phoneOnly) return false;
        if (route.capability === 'trades') return opts.showTrades !== false;
        if (route.capability === 'gm') return opts.showGmOffice !== false;
        if (route.capability === 'patterns') return opts.showGmOffice !== false && (!opts.leagueType || opts.leagueType === 'dynasty' || opts.leagueType === 'unknown');
        if (route.capability === 'gameDay') return opts.showGameDay !== false;
        return true;
    }
    function resolve(tab, options) {
        const opts = options || {};
        let key = tab || defaultTab(opts);
        if (key === 'analytics') key = analysisRoutes[opts.legacyAnalyticsView] || 'team-outlook';
        if (key === 'league') key = 'research-players';
        const route = routes.find(r => r.tab === key) || routes[0];
        if (allowed(route, opts)) return present(route, opts);
        const fallback = route.phoneHidden || route.phoneOnly ? workspaces.find(w => w.id === route.workspace)?.tab : route.capability === 'trades' ? 'fa' : route.workspace === 'team' ? 'myteam' : 'dashboard';
        return present(routes.find(r => r.tab === fallback) || routes[0], opts);
    }
    function present(item, options) { return { ...item, label: options?.isPhone && item.phoneLabel ? item.phoneLabel : item.label }; }
    function views(workspace, options) {
        return routes.filter(r => r.workspace === workspace && !r.legacy && allowed(r, options)).map(r => present(r, options));
    }
    function navigation(options) {
        return workspaces.map(w => ({ ...present(w, options), workspace: w.id }));
    }
    function workspace(tab, options) {
        const current = resolve(tab, options);
        return present(workspaces.find(w => w.id === current.workspace), options);
    }
    function upgradeStarter(widgets, defaults, leagueDefaults) {
        const legacy = [
            ...(leagueDefaults || []),
            { id: 'dw0', key: 'intel-brief', size: 'tall' },
            { id: 'dw1', key: 'roster-pulse', size: 'sm', primaryMetric: 'health-score' },
            { id: 'dw2', key: 'power-rankings', size: 'sm' },
            { id: 'dw3', key: 'roster-pulse', size: 'md', primaryMetric: 'elite-count' },
            { id: 'dw4', key: 'market-radar', size: 'md' },
        ];
        const fields = ['id', 'key', 'size', 'primaryMetric'];
        const untouched = Array.isArray(widgets) && widgets.length === legacy.length && widgets.every((item, i) =>
            item && Object.keys(item).every(key => fields.includes(key)) && fields.every(key => item[key] === legacy[i][key]));
        return untouched ? defaults.map(item => ({ ...item })) : widgets;
    }
    function dockChoices(options) {
        return routes.filter(r => !r.legacy && !(options?.isPhone && r.phoneMenuOnly) && allowed(r, options)).map(r => ({ ...present(r, options), iconKey: workspaces.find(w => w.id === r.workspace)?.iconKey || 'home' }));
    }
    function dockDefaults(options) {
        return [defaultTab(options), 'myteam', 'central', 'lineup'].filter(tab => allowed(routes.find(route => route.tab === tab), options));
    }
    function dockSelection(saved, options) {
        const valid = new Set(dockChoices(options).map(r => r.tab));
        return [...new Set(Array.isArray(saved) ? saved : dockDefaults(options))].filter(tab => valid.has(tab)).slice(0, 4);
    }
    const api = { isInstalledApp, defaultTab, dockChoices, dockDefaults, dockSelection, resolve, views, navigation, workspace, analysisRoutes, upgradeStarter };
    root.WR = root.WR || {};
    root.WR.LeagueWorkspaces = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
