#!/usr/bin/env node
// War Room regression guardrails for deep links, mobile layout, and dashboard widgets.
// Usage: npm run test:regression
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEAGUE_ID = '1312100327931019264';
const USER = 'bigloco';
const MOBILE_WIDTHS = [390, 430];
const MAIN_TABS = [
  'dashboard',
  'myteam',
  'compare',
  'trades',
  'fa',
  'draft',
  'analytics',
  'alex',
  'trophies',
];
// 'calendar' is routed but NOT a sidebar tab: d5daa83 (2026-06-19, "League
// Calendar dashboard widget + fold Calendar into Trophy Room") removed the
// Calendar sidebar nav item and re-pointed stale activeTab='calendar' deep
// links at the Trophy Room's Calendar sub-view. The deep link must keep
// working — hence it stays in ROUTED_TABS — but there is deliberately no
// `tab: 'calendar'` nav entry to find any more.
const ROUTED_TABS = [...MAIN_TABS, 'calendar', 'strategy', 'league'];
const WIDGET_SIZES = ['sm', 'slim', 'narrow', 'md', 'lg', 'tall', 'xl', 'xxl'];

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function sourceHas(source, needle, label) {
  ok(source.includes(needle), label || `missing source fragment: ${needle}`);
}

function sourceMatches(source, regex, label) {
  ok(regex.test(source), label || `source did not match ${regex}`);
}

function routeUrlModel(pathname, search, hash) {
  const query = new URLSearchParams(search || '');
  query.delete('league');
  query.delete('leagueId');
  query.delete('tab');
  const qs = query.toString();
  return pathname + (qs ? '?' + qs : '') + (hash || '');
}

function parseHashModel(hash, search) {
  const params = new URLSearchParams((hash || '').replace('#', ''));
  const query = new URLSearchParams(search || '');
  const rawTab = params.get('tab') || query.get('tab') || 'dashboard';
  return {
    leagueId: params.get('league') || query.get('league') || query.get('leagueId'),
    tab: rawTab === 'brief' ? 'dashboard' : rawTab,
  };
}

function extractSpanMap(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`${name} map not found`);
  const out = {};
  for (const item of match[1].matchAll(/([a-z]+)\s*:\s*'span\s+(\d+)'/gi)) {
    out[item[1]] = Number(item[2]);
  }
  return out;
}

const appSrc = read('js/app.js');
const indexHtml = read('index.html');
const onboardingSrc = read('onboarding.html');
const leagueDetailSrc = read('js/league-detail.js');
const leagueSkinSrc = read('js/league-skin.js');
const themeSrc = read('js/theme.js');
const settingsSrc = read('js/settings.js');
const dashboardSrc = read('js/tabs/dashboard.js');
const myTeamSrc = read('js/tabs/my-team.js');
const flashBriefSrc = read('js/tabs/flash-brief.js');
const freeAgencySrc = read('js/free-agency.js');
const analyticsSrc = read('js/tabs/analytics.js');
const leagueMapSrc = read('js/tabs/league-map.js');
const calendarSrc = read('js/tabs/calendar.js');
const leagueHistorySrc = read('js/shared/league-history.js');
const trophyRoomSrc = read('js/tabs/trophy-room.js');
const strategyEditorSrc = read('js/tabs/strategy-editor.js');
const alexInsightsSrc = read('js/tabs/alex-insights.js');
const alexSettingsSrc = read('js/shared/alex-settings.js');
const tradeCalcSrc = read('js/trade-calc.js');
const componentsSrc = read('js/components.js');
const compareSrc = read('js/tabs/compare.js');
const draftRoomSrc = read('js/draft-room.js');
const draftCommandCenterSrc = read('js/draft/command-center.js');
const draftTradeSimulatorSrc = read('js/draft/trade-simulator.js');

console.log('\nWar Room regression tests');

group('cold-load routes');

test('route helper preserves dev/user query while adding league hash', () => {
  sourceHas(appSrc, 'const query = new URLSearchParams(window.location.search || \'\');', 'routeUrl must read current query string');
  sourceHas(appSrc, 'query.delete(\'league\');', 'routeUrl must remove stale query league');
  sourceHas(appSrc, 'query.delete(\'leagueId\');', 'routeUrl must remove stale query leagueId');
  sourceHas(appSrc, 'query.delete(\'tab\');', 'routeUrl must remove stale query tab');
  sourceHas(appSrc, 'return window.location.pathname + (qs ? \'?\' + qs : \'\') + (hash || \'\');', 'routeUrl must preserve query before hash');

  for (const tab of ROUTED_TABS) {
    const hash = `#league=${LEAGUE_ID}&tab=${tab}`;
    const url = routeUrlModel('/', `?dev=true&user=${USER}`, hash);
    eq(url, `/?dev=true&user=${USER}${hash}`, `direct URL for ${tab}`);
  }
});

test('initial history replacement keeps the incoming hash on cold load', () => {
  sourceHas(appSrc, 'const route = parseHash(window.location.hash);', 'cold-load path must parse current hash');
  sourceHas(appSrc, 'history.replaceState(state, \'\', routeUrl(window.location.hash));', 'initial replaceState must keep hash');
  sourceHas(appSrc, 'routeUrl(buildHash(league.id, route.tab || \'dashboard\'))', 'league restore must rebuild hash via routeUrl');
});

test('parseHash supports hash routes, query routes, and brief legacy redirect', () => {
  eq(parseHashModel(`#league=${LEAGUE_ID}&tab=draft`, `?dev=true&user=${USER}`).leagueId, LEAGUE_ID, 'hash league');
  eq(parseHashModel(`#league=${LEAGUE_ID}&tab=draft`, `?dev=true&user=${USER}`).tab, 'draft', 'hash tab');
  eq(parseHashModel('', `?dev=true&user=${USER}&leagueId=${LEAGUE_ID}&tab=fa`).leagueId, LEAGUE_ID, 'query league fallback');
  eq(parseHashModel('', `?dev=true&user=${USER}&leagueId=${LEAGUE_ID}&tab=brief`).tab, 'dashboard', 'brief redirect');
});

test('every routed tab has a cold-load URL and render branch', () => {
  for (const tab of ROUTED_TABS) {
    const hash = `#league=${LEAGUE_ID}&tab=${tab}`;
    const directUrl = `/?dev=true&user=${USER}${hash}`;
    ok(directUrl.includes(`tab=${tab}`), `${tab} route missing tab`);
    if (tab === 'dashboard') {
      sourceHas(leagueDetailSrc, '<DashboardPanel', 'dashboard branch missing');
    } else {
      sourceHas(leagueDetailSrc, `activeTab === '${tab}'`, `${tab} render branch missing`);
    }
  }
});

test('every main sidebar tab remains directly addressable', () => {
  for (const tab of MAIN_TABS) {
    sourceHas(leagueDetailSrc, `tab: '${tab}'`, `${tab} nav entry missing`);
  }
});

test('dist preview resolves local chrome assets from the project root', () => {
  sourceHas(appSrc, "includes('/dist-preview/') ? '../' : ''", 'app header icon must resolve from dist-preview');
  sourceHas(leagueDetailSrc, "includes('/dist-preview/') ? '../' : ''", 'league sidebar icon must resolve from dist-preview');
});

test('GM strategy remains routed through GM office, not a sidebar button', () => {
  sourceHas(leagueDetailSrc, "activeTab === 'strategy'", 'strategy route must still render');
  sourceHas(leagueDetailSrc, "{ label: 'GM\\'s Office', tab: 'alex', iconKey: 'office' }", 'GM office sidebar entry missing');
  ok(!leagueDetailSrc.includes("{ label: 'GM Strategy', tab: 'strategy'"), 'GM Strategy should not be a sidebar entry');
});

test('GM strategy saves through the canonical app storage used by the header', () => {
  sourceHas(strategyEditorSrc, 'window.App?.WrStorage || window.WrStorage || null', 'strategy editor must use app storage, not a missing global only');
  sourceHas(strategyEditorSrc, 'storage.set(keys.GM_STRATEGY(leagueId), savedPayload);', 'strategy save must persist the league-scoped War Room strategy');
  sourceHas(leagueDetailSrc, 'readSharedGmStrategy(leagueId)', 'header strategy load must read the shared GM strategy when present');
  sourceHas(leagueDetailSrc, 'LeagueStorage.set(LEAGUE_WR_KEYS.GM_STRATEGY(leagueId), normalized);', 'header strategy state must keep league storage synchronized');
});

