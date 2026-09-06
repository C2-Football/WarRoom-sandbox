// ══════════════════════════════════════════════════════════════════
// js/tabs/analytics.js — AnalyticsPanel: League analytics terminal
// with focused sub-tabs: Roster, Draft, Market Moves, Players, Picks, Reports
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

// Phase 8 deferred: small wrapper that holds the local state needed to mount
// LeagueMapTab in embed mode. Keeping it separate prevents AnalyticsPanel from
// re-initialising the sort/filter/search state on every render of other sub-tabs.
window.AnalyticsLeagueEmbed = function AnalyticsLeagueEmbed(props) {
    const { analyticsTab, standings, currentLeague, playersData, statsData, sleeperUserId,
        myRoster, leagueSkin, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName } = props;
    const [lpSort, setLpSort] = React.useState({ key: 'dhq', dir: -1 });
    const [lpFilter, setLpFilter] = React.useState('');
    const [lpSearch, setLpSearch] = React.useState('');
    const [leagueSelectedTeam, setLeagueSelectedTeam] = React.useState(null);
    const [leagueSort, setLeagueSort] = React.useState('health');
    const [leagueViewMode, setLeagueViewMode] = React.useState('cards');
    React.useEffect(() => {
        setLeagueSelectedTeam(null);
        setLeagueViewMode('cards');
    }, [analyticsTab]);
    if (typeof window.LeagueMapTab !== 'function') {
        return React.createElement('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--silver)' } }, 'League Map module not loaded.');
    }
    return React.createElement(window.LeagueMapTab, {
        embedSubView: analyticsTab,
        analyticsEmbedMode: true,
        leagueViewTab: 'analyst', setLeagueViewTab: () => {},
        leagueSelectedTeam, setLeagueSelectedTeam,
        leagueSort, setLeagueSort,
        leagueSubView: analyticsTab, setLeagueSubView: () => {},
        leagueViewMode, setLeagueViewMode,
        lpSort, setLpSort,
        lpFilter, setLpFilter,
        lpSearch, setLpSearch,
        standings, currentLeague, leagueSkin, playersData, statsData, sleeperUserId, myRoster,
        activeYear, timeRecomputeTs, setActiveTab,
        getAcquisitionInfo: getAcquisitionInfo || (() => ({ method: 'Unknown', date: '', cost: '' })),
        getOwnerName,
    });
};

// ── Round-by-round draft position mix (multi-season) ────────────────────────
// Walks the league's Sleeper previous_league_id chain — the same convention
// js/shared/league-history.js (window.WrHistory) and commissioner-office.js's
// rlChains already use to reach a league's prior seasons — and pulls real
// per-pick round+position data straight from Sleeper's draft-picks endpoint.
// pick.metadata.position already carries the drafted player's position, so
// no playersData cross-reference is needed. Cached in localStorage (6h TTL,
// mirrors WrHistory's cache) since a full walk is a handful of network calls.
const DRAFT_POSMIX_CACHE_TTL = 6 * 60 * 60 * 1000;
const DRAFT_POSMIX_CHAIN_MAX = 15;
function draftPosMixCacheKey(leagueId) { return 'wr_draft_posmix_' + (leagueId || 'default'); }
async function draftPosMixFetchJson(url) {
    try { const r = await fetch(url); return r.ok ? r.json() : null; } catch (e) { return null; }
}
async function draftPosMixWalkChain(startId) {
    const out = [];
    let lid = startId;
    const seen = new Set();
    while (lid && lid !== '0' && out.length < DRAFT_POSMIX_CHAIN_MAX && !seen.has(lid)) {
        seen.add(lid);
        const info = (typeof window.fetchLeagueInfo === 'function')
            ? await window.fetchLeagueInfo(lid).catch(() => null)
            : await draftPosMixFetchJson('https://api.sleeper.app/v1/league/' + lid);
        if (!info) break;
        out.push({ leagueId: lid, season: parseInt(info.season) || null });
        lid = info.previous_league_id;
    }
    return out;
}
// Aggregates every COMPLETED draft's picks, round by round, position by
// position, across the whole reachable chain. A season with no completed
// draft (mid pre-draft, or a chain hop that 404s) is simply skipped — the
// season count reported back is only seasons that actually contributed picks,
// so the UI never silently overstates its own coverage.
async function buildDraftPosMix(startLeagueId) {
    if (!startLeagueId) return null;
    const chain = await draftPosMixWalkChain(startLeagueId);
    if (!chain.length) return null;
    const roundCounts = {};   // { round: { POS: count } }
    const roundTotals = {};   // { round: totalPicksThatRound }
    const seasonsCounted = [];
    await Promise.all(chain.map(async ({ leagueId, season }) => {
        const drafts = await draftPosMixFetchJson('https://api.sleeper.app/v1/league/' + leagueId + '/drafts');
        const completed = (Array.isArray(drafts) ? drafts : []).filter(d => d && d.status === 'complete' && d.draft_id);
        if (!completed.length) return;
        let sawPick = false;
        await Promise.all(completed.map(async draft => {
            const picks = await draftPosMixFetchJson('https://api.sleeper.app/v1/draft/' + draft.draft_id + '/picks');
            (Array.isArray(picks) ? picks : []).forEach(p => {
                const rd = Number(p && p.round);
                if (!rd || rd < 1) return;
                const pos = (p.metadata && p.metadata.position) ? String(p.metadata.position).toUpperCase() : 'UNK';
                sawPick = true;
                if (!roundCounts[rd]) roundCounts[rd] = {};
                roundCounts[rd][pos] = (roundCounts[rd][pos] || 0) + 1;
                roundTotals[rd] = (roundTotals[rd] || 0) + 1;
            });
        }));
        if (sawPick && season) seasonsCounted.push(season);
    }));
    if (!seasonsCounted.length) return null;
    return {
        fetchedAt: Date.now(),
        leagueId: startLeagueId,
        roundCounts,
        roundTotals,
        seasons: seasonsCounted.sort((a, b) => b - a),
    };
}

