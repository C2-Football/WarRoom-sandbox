// ══════════════════════════════════════════════════════════════════
// league-detail.js — LeagueDetail: Dashboard, My Team, League Map, Analytics
// This is the main app shell after selecting a league.
// ══════════════════════════════════════════════════════════════════
    const LEAGUE_WR_KEYS  = window.App.WR_KEYS;
    const LeagueStorage = window.App.WrStorage;

    // A replacement comparison is an in-memory navigation intent, scoped like
    // the roster lens that created it. It must survive a lazy mount without
    // being replayed into a different account, league or season.
    (function installPlayerCompareHandoff() {
        const WR = window.WR = window.WR || {};
        const text = value => String(value == null ? '' : value);
        const context = (league, userId) => ({
            accountKey: WR.WaiverPlans?.account?.() || ((window.App?.OD || window.OD)?.getCurrentUserId?.()
                ? 'account:' + (window.App?.OD || window.OD).getCurrentUserId() : userId ? 'viewer:' + text(userId) : ''),
            platform: text(league?._platform || window.S?.platform || 'sleeper'),
            leagueId: text(league?.league_id || league?.id), season: text(league?.season),
        });
        const playerIds = values => [...new Set((Array.isArray(values) ? values : [values])
            .filter(value => ['string', 'number'].includes(typeof value)).map(value => text(value).trim()).filter(value => value && value !== '0'))].slice(0, 4);
        const sameContext = (target, league, userId) => {
            const current = context(league, userId);
            return !!target && ['accountKey', 'platform', 'leagueId', 'season'].every(key => text(target[key]) === current[key])
                && (window.S?.currentLeagueId == null || text(window.S.currentLeagueId) === current.leagueId);
        };
        const matches = (target, league, userId) => target?.kind === 'players-replace' && !!target.requestId
            && !!target.accountKey && !!target.leagueId && !!target.season && sameContext(target, league, userId)
            && Array.isArray(target.playerIds) && target.playerIds.length > 0 && target.playerIds.length <= 4
            && JSON.stringify(playerIds(target.playerIds)) === JSON.stringify(target.playerIds);
        const clear = target => {
            if (window._wrPlayerCompareTarget?.requestId === target?.requestId) {
                try { delete window._wrPlayerCompareTarget; } catch (_) { window._wrPlayerCompareTarget = null; }
            }
        };
        const discardStale = (league, userId) => {
            const target = window._wrPlayerCompareTarget;
            if (target && !matches(target, league, userId)) clear(target);
        };
        WR.PlayerCompareHandoff = { context, playerIds, sameContext, matches, clear, discardStale };
    })();

    // Lazy boundary factory for deferred module groups (see js/module-loader.js).
    // Heavy tab modules are inert at boot; on first open we inject the group's
    // scripts, show a spinner, then render the real component. The components are
    // globals only defined after the load completes, so each is resolved through a
    // thunk that is only trusted once the group reports ready.
    function wrLazyTab(group, label, resolveComponent) {
        return function WrLazyTabBoundary(props) {
            const [phase, setPhase] = React.useState(
                (window.wrModuleGroupLoaded?.(group) && typeof resolveComponent() === 'function') ? 'ready' : 'loading'
            );
            // Bumped by "Try again" to re-run the loader effect. The loader drops
            // its memoised promise on failure (js/module-loader.js), so a retry
            // re-fetches only the scripts that never executed — no page reload,
            // and no lost tab/league state.
            const [attempt, setAttempt] = React.useState(0);
            React.useEffect(() => {
                if (phase === 'ready') return;
                let alive = true;
                const loader = window.wrLoadModuleGroup ? window.wrLoadModuleGroup(group) : Promise.resolve();
                loader.then(() => { if (alive) setPhase('ready'); })
                      .catch((e) => { if (window.wrLog) window.wrLog(group + '.lazyLoad', e); if (alive) setPhase('error'); });
                return () => { alive = false; };
            }, [attempt]);
            if (phase === 'error') {
                const retryBtn = { marginTop: '12px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: 600, minHeight: '44px' };
                const reloadBtn = { ...retryBtn, marginLeft: '8px', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))' };
                return React.createElement('div', { style: { padding: '48px 24px', textAlign: 'center', color: 'var(--silver)' } },
                    label + " module didn't load — check your connection. ",
                    React.createElement('div', null,
                        React.createElement('button', {
                            onClick: () => { setPhase('loading'); setAttempt(a => a + 1); },
                            style: retryBtn,
                        }, 'Try again'),
                        React.createElement('button', {
                            onClick: () => window.location.reload(),
                            style: reloadBtn,
                        }, 'Reload')));
            }
            const Comp = resolveComponent();
            if (phase !== 'ready' || typeof Comp !== 'function') {
                return React.createElement('div', { style: { padding: '64px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' } }, 'Loading ' + label + '…');
            }
            return React.createElement(Comp, props);
        };
    }
    const DraftTabLazy = wrLazyTab('draft', 'Draft Command', () => (typeof DraftTab === 'function' ? DraftTab : null));
    const TradeCalcTabLazy = wrLazyTab('trade', 'Trade Center', () => (typeof TradeCalcTab === 'function' ? TradeCalcTab : null));
    const FreeAgencyTabLazy = wrLazyTab('fa', 'Free Agency', () => (typeof FreeAgencyTab === 'function' ? FreeAgencyTab : null));
    const LeagueMapTabLazy = wrLazyTab('analysis', 'League Intel', () => (typeof LeagueMapTab === 'function' ? LeagueMapTab : null));
    const AnalyticsPanelLazy = wrLazyTab('analysis', 'Analytics', () => (typeof AnalyticsPanel === 'function' ? AnalyticsPanel : null));
    const TrophyRoomTabLazy = wrLazyTab('trophies', 'Trophy Room', () => (typeof TrophyRoomTab === 'function' ? TrophyRoomTab : null));
    const AlexInsightsTabLazy = wrLazyTab('alex', "GM's Office", () => (typeof window.AlexInsightsTab === 'function' ? window.AlexInsightsTab : null));
    const CompareTabLazy = wrLazyTab('compare', 'Compare', () => (typeof window.CompareTab === 'function' ? window.CompareTab : null));
    const LeagueCentralTabLazy = wrLazyTab('central', 'League Central', () => (typeof window.LeagueCentralTab === 'function' ? window.LeagueCentralTab : null));
    const LeagueStatsTabLazy = wrLazyTab('stats', 'Stats', () => (typeof window.LeagueStatsTab === 'function' ? window.LeagueStatsTab : null));
    // My Team and Calendar are non-default tabs (the default in-league view is the
    // dashboard), so their modules are deferred too — they no longer load at boot
    // and only fetch on first open, like the tabs above. Removes ~68KB of JSX from
    // the cold-load critical path. The thunks resolve the same top-level globals the
    // deferred scripts define once the group reports ready.
    const MyTeamTabLazy = wrLazyTab('myteam', 'My Team', () => (typeof MyTeamTab === 'function' ? MyTeamTab : null));
    const CalendarTabLazy = wrLazyTab('calendar', 'Calendar', () => (typeof CalendarTab === 'function' ? CalendarTab : null));
    const LineupTabLazy = wrLazyTab('lineup', 'Lineup', () => (typeof window.LineupTab === 'function' ? window.LineupTab : null));


    function wrCanPageScroll() {
        const doc = document.documentElement;
        const body = document.body;
        return Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0) > window.innerHeight + 1;
    }

    function wrCanElementConsumeWheel(el, deltaY) {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(style.overflowY)) return false;
        if (el.scrollHeight <= el.clientHeight + 1) return false;
        const canScrollUp = el.scrollTop > 1;
        const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        return deltaY < 0 ? canScrollUp : canScrollDown;
    }

    function rerouteWheelToPage(event) {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        // The builder owns its scrolling, including at a pane's boundary.
        // Its portal still reaches this window capture/React wheel handler.
        if (event.target?.closest?.('.alex-builder-overlay')) return;
        if (Math.abs(event.deltaY) < 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        if (!wrCanPageScroll()) return;

        let el = event.target;
        while (el && el !== document.body && el !== document.documentElement) {
            if (wrCanElementConsumeWheel(el, event.deltaY)) return;
            el = el.parentElement;
        }

        event.preventDefault();
        window.__WR_SCROLL_FALLBACK_LAST = { at: Date.now(), deltaY: event.deltaY };
        window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });
    }

    function resolvePlatformProvider(league) {
        const registry = window.App?.Platforms || window.Platforms;
        const registered = registry?.getForLeague?.(league);
        if (registered) return registered;

        const platform = league?._platform
            || (league?._mfl ? 'mfl' : league?._espn ? 'espn' : league?._yahoo ? 'yahoo' : 'sleeper');
        const fallbackProviders = {
            sleeper: window.Sleeper?.provider,
            mfl: window.MFL?.provider,
            espn: window.ESPN?.provider,
            yahoo: window.Yahoo?.provider,
        };
        const fallback = fallbackProviders[platform] || null;
        if (fallback && registry?.register) {
            registry.register(fallback);
        }
        return fallback;
    }

    function leagueTypeHeaderMeta(profile) {
        const type = window.App?.LeagueSkin?.normalizeType?.(profile?.type)
            || String(profile?.type || 'unknown').toLowerCase();
        const defs = {
            redraft: { label: 'Redraft', short: 'RD', color: 'var(--k-2ecc71, #2ecc71)', icon: 'reset' },
            keeper: { label: 'Keeper', short: 'KP', color: 'var(--k-7c6bf8, #7c6bf8)', icon: 'bookmark' },
            dynasty: { label: 'Dynasty', short: 'DY', color: 'var(--k-d4af37, #d4af37)', icon: 'crown' },
            best_ball: { label: 'Best Ball', short: 'BB', color: 'var(--k-3498db, #3498db)', icon: 'spark' },
            chopped: { label: 'Chopped', short: 'CHOP', color: 'var(--k-e74c3c, #e74c3c)', icon: 'scissors' },
            dfs: { label: 'DFS', short: 'DFS', color: 'var(--k-3498db, #3498db)', icon: 'spark' },
        };
        return defs[type] || { label: type && type !== 'unknown' ? type.replace(/_/g, ' ') : 'League Type Unknown', short: '?', color: 'var(--k-c7cdd7, #c7cdd7)', icon: 'circle' };
    }

    function LeagueTypeHeaderIcon({ meta }) {
        const common = {
            width: 14,
            height: 14,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
            style: { display: 'block', flexShrink: 0 },
        };
        const icon = meta?.icon || 'circle';
        if (icon === 'reset') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M4 7h10a6 6 0 1 1-4.2 10.2' }),
                React.createElement('path', { d: 'M7 4 4 7l3 3' })
            );
        }
        if (icon === 'bookmark') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z' })
            );
        }
        if (icon === 'crown') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'm3 7 5 4 4-7 4 7 5-4-2 12H5L3 7z' }),
                React.createElement('path', { d: 'M5 19h14' })
            );
        }
        if (icon === 'spark') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z' })
            );
        }
        if (icon === 'scissors') {
            return React.createElement('svg', common,
                React.createElement('circle', { cx: 6, cy: 7, r: 3 }),
                React.createElement('circle', { cx: 6, cy: 17, r: 3 }),
                React.createElement('path', { d: 'm8.7 8.3 10.8 7.2' }),
                React.createElement('path', { d: 'm8.7 15.7 3.3-2.2' }),
                React.createElement('path', { d: 'm14.5 10.5 5-3.3' })
            );
        }
        return React.createElement('svg', common,
            React.createElement('circle', { cx: 12, cy: 12, r: 7 })
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // END DRAFT TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ── League nav definition — SINGLE SOURCE OF TRUTH ──
    // Consumed by BOTH the sidebar drawer (LeagueDetail render) and the
    // phone bottom dock strip (PhoneDock below). Add/remove/gate items
    // here only. `{ section }` rows render as sidebar dividers and are
    // filtered out of the dock strip.
    // Glyphs = Lucide icon path data (ISC license, lucide.dev), flattened to
    // path-only form because every consumer maps plain <path d> elements
    // (rects/circles/polylines hand-converted to arcs). Owner ask 2026-07-12:
    // replace the hand-drawn set with a professional icon family.
    const NAV_ICON_PATHS = {
        // house
        home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
        // clipboard-list — a roster is a clipboard
        roster: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
        // zap
        gameday: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
        // scale — weighing two options
        compare: ['m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'M7 21h10', 'M12 3v18', 'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'],
        // arrow-right-left
        trade: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
        // dollar-sign
        fa: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
        // list-ordered — the draft order
        draft: ['M10 12h11', 'M10 18h11', 'M10 6h11', 'M4 10h2', 'M4 6h1v4', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
        // chart-column
        analytics: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
        stats: ['M3 3h18v18H3z', 'M3 9h18', 'M9 3v18', 'M15 9v12', 'M3 15h18'],
        // film
        film: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M21 7.5h-4', 'M21 16.5h-4'],
        // briefcase
        office: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
        // trophy
        trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
        // calendar
        calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M3 10h18'],
        // target
        strategy: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'],
        // settings (gear)
        settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
        // book-open — the reference key
        legend: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
        // refresh-cw
        refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
        // gauge — the league-wide hub/command view
        central: ['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'],
    };
    // One stable workspace map owns desktop, phone, search, and deep-link state.
    function buildLeagueNavItems(options) {
        const utilities = window.WR.LeagueWorkspaces.navigation(options);
        return [...utilities.filter(item => !item.utility), { section: 'UTILITIES' }, ...utilities.filter(item => item.utility)];
    }
    function navItemIsActive(item, activeTab) {
        return !!item.tab && item.workspace === window.WR.LeagueWorkspaces.resolve(activeTab).workspace;
    }
    // Task groups are shared by phone and desktop; workspace permissions still
    // decide which destinations are available in each format and viewport.
    function buildLeagueCommandGroups(options, navigation) {
        const W = window.WR.LeagueWorkspaces;
        const views = (navigation || W.navigation(options)).flatMap(item => W.views(item.workspace, options));
        const definitions = [
            { label: 'Your team', tabs: ['dashboard', 'lenses', 'myteam', 'lineup', 'team-outlook'] },
            { label: 'Market & draft', tabs: ['fa', 'trades', 'targets', 'market-review', 'draft', 'mock-draft', 'draft-review'] },
            { label: 'League & research', tabs: ['central', 'wire', 'stats', 'research-players', 'compare', 'research-reports', 'calendar', 'trophies'] },
            { label: 'Alex & tools', tabs: ['strategy', 'decisions', 'patterns', 'settings', 'gm-settings', 'legend'] },
        ];
        const groupedTabs = new Set(definitions.flatMap(group => group.tabs));
        const groups = definitions.map(group => ({ label: group.label, views: group.tabs.map(tab => views.find(view => view.tab === tab)).filter(Boolean) }));
        // New permitted destinations remain reachable before their group is curated.
        groups[groups.length - 1].views.push(...views.filter(view => !groupedTabs.has(view.tab)));
        return groups.filter(group => group.views.length > 0);
    }
    function DesktopCommandNav({ activeTab, workspaceOptions, onSelectTab }) {
        const W = window.WR.LeagueWorkspaces;
        const active = W.resolve(activeTab, workspaceOptions);
        const navigation = W.navigation(workspaceOptions);
        const definitions = [
            { label: 'Your team', ids: ['lenses', 'home', 'team'] },
            { label: 'Market & draft', ids: ['market', 'draft'] },
            { label: 'League & research', ids: ['league', 'research'] },
            { label: 'Tools', ids: ['settings', 'help'] },
        ];
        const grouped = new Set(definitions.flatMap(group => group.ids));
        const groups = definitions.map(group => ({ label: group.label, items: group.ids.map(id => navigation.find(item => item.workspace === id)).filter(Boolean) }));
        groups[groups.length - 1].items.push(...navigation.filter(item => !grouped.has(item.workspace)));
        return <nav className="wr-desktop-command" aria-label="Your command center">
            <h2 className="wr-desktop-command-title">Command center</h2>
            {groups.filter(group => group.items.length).map(group => <section key={group.label} className="wr-desktop-command-group" aria-label={group.label}>
                <h3>{group.label}</h3>
                {group.items.map(item => {
                    const selected = active.workspace === item.workspace;
                    const secondary = selected ? W.views(item.workspace, workspaceOptions).filter(view => view.tab !== item.tab) : [];
                    return <div key={item.workspace} className="wr-desktop-command-item" data-active={selected ? 'true' : undefined}>
                        <button type="button" className="wr-desktop-command-workspace"
                            aria-current={active.tab === item.tab ? 'page' : undefined}
                            onClick={() => onSelectTab(item.tab)}>{item.label}</button>
                        {secondary.length > 0 && <div className="wr-desktop-command-subviews" role="group" aria-label={item.label + ' views'}>
                            {secondary.map(view => <button key={view.tab} type="button" className="wr-desktop-command-view"
                                aria-current={active.tab === view.tab ? 'page' : undefined}
                                onClick={() => onSelectTab(view.tab)}>{view.label}</button>)}
                        </div>}
                    </div>;
                })}
            </section>)}
        </nav>;
    }

    // ── Phone bottom dock (≤767 only) ──
    // Four customizable destinations; the header menu keeps every permitted
    // view accessible. Hide the dock while typing. Fixed-layer tokens and
    // mission-control.css provide the safe-area and glass treatment.
    // The gate lives in this thin wrapper so PhoneDockInner's hooks
    // mount/unmount cleanly.
    function PhoneDock(props) {
        const vp = window.WR.useViewport();
        if (!vp.isPhone || vp.kbOpen) return null;
        return <PhoneDockInner {...props} />;
    }
    function PhoneDockInner({ activeTab, navItems, onSelectTab, workspaceOptions, onOpenLeagueOptions }) {
        const [moreOpen, setMoreOpen] = useState(false);
        const W = window.WR.LeagueWorkspaces;
        const preferenceKey = 'wr-phone-dock-v1:' + (workspaceOptions?.accountId || 'local') + ':' + (workspaceOptions?.leagueType || 'unknown');
        const readSaved = () => { try { return JSON.parse(localStorage.getItem(preferenceKey)); } catch (_) { return null; } };
        const [savedDock, setSavedDock] = useState(() => ({key:preferenceKey,tabs:readSaved()}));
        const [editingDock, setEditingDock] = useState(false);
        const [saveError, setSaveError] = useState(false);
        const selected = W.dockSelection(savedDock.key === preferenceKey ? savedDock.tabs : readSaved(), workspaceOptions);
        const choices = W.dockChoices(workspaceOptions);
        const chips = selected.map(tab => choices.find(item => item.tab === tab)).filter(Boolean);
        const menuGroups = buildLeagueCommandGroups(workspaceOptions, navItems.filter(item => item.tab));
        const menuButton = view => <button key={view.tab} type="button"
            aria-current={view.tab === activeTab ? 'page' : undefined}
            onClick={() => selectTab(view.tab)}><span>{view.label}</span><span aria-hidden="true">›</span></button>;
        const moreActive = !chips.some(item => item.tab === activeTab);
        const saveDock = tabs => {
            setSavedDock({key:preferenceKey,tabs});
            try { localStorage.setItem(preferenceKey,JSON.stringify(tabs)); setSaveError(false); } catch (_) { setSaveError(true); }
        };
        const toggleDock = tab => saveDock(selected.includes(tab) ? selected.filter(t => t !== tab) : selected.length < 4 ? [...selected,tab] : selected);
        const moveDock = (tab, direction) => {
            const next = [...selected], index = next.indexOf(tab), target = index + direction;
            if (target < 0 || target >= next.length) return;
            [next[index],next[target]] = [next[target],next[index]]; saveDock(next);
        };
        const selectTab = tab => { setMoreOpen(false); onSelectTab(tab); };

        useEffect(() => { setMoreOpen(false); }, [activeTab]);
        useEffect(() => {
            const openMenu = () => { setEditingDock(false); setMoreOpen(true); };
            window.addEventListener?.('wr:phone-menu', openMenu);
            return () => window.removeEventListener?.('wr:phone-menu', openMenu);
        }, []);


        return <React.Fragment>
            <nav className="wr-phone-dock" aria-label="Primary">
                <div className="wr-dock-strip" style={{ gridTemplateColumns: `repeat(${Math.max(1, chips.length)}, minmax(0, 1fr))` }}>
                    {chips.map(item => {
                        const isActive = item.tab === activeTab;
                        return <button key={item.tab} type="button"
                            className={'wr-dock-chip' + (isActive ? ' is-active' : '')}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => selectTab(item.tab)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {(NAV_ICON_PATHS[item.iconKey] || NAV_ICON_PATHS.home).map((d, i) => <path key={i} d={d} />)}
                            </svg>
                            <span>{item.tab === 'myteam' ? 'Roster' : item.tab === 'central' ? 'League' : item.label}</span>
                        </button>;
                    })}
                    {!chips.length && <button type="button" className={'wr-dock-chip' + (moreActive ? ' is-active' : '')}
                        aria-current={moreActive ? 'page' : undefined} aria-haspopup="dialog"
                        aria-expanded={moreOpen} aria-controls="wr-phone-more-menu" onClick={() => setMoreOpen(true)}>
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
                        <span>Customize navigation</span>
                    </button>}
                </div>
            </nav>
            {moreOpen && <window.WR.Sheet open={true} title="Your command center" onClose={() => setMoreOpen(false)}>
                <div id="wr-phone-more-menu" className="wr-phone-more-menu">
                    {!editingDock && <div className="wr-command-actions">
                        <button type="button" onClick={() => { setMoreOpen(false); window.dispatchEvent(new CustomEvent('wr:mission-alex-open')); }}>Chat with Alex</button>
                        {onOpenLeagueOptions && <button type="button" onClick={() => { setMoreOpen(false); onOpenLeagueOptions(); }}>League options</button>}
                    </div>}
                    <button className="wr-command-customize" type="button" onClick={() => setEditingDock(v => !v)} aria-expanded={editingDock}>{editingDock ? 'Back to command center' : 'Customize bottom menu'}</button>
                    {editingDock && <section aria-label="Customize bottom menu">
                        <p>Choose up to four destinations. The top-left menu always opens every view. Saved for this account and league format.</p>
                        <p>{selected.length} of 4 selected</p>
                        {selected.map((tab,index) => <div key={tab} className="wr-dock-order"><span>{choices.find(c=>c.tab===tab)?.label}</span><button type="button" disabled={index===0} aria-label={'Move ' + tab + ' left'} onClick={()=>moveDock(tab,-1)}>←</button><button type="button" disabled={index===selected.length-1} aria-label={'Move ' + tab + ' right'} onClick={()=>moveDock(tab,1)}>→</button></div>)}
                        {choices.map(item => <label key={item.tab} className="wr-dock-choice"><input type="checkbox" checked={selected.includes(item.tab)} disabled={!selected.includes(item.tab) && selected.length>=4} onChange={()=>toggleDock(item.tab)} />{item.label}</label>)}
                        <button type="button" onClick={()=>saveDock(W.dockDefaults(workspaceOptions))}>Reset to defaults</button>
                        {saveError && <p role="status">Changes apply for this visit. Device storage is unavailable.</p>}
                        <button type="button" onClick={()=>setEditingDock(false)}>Done</button>
                    </section>}

                    {!editingDock && <div className="wr-command-groups">
                        {menuGroups.map(group => {
                            return <section key={group.label} aria-label={group.label}>
                                <h2>{group.label}</h2>
                                <div className="wr-command-grid">{group.views.map(menuButton)}</div>
                            </section>;
                        })}
                    </div>}

                </div>
            </window.WR.Sheet>}
        </React.Fragment>;
    }

    // League Detail Component
    function LeagueDetail({ lensLeagues = [], lensPortfolioCoverage, league, onBack, onOpenAllWire, sleeperUserId, onOpenSettings, settingsProps = {}, activeTab: propActiveTab, onTabChange }) {
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [playersData, setPlayersData] = useState({});
        const [myRoster, setMyRoster] = useState(null);
        const [standings, setStandings] = useState([]);
        const [viewingOwnerId, setViewingOwnerId] = useState(sleeperUserId);
        const [statsData, setStatsData] = useState({});
        const [projectionsData, setProjectionsData] = useState({});
        const [stats2025Data, setStats2025Data] = useState({});
        const [currentLeague, setCurrentLeague] = useState(league);
        const [activeYear, setActiveYear] = useState(league.season);
        // Platform detection via the unified PlatformProvider registry.
        // Providers know whether they support historical year chains,
        // so feature flags like `isSleeper` (used for year switching UI)
        // are now derived from provider.capabilities instead of hardcoded.
        const _provider = resolvePlatformProvider(currentLeague);
        const isSleeper = _provider?.id === 'sleeper';
        const [trending, setTrending] = useState({ adds: [], drops: [] });
        const [localActiveTab, setLocalActiveTab] = useState('dashboard');
        const [helpContext, setHelpContext] = useState(null);
        const activeTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;
        const [gameDayEntry, setGameDayEntry] = useState(null);
        const gameDayScope = [currentLeague?.league_id || currentLeague?.id || '', currentLeague?.season || '', myRoster?.roster_id || ''].join('|');
        // Keep the entry view in the shell so it survives deferred module loading.
        // Ordinary navigation clears the intent; it never changes the default dock destination.
        const setActiveTab = React.useCallback((tab, options) => {
            setGameDayEntry(tab === 'lineup' && options?.view === 'matchup' ? { scope: gameDayScope, view: 'matchup', matchup: options.matchup || null } : null);
            (onTabChange || setLocalActiveTab)(tab);
        }, [onTabChange, gameDayScope]);
        // Browser history changes the controlled tab without calling the wrapper.
        React.useEffect(() => {
            setGameDayEntry(entry => activeTab !== 'lineup' || entry?.scope !== gameDayScope ? null : entry);
        }, [activeTab, gameDayScope]);
        const [tradeSubTab, setTradeSubTab] = useState(null); // when set, TradeCalcTab opens this sub-tab
        const [selectedPlayerPid, setSelectedPlayerPid] = useState(null);
        const [headerDraftInfo, setHeaderDraftInfo] = useState(null);
        const [headerClockNow, setHeaderClockNow] = useState(Date.now());

        // ── TIME CONTEXT — the temporal lens of the entire app ──
        // Single source of truth. All modules read timeYear and derived helpers.
        const currentSeason = parseInt(league.season) || new Date().getFullYear();
        const [timeYear, setTimeYear] = useState(() => {
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.TIME_YEAR);
            return saved !== null ? parseInt(saved) : currentSeason;
        });
        const [timeLoading, setTimeLoading] = useState(false);
        const [timeRecomputeTs, setTimeRecomputeTs] = useState(Date.now());
        const [basePlayersData, setBasePlayersData] = useState(null);

        useEffect(() => {
            const leagueId = currentLeague?.league_id || currentLeague?.id;
            if (!leagueId) return;
            let cancelled = false;
            // MFL leagues 404 on the Sleeper drafts endpoint (the id is 'mfl_<id>_<year>').
            // Source the status-bearing MFL draft objects instead so the header
            // "Draft Live" button appears + launches straight into the live draft.
            const isMfl = !!(currentLeague?._mfl || String(leagueId).startsWith('mfl_'));
            const fetchDrafts = isMfl
                ? (async () => {
                    try {
                        if (window.MFL?.fetchDraftStatus) {
                            const mlid = currentLeague._mflLeagueId || String(leagueId).replace(/^mfl_/, '').replace(/_\d+$/, '');
                            const yr = currentLeague.season || localStorage.getItem('mfl_year') || String(new Date().getFullYear());
                            const key = sessionStorage.getItem('mfl_api_key') || null;
                            const d = await window.MFL.fetchDraftStatus(mlid, yr, key, currentLeague);
                            if (Array.isArray(d) && d.length) return d;
                        }
                    } catch (e) { window.wrLog?.('leagueDetail.mflDraftStatus', e); }
                    return window.S?.drafts || currentLeague?.drafts || [];
                })
                : (window.Sleeper?.fetchDrafts || (async (lid) => {
                    const resp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/drafts');
                    return resp.ok ? resp.json() : [];
                }));
            fetchDrafts(leagueId)
                .then(rows => {
                    if (cancelled) return;
                    const drafts = Array.isArray(rows) ? rows : [];
                    // Draft-of-record rule (draft/state.js selectCurrentDraft):
                    // live > unsuperseded latest complete ('review') > next
                    // pre_draft — so a just-completed draft keeps a header entry
                    // point ('View Draft Results') instead of vanishing.
                    const sel = window.DraftCC?.state?.selectCurrentDraft?.(drafts);
                    // DraftCC lives in the deferred 'draft' module group and this
                    // effect runs once per league open — when it isn't loaded yet,
                    // mirror the draft-of-record rule locally (live > next
                    // pre_draft > most recently completed) so the completed-draft
                    // "View Draft Results" chip still renders without the module.
                    const localDraftOfRecord = () =>
                        drafts.find(d => d.status === 'drafting')
                        || drafts.find(d => d.status === 'pre_draft')
                        || drafts.filter(d => d.status === 'complete')
                            .sort((a, b) => (Number(b.last_picked || b.start_time || b.created) || 0)
                                - (Number(a.last_picked || a.start_time || a.created) || 0))[0]
                        || null;
                    const active = sel !== undefined ? (sel.draft || null) : localDraftOfRecord();
                    setHeaderDraftInfo(active);
                })
                .catch(() => { if (!cancelled) setHeaderDraftInfo(null); });
            return () => { cancelled = true; };
        }, [currentLeague?.league_id, currentLeague?.id]);

        useEffect(() => {
            if (!headerDraftInfo?.start_time || headerDraftInfo.status !== 'pre_draft') return;
            const id = setInterval(() => setHeaderClockNow(Date.now()), 60000);
            return () => clearInterval(id);
        }, [headerDraftInfo?.start_time, headerDraftInfo?.status]);

        const headerDraftClock = useMemo(() => {
            if (!headerDraftInfo) return null;
            if (headerDraftInfo.status === 'drafting') return { label: 'Draft Live', clock: 'Now' };
            // Completed draft of record: keep an entry point to the finished
            // board (DraftTab's _wrOpenLiveDraft flag path rebuilds the results).
            if (headerDraftInfo.status === 'complete') return { label: '', clock: 'View Draft Results' };
            if (!headerDraftInfo.start_time) return { label: 'Draft Upcoming', clock: 'Scheduled' };
            const diff = Number(headerDraftInfo.start_time) - headerClockNow;
            if (diff <= 0) return { label: 'Draft Upcoming', clock: 'Open' };
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return { label: 'Draft Upcoming', clock: (days > 0 ? days + 'd ' : '') + hours + 'h ' + mins + 'm' };
        }, [headerDraftInfo, headerClockNow]);

        // ── SeasonContext state — reactive data shared with tab components ──
        const [seasonCtxData, setSeasonCtxData] = useState({
            season: league.season || '',
            playerStats: {},
            tradedPicks: [],
            rosters: [],
            myRosterId: null,
            lastUpdated: 0,
        });
        const headerLeagueProfile = useMemo(() => {
            if (!currentLeague || typeof window.App?.Intelligence?.buildLeagueProfile !== 'function') return null;
            try {
                const rosters = seasonCtxData.rosters?.length ? seasonCtxData.rosters : (currentLeague.rosters || []);
                return window.App.Intelligence.buildLeagueProfile({
                    league: currentLeague,
                    rosters,
                    platform: currentLeague._platform || window.S?.platform,
                });
            } catch (err) {
                if (window.wrLog) window.wrLog('leagueHeader.profile', err);
                return null;
            }
        }, [
            currentLeague,
            currentLeague?.league_id,
            currentLeague?.id,
            currentLeague?.type,
            currentLeague?.league_type,
            currentLeague?.settings?.type,
            currentLeague?.roster_positions,
            currentLeague?.scoring_settings,
            seasonCtxData.lastUpdated,
        ]);
        const headerLeagueType = useMemo(() => leagueTypeHeaderMeta(headerLeagueProfile), [headerLeagueProfile]);
        const leagueSkin = useMemo(() => {
            if (!currentLeague || typeof window.App?.LeagueSkin?.build !== 'function') return null;
            const rosters = seasonCtxData.rosters?.length ? seasonCtxData.rosters : (currentLeague.rosters || []);
            return window.App.LeagueSkin.build({
                league: currentLeague,
                profile: headerLeagueProfile,
                rosters,
                myRoster,
                draft: headerDraftInfo,
                nflState: window.S?.nflState,
            });
        }, [
            headerLeagueProfile,
            currentLeague,
            currentLeague?.league_id,
            currentLeague?.id,
            currentLeague?.status,
            currentLeague?.settings?.type,
            currentLeague?.roster_positions,
            myRoster?.roster_id,
            headerDraftInfo?.draft_id,
            headerDraftInfo?.status,
            seasonCtxData.lastUpdated,
        ]);
        useEffect(() => {
            if (!leagueSkin || typeof window.App?.LeagueSkin?.setCurrent !== 'function') return;
            window.App.LeagueSkin.setCurrent(leagueSkin);
        }, [leagueSkin]);

        // ── VIEW MODE — Analyst is now the only mode (Brief tab replaces Flash Brief) ──
        const [viewMode, setViewMode] = useState('analyst');
        const isAnalyst = true;

        // Open full player modal instead of mini card
        // selectPlayer is exposed via SeasonContext AND kept on window for legacy consumers
        // Also aliased as openPlayerModal so flash-brief, global-view, etc. all use the same entry point.
        // SI-2: Unified PlayerCard (window.WR.openPlayerCard) is the primary surface.
        // Expose playersData/statsData globally so the unified card host can read them without prop drilling.
        useEffect(() => {
            window.App._playersCache = playersData;
            window._wrStatsData = statsData;
        }, [playersData, statsData]);
        const selectPlayer = useCallback((pid) => {
            // Close any existing inline card / legacy CDN modal first
            setSelectedPlayerPid(null);
            if (typeof window.closeFWPlayerModal === 'function') window.closeFWPlayerModal();
            setTimeout(() => {
                // Primary: unified War Room PlayerCard (SI-2)
                if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                    window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings || {} });
                    return;
                }
                // Fallbacks (kept for safety during rollout)
                if (typeof window.openFWPlayerModal === 'function') {
                    window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings || {});
                } else {
                    setSelectedPlayerPid(pid);
                }
            }, 10);
        }, [playersData, statsData, currentLeague]);
        window._wrSelectPlayer = selectPlayer;
        window.openPlayerModal = selectPlayer;
        // SI-2 deferred: expose nav + compare globals so the unified PlayerCard's action buttons work.
        window.wrNavigateTab = (tab) => { try { setActiveTab(tab); } catch (_) {} };
        window.wrOpenCompare = (pid) => {
            try {
                // Jump to My Roster → Compare view and pre-select the player's team when possible.
                setActiveTab('myteam');
                const roster = (currentLeague?.rosters || []).find(r => (r.players || []).concat(r.taxi || [], r.reserve || []).includes(String(pid)));
                if (roster) window._wrComparePreselect = roster.roster_id;
                // Defer dispatching a custom event so the tab has time to mount
                setTimeout(() => window.dispatchEvent(new CustomEvent('wr:open-compare', { detail: { pid, rosterId: roster?.roster_id } })), 50);
            } catch (_) { /* noop */ }
        };
        // Player-vs-player: open the Compare tab's Players mode and queue this player.
        // We persist the intent (player + scope) to the SAME localStorage keys
        // CompareTab reads on mount, so it survives any tab/mount churn — the
        // in-memory global + deferred event are just the already-mounted fast path.
        window.WR.PlayerCompareHandoff.discardStale(currentLeague, sleeperUserId);
        window.wrComparePlayers = (pid, options = {}) => {
            let replacement = null;
            try {
                const handoff = window.WR.PlayerCompareHandoff;
                const current = handoff.context(currentLeague, sleeperUserId);
                const requestSequence = window._wrPlayerCompareSerial = (window._wrPlayerCompareSerial || 0) + 1;
                const requestId = String(Date.now()) + ':' + String(requestSequence);
                if (Array.isArray(pid) || options.replace === true) {
                    const ids = handoff.playerIds(pid);
                    if (options.replace !== true || !ids.length || ids.some(id => !playersData?.[id])
                        || !['accountKey', 'leagueId', 'season'].every(key => String(options[key] ?? '') === current[key])
                        || options.platform != null && String(options.platform) !== current.platform) return false;
                    const target = { kind: 'players-replace', ...current, playerIds: ids, requestId, source: options.source || 'player-comparison' };
                    if (!handoff.matches(target, currentLeague, sleeperUserId)) return false;
                    replacement = target;
                    window._wrPlayerCompareTarget = target;
                    try { delete window._wrAddComparePlayer; } catch (_) { window._wrAddComparePlayer = null; }
                    setActiveTab('compare');
                    setTimeout(() => {
                        if (window._wrPlayerCompareTarget?.requestId !== requestId || !handoff.matches(target, currentLeague, sleeperUserId)) return;
                        window.dispatchEvent(new CustomEvent('wr:replace-compare-players', { detail: target }));
                    }, 50);
                    return true;
                }
                // Preserve the player card's additive single-player behavior.
                // A newer replacement or a changed context cancels its timer.
                handoff.clear(window._wrPlayerCompareTarget);
                const lid = currentLeague?.league_id || currentLeague?.id || '';
                if (pid != null && pid !== '') {
                    window._wrAddComparePlayer = String(pid);
                    if (lid) {
                        try {
                            const key = 'wr_compare_players_' + lid;
                            const list = JSON.parse(localStorage.getItem(key) || '[]').map(String);
                            if (!list.includes(String(pid))) list.push(String(pid));
                            localStorage.setItem(key, JSON.stringify(list.slice(0, 4)));
                            localStorage.setItem('wr_compare_scope_' + lid, 'players');
                        } catch (_) { /* storage best-effort */ }
                    }
                }
                setActiveTab('compare');
                setTimeout(() => {
                    if (window._wrPlayerCompareSerial !== requestSequence || !handoff.sameContext(current, currentLeague, sleeperUserId)) return;
                    window.dispatchEvent(new CustomEvent('wr:add-compare-player', { detail: { pid } }));
                }, 50);
                return true;
            } catch (_) {
                if (replacement) window.WR?.PlayerCompareHandoff?.clear(replacement);
                return false;
            }
        };

        useEffect(() => {
            if (window.S) window.S.activeTab = activeTab;
            window.OD?.track?.('module_viewed', {
                platform: 'warroom',
                leagueId: currentLeague?.league_id || currentLeague?.id || null,
                module: activeTab,
            });
        }, [activeTab, currentLeague?.league_id, currentLeague?.id]);

        // Derived selectors — modules use these, never compute their own
        const isCurrentYear = timeYear === currentSeason;
        const isFutureYear = timeYear > currentSeason;
        const isHistoricalYear = timeYear < currentSeason;
        const timeMode = isFutureYear ? 'future' : isHistoricalYear ? 'historical' : 'current';
        const timeModeLabel = isFutureYear ? 'Projection View' : isHistoricalYear ? 'Historical View' : 'Current Season';
        const timeModeColor = isFutureYear ? 'var(--k-3498db, #3498db)' : isHistoricalYear ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)';
        const timeDelta = timeYear - currentSeason; // positive = future, negative = past
        // Build available years from the league's actual previous_league_id chain
        const [leagueStartYear, setLeagueStartYear] = useState(currentSeason);
        useEffect(() => {
            let cancelled = false;
            async function walkChain() {
                // Only platforms with a previous_league_id chain (Sleeper)
                // can walk backwards — others fall back to a 4-year span.
                const prov = window.App?.Platforms?.getForLeague?.(currentLeague);
                if (!prov?.capabilities?.hasYearChain) {
                    if (!cancelled) setLeagueStartYear(currentSeason - 4);
                    return;
                }
                let lid = currentLeague?.id;
                let earliest = currentSeason;
                for (let y = currentSeason - 1; y >= 2018 && lid; y--) {
                    try {
                        const info = await fetchLeagueInfo(lid);
                        if (!info?.previous_league_id) break;
                        lid = info.previous_league_id;
                        earliest = y;
                    } catch { break; }
                }
                if (!cancelled) setLeagueStartYear(earliest);
            }
            walkChain();
            return () => { cancelled = true; };
        }, [currentLeague?.id]);
        const maxTimeYear = leagueSkin?.features?.showFuturePicks === false ? currentSeason : currentSeason + 2;
        const timeYears = [];
        for (let y = leagueStartYear; y <= maxTimeYear; y++) timeYears.push(y);
        useEffect(() => {
            if (timeYear <= maxTimeYear) return;
            handleTimeYearChange(currentSeason);
        }, [timeYear, maxTimeYear, currentSeason]);

        // Persist time year
        useEffect(() => { LeagueStorage.set(LEAGUE_WR_KEYS.TIME_YEAR, String(timeYear)); }, [timeYear]);

        // Validate shared dependencies from ReconAI CDN
        useEffect(() => {
            const deps = {
                'dynastyValue': typeof window.dynastyValue === 'function',
                'assessTeamFromGlobal': typeof window.assessTeamFromGlobal === 'function',
                'calcOptimalPPG': typeof window.App?.calcOptimalPPG === 'function',
                'getPlayerAction': typeof window.getPlayerAction === 'function',
                'peakWindows': !!window.App?.peakWindows,
                'normPos': typeof window.App?.normPos === 'function',
            };
            const missing = Object.entries(deps).filter(([, ok]) => !ok).map(([name]) => name);
            if (missing.length) {
                console.warn('[War Room] Missing shared dependencies:', missing.join(', '), '— some features may not work. Try refreshing.');
            }
        }, []);

        // Save base player data on first load (before any age projection)
        // Also expose on window.App for cross-module reads (SOS projection, trade-calc)
        useEffect(() => {
            if (Object.keys(playersData).length > 100) {
                window.App._playersCache = playersData;
                if (!basePlayersData) setBasePlayersData(playersData);
            }
        }, [playersData]);

        // ── SOS engine init — fires once playersData is populated ──
        useEffect(() => {
            if (Object.keys(playersData).length < 100) return;
            const season = String(parseInt(currentLeague?.season) || new Date().getFullYear());
            window.App.SOS?.initialize(season, playersData, () => {
                setTimeRecomputeTs(Date.now()); // trigger KPI + roster re-render
            });
        }, [playersData]);

        // ── PROJECTION ENGINE: canonical implementation lives in js/utils/player-value.js ──
        const projectPlayerValue = window.App.PlayerValue.projectPlayerValue;

        // ── LEGEND PANEL — explains War Room tools without revealing sauce ──
        function LegendPanel({ module = false } = {}) {
            const [open, setOpen] = React.useState(false);
            const [expanded, setExpanded] = React.useState(false);
            const [guideQuery, setGuideQuery] = React.useState('');
            const valueTerm = skinValueShort === 'DHQ' ? 'DHQ Value' : skinValueLabel;
            const rankTerm = skinShowsDynastyValue ? 'Dynasty Rank' : 'Asset Rank';
            const windowTerm = skinShowsAgeCurve ? 'Compete Window' : 'Season Window';
            const rosPointsHelp = { term: 'ROS pts', def: 'Projected fantasy points over the rest of the season, using your league scoring. For example, 15 points per game for 12 remaining games is about 180 ROS pts. This is not a 0–10,000 rating or a health score. Compare weekly projections and lineup gain for streaming decisions.' };
            const quickItems = [
                ...(!skinShowsDynastyValue ? [rosPointsHelp] : []),
                { term: valueTerm, def: skinShowsDynastyValue ? 'Dynasty value score (0-10,000). Production + age + situation + market.' : 'Value rating (0–10,000), not projected fantasy points. Accounts for production, role, scarcity, and market context. Separate from ROS pts and Health Score.' },
                { term: 'Health Score', def: 'Team grade (0-100). 90+ Elite, 80+ Contender, 70+ Crossroads.' },
                { term: 'Elite Player', def: '7000+ ' + skinValueShort + ' or top 5 at their position across all league rosters.' },
                { term: windowTerm, def: skinShowsAgeCurve ? 'Years until your weakest position group ages out.' : 'Current-season readiness for this league format.' },
                { term: 'Player Tags', def: 'Mark players as Trade Block, Cut, Untouchable, or Watch.' },
                { term: 'Flash Brief', def: 'Quick-action dashboard. Analyst mode shows deep data.' },
            ];
            const fullItems = [
                { cat: 'Find Your Workspace', items: [
                    { term: 'Home', def: 'Start with priority decisions, this week’s matchup, and upcoming dates. Open Game Day for your weekly lineup.' },
                    { term: 'My Team', def: 'Manage your roster and Game Day lineup. Team outlook explains the current assessment; GM plan sets your chosen direction. Decision review keeps your past decisions together.' },
                    { term: 'Market', def: 'Plan waivers, explore trades when your league allows them, and revisit saved targets. Roster coverage actions carry the position and week into your waiver plan.' },
                    { term: 'Draft', def: 'Prepare your board, practice, follow a live draft, and review results. Draft analysis contains historical position patterns and outcomes.' },
                    { term: 'League', def: 'Find standings, all matchups, league dates, Cup information, and history. Calendar dates marked Estimated need confirmation; custom reminders stay in this browser.' },
                    { term: 'Research', def: 'Explore sortable player Stats, players and picks, comparisons, and custom reports. Stats includes weekly views, ownership filters, and CSV export.' },
                    { term: 'Player Notebook', def: 'Personal notes and watch status follow a player across your leagues. League notes keep a separate private plan. Notes are saved for your account in this browser; draft board order stays with the draft.' },
                ]},
                { cat: skinShowsDynastyValue ? 'What DHQ Measures' : 'Points and value ratings', items: [
                    ...(!skinShowsDynastyValue ? [rosPointsHelp] : []),
                    { term: valueTerm, def: skinShowsDynastyValue ? 'A 0-10,000 dynasty value score. It blends production, projected role, age curve, positional scarcity, roster situation, market consensus, and format context. It is updated when you refresh league data.' : 'A 0–10,000 value rating for this season. It accounts for production, role, positional scarcity, and market context. It is not projected fantasy points or a health score. Use ROS pts for expected remaining-season scoring; use weekly projection and lineup gain for streaming decisions.' },
                    { term: 'Production Layer', def: 'Recent fantasy scoring, usage, playing time, and efficiency establish the floor. Current-season roles matter more in redraft, while multi-year stability carries more weight in dynasty.' },
                    { term: 'Context Layer', def: 'Team, depth chart, scoring settings, lineup slots, and replacement level adjust the raw player value. A scarce starter can gain value even if his box-score profile is similar to a deeper position.' },
                    { term: 'Market Layer', def: 'Market consensus, rank movement, roster ownership, and trade behavior help keep the number from becoming only a projection model. DHQ is meant to reflect what a player is worth in the room.' },
                ]},
                { cat: 'How To Read DHQ', items: [
                    { term: 'Elite Player', def: '7000+ ' + skinValueShort + ' or a top-5 positional rank across the league. These are anchor assets; losing one usually changes the direction of a roster or trade package.' },
                    { term: 'Starter Band', def: 'Roughly 3500-6999 ' + skinValueShort + ' is the weekly starter and premium depth range. Compare players inside the same position and format before treating two numbers as equal.' },
                    { term: 'Depth Band', def: 'Roughly 1000-3499 ' + skinValueShort + ' usually means usable depth, upside bench pieces, short-term streamers, or rookies/prospects who still need the role to arrive.' },
                    { term: 'Replacement Band', def: 'Below 1000 ' + skinValueShort + ' is usually waiver-wire, injury stash, speculative bench, or low-certainty IDP depth. The name can still matter, but the number is warning you not to overpay.' },
                ]},
                { cat: 'What Moves DHQ', items: [
                    { term: 'Role Change', def: 'Depth-chart promotion, target share, route participation, snap share, injury replacement, or defensive alignment changes can move value quickly.' },
                    { term: 'Age And Window', def: skinShowsAgeCurve ? 'Age curve matters because dynasty value prices future seasons. RB declines usually hit earlier than WR/TE, and QB value can stay durable much longer.' : 'Age still matters, but redraft weights this season much more heavily than long-term decline. Role and weekly ceiling should beat distant age-curve concerns.' },
                    { term: 'Risk', def: 'Injury status, volatile usage, unstable quarterback play, committee backfields, defensive rotation, suspension risk, and contract uncertainty all pressure the value down.' },
                    { term: 'Format', def: 'PPR, TE premium, Superflex, IDP, kicker, D/ST, lineup depth, and bench size all change replacement level. DHQ should be read through this league, not as a universal player rank.' },
                ]},
                { cat: 'What DHQ Is Not', items: [
                    { term: 'Not A Projection Only', def: 'A player can project well this week and still carry lower DHQ if the role is fragile, the market is thin, or the roster value is hard to trade later.' },
                    { term: 'Not A Trade Price Alone', def: 'Trade offers also depend on partner needs, owner behavior, leverage, timing, and package shape. DHQ is the value anchor, not the whole negotiation.' },
                    { term: 'Not A Blind Sort', def: 'Use DHQ to build a shortlist, then check position need, tier breaks, lineup rules, health, and roster construction. The best move is often the best tier fit, not just the highest number.' },
                ]},
                { cat: 'Team Assessment', items: [
                    { term: 'Health Score', def: 'Your team\u2019s competitive readiness on a 0-100 scale. 60% is based on your optimal starting lineup strength, 40% on positional depth and coverage. 90+ = Elite tier, 80+ = Contender, 70+ = Crossroads.' },
                    { term: 'Contender Rank', def: 'How you stack up for winning THIS season. Based on your best possible starting lineup PPG compared to every other team in the league.' },
                    { term: rankTerm, def: skinShowsDynastyValue ? 'Your long-term foundation strength. Based on total ' + skinValueShort + ' value across your entire roster - starters, bench, taxi, and picks.' : 'Your format-adjusted roster strength. Based on total ' + skinValueShort + ' value across your active roster context.' },
                    { term: windowTerm, def: skinShowsAgeCurve ? 'How many more years your roster can realistically compete before age-related decline forces a rebuild. Based on the age curves of your weakest position group.' : 'How ready your roster is for the current season format, without forcing a multi-year age-curve read.' },
                ]},
                { cat: 'Trading And Tools', items: [
                    { term: 'Owner DNA', def: 'A behavioral profile derived from each owner\u2019s trade history. Types include Fleecer, Stalwart, Dominator, Acceptor, and Desperate. It helps estimate how hard a deal will be to close.' },
                    { term: 'Trade Impact', def: 'Before you send a trade, see exactly how it changes your health score, elite count, positional leverage, and competitive tier. Simulates the roster swap and recalculates the team.' },
                    { term: 'Acceptance Likelihood', def: 'Predicted chance the other owner accepts your offer, based on value difference, their DNA type, positional needs, package shape, and owner behavior.' },
                    { term: 'Fit Score', def: 'How well a draft or waiver target fills your specific roster needs. A team thin at RB will see RB options scored higher than a team already overloaded there.' },
                    { term: 'Player Tags', def: 'Mark players as Trade Block, Cut, Untouchable, or Watch List to keep your roster decisions in view.' },
                ]},
	            ];
	            if (module) {
                    const matches = item => (item.term + ' ' + item.def).toLowerCase().includes(guideQuery.trim().toLowerCase());
                    const filteredSections = fullItems.map(section => ({ ...section, items: section.items.filter(matches) })).filter(section => section.items.length);
                    if (alexPhone) {
                        return <div className="wr-phone-guide">
                            {helpContext && <div className="wr-phone-guide-context"><strong>Help with {helpContext.label}</strong><button type="button" onClick={() => setActiveTab(helpContext.tab)}>Back to {helpContext.label}</button></div>}
                            <label className="wr-help-search">Find a tool or term<input type="search" value={guideQuery} onChange={event => setGuideQuery(event.target.value)} placeholder="Search values, trades, waivers…" /></label>
                            {!filteredSections.length && <p role="status">No matching terms. Try a different word.</p>}
                            {filteredSections.map(section => <window.WR.MobileSection key={section.cat + (!!guideQuery)} phone={true} title={section.cat} summary={section.items.length + ' topics'} defaultOpen={!!guideQuery}><dl>{section.items.map(item => <div key={item.term}><dt>{item.term}</dt><dd>{item.def}</dd></div>)}</dl></window.WR.MobileSection>)}
                        </div>;
                    }
	                return React.createElement('div', { style: { padding: '10px 16px 16px', maxWidth: '1280px', margin: '0 auto' } },
                        React.createElement('label', { className: 'wr-help-search' }, 'Find a tool or term', React.createElement('input', { type: 'search', value: guideQuery, onChange: event => setGuideQuery(event.target.value), placeholder: 'Search values, trades, waivers…' })),
                        !filteredSections.length && React.createElement('p', { role: 'status' }, 'No matching terms. Try a different word.'),
	                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '14px' } },
	                        ...quickItems.filter(matches).map(item => React.createElement('div', { key: item.term, style: { padding: '12px 13px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: 'var(--card-radius-sm, 8px)' } },
	                            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-body)', marginBottom: '4px' } }, item.term),
	                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.45 } }, item.def)
	                        ))
	                    ),
	                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '12px' } },
	                        ...filteredSections.map(section => React.createElement('section', { key: section.cat, style: { padding: '13px 14px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: 'var(--card-radius-sm, 8px)' } },
	                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', letterSpacing: '0.08em', marginBottom: '10px', textTransform: 'uppercase' } }, section.cat),
	                            ...section.items.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '10px' } },
	                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 800, color: 'var(--white)', marginBottom: '2px' } }, item.term),
	                                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.42 } }, item.def)
	                            ))
	                        ))
	                    )
	                );
	            }
	            return React.createElement('div', { style: { marginBottom: '8px' } },
                React.createElement('button', {
                    onClick: () => setOpen(!open),
                    style: { width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', letterSpacing: '0.03em', textAlign: 'left' },
                    onMouseEnter: e => { e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; },
                    onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }
                }, open ? '\u25BC' : '\u25B6', ' Legend'),
                open && React.createElement('div', { style: { padding: '8px 12px', maxHeight: '300px', overflowY: 'auto' } },
                    React.createElement('button', {
                        onClick: () => setExpanded(true),
                        style: { width: '100%', marginBottom: '10px', padding: '6px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-xs, 5px)', color: 'var(--gold)', cursor: 'pointer' }
                    }, 'FULL GUIDE \u2192'),
                    ...quickItems.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '8px' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)' } }, item.term),
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.4, marginTop: '1px' } }, item.def)
                    ))
                ),
                // Expanded modal overlay — theme-aware so it remains readable in light mode
                expanded && React.createElement('div', {
                    onClick: () => setExpanded(false),
                    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
                },
                    React.createElement('div', {
                        onClick: e => e.stopPropagation(),
                        style: { background: 'var(--off-black)', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-lg, 14px)', width: '100%', maxWidth: '640px', maxHeight: '80vh', overflowY: 'auto', padding: '24px 28px' }
                    },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '0.06em' } }, 'DYNASTY HQ GUIDE'),
                            React.createElement('button', { onClick: () => setExpanded(false), style: { background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1.2rem' } }, '\u2715')
                        ),
                        React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4, marginBottom: '20px' } }, 'Dynasty HQ analyzes this league format to give you an edge in every decision - trades, drafts, waivers, and roster construction. Here\u2019s what every tool and metric means.'),
                        ...fullItems.map(section => React.createElement('div', { key: section.cat, style: { marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', paddingBottom: '4px', marginBottom: '10px' } }, section.cat),
                            ...section.items.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '12px' } },
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)' } }, item.term),
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4, marginTop: '2px' } }, item.def)
                            ))
                        ))
                    )
                )
            );
        }

        // ── REACTIVE: when timeYear changes, refetch + recompute everything ──
        useEffect(() => {
            if (!basePlayersData || !Object.keys(basePlayersData).length) return;
            let cancelled = false;
            setTimeLoading(true);

            (async () => {
                try {
                    // 1. Fetch stats for selected year (historical has real data, future returns empty)
                    const newStats = await fetchSeasonStats(String(timeYear)).catch(() => ({}));
                    if (cancelled) return;

                    // 2. Update stats state
                    setStatsData(newStats);

                    // 3. Compute projected player data with age progression + DHQ projection
                    const delta = timeYear - currentSeason;
                    const baseLI = window.App?.LI;

                    // CRITICAL: always read from backup (original scores), never from potentially-projected current scores
                    if (baseLI && !baseLI._baseScoresBackup && baseLI.playerScores) {
                        baseLI._baseScoresBackup = { ...baseLI.playerScores };
                    }
                    const originalScores = baseLI?._baseScoresBackup || baseLI?.playerScores || {};

                    if (delta !== 0) {
                        // A. Build projected players with age advancement + projected DHQ as field
                        const projScores = {};
                        const projected = {};
                        Object.entries(basePlayersData).forEach(([pid, p]) => {
                            const baseAge = p.age || 0;
                            const projAge = baseAge ? baseAge + delta : 0;
                            const baseDhq = originalScores[pid] || 0;
                            // Only the scored players (a few hundred-thousand of the
                            // ~12k DB) need the per-year projection math + stats
                            // lookup. projectPlayerValue returns baseDhq unchanged
                            // when baseDhq <= 0, so skipping it for zero-score players
                            // is byte-identical while avoiding ~10k wasted passes per
                            // time-machine tick.
                            let projDhq;
                            if (baseDhq > 0) {
                                // Derive YoY trend from prevAvg vs seasonAvg when both are available
                                const pStats = window.S?.playerStats?.[pid];
                                const trendMeta = (() => {
                                    const prev = pStats?.prevAvg;
                                    const cur  = pStats?.seasonAvg;
                                    if (prev > 0 && cur > 0) return { trend: (cur - prev) / prev };
                                    return undefined;
                                })();
                                projDhq = projectPlayerValue(pid, baseDhq, baseAge, p.position || '', delta, trendMeta);
                            } else {
                                projDhq = baseDhq;
                            }
                            projScores[pid] = projDhq;
                            projected[pid] = {
                                ...p,
                                age: projAge || p.age,
                                _projected: true,
                                _baseDhq: baseDhq,
                                _projDhq: projDhq,
                                _delta: delta
                            };
                        });

                        // B. Update playersData state (triggers all child re-renders)
                        setPlayersData(projected);

                        // C. Write projected scores to LI.playerScores — THE source all modules read
                        if (baseLI) {
                            baseLI.playerScores = projScores;
                            baseLI._projectedYear = timeYear;

                            // Debug: log projections
                            if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
                                const samples = Object.entries(projScores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 5);
                                console.log('[TimeContext] Projected DHQ (delta=' + delta + '):');
                                samples.forEach(([pid, projDhq]) => {
                                    const bp = basePlayersData[pid];
                                    const bd = originalScores[pid] || 0;
                                    console.log('  ' + (bp?.full_name || pid) + ': age ' + (bp?.age||'?') + '\u2192' + ((bp?.age||0)+delta) + ', DHQ ' + bd + '\u2192' + projDhq + ' (' + (projDhq >= bd ? '+' : '') + (projDhq - bd) + ')');
                                });
                            }
                        }
                    } else {
                        // Restore base data — original ages and original DHQ scores
                        setPlayersData(basePlayersData);
                        if (baseLI && baseLI._baseScoresBackup) {
                            baseLI.playerScores = { ...baseLI._baseScoresBackup };
                            delete baseLI._projectedYear;
                        }
                    }

                    // D. Also override the dynastyValue() function's source for this render cycle
                    // dynastyValue reads from LI.playerScores which we just updated above.
                    // Clear assessTeamFromGlobal cache so health scores recompute with fresh data.
                    if (window.assessTeamFromGlobal?._cache) window.assessTeamFromGlobal._cache = {};
                    if (window.assessAllTeamsFromGlobal?._cache) window.assessAllTeamsFromGlobal._cache = {};
                    if (window.S) {
                        window.S._timeContextTs = Date.now();
                    }

                    // 4. Update window.S (write-through cache for ReconAI bridge)
                    if (window.S) {
                        window.S.season = String(timeYear);
                        window.S.playerStats = {};
                        Object.entries(newStats).forEach(([pid, s]) => {
                            window.S.playerStats[pid] = {};
                            const pts = typeof calcRawPts === 'function' ? calcRawPts(s) : (s.pts_half_ppr || 0);
                            const gp = s.gp || 0;
                            window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                            window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                            window.S.playerStats[pid].prevRawStats = s;
                        });
                        // Mirror to SeasonContext
                        setSeasonCtxData(prev => ({
                            ...prev,
                            season: String(timeYear),
                            playerStats: window.S.playerStats,
                            lastUpdated: Date.now(),
                        }));
                    }

                    // 5. Force analytics recompute
                    setAnalyticsData(null);

                    // 6. Force ranked teams recompute by bumping timestamp
                    setTimeRecomputeTs(Date.now());

                } catch(e) { console.warn('Time context data load error:', e); }
                if (!cancelled) setTimeLoading(false);
            })();

            return () => { cancelled = true; };
        }, [timeYear, basePlayersData]);

        // handleTimeYearChange is now just a setter — the effect does the work
        function handleTimeYearChange(year) {
            if (year === timeYear) return;
            setTimeYear(year);
            setActiveYear(String(year));
        }
        const [analyticsData, setAnalyticsData] = useState(null);
        const [analyticsTab, setAnalyticsTab] = useState('roster');
        const [rosterFilter, setRosterFilter] = useState('All');
        const [rosterSort, setRosterSort] = useState({ key: 'sleeper', dir: 1 });
        const defaultRosterCols = ['pos','age','dhq','posRankLg','ppg','durability','peak','action','sos'];
        const [visibleCols, setVisibleCols] = useState(() => {
            const stored = LeagueStorage.get(LEAGUE_WR_KEYS.ROSTER_COLS);
            const legacyDefault = ['pos','age','dhq','ppg','trend','action'];
            if (Array.isArray(stored) && stored.length) {
                const wasLegacyDefault = stored.length === legacyDefault.length && stored.every((key, idx) => key === legacyDefault[idx]);
                return wasLegacyDefault ? defaultRosterCols : stored;
            }
            return defaultRosterCols;
        });
        const [showColPicker, setShowColPicker] = useState(false);
        const [colPreset, setColPreset] = useState('default');
        const [expandedPid, setExpandedPid] = useState(null);
        const [avatarKey, setAvatarKey] = useState(0); // force re-render when avatar changes
        const [transactions, setTransactions] = useState([]);
        const [rankedTeams, setRankedTeams] = useState([]);
        const [dhqStatus, setDhqStatus] = useState({ loading: false, step: '', progress: 0 });
        const [loadStage, setLoadStage] = useState('');
        const [editingKpi, setEditingKpi] = useState(null); // index being edited, null = not editing
        const [leagueSelectedTeam, setLeagueSelectedTeam] = useState(null);
        const [leagueSort, setLeagueSort] = useState('health');
        const [leagueViewMode, setLeagueViewMode] = useState('roster');
        // Compare was promoted to its own top-level tab (js/tabs/compare.js) — it
        // owns its local compareTeamId state. myTeamView no longer needed now that
        // My Roster doesn't host a Compare sub-view.
        const [leagueViewTab, setLeagueViewTab] = useState('overview'); // top-level: overview | analyst
        const [leagueSubView, setLeagueSubView] = useState('teams'); // sub-tabs below the overview
        const [lpSort, setLpSort] = useState({ key: 'dhq', dir: 1 });
        const [lpFilter, setLpFilter] = useState('');
        const skinShowsDynastyValue = leagueSkin ? leagueSkin.features?.showDynastyValue !== false : true;
        const skinShowsAgeCurve = leagueSkin ? leagueSkin.features?.showAgeCurve !== false : true;
        const skinValueShort = leagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const skinValueLabel = leagueSkin?.vocabulary?.valueLabel || 'DHQ Value';

        // Core KPI metadata — used by computeKpiValue and module widgets
        const KPI_OPTIONS = {
            'health-score':   { label: 'Health Score',    icon: '', category: 'Roster',   tip: 'Blended score: 60% scoring power (contender) + 40% position coverage. 90+=Elite, 80+=Contender, 70+=Crossroads' },
            'avg-age':        { label: skinValueShort + '-Wtd Age', icon: '', category: 'Roster', tip: skinValueShort + '-weighted average age. ' + (skinShowsAgeCurve ? 'Lower = longer roster window' : 'Useful context for short-term roster balance') },
            'elite-count':    { label: 'Elite Players',   icon: '', category: 'Roster',   tip: 'Players with 7000+ ' + skinValueShort + ' or a top-5 rank at their position league-wide. These are your cornerstone assets.' },
            'aging-cliff':    { label: 'Aging Cliff %',   icon: '', category: 'Roster',   tip: '% of ' + skinValueShort + ' held by players past their value window' },
            'bench-quality':  { label: 'Bench Quality',   icon: '', category: 'Roster',   tip: 'Average ' + skinValueShort + ' of non-starter roster players' },
            'contender-rank': { label: 'Contender Rank',  icon: '', category: 'League',   tip: 'Win-now rank based on optimal starting lineup PPG vs league. How competitive are you THIS season?' },
            'dynasty-rank':   { label: skinShowsDynastyValue ? 'Dynasty Rank' : 'Asset Rank', icon: '', category: 'League', tip: skinShowsDynastyValue ? 'Long-term rank based on total roster ' + skinValueShort + ' value. How strong is your dynasty foundation?' : 'Format-adjusted rank based on total roster value.' },
            'window':         { label: skinShowsAgeCurve ? 'Compete Window' : 'Season Window', icon: '', category: 'Projection', tip: skinShowsAgeCurve ? 'Estimated years your roster can compete based on age decay' : 'Current-season readiness based on format-adjusted roster context' },
            'hit-rate':       { label: 'Trade Win Rate',  icon: '', category: 'Trades',   tip: 'Percentage of trades where you gained value (won or fair)' },
            'net-trade':      { label: 'Net ' + skinValueShort + '/Trade', icon: '', category: 'Trades', tip: 'Average ' + skinValueShort + ' gained or lost per trade' },
            'trade-velocity': { label: 'Trade Velocity',  icon: '', category: 'Trades',   tip: 'Number of trades completed this season' },
            'pick-capital':   { label: 'Pick Capital',    icon: '', category: 'Draft',    tip: 'Total value of your draft picks across next 3 seasons. Includes traded picks.' },
            'draft-roi':      { label: 'Draft ROI',       icon: '', category: 'Draft',    tip: 'Current DHQ of drafted players vs capital spent' },
            'faab-efficiency':{ label: 'FAAB Remaining',  icon: '', category: 'Waivers',  tip: 'Remaining FAAB budget available for waiver claims' },
            'transaction-ticker': { label: 'Transaction Ticker', icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Recent league transactions: trades, waivers, and free agent moves' },
            'league-standings':   { label: 'League Standings',   icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Current league standings with W-L records and DHQ totals' },
        };
        // Overview stays curated. Saved custom layouts belong to Lenses and
        // remain available as migration input without changing the landing view.
        const leagueWidgetLayout = window.App.DashboardLeagueLayout;
        const widgetScope = leagueWidgetLayout.leagueId(currentLeague);
        const widgetAccountScope = window.WR.DashboardBuilder.scopeFor(widgetScope, sleeperUserId);
        const DEFAULT_WIDGETS = [
            { id: 'dw0', key: 'intel-brief', size: 'xl' },
            ...leagueWidgetLayout.defaults(),
            { id: 'dw_calendar', key: 'league-calendar', size: 'md' },
            { id: 'dw_team', key: 'roster-pulse', size: 'md', primaryMetric: 'health-score' },
        ];
        const overviewWidgets = leagueSkin?.type === 'redraft' || leagueSkin?.type === 'chopped'
            ? [...DEFAULT_WIDGETS, { id: 'rfw5', key: 'lineup-check', size: 'md' }, { id: 'rfw7', key: 'analyst-mock', size: 'sm' }]
            : DEFAULT_WIDGETS;
        // Migrate legacy formats to current widget object format
        function migrateKpisToWidgets(stored) {
            if (!stored || !Array.isArray(stored)) return DEFAULT_WIDGETS;
            if (stored.length === 0) return DEFAULT_WIDGETS;
            let widgets;
            // Old format v1: array of KPI key strings
            if (typeof stored[0] === 'string') {
                const keyToModule = {
                    'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                    'aging-cliff': 'roster', 'bench-quality': 'roster',
                    'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                    'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                    'pick-capital': 'draft', 'draft-roi': 'draft',
                    'faab-efficiency': 'waivers',
                    'transaction-ticker': 'transaction-ticker',
                    'league-standings': 'league-standings',
                };
                widgets = stored.map((k, i) => ({ id: 'mig_' + i, key: keyToModule[k] || k, size: 'sm', primaryMetric: k }));
            } else {
	                // Old format v2: {key, size} without id or primaryMetric
	                widgets = stored.map((w, i) => {
	                    if (!w.id) w = { ...w, id: 'mig2_' + i };
	                    if (w.key === 'field-notes' && w.id === 'dw1' && w.size === 'narrow') {
	                        w = { ...w, size: 'slim' };
	                    }
	                    // Map old KPI keys to module keys
                    const legacyKpiModules = {
                        'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                        'aging-cliff': 'roster', 'bench-quality': 'roster', 'portfolio': 'roster',
                        'top5-conc': 'roster', 'starter-gap': 'roster', 'roster-turnover': 'roster',
                        'sched-sos': 'roster',
                        'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                        'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                        'trade-leverage': 'trading', 'partner-wr': 'trading',
                        'pick-capital': 'draft', 'draft-roi': 'draft',
                        'faab-efficiency': 'waivers',
                        'playoff-record': 'competitive', 'playoff-winpct': 'competitive',
                        'champ-appearances': 'competitive', 'dynasty-score': 'competitive',
                    };
                    if (legacyKpiModules[w.key]) {
                        return { ...w, primaryMetric: w.primaryMetric || w.key, key: legacyKpiModules[w.key] };
                    }
                    return w;
                });
            }
            // v3 migration: when the Brief tab was folded into Dashboard, existing
            // users lost their access point to Alex's briefing. Auto-prepend the
            // intelligence-brief widget once if it's not already in their layout.
            // Users who explicitly remove it will keep it removed (the new entry
            // will be persisted to storage by the useEffect below).
            if (!widgets.some(w => w.key === 'intel-brief' || w.key === 'intelligence-brief')) {
                widgets = [{ id: 'mig3_brief', key: 'intel-brief', size: 'xl' }, ...widgets];
            }
            return widgets;
        }
        const loadWidgetLayout = () => {
            const dashboard = window.WR.DashboardBuilder.readSaved(widgetAccountScope);
            if (dashboard) {
                try { return window.WR.DashboardBuilder.validateLayout(dashboard.layout, window.WR.DashboardBuilder.catalog(WIDGET_MODULES)); }
                catch (error) { window.wrLog?.('dashboard.saved-layout', error); }
            }
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.KPI_SELECTION(widgetScope));
            if (!Array.isArray(saved) || !saved.length) return [];
            const migrated = LeagueStorage.get(leagueWidgetLayout.marker(widgetScope), false);
            if (migrated && Array.isArray(saved) && !saved.length) return [];
            const stored = window.WR.LeagueWorkspaces.upgradeStarter(migrateKpisToWidgets(saved), DEFAULT_WIDGETS, leagueWidgetLayout.defaults());
            return migrated ? stored : leagueWidgetLayout.addMissing(stored);
        };
        const [selectedWidgets, setSelectedWidgets] = useState(loadWidgetLayout);
        const [widgetLayoutScope, setWidgetLayoutScope] = useState(widgetAccountScope);
        useEffect(() => {
            if (widgetLayoutScope === widgetAccountScope) return;
            setSelectedWidgets(loadWidgetLayout());
            setWidgetLayoutScope(widgetAccountScope);
        }, [widgetAccountScope, widgetLayoutScope]);
        // Legacy layouts are read only for the one-time lens migration.
        // Lens changes are account-scoped and never rewrite shared preferences.

        // Home summarizes the owner's decisions; League contains the full competition view.
        // Old tab identifiers are resolved without losing their selected report.
        // Shared phone tier also controls route visibility and workspace labels.
        const alexVp = window.WR.useViewport();
        const alexPhone = alexVp.isPhone;
        const workspaceOptions = {
            isPhone: alexPhone,
            showGameDay: leagueSkin?.features?.showGameDay ?? (leagueSkin?.phase === 'in_season'),
            showTrades: leagueSkin?.features?.showTrades,
            showGmOffice: leagueSkin?.type !== 'chopped',
            leagueType: leagueSkin?.type,
            accountId: sleeperUserId,
            legacyAnalyticsView: analyticsTab,
        };
        const workspaceRoute = window.WR.LeagueWorkspaces.resolve(activeTab, workspaceOptions);
        const viewTab = workspaceRoute.tab;
        const workspace = window.WR.LeagueWorkspaces.workspace(viewTab, workspaceOptions);
        const workspaceViews = window.WR.LeagueWorkspaces.views(workspace.id, workspaceOptions);
        // Resolve unsupported views at render time without rewriting a bookmarked
        // destination while league/season capabilities are still loading.

        useEffect(() => {
            LeagueStorage.set(LEAGUE_WR_KEYS.ROSTER_COLS, visibleCols);
        }, [visibleCols]);

        function computeKpiValue(kpiKey) {
            const LI = window.App?.LI || {};
            // Format-aware: ROS values in redraft, dynasty elsewhere.
            const scores = (window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : null) || LI.playerScores || {};
            const myPlayers = myRoster?.players || [];
            const profile = LI.ownerProfiles?.[myRoster?.roster_id];
            switch(kpiKey) {
                case 'contender-rank': {
                    // PPG-based rank — how competitive are you right now?
                    const league2 = currentLeague;
                    const rp = league2?.roster_positions || [];
                    const ppgRanks = (league2.rosters || []).map(r => {
                        const ppg = typeof window.App?.calcOptimalPPG === 'function'
                            ? window.App.calcOptimalPPG(r.players || [], playersData, window.S?.playerStats || {}, rp)
                            : 0;
                        return { rid: r.roster_id, ppg };
                    }).sort((a, b) => b.ppg - a.ppg);
                    // Offseason fallback: if all PPGs are 0, estimate from DHQ values
                    if (ppgRanks.every(r => r.ppg === 0)) {
                        ppgRanks.forEach(r => {
                            const roster = (currentLeague.rosters || []).find(ros => ros.roster_id === r.rid);
                            const totalDHQ = (roster?.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                            r.ppg = Math.round(totalDHQ / 550); // Same fallback as health score
                        });
                        ppgRanks.sort((a, b) => b.ppg - a.ppg);
                    }
                    const myPPG = ppgRanks.find(r => r.rid === myRoster?.roster_id)?.ppg || 0;
                    const cRank = ppgRanks.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allPPGs = ppgRanks.map(r => r.ppg).sort((a, b) => a - b);
                    return { value: '#' + (cRank || '?') + '/' + standings.length, sub: myPPG > 0 ? 'Win-now rank by ' + myPPG.toFixed(1) + ' PPG' : 'Win-now rank by starter PPG', color: cRank <= 3 ? 'var(--k-2ecc71, #2ecc71)' : cRank <= 6 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allPPGs };
                }
                case 'dynasty-rank': {
                    // Total DHQ rank — long-term dynasty strength (players + pick capital)
                    const dVals = (currentLeague.rosters || []).map(r => {
                        const playerDHQ = (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                        // Add pick capital value
                        let pickDHQ = 0;
                        {
                            const totalTeams = (currentLeague.rosters || []).length || 16;
                            const draftRounds = currentLeague.settings?.draft_rounds || 5;
                            const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                            for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                                for (let rd = 1; rd <= draftRounds; rd++) {
                                    const pv = typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                    const tradedAway = (window.S?.tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                                    if (!tradedAway) pickDHQ += pv;
                                    const acquired = (window.S?.tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                                    acquired.forEach(() => { pickDHQ += pv; });
                                }
                            }
                        }
                        return { rid: r.roster_id, total: playerDHQ + pickDHQ };
                    }).sort((a, b) => b.total - a.total);
                    const myDTotal = dVals.find(r => r.rid === myRoster?.roster_id)?.total || 0;
                    const dRank = dVals.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allDVals = dVals.map(r => r.total).sort((a, b) => a - b);
                    return { value: '#' + (dRank || '?') + '/' + standings.length, sub: myDTotal > 0 ? Math.round(myDTotal / 1000) + 'K total assets' : 'Dynasty rank', color: dRank <= 3 ? 'var(--k-2ecc71, #2ecc71)' : dRank <= 6 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allDVals };
                }
                case 'portfolio': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    // Spark: all team totals for league comparison
                    const allTotals = (currentLeague.rosters || []).map(r => (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0)).sort((a,b) => a-b);
                    return { value: total.toLocaleString(), sub: 'Total DHQ', color: 'var(--gold)', sparkData: allTotals };
                }
                case 'health-score': {
                    const ranked = rankedTeams.find(t => t.userId === sleeperUserId);
                    const hs = ranked?.healthScore || 0;
                    const allHS = rankedTeams.map(t => t.healthScore || 0).sort((a,b) => a-b);
                    return { value: hs || '\u2014', sub: 'Score', color: hs >= 90 ? 'var(--k-d4af37, #d4af37)' : hs >= 80 ? 'var(--k-2ecc71, #2ecc71)' : hs >= 70 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allHS };
                }
                case 'starter-gap': {
                    const analytics = analyticsData || (typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null);
                    const gap = analytics?.roster?.gaps?.find(g => g.severity === 'high') || analytics?.roster?.gaps?.[0];
                    if (gap) {
                        const area = gap.area || 'Unknown';
                        const delta = typeof gap.delta === 'number' ? (gap.delta > 0 ? '+' : '') + gap.delta.toFixed(gap.delta < 1 ? 2 : 0) : gap.delta;
                        return { value: delta, sub: area + ' (' + gap.severity + ')', color: gap.severity === 'high' ? 'var(--k-e74c3c, #e74c3c)' : 'var(--k-f0a500, #f0a500)' };
                    }
                    return { value: '\u2714', sub: 'No major gaps', color: 'var(--k-2ecc71, #2ecc71)' };
                }
                case 'avg-age': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Avg age', color: 'var(--silver)' };
                    const totalDhq = myPlayers.reduce((s, pid) => s + (scores[pid] || 1), 0);
                    const weightedAge = myPlayers.reduce((s, pid) => s + ((playersData[pid]?.age || 26) * (scores[pid] || 1)), 0);
                    const avg = totalDhq > 0 ? weightedAge / totalDhq : 26;
                    return { value: avg.toFixed(1), sub: 'Avg age', color: avg <= 25 ? 'var(--k-2ecc71, #2ecc71)' : avg <= 27 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'top5-conc': {
                    const vals = myPlayers.map(pid => scores[pid] || 0).sort((a,b) => b - a);
                    const total = vals.reduce((s,v) => s + v, 0);
                    const top5 = vals.slice(0, 5).reduce((s,v) => s + v, 0);
                    const pct = total > 0 ? Math.round(top5 / total * 100) : 0;
                    return { value: pct + '%', sub: 'In top 5 players', color: pct >= 65 ? 'var(--k-e74c3c, #e74c3c)' : pct >= 50 ? 'var(--gold)' : 'var(--k-2ecc71, #2ecc71)' };
                }
                case 'hit-rate': {
                    if (!profile || !profile.trades) return { value: '\u2014', sub: 'Trade win rate', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0) + (profile.tradesFair || 0);
                    const rate = total > 0 ? Math.round(((profile.tradesWon || 0) + (profile.tradesFair || 0)) / total * 100) : 0;
                    return { value: rate + '%', sub: 'Win/fair rate', color: rate >= 60 ? 'var(--k-2ecc71, #2ecc71)' : rate >= 40 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'faab-efficiency': {
                    const budget = myRoster?.settings?.waiver_budget || 0;
                    const spent = myRoster?.settings?.waiver_budget_used || 0;
                    if (!budget) return { value: '\u2014', sub: 'No FAAB', color: 'var(--silver)' };
                    const remaining = budget - spent;
                    return { value: '$' + remaining, sub: '$' + budget + ' budget', color: remaining > budget * 0.5 ? 'var(--k-2ecc71, #2ecc71)' : remaining > budget * 0.25 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'net-trade': {
                    if (!profile) return { value: '\u2014', sub: 'Net DHQ/trade', color: 'var(--silver)' };
                    const avg = profile.avgValueDiff || 0;
                    return { value: (avg >= 0 ? '+' : '') + Math.round(avg), sub: 'Avg per trade', color: avg >= 100 ? 'var(--k-2ecc71, #2ecc71)' : avg >= 0 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'trade-velocity': {
                    if (!profile) return { value: '\u2014', sub: 'Trades', color: 'var(--silver)' };
                    return { value: profile.trades || 0, sub: 'Total trades', color: (profile.trades || 0) >= 4 ? 'var(--k-2ecc71, #2ecc71)' : (profile.trades || 0) >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'window': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Window', color: 'var(--silver)' };
                    const rp = currentLeague?.roster_positions || [];
                    const posWindows = {};
                    const windowStarters = myRoster?.starters || [];
                    windowStarters.forEach(pid => {
                        if (!pid || pid === '0') return;
                        const p = playersData[pid];
                        if (!p) return;
                        const pos = p.position;
                        const nPos = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(nPos)
                            : ((window.App.peakWindows || {})[nPos] || [24, 29])[1];
                        const yrsLeft = Math.max(0, valueEnd - (p.age || 25));
                        if (!posWindows[nPos]) posWindows[nPos] = [];
                        posWindows[nPos].push(yrsLeft);
                    });
                    let minWindow = 99;
                    Object.entries(posWindows).forEach(([pos, yrs]) => {
                        if (yrs.length > 0) {
                            const avg = yrs.reduce((s, y) => s + y, 0) / yrs.length;
                            if (avg < minWindow) minWindow = avg;
                        }
                    });
                    const windowYrs = minWindow === 99 ? 0 : Math.round(minWindow);
                    return { value: windowYrs > 0 ? windowYrs + 'yr' : 'Closed', sub: 'Weakest position group', color: windowYrs >= 5 ? 'var(--k-2ecc71, #2ecc71)' : windowYrs >= 2 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'aging-cliff': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    const pastPeak = myPlayers.reduce((s, pid) => {
                        const p = playersData[pid]; if (!p) return s;
                        const pos = p.position; const age = p.age || 26;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(pos)
                            : ((window.App.peakWindows || {})[pos] || [24, 29])[1];
                        return age > valueEnd ? s + (scores[pid] || 0) : s;
                    }, 0);
                    const pct = total > 0 ? Math.round(pastPeak / total * 100) : 0;
                    return { value: pct + '%', sub: 'Past value DHQ', color: pct <= 20 ? 'var(--k-2ecc71, #2ecc71)' : pct <= 35 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'partner-wr': {
                    if (!profile || !profile.tradesWon) return { value: '\u2014', sub: 'Partner W/R', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0);
                    return { value: (profile.tradesWon || 0) + '-' + (profile.tradesLost || 0), sub: 'Trade W-L', color: (profile.tradesWon || 0) > (profile.tradesLost || 0) ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'elite-count': {
                    if (typeof window.App?.countElitePlayers === 'function') {
                        const elites = window.App.countElitePlayers(myPlayers);
                        return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? 'var(--k-2ecc71, #2ecc71)' : elites >= 1 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                    }
                    // Elite = 7000+ DHQ or top 5 at their position league-wide
                    const posRanks = {};
                    (currentLeague.rosters || []).forEach(r => (r.players || []).forEach(pid => {
                        const pos = playersData[pid]?.position;
                        const nPos2 = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        if (!posRanks[nPos2]) posRanks[nPos2] = [];
                        posRanks[nPos2].push({ pid: String(pid), dhq: scores[pid] || 0 });
                    }));
                    Object.values(posRanks).forEach(arr => arr.sort((a, b) => b.dhq - a.dhq));
                    const myPidSet = new Set(myPlayers.map(String));
                    const elitePidSet = new Set();
                    let elites = 0;
                    Object.values(posRanks).forEach(arr => {
                        arr.slice(0, 5).forEach(p => { if (myPidSet.has(p.pid)) elitePidSet.add(p.pid); });
                    });
                    myPlayers.forEach(pid => {
                        const id = String(pid);
                        if ((scores[pid] || scores[id] || 0) >= 7000) elitePidSet.add(id);
                    });
                    elites = elitePidSet.size;
                    return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? 'var(--k-2ecc71, #2ecc71)' : elites >= 1 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'bench-quality': {
                    const starters = new Set(myRoster?.starters || []);
                    const benchVals = myPlayers.filter(pid => !starters.has(pid)).map(pid => scores[pid] || 0);
                    const avg = benchVals.length ? Math.round(benchVals.reduce((s,v) => s + v, 0) / benchVals.length) : 0;
                    return { value: avg.toLocaleString(), sub: 'Avg bench DHQ', color: avg >= 2500 ? 'var(--k-2ecc71, #2ecc71)' : avg >= 1500 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'playoff-record': {
                    const brackets = window.App?.LI?.bracketData || {};
                    const rec = window.WrHistory?.playoffRecord;
                    let pw = 0, pl = 0;
                    Object.values(brackets).forEach(({ winners }) => {
                        if (!winners?.length || !myRoster) return;
                        const r = rec ? rec(winners, myRoster.roster_id) : { w: 0, l: 0 };
                        pw += r.w; pl += r.l;
                    });
                    return { value: pw + '-' + pl, sub: 'Playoff W-L', color: pw > pl ? 'var(--k-2ecc71, #2ecc71)' : pw < pl ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)' };
                }
                case 'playoff-winpct': {
                    const brackets2 = window.App?.LI?.bracketData || {};
                    const rec2 = window.WrHistory?.playoffRecord;
                    let pw2 = 0, pl2 = 0;
                    Object.values(brackets2).forEach(({ winners }) => {
                        if (!winners?.length || !myRoster) return;
                        const r = rec2 ? rec2(winners, myRoster.roster_id) : { w: 0, l: 0 };
                        pw2 += r.w; pl2 += r.l;
                    });
                    const total = pw2 + pl2;
                    const pct = total > 0 ? Math.round(pw2 / total * 100) : 0;
                    return { value: pct + '%', sub: 'Win rate (' + total + ' games)', color: pct >= 60 ? 'var(--k-2ecc71, #2ecc71)' : pct >= 40 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'champ-appearances': {
                    const champs2 = window.App?.LI?.championships || {};
                    const apps = Object.values(champs2).filter(c => c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id).length;
                    return { value: apps, sub: 'Finals appearances', color: apps > 0 ? 'var(--k-d4af37, #d4af37)' : 'var(--silver)' };
                }
                case 'dynasty-score': {
                    const champs3 = window.App?.LI?.championships || {};
                    const brackets3 = window.App?.LI?.bracketData || {};
                    let titles = 0, runners = 0, playoffApps = 0;
                    Object.values(champs3).forEach(c => {
                        if (c.champion === myRoster?.roster_id) titles++;
                        if (c.runnerUp === myRoster?.roster_id) runners++;
                        if (c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id || (c.semiFinals||[]).includes(myRoster?.roster_id)) playoffApps++;
                    });
                    const score = titles * 3 + runners + playoffApps;
                    return { value: score, sub: titles + ' titles, ' + runners + ' runner-ups', color: score >= 5 ? 'var(--k-d4af37, #d4af37)' : score >= 2 ? 'var(--k-2ecc71, #2ecc71)' : 'var(--silver)' };
                }
                case 'draft-roi': {
                    const profile3 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const draftPicks = (window.App?.LI?.draftOutcomes || []).filter(d => d.roster_id === myRoster?.roster_id);
                    const hits = draftPicks.filter(d => d.isStarter).length;
                    const total = draftPicks.length;
                    const rate = total > 0 ? Math.round(hits / total * 100) : 0;
                    return { value: rate + '%', sub: hits + '/' + total + ' became starters', color: rate >= 50 ? 'var(--k-2ecc71, #2ecc71)' : rate >= 30 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'roster-turnover': {
                    const profile4 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const trades = profile4?.trades || 0;
                    return { value: trades, sub: 'Trades this cycle', color: trades >= 5 ? 'var(--k-2ecc71, #2ecc71)' : trades >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'pick-capital': {
                    let totalPickValue = 0;
                    let pickCount = 0;
                    const totalTeams = (currentLeague.rosters || []).length || 16;
                    const draftRounds = currentLeague.settings?.draft_rounds || 5;
                    const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                    const tp = window.S?.tradedPicks || [];
                    for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                        for (let rd = 1; rd <= draftRounds; rd++) {
                            const tradedAway = tp.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRoster?.roster_id && p.owner_id !== myRoster?.roster_id);
                            if (!tradedAway) {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            }
                            const acquired = tp.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRoster?.roster_id && p.roster_id !== myRoster?.roster_id);
                            acquired.forEach(() => {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            });
                        }
                    }
                    return { value: totalPickValue > 0 ? Math.round(totalPickValue / 1000) + 'K' : '\u2014', sub: pickCount + ' picks over 3 years', color: totalPickValue >= 20000 ? 'var(--k-2ecc71, #2ecc71)' : totalPickValue >= 10000 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'trade-leverage': {
                    const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
                    const myStrengths = assess?.strengths || [];
                    let leverageCount = 0;
                    (currentLeague.rosters || []).forEach(r => {
                        if (r.roster_id === myRoster?.roster_id) return;
                        const theirAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(r.roster_id) : null;
                        const theirNeeds = (theirAssess?.needs || []).map(n => n.pos);
                        if (myStrengths.some(s => theirNeeds.includes(s))) leverageCount++;
                    });
                    return { value: leverageCount, sub: leverageCount + ' teams need your surplus', color: leverageCount >= 6 ? 'var(--k-2ecc71, #2ecc71)' : leverageCount >= 3 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'sched-sos': {
                    const sosMod = window.App?.SOS;
                    if (!sosMod?.ready) return { value: '\u2014', sub: 'Loading SOS\u2026', color: 'var(--silver)' };
                    const starters = myRoster?.starters || [];
                    const teamSOS = sosMod.getTeamSOS(starters, playersData);
                    if (!teamSOS) return { value: '\u2014', sub: 'No SOS data', color: 'var(--silver)' };
                    // sparkData: all teams' avg ranks for comparison
                    const sparkData = (currentLeague.rosters || []).map(r => {
                        const sos = sosMod.getTeamSOS(r.starters || [], playersData);
                        return sos?.avgRank || 16;
                    }).sort((a, b) => a - b);
                    return {
                        value: teamSOS.avgRank,
                        sub: teamSOS.label + ' schedule (avg rank)',
                        color: teamSOS.color,
                        sparkData,
                    };
                }
                default: return { value: '\u2014', sub: '', color: 'var(--silver)' };
            }
        }
        const [showNotifications, setShowNotifications] = useState(false);
        // showAlerts removed — alerts now live on Brief tab
        const [briefDraftInfo, setBriefDraftInfo] = useState(null);
        const [sidebarOpen, setSidebarOpen] = useState(false);
        // The league title opens the selector directly. Season, status, and
        // refresh controls remain in League options in the phone menu. The compact
        // header (and the hamburger removal that rides with it) engages only
        // while the sheet primitive is actually live, so a kit-load failure
        // falls back to the stacked header + hamburger instead of stranding nav.
        const [phHdrSheetOpen, setPhHdrSheetOpen] = useState(false);
        const phoneHdrKit = alexPhone && !!(window.WR && window.WR.Sheet);
        const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
            try { return localStorage.getItem('wr_sidebar_collapsed') === '1'; } catch (_) { return false; }
        });
        const iconSrc = ((window.location.pathname || '').includes('/dist-preview/') ? '../' : '') + 'icon-192.png';
        useEffect(() => {
            try { localStorage.setItem('wr_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch (_) {}
        }, [sidebarCollapsed]);
        const [gmStrategyOpen, setGmStrategyOpen] = useState(false);
        // Expose for cross-module access (draft-room "Edit GM Strategy" button)
        window._wrSetActiveTab = setActiveTab;
        window._wrSetGmStrategyOpen = setGmStrategyOpen;
        const getCurrentLeagueId = (lg) => lg?.league_id || lg?.id;
        const GM_STRATEGY_DEFAULT = { mode: 'compete', riskTolerance: 'moderate', positionalNeeds: {}, untouchable: [], targets: [], notes: '' };
        const readSharedGmStrategy = (leagueId) => {
            try {
                if (!localStorage.getItem('dhq_gm_strategy_v1')) return null;
                return window.GMStrategy?.getStrategy?.(leagueId) || null;
            } catch (_) {
                return null;
            }
        };
        const normalizeGmStrategy = (strategy, leagueId) => {
            const normalize = window.WR?.GmMode?.normalize || ((mode) => mode || 'compete');
            return {
                ...GM_STRATEGY_DEFAULT,
                ...(strategy || {}),
                mode: normalize(strategy?.mode || GM_STRATEGY_DEFAULT.mode),
                leagueId,
            };
        };
        const loadGmStrategy = (leagueId) => {
            const saved = readSharedGmStrategy(leagueId)
                || LeagueStorage.get(LEAGUE_WR_KEYS.GM_STRATEGY(leagueId))
                || GM_STRATEGY_DEFAULT;
            return normalizeGmStrategy(saved, leagueId);
        };
        const [gmStrategy, setGmStrategy] = useState(() =>
            loadGmStrategy(getCurrentLeagueId(currentLeague))
        );
        const gmStrategyInitRef = useRef(true);
        const gmStrategyLeagueRef = useRef(getCurrentLeagueId(currentLeague));
        useEffect(() => {
            const leagueId = getCurrentLeagueId(currentLeague);
            if (!leagueId || String(gmStrategyLeagueRef.current || '') === String(leagueId)) return;
            const next = loadGmStrategy(leagueId);
            gmStrategyLeagueRef.current = leagueId;
            gmStrategyInitRef.current = true;
            window._wrGmStrategy = next;
            setGmStrategy(next);
        }, [currentLeague?.league_id, currentLeague?.id]);
        useEffect(() => {
            const leagueId = getCurrentLeagueId(currentLeague);
            if (leagueId) {
                const normalized = normalizeGmStrategy(gmStrategy, leagueId);
                LeagueStorage.set(LEAGUE_WR_KEYS.GM_STRATEGY(leagueId), normalized);
                // Expose to window for AI context
                window._wrGmStrategy = normalized;
                // Log deliberate updates (skip initial load)
                if (gmStrategyInitRef.current) { gmStrategyInitRef.current = false; }
                else { window.wrLogAction?.('\uD83D\uDCCA', 'Updated GM strategy', 'roster', { actionType: 'gm-strategy' }); }
            }
        }, [gmStrategy, currentLeague?.league_id, currentLeague?.id]);
        // Remote/Scout strategy edits arrive as wr:gm-mode-changed (gm-mode.js
        // bridges DhqEvents 'strategy:changed'). Adopt them into local gmStrategy
        // state \u2014 which feeds the header GM badge + Alex AI context \u2014 when they
        // target the open league. JSON-compare guards the echo: the persist
        // effect above re-saves on every set, so identical payloads must no-op.
        useEffect(() => {
            const onGmChanged = (e) => {
                const s = e?.detail?.strategy;
                if (!s || typeof s !== 'object') return;
                const leagueId = getCurrentLeagueId(currentLeague);
                if (!leagueId) return;
                if (s.leagueId != null && String(s.leagueId) !== String(leagueId)) return;
                const next = normalizeGmStrategy(s, leagueId);
                if (JSON.stringify(normalizeGmStrategy(gmStrategy, leagueId)) === JSON.stringify(next)) return;
                // Synced-in change, not a deliberate local edit \u2014 skip the action log.
                gmStrategyInitRef.current = true;
                setGmStrategy(next);
            };
            window.addEventListener('wr:gm-mode-changed', onGmChanged);
            return () => window.removeEventListener('wr:gm-mode-changed', onGmChanged);
        }, [gmStrategy, currentLeague?.league_id, currentLeague?.id]);

        // Fetch draft info for Brief tab (Sleeper only — other platforms don't have this endpoint)
        useEffect(() => {
            if (!isSleeper) return;
            if (!currentLeague?.id && !currentLeague?.league_id) return;
            fetch('https://api.sleeper.app/v1/league/' + (currentLeague.league_id || currentLeague.id) + '/drafts')
                .then(r => r.ok ? r.json() : [])
                .then(drafts => {
                    const upcoming = drafts.find(d => d.status === 'pre_draft') || drafts[0];
                    if (upcoming) setBriefDraftInfo(upcoming);
                })
                .catch(err => window.wrLog('flashBrief.draftFetch', err));
        }, [currentLeague, isSleeper]);

        // Auto-generate notifications from league data
        const notifications = useMemo(() => {
            const notes = [];
            const txnsRaw = window.S?.transactions || {};
            const txns = Array.isArray(txnsRaw) ? txnsRaw : Object.values(txnsRaw).flat();
            const myPids = new Set(myRoster?.players || []);

            // Players on my roster that are trending down
            txns.filter(t => t.type === 'free_agent' || t.type === 'waiver').forEach(t => {
                const drops = Object.keys(t.drops || {});
                drops.forEach(pid => {
                    if (myPids.has(pid)) {
                        notes.push({ type: 'warn', text: (playersData[pid]?.full_name || pid) + ' was dropped by another team', time: t.created });
                    }
                });
                const adds = Object.keys(t.adds || {});
                adds.forEach(pid => {
                    // Format-aware value + label: '(4,100 ROS) was picked up'
                    // in redraft, DHQ elsewhere — same 3000+ notability bar
                    // (both scales anchor their top asset to the same ceiling).
                    const pv = window.App?.PlayerValue;
                    const val = (pv?.isRedraftActive?.() ? pv.getValue(pid) : window.App?.LI?.playerScores?.[pid]) || 0;
                    const lbl = window.App?.LeagueSkin?.getCurrent?.()?.vocabulary?.valueShortLabel || 'DHQ';
                    if (val > 3000 && !myPids.has(pid)) {
                        notes.push({ type: 'info', text: (playersData[pid]?.full_name || pid) + ' (' + val.toLocaleString() + ' ' + lbl + ') was picked up', time: t.created });
                    }
                });
            });

            // Trades involving my position needs
            txns.filter(t => t.type === 'trade').slice(0, 5).forEach(t => {
                const rids = t.roster_ids || [];
                if (rids.includes(myRoster?.roster_id)) {
                    notes.push({ type: 'trade', text: 'You completed a trade', time: t.created });
                }
            });

            return notes.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10);
        }, [playersData, myRoster]);

        useEffect(() => {
            if (workspaceRoute.analysis && !analyticsData && window.App?.LI_LOADED) {
                const data = typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null;
                setAnalyticsData(data);
            }
        }, [workspaceRoute.analysis, analyticsData, timeRecomputeTs]);


        useEffect(() => {
          window.__WR_SCROLL_FALLBACK_ACTIVE = true;
          window.addEventListener('wheel', rerouteWheelToPage, { passive: false, capture: true });
          return () => window.removeEventListener('wheel', rerouteWheelToPage, { capture: true });
        }, []);

        // Provider weekly projections landed (WeeklyProj lazy fetch) → re-tick
        // so FA proj cells / Game Day / lineup widgets recompute with the
        // analyst lines instead of the internal fallback.
        useEffect(() => {
          const h = () => setTimeRecomputeTs(Date.now());
          window.addEventListener('wr:projections-loaded', h);
          // FantasyCalc REDRAFT calibration landed → ROS cache was invalidated;
          // same recompute tick rebuilds every value surface calibrated.
          window.addEventListener('wr:ros-market-loaded', h);
          return () => {
            window.removeEventListener('wr:projections-loaded', h);
            window.removeEventListener('wr:ros-market-loaded', h);
          };
        }, []);


        // Compute power rankings when DHQ engine finishes or standings change
        useEffect(() => {
            if (!standings.length) return;
            function computeRankings() {
                // Use assessAllTeamsFromGlobal (batch) for consistency with League Map view
                const allAssess = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []);
                const assessMap = {};
                allAssess.forEach(a => { if (a?.rosterId) assessMap[a.rosterId] = a; });
                const ranked = standings.map(t => {
                    const r = currentLeague.rosters.find(r => r.owner_id === t.userId);
                    // Format-aware roster sum: ROS in redraft, dynasty elsewhere.
                    const vmap = (window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : null) || window.App?.LI?.playerScores || {};
                    const totalDHQ = r?.players?.reduce((s, pid) => s + (vmap[pid] || 0), 0) || 0;
                    let healthScore = 0;
                    let tierColor = 'var(--silver)';
                    const assessment = r ? assessMap[r.roster_id] : null;
                    if (assessment) {
                        healthScore = assessment.healthScore || 0;
                        const tier = (assessment.tier || '').toUpperCase();
                        tierColor = tier === 'ELITE' ? 'var(--k-d4af37, #d4af37)' : tier === 'CONTENDER' ? 'var(--k-2ecc71, #2ecc71)' : tier === 'CROSSROADS' ? 'var(--k-f0a500, #f0a500)' : tier === 'REBUILDING' ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)';
                    }
                    return { ...t, totalDHQ, healthScore, tierColor };
                }).sort((a,b) => {
                    if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
                    return b.totalDHQ - a.totalDHQ;
                });
                setRankedTeams(ranked);
            }
            // Always compute immediately (shows DHQ-based values if LI loaded, zeros if not)
            computeRankings();
            // If LI hasn't loaded yet, poll until it does and recompute with real health scores
            if (!window.App?.LI_LOADED) {
                const interval = setInterval(() => {
                    if (window.App?.LI_LOADED) { computeRankings(); clearInterval(interval); }
                }, 1500);
                // Safety: also recompute after a short delay in case LI loaded between render and effect
                const timeout = setTimeout(() => { if (window.App?.LI_LOADED) computeRankings(); }, 500);
                return () => { clearInterval(interval); clearTimeout(timeout); };
            }
        }, [standings, currentLeague, timeRecomputeTs, statsData]);

        // ── Sync freshness (audit:refresh-stale step 7) ──
        // wr:data-synced (dispatched by WR.Sync after each successful background
        // revalidation) bumps syncedAt; the 60s tick keeps the sidebar's
        // 'Synced Xm ago' readout aging even when nothing else re-renders.
        const [syncedAt, setSyncedAt] = useState(() => window.WR?.Sync?.lastSyncedAt || null);
        const [, setSyncTick] = useState(0);
        useEffect(() => {
            const onSynced = (e) => setSyncedAt(e?.detail?.at || Date.now());
            window.addEventListener('wr:data-synced', onSynced);
            const tick = setInterval(() => setSyncTick(t => t + 1), 60000);
            return () => { window.removeEventListener('wr:data-synced', onSynced); clearInterval(tick); };
        }, []);

        // Monotonic load token — a new full load (league switch / manual
        // refresh) invalidates any in-flight background revalidation from the
        // previous load (same idea as the _wppFetchToken guard below).
        const loadSeqRef = useRef(0);
        // Last successful rolling weekly-points fetch (league-tagged). The block
        // fires up to 18 parallel /matchups/{week} requests — background
        // revalidations only re-run it when the week rolled or this is stale.
        const wppFetchedAtRef = useRef({ ts: 0, scope: null, throughWeek: 0 });
        // League closed / component unmounted: drop the background revalidator
        // so WR.Sync stops syncing a dead closure (also resets its lastSyncedAt).
        // Also bump loadSeqRef so any ALREADY in-flight background hydrate fails
        // its token check and can't apply into a re-pointed window.S.
        useEffect(() => () => {
            loadSeqRef.current++;
            window.WR?.Sync?.registerRevalidator?.(null);
        }, []);

        useEffect(() => {
            loadLeagueDetails();
        }, [currentLeague]);

        async function loadLeagueDetails() {
            // New full load supersedes any in-flight background revalidation.
            const loadSeq = ++loadSeqRef.current;
            try {
                // Clear assessment caches for THIS league so health scores compute fresh.
                // Key by league ID — switching back to a previously-loaded league can
                // reuse its cache if the underlying data hasn't changed.
                const leagueKey = currentLeague.league_id || currentLeague.id || '';
                if (window.assessTeamFromGlobal?._cache) {
                    // Only clear entries for the current league, not all leagues
                    const cache = window.assessTeamFromGlobal._cache;
                    Object.keys(cache).forEach(k => { if (k.startsWith(leagueKey + '_') || !k.includes('_')) delete cache[k]; });
                }
                if (window.assessAllTeamsFromGlobal?._cache) {
                    window.assessAllTeamsFromGlobal._cache[leagueKey] = null;
                }

                if (!currentLeague.rosters || !currentLeague.users) {
                    throw new Error('League missing roster or user data');
                }

                const myRosterData = currentLeague._mfl && currentLeague._mflFranchiseId
                    ? currentLeague.rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                    : currentLeague.rosters.find(r => r.owner_id === sleeperUserId);
                setMyRoster(myRosterData);

                // Compute standings immediately (no fetch needed)
                const standingsData = currentLeague.rosters.map(roster => {
                    const user = currentLeague.users.find(u => u.user_id === roster.owner_id);
                    return {
                        rosterId: roster.roster_id,
                        userId: roster.owner_id,
                        displayName: user?.display_name || user?.username || 'Unknown',
                        avatar: user?.avatar,
                        teamName: roster.metadata?.team_name || user?.metadata?.team_name || '',
                        wins: roster.settings?.wins || 0,
                        losses: roster.settings?.losses || 0,
                        ties: roster.settings?.ties || 0,
                        pointsFor: roster.settings?.fpts || 0,
                        division: roster.settings?.division || 0
                    };
                }).sort((a, b) => {
                    if (b.wins !== a.wins) return b.wins - a.wins;
                    if (a.losses !== b.losses) return a.losses - b.losses;
                    return b.pointsFor - a.pointsFor;
                });
                setStandings(standingsData);

                // Show dashboard immediately with what we have
                setLoading(false);
                setLoadStage('Loading player data...');

                // ── Unified platform provider pipeline ──────────────────
                // Replaces the old _isSleeper ? A : B branching. Each of the
                // four platforms (sleeper/mfl/espn/yahoo) implements the
                // same hydrate() contract — see shared/platform-provider.js.
                const provider = resolvePlatformProvider(currentLeague);
                if (!provider) {
                    const platform = currentLeague?._platform
                        || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
                    throw new Error('No ' + platform + ' platform provider loaded. Reload the page and try again.');
                }
                setLoadStage('Loading ' + provider.displayName + ' data...');

                // Pre-fetch two things ALL providers need as hydrate context:
                //   1. The Sleeper player DB — source of truth for player
                //      names, positions, teams. Non-Sleeper platforms use
                //      this to build their crosswalk to resolve native IDs
                //      to Sleeper IDs.
                //   2. NFL state — gives us the current week, needed for
                //      bucketing transactions and fetching matchups.
                const [sleeperPlayers, nflState] = await Promise.all([
                    fetchAllPlayers().catch(() => ({})),
                    fetchJSON(`${SLEEPER_BASE_URL}/state/nfl`).catch(() => ({})),
                ]);
                const currentWeek = nflState?.week || nflState?.display_week || (currentLeague.settings?.leg || 1);

                // Hydrate the league through the provider — single call
                // that replaces the old per-platform fetch pipelines.
                const hydrated = await provider.hydrate(currentLeague, {
                    sleeperPlayers,
                    currentWeek,
                    currentSeason: currentLeague.season || activeYear,
                    prevSeason: STATS_YEAR,
                    nflState,
                });

                if (loadSeq !== loadSeqRef.current) return;
                applyHydrated(hydrated, { provider, sleeperPlayers, nflState, currentWeek, myRosterData, background: false });

                // Register the background revalidator (audit:refresh-stale step 4).
                // WR.Sync calls it on tab return / focus / in-season interval:
                // re-hydrate with the memoized player DB + a FRESH nfl state, then
                // re-apply. Stale-while-revalidate — background syncs never clear
                // or reload LI (values keep their own 8h/manual cadence) and never
                // touch loading/loadStage. loadSeq mirrors the _wppFetchToken
                // pattern: a league switch or manual refresh invalidates any
                // in-flight background sync from the previous load.
                if (window.WR?.Sync?.registerRevalidator) {
                    const bgLeagueId = currentLeague.id || currentLeague.league_id;
                    window.WR.Sync.registerRevalidator(async () => {
                        if (loadSeq !== loadSeqRef.current) return;
                        const [bgPlayers, bgStateRaw] = await Promise.all([
                            fetchAllPlayers().catch(() => sleeperPlayers),                 // memoized player DB
                            fetchJSON(`${SLEEPER_BASE_URL}/state/nfl`).catch(() => ({})),  // always fresh — week-rollover source
                        ]);
                        const bgNfl = (bgStateRaw && Object.keys(bgStateRaw).length) ? bgStateRaw : (window.S?.nflState || nflState);
                        const bgWeek = bgNfl?.week || bgNfl?.display_week || window.S?.currentWeek || currentWeek;
                        const bgHydrated = await provider.hydrate(currentLeague, {
                            sleeperPlayers: bgPlayers,
                            currentWeek: bgWeek,
                            currentSeason: currentLeague.season || activeYear,
                            prevSeason: STATS_YEAR,
                            nflState: bgNfl,
                        });
                        if (loadSeq !== loadSeqRef.current) return;
                        if (window.S?.currentLeagueId && String(window.S.currentLeagueId) !== String(bgLeagueId)) return;
                        // Integrity gate (background only): hydrate's inner fetches
                        // degrade to {}/[] on failure, so a network blip could
                        // otherwise overwrite live on-screen data with empties and
                        // still count as a successful sync. If core datasets came
                        // back empty while the current state has them, THROW so
                        // WR.Sync.refresh records a failed sync (lastSyncedAt stays
                        // honest) and the stale-but-real data stays up.
                        const _bgRosters = bgHydrated?.rosters || [];
                        const _bgUsers = bgHydrated?.leagueUsers || [];
                        const _haveRosters = !!(window.S?.rosters?.length || currentLeague.rosters?.length);
                        const _haveUsers = !!(window.S?.leagueUsers?.length || currentLeague.users?.length);
                        if ((_haveRosters && !_bgRosters.length) || (_haveUsers && !_bgUsers.length)) {
                            throw new Error('Background revalidation returned empty rosters/users — keeping current data');
                        }
                        applyHydrated(bgHydrated, { provider, sleeperPlayers: bgPlayers, nflState: bgNfl, currentWeek: bgWeek, myRosterData, background: true });
                    });
                }

                // Paint the dashboard shell before DHQ starts, then await DHQ.
                // This lets React commit the initial render (standings, rosters,
                // nav) while DHQ computes — user sees the page immediately, then
                // DHQ values populate once loadLeagueIntel finishes.
                setLoadStage('');
                // Yield to the browser so the render commits before DHQ blocks
                await new Promise(r => setTimeout(r, 0));

                if (typeof window.App?.loadLeagueIntel === 'function' && (!window.App.LI_LOADED || String(window.App.LI?.sourceLeagueId || '') !== String(currentLeague.id || currentLeague.league_id))) {
                    setDhqStatus({ loading: true, step: 'Analyzing league history...', progress: 20 });
                    try {
                        await window.App.loadLeagueIntel();
                        console.log('[War Room] DHQ engine loaded:', Object.keys(window.App.LI?.playerScores || {}).length, 'players valued');
                        setDhqStatus({ loading: false, step: 'Complete!', progress: 100 });
                        setStatsData(prev => ({ ...prev })); // force re-render
                        setTimeRecomputeTs(Date.now()); // refresh KPIs and rankings
                    } catch (e) {
                        console.warn('[War Room] DHQ engine error:', e);
                        setDhqStatus({ loading: false, step: 'Error: ' + e.message, progress: 0 });
                    }
                }

                // Load rookie prospect data from enrichment CSVs (fire-and-forget)
                if (typeof window.loadRookieProspects === 'function') {
                    window.loadRookieProspects().then(cache => {
                        console.log('[War Room] Rookie enrichment loaded:', cache?.count || 0, 'prospects');
                        setTimeRecomputeTs(Date.now()); // refresh to show enriched data
                    }).catch(e => console.warn('[War Room] Rookie data load failed:', e));
                }

                // Load player tags (syncs with ReconAI)
                if (window.OD?.loadPlayerTags) {
                    window.OD.loadPlayerTags(currentLeague.id || currentLeague.league_id).then(tags => {
                        if (loadSeq !== loadSeqRef.current) return;
                        window._playerTags = tags || {};
                        setTimeRecomputeTs(Date.now()); // force re-render to show tags
                    }).catch(err => window.wrLog('tags.load', err));
                }

                // First-time intro is now the Alex chat greeting (seedWelcomeChat /
                // the wr:replay-welcome path), not the old 7-step click-through modal
                // — owner ask. startWRTutorial() is intentionally no longer launched.

                // Load league docs context for commissioner mode (fire-and-forget)
                if (window.OD?.getLeagueDocsContext) {
                    window.OD.getLeagueDocsContext(currentLeague.id || currentLeague.league_id).then(ctx => {
                        if (ctx) window._leagueDocsContext = ctx;
                    }).catch(() => {});
                }

            } catch (err) {
                if (loadSeq !== loadSeqRef.current) return;
                console.error('Failed to load league details:', err);
                setError(err.message || 'Failed to load league details');
                setLoading(false);
                setLoadStage('');
            }
        }

        // ── applyHydrated (audit:refresh-stale step 4) ──────────────────
        // Commits a provider.hydrate() result to React state + the window.S
        // bridge. Shared by the full loadLeagueDetails path and the WR.Sync
        // background revalidator. background:true = stale-while-revalidate
        // refresh: skips the load-stage UI and NEVER touches LeagueIntel —
        // rosters/matchups/transactions stay fresh while DHQ values keep
        // their own 8h/manual cadence. Errors propagate to the caller
        // (loadLeagueDetails' catch sets the error UI; WR.Sync logs).
        function applyHydrated(hydrated, { provider, sleeperPlayers, nflState, currentWeek, myRosterData, background = false }) {
            // Pull enrichment out of _extras (Sleeper only — others empty)
            const stats       = hydrated._extras?.stats       || {};
            const projections = hydrated._extras?.projections || {};
            const prevStats   = hydrated._extras?.prevStats   || {};

            // Merge platform-specific extras into the Sleeper player DB.
            // For Sleeper this is a no-op; for MFL/ESPN/Yahoo this adds
            // IDP players and other platform-only records that the
            // Sleeper DB doesn't have.
            const players = { ...sleeperPlayers, ...(hydrated.players || {}) };

            // Use the hydrated rosters — for non-Sleeper, these now have
            // Sleeper-resolved player IDs (the whole point of the
            // provider rebuild step). For Sleeper, these are the fresh
            // fetchRosters result.
            const rosters     = (hydrated.rosters && hydrated.rosters.length) ? hydrated.rosters : (currentLeague.rosters || []);
            const leagueUsers = (hydrated.leagueUsers && hydrated.leagueUsers.length) ? hydrated.leagueUsers : (currentLeague.users || []);
            const tradedPicks = hydrated.tradedPicks || [];
            const matchupsData = hydrated.matchups || [];

            // Patch currentLeague in place so downstream useEffects
            // (computeRankings etc.) see the resolved rosters. React
            // won't re-render from this mutation, but setStatsData /
            // setSeasonCtxData below trigger re-renders anyway.
            currentLeague.rosters = rosters;
            if (leagueUsers.length) currentLeague.users = leagueUsers;

            // Re-resolve myRosterData now that rosters may have changed
            const freshMyRoster = provider.id === 'mfl' && currentLeague._mflFranchiseId
                ? rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                : rosters.find(r => r.owner_id === sleeperUserId) || myRosterData;
            if (freshMyRoster && freshMyRoster !== myRosterData) setMyRoster(freshMyRoster);
            const myRoster = freshMyRoster || myRosterData;

            setStatsData(stats);
            setProjectionsData(projections);
            setStats2025Data(prevStats);
            setPlayersData(players);
            if (!background) setLoadStage('Computing values...');

            // Bridge to DHQ engine immediately
            if (window.App) {
                if (!window.S) window.S = {};
                // Week rollover (audit:refresh-stale step 5): S.currentWeek is
                // captured at league open; when a background sync sees a new NFL
                // week we bump timeRecomputeTs below so PlayerValue._ros (keyed
                // on week) invalidates and rankings/analytics recompute.
                const weekRolled = background && window.S.currentWeek != null && currentWeek !== window.S.currentWeek;
                window.S.players = players;
                window.S.playerStats = {};
                // Hydrated stat/projection maps for surfaces that can't thread
                // props (draft stack, Trade Center early mount): PlayerValue.
                // ensureRos falls back to these so a redraft board never
                // silently reverts to dynasty pricing for want of priorData.
                window.S.statsData = stats;
                window.S.priorData = prevStats;
                window.S.projectionsData = projections;
                window.S.rosters = rosters;
                window.S.leagueUsers = leagueUsers;
                window.S.leagues = [{ ...currentLeague, league_id: currentLeague.league_id || currentLeague.id }];
                const pointsLeagueId = currentLeague.id || currentLeague.league_id;
                const pointsScope = window.App.WeeklyProj.weeklyPointsScope(pointsLeagueId, activeYear, currentLeague.scoring_settings);
                if (window.S.weeklyPlayerPointsScope !== pointsScope) {
                    window.S.weeklyPlayerPoints = {};
                    window.S.weeklyPlayerPlayed = {};
                    window.S.weeklyPlayerPointsLeagueId = null;
                    window.S.weeklyPlayerPointsScope = pointsScope;
                    window.S.weeklyPlayerPointsSeason = activeYear;
                }
                window.S.currentLeagueId = pointsLeagueId;
                window.S.season = activeYear;
                window.S.nflState = hydrated.nflState && Object.keys(hydrated.nflState).length ? hydrated.nflState : nflState;
                window.S.currentWeek = currentWeek;
                window.S.tradedPicks = window.App?.normalizeTradedPicks
                    ? window.App.normalizeTradedPicks(rosters, tradedPicks)
                    : tradedPicks;
                window.S.matchups = matchupsData;
                window.S.drafts = hydrated.drafts || [];
                // MFL: complete future-pick ownership (exact years/rounds) so the
                // Trade Center shows real future picks, not invented N-round sets.
                window.S._mflFuturePicks = hydrated._extras?.mflFuturePicks || null;

                // Completed NFL logs fill history gaps for recent pickups; league
                // matchup actuals preserve custom scoring wherever available.
                const throughWeek = Number(activeYear) < Number(window.S.nflState?.season) || window.S.nflState?.season_type === 'post'
                    ? 18 : window.S.nflState?.season_type === 'pre' ? 0 : Math.max(0, Math.min(18, currentWeek - 1));
                window.S.weeklyPlayerPointsThroughWeek = throughWeek;
                const pointsFresh = wppFetchedAtRef.current.scope === pointsScope
                    && wppFetchedAtRef.current.throughWeek === throughWeek
                    && Date.now() - wppFetchedAtRef.current.ts < 15 * 60 * 1000;
                if (provider.id === 'sleeper' && pointsLeagueId && !(background && !weekRolled && pointsFresh)) {
                    const fetchToken = (window._wppFetchToken = (window._wppFetchToken || 0) + 1);
                    window.App.WeeklyProj.loadWeeklyPoints({
                        leagueId: pointsLeagueId, season: activeYear, throughWeek, scoring: currentLeague.scoring_settings,
                        previousPoints: window.S.weeklyPlayerPoints, previousPlayed: window.S.weeklyPlayerPlayed,
                    }).then(history => {
                        if (fetchToken !== window._wppFetchToken || window.S?.weeklyPlayerPointsScope !== pointsScope) return;
                        window.S.weeklyPlayerPoints = history.points;
                        window.S.weeklyPlayerPlayed = history.played;
                        window.S.weeklyPlayerPointsLeagueId = pointsLeagueId;
                        if (history.complete) wppFetchedAtRef.current = { ts: Date.now(), scope: pointsScope, throughWeek };
                        window.dispatchEvent(new CustomEvent('wr:weekly-points-loaded', { detail: { leagueId: pointsLeagueId, season: activeYear } }));
                    }).catch(e => window.wrLog?.('weekly-points.load', e));
                }
                window.S.myRosterId = myRoster?.roster_id;
                window.S.platform = provider.id;   // canonical marker
                const _isNonSleeper = provider.id !== 'sleeper';
                window.S.myUserId = _isNonSleeper
                    ? (myRoster?.owner_id || currentLeague._mflFranchiseId || sleeperUserId)
                    : sleeperUserId;
                const _userId = window.S.myUserId;
                const _userName = _isNonSleeper ? (myRoster?._owner_name || 'Owner') : (sleeperUsername || '');
                window.S.user = { user_id: _userId, display_name: _userName, username: _userName };

                // Bridge helper functions for dhq-ai.js context builders
                const _p = players || {};
                window.myR = () => (window.S.rosters || []).find(r => r.roster_id === window.S.myRosterId);
                window.pName = pid => _p[pid]?.full_name || pid;
                window.pPos = pid => _p[pid]?.position || '';
                window.pAge = pid => _p[pid]?.age || 0;
                window.pM = pos => { if (['DE','DT'].includes(pos)) return 'DL'; if (['CB','S','FS','SS'].includes(pos)) return 'DB'; if (['OLB','ILB','MLB'].includes(pos)) return 'LB'; return pos; };
                window.dynastyValue = pid => window.App?.LI?.playerScores?.[pid] || 0;
                window.getFAAB = () => {
                    const league = window.S.leagues?.[0];
                    const my = window.myR();
                    const isFAAB = (league?.settings?.waiver_type === 2) || (league?.settings?.waiver_budget > 0);
                    const budget = isFAAB ? (league?.settings?.waiver_budget || 0) : 0;
                    const spent = my?.settings?.waiver_budget_used || 0;
                    // GM Strategy's minimum-bid override wins over the imported
                    // platform setting (some leagues/platforms don't expose it
                    // reliably) — this is what Alex/AI FAAB advice reads.
                    const gmFaabEff = window.WR?.GmMode?.effects?.(league?.league_id || league?.id) || {};
                    const minBid = isFAAB ? (gmFaabEff.faabMinBid || (league?.settings?.waiver_budget_min ?? 0)) : 0;
                    return { budget, spent, remaining: Math.max(0, budget - spent), isFAAB, minBid };
                };
                window.loadMentality = () => {
                    const gm = window._wrGmStrategy || {};
                    const modeMap = { contend: 'winnow', rebuild: 'rebuild', balanced: 'balanced' };
                    return { mentality: modeMap[gm.mode] || 'balanced', neverDrop: (gm.untouchable || []).map(pid => _p[pid]?.full_name || pid).join(', '), notes: gm.notes || '' };
                };
                window.App.myR = window.myR;
                window.App.pName = window.pName;
                window.App.pPos = window.pPos;
                window.App.pAge = window.pAge;
                window.App.pM = window.pM;
                window.App.dynastyValue = window.dynastyValue;
                window.App.getFAAB = window.getFAAB;
                window.App.loadMentality = window.loadMentality;

                // Keep every roster surface on the same played-game average.
                window.App.computeRollingPPG = (pid, lastN) => window.App.WeeklyProj.formStats(pid, lastN || 5)?.rollingPPG ?? null;

                // AI credentials are owned by the session-scoped request adapter.
                window.S.apiKey = '';
                window.S.aiProvider = window.DHQAI?.get()?.provider || 'gemini';

                // Bridge stats data — use prevStats (2025) as base, overlay current season
                Object.entries(prevStats).forEach(([pid, s]) => {
                    if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                    const pts = calcRawPts(s);
                    const gp = s.gp || 0;
                    window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                    window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                    window.S.playerStats[pid].prevRawStats = s;
                });
                // Overlay current season stats if available
                Object.entries(stats).forEach(([pid, s]) => {
                    if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                    const pts = calcRawPts(s);
                    const gp = s.gp || 0;
                    if (gp > 0) {
                        window.S.playerStats[pid].seasonTotal = pts ? Math.round(pts * 10) / 10 : 0;
                        window.S.playerStats[pid].seasonAvg = Math.round(pts / gp * 10) / 10;
                    }
                });

                // Mirror to SeasonContext so tab components can use React state
                setSeasonCtxData({
                    season: activeYear,
                    playerStats: window.S.playerStats,
                    tradedPicks: tradedPicks || [],
                    rosters: currentLeague.rosters || [],
                    myRosterId: myRosterData?.roster_id || null,
                    lastUpdated: Date.now(),
                });

                if (weekRolled) setTimeRecomputeTs(Date.now());
            }

            if (!background) setLoadStage('Building league intelligence...');

            // Flatten hydrated transactions (already bucketed by week
            // from the provider) and merge in DHQ historical trades.
            // This replaces the old per-platform transaction fetch.
            let allTxns = [];
            Object.values(hydrated.transactions || {}).forEach(wk => {
                allTxns = allTxns.concat(wk || []);
            });
            allTxns.sort((a, b) => (b.created || 0) - (a.created || 0));

            // Merge DHQ historical trades (pre-analyzed with value data)
            // Deduplicate by timestamp so the provider's recent txns
            // aren't doubled.
            if (window.App?.LI?.tradeHistory?.length > 0) {
                const existingTradeTs = new Set(allTxns.filter(t => t.type === 'trade').map(t => t.created || 0));
                const histTrades = window.App.LI.tradeHistory
                    .filter(t => !existingTradeTs.has(t.ts || 0))
                    .map(t => ({ ...t, type: 'trade', status: 'complete', created: t.ts || 0, _fromDHQ: true }));
                allTxns = [...allTxns, ...histTrades].sort((a, b) => (b.created || 0) - (a.created || 0));
            }

            // Populate window.S.transactions keyed by week for
            // free-agency.js / flash-brief.js consumers.
            if (window.S) {
                const txnsByWeek = {};
                allTxns.forEach(t => {
                    const key = 'w' + (t.leg ?? t.week ?? 0);
                    if (!txnsByWeek[key]) txnsByWeek[key] = [];
                    txnsByWeek[key].push(t);
                });
                window.S.transactions = txnsByWeek;
            }
            let visibleTxns = allTxns.slice(0, 50);
            if (!visibleTxns.some(t => t.type === 'trade')) {
                const firstTrade = allTxns.find(t => t.type === 'trade');
                if (firstTrade) visibleTxns = [...visibleTxns.slice(0, 49), firstTrade];
            }
            setTransactions(visibleTxns);

            // Trending — if the provider supplied it (Sleeper), use that;
            // otherwise fall back to Sleeper's global trending endpoint
            // so all platforms see league-wide trends.
            if (hydrated.trending?.adds || hydrated.trending?.drops) {
                setTrending({
                    adds: hydrated.trending.adds || [],
                    drops: hydrated.trending.drops || [],
                });
            } else if (window.Sleeper?.fetchTrending) {
                (async () => {
                    try {
                        const [adds, drops] = await Promise.all([
                            window.Sleeper.fetchTrending('add', 24, 15),
                            window.Sleeper.fetchTrending('drop', 24, 15),
                        ]);
                        setTrending({ adds: adds || [], drops: drops || [] });
                    } catch (e) { window.wrLog && window.wrLog('trending.fetch', e); }
                })();
            }
        }

        async function switchYear(year) {
            if (year === activeYear) return;
            // Year switching requires a previous_league_id chain — check the
            // platform provider capability instead of hardcoding Sleeper.
            const provider = resolvePlatformProvider(currentLeague);
            if (!provider?.capabilities?.hasYearChain) {
                console.warn('[War Room] Year switching not supported for ' + (provider?.displayName || 'this platform'));
                return;
            }
            setLoading(true);
            setError(null);
            setActiveYear(year);
            setTimeYear(parseInt(year));
            try {
                const targetYear = parseInt(year);
                const currentYear = parseInt(activeYear);
                let targetLeagueId = null;

                if (targetYear < currentYear) {
                    // Going backward: walk previous_league_id chain
                    let leagueId = currentLeague.id;
                    for (let y = currentYear; y > targetYear && leagueId; y--) {
                        const leagueInfo = await fetchLeagueInfo(leagueId);
                        leagueId = leagueInfo?.previous_league_id || null;
                    }
                    targetLeagueId = leagueId;
                } else {
                    // Going forward: get user leagues for target year, then check which one chains back to current league
                    const userLeagues = await fetchUserLeagues(sleeperUserId, year);
                    for (const lg of userLeagues) {
                        // Walk this league's previous_league_id chain to see if it connects to our current league
                        let checkId = lg.previous_league_id;
                        let steps = targetYear - currentYear;
                        while (steps > 1 && checkId) {
                            const info = await fetchLeagueInfo(checkId);
                            checkId = info?.previous_league_id || null;
                            steps--;
                        }
                        if (checkId === currentLeague.id) {
                            targetLeagueId = lg.league_id;
                            break;
                        }
                    }
                    // Fallback: match by name if chain doesn't connect
                    if (!targetLeagueId) {
                        const nameMatch = userLeagues.find(l => l.name === currentLeague.name);
                        targetLeagueId = nameMatch ? nameMatch.league_id : (userLeagues[0] ? userLeagues[0].league_id : null);
                    }
                }

                if (!targetLeagueId) {
                    setError('No leagues found for ' + year);
                    setLoading(false);
                    return;
                }

                const [leagueInfo, rosters, users] = await Promise.all([
                    fetchLeagueInfo(targetLeagueId),
                    fetchLeagueRosters(targetLeagueId),
                    fetchLeagueUsers(targetLeagueId)
                ]);
                setViewingOwnerId(sleeperUserId);
                setCurrentLeague({
                    id: targetLeagueId,
                    total_rosters: leagueInfo.total_rosters,
                    status: leagueInfo.status,
                    name: leagueInfo.name,
                    season: year,
                    scoring_settings: leagueInfo.scoring_settings || {},
                    roster_positions: leagueInfo.roster_positions || [],
                    settings: leagueInfo.settings || {},
                    rosters,
                    users
                });
            } catch (err) {
                console.error('Failed to switch year:', err);
                setError('Failed to load ' + year + ' data');
                setLoading(false);
            }
        }

        function getPlayerName(playerId) {
            const player = playersData[playerId];
            if (!player) return `Player ${playerId}`;
            return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
        }

        function getPlayerPosition(playerId) {
            const player = playersData[playerId];
            return player?.position || '??';
        }

        function getPlayerTeam(playerId) {
            const player = playersData[playerId];
            return player?.team || '';
        }

        // Compute fantasy pts using the league's actual scoring_settings weights,
        // applied to raw stat fields — works for both offensive and IDP players.
        // Mirrors the Team Comps page's fantasyPointsFromScoring() approach:
        // always use scoring_settings when available so IDP defensive stats aren't
        // silently zeroed out by Sleeper's pre-calculated pts_half_ppr = 0.
        function calcRawPts(s) {
            return window.App.calcRawPts(s, currentLeague?.scoring_settings);
        }

        function getPlayerStats(playerId) {
            const player = playersData[playerId];
            // Always show STATS_YEAR totals; fall back to current-season data for historical year views
            const s = stats2025Data[playerId] || statsData[playerId];
            const p = projectionsData[playerId];

            // Years of experience
            const yrs = player?.years_exp != null ? player.years_exp : '-';

            // Fantasy points — uses league scoring_settings for IDP players
            const rawPts = calcRawPts(s);
            const pts = rawPts !== null ? Number(rawPts).toFixed(1) : '-';

            // Games played
            const gp = s?.gp != null ? s.gp : '-';

            // Average points per game
            let avg = '-';
            if (rawPts !== null && s?.gp && s.gp > 0) {
                avg = (rawPts / s.gp).toFixed(1);
            }

            // Projected points — use Sleeper projections when available, otherwise 2025 season totals
            const rawProj = p ? (p.pts_half_ppr ?? p.pts_ppr ?? p.pts_std ?? null) : null;
            const rawPts2025 = calcRawPts(stats2025Data[playerId]);
            const proj = rawProj !== null ? Number(rawProj).toFixed(1) : (rawPts2025 !== null ? Number(rawPts2025).toFixed(1) : '-');

            return { yrs, pts, gp, avg, proj };
        }

        function getPositionColor(pos) {
            const colors = { QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)', K: 'var(--k-bb8fce, #bb8fce)', DEF: 'var(--k-85929e, #85929e)' };
            return colors[pos] || 'var(--silver)';
        }

        function getPositionLabel(pos) {
            return window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
        }

        // Dashboard helpers
        function timeAgo(ts) {
            if (!ts) return '';
            // Sleeper API returns seconds; convert to ms. Guard against already-ms values.
            const tsMs = ts > 1e12 ? ts : ts * 1000;
            const diff = Date.now() - tsMs;
            if (diff < 0) return 'just now';
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            const days = Math.floor(hrs / 24);
            if (days < 30) return days + 'd ago';
            return Math.floor(days / 30) + 'mo ago';
        }

        function getOwnerName(rosterId) {
            const roster = currentLeague.rosters?.find(r => r.roster_id === rosterId);
            const user = currentLeague.users?.find(u => u.user_id === roster?.owner_id);
            return user?.display_name || user?.username || 'Unknown';
        }


        if (error) {
            return (
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--white)', padding: '2rem', textAlign: 'center' }}>
                    <div style={{ color: 'var(--k-e74c3c, #e74c3c)', fontSize: '1.5rem', marginBottom: '1rem' }}>Error Loading League</div>
                    <div style={{ color: 'var(--silver)', marginBottom: '2rem' }}>{error}</div>
                    <button onClick={onBack} style={{ padding: '0.75rem 1.5rem', background: 'var(--gold)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--black)', fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '700', cursor: 'pointer' }}>← Back to Dashboard</button>
                </div>
            );
        }

        if (loading) {
            return (
                <div className="app-container wr-skel-shell" style={{ paddingBottom: '60px' }}>
                    {/* Phone tier (≤767): no dead 160px rail — full-width single column.
                        !important beats the inline styles below; tablet (768–1023) and
                        desktop keep the rail exactly as-is. */}
                    <style>{`@media(max-width:767px){
                        .wr-skel-shell{padding-bottom:calc(60px + var(--sab, env(safe-area-inset-bottom, 0px))) !important}
                        .wr-skel-rail{display:none !important}
                        .wr-skel-main{margin-left:0 !important;padding:calc(16px + var(--sat, env(safe-area-inset-top, 0px))) 12px 24px !important}
                        .wr-skel-kpis{grid-template-columns:repeat(auto-fit,minmax(120px,1fr)) !important}
                        .wr-skel-cols{grid-template-columns:1fr !important}
                    }`}</style>
                    {/* Skeleton left nav */}
                    <div className="wr-skel-rail" style={{ position:'fixed', left:0, top:0, bottom:0, width:'160px', background:'var(--black)', borderRight:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', padding:'16px 0', zIndex:100 }}>
                        <div className="wr-wordmark" style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.3rem', color:'var(--gold)', padding:'0 16px', marginBottom:'20px' }}>DYNASTY HQ</div>
                        {['Home','My Team','League','Analytics','Trades','Free Agency','Draft'].map((label,i) => (
                            <div key={i} style={{ padding:'10px 16px', fontSize:'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', color: i===0?'var(--gold)':'var(--ov-8, rgba(255,255,255,0.3))', borderLeft: i===0?'3px solid var(--gold)':'3px solid transparent', background: i===0?'var(--acc-fill2, rgba(212,175,55,0.12))':'transparent' }}>{label}</div>
                        ))}
                    </div>
                    {/* Skeleton main content */}
                    <div className="wr-skel-main" style={{ marginLeft:'160px', padding:'24px 32px' }}>
                        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', color:'var(--gold)', marginBottom:'16px' }}>{currentLeague.name}</div>
                        {/* KPI skeleton row */}
                        <div className="wr-skel-kpis" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'24px' }}>
                            <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
                        </div>
                        {/* Hero skeleton */}
                        <div className="skel-card" style={{ height:'120px', marginBottom:'20px' }}>
                            <div className="skel skel-line" style={{ width:'70%' }} />
                            <div className="skel skel-line" style={{ width:'90%' }} />
                            <div className="skel skel-line" style={{ width:'50%' }} />
                        </div>
                        {/* Two-column skeleton */}
                        <div className="wr-skel-cols" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                        </div>
                    </div>
                </div>
            );
        }

        // Currently viewed roster
        const viewingRoster = currentLeague.rosters.find(r => r.owner_id === viewingOwnerId) || myRoster;
        const viewingOwner = standings.find(t => t.userId === viewingOwnerId);
        const isViewingMyTeam = viewingOwnerId === sleeperUserId;

        // Stat column style shared by header and rows
        const statColStyle = { width: '42px', textAlign: 'center', fontSize: 'var(--text-label, 0.75rem)', flexShrink: 0 };

        // Column header row for stat columns — merged into section labels
        const statLabels = ['DHQ', 'YRS', 'PTS', 'GP', 'AVG', 'PROJ'];

        function SectionLabel({ label, color, borderColor, borderWidth }) {
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                    paddingBottom: '0.4rem',
                    borderBottom: `${borderWidth || '1px'} solid ${borderColor || color}`,
                    gap: '0.5rem'
                }}>
                    <span style={{ width: '36px', flexShrink: 0 }}></span>
                    <span style={{ flex: 1, color: color, fontSize: 'var(--text-body, 1rem)', fontWeight: '700', letterSpacing: '0.08em' }}>{label}</span>
                    {statLabels.map(l => (
                        <span key={l} style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700', letterSpacing: '0.05em', opacity: 0.8 }}>{l}</span>
                    ))}
                </div>
            );
        }

        // PlayerRow with gold position box, clickable name, 5 stat columns
        function PlayerRow({ playerId, section }) {
            const pos = getPlayerPosition(playerId);
            const stats = getPlayerStats(playerId);
            const team = getPlayerTeam(playerId);
            const borderColor = section === 'starter' ? 'var(--gold)' : section === 'ir' ? 'var(--k-e74c3c, #e74c3c)' : section === 'taxi' ? 'var(--k-3498db, #3498db)' : 'transparent';
            const bgColor = section === 'starter' ? 'var(--acc-fill1, rgba(212, 175, 55, 0.05))' : section === 'ir' ? 'rgba(231, 76, 60, 0.05)' : section === 'taxi' ? 'rgba(52, 152, 219, 0.05)' : 'var(--ov-1, rgba(255, 255, 255, 0.02))';
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.45rem 0.6rem',
                    marginBottom: '0.3rem',
                    background: bgColor,
                    borderLeft: borderColor !== 'transparent' ? `3px solid ${borderColor}` : 'none',
                    borderRadius: 'var(--card-radius-xs, 5px)',
                    gap: '0.5rem'
                }}>
                    {/* Gold position box */}
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        flexShrink: 0,
                        fontSize: 'var(--text-label, 0.75rem)',
                        fontWeight: '700',
                        color: getPositionColor(pos),
                        border: '1.5px solid var(--gold)',
                        borderRadius: '3px',
                        padding: '2px 0',
                        background: 'var(--acc-fill2, rgba(212, 175, 55, 0.08))',
                        letterSpacing: '0.02em'
                    }}>
                        {getPositionLabel(pos)}
                    </span>
                    {/* Player name + team — opens shared player card */}
                    <a
                        href="#"
                        onClick={e => { e.preventDefault(); if (window._wrSelectPlayer) window._wrSelectPlayer(playerId); }}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: 'var(--white)',
                            fontSize: 'var(--text-body, 1rem)',
                            overflow: 'hidden',
                            textDecoration: 'none',
                            transition: 'color 0.2s',
                            minWidth: 0,
                            cursor: 'pointer'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--white)'}
                    >
                        <div style={{ width: '28px', height: '28px', flexShrink: 0 }}>
                        <img
                            src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
                            alt=""
                            onError={e => { e.target.style.display = 'none'; }}
                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getPlayerName(playerId)} <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.65 }}>{team}</span>
                        </span>
                    </a>
                    {/* Format-aware value (ROS in redraft, DHQ dynasty value elsewhere) */}
                    {(() => {
                      const pv = window.App?.PlayerValue;
                      const dhq = (pv?.isRedraftActive?.() ? pv.getValue(playerId) : window.App?.LI?.playerScores?.[playerId]) ?? null;
                      if (dhq == null) return <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-body, 1rem)' }}>—</span>;
                      const col = dhq >= 7000 ? 'var(--k-2ecc71, #2ecc71)' : dhq >= 4000 ? 'var(--k-d4af37, #d4af37)' : dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.4))';
                      return <span style={{ ...statColStyle, color: col, fontWeight: '700', fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', minWidth: '42px' }}>{dhq.toLocaleString()}</span>;
                    })()}
                    {/* Stat columns: YRS PTS GP AVG PROJ */}
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.yrs}</span>
                    <span style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700' }}>{stats.pts}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.gp}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.avg}</span>
                    <span style={{ ...statColStyle, color: 'var(--k-4ecdc4, #4ecdc4)', fontWeight: '600' }}>{stats.proj}</span>
                </div>
            );
        }

        // Reusable roster section renderer
        function RosterSection({ roster }) {
            if (!roster) return <div style={{ textAlign: 'center', color: 'var(--silver)', padding: '2rem' }}>No roster found</div>;
            const starters = roster.starters || [];
            const reserve = roster.reserve || [];
            const taxi = roster.taxi || [];
            const bench = (roster.players || []).filter(p => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p));

            return (
                <>
                    {starters.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="STARTERS" color="var(--gold)" borderColor="var(--gold)" borderWidth="2px" />
                            {starters.map((id, i) => <PlayerRow key={i} playerId={id} section="starter" />)}
                        </div>
                    )}
                    {bench.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="BENCH" color="var(--silver)" borderColor="var(--ov-6, rgba(255,255,255,0.15))" />
                            {bench.map((id, i) => <PlayerRow key={i} playerId={id} section="bench" />)}
                        </div>
                    )}
                    {reserve.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="INJURED RESERVE" color="var(--k-e74c3c, #e74c3c)" borderColor="rgba(231,76,60,0.3)" />
                            {reserve.map((id, i) => <PlayerRow key={i} playerId={id} section="ir" />)}
                        </div>
                    )}
                    {taxi.length > 0 && (
                        <div>
                            <SectionLabel label="TAXI SQUAD" color="var(--k-3498db, #3498db)" borderColor="rgba(52,152,219,0.3)" />
                            {taxi.map((id, i) => <PlayerRow key={i} playerId={id} section="taxi" />)}
                        </div>
                    )}
                </>
            );
        }

        // --- My Team Tab helpers ---
        function getAcquisitionInfo(pid, rosterId) {
            const sameRoster = (a, b) => String(a) === String(b);
            const getAddOwner = (txn, playerId) => txn?.adds ? (txn.adds[playerId] ?? txn.adds[String(playerId)]) : undefined;
            const txnDate = (created) => {
                const raw = Number(created || 0);
                if (!raw) return null;
                return new Date(raw > 1000000000000 ? raw : raw * 1000);
            };
            const fmtDate = (d) => d && !Number.isNaN(d.getTime())
                ? d.toLocaleDateString('en-US', {month:'numeric', day:'numeric', year: '2-digit'})
                : '\u2014';

            // Collect ALL transactions from window.S.transactions (all weeks) + recent list
            const allTxns = [];
            const txnMap = window.S?.transactions || {};
            if (typeof txnMap === 'object' && !Array.isArray(txnMap)) {
                Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) allTxns.push(...arr); });
            }
            // Also include the component-level transactions
            if (transactions?.length) allTxns.push(...transactions);
            // Deduplicate by transaction_id
            const seen = new Set();
            const txns = allTxns.filter(t => {
                const key = t.transaction_id || (t.created + '-' + t.type);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).sort((a, b) => (b.created || 0) - (a.created || 0));

            // Check waiver/FA transactions (most recent first)
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if ((t.type === 'waiver' || t.type === 'free_agent') && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const cost = t.settings?.waiver_bid || 0;
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: t.type === 'waiver' ? 'Waiver' : 'FA', date, cost: cost > 0 ? '$' + cost : '', season: d ? String(d.getFullYear()) : '', week: t.leg || t.week || 0 };
                }
            }
            // Check trades — search LI trade history
            const trades = window.App?.LI?.tradeHistory || [];
            for (const t of trades) {
                if (!t.sides) continue;
                const side = t.sides[rosterId] || t.sides[String(rosterId)];
                if (side && side.players && side.players.some(p => String(p) === String(pid))) {
                    const season = t.season || '';
                    const week = t.week || '';
                    // Identify partner (other roster on the trade)
                    const partners = (t.roster_ids || Object.keys(t.sides)).filter(r => String(r) !== String(rosterId));
                    const partnerRid = partners[0];
                    // window.S.leagueUsers is the canonical key (set in the hydrate
                    // block above). Using .users used to silently return no match.
                    const users = window.S?.leagueUsers || [];
                    const rosters = window.S?.rosters || [];
                    const partnerRoster = rosters.find(r => String(r.roster_id) === String(partnerRid));
                    const partnerUser = users.find(u => u.user_id === partnerRoster?.owner_id);
                    const partnerName = partnerUser?.display_name || partnerUser?.metadata?.team_name || (partnerRid != null ? 'T' + partnerRid : '');
                    const date = season + (week ? ' W' + week : '');
                    return { method: 'Traded', date, cost: partnerName || '', season, week };
                }
            }
            // Fallback: check raw transaction data for trades
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if (t.type === 'trade' && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: 'Traded', date, cost: '', season: d ? String(d.getFullYear()) : '', week: t.leg || 0 };
                }
            }
            // Check draft outcomes
            const drafts = window.App?.LI?.draftOutcomes || [];
            const draftPick = drafts.find(d => String(d.pid) === String(pid) && sameRoster(d.roster_id, rosterId));
            if (draftPick) {
                // Format as "2024 2.03" when we know the pick slot, else "2024 R2"
                const totalTeams = window.S?.league?.total_rosters || (window.S?.rosters?.length) || 12;
                const slotInRound = draftPick.pick_no != null && totalTeams ? (((draftPick.pick_no - 1) % totalTeams) + 1) : null;
                const slotStr = slotInRound != null ? (draftPick.round + '.' + String(slotInRound).padStart(2, '0')) : ('R' + draftPick.round);
                return { method: 'Drafted', date: draftPick.season + ' ' + slotStr, cost: '', season: draftPick.season, week: 0 };
            }
            // Default: original/keeper
            return { method: 'Original', date: '\u2014', cost: '', season: '', week: 0 };
        }

        const desktopCommandExpanded = alexVp.isDesktop && !sidebarCollapsed;
        const sidebarWidth = sidebarCollapsed ? 72 : alexVp.isDesktop ? 184 : 176;
        // Icon paths live at module scope (NAV_ICON_PATHS, above PhoneDock)
        // so the sidebar and the phone dock strip draw the same glyphs.
        const iconPaths = NAV_ICON_PATHS;
        const renderNavIcon = (key) => React.createElement('svg', {
            className: 'wr-sidebar-icon',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
        }, ...(iconPaths[key] || iconPaths.home).map((d, idx) => React.createElement('path', { key: idx, d })));

        // Nav definition — single source of truth (module-scope
        // buildLeagueNavItems). The sidebar maps this array below and the
        // SAME array instance feeds the PhoneDock strip at the bottom of
        // this render, so the two surfaces can never drift.
        const navItems = buildLeagueNavItems(workspaceOptions);

        // Overview and Lenses share live cards, but only Lenses owns editing and
        // saved layouts. Opening Overview never reads or changes the active lens.
        const dashboardEl = (widgets, overview = false) => (
            <DashboardPanel key={widgetAccountScope}
                overview={overview}
                selectedWidgets={overview || widgetLayoutScope === widgetAccountScope ? widgets : loadWidgetLayout()}
                setSelectedWidgets={setSelectedWidgets}
                editingKpi={editingKpi}
                setEditingKpi={setEditingKpi}
                computeKpiValue={computeKpiValue}
                KPI_OPTIONS={KPI_OPTIONS}
                rankedTeams={rankedTeams}
                sleeperUserId={sleeperUserId}
                setActiveTab={setActiveTab}
                transactions={transactions}
                standings={standings}
                currentLeague={currentLeague}
                lensLeagues={lensLeagues}
                lensPortfolioCoverage={lensPortfolioCoverage}
                leagueSkin={leagueSkin}
                playersData={playersData}
                viewPlayersData={basePlayersData || playersData}
                statsData={statsData}
                prevStatsData={stats2025Data}
                myRoster={myRoster}
                getOwnerName={getOwnerName}
                getPlayerName={getPlayerName}
                timeAgo={timeAgo}
                briefDraftInfo={briefDraftInfo}
                timeRecomputeTs={timeRecomputeTs}
            />
        );

        const openLeagueTeam = (rosterId, context = {}) => {
            const roster = currentLeague?.rosters?.find(row => String(row.roster_id) === String(rosterId));
            if (!roster) return;
            const standing = standings.find(row => String(row.rosterId) === String(rosterId) || String(row.userId) === String(roster.owner_id)) || {};
            setLeagueSelectedTeam({ ...standing, ...context, roster, rosterId: roster.roster_id, userId: roster.owner_id, displayName: getOwnerName(roster.roster_id) });
            setLeagueViewMode('roster');
            setActiveTab('league-team');
        };
        const showLeagueOverview = alexPhone && isCurrentYear && leagueSkin?.phase === 'in_season';
        const _seasonCtxValue = { ...seasonCtxData, leagueSkin, selectPlayer };
        const leagueSkinClassName = leagueSkin?.theme?.className || (leagueSkin?.type ? 'wr-league-skin-' + leagueSkin.type : 'wr-league-skin-default');

        return (
          <window.App.SeasonContext.Provider value={_seasonCtxValue}>
            <div className={'app-container wr-mission-control wr-mission-v8 ' + (desktopCommandExpanded ? 'wr-browser-command-expanded ' : '') + leagueSkinClassName} data-league-skin-type={leagueSkin?.type || 'unknown'} data-league-skin-theme={leagueSkin?.theme?.id || 'war-room-default'} onWheel={rerouteWheelToPage} style={{ paddingBottom: '60px' }}>
                {/* DHQ Loading Bubble — .wr-dhq-bubble: phone tier repoints it
                    above the bottom dock (index.html PHONE TIER block). */}
                {dhqStatus.loading && (
                    <div className="wr-dhq-bubble" style={{
                        position: 'fixed', bottom: '24px', left: '80px', zIndex: 300,
                        background: 'var(--black)', border: '2px solid var(--acc-line3, rgba(212,175,55,0.4))',
                        borderRadius: '16px', padding: '16px 20px', minWidth: '280px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        animation: 'fadeSlideUp 0.3s ease'
                    }}>
                        <style>{`@keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes dhqSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <div style={{
                                width: '20px', height: '20px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                borderTopColor: 'var(--gold)', borderRadius: '50%',
                                animation: 'dhqSpin 0.8s linear infinite'
                            }}></div>
                            <div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.04em' }}>BUILDING LEAGUE INTELLIGENCE</div>
                                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginTop: '2px' }}>{dhqStatus.step}</div>
                            </div>
                        </div>
                        <div style={{ background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 'var(--card-radius-xs, 5px)', height: '4px', overflow: 'hidden' }}>
                            <div style={{
                                width: dhqStatus.progress + '%', height: '100%',
                                background: 'linear-gradient(90deg, var(--gold), var(--k-f0a500, #f0a500))',
                                borderRadius: 'var(--card-radius-xs, 5px)', transition: 'width 0.5s ease'
                            }}></div>
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '6px', opacity: 0.6 }}>
                            {dhqStatus.progress < 50 ? 'Analyzing league history, stats, drafts, and transactions. First load takes ~15 seconds, then it\'s cached.' :
                             dhqStatus.progress < 80 ? 'Scoring every player in your league\'s scoring system...' :
                             'Almost done — blending market data and computing trade values.'}
                        </div>
                    </div>
                )}

                {/* Mobile hamburger toggle \u2014 hidden while the phone Alex sheet is
                    open (it would paint above the sheet and toggle the drawer
                    invisibly beneath it). PHONE (one-row header live): removed
                    entirely \u2014 the dock strip covers every nav item and Refresh
                    moved into the header sheet (owner ruling 2026-07-09). The
                    768-1023 drawer tier keeps it \u2014 no dock there. */}
                {/* iPad pass: status-bar scrim — the non-phone header is NOT sticky
                    (desktop-parity ruling), so scrolled content would bleed under
                    the transparent status bar in installed-PWA. height = --sat →
                    zero-height (invisible) everywhere else. Phone has the sticky
                    header as its backdrop instead. */}
                {!phoneHdrKit && <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--sat, 0px)', background: 'var(--black, #0a0a0a)', zIndex: 60 }} />}
                {!phoneHdrKit && <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
                    // iPad pass (G3): --sat/--sal terms are env()=0 everywhere but
                    // installed-PWA on device — desktop stays byte-identical.
                    display: 'none', position: 'fixed', top: 'calc(10px + var(--sat, 0px) + var(--wr-dev-banner-height, 0px))', left: 'calc(10px + var(--sal, 0px))', zIndex: 201,
                    background: 'var(--black)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm, 8px)',
                    padding: '6px 10px', cursor: 'pointer', color: 'var(--gold)', fontSize: '1.2rem', lineHeight: 1
                }} className="wr-hamburger">{sidebarOpen ? '\u2715' : '\u2630'}</button>}
                <style>{`@media(max-width:1023px){
                    html,body,#root{max-width:100%;overflow-x:clip;overflow-y:visible}
                    .wr-hamburger{display:block !important}
                    .wr-sidebar{left:-220px !important;top:var(--wr-dev-banner-height,0px) !important;transform:none !important}
                    .wr-sidebar.open{left:0 !important}
                    .wr-main-content{margin-left:0 !important;width:100% !important;max-width:100vw !important;overflow-x:clip;overflow-y:visible;box-sizing:border-box;padding-top:var(--wr-dev-banner-height,0px)}
                }
                @media(max-width:767px){
                    /* Phone header: compact two-zone layout — title + SWITCH share the
                       top line, and the status badges flow inline (wrapping) on the
                       line(s) below, instead of one full-width row per badge (which
                       stacked the header to ~180px tall). */
                    .wr-league-header-row{display:flex !important;flex-wrap:wrap !important;align-items:center !important;gap:6px !important;padding-left:44px}
                    .wr-league-header-row .header-title{flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-body, 1rem) !important;line-height:1.2}
                    .wr-league-switch{flex:0 0 auto;margin-left:auto}
                    .wr-hdr-break{display:block !important;flex-basis:100%;width:100%;height:0;margin:0;padding:0;border:0}
                    .wr-gm-mode-badge,.wr-league-type-badge,.wr-league-phase-badge,.wr-draft-header-clock{flex:0 0 auto;min-width:0;max-width:100%;padding-top:3px !important;padding-bottom:3px !important}
                    .wr-draft-header-clock{overflow:hidden}
                    .wr-draft-header-clock>span{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                    .wr-draft-header-clock>strong{flex-shrink:0}
                    .wr-time-bar{align-items:flex-start !important;padding:8px 10px !important;gap:6px !important}
                    .wr-time-years{width:auto;max-width:100%;overflow:visible;flex-wrap:wrap !important;padding-bottom:2px}
                    .wr-time-spacer{display:none !important}
                    .wr-time-mode{margin-left:0;flex-shrink:0}
                    .wr-time-banner{padding:8px 10px !important;flex-direction:column;align-items:flex-start !important;gap:4px !important}
                    .wr-time-banner button{margin-left:0 !important;width:100%;max-width:220px}
                    .wr-debug-strip{padding:4px 10px !important;overflow-x:auto;overflow-y:clip}
                    .wr-debug-strip>div{min-width:max-content}
                }`}</style>
                {/* iPad-portrait header collapse (768–1023): year pills → compact
                    dropdown, and the league header + time bar become single
                    scrollable lines so the header stops stacking into ~190px. */}
                <style>{`@media(max-width:1023px){
                    .wr-time-years{display:none !important}
                    .wr-time-years-select{display:inline-block !important}
                }
                @media(min-width:768px) and (max-width:1023px){
                    .wr-league-header-row{flex-wrap:nowrap !important;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}
                    .wr-league-header-row::-webkit-scrollbar{display:none}
                    .wr-time-bar{flex-wrap:nowrap !important;overflow-x:auto;scrollbar-width:none}
                    .wr-time-bar::-webkit-scrollbar{display:none}
                    /* iPad pass F2b: the fixed hamburger (left ~10px, ~41px wide)
                       overlapped the league title at the drawer tier — same 44px
                       clearance the phone tier gets. */
                    .wr-league-header-row{padding-left:44px}
                }`}</style>

                {/* Mobile overlay */}
                {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ display: 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99 }} className="wr-sidebar-overlay" />}
                <style>{`@media(max-width:1023px){.wr-sidebar-overlay{display:block !important}}`}</style>

                {/* Left Navigation */}
                <div className={'wr-sidebar' + (sidebarOpen ? ' open' : '') + (sidebarCollapsed ? ' is-collapsed' : '')} style={{
                    position: 'fixed', left: 0, top: 0, bottom: 0, width: sidebarWidth + 'px',
                    background: 'var(--black)', borderRight: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
                    display: 'flex', flexDirection: 'column',
                    padding: '16px 0', zIndex: 100, transition: 'width 0.18s ease, transform 0.2s ease'
                }}>
                    {/* Logo — click to go home */}
                    <div className="wr-sidebar-brand" onClick={onBack} style={{ padding: '0 14px', marginBottom: sidebarCollapsed ? '10px' : '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} title="Back to Dynasty HQ home">
                      <img src={iconSrc} alt="Dynasty HQ" style={{ width: '28px', height: '28px', borderRadius: 'var(--card-radius-sm, 8px)' }} onError={e => { e.target.style.display = 'none'; }} />
                      <div className="wr-sidebar-wordmark">
                        <div className="wr-wordmark" style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', lineHeight: 1.1 }}>DYNASTY HQ</div>
                      </div>
                      {(() => {
                        const champs = window.App?.LI?.championships || {};
                        const cnt = Object.values(champs).filter(c => c.champion === myRoster?.roster_id).length;
                        // iPad pass: the \u00D7N count lived only in the hover title \u2014
                        // surface it inline on coarse pointers (fine-pointer identical).
                        if (cnt > 0) return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)' }} title={cnt + 'x Champion'}>{'\uD83C\uDFC6'}{alexVp.isCoarse && cnt > 1 ? '\u00D7' + cnt : ''}</span>;
                        return null;
                      })()}
                    </div>

                    <button
                        className="wr-sidebar-toggle"
                        onClick={() => setSidebarCollapsed(prev => !prev)}
                        title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        style={{ width: sidebarCollapsed ? '34px' : 'calc(100% - 24px)', height: '30px', margin: '0 12px 12px' }}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {sidebarCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
                        </svg>
                        {!sidebarCollapsed && <span style={{ marginLeft: '8px', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hide Menu</span>}
                    </button>

                    {/* Alerts removed — rolled into Brief */}

                    {/* Sidebar Search */}
                    {!sidebarCollapsed && React.createElement(function SidebarSearch() {
                        const [q, setQ] = React.useState('');
                        const [results, setResults] = React.useState([]);
                        const inputRef = React.useRef(null);
                        React.useEffect(() => {
                            if (!q || q.length < 2) { setResults([]); return; }
                            const lower = q.toLowerCase();
                            const matches = [];
                            // Search players
                            Object.entries(playersData || {}).forEach(([pid, p]) => {
                                if (matches.length >= 6) return;
                                const name = p.full_name || '';
                                if (name.toLowerCase().includes(lower)) matches.push({ type: 'player', pid, name, pos: p.position || '?', team: p.team || 'FA' });
                            });
                            // Search tabs
                            window.WR.LeagueWorkspaces.navigation(workspaceOptions).flatMap(group => [{ label: group.label, tab: group.tab }, ...window.WR.LeagueWorkspaces.views(group.id, workspaceOptions)]).forEach(t => {
                                if (t.label.toLowerCase().includes(lower)) matches.push({ type: 'tab', label: t.label, tab: t.tab });
                            });
                            setResults(matches.slice(0, 8));
                        }, [q]);
                        return React.createElement('div', { className: 'wr-sidebar-search', style: { padding: '4px 12px 8px', position: 'relative' } },
                            React.createElement('input', {
                                ref: inputRef, type: 'text', placeholder: 'Search...', value: q,
                                onChange: e => setQ(e.target.value),
                                onKeyDown: e => { if (e.key === 'Escape') { setQ(''); setResults([]); } },
                                style: { width: '100%', padding: '7px 10px 7px 28px', fontSize: 'var(--text-label, 0.75rem)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--silver)', fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box' }
                            }),
                            React.createElement('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'var(--acc-line3, rgba(212,175,55,0.4))', strokeWidth: 2, style: { position: 'absolute', left: '20px', top: '11px', pointerEvents: 'none' } },
                                React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
                                React.createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
                            ),
                            results.length > 0 && React.createElement('div', { style: { position: 'absolute', left: '12px', right: '12px', top: '100%', background: 'var(--k-0d0d0d, #0d0d0d)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '0 0 8px 8px', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: '240px', overflowY: 'auto' } },
                                results.map((r, i) => React.createElement('div', {
                                    key: i,
                                    onClick: () => {
                                        if (r.type === 'player') { setSidebarOpen(false); selectPlayer(r.pid); }
                                        else if (r.type === 'tab') { setSidebarOpen(false); setActiveTab(r.tab); }
                                        setQ(''); setResults([]);
                                    },
                                    style: { padding: '6px 10px', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' },
                                    onMouseEnter: e => e.currentTarget.style.background = 'var(--acc-fill2, rgba(212,175,55,0.08))',
                                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                                },
                                    r.type === 'player'
                                        ? [
                                            React.createElement('span', { key: 'n', style: { color: 'var(--white)', fontWeight: 500, flex: 1 } }, r.name),
                                            React.createElement('span', { key: 'p', style: { fontSize: 'var(--text-label, 0.75rem)', color: window.App?.POS_COLORS?.[window.App.normPos(r.pos)] || 'var(--silver)', fontWeight: 700 } }, window.App.normPos(r.pos)),
                                        ]
                                        : React.createElement('span', { style: { color: 'var(--gold)', fontWeight: 600 } }, '\u2192 ' + r.label)
                                ))
                            )
                        );
                    })}

                    {/* Expanded desktop exposes permitted views directly. The compact
                        icon rail and tablet drawer retain workspace navigation. */}
                    {desktopCommandExpanded ? <DesktopCommandNav activeTab={viewTab} workspaceOptions={workspaceOptions}
                        onSelectTab={tab => { setSidebarOpen(false); setActiveTab(tab); }} /> : navItems.map((item, i) => {
                        if (item.section) {
                            // Hairline divider only — section labels removed for a
                            // cleaner list. The grouping rhythm still reads via the
                            // thin rule between clusters. First section renders no
                            // top rule since there's nothing above it in the nav.
                            if (i === 0) return null;
                            return (
                                <div key={i} className="wr-sidebar-divider" style={{ height: '1px', margin: '8px 16px', background: 'var(--ov-4, rgba(255,255,255,0.06))' }} aria-hidden="true" />
                            );
                        }
                        const isActive = navItemIsActive(item, viewTab);
                        return (
                        <button key={i} aria-current={isActive ? 'page' : undefined} aria-label={item.label} onClick={() => { setSidebarOpen(false); item.tab ? setActiveTab(item.tab) : item.action ? item.action() : window.location.href = item.url; }}
                            className="wr-sidebar-nav-btn"
                            style={{
                                width: '100%', minHeight: '44px', padding: sidebarCollapsed ? '10px 0' : '9px 16px 9px 20px', border: 'none',
                                background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent',
                                borderLeft: isActive ? '3px solid var(--gold)' : '3px solid transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: '9px',
                                transition: 'all 0.15s',
                                color: isActive ? 'var(--gold)' : 'var(--silver)',
                                fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                fontWeight: isActive ? 700 : 400,
                                letterSpacing: '0.03em', textAlign: 'left',
                                position: 'relative',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                            {sidebarCollapsed && renderNavIcon(item.iconKey)}
                            {!sidebarCollapsed && <span className="wr-sidebar-label" style={{ flex: 1 }}>{item.label}</span>}
                            {item.isNew && <span className="wr-sidebar-new-badge" style={{
                                fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                                padding: '1px 5px', borderRadius: '3px',
                                background: 'rgba(46,204,113,0.2)', color: 'var(--k-2ecc71, #2ecc71)',
                                letterSpacing: '0.08em',
                            }}>NEW</span>}
                        </button>
                        );
                    })}

                    {/* Spacer */}
                    <div style={{ flex: 1 }}></div>

                    {/* Sync Status — live freshness readout (audit:refresh-stale step 7) */}
                    {(() => {
                        const syncBase = window.WR?.Sync?.lastSyncedAt || syncedAt;
                        const liReady = !!window.App?.LI_LOADED;
                        let label, color;
                        if (!liReady || !syncBase) {
                            label = liReady ? 'Synced' : 'Loading';
                            color = liReady ? 'var(--k-2ecc71, #2ecc71)' : 'var(--silver)';
                        } else {
                            const ageMs = Math.max(0, Date.now() - syncBase);
                            const mins = Math.floor(ageMs / 60000);
                            label = mins < 1 ? 'Synced just now'
                                : mins < 60 ? 'Synced ' + mins + 'm ago'
                                : 'Synced ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm ago';
                            const staleMs = window.WR?.Sync?.STALE_MS || 5 * 60 * 1000;
                            color = ageMs > 30 * 60 * 1000 ? 'var(--k-e74c3c, #e74c3c)'
                                : ageMs >= staleMs ? 'var(--k-f0a500, #f0a500)'
                                : 'var(--k-2ecc71, #2ecc71)';
                        }
                        return (
                            <div className="wr-sidebar-extra wr-sidebar-status" title="Auto-refreshes when you return to the tab. Click Refresh Data for a full rebuild (values + history)." style={{ fontSize: 'var(--text-body, 1rem)', color, textAlign: 'center', fontFamily: 'var(--font-body)', opacity: 0.7, marginBottom: '4px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, margin: '0 auto 2px' }}></div>
                                {label}
                            </div>
                        );
                    })()}

                    {/* Refresh Button */}
                    <button className="wr-sidebar-refresh" onClick={async () => {
                        try {
                            Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                            // Real cache clears (audit:refresh-stale step 2): the old
                            // `window._wrPlayersCache = null` never touched core.js's
                            // closure-scoped cache, and the sessionStorage key was a
                            // relic of the pre-IndexedDB players cache.
                            window.App?.clearDataCaches?.();
                            window.Sleeper?.clearSeasonCaches?.();
                            if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; window._liLoading = false; }
                        } catch(e) { window.wrLog('refresh.cleanup', e); }
                        await loadLeagueDetails();
                    }} style={{
                        width: '100%', padding: '10px 16px', border: 'none',
                        background: 'transparent', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', transition: 'all 0.15s', color: 'var(--gold)',
                        fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                        letterSpacing: '0.03em', textAlign: 'left', marginBottom: '8px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    title="Reload DHQ values, league history, and AI data"
                    >
                        {sidebarCollapsed ? renderNavIcon('refresh') : 'Refresh Data'}
                        {/* iPad pass: title= never fires on touch — promote the
                            info-exclusive tooltip to the tap-to-toggle Tip on
                            coarse pointers only (desktop byte-identical). */}
                        {!sidebarCollapsed && alexVp.isCoarse && typeof Tip === 'function' && <Tip>Reloads DHQ values, league history, and AI data. Data also auto-refreshes when you return to the tab.</Tip>}
                    </button>
                </div>

                {/* Main content shifted right */}
                <div className="wr-main-content" style={{
                    marginLeft: sidebarWidth + 'px',
                    width: 'calc(100vw - ' + sidebarWidth + 'px)',
                    maxWidth: 'calc(100vw - ' + sidebarWidth + 'px)',
                    minWidth: 0,
                    overflowX: 'clip',
                    overflowY: 'visible',
                    boxSizing: 'border-box',
                }}>
                {/* Header — collapsed into a single left-aligned strip.
                    Removed: redundant "{year} SEASON" subtitle (year picker below handles this)
                    and the duplicate league-name/team-count in the time context bar. */}
                {/* Phone header (kit tier): STICKY with safe-area top padding — the
                    solid .header gradient doubles as the status-bar/Dynamic-Island
                    backdrop, fixing (owner iPhone screenshots 2026-07-12): title
                    under the island, header scrolling away, and content bleeding
                    under the transparent status bar. z 60 sits above content +
                    sticky table columns (z≤50) and below drawer/dock/sheets
                    (99/100/150/200). Desktop/tablet branch byte-identical. */}
                <header className={'header' + (phoneHdrKit ? ' mc-v8-topbar' : '')} style={phoneHdrKit
                    ? { position: 'sticky', top: 'var(--wr-dev-banner-height, 0px)', zIndex: 60, marginBottom: '0', paddingTop: 'calc(0.35rem + var(--sat, 0px))', paddingBottom: '0.35rem' }
                    // iPad pass (G3): the inline paddingTop was overriding the base
                    // .header --sat rule, putting the league title under the status
                    // bar in installed-PWA. env()=0 off-device → desktop identical.
                    : { position: 'relative', marginBottom: '0', paddingTop: 'calc(0.6rem + var(--sat, 0px))', paddingBottom: '0.6rem' }}>
                    {phoneHdrKit ? (() => {
                        // ── ONE-ROW PHONE HEADER ── tap the name to switch leagues.
                        // Secondary controls live in the menu's League options.
                        const gm = (leagueSkin?.type !== 'redraft') ? window.WR?.GmMode?.describe?.(gmStrategy?.mode || 'compete') : null;
                        const phaseColor = (leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown') ? leagueSkin.phaseMeta.color : 'var(--text-muted)';
                        const rowSt = { display: 'flex', alignItems: 'center', gap: '10px', minHeight: '48px', padding: '2px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' };
                        const rowLbl = { fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', width: '92px', flex: 'none' };
                        const rowVal = { fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                        const doDraftJump = () => {
                            const jump = headerDraftInfo?.status === 'drafting' || headerDraftInfo?.status === 'complete';
                            if (jump) window._wrOpenLiveDraft = true;
                            setPhHdrSheetOpen(false);
                            setActiveTab('draft');
                            if (jump) window.dispatchEvent(new CustomEvent('wr:open-live-draft'));
                        };
                        const doRefresh = async () => {
                            setPhHdrSheetOpen(false);
                            try {
                                Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                window.App?.clearDataCaches?.();
                                window.Sleeper?.clearSeasonCaches?.();
                                if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; window._liLoading = false; }
                            } catch (e) { window.wrLog('refresh.cleanup', e); }
                            await loadLeagueDetails();
                        };
                        return (
                            <React.Fragment>
                                <div className="wr-phone-lhdr" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, paddingLeft: '2px' }}>
                                    <button type="button" className="mc-menu-trigger" aria-label="Open all views" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new CustomEvent('wr:phone-menu'))}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                                    </button>
                                    <button type="button" className="mc-league-switch" aria-label="Switch league"
                                        onClick={() => onBack({ leagueSelector: true })}
                                        style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minHeight: '44px', padding: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit' }}>
                                        <span aria-hidden="true" className="mc-v8-phase-dot" style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: phaseColor }} />
                                        <span className="mc-v8-league-identity"><small>DYNASTY HQ</small><strong>{currentLeague.name}</strong></span>
                                        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flex: 'none' }}>▾</span>
                                    </button>
                                    <button type="button" className="mc-alex-trigger" onClick={() => window.dispatchEvent(new CustomEvent('wr:mission-alex-open'))} aria-label="Chat with Alex"><span aria-hidden="true">✦</span> Alex</button>
                                </div>
                                {phHdrSheetOpen && <window.WR.Sheet open={true} onClose={() => setPhHdrSheetOpen(false)} title="League options">
                                    <div style={{ padding: '2px 16px 8px' }}>
                                        <p style={{ margin: '0 0 8px', color: 'var(--silver)', fontSize: '.875rem' }}>{currentLeague.name}</p>
                                        {gm && leagueSkin?.type !== 'chopped' && <button style={rowSt} onClick={() => { setPhHdrSheetOpen(false); if (setActiveTab) setActiveTab('strategy'); }}>
                                            <span style={rowLbl}>GM mode</span>
                                            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: gm.badgeColor, flex: 'none' }} />
                                            <span style={{ ...rowVal, color: gm.badgeColor }}>{gm.label}</span>
                                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>›</span>
                                        </button>}
                                        {/* Season selector — relocated from the (now phone-hidden) time bar.
                                            Native select → the iOS wheel picker; same handleTimeYearChange. */}
                                        <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Season</span>
                                            <select value={timeYear} onChange={e => handleTimeYearChange(Number(e.target.value))} aria-label="Season year" style={{ flex: 1, minWidth: 0, background: 'var(--ov-2, rgba(255,255,255,0.04))', color: isCurrentYear ? 'var(--gold)' : 'var(--k-45b7d1, #45b7d1)', border: '1px solid var(--ov-4, rgba(255,255,255,0.08))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '8px 10px', minHeight: '40px', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                                {(() => {
                                                    const opt = (yr) => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}{yr === currentSeason ? ' • current' : ''}</option>;
                                                    const past = timeYears.filter(y => y < currentSeason);
                                                    const cur = timeYears.filter(y => y === currentSeason);
                                                    const future = timeYears.filter(y => y > currentSeason);
                                                    return [
                                                        past.length ? <optgroup key="p" label="Past seasons">{past.map(opt)}</optgroup> : null,
                                                        cur.length ? <optgroup key="c" label="Current">{cur.map(opt)}</optgroup> : null,
                                                        future.length ? <optgroup key="f" label="Projected">{future.map(opt)}</optgroup> : null,
                                                    ];
                                                })()}
                                            </select>
                                        </div>
                                        {headerLeagueType && <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Type</span>
                                            <span style={{ ...rowVal, color: headerLeagueType.color }}>{headerLeagueType.label === 'League Type Unknown' ? 'Type ?' : headerLeagueType.label}</span>
                                        </div>}
                                        {leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown' && leagueSkin.phase !== 'drafting' && <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Phase</span>
                                            <span style={{ ...rowVal, color: leagueSkin.phaseMeta.color }}>{leagueSkin.phaseMeta.label}</span>
                                        </div>}
                                        <button style={rowSt} onClick={() => onBack({ leagueSelector: true })}><span style={rowVal}>Switch league</span></button>
                                        <button style={rowSt} onClick={doRefresh} disabled={!!loadStage}><span style={rowVal}>{loadStage ? 'Refreshing…' : 'Refresh data'}</span></button>
                                        {window.WR?.Feedback?.reportBug && <button style={rowSt} onClick={() => { setPhHdrSheetOpen(false); window.WR.Feedback.reportBug(); }}><span style={rowVal}>Report a bug</span></button>}
                                        {window.WR?.Feedback?.openBoard && <button style={rowSt} onClick={() => { setPhHdrSheetOpen(false); window.WR.Feedback.openBoard(); }}><span style={rowVal}>Feature requests</span></button>}
                                        {headerDraftClock && <button style={rowSt} onClick={doDraftJump}>
                                            <span style={rowLbl}>Draft</span>
                                            <span style={{ ...rowVal, color: 'var(--gold)', fontFamily: "'JetBrains Mono', monospace" }}>{[headerDraftClock.label, headerDraftClock.clock].filter(Boolean).join(' · ')}</span>
                                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>›</span>
                                        </button>}
                                    </div>
                                </window.WR.Sheet>}
                            </React.Fragment>
                        );
                    })() : (
                    <div className="wr-league-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px 10px', flexWrap: 'wrap', minWidth: 0 }}>
                        <div className="header-title" style={{ fontSize: '1.05rem', minWidth: 0, maxWidth: 'min(460px, 100%)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLeague.name}</div>
                        <button className="wr-league-switch" onClick={onBack} style={{ padding: '4px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--acc-fill2, rgba(212,175,55,0.10))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>SWITCH</button>
                        {/* Feedback (bug report + feature board) — re-homed here from the
                            floating bottom-right launcher that covered page content. */}
                        {window.WR?.Feedback?.toggleMenu && (
                            <button onClick={(e) => { e.stopPropagation(); window.WR.Feedback.toggleMenu(e.currentTarget); }} aria-label="Feedback" title="Report a bug or request a feature" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', minHeight: '28px', padding: '4px 8px', background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--gold)', cursor: 'pointer' }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                            </button>
                        )}
                        {/* Phone-only flex break: forces the status badges onto the line
                            below the title/SWITCH row. Inert (display:none) on desktop. */}
                        <div className="wr-hdr-break" aria-hidden="true" style={{ display: 'none' }} />
                        {(() => {
                            // Seasonal survival formats do not surface the dynasty-flavored
                            // GM badge; Chopped has its own Survival Plan in the briefing.
                            if (leagueSkin?.type === 'redraft' || leagueSkin?.type === 'chopped') return null;
                            const gm = window.WR?.GmMode?.describe?.(gmStrategy?.mode || 'compete');
                            if (!gm) return null;
                            // Calm treatment (owner ask 2026-08-09 — header read as a "confetti
                            // of badges", each status pill carrying its own saturated bg+border).
                            // Status indicators now read as dot + plain text, like the phone
                            // sheet's rows already do — color lives in the dot, not a fill/border,
                            // so gold (SWITCH, Draft Clock CTA) stays the one loud accent in the row.
                            return React.createElement('button', {
                                key: 'gm-badge-' + gm.id,
                                onClick: () => setActiveTab && setActiveTab('strategy'),
                                title: 'GM Mode — edit in GM\'s Office',
                                className: 'wr-gm-mode-badge',
                                style: {
                                    padding: '4px 6px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', fontWeight: 600,
                                    letterSpacing: '0.02em',
                                    background: 'transparent', color: 'var(--silver)',
                                    border: '1px solid transparent',
                                    borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
                                }
                            },
                                React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: gm.badgeColor, flexShrink: 0 } }),
                                'GM · ' + gm.label
                            );
                        })()}
                        {headerLeagueType && React.createElement('div', {
                            className: 'wr-league-type-badge',
                            title: 'League type: ' + headerLeagueType.label,
                            'aria-label': 'League type: ' + headerLeagueType.label,
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                flex: '0 0 auto', minWidth: 'max-content',
                                padding: '4px 6px',
                                color: 'var(--silver)',
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap',
                                cursor: 'help'
                            }
                        },
                            React.createElement(LeagueTypeHeaderIcon, { meta: headerLeagueType }),
                            headerLeagueType.label === 'League Type Unknown' ? 'Type ?' : headerLeagueType.label
                        )}
                        {leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown' && leagueSkin.phase !== 'drafting' && React.createElement('div', {
                            className: 'wr-league-phase-badge',
                            title: 'League phase: ' + leagueSkin.phaseMeta.label,
                            'aria-label': 'League phase: ' + leagueSkin.phaseMeta.label,
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                flex: '0 0 auto', minWidth: 'max-content',
                                padding: '4px 6px',
                                color: 'var(--silver)',
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap',
                                cursor: 'help'
                            }
                        },
                            React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: leagueSkin.phaseMeta.color, flexShrink: 0, display: 'inline-block' } }),
                            leagueSkin.phaseMeta.label
                        )}
                        {headerDraftClock && React.createElement('div', {
                            className: 'wr-draft-header-clock',
                            role: 'button',
                            tabIndex: 0,
                            title: headerDraftInfo?.status === 'drafting'
                                ? 'Jump to Follow Live Draft'
                                : headerDraftInfo?.status === 'complete'
                                    ? 'View the completed draft results'
                                    : (headerDraftInfo?.start_time ? 'Open the Draft module · ' + new Date(headerDraftInfo.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Open the Draft module'),
                            onClick: () => {
                                // 'drafting' jumps into the live mirror; 'complete' jumps to
                                // the finished board — DraftTab's _wrOpenLiveDraft flag path
                                // honors both statuses.
                                const jump = headerDraftInfo?.status === 'drafting' || headerDraftInfo?.status === 'complete';
                                if (jump) window._wrOpenLiveDraft = true;
                                setActiveTab('draft');
                                if (jump) window.dispatchEvent(new CustomEvent('wr:open-live-draft'));
                            },
                            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '7px',
                                flex: '0 0 auto',
                                padding: '4px 10px', borderRadius: 'var(--card-radius-sm, 8px)',
                                border: '1px solid var(--acc-line3, rgba(212,175,55,0.42))',
                                background: 'var(--acc-fill2, rgba(212,175,55,0.12))',
                                color: 'var(--gold)',
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 800, textTransform: 'uppercase',
                                letterSpacing: '0.06em', whiteSpace: 'nowrap',
                                cursor: 'pointer'
                            }
                        },
                            headerDraftClock.label ? React.createElement('span', { style: { color: 'var(--silver)', opacity: 0.78 } }, headerDraftClock.label) : null,
                            React.createElement('strong', { style: { color: 'var(--white)', fontFamily: "'JetBrains Mono', monospace", fontSize: 'var(--text-label, 0.75rem)' } }, headerDraftClock.clock)
                        )}
                    </div>
                    )}
                </header>

                {/* Load stage progress indicator */}
                {loadStage && (
                    <div style={{
                        padding: '6px 16px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))',
                        borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))',
                        fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ width: '12px', height: '12px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }}></div>
                        {loadStage}
                    </div>
                )}

                {/* ── GLOBAL TIME CONTEXT BAR ── */}
                {/* Phone (one-row header, kit live): the sticky season bar is
                    hidden — season selection moves into the league header sheet
                    (Season row) so the top chrome stays one row. Kit-aware, not
                    media-queried: phoneHdrKit is only true <768 WITH WR.Sheet, so
                    desktop + iPad (≥768) and the no-kit phone fallback keep the
                    bar and its inline season selector. */}
                <div className="wr-time-bar" style={{
                    display: phoneHdrKit ? 'none' : 'flex', alignItems: 'center', gap: '8px', padding: '8px clamp(12px, 4vw, 24px)', flexWrap: 'wrap',
                    background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
                    position: 'sticky', top: 'var(--sat, 0px)', zIndex: 50
                }}>
                    {/* Year pills — grouped as a timeline: past · current · projected */}
                    <div className="wr-time-years" style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', minWidth: 0 }}>
                        {(() => {
                            const pastYears = timeYears.filter(y => y < currentSeason);
                            const currentAndFuture = timeYears.filter(y => y >= currentSeason);
                            return (
                                <React.Fragment>
                                    {pastYears.length > 0 && (
                                        <React.Fragment>
                                            <select value={isHistoricalYear ? timeYear : ''} onChange={e => { if (e.target.value) handleTimeYearChange(Number(e.target.value)); }} title="Past seasons" style={{
                                                padding: '4px 8px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                                fontWeight: isHistoricalYear ? 700 : 400,
                                                background: isHistoricalYear ? 'var(--gold)' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                                color: isHistoricalYear ? 'var(--black)' : 'var(--silver)',
                                                border: '1px solid ' + (isHistoricalYear ? 'var(--gold)' : 'var(--ov-4, rgba(255,255,255,0.06))'),
                                                opacity: isHistoricalYear ? 1 : 0.8,
                                                borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', outline: 'none'
                                            }}>
                                                <option value="" style={{ background: 'var(--black)', color: 'var(--white)' }}>Past seasons</option>
                                                {pastYears.map(yr => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}</option>)}
                                            </select>
                                            {currentAndFuture.length > 0 && <span aria-hidden="true" style={{ width: 1, height: 18, margin: '0 5px', background: 'var(--ov-5, rgba(255,255,255,0.12))', alignSelf: 'center' }} />}
                                        </React.Fragment>
                                    )}
                                    {currentAndFuture.map((yr, i) => {
                                        const kind = yr > currentSeason ? 'future' : 'current';
                                        const prev = currentAndFuture[i - 1];
                                        const prevKind = prev == null ? null : (prev > currentSeason ? 'future' : 'current');
                                        const selected = timeYear === yr;
                                        // Calm treatment (owner ask 2026-08-09): only the SELECTED year
                                        // gets a filled pill — every other year sat in its own colored
                                        // bordered pill even at rest, which is most of this row.
                                        let bg, color, border, weight = selected ? 700 : 400, opacity = 1;
                                        if (selected) { bg = 'var(--gold)'; color = 'var(--black)'; border = '1px solid var(--gold)'; }
                                        else if (kind === 'future') { bg = 'transparent'; color = 'var(--k-45b7d1, #45b7d1)'; border = '1px solid transparent'; }
                                        else { bg = 'transparent'; color = 'var(--silver)'; border = '1px solid transparent'; }
                                        return (
                                            <React.Fragment key={yr}>
                                                {prevKind && prevKind !== kind && (
                                                    <span aria-hidden="true" style={{ width: 1, height: 18, margin: '0 5px', background: 'var(--ov-5, rgba(255,255,255,0.12))', alignSelf: 'center' }} />
                                                )}
                                                <button onClick={() => handleTimeYearChange(yr)} title={kind === 'future' ? yr + ' — projected' : yr + ' — current season'} style={{
                                                    padding: '4px 10px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                                    fontWeight: weight, background: bg, color: color, border: border, opacity,
                                                    borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', transition: 'all 0.15s'
                                                }}>{yr}</button>
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })()}
                    </div>
                    {/* Compact year dropdown — replaces the pill strip at ≤1023px (CSS-toggled) */}
                    <select className="wr-time-years-select" value={timeYear} onChange={e => handleTimeYearChange(Number(e.target.value))} aria-label="Season year" style={{
                        display: 'none', padding: '5px 8px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                        fontWeight: 700, background: 'var(--gold)', color: 'var(--black)', border: '1px solid var(--gold)',
                        borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', minHeight: '32px'
                    }}>
                        {(() => {
                            const opt = (yr) => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}{yr === currentSeason ? ' • current' : ''}</option>;
                            const past = timeYears.filter(y => y < currentSeason);
                            const cur = timeYears.filter(y => y === currentSeason);
                            const future = timeYears.filter(y => y > currentSeason);
                            return [
                                past.length ? <optgroup key="p" label="Past seasons">{past.map(opt)}</optgroup> : null,
                                cur.length ? <optgroup key="c" label="Current">{cur.map(opt)}</optgroup> : null,
                                future.length ? <optgroup key="f" label="Projected">{future.map(opt)}</optgroup> : null,
                            ];
                        })()}
                    </select>
                    {/* League name/team-count moved to the main header to avoid duplication. */}
                    <div className="wr-time-spacer" style={{ marginLeft: 'auto' }}></div>
                    {/* Time mode badge — plain text on the (usual) current-season path;
                        the wr-time-banner below already carries the loud version of this
                        signal when viewing a historical/future season, so this pill was
                        just restating "current season" in a colored chip most of the time. */}
                    <span className="wr-time-mode" style={isCurrentYear ? {
                        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: 'var(--silver)',
                        padding: '2px 4px',
                        fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.04em'
                    } : {
                        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: timeModeColor,
                        background: wrAlpha(timeModeColor, '15'), border: '1px solid ' + wrAlpha(timeModeColor, '30'),
                        padding: '2px 10px', borderRadius: 'var(--card-radius-lg, 14px)',
                        fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em'
                    }}>{timeModeLabel}</span>
                    {/* Loading indicator */}
                    {timeLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }} />
                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)' }}>Recomputing...</span>
                    </div>}
                </div>

                {/* Time mode banner — visible when not viewing current season */}
                {!isCurrentYear && <div className="wr-time-banner" style={{
                    padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '8px',
                    background: wrAlpha(timeModeColor, '10'), borderBottom: '1px solid ' + wrAlpha(timeModeColor, '30')
                }}>
                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: timeModeColor, fontWeight: 700, fontFamily: 'var(--font-body)' }}>
                        {isFutureYear ? 'FUTURE PROJECTION' : 'HISTORICAL VIEW'}: {timeYear}
                    </span>
                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>
                        {isFutureYear ? 'Player ages projected +' + timeDelta + 'yr. Values and stats are estimates.' : 'Showing ' + timeYear + ' season stats. Roster composition reflects current state.'}
                    </span>
                    <button onClick={() => handleTimeYearChange(currentSeason)} style={{ marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', padding: '3px 10px', background: 'transparent', border: '1px solid ' + timeModeColor, color: timeModeColor, borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Back to {currentSeason}</button>
                </div>}

                {/* Debug panel (dev only) */}
                {DEV_DEBUG && <div className="wr-debug-strip" style={{ padding: '4px 24px', background: 'rgba(255,0,0,0.04)', borderBottom: '1px solid rgba(255,0,0,0.1)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'monospace', color: 'var(--k-f0a500, #f0a500)' }}>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '2px' }}>
                        <span>year={timeYear}</span>
                        <span>mode={timeMode}</span>
                        <span>tab={activeTab}</span>
                        <span>delta={timeDelta}</span>
                        <span>recompute={new Date(timeRecomputeTs).toLocaleTimeString()}</span>
                        <span>stats={Object.keys(statsData).length}</span>
                        <span>projected={window.App?.LI?._projectedYear || 'none'}</span>
                    </div>
                    {isFutureYear && window.App?.LI?.playerScores && (() => {
                        const scores = window.App.LI.playerScores;
                        const backup = window.App.LI._baseScoresBackup || {};
                        const samples = Object.entries(scores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 4);
                        return <div style={{ display: 'flex', gap: '12px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--k-3498db, #3498db)' }}>
                            {samples.map(([pid, projDhq]) => {
                                const baseDhq = backup[pid] || projDhq;
                                const p = playersData[pid];
                                const diff = projDhq - baseDhq;
                                return <span key={pid}>{p?.full_name?.split(' ').pop() || pid}: {baseDhq}→{projDhq} ({diff >= 0 ? '+' : ''}{diff})</span>;
                            })}
                        </div>;
                    })()}
                </div>}

                <header className="wr-workspace-header">
                    <div className="wr-mobile-workspace">
                        <h1>{workspaceRoute.label}</h1>
                        {workspace.id !== 'help' && <button type="button" className="wr-mobile-help" onClick={() => { setHelpContext({ tab: viewTab, label: workspaceRoute.label }); setActiveTab('legend'); }} aria-label={'Help with ' + workspaceRoute.label}>Help</button>}
                    </div>
                    <div className="wr-workspace-heading">
                        <div><h1>{workspace.label}</h1>{workspace.description && <p>{workspace.description}</p>}</div>
                        <div className="wr-workspace-shortcuts">
                            {workspace.id === 'home' && workspaceOptions.showGameDay && <button type="button" onClick={() => setActiveTab('lineup')}>Open Game Day</button>}
                            {workspace.id !== 'help' && <button type="button" onClick={() => setActiveTab('legend')} aria-label={'Help with ' + workspace.label}>Help</button>}
                        </div>
                    </div>
                    {workspaceViews.length > 1 && <nav className="wr-workspace-views" aria-label={workspace.label + ' views'}>
                        {workspaceViews.map(view => <button type="button" key={view.tab} aria-current={viewTab === view.tab ? 'page' : undefined} onClick={() => setActiveTab(view.tab)}>{view.label}</button>)}
                    </nav>}
                </header>
                {/* Phones open The Wire from the command menu. */}
                {!['dashboard', 'lenses'].includes(viewTab) && (!alexPhone || viewTab === 'wire') && <div className="wr-league-wire-entry">{typeof window.WrLeagueWire === 'function' && (
                    <window.WrLeagueWire
                        sidebarWidth={sidebarWidth}
                        onOpenAllWire={onOpenAllWire}
                        forceOpen={viewTab === 'wire'}
                        currentLeague={currentLeague}
                        standings={standings}
                        transactions={transactions}
                        playersData={playersData}
                        getOwnerName={getOwnerName}
                        getPlayerName={getPlayerName}
                    />
                )}</div>}

                {/* Existing deep links render in their owning workspace. */}
                <div className="wr-content-frame">
                {!loading && !['analytics', 'league'].includes(activeTab) && viewTab !== activeTab && <p role="status" style={{ color: 'var(--silver)', padding: '0 12px' }}>That view is unavailable for this league. Showing {workspaceRoute.label}.</p>}
                {viewTab === 'trades' ? (
                    <TradeCalcTabLazy
                        playersData={playersData}
                        statsData={statsData}
                        myRoster={myRoster}
                        standings={standings}
                        currentLeague={currentLeague}
                        leagueSkin={leagueSkin}
                        sleeperUserId={sleeperUserId}
                        timeRecomputeTs={timeRecomputeTs}
                        viewMode={viewMode}
                        initialSubTab={tradeSubTab}
                        onSubTabConsumed={() => setTradeSubTab(null)}
                    />
                ) : viewTab === 'myteam' ? <MyTeamTabLazy
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    statsSeason={timeYear}
                    stats2025Data={stats2025Data}
                    standings={standings}
                    sleeperUserId={sleeperUserId}
                    rosterFilter={rosterFilter}
                    setRosterFilter={setRosterFilter}
                    rosterSort={rosterSort}
                    setRosterSort={setRosterSort}
                    visibleCols={visibleCols}
                    setVisibleCols={setVisibleCols}
                    expandedPid={expandedPid}
                    setExpandedPid={setExpandedPid}
                    showColPicker={showColPicker}
                    setShowColPicker={setShowColPicker}
                    colPreset={colPreset}
                    setColPreset={setColPreset}
                    gmStrategy={gmStrategy}
                    setGmStrategy={setGmStrategy}
                    gmStrategyOpen={gmStrategyOpen}
                    setGmStrategyOpen={setGmStrategyOpen}
                    setAlexAvatar={setAlexAvatar}
                    setAvatarKey={setAvatarKey}
                    setActiveTab={setActiveTab}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : viewTab === 'lineup' ? <LineupTabLazy
                    initialView={gameDayEntry?.scope === gameDayScope ? gameDayEntry.view : 'week'}
                    matchupTarget={gameDayEntry?.scope === gameDayScope ? gameDayEntry.matchup : null}
                    getOwnerName={getOwnerName}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    statsSeason={timeYear}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    gmStrategy={gmStrategy}
                    setActiveTab={setActiveTab}
                    timeRecomputeTs={timeRecomputeTs}
                /> : viewTab === 'league-team' ? <LeagueMapTabLazy
                    leagueViewTab={leagueViewTab}
                    setLeagueViewTab={setLeagueViewTab}
                    leagueSelectedTeam={leagueSelectedTeam}
                    setLeagueSelectedTeam={team => { setLeagueSelectedTeam(team); if (!team) setActiveTab('central'); }}
                    leagueSort={leagueSort}
                    setLeagueSort={setLeagueSort}
                    leagueSubView={leagueSubView}
                    setLeagueSubView={setLeagueSubView}
                    leagueViewMode={leagueViewMode}
                    setLeagueViewMode={setLeagueViewMode}
                    lpSort={lpSort}
                    setLpSort={setLpSort}
                    lpFilter={lpFilter}
                    setLpFilter={setLpFilter}
                    standings={standings}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    myRoster={myRoster}
                    activeYear={activeYear}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                    setActiveTab={setActiveTab}
                /> : workspaceRoute.analysis ? <AnalyticsPanelLazy
                    workspaceView={workspaceRoute.analysis}
                    analyticsData={analyticsData}
                    analyticsTab={analyticsTab}
                    setAnalyticsTab={setAnalyticsTab}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    standings={standings}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    activeYear={activeYear}
                    setActiveTab={setActiveTab}
                    viewingOwnerId={viewingOwnerId}
                    setViewingOwnerId={setViewingOwnerId}
                    timeDelta={timeDelta}
                    timeYear={timeYear}
                    setTradeSubTab={setTradeSubTab}
                    getOwnerName={getOwnerName}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : (viewTab === 'fa' || viewTab === 'targets') ? <FreeAgencyTabLazy
                    initialView={viewTab === 'targets' ? 'targets' : null}
                    playersData={playersData}
                    statsData={statsData}
                    prevStatsData={stats2025Data}
                    statsSeason={timeYear}
                    priorStatsSeason={STATS_YEAR}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewMode}
                    briefDraftInfo={briefDraftInfo}
                /> : (viewTab === 'draft' || viewTab === 'mock-draft') ? <DraftTabLazy
                    key={viewTab}
                    playersData={playersData}
                    statsData={statsData}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewTab === 'mock-draft' ? 'mock' : viewMode}
                /> : viewTab === 'calendar' ? <CalendarTabLazy currentLeague={currentLeague} leagueSkin={leagueSkin} myRoster={myRoster} /> : viewTab === 'trophies' ? <TrophyRoomTabLazy
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    myRoster={myRoster}
                    sleeperUserId={sleeperUserId}
                /> : viewTab === 'settings' ? (
                    typeof window.SettingsModule === 'function'
                        ? React.createElement(window.SettingsModule, settingsProps)
                        : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)' }}>Settings module not loaded.</div>
                ) : viewTab === 'legend' ? (
                    React.createElement(LegendPanel, { module: true })
                ) : (workspaceRoute.alex || viewTab === 'alex') ? React.createElement(AlexInsightsTabLazy, {
                    currentLeague, leagueSkin, myRoster, playersData, statsData,
                    stats2025Data, standings, sleeperUserId,
                    timeRecomputeTs, setActiveTab,
                    gmStrategy, setGmStrategy,
                    // Old tab=strategy URLs land on the Strategy sub-view inside GM's Office.
                    initialSubTab: workspaceRoute.alex,
                    workspaceView: workspaceRoute.alex,
                }) : viewTab === 'compare' ? React.createElement(CompareTabLazy, {
                    key: String(currentLeague?.league_id || currentLeague?.id) + ':' + currentLeague?.season,
                    currentLeague, leagueSkin, myRoster, playersData, statsData, stats2025Data,
                    priorStatsSeason: STATS_YEAR, standings, sleeperUserId,
                }) : viewTab === 'stats' ? React.createElement(LeagueStatsTabLazy, {
                    key: String(currentLeague?.league_id || currentLeague?.id) + ':' + currentLeague?.season,
                    currentLeague, myRoster, playersData, getOwnerName, getPlayerName, setActiveTab,
                }) : viewTab === 'central' ? React.createElement(LeagueCentralTabLazy, {
                    currentLeague, leagueSkin, myRoster, playersData, standings, transactions,
                    sleeperUserId, getOwnerName, getPlayerName, timeAgo, setActiveTab,
                    homeMerged: false, onOpenTeam: openLeagueTeam,
                }) : viewTab === 'wire' ? <section className="mc-wire-destination"><h2>The Wire</h2><p>Your league’s stories, records, rivalries and weekly editions.</p><button type="button" className="gd-primary" onClick={() => window.dispatchEvent(new CustomEvent('wr:wire-open'))}>Open The Wire</button></section> : viewTab === 'lenses' ? dashboardEl(selectedWidgets) : showLeagueOverview ? <div className="mc-overview"><LeagueCentralTabLazy currentLeague={currentLeague} leagueSkin={leagueSkin} myRoster={myRoster} playersData={playersData} standings={standings} transactions={transactions} sleeperUserId={sleeperUserId} getOwnerName={getOwnerName} getPlayerName={getPlayerName} timeAgo={timeAgo} setActiveTab={setActiveTab} onOpenTeam={openLeagueTeam} overview={true} /></div> : dashboardEl(overviewWidgets, true)}
                </div>
                </div>{/* end marginLeft wrapper */}

            {selectedPlayerPid && typeof window.openFWPlayerModal !== 'function' && <PlayerInlineCard
                pid={selectedPlayerPid}
                playersData={playersData}
                statsData={statsData}
                onClose={() => setSelectedPlayerPid(null)}
                onFullProfile={() => {
                  try {
                    if (typeof window.openFWPlayerModal === 'function') {
                      const sc = currentLeague?.scoring_settings || {};
                      window.openFWPlayerModal(selectedPlayerPid, playersData, statsData, sc);
                    } else {
                      console.warn('[War Room] openFWPlayerModal not loaded');
                    }
                  } catch(e) { console.error('[War Room] Player modal error:', e); }
                }}
            />}

            {/* Four saved destinations; all routes remain in the header menu. */}
            {typeof window.WrMissionAlex === 'function' && <window.WrMissionAlex key={String(sleeperUserId) + ':' + (currentLeague?.league_id || currentLeague?.id)} currentLeague={currentLeague} myRoster={myRoster} playersData={playersData} statsData={statsData} sleeperUserId={sleeperUserId} activeTab={viewTab} />}
            <PhoneDock
                activeTab={viewTab}
                navItems={navItems}
                workspaceOptions={workspaceOptions}
                onOpenLeagueOptions={() => setPhHdrSheetOpen(true)}
                onSelectTab={(tab) => { setSidebarOpen(false); setActiveTab(tab); }}
            />

            </div>
          </window.App.SeasonContext.Provider>
        );
    }
    window.LeagueDetail = LeagueDetail;