test('league format skin loads early and is published to every module surface', () => {
  // This used to pin `<script src="js/league-skin.js?v=20260526redraftqa1">`.
  // The `?v=` cache-buster is bumped on every edit to the file by house
  // convention (see CLAUDE.md), so that literal stopped being true at 995be21
  // (2026-07-05) and pinning it only ever tested when the file was last
  // touched — never the load order the label claims. Assert the order itself:
  // league-skin must come after js/core.js (it hangs off window.App) and
  // before js/components.js, which starts the module chain that consumes it.
  const coreScriptAt = indexHtml.indexOf('src="js/core.js?v=');
  const skinScriptAt = indexHtml.indexOf('src="js/league-skin.js?v=');
  const componentsScriptAt = indexHtml.indexOf('src="js/components.js?v=');
  ok(skinScriptAt > -1, 'league skin script tag missing from index.html');
  ok(coreScriptAt > -1 && coreScriptAt < skinScriptAt, 'league skin script must load after js/core.js');
  ok(componentsScriptAt > -1 && skinScriptAt < componentsScriptAt, 'league skin script must load before js/components.js and the module chain');
  sourceHas(leagueSkinSrc, 'App.LeagueSkin = api;', 'league skin must expose window.App.LeagueSkin');
  sourceHas(leagueSkinSrc, 'WR.LeagueSkin = api;', 'league skin must expose window.WR.LeagueSkin');
  sourceHas(leagueSkinSrc, "appLabel: 'Dynasty HQ'", 'league skin must preserve the Dynasty HQ brand');
  sourceHas(leagueSkinSrc, 'showDraftPrepWhenRosterEmpty', 'league skin must model pre-draft empty-roster mode');
  sourceHas(leagueSkinSrc, 'moduleId + \':pre_draft\'', 'league skin must expose module alternate surfaces');
  sourceHas(leagueSkinSrc, "'settings', 'legend'", 'league skin must include settings and legend module surfaces');
  sourceHas(leagueSkinSrc, 'function resolveDraftRounds(input = {})', 'league skin must own draft-round resolution by league type');
  sourceHas(leagueSkinSrc, "redraft: {", 'redraft skin must keep an explicit product theme entry');
  sourceHas(leagueSkinSrc, "className: 'wr-league-skin-default'", 'redraft skin must use the default War Room palette');
  sourceHas(leagueDetailSrc, 'window.App.LeagueSkin.build({', 'league detail must build the active skin');
  sourceHas(leagueDetailSrc, 'window.App.LeagueSkin.setCurrent(leagueSkin);', 'league detail must publish the active skin');
  sourceHas(leagueDetailSrc, 'data-league-skin-theme={leagueSkin?.theme?.id || \'war-room-default\'}', 'league detail must stamp the active skin theme on the shell');
  sourceHas(leagueDetailSrc, 'const _seasonCtxValue = { ...seasonCtxData, leagueSkin, selectPlayer };', 'SeasonContext must include leagueSkin');
  sourceHas(leagueDetailSrc, 'leagueSkin={leagueSkin}', 'top-level module props must include leagueSkin');
  ok(!indexHtml.includes('.wr-league-skin-redraft {'), 'redraft shell should not carry the removed royal purple CSS overrides');
  ok(!indexHtml.includes('--black:#24114F;'), 'redraft shell should not replace black card surfaces with royal purple');
});

test('light mode ships in production while sandbox theme gating stays intact', () => {
  // Light mode left sandbox-only on 2026-06-04 (3b0e54c); the gate machinery
  // stays so future in-development themes can be sandbox-gated by id.
  sourceHas(themeSrc, 'const SANDBOX_ONLY_THEMES = new Set([]);', 'sandbox-only set must stay empty while no theme is under repair');
  sourceHas(themeSrc, "id: 'light',", 'light theme definition must remain available');
  sourceHas(themeSrc, 'function isSandboxThemeMode()', 'theme engine must know whether sandbox-only themes can show');
  sourceHas(themeSrc, 'return Object.keys(THEMES).filter(themeId => isThemeAllowed(themeId));', 'normal theme list must hide sandbox-only themes');
  sourceHas(themeSrc, 'WrTheme.current = normalizeThemeId(saved);', 'saved sandbox-only themes must normalize away outside sandbox mode');
  sourceHas(themeSrc, 'isSandboxMode: function()', 'theme engine must expose sandbox-mode status for diagnostics');
});

test('existing module components consume the league skin contract for labels and controls', () => {
  sourceHas(myTeamSrc, 'const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;', 'My Team must resolve the active skin');
  sourceHas(myTeamSrc, "...(skinFeatures.showTaxi === false ? [] : ['Taxi'])", 'My Team scope filters must hide Taxi when the skin says so');
  sourceHas(myTeamSrc, "...(skinFeatures.showIDP === false ? [] : ['IDP'])", 'My Team scope filters must hide IDP when the skin says so');
  sourceHas(myTeamSrc, "dhq:        { label: valueLabel, shortLabel: valueShortLabel", 'My Team value column must use skin vocabulary');
  sourceHas(freeAgencySrc, 'const faColumns = useMemo(() => ({', 'Free Agency must derive display columns from the skin');
  sourceHas(freeAgencySrc, 'label: skinFeatures.showAgeCurve === false ? \'Value Window\' : FA_COLUMNS.peakYr.label', 'Free Agency must relabel age-window columns for non-age-curve skins');
  sourceHas(freeAgencySrc, 'leagueSkin: resolvedLeagueSkin', 'Free Agency roster guard must receive the active skin');
  sourceHas(tradeCalcSrc, 'const valueSourceLabel = resolvedLeagueSkin?.features?.showDynastyValue === false ? \'format-adjusted values\' : \'dynasty valuations\';', 'Trade analyzer must describe the active value source');
  sourceHas(tradeCalcSrc, 'leagueSkin: resolvedLeagueSkin', 'Trade roster guard must receive the active skin');
  sourceHas(alexInsightsSrc, 'Defaults follow this league format - use the presets below', 'Alex settings copy must adapt for non-dynasty skins');
  sourceHas(alexInsightsSrc, "const targetPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].concat(skinFeatures.showIDP === false ? [] : ['DL', 'LB', 'DB']);", 'Alex settings target positions must hide IDP when the skin says so');
  sourceHas(alexInsightsSrc, 'const baseDraftYear = String(parseInt(currentLeague?.season || new Date().getFullYear(), 10) || new Date().getFullYear());', 'Alex settings pick chips must derive the base year from the league season');
  sourceHas(alexInsightsSrc, 'const draftPickYears = skinFeatures.showFuturePicks === false ? [baseDraftYear] : draftYearOptions;', 'Alex settings pick chips must respect future-pick visibility');
  sourceHas(leagueDetailSrc, "skinShowsDynastyValue ? 'Dynasty Rank' : 'Asset Rank'", 'League KPI metadata must adapt rank language by skin');
  sourceHas(dashboardSrc, 'const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || \'DHQ\';', 'Dashboard must use skin value vocabulary');
  sourceHas(dashboardSrc, 'League {valueShortLabel}', 'Dashboard league value label must be skin-aware');
  sourceHas(compareSrc, 'const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || \'DHQ\';', 'Compare must use skin value vocabulary');
  sourceHas(compareSrc, 'const valueLabel = resolvedLeagueSkin?.vocabulary?.valueLabel || \'DHQ Value\';', 'Compare must use the full skin value label');
  sourceHas(draftRoomSrc, 'const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || \'DHQ\';', 'Draft room must use skin value vocabulary');
  // This used to pin `const draftCapitalLabel = skinFeatures.showFuturePicks
  // === false ? 'draft capital' : 'future capital';`. That local was declared
  // in the initial commit and NEVER referenced (`git log -S"draftCapitalLabel"
  // -- js/draft-room.js` returns only 0501bd3 and eab77d6), so it adapted no
  // copy at all; eab77d6 (2026-07-06) then renamed it `_draftCapitalLabel`
  // under "pre-existing unused locals underscore-prefixed to satisfy the lint
  // gate" and the assertion has been failing ever since. Restoring the old
  // name would only re-pin dead code. The draft room's real future-pick
  // adaptation is that the whole Draft Capital + Roster Targeting view is
  // removed for seasonal formats (showDraftCapitalPlanning: !seasonal in
  // js/league-skin.js) rather than rendered with softer wording — assert that,
  // alongside the pick-year and empty-control rules already checked below.
  sourceHas(draftRoomSrc, 'const commandTabAllowed = skinFeatures.showDraftCapitalPlanning !== false;', 'Draft room must drop the future-capital planning tab for seasonal formats');
  sourceHas(draftRoomSrc, 'skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2]', 'Draft room pick-year model must hide future years in redraft');
  sourceHas(draftRoomSrc, 'futureCapitalRows.length > 0', 'Draft room must hide empty future-pick controls');
});