function AnalyticsPanel({
  analyticsData,
  analyticsTab,
  setAnalyticsTab,
  myRoster,
  currentLeague,
  leagueSkin,
  standings,
  playersData,
  statsData,
  stats2025Data,
  sleeperUserId,
  timeRecomputeTs,
  setTimeRecomputeTs,
  activeYear,
  setActiveTab,
  viewingOwnerId,
  setViewingOwnerId,
  timeDelta,
  timeYear,
  setTradeSubTab,
  getOwnerName,
  // Phase 8: needed when embedding LeagueMapTab (All Players / Draft Picks / Custom Reports).
  getAcquisitionInfo,
}) {
    const _seasonCtx = React.useContext(window.App.SeasonContext) || {};
    // GM Strategy is the single source of truth for the displayed mode/strategy lens.
    // Live-updates on GM Strategy save; the tier assessment below is only a fallback.
    const gm = window.WR.GmMode.useGmEffects(currentLeague);
    // Scout-free vs Pro (gate-map row 9, Q3 Scout parity): raw standings/KPI
    // numbers + the assets Players & Picks tables stay free; position grades,
    // the Priority Evidence queue, mode directives/theses, hit-rate + market
    // reads, and the Custom Reports builder are Pro (ANALYTICS_DEPTH copy).
    // wrIsPro only — never canAccess/getTier (shadowing hazard).
    const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
    // Warroom-styled lock card (pro-gate.js helper) for gated interpretive
    // blocks; renders nothing if the helper is absent (clean absence).
    const ProLock = ({ label, sub }) => (
        window.wrLockCard
            ? <div style={{ marginBottom: 'var(--card-gap, 14px)' }} dangerouslySetInnerHTML={{ __html: window.wrLockCard(label, 'analytics_depth', sub) }} />
            : null
    );

    // Phone tier (≤767, iPhone program Phase 3): shared viewport seam
    // (js/shared/viewport.js, one debounced app-wide listener) + kit gate.
    // Kit presence (wr-primitives.js loads earlier in the babel chain) is
    // fixed for the page's lifetime, so `_phone` can gate render without
    // hook hazards. Desktop/tablet markup below stays byte-identical —
    // phone re-pours ride {_phone ? …} wraps and early returns only.
    const _vp = window.WR.useViewport();
    const _phone = !!_vp.isPhone && !!(window.WR && window.WR.HeroCard);
    // Phone proof-tile expansion (which tile shows its full explainer). Lives
    // in panel scope: AnalyticsProofGrid is a closure component that remounts
    // on every parent render, so local state there would reset each render.
    const [_proofOpen, _setProofOpen] = React.useState(null);
    // _SS mirrors the window.S shape consumed throughout this component
    const _SS = {
        rosters: _seasonCtx.rosters?.length ? _seasonCtx.rosters : (window.S?.rosters || currentLeague?.rosters || []),
        myRosterId: _seasonCtx.myRosterId ?? window.S?.myRosterId,
        tradedPicks: _seasonCtx.tradedPicks !== undefined ? _seasonCtx.tradedPicks : (window.S?.tradedPicks || []),
        playerStats: _seasonCtx.playerStats || window.S?.playerStats || {},
    };
    const resolvedLeagueSkin = leagueSkin || _seasonCtx.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const skinFeatures = resolvedLeagueSkin?.features || {};
    const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, rosters: _SS.rosters, currentLeague }) || { isUsable: true };
    // Redraft → build ROS values so analytics roster-strength / rankings reflect
    // rest-of-season production (no-op → DHQ for dynasty/keeper).
    React.useMemo(() => {
        try { window.App?.PlayerValue?.ensureRos?.({ leagueId: currentLeague?.league_id || currentLeague?.id, league: currentLeague, playersData, statsData, priorData: stats2025Data, skin: resolvedLeagueSkin }); }
        catch (e) { if (window.wrLog) window.wrLog('analytics.ensureRos', e); }
        return null;
    }, [currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);

    // Token-driven card style so padding/radius/border track index.html's spacing scale.
    const aCardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', padding: 'var(--card-pad, 16px 18px)', marginBottom: 'var(--card-gap, 14px)' };
    const aHeaderStyle = { fontFamily: 'Rajdhani, sans-serif', color: 'var(--gold)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '0.06em', marginBottom: '12px', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', paddingBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
    const aValStyle = { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-body, 1rem)', fontWeight: 500 };
    const goodColor = 'var(--good)';
    const warnColor = 'var(--warn)';
    const badColor = 'var(--bad)';
    const sevIcon = (sev) => sev === 'high' || sev === 'critical' ? '\uD83D\uDD34' : sev === 'medium' ? '\u26A0\uFE0F' : '\u2705';
    const sevColor = (sev) => sev === 'high' || sev === 'critical' ? badColor : sev === 'medium' ? warnColor : goodColor;
    const pctFmt = (v) => Math.round((v || 0) * 100) + '%';
    const numFmt = (v) => v != null ? (typeof v === 'number' ? v.toLocaleString() : v) : '\u2014';
    const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    // Fixed position palette shared by every draft-round visual on this tab (Round
    // Conversion tape, Winner Formula bars, Round-by-Round Position Mix below):
    // same position = same color everywhere, so the eye doesn't have to re-learn
    // the key per panel. Teal is reserved for YOU elsewhere on this tab.
    const POS_COLOR = { RB: 'var(--gold)', WR: '#4e8ecd', QB: 'var(--k-9b8afb,#9b8afb)', TE: 'var(--good)', DL: '#e07a5f', LB: '#c77dff', DB: '#5fb0c4', K: 'rgba(189,184,173,0.45)', DEF: 'rgba(189,184,173,0.45)', UNK: 'rgba(189,184,173,0.3)' };
    // showAlerts block removed — alerts now on Brief tab

    // ── ANALYST VIEW: full analytics terminal ──
    // Phase 8: Absorbed ex-League Map sub-views (All Players, Draft Picks, Custom Reports)
    // since League Map was removed from the nav. They render LeagueMapTab in embed mode.
    const subTabs = [
        { key: 'roster', label: 'Roster' },
        { key: 'draft', label: 'Draft' },
        { key: 'trades', label: 'Market Moves' },
        // 'assets' merges the former 'players' + 'picks' sub-tabs into one screen
        // with an internal Players/Picks toggle (handled inside LeagueMapTab).
        { key: 'assets', label: 'Players & Picks' },
        // Reports tab strip now reads its full label ('Custom Reports') — navLabel dropped.
        { key: 'reports', label: 'Custom Reports' },
    ];
    const activeSubTab = subTabs.find(t => t.key === analyticsTab) || subTabs[0];
    const analyticsViewTab = activeSubTab.key;

    const _analyticsContext = {
        roster: 'Winner-template gaps, room coverage, and roster construction evidence.',
        draft: 'Pick value, hit-rate patterns, and current-pick strategy.',
        trades: 'Trade efficiency, waiver activity, FAAB, and market pressure.',
        assets: 'Full player universe and draft-pick capital in one ledger — toggle Players / Picks.',
        reports: 'Custom report templates, saved views, and live preview.'
    };
    const tableRowStyle = (i) => ({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', ...(i === 0 ? { fontWeight: 700, color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', textTransform: 'uppercase', letterSpacing: '0.05em' } : { color: 'var(--silver)' }) });
    const d = analyticsData;
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const historyLeagueId = currentLeague?.id || currentLeague?.league_id || '';
    const [, setHistoryTick] = React.useState(0);
    React.useEffect(() => {
        const onLoaded = (event) => {
            const loadedId = event?.detail?.leagueId;
            if (!loadedId || !historyLeagueId || sameId(loadedId, historyLeagueId)) setHistoryTick(t => t + 1);
        };
        window.addEventListener('wr_history_loaded', onLoaded);
        if (historyLeagueId && window.WrHistory?.loadIfMissing) {
            window.WrHistory.loadIfMissing(currentLeague).then(cache => {
                if (cache) setHistoryTick(t => t + 1);
            }).catch(() => {});
        }
        return () => window.removeEventListener('wr_history_loaded', onLoaded);
    }, [historyLeagueId]);
    // Round-by-Round Position Mix (Draft sub-tab) — same previous_league_id chain
    // walk as WrHistory above, but pulling real per-pick round+position data
    // instead of season records. Cached separately (wr_draft_posmix_<id>) since
    // it's a different shape; see buildDraftPosMix at module scope for the walk.
    const [draftPosMix, setDraftPosMix] = React.useState({ status: 'loading', leagueId: null });
    // Ideal Draft Strategy — By Draft Slot (redraft/chopped only): which
    // third of the draft order the tab is reading.
    const [slotTierTab, setSlotTierTab] = React.useState('early');
    // Winner's Perch — the editor (WR.ManualSeasonsEditor) owns its own rows;
    // this tick just re-reads the merged perch when one is saved elsewhere.
    const [perchTick, setPerchTick] = React.useState(0);
    React.useEffect(() => {
        const onChanged = () => setPerchTick(t => t + 1);
        window.addEventListener('wr_history_manual_changed', onChanged);
        return () => window.removeEventListener('wr_history_manual_changed', onChanged);
    }, []);
    React.useEffect(() => {
        if (!historyLeagueId) return;
        let alive = true;
        setDraftPosMix(prev => (prev.leagueId === historyLeagueId ? prev : { status: 'loading', leagueId: historyLeagueId }));
        (async () => {
            try {
                const cacheKey = draftPosMixCacheKey(historyLeagueId);
                let cached = null;
                try { const raw = localStorage.getItem(cacheKey); cached = raw ? JSON.parse(raw) : null; } catch (e) { /* corrupt cache — refetch */ }
                if (cached && Date.now() - cached.fetchedAt < DRAFT_POSMIX_CACHE_TTL) {
                    if (alive) setDraftPosMix({ status: 'ready', leagueId: historyLeagueId, data: cached });
                    return;
                }
                const result = await buildDraftPosMix(historyLeagueId);
                if (!alive) return;
                if (result) {
                    try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch (e) { /* quota — in-memory only this session */ }
                    setDraftPosMix({ status: 'ready', leagueId: historyLeagueId, data: result });
                } else {
                    setDraftPosMix({ status: 'empty', leagueId: historyLeagueId });
                }
            } catch (e) {
                if (window.wrLog) window.wrLog('analytics.draftPosMix', e);
                if (alive) setDraftPosMix({ status: 'empty', leagueId: historyLeagueId });
            }
        })();
        return () => { alive = false; };
    }, [historyLeagueId]);
    const leagueRosters = currentLeague?.rosters || _SS.rosters || [];
    const leagueUsers = currentLeague?.users || window.S?.leagueUsers || [];
    const rosterByAnyId = (id) => leagueRosters.find(r => sameId(r.roster_id, id) || sameId(r.owner_id, id));
    const ownerNameSafe = (id, fallback) => {
        if (id == null || id === '') return fallback || 'Unknown';
        try {
            const direct = typeof getOwnerName === 'function' ? getOwnerName(id) : '';
            if (direct && direct !== 'Unknown' && !String(direct).startsWith('Team ')) return direct;
        } catch (_) {}
        const roster = rosterByAnyId(id);
        const user = leagueUsers.find(u => sameId(u.user_id, roster?.owner_id) || sameId(u.user_id, id));
        return user?.metadata?.team_name || user?.display_name || user?.username || fallback || 'Unknown';
    };
    const AnalyticsReadout = ({ title, children, detail }) => (
        <details className="analytics-readout" open>
            <summary>
                <span>{title}</span>
                {detail && <em>{detail}</em>}
            </summary>
            <div className="analytics-readout-body">{children}</div>
        </details>
    );
    const AnalyticsKpi = ({ label, value, sub, color }) => (
        <div className="analytics-kpi">
            <span>{label}</span>
            <strong style={{ color: color || 'var(--white)' }}>{value}</strong>
            {sub && <em>{sub}</em>}
        </div>
    );
    const AnalyticsSection = ({ title, meta, children }) => (
        <div className="analytics-panel">
            <div className="analytics-panel-head">
                <span>{title}</span>
                {meta && <em>{meta}</em>}
            </div>
            {children}
        </div>
    );
    const toneFromDelta = (delta, inverse = false) => {
        const good = inverse ? delta < 0 : delta >= 0;
        if (Math.abs(delta || 0) < 0.01) return 'warn';
        return good ? 'good' : 'bad';
    };
    const signedNum = (v, suffix = '') => {
        if (v == null || !Number.isFinite(Number(v))) return '\u2014';
        const n = Number(v);
        return (n > 0 ? '+' : '') + n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + suffix;
    };
    const AnalyticsCommandPanel = ({ title, thesis, mode, note = "Elite player = 7000+ DHQ or top 5 at position. Elite team benchmarks compare against the league's proven top teams." }) => {
        // ══ PHONE (≤767) — P5 re-pour (gallery scr-analytics-roster IMPL
        // CONTRACT): Research Question → HeroCard kicker, title → Rajdhani
        // headline, thesis → mono facts, mode callout inline, the stats
        // aside → a snapping .wr-kpi-strip band under the hero. The
        // boilerplate `note` is dropped on phone (calm spec). Early return —
        // the desktop panel below is untouched. Only rendered inside the
        // existing isPro branches, so the gate boundary never moves.
        if (_phone) {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--card-gap, 14px)' }}>
                    {React.createElement(window.WR.HeroCard, {
                        kicker: 'Research Question',
                        headline: title,
                        // Thesis rides a 2-line clamp below (owner ask: the full
                        // paragraph ate most of a screen before any data).
                        facts: null,
                    }, <React.Fragment>
                        {thesis && (window.WR.ClampedRead
                            ? React.createElement(window.WR.ClampedRead, { text: thesis, maxHeight: 44, fadeColor: 'var(--black, #121217)', style: { fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 500, color: 'var(--silver)', lineHeight: 1.5, marginTop: '2px' } })
                            : <div style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 500, color: 'var(--silver)', lineHeight: 1.5 }}>{thesis}</div>)}
                        {/* "Suggested Mode" callout removed from the phone analytics
                            hero (owner ask 2026-07-12) — your operating posture already
                            lives in the persistent GM Mode badge + GM's Office. Desktop
                            analytics panel (below) keeps its callout. */}
                    </React.Fragment>)}
                    {/* Methodology stat band removed everywhere (owner ask) —
                        the hero carries question + thesis + suggested mode only. */}
                </div>
            );
        }
        return (
        <div className="analytics-command-panel is-bare">
            <div>
                <span>Research Question</span>
                <h2>{title}</h2>
                {thesis && <p>{thesis}</p>}
                {mode && (
                    <div className="analytics-mode-callout" style={{ borderLeftColor: mode.color }}>
                        <span>Suggested Mode</span>
                        <strong style={{ color: mode.color }}>{mode.label}</strong>
                        <p>{mode.directive}</p>
                    </div>
                )}
            </div>
            {/* Methodology stat aside removed everywhere (owner ask). */}
            {note && <div className="analytics-command-note">{note}</div>}
        </div>
        );
    };
    const AnalyticsProofGrid = ({ items }) => {
        // ══ PHONE (≤767) — the desktop 1-col stack of tall explainer cards is
        // the tab's endless-scroll source. Re-poured as a 2-col grid of compact
        // stat tiles: label + tone-colored value; tap a tile and it expands to
        // full width with its explainer. No data removed — one tap away.
        if (_phone) {
            const toneColOf = it => it.color || (it.tone === 'good' ? 'var(--good, #2ecc71)' : it.tone === 'warn' ? 'var(--warn, #f0a500)' : it.tone === 'bad' ? 'var(--bad, #e5534b)' : 'var(--white)');
            return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '6px', marginBottom: 'var(--card-gap, 14px)' }}>
                    {items.map((item, i) => {
                        const key = item.label || String(i);
                        const open = _proofOpen === key;
                        const col = toneColOf(item);
                        return (
                            <button key={key} type="button" aria-expanded={open}
                                onClick={() => _setProofOpen(open ? null : key)}
                                style={{ textAlign: 'left', gridColumn: open ? '1 / -1' : 'auto', minHeight: '58px', background: 'var(--black, #121217)', border: '1px solid ' + (open ? 'var(--acc-line2, rgba(212,175,55,0.32))' : 'rgba(255,255,255,0.07)'), borderLeft: '3px solid ' + col, borderRadius: 'var(--card-radius, 10px)', padding: '8px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
                                    <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: 'var(--text-muted, #8B8B96)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                                    <span aria-hidden="true" style={{ color: 'var(--text-muted, #55555f)', fontSize: '0.62rem', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>›</span>
                                </div>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.18rem', fontWeight: 700, color: col, lineHeight: 1.15, marginTop: '2px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.value}</div>
                                {open && item.detail && <div style={{ marginTop: '5px', color: 'var(--silver)', fontSize: '0.74rem', lineHeight: 1.5 }}>{item.detail}</div>}
                            </button>
                        );
                    })}
                </div>
            );
        }
        return (
            <div className="analytics-proof-grid">
                {items.map((item, i) => (
                    <div key={i} className={'analytics-proof-card is-' + (item.tone || 'neutral')}>
                        <span>{item.label}</span>
                        <strong style={{ color: item.color || undefined }}>{item.value}</strong>
                        {item.detail && <em>{item.detail}</em>}
                    </div>
                ))}
            </div>
        );
    };
    const AnalyticsDeltaRows = ({ rows, youLabel = 'You', benchmarkLabel = 'Elite' }) => {
        const max = Math.max(1, ...rows.map(r => Math.max(Math.abs(r.yours || 0), Math.abs(r.benchmark || 0))));
        return (
            <div className="analytics-delta-list">
                <div className="analytics-delta-head">
                    <span>Room</span><span>Share</span><span>{youLabel}</span><span>{benchmarkLabel}</span><span>Gap</span>
                </div>
                {rows.map((r, i) => {
                    const yours = Number(r.yours || 0);
                    const bench = Number(r.benchmark || 0);
                    const delta = yours - bench;
                    const yPct = Math.max(2, Math.min(100, Math.abs(yours) / max * 100));
                    const bPct = Math.max(0, Math.min(100, Math.abs(bench) / max * 100));
                    return (
                        // Phone: same bar idiom, 44px touch rows (grid already
                        // centers via align-items). undefined off-phone —
                        // desktop/tablet rows are byte-identical.
                        <div key={i} className="analytics-delta-row" style={_phone ? { minHeight: '44px' } : undefined}>
                            <strong>{r.label}</strong>
                            <div className="analytics-delta-track">
                                <div className="analytics-delta-fill" style={{ width: yPct + '%', background: r.color || 'var(--k-4ecdc4, #4ecdc4)' }} />
                                <div className="analytics-delta-benchmark" style={{ left: bPct + '%' }} />
                            </div>
                            <b>{r.format ? r.format(yours) : yours.toFixed(0)}</b>
                            <b>{r.format ? r.format(bench) : bench.toFixed(0)}</b>
                            <em className={delta >= 0 ? 'is-good' : 'is-bad'}>{signedNum(delta, r.suffix || '')}</em>
                        </div>
                    );
                })}
            </div>
        );
    };
    const AnalyticsDataStack = ({ rows, compact }) => (
        <div className="analytics-data-stack">
            {rows.map((r, i) => (
                <div key={i} className={'analytics-data-row' + (compact ? ' is-compact' : '')} title={compact ? (r.detail || undefined) : undefined}>
                    <div>
                        {!compact && <span>{r.kicker || r.label}</span>}
                        <strong>{r.label}</strong>
                    </div>
                    {!compact && <em>{r.detail}</em>}
                    <b style={{ color: r.color || undefined }}>{r.value}</b>
                </div>
            ))}
        </div>
    );
    const RosterDataBlocker = ({ title = 'Roster analytics paused' }) => (
        <div className="analytics-panel" style={{ minHeight: '240px' }}>
            {window.App?.renderRosterDataBlocker?.(rosterState, {
                title,
                message: 'Champion-template and room coverage reads need complete roster IDs.',
                detail: rosterState.detail,
                actionLabel: 'Refresh Data',
                style: { minHeight: '220px' },
            })}
        </div>
    );

    return (
    <div className="analytics-shell" style={{ padding: 'var(--space-md) var(--space-lg) var(--space-lg)' }}>
        {/* PHONE (≤767): the 5 sub-tabs re-pour as the shared P2 .wr-seg
            (scrollable 4+ variant — min-width:fit-content children); long
            labels compress for the 390px strip per the gallery spec. Same
            setAnalyticsTab setter. Desktop/tablet keep the module strip
            below, byte-identical. */}
        {_phone ? (
            <div className="wr-seg" style={{ marginBottom: '10px' }}>
                {subTabs.map(t => (
                    <button key={t.key} className={analyticsViewTab === t.key ? 'is-on' : ''} onClick={() => setAnalyticsTab(t.key)}>
                        {{ trades: 'Market', assets: 'Players' }[t.key] || t.label}
                    </button>
                ))}
            </div>
        ) : (
        <div className="wr-module-strip">
            <div className="wr-module-actions">
                <div className="wr-module-nav">
                    {subTabs.map(t => (
                        <button key={t.key} className={analyticsViewTab === t.key ? 'is-active' : ''} onClick={() => setAnalyticsTab(t.key)}>{t.navLabel || t.label}</button>
                    ))}
                </div>
                <span className="wr-module-pill">{d?.computedAt ? 'Updated ' + new Date(d.computedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Loading'}</span>
            </div>
        </div>
        )}

        {!d ? (
            <div style={{ ...aCardStyle, color: 'var(--silver)', textAlign: 'center', padding: '40px' }}>
                {window.App?.LI_LOADED ? 'Computing analytics...' : 'League Intelligence is still loading. Please wait...'}
            </div>
        ) : (
        <React.Fragment>

        {/* ═══ ROSTER CONSTRUCTION ═══ */}
        {analyticsViewTab === 'roster' && (() => {
            const r = d.roster;
            if (!r) return <div style={{ color: 'var(--silver)' }}>No roster data available.</div>;
            if (!rosterState.isUsable) return <RosterDataBlocker />;
            const w = r.winnerProfile;
            const l = r.leagueProfile;
            const m = r.myProfile;
            // Elite = 7000+ DHQ or top 5 at position
            const playerScores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const SS = _SS;
            const allRosters = SS?.rosters || [];
            const winnerIds = new Set(d.winners || []);
            const hasEliteFn = typeof window.App?.countElitePlayers === 'function';
            function countElite(rosterList) {
                if (!rosterList.length) return 0;
                let total = 0;
                rosterList.forEach(ros => {
                    total += hasEliteFn ? window.App.countElitePlayers(ros.players || []) : (ros.players || []).filter(pid => (playerScores[pid] || 0) >= 7000).length;
                });
                return +(total / rosterList.length).toFixed(1);
            }
            const wElite = countElite(allRosters.filter(ros => winnerIds.has(ros.roster_id)));
            const lElite = countElite(allRosters);
            const myRid = SS?.myRosterId;
            const mElite = countElite(allRosters.filter(ros => ros.roster_id === myRid));

            // Health score
            let healthScore = 0;
            let tier = 'UNKNOWN';
            let needs = [];
            let assessment = null;
            try {
                if (window.assessTeamFromGlobal) {
                    assessment = window.assessTeamFromGlobal(myRid);
                    if (assessment) {
                        healthScore = assessment.healthScore || 0;
                        tier = (assessment.tier || 'UNKNOWN').toUpperCase();
                        needs = assessment.needs || [];
                    }
                }
            } catch(e) { window.wrLog('analytics.assessTeam', e); }
            // Winner avg health
            let winnerHealthTotal = 0, winnerHealthCount = 0;
            try {
                winnerIds.forEach(wid => {
                    if (window.assessTeamFromGlobal) {
                        const wa = window.assessTeamFromGlobal(wid);
                        if (wa) { winnerHealthTotal += wa.healthScore || 0; winnerHealthCount++; }
                    }
                });
            } catch(e) { window.wrLog('analytics.winnerHealth', e); }
            const winnerHealthAvg = winnerHealthCount > 0 ? Math.round(winnerHealthTotal / winnerHealthCount) : 0;
            const healthDelta = healthScore - winnerHealthAvg;

            // ── Benchmark provenance: every gap KPI rides on the winner set, so disclose how
            //    it was chosen (real playoff brackets vs a current-standings fallback) and its size.
            const winnerSource = d.winnerSource || d.source || 'standings';
            const winnerN = winnerIds.size;
            const benchHigh = winnerSource === 'brackets' && winnerN >= 3;
            const benchConfidence = benchHigh ? 'High' : (winnerN < 2 ? 'Very Low' : 'Low');
            const benchConfColor = benchHigh ? goodColor : (winnerN < 2 ? badColor : warnColor);

            // ── Pick capital coverage (future picks vs the horizon ideal) — already computed by assessTeam.
            const picks = assessment?.picksAssessment || null;
            const pickNet = picks ? (picks.totalPicks - picks.idealTotal) : null;

            // ── Aging-cliff at-risk set, computed ONCE and shared by the Win-Now Pressure chip and
            //    the Aging Cliff Alert (both sides now use the same value-window-end threshold).
            const CLIFF_DHQ = 2000, CLIFF_LEAD = 2;
            const cliffValueEnd = (pos) => typeof window.App?.getValueWindowEnd === 'function'
                ? window.App.getValueWindowEnd(pos)
                : ((window.App?.peakWindows || {})[pos] || [23, 29])[1];
            let rosterCliffTotalDHQ = 0, rosterCliffAtRiskDHQ = 0;
            const rosterAtRiskPlayers = [];
            const _pmCliff = window.App?.LI?.playerMeta || {};
            (allRosters.find(ros => ros.roster_id === myRid)?.players || []).forEach(pid => {
                const dq = playerScores[pid] || 0;
                const mt = _pmCliff[pid] || {};
                rosterCliffTotalDHQ += dq;
                if (!mt.age || !mt.pos) return;
                if (mt.age + CLIFF_LEAD > cliffValueEnd(mt.pos) && dq >= CLIFF_DHQ) {
                    rosterCliffAtRiskDHQ += dq;
                    rosterAtRiskPlayers.push({ name: playersData[pid]?.full_name || mt.name || ('Player ' + pid), age: mt.age, dhq: dq });
                }
            });
            const rosterCliffPct = rosterCliffTotalDHQ > 0 ? Math.round(rosterCliffAtRiskDHQ / rosterCliffTotalDHQ * 100) : 0;
            rosterAtRiskPlayers.sort((a, b) => b.dhq - a.dhq);

            // Compete window
            const compWindow = d.window || {};
            const compYears = compWindow.years || 0;
            // Avg compete window — dead code removed

            // KPI sparkline data: build from projection years
            const projData = (d.projection || []).map(p => p.projectedDHQ);
            const healthData = (d.projection || []).map(p => p.projectedHealth || healthScore);

            // ── KPI Card style ──
            const kpiCardStyle = {
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                borderRadius: 'var(--card-radius, 10px)',
                padding: '10px 12px 8px',
                flex: '1 1 0',
                minWidth: '140px',
                position: 'relative',
                overflow: 'hidden',
            };
            const kpiNumberStyle = {
                fontFamily: 'Rajdhani, sans-serif',
                fontSize: '1.8rem',
                lineHeight: 1,
                color: 'var(--white)',
                marginBottom: '2px',
            };
            const kpiLabelStyle = {
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-label, 0.75rem)',
                color: 'var(--silver)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                opacity: 0.7,
            };
            const kpiDeltaStyle = (positive) => ({
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-body, 1rem)',
                fontWeight: 600,
                color: positive ? goodColor : badColor,
                marginTop: '4px',
            });

            // ── Position data for BarChart ──
            const posOrder = ['QB','RB','TE','WR','K','DEF','DL','LB','DB'];
            const allPos = [...new Set([...Object.keys(w.posInvestment || {}), ...Object.keys(m.posInvestment || {})])].filter(p => p !== 'UNK').sort((a,b) => { const ia = posOrder.indexOf(a); const ib = posOrder.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
            // (Removed dead posBarItems/posBarWinnerItems/radarValues — no BarChart/Radar
            //  is rendered in this block; investmentRows is the only consumer of posInvestment.)

            // ── Rankings: all teams sorted by health ──
            const teamRankings = [];
            allRosters.forEach(ros => {
                let hs = 0, tier = '';
                try {
                    if (window.assessTeamFromGlobal) {
                        const a = window.assessTeamFromGlobal(ros.roster_id);
                        if (a) { hs = a.healthScore || 0; tier = a.tier || ''; }
                    }
                } catch(e) { window.wrLog('rankings.assessTeam', e); }
                const totalDhq = (ros.players || []).reduce((s, pid) => s + (playerScores[pid] || 0), 0);
                const s = ros.settings || {};
                const rUser = currentLeague.users?.find(u => u.user_id === ros.owner_id);
                teamRankings.push({
                    rosterId: ros.roster_id,
                    name: ownerNameSafe(ros.roster_id),
                    teamName: rUser?.metadata?.team_name || '',
                    avatar: rUser?.avatar || null,
                    wins: s.wins || 0,
                    losses: s.losses || 0,
                    healthScore: hs,
                    totalDhq,
                    tier,
                    isMe: ros.roster_id === myRid,
                });
            });
            teamRankings.sort((a, b) => b.healthScore - a.healthScore);
            // Health rank: convert an un-actionable absolute score into a buy/sell-relative-to-field signal.
            const myRankIdx = teamRankings.findIndex(t => t.isMe);
            const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;
            const rankPct = (myRank && teamRankings.length > 1) ? Math.round((teamRankings.length - myRank) / (teamRankings.length - 1) * 100) : null;

            // ── Insight cards ──
            const insights = [];
            const projMyAgeInsight = m.avgAge + (timeDelta || 0);
            const ageDiff = projMyAgeInsight - w.avgAge;
            if (Math.abs(ageDiff) > 0.3) {
                insights.push({
                    color: ageDiff > 0 ? badColor : goodColor,
                    title: ageDiff > 0 ? 'Roster Running Older' : 'Youth Advantage',
                    text: 'Your roster is ' + Math.abs(ageDiff).toFixed(1) + ' years ' + (ageDiff > 0 ? 'older' : 'younger') + ' than champion average (' + w.avgAge.toFixed(1) + ' yrs).' + (timeDelta ? ' (projected for ' + timeYear + ')' : ''),
                });
            }
            // (Removed Bench Depth Concern, Total Value Gap, and Strong Compete Window insights —
            //  they restated the Startable Surplus / Champion Value Gap / Win-Now Pressure KPIs.)

            // ── Starter-quality coverage (rank-based) ──────────────────────────────
            // A "quality starter" = a rostered player whose league-wide positional VALUE
            // rank lands inside the startable tier: (starting slots at the position) ×
            // (teams in the league). e.g. 1 QB slot × 16 teams ⇒ the top-16 QBs are
            // quality starters. Each room is then GRADED, not shown as a raw count.
            const numTeams = allRosters.length || leagueRosters.length || (standings || []).length || 12;
            const pmCov = window.App?.LI?.playerMeta || {};
            const posOf = (pid) => pmCov[pid]?.pos || playersData?.[pid]?.position || null;
            // Starting slots per position from the league's lineup. Flex slots are SHARED,
            // so each flex spot adds a fraction to every position it can be filled by.
            const SLOT_ELIGIBLE = {
                QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
                DL: ['DL'], LB: ['LB'], DB: ['DB'],
                FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
                WRRBTE_FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
                OP: ['QB', 'RB', 'WR', 'TE'], QB_FLEX: ['QB'], IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'],
            };
            const normSlot = (s) => {
                const u = String(s || '').toUpperCase();
                if (u === 'SUPERFLEX') return 'SUPER_FLEX';
                if (u === 'DST' || u === 'D/ST') return 'DEF';
                return u;
            };
            const startSlots = {};
            (currentLeague?.roster_positions || []).forEach(raw => {
                const slot = normSlot(raw);
                if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') return;
                const elig = SLOT_ELIGIBLE[slot];
                if (!elig) return;
                elig.forEach(p => { startSlots[p] = (startSlots[p] || 0) + 1 / elig.length; });
            });
            // League-wide positional value board (every valued player, sorted desc by DHQ).
            const posBoard = {};
            Object.keys(playerScores).forEach(pid => {
                const p = posOf(pid); const v = playerScores[pid] || 0;
                if (!p || v <= 0) return;
                (posBoard[p] = posBoard[p] || []).push(v);
            });
            Object.values(posBoard).forEach(a => a.sort((x, y) => y - x));
            const rankOf = (pos, v) => {
                const a = posBoard[pos] || []; let n = 0;
                for (let i = 0; i < a.length; i++) { if (a[i] > v) n++; else break; }
                return n + 1;
            };
            const myCovPlayers = (allRosters.find(ros => ros.roster_id === myRid)?.players) || myRoster?.players || [];
            const STREAM_POS = new Set(['K', 'DEF']); // streamable rooms never rank as a top priority
            const demoteSev = { critical: 'high', high: 'medium', medium: 'low', low: 'low' };
            const coverageByPos = {};
            ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].forEach(pos => {
                const share = startSlots[pos] || 0;
                if (share <= 0) return; // league does not start this room
                const slotsInt = Math.max(1, Math.round(share));
                const threshold = Math.max(1, Math.round(share * numTeams));
                const mine = myCovPlayers
                    .filter(pid => posOf(pid) === pos)
                    .map(pid => rankOf(pos, playerScores[pid] || 0))
                    .sort((a, b) => a - b);
                const have = mine.filter(rk => rk <= threshold).length; // quality starters
                const bestRank = mine.length ? mine[0] : Infinity;
                const grade =
                    have >= slotsInt + Math.ceil(slotsInt / 2) ? 'A' :
                    have >= slotsInt ? 'B' :
                    have >= 1 ? 'C' :
                    bestRank <= threshold * 2 ? 'D' : 'F';
                const tone = (grade === 'A' || grade === 'B') ? 'good' : grade === 'F' ? 'bad' : 'neutral';
                const color = (grade === 'A' || grade === 'B') ? goodColor : grade === 'C' ? warnColor : badColor;
                let severity = grade === 'F' ? 'critical' : grade === 'D' ? 'high' : grade === 'C' ? 'medium' : null;
                if (severity && STREAM_POS.has(pos)) severity = demoteSev[severity];
                coverageByPos[pos] = { pos, slotsInt, threshold, have, bestRank, grade, tone, color, severity };
            });
            const coveragePosList = Object.keys(coverageByPos);

            const rosterNeedGaps = (needs || []).map(n => {
                const data = assessment?.posAssessment?.[n.pos] || {};
                // Use the canonical starting requirement; do NOT fabricate a 0/1 deficit when meta is still loading.
                const required = data.startingReq || data.minQuality || data.ideal || null;
                const have = data.nflStarters ?? data.actual ?? null;
                const priority = n.urgency === 'deficit' ? 'critical' : 'high';
                return {
                    priority,
                    pos: n.pos,
                action: (n.urgency === 'deficit' ? 'Add ' : 'Build ') + posLabel(n.pos) + (n.urgency === 'deficit' ? ' starter coverage' : ' depth'),
                detail: posLabel(n.pos) + ' is a current roster ' + n.urgency + ((have != null && required != null) ? ': ' + have + '/' + required + ' starter-quality players by league settings.' : ' — see Coverage Matrix for counts.'),
                    source: 'roster-assessment',
                };
            });
            const needsSet = new Set(rosterNeedGaps.map(g => g.pos));
            const templateGaps = (d.gaps || r.gaps || [])
                .filter(g => !g.pos || !needsSet.has(g.pos))
                .map(g => ({
                    ...g,
                    action: g.action || (g.area ? 'Template gap: ' + g.area : 'Champion-template gap'),
                    source: 'champion-template',
                }));
            const investmentRows = allPos.map(pos => ({
                label: posLabel(pos),
                yours: Math.round((m.posInvestment[pos] || 0) * 100),
                benchmark: Math.round((w.posInvestment[pos] || 0) * 100),
                suffix: ' pts',
                format: v => Math.round(v) + '%',
                color: needsSet.has(pos) ? badColor : 'var(--k-4ecdc4, #4ecdc4)',
            }));
            // ── Roster command summary ──
            // Age Window Delta — a full-roster average age is useless in deep dynasty leagues:
            // every 53-man roster lands at ~26.5, so the delta is always ~0. Measure the age of
            // the COMPETITIVE CORE instead — the DHQ-weighted age of each team's top-10 most
            // valuable players — which actually separates a young-core rebuild from an aging
            // contender. Compared at present age on both sides (winners are historical, so no
            // time-shift is applied).
            const CORE_N = 10;
            const coreAge = (players) => {
                const scored = (players || [])
                    .map(pid => ({ age: pmCov[pid]?.age, dhq: playerScores[pid] || 0 }))
                    .filter(x => x.age && x.age > 18 && x.age < 45 && x.dhq > 0)
                    .sort((a, b) => b.dhq - a.dhq)
                    .slice(0, CORE_N);
                let wsum = 0, asum = 0;
                scored.forEach(x => { wsum += x.dhq; asum += x.age * x.dhq; });
                return wsum > 0 ? asum / wsum : null;
            };
            const setCoreAge = (rosterList) => {
                const vals = rosterList.map(ros => coreAge(ros.players)).filter(v => v != null);
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            };
            const myCoreAge = coreAge(myCovPlayers);
            const winnerCoreAge = setCoreAge(allRosters.filter(ros => winnerIds.has(ros.roster_id)));
            const projMyAge = myCoreAge != null ? myCoreAge : m.avgAge;
            const projWAge = winnerCoreAge != null ? winnerCoreAge : w.avgAge;
            const ageDiffDiag = projMyAge - projWAge;
            const eliteDiffDiag = mElite - wElite;
            const dhqGap = m.avgTotalDHQ - w.avgTotalDHQ;

            // Startable Surplus / Deficit — net value-gated (DHQ>=3000) starters vs league lineup needs.
            let startableSurplus = 0;
            ['QB','RB','WR','TE','K','DEF','DL','LB','DB'].forEach(pos => {
                const have = Math.round(m.posStartable?.[pos] || 0);
                const reqRaw = assessment?.posAssessment?.[pos] || {};
                const req = reqRaw.startingReq || reqRaw.minQuality || 0;
                if (!have && !req) return;
                startableSurplus += (have - req);
            });
            // Roster Value Concentration (top-5 DHQ share) vs the champion template.
            const concMe = Math.round((m.topPlayerConcentration || 0) * 100);
            const concWin = Math.round((w.topPlayerConcentration || 0) * 100);
            const concDelta = concMe - concWin;
            // Win-Now Pressure — the cliff% x window interaction that drives sell timing.
            const winNowScore = (rosterCliffPct >= 25 && compYears <= 2) ? 'CRITICAL' : (rosterCliffPct >= 25) ? 'MANAGED' : (rosterCliffPct >= 15 && compYears <= 1) ? 'ELEVATED' : 'LOW';
            const winNowColor = winNowScore === 'CRITICAL' ? badColor : winNowScore === 'LOW' ? goodColor : warnColor;

            // Suggested Mode — the franchise's operating posture (the football framing of the
            // old "operating thesis"). Mode label + directive are derived together so they can
            // never disagree.
            //
            // GM Strategy is the single source of truth: when the owner has set a strategy
            // (gm.hasStrategy), gm.mode/gm.modeLabel drive the displayed posture directly. The
            // tier/window/cliff read below is only the FALLBACK that infers a posture when no GM
            // Strategy is set (and still seeds the directive copy in every case). Drive that
            // fallback off the robust tier/window/cliff signals; only lean on noisy
            // winner-template deltas when the champion sample is trustworthy (winnerN >= 2).
            let tierModeLabel, tierModeColor, rosterStrategy;
            if (winnerN < 2) {
                if (tier === 'REBUILDING') { tierModeLabel = 'REBUILD'; tierModeColor = warnColor; rosterStrategy = 'accumulate youth and picks — you are early in the build (champion benchmark unavailable)'; }
                else { tierModeLabel = 'RETOOL'; tierModeColor = warnColor; rosterStrategy = 'target your weakest starter rooms (champion benchmark unavailable for template comparison)'; }
            } else if (tier === 'REBUILDING' || compYears <= 1) {
                tierModeLabel = 'REBUILD'; tierModeColor = badColor; rosterStrategy = 'sell aging veterans for youth and picks — your window is closing';
            } else if (rosterCliffPct >= 25 && compYears <= 2) {
                tierModeLabel = 'WIN-NOW'; tierModeColor = warnColor; rosterStrategy = 'win now — cash aging value before the cliff while your window is open';
            } else if (ageDiffDiag > 1.5 && dhqGap < 0) {
                tierModeLabel = 'RETOOL'; tierModeColor = warnColor; rosterStrategy = 'sell aging veterans and acquire young elites';
            } else if (eliteDiffDiag < -1) {
                tierModeLabel = 'RELOAD'; tierModeColor = warnColor; rosterStrategy = 'buy young elite players to close the talent gap';
            } else if (dhqGap >= 0 && ageDiffDiag <= 0.5) {
                tierModeLabel = 'RUN IT BACK'; tierModeColor = goodColor; rosterStrategy = 'hold course — your roster matches the elite tier template';
            } else {
                tierModeLabel = 'RETOOL'; tierModeColor = warnColor; rosterStrategy = 'target strategic upgrades at your weakest positions';
            }
            const tierModeDirective = rosterStrategy.charAt(0).toUpperCase() + rosterStrategy.slice(1) + '.';
            // Football-framed directives for the three GM Strategy presets — used when the owner
            // has explicitly set a strategy so the posture matches their plan, not the inference.
            const GM_MODE_FRAME = {
                rebuild:  { label: 'REBUILD',     color: gm.badgeColor || warnColor, directive: 'Accumulate youth and picks; sell aging veterans for your next dynasty core.' },
                compete:  { label: 'COMPETE',     color: gm.badgeColor || goodColor, directive: 'Balance present and future — hold your core and upgrade only at peak value.' },
                win_now:  { label: 'WIN-NOW',     color: gm.badgeColor || badColor,  directive: 'Spend future picks and young depth on proven starters — the window is open now.' },
                custom:   { label: gm.modeLabel || 'CUSTOM', color: gm.badgeColor || warnColor, directive: tierModeDirective },
            };
            // GM Strategy is primary. When no strategy is set, defer to the SAME
            // recommendation GM's Office computes (window.WR.GmMode.recommendMode,
            // off this roster's tier + health score) rather than the tier/champion-
            // benchmark inference below — the two surfaces used to run independent
            // logic and could suggest different modes for the same roster.
            const recommendedMode = window.WR?.GmMode?.recommendMode ? window.WR.GmMode.recommendMode(assessment) : null;
            const gmFrame = gm.hasStrategy
                ? (GM_MODE_FRAME[gm.mode] || GM_MODE_FRAME.custom)
                : (recommendedMode ? GM_MODE_FRAME[recommendedMode] : null);
            const modeLabel = gmFrame ? gmFrame.label : tierModeLabel;
            const modeColor = gmFrame ? gmFrame.color : tierModeColor;
            const modeDirective = gmFrame ? gmFrame.directive : tierModeDirective;
            const modeSource = gm.hasStrategy ? 'GM Strategy' : (recommendedMode ? 'recommended, matches GM’s Office' : 'inferred from tier');
            // Analysis window label — driven by GM Strategy timeline when set, else the model's
            // estimated compete window. horizonYears: 1 | 2.5 | 7.
            const _windowYears = gm.hasStrategy ? gm.horizonYears : compYears;
            const windowLabel = gm.hasStrategy
                ? (gm.timeline === '1_year' ? 'win-now (1yr) window' : gm.timeline === 'dynasty_long' ? 'dynasty (long) window' : '2-3yr window')
                : (compYears + 'yr window (model est.)');
            const rosterProofItems = [
                { label: 'Champion Value Gap', value: winnerN < 2 ? '—' : signedNum(dhqGap, ' DHQ'), detail: winnerN < 2 ? 'Champion sample too small (' + winnerN + ') to benchmark.' : 'You vs ' + winnerN + '-team ' + (winnerSource === 'brackets' ? 'champion' : 'top-standings') + ' template (avg ' + numFmt(w.avgTotalDHQ) + ' DHQ).', tone: winnerN < 2 ? 'warn' : toneFromDelta(dhqGap), color: winnerN < 2 ? warnColor : (dhqGap >= 0 ? goodColor : badColor) },
                { label: 'Elite Asset Gap', value: winnerN < 2 ? '—' : signedNum(eliteDiffDiag), detail: winnerN < 2 ? 'Champion sample too small to benchmark elites.' : 'Your ' + mElite + ' elites vs ' + wElite + ' for the ' + winnerN + '-team template.', tone: winnerN < 2 ? 'warn' : toneFromDelta(eliteDiffDiag), color: winnerN < 2 ? warnColor : (eliteDiffDiag >= 0 ? goodColor : badColor) },
                { label: 'Startable Surplus', value: signedNum(startableSurplus), detail: startableSurplus >= 0 ? 'Net value-gated (DHQ≥3000) starters above league requirements — your tradeable depth.' : 'You are short ' + Math.abs(startableSurplus) + ' startable bodies vs league lineup needs.', tone: startableSurplus >= 0 ? 'good' : 'bad', color: startableSurplus >= 0 ? goodColor : badColor },
                { label: 'Age Window Delta', value: winnerCoreAge == null ? '—' : signedNum(Number(ageDiffDiag.toFixed(1)), ' yrs'), detail: winnerCoreAge == null ? 'Core-age benchmark unavailable for this league.' : 'Age of your competitive core (DHQ-weighted top ' + CORE_N + ', avg ' + projMyAge.toFixed(1) + ' yrs) vs the ' + (winnerN || 0) + '-team champion core (avg ' + projWAge.toFixed(1) + ' yrs). Negative = younger window.', tone: ageDiffDiag <= 0.5 ? 'good' : ageDiffDiag <= 1.5 ? 'warn' : 'bad', color: ageDiffDiag <= 0.5 ? goodColor : ageDiffDiag <= 1.5 ? warnColor : badColor },
                // Free keeps the raw benchmark delta (number + tone/color); the champion-template
                // window interpretation in the parenthetical is a Pro read.
                { label: 'Top-5 Concentration', value: concMe + '%', detail: winnerN < 2 ? 'Share of roster DHQ in your top 5 assets.' : 'Top-5 share of roster DHQ vs ' + concWin + '% champion template' + (isPro ? ' (' + (concDelta > 8 ? 'top-heavy, win-now/fragile' : concDelta < -8 ? 'unusually balanced' : 'balanced') + ')' : '') + '.', tone: Math.abs(concDelta) <= 8 ? 'good' : 'warn', color: Math.abs(concDelta) <= 8 ? goodColor : warnColor },
            ];
            // Priority Evidence — rank every roster signal by true severity instead of
            // pinning draft capital to the top. Starter-quality needs come straight off the
            // Coverage Matrix grades (so the two cards always agree), then champion-template
            // gaps, then draft capital — all sorted CRITICAL → HIGH → MEDIUM → LOW.
            const SEV_WEIGHT = { critical: 3, high: 2, medium: 1, low: 0 };
            const evidenceRows = [];
            const evidencePos = new Set();
            coveragePosList.forEach(pos => {
                const c = coverageByPos[pos];
                if (!c.severity) return; // A/B rooms are covered — not a need
                evidencePos.add(pos);
                evidenceRows.push({
                    kicker: 'Starter Quality',
                    label: (c.have === 0 ? 'Add ' : 'Upgrade ') + posLabel(pos) + (c.have === 0 ? ' starter' : ' room'),
                    detail: posLabel(pos) + ' grades ' + c.grade + ' — ' + c.have + ' of your players rank inside the top ' + c.threshold + ' (' + c.slotsInt + ' slot' + (c.slotsInt > 1 ? 's' : '') + ' × ' + numTeams + ' teams).',
                    value: c.severity.toUpperCase(),
                    color: c.color,
                    weight: SEV_WEIGHT[c.severity],
                    score: c.have - c.slotsInt, // most negative (furthest from a full room) first within a tier
                });
            });
            // Champion-template gaps that aren't already flagged as a room need.
            templateGaps.filter(g => !g.pos || !evidencePos.has(g.pos)).forEach(g => {
                const sev = String(g.priority || g.severity || 'low').toLowerCase();
                evidenceRows.push({
                    kicker: 'Champion Template',
                    label: g.action || g.area || 'Roster signal',
                    detail: g.detail || 'Use module tabs to inspect the player-level evidence behind this room.',
                    value: sev.toUpperCase(),
                    color: sevColor(sev),
                    weight: SEV_WEIGHT[sev] ?? 0,
                    score: 0,
                });
            });
            // Draft capital — ranked by its own urgency (a surplus is informational, a deficit is real).
            if (picks) {
                const pickSev = pickNet >= 0 ? 'low' : (picks.status === 'deficit' ? 'high' : 'medium');
                evidenceRows.push({
                    kicker: 'Draft Capital',
                    label: (pickNet >= 0 ? 'Pick Surplus' : 'Pick Deficit') + ' (' + picks.totalPicks + '/' + picks.idealTotal + ')',
                    detail: picks.roundsMissing ? picks.roundsMissing + ' draft round(s) with zero picks across your horizon — ammo to close the talent gap is ' + (pickNet >= 0 ? 'available' : 'short') + '.' : 'You hold ' + picks.totalPicks + ' future picks vs an ideal of ' + picks.idealTotal + '.',
                    value: (pickNet >= 0 ? '+' : '') + pickNet,
                    color: pickNet >= 0 ? goodColor : (picks.status === 'deficit' ? badColor : warnColor),
                    weight: SEV_WEIGHT[pickSev],
                    score: pickNet,
                });
            }
            const gapRows = (evidenceRows.length ? evidenceRows : [{ kicker: 'Roster', label: 'No starter-quality gap', detail: 'Every starting room grades B or better against the league.', value: 'OK', color: goodColor, weight: 0, score: 0 }])
                .sort((a, b) => (b.weight - a.weight) || (a.score - b.score))
                .slice(0, 6);

            return (
            <React.Fragment>
                {/* Thesis + mode directive + tier/win-now reads = Pro; the raw
                    proof-grid numbers below stay free (D7 raw math). */}
                {!isPro && <ProLock label="Analytics Command" sub="The research thesis, suggested mode directive, and tier / win-now pressure reads for this roster are Pro." />}
                {isPro && <AnalyticsCommandPanel
                    title="What exactly separates this roster from the league's winning build?"
                    mode={{ label: modeLabel, directive: modeDirective + ' (' + modeSource + ')', color: modeColor }}
                />}

                <AnalyticsProofGrid items={rosterProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Champion Blueprint</span>
                        <strong>Position Investment Delta</strong>
                        <AnalyticsDeltaRows rows={investmentRows} benchmarkLabel="Elite" />
                    </div>
                    <div className="analytics-lab-card">
                        <span>Priority Evidence</span>
                        <strong>Rooms To Fix First</strong>
                        {isPro ? <React.Fragment>
                            <AnalyticsDataStack rows={gapRows} compact />
                        </React.Fragment> : <ProLock label="Priority Evidence" sub="Roster gaps ranked by urgency — the fix-first queue is a Pro read." />}
                    </div>
                </div>

                <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="analytics-lab-card">
                        <span>Coverage Matrix</span>
                        <strong>Starter Quality By Room</strong>
                        {isPro ? <React.Fragment>
                        <div className="analytics-chip-grid">
                            {coveragePosList.map(pos => {
                                const c = coverageByPos[pos];
                                return (
                                    <div key={pos} className={'analytics-room-chip is-' + c.tone}>
                                        <strong>{posLabel(pos)}</strong>
                                        <span className="analytics-room-grade-wrap">
                                            <b style={{ color: c.color }}>{c.grade}</b>
                                            <em>{c.have}/{c.slotsInt} · top {c.threshold}</em>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        </React.Fragment> : <ProLock label="Position Grades" sub="A–F starter-quality grades for every room are a Pro read." />}
                    </div>
                </div>

                {/* ── INSIGHT CARDS ── */}
                {insights.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                    {insights.map((ins, i) => (
                        <div key={i} style={{
                            background: 'var(--surf-solid, rgba(26,26,26,0.8))', borderRadius: 'var(--card-radius)', padding: '14px 16px',
                            borderLeft: '4px solid ' + ins.color,
                            border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: ins.color, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {ins.title}
                            </div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>{ins.text}</div>
                        </div>
                    ))}
                </div>
                )}

                {/* ── 5-YEAR OUTLOOK (moved from Projections) ── */}
                {(() => {
                    const proj = d.projection;
                    const win = d.window;
                    if (!proj || !proj.length) return null;
                    const maxDHQ = Math.max(...proj.map(p => p.projectedDHQ), 1);
                    // Free keeps the raw projection bars (projections-as-numbers);
                    // the Contender/Rebuilding tier interpretation (label +
                    // semantic color) is Pro (D7 window/tier interpretations).
                    const tierColor = (tier) => !isPro ? 'var(--acc-line3, rgba(212,175,55,0.6))' : tier === 'Contender' ? goodColor : tier === 'Playoff Team' ? warnColor : badColor;
                    return (
                        <div style={{ ...aCardStyle, marginTop: '12px' }}>
                            <div style={aHeaderStyle}><span>YOUR 5-YEAR OUTLOOK</span><span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Model estimate — ages today's roster, no future trades/draft</span></div>
                            {proj.map((p, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                    <span style={{ color: 'var(--silver)', fontFamily: 'var(--font-body)', minWidth: '40px', fontSize: 'var(--text-body, 1rem)' }}>{p.year}</span>
                                    <div style={{ flex: 1, position: 'relative', height: '24px', background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: (p.projectedDHQ / maxDHQ * 100) + '%', background: tierColor(p.tier), borderRadius: 'var(--card-radius-sm, 8px)', opacity: 0.6, transition: 'width 0.5s ease' }} />
                                        <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', color: 'var(--white)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                            {p.projectedDHQ.toLocaleString()} DHQ
                                        </div>
                                    </div>
                                    <span style={{ color: tierColor(p.tier), fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', minWidth: '90px', textAlign: 'right' }}>
                                        {isPro ? p.tier : ''} {isPro ? (p.tier === 'Rebuilding' || p.tier === 'Deep Rebuild' ? '\uD83D\uDD34' : p.tier === 'Playoff Team' ? '\u26A0\uFE0F' : '') : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* ── AGING CLIFF ALERT (moved from Projections) ── */}
                {(() => {
                    const S2 = _SS;
                    const ps2 = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
                    const pm2 = window.App?.LI?.playerMeta || {};
                    // Reuse the shared at-risk set computed once at tab scope (same unified
                    // value-window-end threshold the Win-Now Pressure chip uses).
                    const arPct2 = rosterCliffPct;
                    const arPlayers2 = rosterAtRiskPlayers;
                    if (!arPlayers2.length && arPct2 === 0) return null;
                    // Sell-timing read ("TRADE NOW", cliff-risk framing) = Pro (D7 sell-by).
                    if (!isPro) return <div style={{ marginTop: '12px' }}><ProLock label="Aging Cliff Alert" sub="Which assets are nearest the value cliff — and when to move them — is a Pro read." /></div>;
                    return (
                        <div style={{ ...aCardStyle, marginTop: '12px' }}>
                            <div style={aHeaderStyle}><span>AGING CLIFF ALERT</span></div>
	                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>Players within 2 years of their position's value-window end with 2000+ DHQ value. These are your highest-risk assets for dynasty value decline.</div>
                            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', color: arPct2 > 30 ? badColor : arPct2 > 15 ? warnColor : goodColor }}>{arPct2}%</div>
	                                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>Your DHQ near value cliff by {(parseInt(S2?.season) || 2026) + 2}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    {(() => {
                                        let lgT = 0, lgA = 0;
                                        (S2?.rosters || []).forEach(r => {
                                            (r.players || []).forEach(pid => {
                                                const dv = ps2[pid] || 0;
                                                const mv = pm2[pid] || {};
                                                lgT += dv;
                                                if (mv.age && mv.pos) {
                                                    // Use the SAME value-window-end threshold as the 'you' side (was peak-window end — a sign-flipping mismatch).
                                                    const pe = cliffValueEnd(mv.pos);
                                                    if (mv.age + CLIFF_LEAD > pe && dv >= CLIFF_DHQ) lgA += dv;
                                                }
                                            });
                                        });
                                        const lgP = lgT > 0 ? Math.round(lgA / lgT * 100) : 0;
                                        return <>
                                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', color: 'var(--gold)' }}>{lgP}%</div>
                                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>League avg</div>
                                        </>;
                                    })()}
                                </div>
                            </div>
                            {arPlayers2.length > 0 && (
                                <div>
                                    <div style={{ color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)', marginBottom: '6px', fontWeight: 700 }}>Players at risk:</div>
                                    {arPlayers2.slice(0, 5).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }}>
                                            <span style={{ color: 'var(--silver)' }}>{p.name} ({p.age})</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: badColor }}>{p.dhq.toLocaleString()} DHQ</span>
                                                <span style={{ padding: '2px 8px', background: 'rgba(231,76,60,0.15)', color: badColor, borderRadius: 'var(--card-radius-xs, 5px)', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, letterSpacing: '0.05em' }}>TRADE NOW</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </React.Fragment>
            );
        })()}

        {/* ═══ DRAFT INTELLIGENCE ═══ */}
        {analyticsViewTab === 'draft' && (() => {
            const dr = d.draft;
            if (!dr) return <div style={{ color: 'var(--silver)' }}>No draft data available.</div>;
            const rounds = Object.keys(dr.winnerDraftProfile || {}).map(Number).sort((a, b) => a - b);
            const S = _SS;
            const myRid = myRoster?.roster_id ?? S?.myRosterId;
            const draftOutcomes = (window.App?.LI || {}).draftOutcomes || [];
            const myDraftProfile = {};
            rounds.forEach(rd => {
                const myPicks = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid);
                if (!myPicks.length) return;
                const posCounts = {};
                myPicks.forEach(dp => { const pos = dp.pos || 'UNK'; posCounts[pos] = (posCounts[pos] || 0) + 1; });
                myDraftProfile[rd] = {};
                Object.entries(posCounts).forEach(([pos, cnt]) => { myDraftProfile[rd][pos] = +(cnt / myPicks.length).toFixed(2); });
            });
            let hitRounds = 0;
            let winnerHitAvg = 0, leagueHitAvg = 0;
            rounds.forEach(rd => {
                const hr = dr.winnerHitRate[rd];
                if (!hr) return;
                winnerHitAvg += hr.winners;
                leagueHitAvg += hr.league;
                hitRounds++;
            });
            winnerHitAvg = hitRounds > 0 ? winnerHitAvg / hitRounds : 0;
            leagueHitAvg = hitRounds > 0 ? leagueHitAvg / hitRounds : 0;
            // (Removed Draft Grade computation — it was the league-wide winner-vs-field spread,
            //  identical for every team and never personal. Replaced by Draft ROI / R1-R2 Anchor.)
            // Compute top draft position for winners
            // Template Lean: restrict to R1-R2 (R1 weighted double) — the old all-round sum let a
            // repeated late-round position outrank a true early anchor despite the 'early-round' label.
            const winnerTopPos = {};
            rounds.filter(rd => rd <= 2).forEach(rd => {
                Object.entries(dr.winnerDraftProfile[rd] || {}).forEach(([pos, pct]) => {
                    winnerTopPos[pos] = (winnerTopPos[pos] || 0) + pct * (rd === 1 ? 2 : 1);
                });
            });
            const topDraftTarget = Object.entries(winnerTopPos).sort((a,b) => b[1] - a[1])[0];
            const hasDraftOutcomeHistory = draftOutcomes.length > 0 && rounds.length > 0 && hitRounds > 0;
            // Winner-benchmark provenance (mirrors the Roster tab): disclose sample size + source.
            const winnerIds = new Set(d.winners || []);
            const winnerSampleN = winnerIds.size;
            const benchSource = d.winnerSource || d.source || 'standings';
            const benchHigh = benchSource === 'brackets' && winnerSampleN >= 3;

            // KPI card style
            const dKpiCardStyle = {
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                borderRadius: 'var(--card-radius-lg, 14px)',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const dKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const dKpiLabel = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

            // Build bar chart items for hit rate by round
            const hitRateBarItems = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd,
                value: Math.round((dr.winnerHitRate[rd].winners || 0) * 100),
                color: goodColor,
            }));
            const hitRateLeagueItems = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd,
                value: Math.round((dr.winnerHitRate[rd].league || 0) * 100),
                color: 'rgba(192,192,192,0.6)',
            }));

            // ── Draft Strategy Summary ──
            const myHitRates = {};
            const myHitCounts = {};
            rounds.forEach(rd => {
                const myPicks = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid);
                if (!myPicks.length) return;
                myHitCounts[rd] = myPicks.length;
                const hits = myPicks.filter(dp => dp.isHit || dp.isStarter).length;
                myHitRates[rd] = hits / myPicks.length;
            });
            const topDraftPos = topDraftTarget ? topDraftTarget[0] : null; // null-honest; no 'RB/WR' mask
            // Personal R1-R2 anchor conversion, with explicit denominators (suppressed when thin).
            const myAnchorPicks = draftOutcomes.filter(dp => dp.roster_id === myRid && dp.round <= 2);
            const myAnchorN = myAnchorPicks.length;
            const myAnchorHits = myAnchorPicks.filter(dp => dp.isHit || dp.isStarter).length;
            const myAnchorRate = myAnchorN ? myAnchorHits / myAnchorN : 0;
            const winnerAnchorN = draftOutcomes.filter(dp => dp.round <= 2 && winnerIds.has(dp.roster_id)).length;
            const winnerAnchorHits = draftOutcomes.filter(dp => dp.round <= 2 && winnerIds.has(dp.roster_id) && (dp.isHit || dp.isStarter)).length;
            const winnerAnchorRate = winnerAnchorN ? winnerAnchorHits / winnerAnchorN : 0;
            // Slot-adjusted personal draft skill: realized normValue vs league-avg normValue at that exact slot.
            const _pickVals = window.App?.LI?.dhqPickValues || {};
            const myRoiSamples = draftOutcomes.filter(dp => dp.roster_id === myRid && (dp.seasonsAvailable || 0) >= 1 && (_pickVals[dp.pick_no]?.avgNorm || 0) > 0).map(dp => ({ realized: dp.normValue || 0, expected: _pickVals[dp.pick_no].avgNorm }));
            const myRoiN = myRoiSamples.length;
            const _roiDiffSum = myRoiSamples.reduce((s, x) => s + (x.realized - x.expected), 0);
            const _roiExpSum = myRoiSamples.reduce((s, x) => s + x.expected, 0);
            const reachIndex = myRoiN ? Math.round(_roiDiffSum / myRoiN) : null;
            const leagueSeason = parseInt(currentLeague?.season || activeYear, 10) || new Date().getFullYear();
            const draftRounds = Number(window.App?.LeagueSkin?.resolveDraftRounds?.({
                league: currentLeague,
                leagueSkin: resolvedLeagueSkin,
                drafts: window.S?.drafts || currentLeague?.drafts || [],
                fallbackRounds: currentLeague?.settings?.draft_rounds || 5,
            }) || currentLeague?.settings?.draft_rounds || 5);
            const totalTeams = leagueRosters.length || 12;
            const tradedPicks = _SS.tradedPicks || [];
            const currentDraft = (window.S?.drafts || currentLeague?.drafts || []).find(dft => sameId(dft?.season, leagueSeason) && dft?.draft_order);
            const draftOrder = currentDraft?.draft_order || {};
            const slotToRoster = {};
            if (Object.keys(draftOrder).length) {
                Object.entries(draftOrder).forEach(([userId, slot]) => {
                    const roster = leagueRosters.find(r => sameId(r.owner_id, userId));
                    if (roster?.roster_id != null) slotToRoster[String(slot)] = roster.roster_id;
                });
            }
            const sortedRosters = Object.keys(slotToRoster).length ? leagueRosters : [...leagueRosters].sort((a, b) => {
                const stA = standings.find(s => { const rr = leagueRosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, a.roster_id); });
                const stB = standings.find(s => { const rr = leagueRosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, b.roster_id); });
                const wA = stA?.wins ?? (a.settings?.wins ?? 0);
                const wB = stB?.wins ?? (b.settings?.wins ?? 0);
                if (wA !== wB) return wA - wB;
                const pfA = (stA?.pointsFor ?? a.settings?.fpts ?? 0) + ((a.settings?.fpts_decimal || 0) / 100);
                const pfB = (stB?.pointsFor ?? b.settings?.fpts ?? 0) + ((b.settings?.fpts_decimal || 0) / 100);
                return pfA - pfB;
            });
            if (!Object.keys(slotToRoster).length) {
                sortedRosters.forEach((r, i) => { slotToRoster[String(i + 1)] = r.roster_id; });
            }
            const pickOrder = {};
            Object.entries(slotToRoster).forEach(([slot, rid]) => {
                if (rid != null) pickOrder[String(rid)] = Number(slot);
            });
            const slotForOriginalRid = (rid) => pickOrder[String(rid)] || Math.ceil(totalTeams / 2);
            const discountSlotValue = (value, yr) => {
                const curYear = parseInt(window.S?.season || currentLeague?.season || activeYear, 10) || new Date().getFullYear();
                const pickYear = parseInt(yr, 10) || curYear;
                const yearsAhead = Math.max(0, pickYear - curYear);
                return Math.round(value * Math.pow(0.88, yearsAhead));
            };
            const pickValue = (yr, rd, slotInRound) => {
                const slot = Math.max(1, Math.min(Number(slotInRound) || Math.ceil(totalTeams / 2), totalTeams));
                const overall = (rd - 1) * totalTeams + slot;
                let value = 0;
                if (typeof window.getPickValueBySlot === 'function') value = window.getPickValueBySlot(rd, slot, totalTeams, draftRounds);
                if (!value && typeof window.getIndustryPickValue === 'function') value = window.getIndustryPickValue(overall, totalTeams, draftRounds);
                if (!value) value = window.App?.PlayerValue?.PICK_VALUES_BY_SLOT?.[overall] || 0;
                if (!value) value = window.App?.LI?.dhqPickValueFn?.(yr, rd, slot) || 0;
                if (value > 0) return discountSlotValue(value, yr);
                return window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || Math.max(100, 9000 - rd * 1600);
            };
            const pickLabel = (yr, rd, slot, via) => {
                const base = rd + '.' + String(Math.max(1, Number(slot) || 1)).padStart(2, '0');
                const withYear = yr === leagueSeason ? base : String(yr).slice(-2) + ' ' + base;
                return via ? withYear + ' via ' + via : withYear;
            };
            const currentPicks = [];
            const draftYears = skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2];
            for (const yr of draftYears) {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    const mySlot = slotForOriginalRid(myRid);
                    const ownMoved = tradedPicks.find(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.roster_id, myRid) && !sameId(p.owner_id, myRid));
                    if (!ownMoved) currentPicks.push({ year: yr, round: rd, slot: mySlot, own: true, label: pickLabel(yr, rd, mySlot), value: pickValue(yr, rd, mySlot) });
                    tradedPicks
                        .filter(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.owner_id, myRid) && !sameId(p.roster_id, myRid))
                        .forEach(p => {
                            const fromSlot = slotForOriginalRid(p.roster_id);
                            const fromName = ownerNameSafe(p.roster_id);
                            currentPicks.push({ year: yr, round: rd, slot: fromSlot, own: false, from: fromName, label: pickLabel(yr, rd, fromSlot, fromName), value: pickValue(yr, rd, fromSlot) });
                        });
                }
            }
            const currentPickValue = currentPicks.reduce((s, p) => s + (p.value || 0), 0);
            const earlyPicks = currentPicks.filter(p => p.round <= 2).length;
            const topCurrentPicks = [...currentPicks].sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round).slice(0, 5);
            const leagueId = currentLeague?.id || currentLeague?.league_id || '';
            const movedPickCount = tradedPicks.filter(p => !sameId(p.owner_id, p.roster_id)).length;
            // 'Owned Picks' + 'Early Capital' proof cards removed (owner ask) \u2014 the raw pick-capital
            // count duplicated the Winner's Perch / Ideal Draft Strategy panels below with less signal.
            // Surface the league's own most recent completed draft (grade/DHQ) here instead of a
            // hardcoded 'Pending' \u2014 this tab used to show that placeholder even right after you
            // drafted, because nothing linked the saved recap in. The round-conversion/winner-DNA
            // panels further down are a separate, still-unbuilt feature (they need actual per-pick
            // hit-rate history across seasons, which nothing in the app computes yet) \u2014 that's
            // still correctly gated behind hasDraftOutcomeHistory below.
            // The same archive (js/draft/state.js buildDraftRecap, wr_draft_recap_archive_<id>)
            // also holds MOCK draft recaps \u2014 a user can run a Mock Draft Center session
            // (js/draft/command-center.js ModeSelector: solo/manual/scenario/ghost) and hit Save,
            // and nothing used to stop that mock grade from being read here as if it were the
            // league's real outcome. Real drafts (Follow Live Draft, Sleeper- or MFL-synced) are
            // the ONLY path that ever sets mode:'live-sync' (command-center.js forcedMode); every
            // Mock Draft Center run uses one of MOCK_DRAFT_MODES instead. Filter those out here
            // rather than tag a new field at save time \u2014 mode already carries this signal.
            // Recaps saved before this field existed have no mode at all; treat missing/unknown
            // as trusted-real (mock is the newer, rarer path) so old history isn't hidden.
            const MOCK_DRAFT_MODES = new Set(['solo', 'manual', 'ghost', 'scenario']);
            const isRealDraftRecap = r => !!r && !MOCK_DRAFT_MODES.has(r.mode);
            const latestRecap = (window.App?.PostDraft?.getRecapArchive && leagueId)
                ? (window.App.PostDraft.getRecapArchive(leagueId).find(isRealDraftRecap) || null)
                : null;
            const historicalProofItems = latestRecap ? [
                {
                    label: 'Latest Draft',
                    value: (latestRecap.grade?.letter || '\u2014') + ' \u00b7 ' + Number(latestRecap.totalDHQ || latestRecap.grade?.totalDHQ || 0).toLocaleString() + ' DHQ',
                    detail: (latestRecap.rank ? 'Finished #' + latestRecap.rank + (latestRecap.percentile != null ? ' (' + latestRecap.percentile + 'th percentile)' : '') + '. ' : '')
                        + 'Round-by-round hit-rate needs a season of results, so that read stays slot-value-only until games are played.',
                    tone: 'good', color: goodColor,
                },
            ] : [
                { label: 'Draft Outcomes', value: 'Pending', detail: 'No draft recap on record for this league yet; reads use slot value only.', tone: 'warn', color: warnColor },
            ];
            // \u2500\u2500 Draft intel: Round-Conversion tape + Winner-Formula DNA (full-width) \u2500\u2500
            // POS_COLOR now lives at component scope (shared with the Round-by-Round
            // Position Mix panel below) \u2014 same position, same color, everywhere on this tab.
            // One lane per round on a fixed 0-100% axis. Never filtered: zero-pick rounds still render.
            const roundTape = rounds.map(rd => {
                const youPct = Math.round((myHitRates[rd] || 0) * 100);
                const elitePct = Math.round(((dr.winnerHitRate[rd] || {}).winners || 0) * 100);
                const leaguePct = Math.round(((dr.winnerHitRate[rd] || {}).league || 0) * 100);
                const n = myHitCounts[rd] || 0;
                return { rd, youPct, elitePct, leaguePct, n, gap: youPct - elitePct, state: n === 0 ? 'empty' : n < 2 ? 'thin' : 'solid' };
            });
            // The only trustworthy aggregate (n=4 vs n=28) \u2014 leads the section.
            const anchorPct = Math.round(myAnchorRate * 100);
            const eliteAnchorPct = Math.round(winnerAnchorRate * 100);
            const anchorEdge = anchorPct - eliteAnchorPct;
            const anchorGradable = myAnchorN >= 2;
            const rcHeadline = !anchorGradable
                ? 'Too few premium picks to grade yet \u2014 build R1-R2 anchor volume first.'
                : (myAnchorRate >= winnerAnchorRate
                    ? 'Where it counts \u2014 R1-R2 \u2014 you\u2019re ' + myAnchorHits + ' of ' + myAnchorN + ' (' + anchorPct + '%), ' + signedNum(anchorEdge, ' pts') + ' over champions (' + eliteAnchorPct + '%, n=' + winnerAnchorN + '). Past R2 it\u2019s one pick a round: signal, not proof.'
                    : 'You trail title tier where it pays \u2014 R1-R2: ' + anchorPct + '% vs champions ' + eliteAnchorPct + '% (n=' + winnerAnchorN + '). Past R2 it\u2019s one pick a round: signal, not proof.');
            // Winner Formula: champion R1-anchor + blended R1-R2 lean + auto verdict.
            const r1Entries = Object.entries(dr.winnerDraftProfile[1] || {}).sort((a, b) => b[1] - a[1]);
            const r1TopPos = r1Entries.length ? r1Entries[0][0] : null;
            const blendedTopPos = topDraftPos; // existing R1x2 + R2 weighted top
            const myR1Top = Object.entries(myDraftProfile[1] || {}).sort((a, b) => b[1] - a[1])[0];
            const onScriptCut = 0.08;
            const wfHeadline = (() => {
                const champR1 = r1TopPos ? posLabel(r1TopPos) : 'skill';
                const youR1 = myR1Top ? posLabel(myR1Top[0]) : null;
                const matchedR1 = myR1Top && r1TopPos && myR1Top[0] === r1TopPos;
                const r2Top = Object.entries(dr.winnerDraftProfile[2] || {}).sort((a, b) => b[1] - a[1])[0];
                const youR2 = Object.keys(myDraftProfile[2] || {});
                let s = 'Champions open ' + champR1 + '-first in Round 1' + (r1Entries.length ? ' (' + pctFmt(r1Entries[0][1]) + ')' : '') + (youR1 ? (matchedR1 ? ' \u2014 and so did you (' + youR1 + ').' : ' \u2014 you opened ' + youR1 + '.') : '.');
                if (r2Top && !youR2.includes(r2Top[0])) s += ' By Round 2 title teams lean ' + posLabel(r2Top[0]) + ' (' + pctFmt(r2Top[1]) + '); you went ' + (youR2.length ? youR2.map(posLabel).join('/') : 'elsewhere') + '.';
                return s + ' Most rounds are a single pick \u2014 read these as direction, not signature.';
            })();
            // Fallback (no draft outcomes): draft-relevant pick info only \u2014 no championship/history filler.
            const historicalRows = [
                { kicker: 'Owned Picks', label: currentPicks.length + ' picks', detail: 'Across visible draft years.', value: currentPickValue.toLocaleString() + ' DHQ', color: 'var(--gold)' },
                { kicker: 'Early Capital', label: earlyPicks + ' in R1-R2', detail: 'Premium capital to anchor a tier break.', value: topCurrentPicks[0]?.label || '\u2014', color: earlyPicks >= 3 ? goodColor : warnColor },
            ];
            const buildRows = [
                // Low-capital branch: 'trade-up candidates' is a seeded do-X directive (Pro);
                // free gets the raw threshold statement (the color already encodes it).
                { kicker: 'Early Capital', label: earlyPicks + ' picks in R1-R2', detail: earlyPicks >= 3 ? 'Enough premium capital to anchor a tier break.' : (isPro ? 'Light on premium capital; trade-up candidates.' : 'Fewer than 3 picks in rounds 1-2.'), value: topCurrentPicks[0]?.label || '\u2014', color: earlyPicks >= 3 ? goodColor : warnColor },
                { kicker: 'Round Shape', label: draftRounds + ' rounds x ' + totalTeams + ' teams', detail: 'Resolved from roster-slot skin rules' + ((!currentLeague?.settings?.draft_rounds && draftRounds === 5) ? ' (fallback estimate).' : '.'), value: (totalTeams * draftRounds).toLocaleString() + ' picks', color: 'var(--k-9b8afb, #9b8afb)' },
            ];
            // Draft research-question header is bare (no stat boxes) \u2014 see AnalyticsCommandPanel call below.

            // Proof grid: once outcome history exists, the Ideal Draft Strategy panel
            // below (round×position heatmap) and Round Conversion / Winner Formula
            // already carry the full read — no separate stat cards here (owner ask,
            // they duplicated those panels with less signal). Without outcome
            // history, fall back to the 'Draft Outcomes: Pending' notice.
            const draftProofItems = hasDraftOutcomeHistory ? [] : historicalProofItems;

            // ── Ideal Draft Strategy (hit rate by round × position, winners only) ──
            // Winner-scoped, same population as Round Conversion / Winner Formula
            // below (dr.winnerHitRate / dr.winnerDraftProfile) — "ideal" means what
            // title teams actually did, not what any team in the league happened to
            // hit on. Sourced from dr.winnerPosHitRate (analytics-engine.js
            // analyzeDraftPatterns): ranks positions within a round only once 2+
            // winner picks share that position; a round where no position clears
            // that bar falls back to the league-wide ranking instead of going empty
            // (source: 'league'), which the UI discloses per-round rather than
            // passing a league number off as a champion one.
            const winnerPosHitRate = dr.winnerPosHitRate || {};
            const strategyRounds = Object.keys(winnerPosHitRate).map(Number).sort((a, b) => a - b)
                .map(rd => ({ rd, ...winnerPosHitRate[rd] }))
                .filter(r => r.total > 0 || (r.ranked || []).length);
            // ── The Winner's Perch (redraft only) ──
            // Redraft leagues re-draft the whole roster every season, so draft
            // slot is a real recurring input, not a one-time rookie-draft echo.
            // For each slot 1..N: how many times has the team drafting there
            // finished top 3, and how many of those were the title (parens).
            // Multi-season, sourced from WrHistory (walks previous_league_id) —
            // free read, same tier as Trophy Room's raw standings history.
            const isRedraftLeague = resolvedLeagueSkin?.type === 'redraft';
            const perchTeamCount = currentLeague?.rosters?.length || currentLeague?.settings?.num_teams || 0;
            const perchManual = isRedraftLeague ? (window.WrHistory?.getManualSeasons?.(leagueId) || []) : [];
            const winnersPerch = isRedraftLeague
                ? (window.WrHistory?.getDraftSlotPerch?.(leagueId, { maxSlots: perchTeamCount }) || [])
                : [];
            // Slots that existed in a bigger era but not today: kept out of the
            // table (you can't draft from slot 14 in a 12-team league) and
            // disclosed as a footnote instead of quietly discarded.
            const perchRetiredSlots = isRedraftLeague && perchTeamCount
                ? (window.WrHistory?.getDraftSlotPerch?.(leagueId) || []).filter(r => r.slot > perchTeamCount && r.seasons > 0)
                : [];
            const perchSleeperSeasons = window.WrHistory?.getCached?.(leagueId)?.seasonsLoaded || 0;
            const perchSeasons = perchSleeperSeasons + perchManual.length;
            const perchMaxTop3 = winnersPerch.reduce((m, r) => Math.max(m, r.top3), 0);

            // ── Ideal Draft Strategy enhancements: a pos×round heatmap, and (for
            // redraft/chopped/best-ball/DFS) a by-draft-slot cut of the same read.
            // Round Conversion and Winner Formula below stay untouched — this only
            // reshapes the free Ideal Draft Strategy panel above the proof grid.
            const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

            // By-slot data (redraft/chopped/best-ball/DFS only — see
            // analyzeDraftPatternsBySlotTier in analytics-engine.js: a full
            // re-draft every season makes "which third of the order" a real,
            // repeated input; a dynasty startup happens once and a rookie draft's
            // slot is set by standings, not a choice, so it doesn't apply there).
            const isSeasonalLeague = ['redraft', 'chopped', 'best_ball', 'dfs'].includes(resolvedLeagueSkin?.type);
            const bySlot = d.draftBySlot;
            const SLOT_TIERS = [
                { key: 'early', label: 'Early', sub: '1st third of the order' },
                { key: 'mid', label: 'Middle', sub: '2nd third of the order' },
                { key: 'late', label: 'Late', sub: 'final third of the order' },
            ];
            const hasSlotTiers = isSeasonalLeague && !!bySlot && bySlot.hasSlotData
                && SLOT_TIERS.some(t => Object.keys(bySlot[t.key] || {}).length > 0);
            // 'all' (pooled, every pick) is always the first tab; slot tiers only
            // join it when this league format + history actually supports them.
            const strategyTab = hasSlotTiers ? slotTierTab : 'all';
            const activeHitRate = strategyTab === 'all' ? winnerPosHitRate : (bySlot?.[strategyTab] || {});
            const activeRounds = Object.keys(activeHitRate).map(Number).sort((a, b) => a - b)
                .map(rd => ({ rd, ...activeHitRate[rd] }))
                .filter(r => (r.ranked || []).length);
            const activeHeadline = activeRounds.map(r => 'R' + r.rd + ' ' + posLabel(r.ranked[0].pos)).join(' → ');

            // Blueprint heatmap: pos × round pivot of the active tab's per-round
            // ranked lists — the same numbers the recommended-path chips read,
            // transposed into a grid that's scannable in one glance.
            const blueprintPositions = Array.from(new Set(activeRounds.flatMap(r => (r.ranked || []).map(p => p.pos))));
            const blueprintRows = POS_ORDER.filter(p => blueprintPositions.includes(p))
                .concat(blueprintPositions.filter(p => !POS_ORDER.includes(p)));
            const cellFor = (pos, rd) => ((activeHitRate[rd] || {}).ranked || []).find(p => p.pos === pos) || null;

            // Recommended-path confidence: only rounds where the leader is winner-
            // sourced (not a fallback) AND has 3+ champion samples read as High;
            // any fallback or thin round pulls it down rather than overstating it.
            const pathRounds = activeRounds;
            const pathWinnerSourced = pathRounds.filter(r => r.source === 'winners' && (r.ranked[0].total || 0) >= 3).length;
            const pathConfidence = !pathRounds.length ? null
                : pathWinnerSourced === pathRounds.length ? 'High'
                : pathWinnerSourced >= Math.ceil(pathRounds.length / 2) ? 'Medium' : 'Low';
            const pathFallbackNote = strategyTab === 'all'
                ? ' * = round too thin on champions alone; ranking is league-wide.'
                : " * = round too thin on champions alone; ranking is this third's whole round.";

            const bpThStyle = { padding: '5px 7px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-micro)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--ov-4,rgba(255,255,255,0.08))', whiteSpace: 'nowrap' };
            const bpTdStyle = { padding: '5px 7px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', borderBottom: '1px solid var(--ov-3,rgba(255,255,255,0.04))', fontVariantNumeric: 'tabular-nums' };

            return (
            <React.Fragment>
                {!isPro && <ProLock label="Draft Intelligence Reads" sub="The draft research thesis and champion-benchmark conversion reads are Pro. The Ideal Draft Strategy read below stays free." />}
                {isPro && <AnalyticsCommandPanel
                    title="What does this league actually reward in the draft?"
                />}

                {isRedraftLeague && (
                    <div key={'perch-' + perchTick} className="analytics-panel" style={{ marginBottom: 'var(--card-gap, 14px)' }}>
                        <div className="analytics-panel-head">
                            <span>The Winner's Perch</span>
                            <em>
                                {perchSeasons} season{perchSeasons === 1 ? '' : 's'} of draft history
                                {perchManual.length ? ' · ' + perchManual.length + ' added by hand' : ''}
                            </em>
                        </div>
                        {winnersPerch.length > 0 ? (
                            <div style={{ display: 'grid', gap: '4px' }}>
                                {winnersPerch.map(row => {
                                    const isBest = row.top3 > 0 && row.top3 === perchMaxTop3;
                                    return (
                                        <div key={row.slot} className="analytics-data-row is-compact" style={isBest ? { borderColor: 'rgba(46,204,113,0.4)', background: 'rgba(46,204,113,0.08)' } : undefined}>
                                            <strong>Slot {row.slot}</strong>
                                            <b style={{ color: row.top3 ? (isBest ? 'var(--good)' : 'var(--gold)') : 'var(--silver)' }}>
                                                {row.top3 ? row.top3 + (row.titles ? ' (' + row.titles + ')' : '') : '—'}
                                            </b>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ color: 'var(--silver)', opacity: 0.75, fontSize: '0.8rem', lineHeight: 1.6, padding: '4px 0 2px' }}>
                                Sleeper hasn't given us two seasons with a draft order for this league yet. Add the years it can't see and the perch fills in.
                            </div>
                        )}
                        {perchRetiredSlots.length > 0 && (
                            <div style={{ color: 'var(--silver)', fontSize: '0.72rem', lineHeight: 1.5, marginTop: 8, opacity: 0.65 }}>
                                Slot{perchRetiredSlots.length === 1 ? '' : 's'} {perchRetiredSlots.map(r => r.slot).join(', ')} existed in a larger era of this league and {perchRetiredSlots.length === 1 ? 'is' : 'are'} left out — {perchRetiredSlots.reduce((n2, r) => n2 + r.top3, 0)} top-3 finish{perchRetiredSlots.reduce((n2, r) => n2 + r.top3, 0) === 1 ? '' : 'es'} from {perchRetiredSlots.reduce((n2, r) => n2 + r.seasons, 0)} season-slots you can no longer draft.
                            </div>
                        )}
                        {window.WR?.ManualSeasonsEditor && (
                            <window.WR.ManualSeasonsEditor leagueId={leagueId} teamCount={perchTeamCount} showSlots />
                        )}
                    </div>
                )}

                {/* ── Ideal Draft Strategy ──────────────────────────────────────
                    One panel: "All Picks" is the original pooled read; Early/
                    Middle/Late join it as tabs only for redraft/chopped/best-ball/
                    DFS leagues with enough by-slot history (see
                    analyzeDraftPatternsBySlotTier, analytics-engine.js) — a full
                    re-draft every season makes "which third of the order" a real,
                    repeated input; dynasty/keeper don't get the tabs since a
                    startup happens once and a rookie draft's slot is set by
                    standings, not a choice. */}
                {(strategyRounds.length > 0 || hasSlotTiers) && (
                    <div className="analytics-panel" style={{ marginBottom: 'var(--card-gap, 14px)' }}>
                        <div className="analytics-panel-head">
                            <span>Ideal Draft Strategy</span>
                            <em>Champion hit rate by round &amp; position</em>
                        </div>

                        {hasSlotTiers && (
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                                {[{ key: 'all', label: 'All Picks', sub: 'every draft slot' }, ...SLOT_TIERS].map(t => {
                                    const has = t.key === 'all' ? strategyRounds.length > 0 : Object.keys(bySlot[t.key] || {}).length > 0;
                                    return (
                                        <button key={t.key} type="button" disabled={!has} onClick={() => setSlotTierTab(t.key)}
                                            title={has ? t.sub : 'Not enough champion picks from this third of the draft yet'}
                                            style={{
                                                flex: '1 1 0', padding: '8px 10px', borderRadius: 'var(--card-radius-sm, 8px)', cursor: has ? 'pointer' : 'not-allowed',
                                                border: '1px solid ' + (strategyTab === t.key ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                                background: strategyTab === t.key ? 'rgba(212,175,55,0.1)' : 'transparent',
                                                color: !has ? 'var(--ov-8, rgba(255,255,255,0.3))' : strategyTab === t.key ? 'var(--gold)' : 'var(--silver)',
                                                textAlign: 'center', fontFamily: 'var(--font-body)',
                                            }}>
                                            <div style={{ fontWeight: 700, fontSize: 'var(--text-body, 1rem)' }}>{t.label}</div>
                                            <div style={{ fontSize: 'var(--text-micro)', opacity: 0.75 }}>{t.sub}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {!activeRounds.length ? (
                            <div style={{ color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)', padding: '8px 0' }}>
                                Not enough champion draft history from this third of the order yet — needs more seasons before a real pattern shows.
                            </div>
                        ) : (
                        <React.Fragment>
                        {activeHeadline && (
                            <div style={{ marginBottom: '14px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 10px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: 'var(--text-micro)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Recommended path</span>
                                    {pathConfidence && <span style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>confidence: {pathConfidence}</span>}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {activeRounds.map(r => (
                                        <span key={r.rd} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', border: '1px solid ' + (POS_COLOR[r.ranked[0].pos] || POS_COLOR.UNK), borderRadius: '999px', padding: '3px 10px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'JetBrains Mono, monospace' }}>
                                            <b style={{ color: 'var(--silver)' }}>R{r.rd}</b>
                                            <b style={{ color: POS_COLOR[r.ranked[0].pos] || POS_COLOR.UNK }}>{posLabel(r.ranked[0].pos)}</b>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Blueprint heatmap: same numbers as the recommended path, laid out for a one-glance scan instead of a per-round scroll. */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                                <thead>
                                    <tr>
                                        <th style={{ ...bpThStyle, textAlign: 'left' }}>Pos</th>
                                        {activeRounds.map(r => (
                                            <th key={r.rd} style={bpThStyle} title={'champ n=' + r.total + ' · ' + r.ranked[0].rate + '% starter (top position)' + (r.source !== 'winners' ? ' — thin on champions; fallback read' : '')}>
                                                R{r.rd}{r.source !== 'winners' ? '*' : ''}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {blueprintRows.map(pos => (
                                        <tr key={pos}>
                                            <td style={{ ...bpTdStyle, textAlign: 'left', color: POS_COLOR[pos] || POS_COLOR.UNK, fontWeight: 700 }}>{posLabel(pos)}</td>
                                            {activeRounds.map(r => {
                                                const cell = cellFor(pos, r.rd);
                                                return (
                                                    <td key={r.rd} style={{ ...bpTdStyle, background: cell ? 'rgba(46,204,113,' + Math.min(0.5, cell.rate / 100 * 0.45 + 0.05).toFixed(2) + ')' : 'transparent', color: cell ? (cell.rate >= 50 ? 'var(--white)' : 'var(--silver)') : 'rgba(189,184,173,0.3)' }}
                                                        title={cell ? posLabel(pos) + ' R' + r.rd + ': ' + cell.rate + '% (n=' + cell.total + ')' : undefined}>
                                                        {cell ? cell.rate + '%' : '—'}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.7, marginTop: '8px' }}>
                            Darker green = higher champion starter-rate. Dash = fewer than 2 champion picks at that position/round.{activeRounds.some(r => r.source !== 'winners') ? pathFallbackNote : ''}
                        </div>
                        </React.Fragment>
                        )}
                    </div>
                )}

                <AnalyticsProofGrid items={draftProofItems} />

                {hasDraftOutcomeHistory && !isPro ? (
                    <ProLock label="Round Conversion + Winner Formula" sub="Hit-rate vs the champion standard and what title teams draft round-by-round are Pro reads." />
                ) : hasDraftOutcomeHistory ? (
                    <React.Fragment>
                    {/* \u2550\u2550\u2550 ROUND CONVERSION \u2014 The Conversion Tape (full width) \u2550\u2550\u2550 */}
                    <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                        <div className="analytics-lab-card">
                            <span>Round Conversion</span>
                            <strong>Hit Rate vs the Champion Standard</strong>
                            <div style={{ display: 'flex', gap: '18px', borderTop: '1px solid var(--ov-4,rgba(255,255,255,0.06))', borderBottom: '1px solid var(--ov-4,rgba(255,255,255,0.06))', padding: '12px 0', margin: '4px 0 14px' }}>
                                {[
                                    { k: 'Anchor (R1-R2)', v: anchorGradable ? anchorPct + '%' : '\u2014', c: anchorGradable ? 'var(--good)' : 'var(--silver)', s: 'you \u00B7 ' + myAnchorHits + '/' + myAnchorN },
                                    { k: 'Elite Anchor', v: eliteAnchorPct + '%', c: 'var(--gold)', s: 'champions \u00B7 n=' + winnerAnchorN },
                                    { k: 'Edge', v: anchorGradable ? signedNum(anchorEdge, ' pts') : '\u2014', c: !anchorGradable ? 'var(--silver)' : anchorEdge >= 0 ? 'var(--good)' : 'var(--warn)', s: 'vs title tier' },
                                ].map((cell, i) => (
                                    <div key={i} style={{ flex: '1 1 0', minWidth: 0 }}>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{cell.k}</div>
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.85rem', lineHeight: 1.05, color: cell.c }}>{cell.v}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>{cell.s}</div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: _phone ? '44px 28px minmax(0,1fr) 78px' : '52px 34px minmax(0,1fr) 132px', gap: _phone ? '7px' : '10px', padding: '0 8px 5px' }}>
                                <span /><span />
                                <div style={{ position: 'relative', height: '12px', color: 'var(--silver)', fontSize: 'var(--text-micro)', opacity: 0.55 }}>
                                    {[0, 25, 50, 75, 100].map(t => <span key={t} style={{ position: 'absolute', left: t + '%', transform: t === 0 ? 'none' : t === 100 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{t}</span>)}
                                </div>
                                <span />
                            </div>
                            {roundTape.map(t => {
                                const tint = t.state !== 'solid' ? 'rgba(255,255,255,0.02)' : (t.gap >= 0 ? 'linear-gradient(90deg,rgba(46,204,113,0.10),transparent)' : 'rgba(240,165,0,0.10)');
                                const gapColor = t.state !== 'solid' ? 'rgba(189,184,173,0.45)' : (t.gap >= 0 ? 'var(--good)' : 'var(--warn)');
                                return (
                                <div key={t.rd} style={{ display: 'grid', gridTemplateColumns: _phone ? '44px 28px minmax(0,1fr) 78px' : '52px 34px minmax(0,1fr) 132px', alignItems: 'center', gap: _phone ? '7px' : '10px', minHeight: '34px', borderRadius: 'var(--card-radius-sm, 8px)', padding: '4px 8px', borderBottom: '1px solid var(--ov-4,rgba(255,255,255,0.06))', background: tint, opacity: t.state === 'empty' ? 0.5 : 1 }}>
                                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)' }}>R{t.rd}</span>
                                    <span style={{ fontSize: 'var(--text-micro)', color: t.n === 1 ? 'var(--warn)' : 'var(--silver)' }}>{t.n === 0 ? '\u2014' : 'n=' + t.n}</span>
                                    <div style={{ position: 'relative', height: '10px', borderRadius: '99px', background: 'rgba(255,255,255,0.055)', overflow: 'visible' }}>
                                        {t.state === 'solid' && <i style={{ position: 'absolute', left: 0, top: 0, height: '10px', width: t.youPct + '%', background: 'var(--k-4ecdc4,#4ecdc4)', borderRadius: '99px' }} />}
                                        {t.state === 'thin' && <i className="rc-ghost" style={{ position: 'absolute', left: 0, top: 0, height: '10px', width: Math.max(3, t.youPct) + '%', borderRadius: '99px' }} />}
                                        {t.state === 'empty' && <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: 'var(--text-micro)', color: 'var(--silver)', whiteSpace: 'nowrap' }}>NO PICK</span>}
                                        {t.state !== 'empty' && <i style={{ position: 'absolute', left: Math.min(t.youPct, t.elitePct) + '%', width: Math.abs(t.gap) + '%', height: '2px', top: '4px', background: gapColor, borderTop: t.state !== 'solid' ? '1px dashed ' + gapColor : 'none' }} />}
                                        <i style={{ position: 'absolute', left: t.elitePct + '%', top: '-3px', width: '2px', height: '16px', background: 'var(--gold)' }} />
                                        <i style={{ position: 'absolute', left: t.leaguePct + '%', top: '-1px', width: '1px', height: '12px', background: 'rgba(189,184,173,0.55)' }} />
                                    </div>
                                    <div style={{ textAlign: 'right', fontFamily: 'Rajdhani, sans-serif', fontSize: '0.85rem' }}>
                                        <b style={{ color: t.state === 'empty' ? 'var(--silver)' : 'var(--k-4ecdc4,#4ecdc4)' }}>{t.state === 'empty' ? '\u2014' : t.youPct + '%'}</b>
                                        <span style={{ color: 'var(--silver)', opacity: 0.45 }}> / </span>
                                        <b style={{ color: 'var(--gold)' }}>{t.elitePct}%</b>
                                        <em style={{ display: 'block', fontStyle: 'normal', fontSize: 'var(--text-micro)', color: gapColor, opacity: t.state === 'solid' ? 1 : 0.5 }}>{t.state === 'empty' ? '\u00A0' : signedNum(t.gap, ' pts')}</em>
                                    </div>
                                </div>
                                );
                            })}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 16px', background: 'rgba(212,175,55,0.06)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--card-radius-sm)', padding: '10px 12px', marginTop: '12px' }}>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--white)', lineHeight: 1.45, flex: '1 1 320px' }}>{rcHeadline}</span>
                                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-micro)', color: 'var(--silver)', whiteSpace: 'nowrap' }}>VALUE vs SLOT {reachIndex == null ? '\u2014' : signedNum(reachIndex, ' pts')}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '10px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>
                                <span><i style={{ display: 'inline-block', width: '11px', height: '11px', background: 'var(--k-4ecdc4,#4ecdc4)', borderRadius: '2px', marginRight: '5px', verticalAlign: 'middle' }} />You</span>
                                <span><i style={{ display: 'inline-block', width: '2px', height: '12px', background: 'var(--gold)', marginRight: '6px', verticalAlign: 'middle' }} />Champion standard</span>
                                <span><i style={{ display: 'inline-block', width: '1px', height: '12px', background: 'rgba(189,184,173,0.7)', marginRight: '7px', verticalAlign: 'middle' }} />League field</span>
                                <span><i className="rc-ghost" style={{ display: 'inline-block', width: '15px', height: '10px', borderRadius: '2px', marginRight: '5px', verticalAlign: 'middle' }} />n&lt;2 &middot; directional</span>
                            </div>
                        </div>
                    </div>

                    {/* \u2550\u2550\u2550 WINNER FORMULA \u2014 Champion DNA Strip with Pick-Drops (full width) \u2550\u2550\u2550 */}
                    <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                        <div className="analytics-lab-card">
                            <span>Winner Formula</span>
                            <strong>What Champions Draft, Round by Round</strong>
                            {/* Template Lean callout removed (owner ask) — the per-round
                                bars below already carry the champion recipe. */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', marginBottom: '14px', fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>
                                {['RB', 'WR', 'QB', 'TE', 'DL', 'LB', 'DB', 'K'].map(p => <span key={p}><i style={{ display: 'inline-block', width: '10px', height: '10px', background: POS_COLOR[p], borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }} />{posLabel(p)}</span>)}
                                <span><i style={{ display: 'inline-block', width: '10px', height: '10px', background: 'var(--k-4ecdc4,#4ecdc4)', borderRadius: '50%', marginRight: '4px', verticalAlign: 'middle' }} />You (&times; = picks)</span>
                            </div>
                            {rounds.map(rd => {
                                const wEntries = Object.entries(dr.winnerDraftProfile[rd] || {}).sort((a, b) => b[1] - a[1]);
                                const wRdCount = draftOutcomes.filter(dp => dp.round === rd && winnerIds.has(dp.roster_id)).length;
                                const myRdCount = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid).length;
                                let run = 0; const center = {};
                                wEntries.forEach(([pos, pct]) => { center[pos] = (run + pct / 2) * 100; run += pct; });
                                const myEntries = Object.entries(myDraftProfile[rd] || {}).sort((a, b) => b[1] - a[1]);
                                return (
                                <div key={rd} style={{ display: 'grid', gridTemplateColumns: '74px minmax(0,1fr)', gap: '10px', marginBottom: '14px' }}>
                                    <div>
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', color: 'var(--gold)' }}>Round {rd}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>champ n={wRdCount}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>{myRdCount ? 'you n=' + myRdCount : 'you: \u2014'}</div>
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', height: '26px', borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden', opacity: myRdCount ? 1 : 0.55 }}>
                                            {wEntries.map(([pos, pct]) => (
                                                <span key={pos} title={posLabel(pos) + ' ' + pctFmt(pct)} style={{ width: (pct * 100) + '%', background: POS_COLOR[pos] || POS_COLOR.UNK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-micro)', color: '#0c0c0f', overflow: 'hidden', whiteSpace: 'nowrap' }}>{pct >= 0.12 ? posLabel(pos) + ' ' + pctFmt(pct) : ''}</span>
                                            ))}
                                        </div>
                                        <div style={{ position: 'relative', height: myRdCount ? '22px' : '16px', marginTop: '4px' }}>
                                            {myRdCount === 0 ? (
                                                <span style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.5 }}>you: no pick</span>
                                            ) : myEntries.map(([pos, share], idx) => {
                                                const champShare = (dr.winnerDraftProfile[rd] || {})[pos] || 0;
                                                const onScript = champShare >= onScriptCut;
                                                const cnt = Math.max(1, Math.round(share * myRdCount));
                                                const offBoard = !(pos in center);
                                                const left = offBoard ? 99 : center[pos];
                                                const mc = onScript ? 'var(--good)' : 'var(--warn)';
                                                return (
                                                <span key={pos + idx} style={{ position: 'absolute', left: left + '%', transform: 'translateX(-50%)', top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', color: mc, fontSize: 'var(--text-micro)', whiteSpace: 'nowrap' }}>
                                                    <i style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '6px solid ' + mc, opacity: myRdCount < 2 ? 0.85 : 1 }} />
                                                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{posLabel(pos)} &times;{cnt}{offBoard ? ' (champs 0%)' : ''}</span>
                                                </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                            <div style={{ background: 'rgba(212,175,55,0.06)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--card-radius-sm)', padding: '10px 12px', marginTop: '6px' }}>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--white)', lineHeight: 1.45 }}>{wfHeadline}</span>
                            </div>
                        </div>
                    </div>
                    </React.Fragment>
                ) : (
                    <div className="analytics-lab-grid">
                        <div className="analytics-lab-card">
                            <span>Pick Capital</span>
                            <strong>Draft Board Without Outcome History</strong>
                            <p>This league has no per-pick outcome rows loaded yet, so the read uses slot value and your current pick inventory rather than hit-rate history.</p>
                            <AnalyticsDataStack rows={historicalRows} />
                            {!movedPickCount && <p style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.6, marginTop: '6px' }}>Fixed-slot league: no historical pick trades, so trade-up modeling is disabled.</p>}
                        </div>
                        <div className="analytics-lab-card">
                            <span>Build Map</span>
                            <strong>How To Use The Current Draft Board</strong>
                            <AnalyticsDataStack rows={buildRows} />
                        </div>
                    </div>
                )}
            </React.Fragment>
            );
        })()}

        {/* ═══ ROUND-BY-ROUND POSITION MIX (multi-season Sleeper history) ═══
            Independent of the d.draft-backed panels above (own fetch, own cache —
            see buildDraftPosMix at module scope), so it renders whenever the
            league's Sleeper history reaches at least one completed draft, even
            if the local per-user hit-rate math above has nothing to show yet. */}
        {analyticsViewTab === 'draft' && (() => {
            if (draftPosMix.status === 'empty') return null;
            if (draftPosMix.status === 'loading') {
                return (
                    <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                        <div className="analytics-lab-card">
                            <span>Draft DNA</span>
                            <strong>Round-by-Round Position Mix</strong>
                            <p style={{ color: 'var(--silver)', opacity: 0.6 }}>Loading this league's Sleeper draft history…</p>
                        </div>
                    </div>
                );
            }
            const mix = draftPosMix.data;
            const roundNums = Object.keys(mix?.roundTotals || {}).map(Number).sort((a, b) => a - b);
            if (!mix || !roundNums.length) return null;
            const seasonCount = mix.seasons.length;
            const seasonSpan = seasonCount > 1 ? (mix.seasons[seasonCount - 1] + '–' + mix.seasons[0]) : String(mix.seasons[0]);
            return (
                <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="analytics-lab-card">
                        <span>Draft DNA</span>
                        <strong>Round-by-Round Position Mix</strong>
                        <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.75, marginTop: '-4px', marginBottom: '12px', lineHeight: 1.5 }}>
                            What every team drafted at each position, round by round, pooled across every season this league's Sleeper history reaches — <b style={{ color: 'var(--gold)' }}>{seasonCount} season{seasonCount === 1 ? '' : 's'}</b> ({seasonSpan}).
                        </p>
                        {roundNums.map(rd => {
                            const total = mix.roundTotals[rd] || 0;
                            const entries = Object.entries(mix.roundCounts[rd] || {}).sort((a, b) => b[1] - a[1]);
                            return (
                                <div key={rd} style={{ display: 'grid', gridTemplateColumns: _phone ? '54px minmax(0,1fr)' : '74px minmax(0,1fr)', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                                    <div>
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', color: 'var(--gold)' }}>R{rd}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>n={total}</div>
                                    </div>
                                    <div style={{ display: 'flex', height: '24px', borderRadius: 'var(--card-radius-sm, 8px)', overflow: 'hidden' }}>
                                        {entries.map(([pos, cnt]) => {
                                            const pct = total ? cnt / total : 0;
                                            return (
                                                <span
                                                    key={pos}
                                                    title={posLabel(pos) + ' ' + pctFmt(pct) + ' (' + cnt + ' picks)'}
                                                    style={{ width: (pct * 100) + '%', background: POS_COLOR[pos] || POS_COLOR.UNK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-micro)', color: '#0c0c0f', overflow: 'hidden', whiteSpace: 'nowrap' }}
                                                >
                                                    {pct >= 0.1 ? posLabel(pos) + ' ' + pctFmt(pct) : ''}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', marginTop: '10px', fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>
                            {Object.keys(POS_COLOR).filter(p => p !== 'UNK').map(p => (
                                <span key={p}><i style={{ display: 'inline-block', width: '10px', height: '10px', background: POS_COLOR[p], borderRadius: '2px', marginRight: '4px', verticalAlign: 'middle' }} />{posLabel(p)}</span>
                            ))}
                        </div>
                    </div>
                </div>
            );
        })()}

        {/* ═══ MARKET MOVES INTELLIGENCE ═══ */}
        {analyticsViewTab === 'trades' && (() => {
            const tr = d.trades;
            if (!tr) return <div style={{ color: 'var(--silver)' }}>No trade data available.</div>;
            const wa = d.waivers || {};
            const wp = tr.winnerTradeProfile;
            const lp = tr.leagueTradeProfile;
            const mp = tr.myTradeProfile;
            const cleanPreference = (v) => (!v || v === 'Unknown') ? 'No pattern' : v;
            const waiverBudget = Number(currentLeague?.settings?.waiver_budget || 0);
            const waiverUsed = Number(myRoster?.settings?.waiver_budget_used || 0);
            const faabRemaining = waiverBudget > 0 ? Math.max(0, waiverBudget - waiverUsed) : null;
            const faabEfficiency = wa.faabEfficiency || {};
            const hasFaabEfficiency = Number.isFinite(Number(faabEfficiency.winners)) || Number.isFinite(Number(faabEfficiency.league));
            const topPosBought = (prof) => {
                const entries = Object.entries(prof.positionsBought || {}).sort((a, b) => b[1] - a[1]);
                return entries.slice(0, 3).map(([p]) => p).join(', ') || '\u2014';
            };
            // Winner-benchmark provenance + graded win-rate + FAAB bargain/runway (this tab benchmarks you vs wp.*).
            const winnerN = d.winnerCount != null ? d.winnerCount : (d.winners || []).length;
            const benchSource = d.winnerSource || d.source || 'standings';
            const benchHigh = benchSource === 'brackets' && winnerN >= 3;
            const benchConfColor = benchHigh ? goodColor : warnColor;
            const mySampleN = (tr.myLast5 || []).length;
            const winnerTradeN = wp.totalTrades || 0;
            const myGraded = (mp.tradesWon || 0) + (mp.tradesLost || 0) + (mp.tradesFair || 0);
            const myWinRate = myGraded > 0 ? Math.round((mp.tradesWon || 0) / myGraded * 100) : null;
            const wGraded = (wp.tradesWon || 0) + (wp.tradesLost || 0) + (wp.tradesFair || 0);
            const wWinRate = wGraded > 0 ? Math.round((wp.tradesWon || 0) / wGraded * 100) : null;
            const weeksElapsed = Number(currentLeague?.settings?.leg || currentLeague?.settings?.last_scored_leg || 0);
            const faabPct = (waiverBudget > 0 && faabRemaining != null) ? Math.round(faabRemaining / waiverBudget * 100) : null;
            // Weekly burn is only meaningful after a few scoring weeks. Dividing a full offseason /
            // early-season spend by leg=1 wildly overstates the pace and fakes a tiny runway — require
            // >= 4 elapsed weeks before extrapolating; otherwise just report budget remaining + %.
            const MIN_PACE_WEEKS = 4;
            const burnPerWeek = (weeksElapsed >= MIN_PACE_WEEKS && waiverUsed > 0) ? waiverUsed / weeksElapsed : null;
            const runwayWeeks = (burnPerWeek && burnPerWeek > 0 && faabRemaining != null) ? Math.floor(faabRemaining / burnPerWeek) : null;

            const alerts = [];
            if (mySampleN >= 2 && mp.avgTradesPerSeason < lp.avgTradesPerSeason) alerts.push({ sev: 'medium', title: 'Low Trade Volume', msg: 'You trade below league average (' + mp.avgTradesPerSeason + ' vs ' + lp.avgTradesPerSeason + ' per season). Elite tier teams average ' + wp.avgTradesPerSeason + '.' });
            if (mySampleN >= 2 && mp.avgValueGained < 0) alerts.push({ sev: 'high', title: 'Losing Value', msg: 'You\'re losing ' + Math.abs(mp.avgValueGained) + ' DHQ per trade on average. Elite tier teams gain +' + wp.avgValueGained + '.' });
            if (winnerTradeN >= 2 && wp.partnerPreference && wp.partnerPreference !== 'Unknown' && wp.partnerPreference !== mp.partnerPreference) alerts.push({ sev: 'low', title: 'Trade Partner Strategy', msg: 'Title teams most often trade against ' + cleanPreference(wp.partnerPreference) + '-type owners; you favor ' + cleanPreference(mp.partnerPreference) + '-type owners.' });

            // (Removed dead boughtBar* bar-chart items — Trade Flow now renders the net
            //  Buy/Sell posture via allFlowPos/tradeFlowRows; the old buy-only bars were unused.)

            // KPI card style
            const tKpiCardStyle = {
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                borderRadius: 'var(--card-radius-lg, 14px)',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const tKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const tKpiLabel = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

            const valueDeltaColor = mp.avgValueGained >= 0 ? goodColor : badColor;
            const marketProofItems = [
                { label: 'Trade Frequency Edge', value: signedNum(Number((mp.avgTradesPerSeason - wp.avgTradesPerSeason).toFixed(1))), detail: 'Your trades/season vs elite-tier behavior' + ((window.App?.LI?.leagueYears || []).length ? '.' : ' (season count assumed; league history thin).'), tone: toneFromDelta(mp.avgTradesPerSeason - wp.avgTradesPerSeason), color: mp.avgTradesPerSeason >= wp.avgTradesPerSeason ? goodColor : warnColor },
                { label: 'Value Per Deal', value: signedNum(mp.avgValueGained, ' DHQ'), detail: 'Average DHQ gained/lost in completed trades.', tone: toneFromDelta(mp.avgValueGained), color: valueDeltaColor },
                { label: 'Trade Win Rate', value: myWinRate == null ? '\u2014' : myWinRate + '%', detail: myWinRate == null ? 'No graded trades yet.' : (mp.tradesWon || 0) + 'W / ' + (mp.tradesFair || 0) + 'F / ' + (mp.tradesLost || 0) + 'L vs elite ' + (wWinRate == null ? 'n/a' : wWinRate + '%') + '.', tone: myWinRate == null ? 'warn' : ((wWinRate != null && myWinRate >= wWinRate) || myWinRate >= 50) ? 'good' : 'warn', color: myWinRate == null ? 'var(--silver)' : (myWinRate >= (wWinRate || 50)) ? goodColor : warnColor },
            ];
            // Net Buy/Sell Posture: positionsSold is already returned by the engine but was unused here.
            const allFlowPos = [...new Set([...Object.keys(wp.positionsBought||{}), ...Object.keys(mp.positionsBought||{}), ...Object.keys(wp.positionsSold||{}), ...Object.keys(mp.positionsSold||{})])].filter(p => p !== 'UNK').sort();
            const tradeFlowRows = allFlowPos.map(pos => ({
                label: posLabel(pos),
                yours: ((mp.positionsBought||{})[pos]||0) - ((mp.positionsSold||{})[pos]||0),
                benchmark: ((wp.positionsBought||{})[pos]||0) - ((wp.positionsSold||{})[pos]||0),
                suffix: '',
                format: v => signedNum(Math.round(v)),
                color: 'var(--k-7c6bf8, #7c6bf8)',
            }));

            // ── Trade Strategy Summary ──
            const tradeVolDiff = mp.avgTradesPerSeason - wp.avgTradesPerSeason;
            const hasTraded = mp.avgTradesPerSeason > 0;
            const tradeEfficiency = !hasTraded ? '' : mp.avgValueGained >= 0 ? 'trading efficiently' : 'over-paying in trades';
            const tradeActivity = !hasTraded ? '' : tradeVolDiff < -1 ? 'under-trading' : tradeVolDiff > 1 ? 'over-trading' : 'trading at the right frequency';

            const tradeSummaryText = !hasTraded
                ? 'You haven\u2019t made any trades yet. Active trading is a key trait of winning teams \u2014 elite tier teams average ' + wp.avgTradesPerSeason + ' trades/season and ' + (wp.avgValueGained >= 0 ? 'gain +' : 'lose ') + Math.abs(wp.avgValueGained) + ' DHQ per trade. Consider using the trade finder to identify value opportunities.'
                : 'You average ' + mp.avgTradesPerSeason + ' trades/season vs elite tier teams\' ' + wp.avgTradesPerSeason + '. You ' + (mp.avgValueGained >= 0 ? 'gain +' : 'lose ') + Math.abs(mp.avgValueGained) + ' DHQ per trade (elite tier: ' + signedNum(wp.avgValueGained) + '). You are ' + tradeActivity + ' and ' + tradeEfficiency + '. ' + (mp.avgValueGained < 0 ? 'Focus on extracting value \u2014 target aging stars from contenders or sell depreciating assets.' : 'Keep leveraging your trade edge to consolidate elite talent.');
            const assetListText = (items, picks) => {
                const clean = (items || []).filter(x => x && x !== 'Unknown');
                const parts = clean.slice();
                const np = Number(picks || 0);
                if (np > 0) parts.push(np + (np === 1 ? ' rookie pick' : ' rookie picks'));
                return parts.length ? parts.join(', ') : 'assets';
            };
            // ── Market Clock: trade-timing distribution + auto verdict ──
            const wTiming = wa.winnerTiming || {}; const lTiming = wa.leagueTiming || {};
            const wEarlyPct = Math.round((wTiming.early || 0) * 100);
            const lEarlyPct = Math.round((lTiming.early || 0) * 100);
            const clockGap = wEarlyPct - lEarlyPct;
            const clockHasData = (wTiming.early || wTiming.mid || wTiming.late || lTiming.early) > 0;
            const clockVerdict = !clockHasData
                ? 'Not enough trade-timing history to call a window yet.'
                : Math.abs(clockGap) <= 6
                    ? 'Timing isn’t the edge here — title teams trade early (' + wEarlyPct + '%) at the same rate as the field. What separates winners is deal quality, not when they strike.'
                    : clockGap > 6
                        ? 'Champions strike earlier — ' + wEarlyPct + '% of their value-trades land in the early window vs ' + lEarlyPct + '% leaguewide. Be ready to move before the market resets.'
                        : 'Champions are patient — they do ' + (100 - wEarlyPct) + '% of their trading mid/late vs the field’s ' + (100 - lEarlyPct) + '%. Let value come to you.';
            const myEarlyTrades = (tr.myLast5 || []).filter(t => Number(t.week || 99) <= 6).length;
            const myTradeWindow = !(tr.myLast5 || []).length ? null : myEarlyTrades >= Math.ceil((tr.myLast5 || []).length / 2) ? 'early' : 'mid/late';

            // Free floor: raw trade/waiver numbers. The market reads (thesis,
            // trade-pattern read, clock verdict, alert cards) are Pro (row 9
            // "trades market reads").
            return (
            <React.Fragment>
                {!isPro && <ProLock label="Market Reads" sub="The market-mispricing thesis and trade-pattern read are Pro. Raw trade and waiver numbers stay below." />}
                {isPro && <AnalyticsCommandPanel
                    title="Where is the league market mispricing value?"
                />}

                <AnalyticsProofGrid items={marketProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Waiver Economy</span>
                        <strong>Position Price Map</strong>
                        <div className="analytics-mini-table">
                            {Object.entries(wa.leagueFaabProfile || {}).sort((a, b) => (b[1].avg || 0) - (a[1].avg || 0)).map(([pos, info]) => (
                                <div key={pos}><strong>{posLabel(pos)}</strong><span>${Math.round(info.avg || 0)} avg</span><em>{info.count || 0} bids</em></div>
                            ))}
                            {!Object.keys(wa.leagueFaabProfile || {}).length && <div><strong>No FAAB history</strong><span>Use Free Agency recommendations until transactions load.</span></div>}
                        </div>
                    </div>
                    <div className="analytics-lab-card">
                        <span>Market Clock</span>
                        <strong>When Winners Trade</strong>
                        {[
                            { label: 'Champions', t: wTiming, gold: true },
                            { label: 'League field', t: lTiming, gold: false },
                        ].map(row => {
                            const segs = [['Early', row.t.early || 0, 'var(--gold)'], ['Mid', row.t.mid || 0, 'rgba(212,175,55,0.5)'], ['Late', row.t.late || 0, 'rgba(212,175,55,0.22)']];
                            return (
                            <div key={row.label} style={{ marginBottom: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 'var(--text-micro)', marginBottom: '3px' }}>
                                    <span style={{ color: row.gold ? 'var(--gold)' : 'var(--silver)', fontWeight: 700, letterSpacing: '0.04em' }}>{row.label}</span>
                                    <span style={{ color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' }}>{'E ' + pctFmt(row.t.early || 0) + ' · M ' + pctFmt(row.t.mid || 0) + ' · L ' + pctFmt(row.t.late || 0)}</span>
                                </div>
                                <div style={{ display: 'flex', height: '16px', borderRadius: 'var(--card-radius-xs, 5px)', overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
                                    {segs.map(([sl, v, bg]) => v > 0 ? (
                                        <span key={sl} title={sl + ' ' + pctFmt(v)} style={{ width: (v * 100) + '%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro)', color: '#0c0c0f', overflow: 'hidden', whiteSpace: 'nowrap' }}>{v >= 0.12 ? sl : ''}</span>
                                    ) : null)}
                                </div>
                            </div>
                            );
                        })}
                        {myTradeWindow && <p style={{ fontSize: 'var(--text-micro)', color: 'var(--k-4ecdc4,#4ecdc4)', margin: '2px 0 9px' }}>You: {myEarlyTrades} of your last {(tr.myLast5 || []).length} deals landed in the early window.</p>}
                        {/* Timing bars above are raw data; the verdict line is a Pro market read. */}
                        {isPro && <div style={{ background: 'rgba(212,175,55,0.06)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--card-radius-sm)', padding: '9px 11px' }}>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--white)', lineHeight: 1.45 }}>{clockVerdict}</span>
                        </div>}
                    </div>
                </div>

                <div className="analytics-lab-grid" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="analytics-lab-card">
                        <span>Trade Flow</span>
                        <strong>Net Buy/Sell Posture by Position</strong>
                        {tradeFlowRows.length ? <AnalyticsDeltaRows rows={tradeFlowRows} benchmarkLabel="Elite" /> : <div className="analytics-proof-card"><strong>No position trade flow yet</strong><em>Completed trade data has not yielded position movement.</em></div>}
                    </div>
                </div>

                {/* ── YOUR LAST 5 TRADES ── */}
                {tr.myLast5 && tr.myLast5.length > 0 && (
                <AnalyticsReadout title="Your Recent Trade Performance" detail={'Best & worst all-time' + ((tr.myLast5 || []).length ? ' · last ' + Math.min(5, tr.myLast5.length) + ' deals' : '')}>
                        {(tr.myBiggestWin || tr.myBiggestLoss) && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                                {[{ deal: tr.myBiggestWin, kicker: 'Best Deal', color: goodColor }, { deal: tr.myBiggestLoss, kicker: 'Worst Deal', color: badColor }].filter(x => x.deal).map((x, i) => {
                                    const d = x.deal; const net = d.netDhq != null ? d.netDhq : d.net;
                                    return (
                                    <div key={i} style={{ border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderLeft: '3px solid ' + x.color, borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{ fontSize: 'var(--text-micro)', color: x.color, textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 800 }}>{x.kicker}</span>
                                            <span style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)' }}>S{d.season || '?'}{d.fairness != null ? ' · fairness ' + Math.round(d.fairness) : ''}</span>
                                        </div>
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.5rem', color: x.color, lineHeight: 1.1, margin: '1px 0 6px' }}>{signedNum(net, ' DHQ')}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', lineHeight: 1.55 }}>
                                            <div><span style={{ color: 'var(--k-4ecdc4,#4ecdc4)', fontWeight: 700 }}>Got</span> {assetListText(d.got, d.gotPicks)} <span style={{ opacity: 0.55 }}>({Math.round(d.myVal || 0).toLocaleString()})</span></div>
                                            <div><span style={{ color: 'var(--gold)', fontWeight: 700 }}>Gave</span> {assetListText(d.gave, d.gavePicks)} <span style={{ opacity: 0.55 }}>({Math.round(d.theirVal || 0).toLocaleString()})</span></div>
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                        {(tr.myLast5 || []).length > 0 && <div style={{ fontSize: 'var(--text-micro)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 800, margin: '2px 0 4px' }}>Recent Deals</div>}
                        {tr.myLast5.map((trade, i) => {
                            const netDhq = Number.isFinite(Number(trade.netDhq)) ? Number(trade.netDhq) : Number(trade.net || 0);
                            const grade = trade.result || (netDhq > 200 ? 'won' : netDhq < -200 ? 'lost' : 'fair');
                            const result = grade === 'won' ? 'Won' : grade === 'lost' ? 'Lost' : 'Fair';
                            const resultColor = result === 'Won' ? goodColor : result === 'Lost' ? badColor : warnColor;
                            return (
                                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)' }}>S{trade.season || '?'} W{trade.week || '?'}</span>
                                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', padding: '2px 8px', borderRadius: 'var(--card-radius, 10px)', background: wrAlpha(resultColor, '22'), color: resultColor, border: '1px solid ' + wrAlpha(resultColor, '44'), fontWeight: 700 }}>{result}</span>
                                    </div>
                                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', fontFamily: 'var(--font-body)' }}>
                                        {assetListText(trade.gave, trade.gavePicks)} <span style={{ color: 'var(--gold)', margin: '0 4px' }}>{'\u2192'}</span> {assetListText(trade.got, trade.gotPicks)}
                                    </div>
                                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: 'var(--text-micro)', color: 'var(--silver)', marginTop: '4px' }}>
                                        <span style={{ color: netDhq >= 0 ? goodColor : badColor, fontWeight: 700 }}>{signedNum(netDhq, ' DHQ')}</span>
                                        <span>Got {Math.round(trade.myVal || 0).toLocaleString()}</span>
                                        <span>Gave {Math.round(trade.theirVal || 0).toLocaleString()}</span>
                                        {Number.isFinite(Number(trade.fairness)) && <span>Fairness {Math.round(trade.fairness)}/100</span>}
                                    </div>
                                </div>
                            );
                        })}
                </AnalyticsReadout>
                )}

                {/* ── BIGGEST WIN / LOSS (all-time, most lopsided) ── */}

                {/* ── INSIGHT CARDS ROW ── */}
                {/* Behavioral warnings with directives ("run offers through the analyzer") — Pro reads. */}
                {isPro && alerts.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    {alerts.map((a, i) => (
                        <div key={i} style={{
                            background: 'var(--surf-solid, rgba(26,26,26,0.8))', borderRadius: 'var(--card-radius)', padding: '14px 16px',
                            borderLeft: '4px solid ' + sevColor(a.sev),
                            border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: sevColor(a.sev), marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {a.title}
                            </div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>{a.msg}</div>
                        </div>
                    ))}
                </div>
                )}
            </React.Fragment>
            );
        })()}


        {/* Phase 8: All Players / Draft Picks / Custom Reports — ex-League Map sub-views
            rendered inline via LeagueMapTab's embed mode. Local state lives in AnalyticsPanel
            so sort/filter/search persist as the user moves between sub-tabs. */}
        {(analyticsViewTab === 'assets' || analyticsViewTab === 'reports') && React.createElement(window.AnalyticsLeagueEmbed || (() => null), {
            analyticsTab: analyticsViewTab, standings, currentLeague, playersData, statsData, sleeperUserId,
            myRoster, leagueSkin: resolvedLeagueSkin, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName,
        })}

        </React.Fragment>
        )}
    </div>
    );
}