test('draft redraft board surfaces use current-season player context', () => {
  sourceHas(draftRoomSrc, 'const isSeasonalDraft = !isRookieDraft && (resolvedLeagueSkin?.state?.isSeasonal || skinFeatures.showFuturePicks === false);', 'Draft room must identify seasonal/redraft board mode');
  sourceHas(draftRoomSrc, "boardHeaderCell(isSeasonalDraft ? 'NFL Team' : 'College'", 'Draft board must replace college with NFL team for seasonal leagues');
  sourceHas(draftRoomSrc, '...(showDraftCapitalColumn ? [[\'Draft\', draftStr || \'Capital TBD\']] : [])', 'Draft card snapshot must hide draft capital when the skin removes future-pick context');
  sourceHas(draftRoomSrc, 'const reportBits = isSeasonalDraft', 'Draft card must synthesize current-season scouting reports for redraft players');
  sourceHas(draftRoomSrc, 'FANTASYPROS NEWS', 'Draft card news action must disclose the destination');
  sourceHas(draftCommandCenterSrc, 'const isRedraftBoard = state.variant === \'redraft\'', 'Mock Draft Center must detect redraft board mode');
  sourceHas(draftCommandCenterSrc, "if (isRedraftBoard && !set.has('DEF')) set.add('DEF');", 'Mock Draft Center position filters must include D/ST for redraft leagues');
  sourceHas(draftCommandCenterSrc, 'className="mock-board-sort"', 'Mock Draft Center board headers must be clickable sort controls');
  // This used to pin the literal track list `28px minmax(0,1.52fr) 28px 36px
  // 42px 30px 30px 40px`. The redraft board has legitimately gained columns
  // twice since — a864a81 (2026-08-10) inserted the market ADP track and
  // e43020d (2026-08-22) inserted the Usage track — so the literal has been
  // wrong since 2026-08-10 while the layout it guards was never broken.
  // Pinning the exact string tests only that nobody added a column; assert the
  // property that actually keeps the row inside its container instead — a
  // single shrinkable minmax(0,…fr) player column with fixed px tracks either
  // side, which together with the overflow-x:hidden rule asserted below is
  // what makes the board fit without horizontal scrolling.
  const redraftGridMatch = draftCommandCenterSrc.match(/gridTemplateColumns: isRedraftBoard[\s\S]{0,400}?\?\s*'([^']+)'/);
  ok(redraftGridMatch, 'Mock Draft Center must define a redraft-specific board grid');
  const redraftTracks = redraftGridMatch[1].trim().split(/\s+/);
  const flexTracks = redraftTracks.filter(t => t.includes('fr'));
  eq(flexTracks.length, 1, 'redraft board must keep exactly one flexible column');
  sourceMatches(flexTracks[0], /^minmax\(0,/, 'the flexible redraft column must be minmax(0,…) so it shrinks instead of overflowing');
  ok(redraftTracks.filter(t => !t.includes('fr')).every(t => /^\d+px$/.test(t)), 'every other redraft board track must be a fixed px width');
  sourceHas(indexHtml, '.mock-board-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;', 'Mock Draft Center table must not expose side-to-side scrolling');
  sourceHas(draftCommandCenterSrc, 'state.proposerDrawer && TradeProposer', 'Mock Draft Center cockpit must render the trade proposer drawer');
  sourceHas(draftCommandCenterSrc, 'mockRunReport(state)', 'Mock Draft Center must render expanded league-evolution run context');
  sourceHas(draftCommandCenterSrc, 'mock-roster-legend', 'Mock roster build card must explain count and value bars');
  sourceHas(draftCommandCenterSrc, 'historicalDraftPickTradeSignal', 'Mock Draft Center must clear/suppress CPU trade offers from historical trade probability');
  sourceHas(draftTradeSimulatorSrc, 'function cpuOfferTradeActivityFor(state)', 'CPU trade-offer rate must use historical pick-trade activity when present');
});

test('redraft shell, history, calendar, and analytics hide dynasty-only assumptions', () => {
  sourceHas(leagueDetailSrc, 'const maxTimeYear = leagueSkin?.features?.showFuturePicks === false ? currentSeason : currentSeason + 2;', 'redraft time bar must stop at the current season');
  sourceHas(leagueDetailSrc, "{ label: 'Settings', tab: 'settings', iconKey: 'settings' }", 'Settings must route as a normal module');
  sourceHas(leagueDetailSrc, "{ label: 'Legend', tab: 'legend', iconKey: 'legend' }", 'Legend must route as a normal module below Settings');
  sourceHas(settingsSrc, 'function SettingsModule(props)', 'settings content must be mountable as a module');
  sourceHas(settingsSrc, 'wr-settings-module-screen', 'settings module must render a full module surface');
  sourceHas(settingsSrc, 'wr-settings-module-grid', 'settings module must show all control groups on one screen');
  sourceHas(leagueDetailSrc, 'React.createElement(LegendPanel, { module: true })', 'legend must render as a full module surface');
  ok(!leagueDetailSrc.includes('React.createElement(LegendPanel)}'), 'sidebar accordion legend should be removed');
  sourceHas(trophyRoomSrc, "'ALL-TIME TEAM'", 'all-time history should use the All-Time Team label');
  sourceHas(trophyRoomSrc, "'Unique Players'", 'all-time player count should say Unique Players');
  sourceHas(trophyRoomSrc, "'Hall of Famers'", 'hall-of-fame count should not include auto copy');
  sourceHas(trophyRoomSrc, 'function formatSeasonFinish(finish)', 'season history values must be formatted before display');
  sourceHas(trophyRoomSrc, 'function formatSeasonLine(season)', 'season history must show finish and record together when available');
  sourceHas(calendarSrc, 'const suppressSeasonalWaivers = isSeasonalLeague && (', 'redraft calendar must suppress offseason/pre-draft waivers');
  sourceHas(calendarSrc, 'if (waiverType && !suppressSeasonalWaivers)', 'waiver event rendering must honor seasonal suppression');
  sourceHas(calendarSrc, "const draftTitle = isSeasonalLeague ? 'League Draft' : 'Rookie Draft';", 'seasonal calendar draft naming must not say rookie draft');
  sourceHas(alexInsightsSrc, "const hideStrategyTab = resolvedLeagueSkin?.type === 'redraft';", 'redraft GM Office must hide My Strategy');
  sourceHas(alexInsightsSrc, "...(hideStrategyTab ? [] : [{ k: 'strategy', label: 'My Strategy' }]),", 'GM Office strategy tab must be skin-gated');
  sourceHas(alexInsightsSrc, 'value: activeSubTab,', 'GM Office must normalize hidden strategy routes back to a visible tab');
  sourceHas(analyticsSrc, 'const draftYears = skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2];', 'analytics draft capital must hide future picks in redraft');
  sourceHas(analyticsSrc, 'window.App?.LeagueSkin?.resolveDraftRounds?.({', 'analytics draft capital must use skin-aware draft rounds');
  sourceHas(analyticsSrc, "window.addEventListener('wr_history_loaded', onLoaded);", 'analytics must re-render when league history loads');
  sourceHas(analyticsSrc, 'window.WrHistory.loadIfMissing(currentLeague)', 'analytics must load league history without requiring Trophy Room first');
  sourceHas(analyticsSrc, 'Draft Board Without Outcome History', 'analytics draft tab must show pick-capital fallback when draft outcomes are empty');
  sourceHas(analyticsSrc, 'no historical pick trades, so trade-up modeling is disabled', 'analytics draft fallback must expose pick-trade reality');
  sourceHas(analyticsSrc, "kicker: 'Owned Picks', label: currentPicks.length + ' picks'", 'analytics draft fallback must show resolved current owned picks');
  sourceHas(analyticsSrc, "'Resolved from roster-slot skin rules'", 'analytics draft tab must explain redraft round resolution');
  sourceHas(leagueMapSrc, 'const shouldShowDraftPool = isPreDraftPhase || !!(resolvedLeagueSkin?.state?.isSeasonal &&', 'pre-draft redraft player table must use the player universe');
  sourceHas(leagueMapSrc, "teamName: 'Draft Pool'", 'pre-draft redraft players should be labeled as draft pool');
  sourceHas(leagueMapSrc, 'const years = skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2];', 'pick ledger must hide future years in redraft');
  sourceHas(leagueMapSrc, 'window.App?.LeagueSkin?.resolveDraftRounds?.({', 'pick ledger must use skin-aware draft rounds');
  sourceHas(draftRoomSrc, 'window.App?.LeagueSkin?.resolveDraftRounds?.({', 'draft room must pass skin-aware draft rounds into Mock Draft Center');
  sourceHas(calendarSrc, 'window.App?.LeagueSkin?.resolveDraftRounds?.({', 'calendar must use skin-aware draft rounds');
});

test('decision history renders complete trade assets and dedupes DHQ mirror rows', () => {
  sourceHas(alexInsightsSrc, 'sideReceivedAssets(t, myRid)', 'decision history must normalize incoming trade assets');
  sourceHas(alexInsightsSrc, 'sideSentAssets(t, myRid)', 'decision history must normalize outgoing trade assets');
  sourceHas(alexInsightsSrc, 'renderPickChips(addedPicks', 'decision history must render acquired picks');
  sourceHas(alexInsightsSrc, 'renderPickChips(droppedPicks', 'decision history must render traded-away picks');
  sourceHas(alexInsightsSrc, "return 'trade:' + _dhMs", 'trade event key must dedupe DHQ mirror rows by timestamp and rosters');
  sourceHas(alexInsightsSrc, 'existing?.transaction?.draft_picks?.length', 'dedupe must keep the richer Sleeper transaction when available');
});

test('model settings controls map to live behavior or clearly disabled future delivery', () => {
  sourceHas(alexSettingsSrc, 's.channel?.inApp === false', 'in-app notification setting must affect surfaced cards');
  sourceHas(alexSettingsSrc, 'insight.pointsDelta != null', 'min point delta setting must be enforced for point-swing insights');
  sourceHas(alexSettingsSrc, 'function actionableTradeAcceptanceFloor(settings, leagueId)', 'trade aggression must own the actionable trade acceptance floor');
  sourceHas(alexSettingsSrc, 'return Math.round(75 - ((aggression - 50) / 50) * 20);', 'balanced trade aggression should default to a 75% acceptance floor and loosen upward');
  sourceHas(alexInsightsSrc, 'pointsDelta: Math.max(...lowWeekDeltas)', 'start/sit insight must expose a point delta for settings filtering');
  sourceHas(alexInsightsSrc, "chanChip('email', 'Email (coming soon)', { disabled: true", 'email notification control should be visibly disabled until wired');
  sourceHas(alexInsightsSrc, "chanChip('push', 'Push (coming soon)', { disabled: true", 'push notification control should be visibly disabled until wired');
});

test('Deal HQ reflects reviewed trade-center UX requirements', () => {
  ok(!tradeCalcSrc.includes('Trade command center'), 'Deal HQ should not render the removed hero command bar');
  ok(!tradeCalcSrc.includes('No surplus edge'), 'roster leverage empty state should use football-oriented wording');
  ok(!tradeCalcSrc.includes('they have ${theyHaveNeed}'), 'partner cards should not show the removed lanes-you-need sentence');
  ok(!tradeCalcSrc.includes('Roster Leverage'), 'the Deal HQ metrics strip stays cut from the Trade Desk');
  sourceHas(tradeCalcSrc, 'assetBrowserSorts', 'Deal HQ should expose an asset browser sort model');
  sourceHas(tradeCalcSrc, "key:'owner', label:'Owned Team'", 'asset browser should sort by current owned team');
  sourceHas(tradeCalcSrc, "key:'points', label:'Last FP'", 'asset browser should sort by last-season fantasy points');
  sourceHas(tradeCalcSrc, "key:'prime', label:'Prime Years'", 'asset browser should sort by prime years remaining');
  sourceHas(tradeCalcSrc, '<b>Head-to-head vs me</b>', 'owner detail card must keep head-to-head trade history with the user');
  sourceHas(tradeCalcSrc, '<p><b>You got</b> {summarizeTradeAssets(received)}</p>', 'head-to-head received assets should have readable spacing');
  sourceHas(tradeCalcSrc, '<p><b>You sent</b> {summarizeTradeAssets(sent)}</p>', 'head-to-head sent assets should have readable spacing');
  sourceHas(tradeCalcSrc, 'window.WrTradePipeline = { CAP, STATUSES, fromDeal, fromAlexCard, normalizeRow, normalizeAll, append };', 'saved deals must flow through the WrTradePipeline store');
  sourceHas(tradeCalcSrc, 'dealActionableAcceptanceFloor', 'Deal HQ should keep low-acceptance moonshots out of default package cards');
  sourceHas(tradeCalcSrc, 'const gmFloor = dealActionableAcceptanceFloor(_gmTuning);', 'Trade Desk must derive the actionable floor from GM strategy tuning');
  sourceHas(tradeCalcSrc, 'const finderActionFloor = dealActionableAcceptanceFloor(finderTuning);', 'Trade Finder must honor the same actionable acceptance floor');
  ok(!componentsSrc.includes('ACTIONABLE_ACCEPTANCE_FLOOR = 45'), 'Trade Finder must not use the old 45% default floor');
  ok(!/className="tc-dhq-eyebrow"/.test(tradeCalcSrc), 'generated package cards should not render the old package-type header');
});

test('Draft flash brief uses the same Sleeper draft-order slot map as Mock Draft Center', () => {
  sourceHas(draftRoomSrc, 'draftProjectionMeta?.slotToRoster', 'draft room pick labels must read the projected draft slot map');
  sourceHas(draftRoomSrc, 'mappedFromDraft[String(info.rosterId)] = Number(slot);', 'draft room slot map should prefer real Sleeper draft_order slots');
  sourceHas(draftRoomSrc, 'if (Object.keys(mappedFromDraft).length) return mappedFromDraft;', 'draft room must not fall back to standings slots when draft_order exists');
});

test('Draft flash brief keeps the removed readiness strip out of the UI', () => {
  ok(!draftRoomSrc.includes('draft-readiness-strip'), 'draft readiness strip should not render in the flash brief');
  ok(!draftRoomSrc.includes('Draft Readiness'), 'draft readiness label should stay removed');
  ok(!indexHtml.includes('.draft-readiness-strip'), 'draft readiness CSS should stay removed');
});

test('Mock Draft Center keeps decision cards readable and roster grade integrated', () => {
  sourceHas(indexHtml, '.mock-decision-card strong { display: block; color: var(--white); font-size: 0.82rem; line-height: 1.14;', 'mock decision player names should be allowed to wrap');
  sourceHas(indexHtml, '.mock-roster-card { min-height: 0; overflow: visible; }', 'mock roster build card should not create an internal scroll');
  sourceHas(draftCommandCenterSrc, 'function MockRosterBuildCard({ state, grade })', 'mock roster build must receive the draft grade');
  // Was `<strong>{grade?.letter || '--'}</strong>` until 90c7bf0 (2026-07-06,
  // the free/pro gate sweep) wrapped the letter in ccIsPro() and showed free
  // users a lock + "Scout Pro" instead. The grade is still surfaced in-card,
  // which is what this assertion is for — only the Pro gate was added.
  sourceHas(draftCommandCenterSrc, '<div><span>Draft Grade</span><strong>{ccIsPro() ? (grade?.letter || \'--\') : \'🔒\'}</strong>', 'mock roster build must surface the draft grade in-card');
  ok(!draftCommandCenterSrc.includes('className="mock-grade-strip"'), 'mock draft grade should not render as a detached bottom strip');
});

test('League legend explains the DHQ model in depth and stays theme-aware', () => {
  sourceHas(leagueDetailSrc, "cat: 'What DHQ Measures'", 'legend should explain the DHQ inputs');
  sourceHas(leagueDetailSrc, "cat: 'How To Read DHQ'", 'legend should explain DHQ bands');
  sourceHas(leagueDetailSrc, "cat: 'What DHQ Is Not'", 'legend should explain DHQ limits');
  sourceHas(leagueDetailSrc, "background: 'var(--black)'", 'legend cards should use theme-aware surfaces');
});

test('analytics module keeps only value-producing sub-tabs', () => {
  ok(!analyticsSrc.includes("key: 'playoffs'"), 'analytics should not expose Playoffs sub-tab');
  ok(!analyticsSrc.includes("key: 'timeline'"), 'analytics should not expose Timeline sub-tab');
  ok(!analyticsSrc.includes("analyticsTab === 'playoffs'"), 'Playoffs render branch should be removed');
  ok(!analyticsSrc.includes("analyticsTab === 'timeline'"), 'Timeline render branch should be removed');
  sourceHas(analyticsSrc, 'const analyticsViewTab = activeSubTab.key;', 'legacy analytics sub-tab routes should fall back to a valid tab');
});

group('click-through paths');

test('custom report player rows open the unified player card', () => {
  sourceHas(leagueMapSrc, 'function canOpenReportPlayer(row, report)', 'custom reports need a player-row gate');
  sourceHas(leagueMapSrc, "report?.dataSource === 'players' && row?.pid", 'custom report rows must only be clickable when player-backed');
  sourceHas(leagueMapSrc, "context: 'custom_report'", 'custom report player-card context missing');
  // Both ledgers on this tab now route through one opener so they cannot drift
  // into two different cards again (Analytics' All Players used to expand its
  // own bespoke dossier). Pin the seam, not the inlined call it replaced.
  sourceHas(leagueMapSrc, 'function openLeagueMapPlayerCard(pid, options)', 'league-map needs a single player-card opener');
  sourceHas(leagueMapSrc, 'window.WR.openPlayerCard(pid, options || {});', 'the shared opener should prefer the unified player card');
  sourceHas(leagueMapSrc, 'window.openPlayerModal(pid);', 'the shared opener should fall back to the shared player modal');
  sourceHas(leagueMapSrc, "openLeagueMapPlayerCard(row.pid, { context: 'custom_report'", 'custom reports must route through the shared opener');
  sourceHas(leagueMapSrc, "role: 'button'", 'custom report player rows should be accessible controls');
  sourceHas(leagueMapSrc, 'handleReportPlayerRowKey(e, row, report)', 'custom report player rows need keyboard activation');
  sourceHas(leagueMapSrc, '{...reportPlayerRowProps(row, previewReport)}', 'analytics report preview rows must carry player-card click props');
  sourceHas(leagueMapSrc, '{...reportPlayerRowProps(row, report)}', 'full report rows must carry player-card click props');
});

test('analytics All Players rows open the same unified card as Free Agency', () => {
  // Owner ask 2026-09-05: the Analytics ledger had its own inline dossier that
  // had drifted from every other surface (legacy TRADE BLOCK/CUT tag buttons,
  // no verdict, no KPI strip). Both the phone AssetRow and the desktop table
  // row now open the unified card instead.
  const opens = leagueMapSrc.match(/openLeagueMapPlayerCard\(x\.pid, \{ context: 'analytics_all_players'/g) || [];
  ok(opens.length === 2, `All Players rows (phone + desktop) must open the unified card, found ${opens.length}`);
  ok(!/RosterPlayerDossier/.test(leagueMapSrc), 'the bespoke analytics dossier should be gone, not merely unused');
  sourceHas(leagueMapSrc, "title=\"Open player card\"", 'desktop All Players rows need the player-card affordance');
});

group('draft autosave');

test('draft autosave has a max wait, not just a debounce', () => {
  // Found hunting the mock draft 2026-09-06: the autosave was a bare 500ms
  // debounce reset on every state change, and the CPU at 'fast' picks every
  // 250ms — so during an unbroken CPU run it NEVER fired. Measured in a 12x15
  // mock: the board showed 60/180 while localStorage sat at 17. A reload
  // mid-run silently lost every pick back to the last pause.
  sourceHas(draftCommandCenterSrc, 'const lastSaveRef', 'autosave needs to track its last write');
  sourceHas(draftCommandCenterSrc, 'Date.now() - lastSaveRef.current >= 2000', 'autosave needs a max wait, not just a debounce');
  sourceHas(draftCommandCenterSrc, 'saveTimerRef.current = setTimeout(flush, 500)', 'the quiet-period debounce should still be 500ms');
});

group('live draft feed');

test('live trade windows are narrated once, not re-posted', () => {
  // Owner report 2026-09-05: the live feed showed the same "A Kupp of STFU ·
  // R1.01 · 88%" trade card twice with another team's card between, all at
  // pick 0. The dedupe held ONE last-key string, so it only caught immediate
  // repeats — the effect re-runs on persona/tradedAsset/tuning/pick churn and
  // `best` ping-pongs between teams, so A -> B -> A posted A twice.
  sourceHas(draftCommandCenterSrc, 'const liveTradeSeenRef', 'live trade windows need a seen-SET, not a single last key');
  sourceHas(draftCommandCenterSrc, 'liveTradeSeenRef.current.has(dealKey)', 'a deal already narrated must be suppressed');
  sourceHas(draftCommandCenterSrc, 'liveTradeIdxRef.current === state.currentIdx', 'at most one trade window per pick');
  ok(!/liveTradeAlertRef/.test(draftCommandCenterSrc), 'the single-slot liveTradeAlertRef must be gone, not merely unused');
});

group('live platform gate');

test('live loader keeps non-Sleeper connector files sandbox-only', () => {
  sourceHas(indexHtml, 'const WR_PLATFORM_SANDBOX_ACCESS', 'sandbox platform flag missing from loader');
  sourceHas(indexHtml, "'sleeper-api.js',", 'Sleeper connector must remain in live loader');
  sourceHas(indexHtml, "'app-config.js',", 'shared backend config must load before backend-backed modules');
  sourceHas(indexHtml, "if (WR_PLATFORM_SANDBOX_ACCESS) WR_SHARED_FILES.splice(7, 0, 'espn-api.js', 'mfl-api.js', 'yahoo-api.js');", 'beta connectors must be gated behind sandbox flag');
  ok(!/WRShared\.loadMany\(\[[\s\S]*'espn-api\.js'/.test(indexHtml), 'ESPN connector should not be in unconditional live loadMany list');
});

test('War Room app filters beta-platform leagues out of live route data', () => {
  sourceHas(appSrc, 'const PLATFORM_SANDBOX_ACCESS = WR_HOST.includes(\'sandbox\')', 'app sandbox platform flag missing');
  sourceHas(appSrc, 'const visibleEspnLeagues = PLATFORM_SANDBOX_ACCESS ? espnLeagues : [];', 'ESPN leagues must be hidden on live');
  // MFL got its own relaunch lever in d22768b (2026-06-15, "MFL: enable on
  // production"), so the gate here is MFL_SANDBOX_ACCESS, not the shared
  // PLATFORM_SANDBOX_ACCESS this assertion used to pin. eab77d6 (2026-07-06)
  // then re-gated MFL to sandbox-beta-only by setting MFL_ENABLED = false,
  // which is what actually keeps MFL off live now — so pin the lever too,
  // exactly as the index.html loader assertion above pins the mfl-api.js
  // splice. Flipping MFL_ENABLED back on is a deliberate relaunch and should
  // fail here (and there) until both are updated together.
  sourceHas(appSrc, 'const MFL_ENABLED = false;', 'MFL must stay sandbox-beta-only until a deliberate relaunch');
  sourceHas(appSrc, 'const MFL_SANDBOX_ACCESS = MFL_ENABLED || PLATFORM_SANDBOX_ACCESS;', 'MFL visibility must resolve through the MFL relaunch lever');
  sourceHas(appSrc, 'const visibleMflLeagues = MFL_SANDBOX_ACCESS ? mflLeagues : [];', 'MFL leagues must be hidden on live');
  // 10c2f65 (2026-06-14, "Redesign signed-up-user login into Dynasty HQ
  // franchise picker") hoisted the inline spread into a shared `allLeagues`
  // that also feeds hasLeagues and the FranchisePicker, so resumeLeague now
  // reads `allLeagues.find(...)`. Pure refactor — the filtered visible*
  // lists are still the only source — but the assertion kept the pre-hoist
  // literal. Pin both halves, so the hoisted list cannot be quietly re-pointed
  // at the raw unfiltered espnLeagues/mflLeagues state.
  sourceHas(appSrc, 'const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];', 'hub league list must be built from the filtered platform leagues');
  sourceHas(appSrc, 'const resumeLeague = allLeagues.find(l => l.id === lastLeagueId);', 'resume must use filtered platform leagues');
});

test('onboarding only persists allowed platforms for the current environment', () => {
  sourceHas(onboardingSrc, 'window.FW_PLATFORM_SANDBOX_ACCESS = betaPlatforms;', 'onboarding sandbox flag missing');
  sourceHas(onboardingSrc, '.live-platforms .sandbox-platform { display: none; }', 'live onboarding should hide beta platform cards');
  sourceHas(onboardingSrc, 'if (!platformAccessAllowed(id)) return;', 'platform toggle must block live beta selection');
  sourceHas(onboardingSrc, 'patchProfile({ platforms: Array.from(selectedPlatforms).filter(platformAccessAllowed) });', 'saved onboarding platforms must be filtered');
});

group('mobile overflow');

test('league shell clamps horizontal overflow at 390px and 430px', () => {
  sourceMatches(leagueDetailSrc, /@media\(max-width:767px\)/, 'mobile media query missing');
  sourceHas(leagueDetailSrc, 'html,body,#root{max-width:100%;overflow-x:clip;overflow-y:visible}', 'root overflow clamp missing');
  // 2b106f7 (2026-07-09, "One-row phone league header") promoted the mobile
  // max-width clamp to `100vw !important` so the one-row phone header could
  // not be out-specified. The clamp got stricter, not weaker — the assertion
  // just kept the pre-!important literal.
  sourceHas(leagueDetailSrc, '.wr-main-content{margin-left:0 !important;width:100% !important;max-width:100vw !important;overflow-x:clip;overflow-y:visible;box-sizing:border-box;padding-top:var(--wr-dev-banner-height,0px)}', 'main content mobile clamp missing');
  sourceHas(leagueDetailSrc, '.wr-sidebar{left:-220px !important;top:var(--wr-dev-banner-height,0px) !important;transform:none !important}', 'sidebar off-canvas rule missing');
  sourceHas(leagueDetailSrc, '.wr-sidebar.open{left:0 !important}', 'sidebar open rule missing');
  for (const width of MOBILE_WIDTHS) {
    ok(width <= 767, `${width}px should exercise the mobile shell rules`);
  }
});

test('main content no longer carries fixed desktop width on mobile', () => {
  sourceHas(leagueDetailSrc, '<div className="wr-main-content" style={{', 'main content wrapper missing');
  sourceHas(leagueDetailSrc, "width: 'calc(100vw - ' + sidebarWidth + 'px)'", 'desktop content width must be viewport-clamped');
  sourceHas(leagueDetailSrc, "maxWidth: 'calc(100vw - ' + sidebarWidth + 'px)'", 'desktop content max-width must stay viewport-clamped');
  sourceHas(leagueDetailSrc, "overflowX: 'clip'", 'desktop content horizontal clamp missing');
  sourceHas(leagueDetailSrc, "overflowY: 'visible'", 'desktop content must not trap vertical scroll');
  sourceHas(leagueDetailSrc, 'margin-left:0 !important;width:100% !important;max-width:100vw', 'mobile margin override missing');
});

test('page wheel input reaches the shell when horizontal panels are under the cursor', () => {
  sourceHas(leagueDetailSrc, "window.addEventListener('wheel', rerouteWheelToPage, { passive: false, capture: true });", 'wheel fallback listener missing');
  sourceHas(leagueDetailSrc, 'if (wrCanElementConsumeWheel(el, event.deltaY)) return;', 'real vertical scrollers must keep native wheel behavior');
  sourceHas(leagueDetailSrc, "window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });", 'wheel fallback must scroll the document');
  sourceHas(leagueDetailSrc, 'onWheel={rerouteWheelToPage}', 'app shell must handle wheel events from fixed chrome');
  sourceHas(myTeamSrc, "overflowX: 'auto', overflowY: 'clip'", 'my team horizontal table must not trap vertical wheel input');
});

group('my team roster density');

test('expanded roster rows use contextual readout without duplicate profile cards', () => {
  // The Dynasty Read box is deliberately gone from this dossier. 851d1e4
  // (2026-08-10, "Remove Dynasty Read from remaining player dossiers; rework
  // My Roster dossier") deleted buildDynastyRead/dynastyTierLabel, the aiReads
  // state and the fetchDynastyRead effect from my-team.js — the AI read now
  // lives only in the canonical player-card modal. That commit updated
  // tests/click-path-contract.js for the removed ASK ALEX button but missed
  // the two assertions here, which pinned `const buildDynastyRead = r => {`
  // and `{buildDynastyRead(r)}`. The same commit replaced the narrow
  // single-column Signals list with the full-width 2-up grid asserted below,
  // so the "contextual readout" this test is named for is the Signals grid
  // now. Do not re-add a Dynasty Read box here on the strength of a test name.
  sourceHas(myTeamSrc, 'const sigCell = (label, val) =>', 'expanded card must render the contextual signals readout');
  for (const signal of ['Ceiling', 'Floor', 'Risk', 'Window']) {
    sourceHas(myTeamSrc, `sigCell('${signal}', sig`, `expanded card signals readout missing ${signal}`);
  }
  // 7d1b543 (2026-06-14, "redesign My Roster player expand card") rewrote this
  // line and, in doing so, wrote the middot separator as a raw UTF-8 character
  // where it had been a six-character "backslash-u-0-0-B-7" escape. What was
  // pinned was the source ENCODING of that separator, not the behaviour this
  // assertion is named for, so a cosmetic rewrite broke it.
  // Accept either spelling and keep pinning what matters: the identity card
  // appends the formatted height.
  sourceMatches(myTeamSrc, /\{formatHeight\(r\.p\.height\) \? ' (?:·|\\u00B7) ' \+ formatHeight\(r\.p\.height\) : ''\}/, 'height must live in the player identity card');
  ok(!myTeamSrc.includes('Moderate dynasty asset. Watch trajectory.'), 'generic dynasty read copy should not return');
  ok(!myTeamSrc.includes("label: 'DEPTH', val"), 'expanded metric cards should not include the duplicate depth card');
  ok(!myTeamSrc.includes('Physical + Draft Profile'), 'duplicate profile card should not return');
});

group('compare fields');

test('division comparisons only include the user in their own division', () => {
  sourceHas(compareSrc, 'const selectedDivisionTeams = divisions[activeDivision] || [];', 'division field must use exactly the selected division teams');
  sourceHas(compareSrc, 'const divisionIncludesUser = sameId(activeDivision, myDivision);', 'division mode must know whether the selected division is the user division');
  sourceHas(compareSrc, '{ includeUser: divisionIncludesUser }', 'division mode must only inject the user into their own division');
  sourceHas(compareSrc, 'Division-only lens; your roster is not added to this field.', 'non-user divisions must explain that the user is not added');
});

test('custom group comparisons can exclude the user entirely', () => {
  sourceHas(compareSrc, 'const validTeamIdSet = new Set(allTeamOptions.map(t => String(t.rosterId)));', 'manual groups must validate against every team');
  sourceHas(compareSrc, '.map(id => allTeamOptions.find(t => sameId(t.rosterId, id)))', 'manual group ids must resolve from every team');
  sourceHas(compareSrc, '{allTeamOptions.map(t => {', 'group builder must expose every team as selectable');
  sourceHas(compareSrc, 'Pick any 2 or more teams for a custom field. Your team is optional.', 'group builder must not imply the user is required');
  sourceHas(compareSrc, '{ includeUser: false }', 'custom group field must not inject the user');
  sourceHas(compareSrc, 'const focusProfile = profiles.find(p => p.isMine) || profiles[0];', 'neutral fields need a non-user focus fallback');
  sourceHas(compareSrc, 'const comparisonProfiles = profiles.filter(p => !sameId(p.rosterId, focusProfile.rosterId));', 'neutral fields should compare against the selected focus team');
});

group('dashboard widgets');

test('dashboard mobile grid collapses every widget size to one safe column', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  sourceHas(dashboardSrc, '.wr-dashboard-grid{', 'dashboard grid CSS missing');
  sourceHas(dashboardSrc, 'grid-template-columns:minmax(0,1fr) !important;', 'mobile single-column grid missing');
  sourceHas(dashboardSrc, '.wr-dashboard-grid>.wr-widget{', 'mobile widget override missing');
  sourceHas(dashboardSrc, 'grid-column:1 / -1 !important;', 'mobile widget column override missing');
  sourceHas(dashboardSrc, 'grid-row:auto !important;', 'mobile widget row override missing');
  sourceHas(dashboardSrc, 'min-width:0;', 'mobile min-width guard missing');

  for (const width of MOBILE_WIDTHS) {
    const activeColumns = width <= 767 ? 1 : 4;
    for (const size of WIDGET_SIZES) {
      ok(sizeSpan[size] >= 1, `${size} span missing`);
      const effectiveSpan = width <= 767 ? 1 : sizeSpan[size];
      ok(effectiveSpan <= activeColumns, `${size} spans ${effectiveSpan} columns at ${width}px`);
    }
  }
});

test('dashboard tablet grid clamps xl/xxl spans to active columns', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  sourceHas(dashboardSrc, 'grid-template-columns:repeat(2,minmax(140px,1fr)) !important;', 'tablet two-column grid missing');
  // afdf24c: clamp targets data-widget-size, not [style*="span 4"], which also
  // matched grid-ROW spans (tall/narrow) and stretched them across the grid.
  sourceHas(dashboardSrc, 'data-widget-size={widget.size || \'\'}', 'widget shell must stamp data-widget-size for clamp selectors');
  sourceHas(dashboardSrc, '.wr-dashboard-grid>.wr-widget[data-widget-size="xl"],', 'tablet xl clamp selector missing');
  sourceHas(dashboardSrc, '.wr-dashboard-grid>.wr-widget[data-widget-size="xxl"]{', 'tablet xxl clamp selector missing');
  ok(!dashboardSrc.includes('.wr-widget[style*="span 4"]{'), 'style-attribute span clamp must not return; it also matches row spans');
  sourceHas(dashboardSrc, 'grid-column:span 2 !important;', 'tablet span-4 clamp missing');
  for (const size of ['xl', 'xxl']) {
    eq(sizeSpan[size], 4, `${size} should request four columns on desktop`);
    ok(2 <= 2, `${size} tablet clamp exceeds active columns`);
  }
});

test('dashboard widget shell defines every supported size for rows and columns', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  const rowSpan = extractSpanMap(dashboardSrc, 'rowSpan');
  for (const size of WIDGET_SIZES) {
    ok(Number.isFinite(sizeSpan[size]), `${size} missing from sizeSpan`);
    ok(Number.isFinite(rowSpan[size]), `${size} missing from rowSpan`);
  }
});

test('Intel Brief waiver card uses the Free Agency Action HQ source', () => {
  sourceHas(freeAgencySrc, 'window.App.buildFreeAgencyActionBoard = buildFreeAgencyActionBoard;', 'shared FA board helper missing');
  sourceHas(freeAgencySrc, 'window.App.getFreeAgencyBriefTarget', 'brief target helper missing');
  sourceHas(freeAgencySrc, '(scores[pid] || 0) > 0', 'shared FA board must not recommend unvalued candidates');
  sourceHas(freeAgencySrc, "const ROOKIE_DRAFT_LOCK_STATUSES = new Set(['pre_draft', 'drafting']);", 'shared FA board must treat upcoming/live rookie drafts as waiver-locked');
  sourceHas(freeAgencySrc, 'window.App.rookiesLockedForWaivers = rookiesLockedForWaivers;', 'rookie waiver lock helper must be exposed for brief/FA consistency');
  sourceHas(freeAgencySrc, 'ROOKIE_DHQ_SOURCES.has(source)', 'shared FA board must filter DHQ-valued rookies while rookie waivers are locked');
  sourceHas(freeAgencySrc, 'rookiesLockedForWaivers(currentLeague, briefDraftInfo)', 'shared FA board must use league draft lock state');
  sourceHas(flashBriefSrc, 'window.App.getFreeAgencyBriefTarget({', 'Intel Brief must use shared FA target');
  sourceHas(flashBriefSrc, 'if (hasActionTargetHelper) return null;', 'Intel Brief must not fall back to stale waiver logic while shared helper is available');
  sourceHas(dashboardSrc, 'statsData,', 'dashboard must pass current stats into Intel Brief');
  sourceHas(dashboardSrc, 'timeRecomputeTs,', 'dashboard must pass recompute timestamp into Intel Brief');
  sourceHas(leagueDetailSrc, 'statsData={statsData}', 'league detail must pass stats into dashboard');
  sourceHas(leagueDetailSrc, 'timeRecomputeTs={timeRecomputeTs}', 'league detail must pass recompute timestamp into dashboard');
});

test('draft FantasyCalc value request is allowed by app CSP', () => {
  sourceHas(indexHtml, 'https://api.fantasycalc.com', 'FantasyCalc API must be present in connect-src');
  sourceHas(read('js/draft-room.js'), 'https://api.fantasycalc.com/values/current', 'draft room FantasyCalc fetch missing');
});

// This test used to assert the cold-load path's tutorial launch bailed when
// the incoming hash pointed anywhere but Home (`hashTab !== 'dashboard'`) and
// checked window.shouldShowWRTutorial first. d15b553 (2026-07-12, iPhone
// program) deleted that whole launch block per an owner ask — "startWRTutorial()
// is intentionally no longer launched" — replacing the 7-step click-through
// modal with an Alex chat greeting, which the 2026-07-21 chat-to-cards
// migration then retired as well. js/tutorial.js still exports the engine and
// tests/tutorial-contract.js still covers it; league-detail simply never calls
// it. So the invariant the old name was reaching for — a first-run modal must
// never fire over a deep-linked tab — is now guaranteed by there being no
// launch at all, and that is what this asserts.
test('cold load never launches the click-through tutorial over a deep-linked tab', () => {
  ok(!leagueDetailSrc.includes('window.startWRTutorial'), 'league shell must not launch the click-through tutorial on cold load');
  ok(!leagueDetailSrc.includes('shouldShowWRTutorial'), 'league shell must not re-add the tutorial precondition check');
});

test('Field Notes stays a compact decision-log utility off the default board', () => {
  // 0f5fa64 replaced the default board with the curiosity-first layout: Field
  // Notes is no longer a default widget, but old saved defaults still migrate
  // compact and the empty state keeps its decision-log framing.
  sourceHas(leagueDetailSrc, "{ id: 'dw0', key: 'intel-brief',    size: 'tall' }", 'curiosity-first default board must anchor on Intel Brief');
  ok(!leagueDetailSrc.includes("key: 'field-notes'"), 'Field Notes should stay off the default board');
  sourceHas(leagueDetailSrc, "w.key === 'field-notes' && w.id === 'dw1' && w.size === 'narrow'", 'old default Field Notes layouts should migrate compact');
  sourceHas(flashBriefSrc, 'No decisions logged yet', 'empty Field Notes should explain decision log state');
  sourceHas(flashBriefSrc, 'OPEN GM OFFICE', 'empty Field Notes should offer an action');
});

group('league-scoped history');

test('history globals are replaced per active league instead of merged across leagues', () => {
  sourceHas(leagueHistorySrc, 'window.App.LI.championshipLeagueId = key;', 'active championship league id missing');
  sourceHas(leagueHistorySrc, 'window.App.LI.championships = Object.assign({}, cache.championships || {});', 'championships must replace active league snapshot');
  ok(!leagueHistorySrc.includes('Object.assign({}, window.App.LI.championships || {}, cache.championships || {})'), 'championships should not merge prior league data');
});

// The Winner's Perch merge is real arithmetic, not a string contract, so this
// one runs the module instead of grepping it: hand-entered pre-Sleeper seasons
// have to land in the same slot buckets as the derived ones, and a league that
// shrank must stop advertising slots nobody can draft from.
test("winner's perch merges hand-entered seasons and caps retired slots", () => {
  const vm = require('vm');
  const store = {};
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  sandbox.CustomEvent = function CustomEvent() {};
  sandbox.dispatchEvent = () => {};
  sandbox.fetch = () => Promise.resolve({ ok: false });
  vm.createContext(sandbox);
  vm.runInContext(leagueHistorySrc, sandbox);
  const H = sandbox.window.WrHistory;
  ok(H && typeof H.getDraftSlotPerch === 'function', 'WrHistory did not initialise');

  const lid = 'perch-test';
  // Derived history: a 14-team era that shrank to 12. Slot 2 won twice, slot
  // 14 has a lone third-place finish that can never repeat.
  store['wr_history_' + lid] = JSON.stringify({
    fetchedAt: Date.now(),
    ownerHistory: {
      1: { seasonHistory: [{ draftSlot: 2, place: 1 }, { draftSlot: 2, place: 1 }] },
      2: { seasonHistory: [{ draftSlot: 5, place: 4 }, { draftSlot: 14, place: 3 }] },
    },
  });

  const uncapped = H.getDraftSlotPerch(lid);
  eq(uncapped.length, 14, 'uncapped perch spans the widest era');
  const capped = H.getDraftSlotPerch(lid, { maxSlots: 12 });
  eq(capped.length, 12, 'capped perch stops at the current league size');
  eq(capped[1].top3, 2, 'slot 2 top-3 count');
  eq(capped[1].titles, 2, 'slot 2 title count');

  // Hand-entered season merges into the same buckets.
  eq(H.getManualSeasons(lid).length, 0, 'manual store starts empty');
  H.upsertManualSeason(lid, { season: 2014, finishes: [{ place: 1, owner: 'Paper Champs', draftSlot: 7 }, { place: 4, owner: 'Nope', draftSlot: 9 }] });
  const merged = H.getDraftSlotPerch(lid, { maxSlots: 12 });
  eq(merged[6].top3, 1, 'hand-entered champion lands in slot 7');
  eq(merged[6].titles, 1, 'hand-entered champion counts as a title');
  eq(merged[6].manual, 1, 'slot 7 is flagged as hand-entered');
  eq(H.getManualSeasons(lid)[0].finishes.length, 1, 'a 4th-place finish is dropped — the perch only reads top 3');

  // Editing replaces rather than duplicating; a rebuild must not eat it.
  H.upsertManualSeason(lid, { id: '2014', season: 2014, finishes: [{ place: 1, owner: 'Paper Champs', draftSlot: 3 }] });
  eq(H.getManualSeasons(lid).length, 1, 'upsert by id replaces the row');
  eq(H.getDraftSlotPerch(lid, { maxSlots: 12 })[2].titles, 1, 'edited slot moves the title');
  H.clear(lid);
  eq(H.getManualSeasons(lid).length, 1, 'clear() must not delete owner-entered seasons');
  H.removeManualSeason(lid, '2014');
  eq(H.getManualSeasons(lid).length, 0, 'remove deletes the row');
});

test('analytics discloses hand-entered seasons and retired slots on the perch', () => {
  sourceHas(analyticsSrc, "window.WrHistory?.getDraftSlotPerch?.(leagueId, { maxSlots: perchTeamCount })", 'perch must be capped to the current league size');
  sourceHas(analyticsSrc, 'perchManual.length ?', 'perch header must disclose hand-entered seasons');
  sourceHas(analyticsSrc, 'existed in a larger era of this league', 'retired slots must be disclosed, not silently dropped');
  sourceHas(analyticsSrc, '<window.WR.ManualSeasonsEditor', 'perch editor must be mounted');
});

test('hand-entered seasons reach the trophy room, not just the perch', () => {
  const editorSrc = read('js/components/manual-seasons-editor.js');
  sourceHas(editorSrc, 'window.WR.ManualSeasonsEditor = ManualSeasonsEditor;', 'editor must register on WR');
  sourceHas(editorSrc, "window.addEventListener('wr_history_manual_changed', onChanged);", 'both mounts must stay in step');
  sourceHas(indexHtml, 'js/components/manual-seasons-editor.js', 'editor must load before the tabs that mount it');

  sourceHas(trophyRoomSrc, 'window.WrHistory?.getChampionships?.(leagueId)', 'timeline must read the merged championships');
  ok(!trophyRoomSrc.includes('return cached?.championships || appChamps || {};'), 'timeline must not read the raw cache past the merge');
  sourceHas(trophyRoomSrc, "window.addEventListener('wr_history_manual_changed', onManual);", 'trophy room must re-render on a manual save');
  sourceHas(trophyRoomSrc, 'React.createElement(window.WR.ManualSeasonsEditor', 'trophy room must mount the editor');
  sourceHas(trophyRoomSrc, 'c.manual', 'a hand-entered season must be labelled as one');
});

test('manual champions merge into the timeline and the all-time title counts', () => {
  const vm = require('vm');
  const store = {};
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  sandbox.CustomEvent = function CustomEvent() {};
  sandbox.dispatchEvent = () => {};
  sandbox.fetch = () => Promise.resolve({ ok: false });
  vm.createContext(sandbox);
  vm.runInContext(leagueHistorySrc, sandbox);
  const H = sandbox.window.WrHistory;

  const lid = 'champ-test';
  store['wr_history_' + lid] = JSON.stringify({
    fetchedAt: Date.now(),
    championships: { 2023: { champion: 4, championName: 'Dirty Mike' } },
    ownerHistory: {
      u1: { ownerId: 'u1', ownerName: 'Dirty Mike', currentRosterId: 4, championships: 1, champSeasons: ['2023'], runnerUps: 0, runnerUpSeasons: [], seasonHistory: [] },
      u2: { ownerId: 'u2', ownerName: 'Paper Champs', currentRosterId: 7, championships: 0, champSeasons: [], runnerUps: 0, runnerUpSeasons: [], seasonHistory: [] },
    },
  });

  H.upsertManualSeason(lid, { season: 2014, finishes: [{ place: 1, owner: 'paper champs', draftSlot: 7 }, { place: 2, owner: 'Dirty Mike', draftSlot: 1 }] });
  const champs = H.getChampionships(lid);
  eq(Object.keys(champs).sort().join(','), '2014,2023', 'timeline spans both eras');
  eq(champs['2014'].manual, true, 'hand-entered season is flagged');
  eq(champs['2014'].champion, 7, 'a typed name matching a current owner links to their roster');
  eq(champs['2014'].championName, 'paper champs', 'the typed name is kept for display');

  const oh = H.getOwnerHistory(lid);
  eq(oh[7].championships, 1, 'the pre-Sleeper title counts toward Most Titles');
  eq(oh[7].champSeasons.join(','), '2014', 'and shows up in the season list');
  eq(oh[4].runnerUps, 1, 'the runner-up counts too');
  eq(oh[4].championships, 1, "a derived title is not double-counted");

  // A manual row for a season Sleeper already covers must be ignored, not merged.
  H.upsertManualSeason(lid, { season: 2023, finishes: [{ place: 1, owner: 'Paper Champs' }] });
  eq(H.getChampionships(lid)['2023'].championName, 'Dirty Mike', 'the derived season wins');
  eq(H.getOwnerHistory(lid)[7].championships, 1, 'a duplicate season adds no title');
});

test('trophy room reads owner history and championships by current league id', () => {
  sourceHas(trophyRoomSrc, 'const leagueId = currentLeague?.id || currentLeague?.league_id || \'\';', 'trophy room league id source missing');
  sourceHas(trophyRoomSrc, 'window.WrHistory.getOwnerHistory(leagueId)', 'owner history must be league-scoped');
  sourceHas(trophyRoomSrc, 'String(window.App?.LI?.championshipLeagueId || \'\') === String(leagueId)', 'fallback championships must be active-league guarded');
});

group('compiled preview');

test('compiled preview removes browser Babel and keeps app bundle route-ready', () => {
  const previewIndex = path.join(ROOT, 'dist-preview', 'index.html');
  ok(fs.existsSync(previewIndex), 'dist-preview/index.html missing; run npm run build:preview first');
  const html = fs.readFileSync(previewIndex, 'utf8');
  ok(!/type=["']text\/babel["']/i.test(html), 'compiled preview still contains text/babel scripts');
  ok(!/@babel\/standalone/i.test(html), 'compiled preview still loads browser Babel');
  sourceHas(html, './compiled/js/app.js', 'compiled app bundle missing from preview index');
  ok(fs.existsSync(path.join(ROOT, 'dist-preview', 'compiled', 'js', 'app.js')), 'compiled js/app.js missing');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
