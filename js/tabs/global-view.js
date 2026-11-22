// js/tabs/global-view.js - Empire portfolio command center
// Cross-league asset allocation, exposure, age-window, pick capital, and drilldown workspaces.

// Empire rail nav icons — same hand-flattened Lucide-path convention as
// league-detail.js's NAV_ICON_PATHS (no icon library is installed in this
// app; this is the established dependency-free pattern). Four of these reuse
// the exact paths already proven there (home/zap/briefcase/target) rather
// than re-deriving new ones for concepts that already have a tested icon.
const EMPIRE_ICON_PATHS = {
    // house — league-detail.js NAV_ICON_PATHS.home
    home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
    // zap — league-detail.js NAV_ICON_PATHS.gameday
    zap: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
    // briefcase — league-detail.js NAV_ICON_PATHS.office
    briefcase: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
    // target — league-detail.js NAV_ICON_PATHS.strategy
    target: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'],
    // layers — stacked leagues
    layers: ['m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z', 'm22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'],
    // trending-up — the asset floor/market
    trendingUp: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'],
    // bar-chart-2 — a computed index/score
    barChart: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
    // alert-triangle — risk/warning
    alertTriangle: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
    // map (folded map)
    map: ['M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4Z', 'M8 2v16', 'M16 6v16'],
    // search — scouting
    search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
    // trophy — season outlook (playoff/title odds)
    trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0z'],
    // repeat — league-detail.js NAV_ICON_PATHS.trade, reused for the same concept
    trade: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
};

// Empire-scoped "which leagues count toward my totals" toggle — same
// opt-out-map pattern + never-return-empty safety rule as Commissioner
// Office's commish-prefs.js (isManaged/setManaged), but that module is
// hardcoded to its own commish_prefs_v1 key/namespace and bundled with
// commish-only fields (domainsOff, items, etc.) — not reusable as-is, so
// this is a small independent equivalent scoped to Empire's own key.
const EMPIRE_PREFS_KEY = 'dhq_empire_league_prefs_v1';
function readEmpirePrefs() {
    try { return JSON.parse(localStorage.getItem(EMPIRE_PREFS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function isEmpireLeagueOn(leagueId, prefs) {
    return !((prefs && prefs.off) || {})[String(leagueId)];
}
function setEmpireLeagueOn(leagueId, on) {
    const p = readEmpirePrefs();
    p.off = p.off || {};
    const k = String(leagueId);
    if (on) delete p.off[k]; else p.off[k] = 1;
    localStorage.setItem(EMPIRE_PREFS_KEY, JSON.stringify(p));
    return p;
}

// Use the same capability check for suggested entry points, the league picker,
// and direct/stale Trade Desk state. Market prices can include non-trading
// leagues; a valuation spread is not permission to construct a trade there.
function canOpenEmpireTradeDesk(province) {
    if (!province || province.preDraftEmpty || province.isChopped || province.canTrade === false) return false;
    const league = province.league || {};
    const type = String(league.type || league.league_type || '').toLowerCase();
    return Number(league.settings?.type) !== 3 && type !== 'chopped'
        && Number(league.settings?.disable_trades || 0) !== 1;
}

// Tier → color. Module-level and shared: this used to be nested inside
// buildEmpirePortfolioModel while buildThreatBoard kept its own private
// `tierTone` with a DIFFERENT mapping, so the same league's tier rendered
// one color on the Threat Board and another everywhere else in Empire —
// and the two top tiers were effectively swapped (ELITE gold / CONTENDER
// green there, vs ELITE green / CONTENDER blue here).
function tierColor(tier) {
    if (tier === 'ELITE') return 'var(--k-2ecc71, #2ecc71)';
    if (tier === 'CONTENDER') return 'var(--k-3498db, #3498db)';
    if (tier === 'CROSSROADS') return 'var(--k-f0a500, #f0a500)';
    if (tier === 'REBUILDING') return 'var(--k-e74c3c, #e74c3c)';
    return 'var(--ov-9, rgba(255,255,255,0.46))';
}

function empireLeagueFormat(league) {
    const normalize = value => window.App?.LeagueSkin?.normalizeType?.(value)
        || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' }[String(value)] || String(value ?? '').trim().toLowerCase());
    const override = normalize(window.App?.Intelligence?.getLeagueTypeOverride?.(league));
    const raw = [league?.type, league?.league_type, league?.settings?.type, league?.metadata?.type, league?.metadata?.league_type]
        .find(value => value !== undefined && value !== null && value !== '');
    const explicit = override || normalize(raw);
    if (explicit) return explicit;
    return Number(league?.settings?.max_keepers || league?.settings?.keeper_count || league?.metadata?.keeper_count || 0) > 0 ? 'keeper' : 'unknown';
}

async function fetchEmpireSeasonValuations(options = {}) {
    const season = String(options.season || '');
    const read = fn => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Season data timed out')), options.timeoutMs || 12000);
        Promise.resolve().then(fn).then(resolve, reject).finally(() => clearTimeout(timer));
    });
    try {
        if (!/^\d{4}$/.test(season)) throw new Error('Current season is unavailable');
        const [proj, prior, stats] = await Promise.all([
            read(() => options.fetchProjections(season)),
            read(() => options.fetchStats(String(Number(season) - 1))).catch(() => ({})),
            read(() => options.fetchStats(season)).catch(() => ({})),
        ]);
        if (options.isCurrent?.() === false) return null;
        const fields = ['pass_att', 'pass_yd', 'pass_td', 'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'pts_ppr', 'pts_half_ppr', 'pts_std', 'fga', 'fgm', 'xpm', 'idp_tkl'];
        if (!proj || Array.isArray(proj) || typeof proj !== 'object' || !Object.values(proj).some(row => fields.some(field => Number(row?.[field]) > 0))) {
            throw new Error('Current-season projections are unavailable');
        }
        return { season, week: Math.max(1, Math.min(18, Number(options.week) || 1)), proj, prior: prior || {}, stats: stats || {}, status: 'ready' };
    } catch (error) {
        return options.isCurrent?.() === false ? null : { season, proj: {}, prior: {}, stats: {}, status: 'unavailable', error: error.message };
    }
}

function buildEmpirePortfolioModel(input) {
    input = input || {};
    const allLeagues = input.allLeagues || [];
    const playersData = input.playersData || {};
    const sleeperUserId = input.sleeperUserId;
    const scores = input.scores || {};
    const seasonalBooks = input.seasonalBooks || {};
    const normPos = input.normPos || function(pos) { return pos || '?'; };
    const posLabel = input.posLabel || function(pos) { return pos === 'DEF' ? 'D/ST' : (pos || '?'); };
    const getAgeCurve = input.getAgeCurve || function(pos) {
        const peak = (input.peakWindows || {})[pos] || [24, 29];
        return { build: [22, Math.max(22, peak[0] - 1)], peak, decline: [peak[1] + 1, peak[1] + 3] };
    };
    const tradeValueTier = input.tradeValueTier || function(val) {
        if (val >= 7000) return { tier: 'Elite', col: 'var(--k-2ecc71, #2ecc71)' };
        if (val >= 4000) return { tier: 'Starter', col: 'var(--k-3498db, #3498db)' };
        if (val >= 2000) return { tier: 'Depth', col: 'var(--k-d4af37, #d4af37)' };
        if (val > 0) return { tier: 'Stash', col: 'var(--ov-9, rgba(255,255,255,0.58))' };
        return { tier: 'Unscored', col: 'var(--ov-8, rgba(255,255,255,0.38))' };
    };
    const assessTeam = input.assessTeam;
    const nowYear = parseInt(input.nowYear || new Date().getFullYear(), 10);

    const provinces = [];
    const assets = [];
    const picks = [];
    const positionTotals = {};
    const ageTotals = {};
    const tierTotals = {};
    const strategyTotals = { contender: 0, fringe: 0, rebuild: 0, unknown: 0 };
    let missingPlayerMeta = 0;
    let rosterLeagueCount = 0;
    let pickFeedLeagueCount = 0;
    let assessedLeagueCount = 0;

    function sameId(a, b) {
        return a != null && b != null && String(a) === String(b);
    }
    function leagueId(league) {
        return league?.id || league?.league_id || league?.leagueId || '';
    }
    function statusFromTier(tier) {
        if (tier === 'ELITE' || tier === 'CONTENDER') return 'contender';
        if (tier === 'CROSSROADS') return 'fringe';
        if (tier === 'REBUILDING') return 'rebuild';
        return 'unknown';
    }
    function agePhaseFor(pos, age) {
        if (!age || !Number.isFinite(Number(age))) return { key: 'unknown', label: 'Unknown', color: 'var(--ov-8, rgba(255,255,255,0.38))' };
        const curve = getAgeCurve(pos) || {};
        const peak = curve.peak || [24, 29];
        const decline = curve.decline || [peak[1] + 1, peak[1] + 3];
        if (age < peak[0]) return { key: 'build', label: 'Build', color: 'var(--k-4ecdc4, #4ecdc4)' };
        if (age <= peak[1]) return { key: 'peak', label: 'Peak', color: 'var(--k-2ecc71, #2ecc71)' };
        if (age <= decline[1]) return { key: 'value', label: 'Value', color: 'var(--k-f0a500, #f0a500)' };
        return { key: 'post', label: 'Post-window', color: 'var(--k-e74c3c, #e74c3c)' };
    }
    function addTotal(map, key, patch) {
        const safeKey = key || 'unknown';
        if (!map[safeKey]) map[safeKey] = { key: safeKey, label: patch.label || safeKey, count: 0, dhq: 0, color: patch.color };
        map[safeKey].count += patch.count || 0;
        map[safeKey].dhq += patch.dhq || 0;
        if (patch.color) map[safeKey].color = patch.color;
        if (patch.label) map[safeKey].label = patch.label;
    }
    // League-independent industry pick value (DHQ scale, ~7500 at 1.01), using a mid-round
    // pick — the same getIndustryPickValue model the rest of the app uses for picks (e.g.
    // league-detail/compare). Replaces an arbitrary off-scale ladder so Empire pick capital
    // is DHQ-valued and comparable to player DHQ. Falls back to an industry-anchored ladder.
    function pickValue(round, teams, rounds) {
        const t = teams || 12;
        const r = rounds || 4;
        if (typeof window !== 'undefined' && typeof window.getIndustryPickValue === 'function') {
            return window.getIndustryPickValue((round - 1) * t + Math.ceil(t / 2), t, r);
        }
        return ({ 1: 6200, 2: 3000, 3: 1500, 4: 750, 5: 380 }[round]) || 150;
    }

    allLeagues.forEach(league => {
        const rosters = league?.rosters || [];
        const format = empireLeagueFormat(league);
        const dynasty = format === 'dynasty';
        const seasonal = ['redraft', 'keeper', 'chopped', 'best_ball', 'dfs'].includes(format);
        const book = seasonalBooks[String(leagueId(league))];
        const seasonReady = seasonal && book?.season === String(league.season) && book?.evidence === 'current-season';
        const valueBasis = dynasty ? 'dynasty' : seasonal ? 'seasonal' : 'unknown';
        const valueLabel = dynasty ? 'Dynasty DHQ' : seasonal ? 'Season value' : 'Value unavailable';
        const valueOf = pid => dynasty ? (Number(scores[pid]) > 0 ? Number(scores[pid]) : null)
            : seasonReady && Number.isFinite(book.values?.[pid]) ? book.values[pid] : null;
        if (rosters.length) rosterLeagueCount++;
        const myRoster = rosters.find(r => sameId(r.owner_id, sleeperUserId) || sameId(r.owner_id, league?.myUserId) || sameId(r.roster_id, league?.myRosterId));
        if (!myRoster) return;

        const rosterPlayers = myRoster.players || [];
        // A pre-draft league with an empty roster (a genuine startup, or an
        // existing league between seasons before its next draft) previously
        // fell straight through to status:'unknown'/totalDHQ:0 — visually and
        // programmatically identical to a real data-quality problem (broken
        // sync, failed assessment). Gate on BOTH the league's real Sleeper
        // phase and an empty roster (not roster-emptiness alone), so a
        // genuinely broken/unsynced roster in an active league doesn't get
        // mislabeled as "just pre-draft." Same phase definition league-skin.js
        // already uses elsewhere in this app (phase === 'pre_draft'/'drafting').
        const leaguePhase = league?.status || league?.metadata?.status || '';
        const preDraftEmpty = (leaguePhase === 'pre_draft' || leaguePhase === 'drafting') && rosterPlayers.length === 0;
        // Health/tier must come from the per-league assessment. app.js runs
        // assessAllTeams(league.rosters, …, league, …) with the explicit league object and
        // stashes the result on league.empireAssessments. Prefer that over the single-league
        // window.S global accessor (assessTeam=assessTeamFromGlobal), which in Empire mode
        // reads an unset S.currentLeagueId (so leagueInfo is undefined) and resolves rosters
        // from a cross-league S.rosters array deduped by roster_id — but Sleeper roster_ids
        // are 1..N PER league, so leagues collide and the health score is computed against
        // the wrong roster. Fall back to the global accessor only until assessments load.
        const leagueAssessments = league?.empireAssessments || [];
        let assessment = leagueAssessments.find(a => sameId(a.rosterId, myRoster.roster_id) || sameId(a.ownerId, myRoster.owner_id)) || null;
        if (!assessment && typeof assessTeam === 'function') assessment = assessTeam(myRoster.roster_id, league);
        // The shared assessment still contains dynasty age/value fallbacks.
        // Until an explicitly seasonal assessment exists, do not turn it into
        // a redraft rebuild, keeper-surplus claim, or seasonal health score.
        if (!dynasty) assessment = null;
        if (assessment) assessedLeagueCount++;
        // Nulled for a pre-draft empty roster same as the eliminated-roster
        // case below — there's genuinely nothing to assess yet, not a broken
        // read, and this keeps it out of avgHealth via the same mechanism.
        const healthScore = preDraftEmpty ? null : (assessment?.healthScore ?? null);
        const tier = preDraftEmpty ? 'PRE_DRAFT' : dynasty ? (assessment?.tier || 'UNKNOWN') : seasonal ? 'SEASONAL' : 'UNKNOWN';
        const status = preDraftEmpty ? 'pre_draft' : seasonal ? 'seasonal' : statusFromTier(tier);
        strategyTotals[status] = (strategyTotals[status] || 0) + 1;
        const wins = myRoster.settings?.wins || league?.wins || 0;
        const losses = myRoster.settings?.losses || league?.losses || 0;
        // CHOPPED leagues never accrue a W-L record (no matchups) and an
        // eliminated roster's health score comes from an empty, waivers-
        // released roster — neither means what it means in every other
        // format. Read it once here so every downstream aggregate/display
        // can treat this province honestly instead of quietly averaging in
        // a permanent 0-0 or a garbage health number.
        const Chopped = window.App?.Chopped;
        const isChopped = !!(Chopped && Chopped.isChopped(league));
        const canTrade = !isChopped && Number(league?.settings?.disable_trades || 0) !== 1;
        const isEliminated = isChopped && Chopped.isEliminated(myRoster);
        const chopState = isChopped ? Chopped.state({ league, rosters }) : null;
        const recordLabel = !isChopped ? (wins + '-' + losses)
            : isEliminated ? ('Chopped wk ' + Chopped.eliminatedWeek(myRoster))
            : ((chopState?.aliveCount || 0) + ' of ' + (chopState?.teams || rosters.length) + ' alive');
        const totalDHQ = dynasty ? rosterPlayers.reduce((sum, pid) => sum + (valueOf(pid) || 0), 0) : null;
        const knownValue = rosterPlayers.reduce((sum, pid) => sum + (valueOf(pid) || 0), 0);
        const unvalued = rosterPlayers.filter(pid => valueOf(pid) == null).length;
        const totalValue = unvalued ? null : knownValue;
        const ranksReady = rosters.every(roster => (roster.players || []).every(pid => valueOf(pid) != null));
        const ranked = rosters.slice().sort((a, b) => {
            const av = (a.players || []).reduce((sum, pid) => sum + (valueOf(pid) || 0), 0);
            const bv = (b.players || []).reduce((sum, pid) => sum + (valueOf(pid) || 0), 0);
            return bv - av;
        });
        const powerRank = ranked.findIndex(r => sameId(r.roster_id, myRoster.roster_id)) + 1;
        const draftInventory = league._draftInventory?.season === String(league.season) ? league._draftInventory : null;
        const draftReady = !!draftInventory && league._draftInventoryState === 'ready';
        const province = {
            id: leagueId(league),
            name: league?.name || 'League',
            format,
            league,
            roster: myRoster,
            players: rosterPlayers,
            teams: rosters.length || league?.total_rosters || 0,
            wins,
            losses,
            preDraftEmpty,
            isChopped,
            canTrade,
            isEliminated,
            eliminatedWeek: isEliminated ? Chopped.eliminatedWeek(myRoster) : null,
            aliveCount: chopState?.aliveCount ?? null,
            recordLabel,
            totalDHQ,
            totalValue, knownValue, unvalued, valueBasis, valueLabel,
            avgDHQ: dynasty ? rosterPlayers.length ? Math.round(totalDHQ / rosterPlayers.length) : 0 : null,
            // An eliminated roster's health score is computed off an empty,
            // waivers-released roster — not signal, not even a low signal.
            // Nulling it here (rather than at each of the ~6 display sites)
            // makes every existing `healthScore ?? 'No read'` fallback do
            // the right thing automatically, and keeps it out of avgHealth.
            healthScore: isEliminated ? null : healthScore,
            tier,
            tierColor: tierColor(tier),
            status,
            assessmentReady: !!assessment,
            needs: (assessment?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n.pos || n.label).filter(Boolean),
            strengths: (assessment?.strengths || []).slice(0, 3).map(s => typeof s === 'string' ? s : s.pos || s.label).filter(Boolean),
            powerRank: ranksReady && rosterPlayers.length ? powerRank || null : null,
            pickCount: 0,
            premiumPickCount: 0,
            acquiredPickCount: 0,
            ownPickCount: 0,
            pickScore: format === 'dynasty' ? 0 : null,
            pickFeedPresent: Array.isArray(league?.tradedPicks),
            pickFeedReady: Array.isArray(league?.tradedPicks) && (!league._pickFeedState || league._pickFeedState === 'ready') && draftReady && !league._portfolioStale,
            currentDraftUnknown: !draftInventory,
            draftProgressStale: !!draftInventory && !draftReady,
        };
        provinces.push(province);
        if (province.pickFeedReady) pickFeedLeagueCount++;

        rosterPlayers.forEach(pid => {
            const player = playersData?.[pid];
            if (!player || !(player.full_name || player.first_name || player.last_name)) {
                missingPlayerMeta++;
                return;
            }
            const pos = normPos(player.position) || player.position || '?';
            const age = player.age || null;
            const dhq = dynasty ? scores[pid] || 0 : null;
            const value = valueOf(pid);
            const phase = dynasty ? agePhaseFor(pos, age) : { key: 'seasonal', label: format === 'keeper' ? 'Keeper terms needed' : seasonal ? 'This season' : 'Format unknown', color: 'var(--silver)' };
            const valueTier = (dynasty ? tradeValueTier(dhq) : null) || { tier: seasonal ? 'Seasonal' : 'Unscored', col: 'var(--ov-8, rgba(255,255,255,0.38))' };
            const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ');
            const asset = {
                pid,
                name,
                pos,
                team: player.team || 'FA',
                age,
                dhq,
                value, valueBasis, valueLabel, format,
                tier: valueTier.tier || 'Unscored',
                tierColor: valueTier.col || 'var(--ov-8, rgba(255,255,255,0.38))',
                agePhase: phase.key,
                agePhaseLabel: phase.label,
                agePhaseColor: phase.color,
                leagueId: province.id,
                leagueName: province.name,
                leagueStatus: status,
                leagueTier: tier,
                healthScore,
                powerRank: province.powerRank,
                exposureCount: 1,
                exposurePct: 0,
            };
            assets.push(asset);
            addTotal(positionTotals, pos, { label: posLabel(pos), count: 1, dhq, color: input.posColors?.[pos] });
            if (dynasty) {
                addTotal(ageTotals, phase.key, { label: phase.label, count: 1, dhq, color: phase.color });
                addTotal(tierTotals, asset.tier, { label: asset.tier, count: 1, dhq, color: asset.tierColor });
            }
        });

        // Without verified (or explicitly saved) transfers even original picks
        // may have been traded away. Unknown ownership is not zero transfers.
        if (!province.pickFeedPresent) return;
        const tradedPicks = league.tradedPicks;
        const draftRounds = league?.settings?.draft_rounds || 4;
        const startYear = parseInt(league?.season || nowYear, 10);
        // Match the shared league skin: seasonal formats own only this draft
        // year's board. Keeper future rights remain visible, but imported rights
        // alone cannot price keeper costs/eligibility using a dynasty rookie curve.
        const pickHorizon = format === 'dynasty' || format === 'keeper' ? 3 : 1;
        for (let year = startYear; year < startYear + pickHorizon; year++) {
            if (year === startYear && (!draftInventory || draftInventory.phase === 'complete')) continue;
            const rounds = year === startYear ? draftInventory.rounds : draftRounds;
            for (let round = 1; round <= rounds; round++) {
                const consumed = originalRosterId => year === startYear && draftInventory.consumed.some(pick => Number(pick.round) === Number(round) && sameId(pick.rosterId, originalRosterId));
                const tradedAway = tradedPicks.find(tp =>
                    parseInt(tp.season, 10) === year &&
                    Number(tp.round) === Number(round) &&
                    sameId(tp.roster_id, myRoster.roster_id) &&
                    !sameId(tp.owner_id, myRoster.roster_id)
                );
                if (!tradedAway && !consumed(myRoster.roster_id)) {
                    const own = { leagueId: province.id, leagueName: province.name, format, year, round, own: true, acquired: false, score: format === 'dynasty' ? pickValue(round, province.teams, rounds) : null };
                    picks.push(own);
                    province.pickCount++;
                    province.ownPickCount++;
                    if (own.score != null) province.pickScore += own.score;
                    if (round <= 2) province.premiumPickCount++;
                }
                tradedPicks.filter(tp =>
                    parseInt(tp.season, 10) === year &&
                    Number(tp.round) === Number(round) &&
                    sameId(tp.owner_id, myRoster.roster_id) &&
                    !sameId(tp.roster_id, myRoster.roster_id)
                ).filter(pick => !consumed(pick.roster_id)).forEach(() => {
                    const acquired = { leagueId: province.id, leagueName: province.name, format, year, round, own: false, acquired: true, score: format === 'dynasty' ? pickValue(round, province.teams, rounds) : null };
                    picks.push(acquired);
                    province.pickCount++;
                    province.acquiredPickCount++;
                    if (acquired.score != null) province.pickScore += acquired.score;
                    if (round <= 2) province.premiumPickCount++;
                });
            }
        }
    });

    const ownershipMap = {};
    assets.forEach(asset => {
        if (!ownershipMap[asset.pid]) {
            ownershipMap[asset.pid] = {
                pid: asset.pid,
                name: asset.name,
                pos: asset.pos,
                team: asset.team,
                age: asset.age,
                dhq: asset.dhq,
                tier: asset.tier,
                tierColor: asset.tierColor,
                agePhase: asset.agePhase,
                agePhaseLabel: asset.agePhaseLabel,
                agePhaseColor: asset.agePhaseColor,
                count: 0,
                totalDHQ: 0,
                leagues: [],
            };
        }
        ownershipMap[asset.pid].count++;
        ownershipMap[asset.pid].totalDHQ += asset.dhq;
        ownershipMap[asset.pid].leagues.push({ id: asset.leagueId, name: asset.leagueName, status: asset.leagueStatus, tier: asset.leagueTier, healthScore: asset.healthScore });
    });
    const exposure = Object.values(ownershipMap)
        .map(item => ({
            ...item,
            exposurePct: provinces.length ? Math.round((item.count / provinces.length) * 100) : 0,
            exposureScore: item.count * 1000 + item.totalDHQ,
        }))
        .sort((a, b) => b.count - a.count || b.totalDHQ - a.totalDHQ || a.name.localeCompare(b.name));
    const exposureByPid = {};
    exposure.forEach(item => { exposureByPid[item.pid] = item; });
    assets.forEach(asset => {
        const exp = exposureByPid[asset.pid];
        asset.exposureCount = exp?.count || 1;
        asset.exposurePct = exp?.exposurePct || 0;
    });

    const totalDHQ = assets.reduce((sum, asset) => sum + asset.dhq, 0);
    const dynastyAssets = assets.filter(asset => asset.valueBasis === 'dynasty');
    const scoredAssets = assets.filter(asset => asset.value != null).length;
    const bases = [...new Set(provinces.map(p => p.valueBasis))];
    const valueBasis = bases.length === 1 ? bases[0] : bases.length ? 'mixed' : 'unknown';
    const totalValue = valueBasis !== 'mixed' && valueBasis !== 'unknown' && provinces.every(p => p.totalValue != null)
        ? provinces.reduce((sum, p) => sum + p.totalValue, 0) : null;
    const scoreCount = Object.keys(scores || {}).length;
    const useValueShare = valueBasis === 'dynasty' && totalDHQ > 0;
    function finalizeTotals(map, dynastyOnly = false) {
        const values = dynastyOnly ? totalDHQ > 0 : useValueShare;
        const denominator = dynastyOnly ? dynastyAssets.length : assets.length;
        return Object.values(map)
            .map(item => ({
                ...item,
                share: values ? Math.round((item.dhq / Math.max(1, totalDHQ)) * 100) : Math.round((item.count / Math.max(1, denominator)) * 100),
            }))
            .sort((a, b) => (useValueShare ? b.dhq - a.dhq : b.count - a.count) || a.label.localeCompare(b.label));
    }

    const positionAllocation = finalizeTotals(positionTotals);
    const ageAllocation = finalizeTotals(ageTotals, true);
    const tierAllocation = finalizeTotals(tierTotals, true);
    // CHOPPED provinces never accrue a W-L record — their wins/losses are
    // permanently 0-0 by format, not "hasn't played yet". Summing them in
    // would silently drag the aggregate win% toward 0 as the season goes on
    // in every OTHER league while this one sits at a structural 0-0.
    const totalRecord = provinces.filter(p => !p.isChopped).reduce((sum, p) => ({ wins: sum.wins + p.wins, losses: sum.losses + p.losses }), { wins: 0, losses: 0 });
    const assessedHealth = provinces.map(p => p.healthScore).filter(v => v != null);
    const avgHealth = assessedHealth.length ? Math.round(assessedHealth.reduce((sum, v) => sum + v, 0) / assessedHealth.length) : null;
    const pickYears = {};
    picks.forEach(pick => {
        if (!pickYears[pick.year]) pickYears[pick.year] = { year: pick.year, count: 0, premium: 0, acquired: 0, own: 0, score: 0, unpriced: 0 };
        pickYears[pick.year].count++;
        if (pick.score != null) pickYears[pick.year].score += pick.score;
        else pickYears[pick.year].unpriced++;
        if (pick.round <= 2) pickYears[pick.year].premium++;
        if (pick.acquired) pickYears[pick.year].acquired++;
        if (pick.own) pickYears[pick.year].own++;
    });
    const pickCapital = {
        complete: pickFeedLeagueCount === provinces.length && (!input.portfolioCoverage || ['ready', 'idle'].includes(input.portfolioCoverage.status)),
        verifiedLeagues: pickFeedLeagueCount,
        loadedLeagues: provinces.filter(province => province.pickFeedPresent).length,
        staleLeagues: provinces.filter(province => province.pickFeedPresent && (province.league._pickFeedState === 'stale' || province.draftProgressStale || province.league._portfolioStale)).length,
        unknownDraftLeagues: provinces.filter(province => province.currentDraftUnknown).length,
        total: picks.length,
        premium: picks.filter(p => p.round <= 2).length,
        dynastyPremium: picks.filter(p => p.format === 'dynasty' && p.round <= 2).length,
        unpriced: picks.filter(p => p.score == null).length,
        acquired: picks.filter(p => p.acquired).length,
        own: picks.filter(p => p.own).length,
        score: picks.some(p => p.score == null) ? null : picks.reduce((sum, pick) => sum + pick.score, 0),
        byYear: Object.values(pickYears).map(year => ({ ...year, score: year.unpriced ? null : year.score })).sort((a, b) => a.year - b.year),
    };

    const sourceIncomplete = input.portfolioCoverage && !['ready', 'idle'].includes(input.portfolioCoverage.status);
    const qualityItems = [
        ...(sourceIncomplete ? [{ key: 'coverage', label: 'League coverage', status: 'partial', detail: input.portfolioCoverage.knownCount == null ? 'Connected league count could not be verified' : input.portfolioCoverage.loadedCount + '/' + input.portfolioCoverage.knownCount + ' Sleeper leagues loaded; unavailable holdings are unknown' }] : []),
        {
            key: 'rosters',
            label: 'Rosters',
            status: provinces.length ? 'ready' : 'missing',
            detail: provinces.length ? provinces.length + ' leagues mapped' : 'No owned rosters found',
        },
        {
            key: 'players',
            label: 'Player meta',
            status: assets.length && missingPlayerMeta === 0 ? 'ready' : assets.length ? 'partial' : 'missing',
            detail: missingPlayerMeta ? missingPlayerMeta + ' roster IDs missing names' : assets.length + ' assets named',
        },
        {
            key: 'dhq',
            label: 'Player values',
            status: scoredAssets > 0 && scoredAssets === assets.length ? 'ready' : scoredAssets > 0 ? 'partial' : input.liLoaded ? 'degraded' : 'loading',
            detail: scoredAssets + '/' + assets.length + ' assets valued on their format basis; missing seasonal evidence stays unknown',
        },
        {
            key: 'picks',
            label: 'Pick feed',
            status: pickFeedLeagueCount === provinces.length && provinces.length ? 'ready' : pickFeedLeagueCount > 0 ? 'partial' : 'degraded',
            detail: pickFeedLeagueCount + '/' + provinces.length + ' leagues with current pick ownership' + (pickCapital.staleLeagues ? '; ' + pickCapital.staleLeagues + ' using saved ownership' : '') + (pickCapital.loadedLeagues < provinces.length ? '; unavailable picks excluded' : '') + (pickCapital.unknownDraftLeagues ? '; current-year draft progress unavailable for ' + pickCapital.unknownDraftLeagues + ' leagues' : ''),
        },
        {
            key: 'assessments',
            label: 'Team reads',
            status: provinces.length && assessedLeagueCount === provinces.length ? 'ready' : assessedLeagueCount > 0 ? 'partial' : 'degraded',
            detail: assessedLeagueCount + '/' + provinces.length + ' leagues assessed' + (provinces.some(p => p.format !== 'dynasty') ? '; seasonal health and needs unavailable; keeper economics require actual terms' : '; dynasty roster reads'),
        },
    ];
    const qualityRank = { ready: 0, partial: 1, loading: 1, degraded: 2, missing: 3 };
    const worstQuality = qualityItems.reduce((worst, item) => qualityRank[item.status] > qualityRank[worst] ? item.status : worst, 'ready');

    const signals = [];
    function pushSignal(signal) {
        signals.push({
            severity: signal.severity || 'medium',
            type: signal.type || 'opportunity',
            title: signal.title,
            body: signal.body,
            metric: signal.metric || '',
            filter: signal.filter || null,
            pid: signal.pid || null,
            leagueId: signal.leagueId || null,
            detail: signal.detail || null,
            cta: signal.cta || 'Open',
        });
    }
    if (worstQuality !== 'ready') {
        const weak = qualityItems.filter(item => item.status !== 'ready').map(item => item.label).join(', ');
        pushSignal({
            severity: worstQuality === 'missing' || worstQuality === 'degraded' ? 'high' : 'medium',
            type: 'data',
            title: 'Some portfolio data is missing',
            body: weak + ' are incomplete. Review these sources before acting.',
            metric: worstQuality.toUpperCase(),
            detail: { type: 'quality' },
            cta: 'Review data',
        });
    }
    const duplicateExposure = exposure.filter(item => item.count > 1);
    if (duplicateExposure[0]) {
        const top = duplicateExposure[0];
        pushSignal({
            severity: top.exposurePct >= 50 ? 'high' : 'medium',
            type: 'exposure',
            title: top.name + ' concentration',
            body: 'Owned in ' + top.count + ' of ' + Math.max(1, provinces.length) + ' leagues. One player outcome can move the whole portfolio.',
            metric: top.exposurePct + '%',
            pid: top.pid,
            cta: 'Open player',
        });
    }
    positionAllocation.forEach(pos => {
        if (pos.share >= 35 && ['QB', 'RB', 'WR', 'TE'].includes(pos.key)) {
            pushSignal({
                severity: pos.share >= 45 ? 'high' : 'medium',
                type: 'allocation',
                title: pos.label + ' allocation is overweight',
                body: pos.share + '% of portfolio ' + (useValueShare ? 'DHQ' : 'asset count') + ' sits at ' + pos.label + '.',
                metric: pos.share + '%',
                filter: { position: pos.key },
                detail: { type: 'slice', title: pos.label + ' Allocation', filter: { position: pos.key } },
                cta: 'Open slice',
            });
        }
    });
    const postWindow = ageAllocation.find(a => a.key === 'post');
    if (postWindow && postWindow.share >= 20) {
        pushSignal({
            severity: postWindow.share >= 35 ? 'high' : 'medium',
            type: 'age',
            title: 'Post-window value needs pruning',
            body: postWindow.share + '% of dynasty ' + (totalDHQ > 0 ? 'DHQ' : 'assets') + ' is beyond the value window. This read excludes seasonal and keeper holdings.',
            metric: postWindow.share + '%',
            filter: { agePhase: 'post' },
            detail: { type: 'slice', title: 'Post-window Assets', filter: { agePhase: 'post' } },
            cta: 'Open slice',
        });
    }
    const buildWindow = ageAllocation.find(a => a.key === 'build');
    if (buildWindow && buildWindow.share >= 45) {
        pushSignal({
            severity: 'medium',
            type: 'age',
            title: 'Pre-peak portfolio has volatility',
            body: buildWindow.share + '% of dynasty allocation is still before peak years. This read excludes seasonal and keeper holdings.',
            metric: buildWindow.share + '%',
            filter: { agePhase: 'build' },
            detail: { type: 'slice', title: 'Build-window Assets', filter: { agePhase: 'build' } },
            cta: 'Open slice',
        });
    }
    if (strategyTotals.contender > 0 && strategyTotals.rebuild > 0) {
        pushSignal({
            severity: 'medium',
            type: 'strategy',
            title: 'Mixed league timeline',
            body: strategyTotals.contender + ' contending and ' + strategyTotals.rebuild + ' rebuilding leagues need different capital rules.',
            metric: strategyTotals.contender + '/' + strategyTotals.rebuild,
            detail: { type: 'slice', title: 'League Timeline Mix', filter: {} },
            cta: 'Review leagues',
        });
    }
    if (pickCapital.complete && pickCapital.dynastyPremium >= Math.max(3, provinces.filter(p => p.format === 'dynasty').length * 2)) {
        pushSignal({
            severity: 'low',
            type: 'capital',
            title: 'Dynasty pick bank is strong',
            body: pickCapital.dynastyPremium + ' dynasty round 1-2 picks give the portfolio optionality across windows.',
            metric: pickCapital.dynastyPremium + ' dynasty R1–2',
            filter: { assetType: 'picks' },
            detail: { type: 'slice', title: 'Draft Capital', filter: { assetType: 'picks' } },
            cta: 'Open picks',
        });
    }
    if (!signals.length) {
        pushSignal({
            severity: 'low',
            type: 'balance',
            title: 'Portfolio allocation is balanced',
            body: 'No major concentration, age-window, or league-timeline risk is dominating the current view.',
            metric: 'Stable',
        });
    }
    const severityOrder = { high: 0, medium: 1, low: 2 };
    signals.sort((a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1));

    return {
        coverage: { complete: !sourceIncomplete, knownLeagues: input.portfolioCoverage?.knownCount ?? allLeagues.length, loadedLeagues: provinces.length, staleLeagues: input.portfolioCoverage?.staleCount || 0 },
        provinces,
        assets,
        picks,
        exposure,
        positionAllocation,
        ageAllocation,
        tierAllocation,
        strategyTotals,
        pickCapital,
        dataQuality: { status: worstQuality, items: qualityItems, missingPlayerMeta, scoredAssets, scoreCount },
        signals,
        totals: {
            leagues: provinces.length,
            assets: assets.length,
            totalDHQ,
            totalValue, valueBasis, dynastyLeagues: provinces.filter(p => p.format === 'dynasty').length,
            scoredAssets,
            totalRecord,
            avgHealth,
            contenders: strategyTotals.contender || 0,
            rebuilds: strategyTotals.rebuild || 0,
            exposureCount: duplicateExposure.length,
            topExposurePct: duplicateExposure[0]?.exposurePct || 0,
            useValueShare,
        },
    };
}

// Scenario math uses the same DHQ book as the portfolio, never mixes pricing scales.
// No mutation: these are hypothetical value shocks, not roster or scoring changes.
function buildEmpireScenario(model, options = {}) {
    const provinces = model.provinces || [];
    const ids = new Set(provinces.map(p => String(p.id)));
    const seen = new Set();
    const assets = (model.assets || []).filter(a => {
        const key = String(a.leagueId) + ':' + a.pid;
        if (!ids.has(String(a.leagueId)) || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const rawValue = a => Object.prototype.hasOwnProperty.call(a, 'value') ? a.value : a.dhq > 0 ? a.dhq : null;
    const valueOf = a => rawValue(a) != null && Number.isFinite(Number(rawValue(a))) ? Number(rawValue(a)) : 0;
    const bases = [...new Set(assets.filter(a => rawValue(a) != null).map(a => a.valueBasis || 'dynasty'))];
    const mixed = bases.length > 1;
    const valueLabel = bases[0] === 'seasonal' ? 'Season value' : 'Dynasty DHQ';
    const kind = ['player', 'team', 'position'].includes(options.kind) ? options.kind : 'player';
    const groupKey = a => String(kind === 'player' ? a.pid : kind === 'team' ? a.team : a.pos);
    const groups = new Map();
    assets.forEach(a => {
        const key = groupKey(a);
        if (!key || key === 'undefined' || key === '?' || (kind === 'team' && key === 'FA')) return;
        if (!groups.has(key)) groups.set(key, { key, name: kind === 'player' ? a.name : key, value: 0, leagueIds: new Set() });
        const group = groups.get(key);
        if (!mixed) group.value += valueOf(a);
        group.leagueIds.add(String(a.leagueId));
    });
    const choices = [...groups.values()].map(g => ({ ...g, count: g.leagueIds.size }))
        .sort((a, b) => b.value - a.value || b.count - a.count || a.name.localeCompare(b.name));
    const selected = choices.find(g => g.key === String(options.target)) || choices[0] || null;
    const drop = Number.isFinite(Number(options.drop)) ? Math.min(100, Math.max(0, Number(options.drop))) : 30;
    const cap = Number.isFinite(Number(options.cap)) ? Math.min(100, Math.max(0, Number(options.cap))) : 50;
    const affected = selected ? assets.filter(a => groupKey(a) === selected.key) : [];
    const total = assets.reduce((n, a) => n + valueOf(a), 0);
    const exposed = affected.reduce((n, a) => n + valueOf(a), 0);
    const loss = exposed * drop / 100;
    const rows = provinces.map(p => {
        const holdings = assets.filter(a => String(a.leagueId) === String(p.id));
        const hits = affected.filter(a => String(a.leagueId) === String(p.id));
        const baseline = holdings.reduce((n, a) => n + valueOf(a), 0);
        const atRisk = hits.reduce((n, a) => n + valueOf(a), 0);
        const delta = atRisk * drop / 100;
        return { province: p, hits, baseline, loss: delta, after: baseline - delta,
            lossPct: baseline > 0 ? delta / baseline * 100 : null,
            valueLabel: p.valueLabel || 'Dynasty DHQ',
            unknown: hits.filter(a => rawValue(a) == null).length };
    }).filter(r => r.hits.length).sort((a, b) => (b.lossPct || 0) - (a.lossPct || 0) || (!mixed ? b.loss - a.loss : String(a.province.name).localeCompare(String(b.province.name))));
    const allowed = Math.floor(provinces.length * cap / 100);
    const ownership = new Map();
    assets.forEach(a => {
        const key = String(a.pid);
        if (!ownership.has(key)) ownership.set(key, { pid: a.pid, name: a.name, pos: a.pos, holdings: [] });
        ownership.get(key).holdings.push(a);
    });
    const breaches = [...ownership.values()].filter(g => g.holdings.length > allowed)
        .map(g => ({ ...g, count: g.holdings.length, excess: g.holdings.length - allowed,
            pct: provinces.length ? g.holdings.length / provinces.length * 100 : 0,
            value: mixed ? null : g.holdings.reduce((n, a) => n + valueOf(a), 0) }))
        .sort((a, b) => b.excess - a.excess || b.value - a.value || a.name.localeCompare(b.name));
    return { choices, selected, drop, cap, allowed, total: mixed ? null : total, exposed: mixed ? null : exposed, loss: mixed ? null : loss, after: mixed ? null : total - loss,
        lossPct: !mixed && total > 0 ? loss / total * 100 : null, rows, breaches, mixed, valueLabel,
        scored: assets.filter(a => rawValue(a) != null).length, assetCount: assets.length,
        missingMeta: model.dataQuality?.missingPlayerMeta || 0 };
}

function EmpirePortfolioLab({ model, onOpen }) {
    const [kind, setKind] = React.useState('player');
    const [target, setTarget] = React.useState('');
    const [drop, setDrop] = React.useState(30);
    const [cap, setCap] = React.useState(50);
    const result = React.useMemo(() => buildEmpireScenario(model, { kind, target, drop, cap }), [model, kind, target, drop, cap]);
    const pct = n => n == null ? 'Unavailable' : n.toFixed(1) + '%';
    return <main className="empire-detail empire-lab" data-testid="empire-portfolio-lab">
        <section className="empire-detail-hero">
            <div><div className="empire-command-kicker">Portfolio Lab</div><h1>Test your exposure.</h1><p>See how a hypothetical value drop affects your leagues.</p></div>
            <span className="empire-lab-badge">Hypothetical scenario</span>
        </section>
        <section className="empire-panel">
            <div className="empire-panel-head"><strong>Build your scenario</strong><em>Included Empire leagues</em></div>
            <div className="empire-lab-controls">
                <label>Group by<select value={kind} onChange={e => { setKind(e.target.value); setTarget(''); }}><option value="player">Player</option><option value="team">NFL team</option><option value="position">Position</option></select></label>
                <label>Holding<select value={result.selected?.key || ''} disabled={!result.choices.length} onChange={e => setTarget(e.target.value)}>{!result.choices.length && <option value="">No holdings available</option>}{result.choices.map(g => <option key={g.key} value={g.key}>{g.name} · {g.count} {g.count === 1 ? 'league' : 'leagues'}</option>)}</select></label>
                <label>Value drop · {drop}%<input aria-label="Value drop" type="range" min="0" max="100" step="5" value={drop} onChange={e => setDrop(Number(e.target.value))} /></label>
            </div>
            <p className="empire-lab-note">Applies a {drop}% drop on each holding's format basis: dynasty DHQ or league-scored season value. Mixed bases are shown separately by league and never added together. Keeper season value does not establish keeper surplus. This is a hypothetical value change, not an injury, points, or win-probability forecast. Picks are excluded.</p>
        </section>
        <div className="empire-detail-metrics" aria-live="polite" aria-atomic="true">
            <div className="empire-metric"><span>Current player value</span><strong>{result.mixed ? 'By league' : result.total ? empireCompact(result.total) : 'Unavailable'}</strong></div>
            <div className="empire-metric"><span>Scenario value</span><strong>{result.total ? empireCompact(result.after) : 'Unavailable'}</strong></div>
            <div className="empire-metric"><span>Portfolio decrease</span><strong style={{ color: 'var(--bad)' }}>{pct(result.lossPct)}</strong><span>{result.mixed ? 'Different value bases' : result.total ? empireCompact(result.loss) + ' ' + result.valueLabel : 'Waiting for valuations'}</span></div>
            <div className="empire-metric"><span>Leagues affected{model.coverage?.complete === false ? ' (loaded)' : ''}</span><strong>{result.rows.length}/{model.provinces.length}</strong><span>{result.scored}/{result.assetCount} holdings valued{result.missingMeta ? ' · ' + result.missingMeta + ' unnamed' : ''}</span></div>
        </div>
        {(result.scored < result.assetCount || result.missingMeta > 0) && <p className="empire-lab-note" role="status">Partial coverage: unvalued or unnamed holdings are excluded from value calculations. Their impact is unknown.</p>}
        <section className="empire-panel">
            <div className="empire-panel-head"><strong>Where it hits hardest</strong><em>Largest share of roster value first</em></div>
            {result.rows.length ? <div className="empire-lab-table-wrap"><table className="empire-lab-table"><caption className="empire-lab-note">{result.selected.name} · {drop}% value drop</caption><thead><tr><th scope="col">League / holdings</th><th scope="col">Current value</th><th scope="col">Scenario value</th><th scope="col">Decrease</th><th scope="col">Next step</th></tr></thead><tbody>{result.rows.map(r => <tr key={r.province.id}>
                <th scope="row"><button className="empire-ghost" type="button" onClick={() => onOpen({ type: 'league', leagueId: r.province.id })}>{r.province.name}</button><small>{r.hits.map(a => a.name).join(', ')}</small>{r.unknown > 0 && <small>{r.unknown} unvalued · partial estimate</small>}</th>
                <td data-label="Current value">{r.baseline ? empireCompact(r.baseline) : '—'}<small>{r.valueLabel}</small></td><td data-label="Scenario value">{r.baseline ? empireCompact(r.after) : '—'}</td><td data-label="Decrease"><strong>{pct(r.lossPct)}</strong><small>{r.baseline ? empireCompact(r.loss) + ' ' + r.valueLabel : 'Unknown impact'}</small></td>
                <td className="empire-lab-next"><button className="empire-action" type="button" onClick={() => onOpen(canOpenEmpireTradeDesk(r.province) ? { type: 'tradeDesk', leagueId: r.province.id, seedPid: kind === 'player' ? result.selected.key : undefined } : { type: 'league', leagueId: r.province.id })}>{canOpenEmpireTradeDesk(r.province) ? 'Review trade options' : 'Review roster'}</button></td>
            </tr>)}</tbody></table></div> : <div className="empire-empty"><strong>No holdings to model</strong>Sync your leagues or choose another group to build a scenario.</div>}
        </section>
        <section className="empire-panel">
            <div className="empire-panel-head"><strong>Your exposure guardrail</strong><em>{result.breaches.length} players above target</em></div>
            <div className="empire-lab-controls"><label>Maximum leagues per player · {cap}%<input aria-label="Maximum player exposure" type="range" min="0" max="100" step="10" value={cap} onChange={e => setCap(Number(e.target.value))} /></label><p className="empire-lab-note">Your target allows up to {result.allowed} of {model.provinces.length} included leagues per player. Ownership is rounded down to whole leagues. This target is for this visit.</p></div>
            <div className="empire-lab-guardrails">{result.breaches.slice(0, 12).map(g => <button className="empire-signal" type="button" key={g.pid} onClick={() => { setKind('player'); setTarget(String(g.pid)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <div className="empire-signal-top"><strong>{g.name}</strong><b>{Math.round(g.pct)}%</b></div><span>{g.count} leagues · {g.excess} above your target</span><em>Model this player →</em>
            </button>)}</div>
            {!result.breaches.length && <div className="empire-empty"><strong>{model.coverage?.complete === false ? 'Exposure check is incomplete' : result.assetCount ? 'Within your exposure target' : 'No ownership data yet'}</strong>{model.coverage?.complete === false ? 'Unavailable or stale leagues must refresh before the portfolio can be checked against your limit.' : result.assetCount ? 'Every player fits your selected limit.' : 'Sync leagues to review concentration.'}</div>}
            {result.breaches.length > 12 && <p className="empire-lab-note">Showing the 12 largest breaches, ordered by excess ownership, then comparable value or name. Use the Holding selector to model any player.</p>}
        </section>
    </main>;
}

// deriveOwnerEdge — translate a trade posture into an actionable cross-league edge.
function deriveOwnerEdge(posture) {
    const key = posture?.key || 'NEUTRAL';
    if (key === 'DESPERATE') return { edge: 'Panicking — overpays for win-now help', exploit: 9, tone: 'var(--k-bb8fce, #bb8fce)' };
    if (key === 'SELLER')    return { edge: 'Buy his assets at a discount', exploit: 7.5, tone: 'var(--k-5dade2, #5dade2)' };
    if (key === 'BUYER')     return { edge: 'Sell him studs at a premium', exploit: 6, tone: 'var(--k-f0a500, #f0a500)' };
    if (key === 'LOCKED')    return { edge: 'Hard to move — high attachment', exploit: 2.5, tone: 'var(--k-7f8c8d, #7f8c8d)' };
    return { edge: 'Fair value only — no clear edge', exploit: 4, tone: 'var(--k-95a5a6, #95a5a6)' };
}

// inferDnaFromTransactions — transaction-behavioral Owner DNA (a DNA_TYPES key) per owner,
// from a league's completed trades. Mirrors computeWeightedDNA's frequency + pick/player-flow
// signals; the DHQ-value-graded signals (win rate, avg value diff) need per-league player
// scores and are deferred — so this is a CONSERVATIVE read: it only emits a key on a clear
// behavioral signal, otherwise leaves the owner unset (for curated DNA / NONE to fill).
function inferDnaFromTransactions(transactions, rosters, myUserId) {
    const out = {};
    const trades = (transactions || []).filter(t => t && t.type === 'trade' && t.status !== 'failed');
    if (trades.length < 2 || !rosters || !rosters.length) return out;
    const ridToOwner = {};
    rosters.forEach(r => { if (r && r.roster_id != null) ridToOwner[r.roster_id] = r.owner_id; });
    const per = {};
    const bump = rid => (per[rid] = per[rid] || { trades: 0, picksRecv: 0, picksSent: 0, playersRecv: 0, playersSent: 0 });
    trades.forEach(t => {
        (t.roster_ids || []).forEach(rid => { bump(rid).trades++; });
        Object.values(t.adds || {}).forEach(rid => { bump(rid).playersRecv++; });
        Object.values(t.drops || {}).forEach(rid => { bump(rid).playersSent++; });
        (t.draft_picks || []).forEach(p => {
            if (p.owner_id != null) bump(p.owner_id).picksRecv++;
            if (p.previous_owner_id != null) bump(p.previous_owner_id).picksSent++;
        });
    });
    const rids = Object.keys(per);
    const avgTrades = rids.reduce((s, rid) => s + per[rid].trades, 0) / Math.max(1, rids.length);
    rids.forEach(rid => {
        const p = per[rid];
        if (p.trades < 2) return;
        const ownerId = ridToOwner[rid];
        if (ownerId == null || (myUserId != null && String(ownerId) === String(myUserId))) return;
        const scores = { FLEECER: 0, STALWART: 0, ACCEPTOR: 0 };
        if (avgTrades > 0) {
            const ratio = p.trades / avgTrades;
            if (ratio < 0.5) scores.STALWART += 4;
            else if (ratio > 1.75) scores.FLEECER += 3;
        }
        const netPicks = p.picksRecv - p.picksSent;
        if (netPicks >= 2) scores.ACCEPTOR += 3;                                       // hoards picks → rebuilder/seller
        if (netPicks > 0 && (p.playersSent - p.playersRecv) > 0) scores.ACCEPTOR += 2; // sells players for picks
        let best = null, bestV = 0;
        Object.keys(scores).forEach(k => { if (scores[k] > bestV) { bestV = scores[k]; best = k; } });
        if (best) out[ownerId] = best;
    });
    return out;
}

// buildEmpireDna — real per-league Owner DNA for the moat. The user's curated reads
// (od_owner_dna_v1_<lid>, keyed by ownerId) take precedence; transaction-behavioral inference
// fills the gaps. Returns { [ownerId]: DNA_TYPES key }, which buildEmpireRolodex/buildEmpireMoves
// read off league.empireDna (previously never populated, so they ran on NEUTRAL fallbacks).
function buildEmpireDna(savedDna, transactions, rosters, myUserId) {
    const out = { ...inferDnaFromTransactions(transactions, rosters, myUserId) };
    Object.keys(savedDna || {}).forEach(ownerId => { if (savedDna[ownerId]) out[ownerId] = savedDna[ownerId]; });
    return out;
}

// EMPIRE_DNA_META — display label + how-to-negotiate for the 6 Owner-DNA archetypes. The
// acceptance math lives in trade-engine.js (operates on the dnaKey); this is presentational
// for the Negotiation HUD.
const EMPIRE_DNA_META = {
    FLEECER:   { label: 'The Fleecer',   strategy: 'Hunts asymmetric value. Lead with clean surplus — they respect boldness, but the math still moves linearly.' },
    DOMINATOR: { label: 'The Dominator', strategy: 'Ego-driven; needs to feel like the winner. Frame your offer as handing them the better side.' },
    STALWART:  { label: 'The Stalwart',  strategy: 'Attached to his roster, slow to move. Lead with clear value, never lowball, show both-sides upside.' },
    ACCEPTOR:  { label: 'The Acceptor',  strategy: 'Low attachment, sells current for futures. Offer picks and young upside — he discounts current stars.' },
    DESPERATE: { label: 'The Desperate', strategy: 'Urgency from injuries / bye / playoff push. Identify the empty slot and strike fast before it fades.' },
    NONE:      { label: 'No DNA read',   strategy: 'No behavioral read yet — negotiate at fair value and watch for tells.' },
};

// buildEmpireGrudges — aggregate per-league logged trade grudges (od_grudges_v1_<lid>) into one
// cross-league list. Grudges are keyed by Sleeper user_id, so a grudge with an owner applies
// wherever you face them. Feeds calcGrudgeTax inside buildEmpireMoves.
// buildEmpireIndex — the dynasty market as a desk + how your portfolio is levered to it.
// Per position class: market avg DHQ (across scored players), your exposure %, and β =
// (your value share of the class) / (the market's value share) — >1 means overweight/levered.
function buildEmpireIndex(input) {
    input = input || {};
    const scores = input.scores || {};
    const playersData = input.playersData || {};
    const positionAllocation = input.positionAllocation || [];
    const normPos = input.normPos || (p => p);
    const CLASSES = ['QB', 'RB', 'WR', 'TE'];
    const mkt = {};
    CLASSES.forEach(c => { mkt[c] = { total: 0, count: 0 }; });
    Object.keys(scores).forEach(pid => {
        const v = scores[pid] || 0;
        if (v <= 0) return;
        const p = playersData[pid];
        if (!p) return;
        const c = normPos(p.position) || p.position;
        if (mkt[c]) { mkt[c].total += v; mkt[c].count++; }
    });
    const mktTotal = CLASSES.reduce((s, c) => s + mkt[c].total, 0) || 1;
    const myByPos = {};
    (positionAllocation || []).forEach(p => { myByPos[p.key] = p.dhq || 0; });
    const myTotal = CLASSES.reduce((s, c) => s + (myByPos[c] || 0), 0) || 1;
    const classes = CLASSES.map(c => {
        const mktShare = mkt[c].total / mktTotal;
        const myShare = (myByPos[c] || 0) / myTotal;
        const beta = mktShare > 0 ? Math.round((myShare / mktShare) * 100) / 100 : 0;
        return {
            pos: c,
            mktAvg: mkt[c].count ? Math.round(mkt[c].total / mkt[c].count) : 0,
            myExposurePct: Math.round(myShare * 100),
            beta,
            overweight: beta > 1.15,
        };
    });
    return { classes };
}

function buildThreatBoard(input) {
  input = input || {};
  var leagues = input.leagues || [];
  var myUserId = input.myUserId;
  var TE = input.tradeEngine || {};
  var dnaMeta = input.dnaMeta || {};
  var calcPosture = TE.calcOwnerPosture || function () { return { key: 'NEUTRAL', label: 'Neutral', color: 'var(--silver)' }; };
  var sameId = function (a, b) { return a != null && b != null && String(a) === String(b); };

  // Tier weight — how dangerous the roster itself is. Uppercase keys come straight off
  // assessAllTeams (ELITE / CONTENDER / CROSSROADS / REBUILDING). Tolerate mixed case / labels.
  var TIER_W = { ELITE: 40, CONTENDER: 30, CROSSROADS: 14, REBUILDING: 4, UNKNOWN: 10 };
  // Delegates to the shared tierColor (top of file) so the Threat Board can't
  // drift from the rest of Empire Command's tier palette again.
  var tierTone = function (t) { return tierColor(t); };
  // Aggressive DNA — fleecers/dominators actively build threats; passive types less so.
  var DNA_THREAT = { FLEECER: 10, DOMINATOR: 9, STALWART: 3, ACCEPTOR: 1, DESPERATE: 0 };

  var rows = [];
  leagues.forEach(function (league) {
    var assessments = league.empireAssessments || [];
    if (!assessments.length) return;
    var dynasty = empireLeagueFormat(league) === 'dynasty';
    var dnaMap = league.empireDna || {};
    var leagueName = league.name || 'League';
    var leagueId = league.id || league.league_id || '';
    assessments.forEach(function (a) {
      if (sameId(a.ownerId, myUserId)) return; // never threaten yourself
      if (!dynasty) {
        rows.push({ ownerId: a.ownerId, ownerName: a.ownerName || a.teamName || 'Owner', leagueId, leagueName,
          tier: 'SEASONAL', tierTone: 'var(--silver)', postureLabel: 'Roster review', postureColor: 'var(--silver)',
          dnaKey: null, dnaLabel: null, healthScore: null, panic: null, threat: null,
          counter: 'Compare current-season roster fit and standings. Dynasty threat scores and rebuild tactics do not apply; keeper terms remain separate.', topTier: false, aggressive: false });
        return;
      }
      var tierRaw = (a.tier || 'UNKNOWN');
      var tier = String(tierRaw).toUpperCase();
      var tierW = TIER_W[tier] != null ? TIER_W[tier] : TIER_W.UNKNOWN;

      var dnaKey = dnaMap[a.ownerId] || null;
      var posture = calcPosture(a, dnaKey) || { key: 'NEUTRAL', label: 'Neutral', color: 'var(--silver)' };

      // HealthScore (0-100 from assessAllTeams) — a strong, healthy roster is a standing threat.
      var health = typeof a.healthScore === 'number' ? a.healthScore : 0;
      var healthW = Math.max(0, Math.min(100, health)) * 0.30; // up to 30

      // Panic 0-5. A STABLE contender is scarier than a panicking one — low panic = higher threat.
      // High panic = distracted / reactive, so it bleeds threat off.
      var panic = typeof a.panic === 'number' ? a.panic : 0;
      var stabilityW = (5 - Math.max(0, Math.min(5, panic))) * 2.4; // up to 12 (panic 0), 0 at panic 5

      // Aggressive DNA bump (read, not certainty — flagged in the UI/dataNotes).
      var dnaW = dnaKey && DNA_THREAT[dnaKey] != null ? DNA_THREAT[dnaKey] : 0;

      var score = Math.round(tierW + healthW + stabilityW + dnaW);

      // Their edge / how to counter — derived from the dominant threat driver, honest about source.
      var counter;
      if (tier === 'ELITE' && panic <= 1) {
        counter = 'Stable elite core — no panic to exploit. Counter by out-drafting them; do not feed them win-now help.';
      } else if (tier === 'CONTENDER' && panic <= 1) {
        counter = 'Healthy contender with a clear window. Deny them your sell-side studs; let a rival overpay instead.';
      } else if (dnaKey === 'FLEECER') {
        counter = 'Fleecer read: hunts surplus. Never lowball-bait them — close at clean value before they consolidate.';
      } else if (dnaKey === 'DOMINATOR') {
        counter = 'Dominator read: ego-driven, builds aggressively. Avoid handing them the better side of any swap.';
      } else if (health >= 70) {
        counter = 'Strong roster health. Pressure their thin spots before they round out the build.';
      } else {
        counter = 'Rising but not yet stable. Watch their next moves; a panic spike flips them from threat to target.';
      }

      var dnaLabel = (dnaKey && dnaMeta[dnaKey] && dnaMeta[dnaKey].label) || null;

      rows.push({
        ownerId: a.ownerId,
        ownerName: a.ownerName || a.teamName || 'Owner',
        leagueId: leagueId,
        leagueName: leagueName,
        tier: tier,
        tierTone: tierTone(tier),
        postureLabel: posture.label || posture.key || 'Neutral',
        postureColor: posture.color || 'var(--silver)',
        dnaKey: dnaKey,
        dnaLabel: dnaLabel,
        healthScore: Math.round(health),
        panic: panic,
        threat: score,
        counter: counter,
        // surface the dominant driver for honest "their edge" framing
        topTier: tier === 'ELITE' || tier === 'CONTENDER',
        aggressive: dnaKey === 'FLEECER' || dnaKey === 'DOMINATOR',
      });
    });
  });

  rows.sort(function (x, y) { return y.threat - x.threat || y.healthScore - x.healthScore || x.ownerName.localeCompare(y.ownerName); });

  var max = rows.length ? rows[0].threat : 0;
  var top = rows.slice(0, 10);
  var apex = top.find(row => row.threat != null) || null;
  return {
    rows: top,
    count: rows.length,
    maxThreat: max,
    apex: apex,
    topTierCount: rows.filter(function (r) { return r.topTier; }).length,
    aggressiveCount: rows.filter(function (r) { return r.aggressive; }).length,
  };
}

function buildWarTable(input) {
    input = input || {};
    const provinces = (input.provinces || []).slice();
    const empireCompact = input.empireCompact || (n => String(n));

    // Window definitions, ordered most-aggressive -> most-patient. Tone uses tokens only.
    const WINDOWS = [
        { key: 'push',       label: 'Push now',     tone: 'var(--good)',   blurb: 'Window is open — spend picks/depth on a title run.' },
        { key: 'contend',    label: 'Contend',      tone: 'var(--gold)',   blurb: 'In the mix — add at the margins, hold core.' },
        { key: 'crossroads', label: 'Crossroads',   tone: 'var(--warn)',   blurb: 'Undecided — one or two moves tip you either way.' },
        { key: 'sell',       label: 'Sell / pivot', tone: 'var(--purple)', blurb: 'Cash aging value for picks/youth before it fades.' },
        { key: 'rebuild',    label: 'Rebuild',      tone: 'var(--bad)',    blurb: 'Stockpile youth & capital — play the long game.' },
        { key: 'seasonal', label: 'Seasonal review', tone: 'var(--silver)', blurb: 'Use this-season roster fit and standings. Keeper decisions also require actual keeper terms.' },
    ];
    const ORDER = WINDOWS.map(w => w.key);

    // Power-rank percentile within league (lower rank# = better). Returns 0..1, 0 = best.
    const rankPct = (p) => {
        const teams = Number(p.teams) || 0;
        const rank = Number(p.powerRank) || 0;
        if (teams <= 1 || rank <= 0) return null;
        return (rank - 1) / (teams - 1);
    };

    const verdictFor = (p) => {
        if (p.format && p.format !== 'dynasty') return { key: 'seasonal', known: p.totalValue != null ? 1 : 0 };
        const status = p.status || 'unknown';
        const tier = (p.tier || '').toLowerCase();
        const elite = tier.includes('elite') || tier.includes('contend') || tier.includes('champ');
        const rp = rankPct(p);            // null when unknown
        const goodRank = rp != null && rp <= 0.33;
        const badRank = rp != null && rp >= 0.66;
        const wins = Number(p.wins) || 0;
        const losses = Number(p.losses) || 0;
        const games = wins + losses;
        const winRate = games > 0 ? wins / games : null;
        const winning = winRate != null && winRate >= 0.55;
        const losing = winRate != null && winRate <= 0.40;
        const health = (p.healthScore == null) ? null : Number(p.healthScore);
        const healthy = health != null && health >= 60;
        const frail = health != null && health < 45;

        // Confidence: how much real signal backs the read.
        const known = [rp != null, winRate != null, health != null].filter(Boolean).length;

        // Rebuild status is decisive.
        if (status === 'rebuild') return { key: 'rebuild', known };
        if (status === 'contender') {
            if ((elite || healthy) && (goodRank || winning) && !frail) return { key: 'push', known };
            return { key: 'contend', known };
        }
        if (status === 'fringe') {
            if (badRank || losing || frail) return { key: 'sell', known };
            if (goodRank && winning) return { key: 'contend', known };
            return { key: 'crossroads', known };
        }
        // unknown status — fall back to whatever signal exists.
        if (badRank || losing) return { key: 'sell', known };
        if ((goodRank || winning) && healthy) return { key: 'push', known };
        if (goodRank || winning) return { key: 'contend', known };
        if (rp == null && winRate == null && health == null) return { key: 'crossroads', known: 0 };
        return { key: 'crossroads', known };
    };

    const rows = provinces.map(p => {
        const v = verdictFor(p);
        const win = WINDOWS.find(w => w.key === v.key);
        const teams = Number(p.teams) || 0;
        const rank = Number(p.powerRank) || 0;
        return {
            id: p.id,
            name: p.name || 'League',
            teams,
            format: teams ? teams + '-team' : 'format unknown',
            powerRank: rank,
            rankLabel: (rank && teams) ? ('#' + rank + ' of ' + teams) : 'rank pending',
            rankPct: rankPct(p),
            wins: Number(p.wins) || 0,
            losses: Number(p.losses) || 0,
            record: (Number(p.wins) || 0) + '-' + (Number(p.losses) || 0),
            totalDHQ: Number(p.totalDHQ) || 0,
            dhqLabel: p.totalValue != null ? empireCompact(p.totalValue) + ' ' + p.valueLabel : p.totalValue === undefined && p.totalDHQ > 0 ? empireCompact(p.totalDHQ) : 'Value unavailable',
            healthScore: (p.healthScore == null) ? null : Number(p.healthScore),
            tier: p.tier || 'Unscored',
            tierColor: p.tierColor || 'var(--gold)',
            status: p.status || 'unknown',
            topNeed: (p.needs && p.needs.length) ? p.needs[0] : 'None flagged',
            window: win.key,
            windowLabel: win.label,
            windowTone: win.tone,
            windowBlurb: win.blurb,
            confidence: v.known,           // 0..3 real signals backing the read
            lowConfidence: v.known <= 1,
        };
    });

    // Bucket by window, in canonical order. Within a bucket, sort by power-rank pct
    // (best rank first; unknowns last), then DHQ desc.
    const buckets = WINDOWS.map(w => {
        const items = rows
            .filter(r => r.window === w.key)
            .sort((a, b) => {
                const ap = a.rankPct == null ? 2 : a.rankPct;
                const bp = b.rankPct == null ? 2 : b.rankPct;
                if (ap !== bp) return ap - bp;
                return b.totalDHQ - a.totalDHQ;
            });
        return { key: w.key, label: w.label, tone: w.tone, blurb: w.blurb, count: items.length, items };
    }).filter(b => b.count > 0);

    const countOf = k => rows.filter(r => r.window === k).length;
    const pushing = countOf('push') + countOf('contend');
    const selling = countOf('sell') + countOf('rebuild');
    const crossroads = countOf('crossroads');
    const lowConfidenceCount = rows.filter(r => r.lowConfidence).length;

    // One-line empire posture read.
    let posture;
    if (!rows.length) posture = 'No leagues to read yet.';
    else if (countOf('seasonal') === rows.length) posture = 'Review this-season roster fit; keeper decisions also require actual terms.';
    else if (pushing > selling && pushing >= crossroads) posture = 'Empire is on offense — more windows open than closing.';
    else if (selling > pushing) posture = 'Empire is reloading — more windows closing than open.';
    else posture = 'Empire is balanced — splits between pushing and reloading.';

    return {
        buckets,
        order: ORDER,
        summary: {
            total: rows.length,
            pushing,
            selling,
            crossroads,
            push: countOf('push'),
            contend: countOf('contend'),
            sell: countOf('sell'),
            rebuild: countOf('rebuild'),
            lowConfidenceCount,
            posture,
        },
    };
}

function buildProvincesMap(input) {
  input = input || {};
  const provinces = input.provinces || [];
  const empireCompact = input.empireCompact || (n => String(Math.round(n || 0)));

  const statusMeta = {
    contender: { label: 'Contender', color: 'var(--good)' },
    fringe: { label: 'Crossroads', color: 'var(--warn)' },
    rebuild: { label: 'Rebuild', color: 'var(--bad)' },
    unknown: { label: 'Unread', color: 'var(--silver)' },
    seasonal: { label: 'This season', color: 'var(--silver)' },
    // Distinct from 'unknown' — nothing's broken here, there's just nothing
    // to assess yet. Neutral tone, not the "something needs your attention"
    // silver 'Unread' reads as.
    pre_draft: { label: 'Pre-Draft', color: 'var(--silver)' },
  };

  const rawValue = p => p.totalValue === undefined ? p.totalDHQ : p.totalValue;
  const mixed = new Set(provinces.map(p => p.valueBasis || 'dynasty')).size > 1;
  const maxDHQ = provinces.reduce((m, p) => Math.max(m, rawValue(p) || 0), 0) || 1;

  const tiles = provinces.map(p => {
    const status = statusMeta[p.status] ? p.status : 'unknown';
    const meta = statusMeta[status];
    const dhq = rawValue(p) || 0;
    // flex-grow weighted by DHQ share (mirrors Asset Floor tilegrid), clamped to a sane range.
    const grow = mixed ? 1 : Math.max(1, Math.min(6, Math.round((dhq / maxDHQ) * 6)));
    const rankStr = (p.powerRank && p.teams) ? ('#' + p.powerRank + '/' + p.teams) : null;
    return {
      id: p.id,
      name: p.name || 'League',
      league: p.league,
      status,
      statusLabel: meta.label,
      color: meta.color,
      tier: p.tier || null,
      tierColor: p.tierColor || 'var(--silver)',
      powerRank: p.powerRank || null,
      teams: p.teams || 0,
      rankStr,
      record: (p.wins != null && p.losses != null) ? (p.wins + '-' + p.losses) : null,
      dhq,
      dhqLabel: rawValue(p) != null ? empireCompact(dhq) + ' ' + (p.valueLabel || 'DHQ') : 'Value unavailable',
      healthScore: (p.healthScore != null) ? Math.round(p.healthScore) : null,
      needs: p.needs || [],
      strengths: p.strengths || [],
      grow,
    };
  });

  // Strongest first so standout tiles lead the map; deterministic tiebreak on name.
  tiles.sort((a, b) => (!mixed ? b.dhq - a.dhq : 0) || String(a.name).localeCompare(String(b.name)));

  const summary = {
    leagues: provinces.length,
    contenders: provinces.filter(p => p.status === 'contender').length,
    crossroads: provinces.filter(p => p.status === 'fringe').length,
    rebuilds: provinces.filter(p => p.status === 'rebuild').length,
    unread: provinces.filter(p => !statusMeta[p.status] || p.status === 'unknown').length,
    preDraft: provinces.filter(p => p.status === 'pre_draft').length,
    totalDHQ: provinces.reduce((s, p) => s + (p.totalDHQ || 0), 0),
    totalRecord: provinces.reduce((s, p) => ({ wins: s.wins + (p.wins || 0), losses: s.losses + (p.losses || 0) }), { wins: 0, losses: 0 }),
  };

  return { tiles, summary };
}

function buildScoutBoard(input) {
  const { assets, exposure, totalLeagues, groupBy, sortBy } = input;
  const safeAssets = Array.isArray(assets) ? assets : [];
  const safeExposure = Array.isArray(exposure) ? exposure : [];
  const leagueCount = Math.max(1, totalLeagues || 0);

  // exposure is keyed by pid (one entry per player, count = leagues owned in)
  const expoByPid = {};
  safeExposure.forEach(e => { expoByPid[String(e.pid)] = e; });

  // model.assets has one row per (player, league); dedupe to one card per pid,
  // keeping the highest-DHQ instance as the canonical read.
  const byPid = {};
  safeAssets.forEach(a => {
    if (!a) return;
    const key = String(a.pid);
    const prev = byPid[key];
    if (!prev) byPid[key] = { ...a, holdings: [a] };
    else prev.holdings.push(a);
  });

  let rows = Object.keys(byPid).map(key => {
    const a = byPid[key];
    const e = expoByPid[key];
    const valueOf = item => item.value === undefined ? item.dhq > 0 ? item.dhq : null : item.value;
    const bases = new Set(a.holdings.map(item => item.valueBasis || 'dynasty'));
    const values = new Set(a.holdings.map(valueOf));
    const value = bases.size === 1 && values.size === 1 ? valueOf(a) : null;
    const valueLabel = bases.size > 1 || values.size > 1 ? 'By league' : a.valueLabel || 'Dynasty DHQ';
    const count = e ? (e.count || 0) : 1;
    const exposurePct = e ? (e.exposurePct || 0) : Math.round((1 / leagueCount) * 100);
    return {
      pid: a.pid,
      name: a.name || 'Unknown',
      pos: a.pos || '—',
      age: a.age || null,
      dhq: a.dhq || 0, value, valueLabel,
      tier: a.tier || null,
      tierColor: a.tierColor || null,
      agePhase: a.agePhase || 'unknown',
      agePhaseLabel: a.agePhaseLabel || 'Unknown window',
      agePhaseColor: a.agePhaseColor || 'var(--silver)',
      exposureCount: count,
      exposurePct,
      multiLeague: count > 1
    };
  });

  // Sort
  const sorters = {
    dhq: (x, y) => x.valueLabel.localeCompare(y.valueLabel) || (y.value || 0) - (x.value || 0),
    exposure: (x, y) => (y.exposureCount - x.exposureCount) || (y.dhq - x.dhq),
    age: (x, y) => ((x.age || 999) - (y.age || 999)) || (y.dhq - x.dhq),
    position: (x, y) => String(x.pos).localeCompare(String(y.pos)) || (y.dhq - x.dhq)
  };
  rows.sort(sorters[sortBy] || sorters.dhq);

  // Top ~40 by the active sort
  rows = rows.slice(0, 40);

  // Grouping
  let groups;
  if (groupBy === 'position') {
    const order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const map = {};
    rows.forEach(r => { (map[r.pos] = map[r.pos] || []).push(r); });
    groups = Object.keys(map)
      .sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      })
      .map(k => ({ key: k, label: k, tone: 'var(--gold)', rows: map[k] }));
  } else if (groupBy === 'age') {
    const order = ['build', 'peak', 'value', 'post', 'unknown'];
    const map = {};
    rows.forEach(r => { (map[r.agePhase] = map[r.agePhase] || []).push(r); });
    groups = Object.keys(map)
      .sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(k => {
        const sample = map[k][0];
        return { key: k, label: sample.agePhaseLabel, tone: sample.agePhaseColor, rows: map[k] };
      });
  } else {
    groups = [{ key: 'all', label: 'Top Board', tone: 'var(--gold)', rows }];
  }

  const totalDHQ = rows.reduce((s, r) => s + r.dhq, 0);
  const multiCount = rows.filter(r => r.multiLeague).length;
  const topMulti = rows.filter(r => r.multiLeague).slice(0, 1)[0] || null;

  return {
    rows,
    groups,
    leagueCount,
    summary: {
      boardSize: rows.length,
      totalDHQ,
      multiCount,
      topMultiName: topMulti ? topMulti.name : null,
      topMultiCount: topMulti ? topMulti.exposureCount : 0
    }
  };
}

function buildEmpireGrudges(allLeagues) {
    const out = [];
    (allLeagues || []).forEach(l => {
        const lid = l && (l.id || l.league_id);
        if (!lid || typeof localStorage === 'undefined') return;
        try {
            const arr = JSON.parse(localStorage.getItem('od_grudges_v1_' + lid) || '[]');
            if (Array.isArray(arr)) out.push(...arr);
        } catch (e) { /* ignore malformed */ }
    });
    return out;
}

// buildEmpireRolodex — every owner you face, across every league, ranked by edge.
// Pure: reads league.empireAssessments (from assessAllTeams) + optional league.empireDna.
// calcPosture is injectable for testing; defaults to the shared trade engine.
function buildEmpireRolodex(leagues, myUserId, calcPosture) {
    const posFn = calcPosture || (typeof window !== 'undefined' && window.App?.TradeEngine?.calcOwnerPosture) || (() => ({ key: 'NEUTRAL', label: 'Neutral' }));
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const owners = [];
    (leagues || []).forEach(league => {
        const assessments = league.empireAssessments || [];
        const dnaMap = league.empireDna || {};
        const leagueName = league.name || 'League';
        const leagueId = league.id || league.league_id || '';
        const normalizedType = empireLeagueFormat(league);
        const canTrade = normalizedType !== 'chopped' && Number(league?.settings?.disable_trades || 0) !== 1;
        assessments.forEach(a => {
            if (sameId(a.ownerId, myUserId)) return;
            const dnaKey = dnaMap[a.ownerId] || null;
            const posture = (normalizedType === 'dynasty' ? posFn(a, dnaKey) : { key: 'NEUTRAL', label: 'Seasonal roster review' }) || { key: 'NEUTRAL', label: 'Neutral', color: 'var(--k-95a5a6, #95a5a6)' };
            const e = normalizedType === 'dynasty' ? deriveOwnerEdge(posture) : { edge: 'Review current-season roster fit; keeper terms are separate', exploit: 0, tone: 'var(--silver)' };
            owners.push({
                ownerId: a.ownerId,
                ownerName: a.ownerName || a.teamName || 'Owner',
                leagueId, leagueName,
                canTrade,
                tier: normalizedType === 'dynasty' ? a.tier || 'UNKNOWN' : 'UNKNOWN',
                posture: posture.label || posture.key,
                postureKey: posture.key,
                postureColor: posture.color || e.tone,
                edge: e.edge,
                exploit: Math.round((e.exploit + (normalizedType === 'dynasty' && (a.panic || 0) >= 3 ? 0.5 : 0)) * 10) / 10,
                needs: (normalizedType === 'dynasty' ? a.needs || [] : []).slice(0, 2).map(n => (typeof n === 'string' ? n : n.pos)).filter(Boolean),
                dnaKey,
            });
        });
    });
    owners.sort((x, y) => y.exploit - x.exploit || x.ownerName.localeCompare(y.ownerName));
    return owners;
}

// buildEmpireMoves — the moat. Cross-league trade lanes ranked by value × acceptance.
// For each league: sell my post-window/over-exposed assets to a buyer who needs that
// position; buy my top need from a seller — scored with the real trade-psychology engine.
// Pure: injectable tradeEngine (defaults to window.App.TradeEngine) for testability.
function buildEmpireMoves(input) {
    input = input || {};
    const leagues = input.leagues || [];
    const model = input.model || { assets: [], provinces: [] };
    const scores = input.scores || {};
    const playersData = input.playersData || {};
    const myUserId = input.myUserId;
    const normPos = input.normPos || (p => p);
    const TE = input.tradeEngine || (typeof window !== 'undefined' ? window.App?.TradeEngine : null) || {};
    const calcPosture = TE.calcOwnerPosture || (() => ({ key: 'NEUTRAL', label: 'Neutral' }));
    const calcTaxes = TE.calcPsychTaxes || (() => []);
    const calcAccept = TE.calcAcceptanceLikelihood || (() => 50);
    const calcGrudge = TE.calcGrudgeTax || (() => ({ total: 0 }));
    const grudges = input.grudges || [];
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const needList = a => (a.needs || []).map(n => (typeof n === 'string' ? n : n.pos)).filter(Boolean);

    const moves = [];
    const totalLeagues = model.provinces.length || leagues.length || 1;
    const exposureCut = Math.max(2, Math.ceil(totalLeagues * 0.6));

    leagues.forEach(league => {
        const normalizedType = empireLeagueFormat(league);
        if (normalizedType === 'chopped' || Number(league?.settings?.disable_trades || 0) === 1) return;
        // Dynasty buy/sell premiums and age pruning cannot become seasonal advice.
        // Exposure itself remains actionable without predicting a buyer or price.
        if (normalizedType !== 'dynasty') {
            (model.assets || []).filter(asset => String(asset.leagueId) === String(league.id || league.league_id) && asset.value != null && asset.exposureCount >= exposureCut).slice(0, 2).forEach(asset => moves.push({
                type: 'review', title: 'Review exposure to ' + asset.name, leagueId: asset.leagueId, leagueName: asset.leagueName,
                why: 'Held in ' + asset.exposureCount + ' leagues. Compare this league’s current-season roster fit before considering a trade.' + (normalizedType === 'keeper' ? ' Keeper costs and eligibility are still required.' : ''),
                posture: 'Seasonal exposure review', value: null, accept: null, pid: asset.pid, score: asset.exposureCount,
            }));
            return;
        }
        const assessments = league.empireAssessments || [];
        if (!assessments.length) return;
        const leagueId = league.id || league.league_id || '';
        const leagueName = league.name || 'League';
        const dnaMap = league.empireDna || {};
        const myA = assessments.find(a => sameId(a.ownerId, myUserId));
        if (!myA) return;
        const opponents = assessments.filter(a => !sameId(a.ownerId, myUserId));
        const postureOf = a => calcPosture(a, dnaMap[a.ownerId] || null) || { key: 'NEUTRAL', label: 'Neutral' };

        // SELL lanes — my post-window or over-exposed assets → a buyer who needs that position.
        (model.assets || [])
            .filter(as => as.leagueId === leagueId && as.dhq > 0 && (as.agePhase === 'post' || as.exposureCount >= exposureCut))
            .sort((a, b) => b.dhq - a.dhq)
            .slice(0, 2)
            .forEach(asset => {
                const buyers = opponents
                    .map(a => ({ a, posture: postureOf(a) }))
                    .filter(x => (x.posture.key === 'BUYER' || x.posture.key === 'DESPERATE') && needList(x.a).includes(asset.pos))
                    .sort((x, y) => (y.posture.key === 'DESPERATE' ? 1 : 0) - (x.posture.key === 'DESPERATE' ? 1 : 0) || (y.a.panic || 0) - (x.a.panic || 0));
                if (!buyers.length) return;
                const { a: buyer, posture } = buyers[0];
                const dnaKey = dnaMap[buyer.ownerId] || null;
                // Model the real deal, not a 1-for-1 swap: the buyer's eagerness sets how much they
                // overpay for the asset they need. Acceptance falls as the premium rises, but their
                // posture / psych tax (panic premium for DESPERATE) offsets it.
                const eagerness = posture.key === 'DESPERATE' ? 1.12 : 1.04;
                const give = asset.dhq;                              // the asset I send out
                const receive = Math.round(asset.dhq * eagerness);   // their (over)payment back
                const sellTaxes = calcTaxes(myA, buyer, dnaKey, posture);
                const sellGrudge = calcGrudge(myA.ownerId, buyer.ownerId, grudges, dnaKey);
                const accept = calcAccept(give, receive, dnaKey, sellGrudge.total ? sellTaxes.concat([{ label: 'Grudge', impact: sellGrudge.total }]) : sellTaxes, myA, buyer);
                // Portfolio Δ = premium extracted + value preserved by shedding a decaying/redundant asset.
                const delta = Math.round((receive - give) + asset.dhq * (asset.agePhase === 'post' ? 0.18 : 0.10));
                moves.push({
                    type: 'sell',
                    title: 'Sell ' + asset.name + ' to ' + (buyer.ownerName || 'a rival'),
                    leagueId, leagueName, ownerName: buyer.ownerName || 'rival',
                    posture: posture.label || posture.key,
                    why: (asset.agePhase === 'post' ? 'Post-window asset' : 'Trim ' + asset.exposureCount + '× exposure')
                        + ' — ' + (buyer.ownerName || 'they') + (posture.key === 'DESPERATE' ? ' is panicking and overpays' : ' is buying') + ' and needs ' + asset.pos + '.',
                    value: delta, accept, pid: asset.pid,
                    score: Math.round(delta * (accept / 100)),
                });
            });

        // BUY lane — fill my top need in a league I should push, from a seller's roster.
        const myNeed = needList(myA)[0];
        const pushing = ['CONTENDER', 'ELITE', 'CROSSROADS'].includes(myA.tier);
        if (myNeed && pushing) {
            let best = null;
            opponents
                .map(a => ({ a, posture: postureOf(a) }))
                .filter(x => x.posture.key === 'SELLER' || x.posture.key === 'DESPERATE')
                .forEach(({ a, posture }) => {
                    const roster = (league.rosters || []).find(r => sameId(r.owner_id, a.ownerId));
                    (roster?.players || []).forEach(pid => {
                        const p = playersData[pid];
                        if (!p) return;
                        const pos = normPos(p.position) || p.position;
                        if (pos !== myNeed) return;
                        const dhq = scores[pid] || 0;
                        if (dhq <= 0) return;
                        if (!best || dhq > best.dhq) {
                            best = { pid, name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '), dhq, owner: a, posture };
                        }
                    });
                });
            if (best) {
                const dnaKey = dnaMap[best.owner.ownerId] || null;
                // Buy below market: a seller/rebuilder takes a discount on a current player.
                // Acceptance reflects the discount, offset by their seller/rebuild posture tax.
                const discount = best.posture.key === 'DESPERATE' ? 0.85 : 0.92;
                const give = Math.round(best.dhq * discount);   // what I pay (picks / surplus)
                const receive = best.dhq;                       // the player I acquire
                const buyTaxes = calcTaxes(myA, best.owner, dnaKey, best.posture);
                const buyGrudge = calcGrudge(myA.ownerId, best.owner.ownerId, grudges, dnaKey);
                const accept = calcAccept(give, receive, dnaKey, buyGrudge.total ? buyTaxes.concat([{ label: 'Grudge', impact: buyGrudge.total }]) : buyTaxes, myA, best.owner);
                const delta = Math.round(best.dhq - give);      // discount captured filling a need
                moves.push({
                    type: 'buy',
                    title: 'Acquire ' + best.name + ' from ' + (best.owner.ownerName || 'a seller'),
                    leagueId, leagueName, ownerName: best.owner.ownerName || 'seller',
                    posture: best.posture.label || best.posture.key,
                    why: 'Fills your ' + myNeed + ' need in a league you should push. '
                        + (best.owner.ownerName || 'They') + (best.posture.key === 'DESPERATE' ? ' is panicking' : ' is selling') + ' — buy at a discount.',
                    value: delta, accept, pid: best.pid,
                    score: Math.round(delta * (accept / 100)),
                });
            }
        }
    });

    moves.sort((a, b) => b.score - a.score);
    return moves.slice(0, 8);
}

// buildEmpireConsolidation — sequence ranked moves into one cross-league campaign:
// liquidate aging/over-exposed assets, recycle the value into need-filling buys, net effect.
function buildEmpireConsolidation(moves, model) {
    const sells = (moves || []).filter(m => m.type === 'sell');
    const buys = (moves || []).filter(m => m.type === 'buy');
    if (!sells.length && !buys.length) return null;
    const assetByPid = {};
    (model?.assets || []).forEach(a => { assetByPid[a.pid] = a; });
    const sellValue = sells.reduce((s, m) => s + (m.value || 0), 0);
    const buyValue = buys.reduce((s, m) => s + (m.value || 0), 0);
    const postWindowMoved = sells.filter(m => assetByPid[m.pid]?.agePhase === 'post').length;
    const exposureTrimmed = sells.filter(m => (assetByPid[m.pid]?.exposureCount || 1) > 1).length;
    const pushLeagues = Array.from(new Set(buys.map(m => m.leagueName)));

    const steps = [];
    const tidy = s => s.replace(/\.{2,}/g, '.');
    if (sells.length) {
        steps.push({
            phase: 'SELL', tone: 'var(--k-5dade2, #5dade2)',
            title: 'Liquidate ' + sells.length + ' aging / over-exposed asset' + (sells.length === 1 ? '' : 's'),
            detail: tidy(sells.map(m => m.title.replace(/^Sell /, '')).join('; ') + '.'),
        });
    }
    if (buys.length) {
        steps.push({
            phase: 'BUY', tone: 'var(--k-2ecc71, #2ecc71)',
            title: 'Recycle into ' + buys.length + ' need-filling buy' + (buys.length === 1 ? '' : 's'),
            detail: tidy(buys.map(m => m.title.replace(/^Acquire /, '')).join('; ')
                + (pushLeagues.length ? ' — pushing ' + pushLeagues.join(', ') + '.' : '.')),
        });
    }
    const net = [];
    if (exposureTrimmed) net.push('cuts ' + exposureTrimmed + ' over-exposure');
    if (postWindowMoved) net.push('clears ' + postWindowMoved + ' post-window asset' + (postWindowMoved === 1 ? '' : 's'));
    if (pushLeagues.length) net.push('upgrades ' + pushLeagues.length + ' contending ' + (pushLeagues.length === 1 ? 'league' : 'leagues'));
    steps.push({
        phase: 'NET', tone: 'var(--k-d4af37, #d4af37)',
        title: 'Net effect across the empire',
        detail: (net.length ? net.join(', ') : 'rebalances the portfolio')
            + '. Reallocates ' + empireCompact(sellValue) + ' from sells into ' + empireCompact(buyValue) + ' of targeted value.',
    });
    return { steps, sells: sells.length, buys: buys.length };
}

// buildEmpireActionQueue — cross-league priority queue.
// Pure function over the portfolio model + owner rolodex. Merges actionable signals,
// per-league needs, post-window sells, and cross-league owner edges into one ranked list.
function buildEmpireActionQueue(model, rolodex) {
    if (!model) return [];
    const provinces = model.provinces || [];
    const assets = model.assets || [];
    const sevRank = { high: 0, medium: 1, low: 2 };
    const actions = [];

    // 1. Actionable portfolio signals (skip data-quality + the "all balanced" no-op).
    (model.signals || []).forEach(sig => {
        if (sig.type === 'data' || sig.type === 'balance') return;
        actions.push({
            severity: sig.severity || 'medium',
            kind: sig.type || 'signal',
            title: sig.title,
            detail: sig.body,
            metric: sig.metric || '',
            leagueId: sig.leagueId || null,
            pid: sig.pid || null,
            filter: sig.filter || null,
            sliceDetail: sig.detail || null,
            cta: sig.cta || 'Open',
            weight: (sig.severity === 'high' ? 300 : sig.severity === 'medium' ? 150 : 50),
        });
    });

    // 2. Per-league upgrade needs for leagues you should be pushing (contender/fringe).
    provinces.forEach(p => {
        if ((p.status === 'contender' || p.status === 'fringe') && (p.needs || []).length) {
            const hp = p.healthScore;
            actions.push({
                severity: hp != null && hp < 65 ? 'high' : 'medium',
                kind: 'need',
                title: 'Upgrade ' + p.needs[0] + ' in ' + p.name,
                detail: (p.tier || 'Active') + ' roster'
                    + (p.needs.length > 1 ? ' — also light at ' + p.needs.slice(1).join(', ') : '')
                    + '. Closing this protects a live window.',
                metric: hp != null ? 'HP ' + hp : '',
                leagueId: p.id,
                cta: 'Open league',
                weight: 120 + Math.max(0, 65 - (hp || 65)),
            });
        }
    });

    // 3. Post-window vets sitting on rebuild rosters → sell before value bleeds.
    provinces.filter(p => p.status === 'rebuild' && p.canTrade !== false).forEach(p => {
        const vet = assets
            .filter(a => a.leagueId === p.id && a.agePhase === 'post' && a.dhq > 0)
            .sort((a, b) => b.dhq - a.dhq)[0];
        if (vet) {
            actions.push({
                severity: 'medium',
                kind: 'sell',
                title: 'Sell ' + vet.name + ' in ' + p.name,
                detail: 'Post-window vet on a rebuild roster — convert to picks before the cliff prices in.',
                metric: empireCompact(vet.dhq),
                leagueId: p.id,
                pid: vet.pid,
                cta: 'Open player',
                weight: 90 + Math.round(vet.dhq / 100),
            });
        }
    });

    // 4. Cross-league owner edges — the moat. Surface the most exploitable
    // buyers/sellers across every league as concrete buy/sell-window moves.
    (rolodex || [])
        .filter(o => o.canTrade !== false && (o.postureKey === 'SELLER' || o.postureKey === 'DESPERATE'))
        .slice(0, 2)
        .forEach(o => {
            const desperate = o.postureKey === 'DESPERATE';
            actions.push({
                severity: desperate ? 'high' : 'medium',
                kind: 'edge',
                title: (desperate ? 'Sell into ' + o.ownerName + "'s panic in " : 'Buy-low window: ' + o.ownerName + ' in ') + o.leagueName,
                detail: o.edge + (o.needs.length ? ' · needs ' + o.needs.join(', ') : '') + '.',
                metric: o.posture,
                leagueId: o.leagueId,
                cta: 'Open league',
                weight: 110 + Math.round(o.exploit * 6),
            });
        });

    actions.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || (b.weight - a.weight));
    return actions.slice(0, 8).map(action => ({ ...action, type: action.kind, why: action.detail, leagueName: provinces.find(p => String(p.id) === String(action.leagueId))?.name || 'Portfolio' }));
}

// buildEmpireBrief — Alex's Empire lead: the single focus sentence only.
// The portfolio totals live in the KPI header tiles and the ranked moves sit
// in the Priority Queue panel beside this — the brief never restates either.
// (Synchronous template for now; AlexVoice/AI upgrade tracked separately.)
function buildEmpireBrief(model, userName) {
    if (!model || !model.totals) return '';
    const topSignal = (model.signals || []).find(s => s.type !== 'data' && s.type !== 'balance');
    return topSignal
        ? topSignal.title + (topSignal.metric ? ' (' + topSignal.metric + ')' : '') + '.'
        : 'No priority flagged in the available data.';
}

function empireCompact(value) {
    const n = Number(value || 0);
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
}

function empirePercent(part, total) {
    return total > 0 ? Math.round((part / total) * 100) : 0;
}

// Same 0-100 healthScore band League Map's cellColor() already uses — kept
// identical so a team doesn't read "healthy" in one surface and "shaky" in another.
function empireHealthColor(hp) {
    if (hp == null) return 'var(--silver)';
    return hp >= 90 ? 'var(--gold)' : hp >= 80 ? 'var(--good)' : hp >= 70 ? 'var(--warn)' : 'var(--bad)';
}

// Same shape/sort League Detail computes for its `standings` prop (wins,
// then fewest losses, then points-for) — Trade Desk needs it to price
// contend/rebuild posture the same way it does from inside a single league.
// Empire already has the full league object per province, so this is a
// plain re-derivation, not a fetch.
function empireStandingsFor(league) {
    return ((league && league.rosters) || []).map(roster => {
        const user = (league.users || []).find(u => u.user_id === roster.owner_id);
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
            division: roster.settings?.division || 0,
        };
    }).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        return b.pointsFor - a.pointsFor;
    });
}

function EmpireStyles() {
    return (
        <style>{`
            .empire-lab { display: grid; gap: 20px; }
            .empire-lab .empire-detail-hero { margin-bottom: 0; }
            .empire-lab-badge { color: var(--gold); border: 1px solid var(--gold); border-radius: 30px; padding: 8px 12px; font-size: 12px; white-space: nowrap; }
            .empire-lab-controls { display: grid; grid-template-columns: 1fr 2fr 1.4fr; gap: 20px; align-items: center; }
            .empire-lab-controls label { display: grid; gap: 10px; font-size: 13px; font-weight: 700; min-width: 0; }
            .empire-lab-controls select { width: 100%; min-width: 0; background: var(--page-bg, #101010); color: var(--text-primary, #eee); border: 1px solid var(--ov-6, #444); padding: 12px; border-radius: var(--card-radius-sm, 8px); font: inherit; }
            .empire-lab-controls input { width: 100%; accent-color: var(--gold, #d4af37); min-height: 32px; }
            .empire-lab-note { color: var(--silver, #aaa); font-size: 12px; line-height: 1.65; }
            .empire-lab-table-wrap { overflow-x: auto; }
            .empire-lab-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
            .empire-lab-table caption { text-align: left; padding-bottom: 12px; }
            .empire-lab-table th, .empire-lab-table td { padding: 16px 10px; border-bottom: 1px solid var(--ov-6, #333); }
            .empire-lab-table thead { color: var(--silver, #aaa); font-size: 11px; text-transform: uppercase; }
            .empire-lab-table small { display: block; max-width: 320px; color: var(--silver, #aaa); font-weight: 400; line-height: 1.6; margin-top: 5px; }
            .empire-lab-guardrails { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
            .empire-lab-entry { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; background: linear-gradient(110deg, var(--surf-solid, #151515), #211d13); }
            .empire-lab-entry p { color: var(--silver, #aaa); font-size: 13px; margin: 8px 0 0; }
            .empire-lab button:focus-visible, .empire-lab select:focus-visible, .empire-lab input:focus-visible { outline: 2px solid var(--gold, #d4af37); outline-offset: 3px; }
            @media(max-width: 700px) { .empire-lab-controls, .empire-lab-guardrails { grid-template-columns: 1fr; } .empire-lab-entry { align-items: flex-start; flex-direction: column; } .empire-lab-table { min-width: 0; } .empire-lab-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .empire-lab-table tbody { display: block; } .empire-lab-table tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--ov-6, #333); padding: 12px 0; gap: 12px; } .empire-lab-table th, .empire-lab-table td { padding: 0; border: 0; } .empire-lab-table th, .empire-lab-table .empire-lab-next { grid-column: 1 / -1; } .empire-lab-table td[data-label]::before { content: attr(data-label); display: block; font-size: 10px; color: var(--silver, #aaa); margin-bottom: 6px; } .empire-lab-next button { width: 100%; min-height: 44px; } .empire-lab .empire-detail-hero { flex-wrap: wrap; } }
            .empire-root { min-height: 100vh; background: var(--page-bg); color: var(--text-primary, var(--k-f4f1e8, #f4f1e8)); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            /* The app-wide "subdued logo" watermark (index.html body::before) is
               position:fixed with an explicit z-index, which stacks it ABOVE
               plain in-flow content like these panels — so even fully opaque
               panel backgrounds couldn't block it; it was painting over them,
               not showing through a gap. Suppress it here instead of touching
               the global rule other tabs still use it on. */
            body:has(.empire-root)::before { opacity: 0; }
            .empire-root.is-local-preview .empire-topbar { padding-top: 28px; min-height: 72px; }
            .empire-workspace-nav { background: var(--surf-solid, #070707); padding: 10px 24px; border-bottom: 1px solid var(--ov-6, #252529); }
            .empire-workspace-primary, .empire-workspace-secondary { display: flex; gap: 6px; flex-wrap: wrap; }
            .empire-workspace-secondary { margin-top: 6px; }
            .empire-workspace-nav button { min-height: 44px; padding: 8px 14px; border: 1px solid transparent; border-radius: var(--card-radius-sm, 8px); background: transparent; color: var(--silver); font: 600 13px var(--font-body); cursor: pointer; }
            .empire-workspace-primary button { flex: 1; max-width: 180px; }
            .empire-workspace-nav button[aria-current="page"] { color: var(--gold); border-color: var(--acc-line2, #68572c); background: var(--acc-fill1, #19160e); }
            .empire-workspace-nav button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
            .empire-shell[data-workspace="overview"] > .empire-floor, .empire-shell[data-workspace="overview"] > .empire-workspace, .empire-shell[data-workspace="overview"] > .empire-viewbar, .empire-shell[data-workspace="overview"] > .empire-advanced-filters { display: none; }
            .empire-shell[data-workspace="leagues"] > :not(.empire-main-grid):not(.empire-empty), .empire-shell[data-workspace="leagues"] .empire-main-grid > :not(:last-child) { display: none; }
            .empire-shell[data-workspace="leagues"] .empire-main-grid, .empire-shell[data-workspace="assets"] .empire-main-grid { grid-template-columns: 1fr; }
            .empire-shell[data-workspace="assets"] > .empire-command-deck, .empire-shell[data-workspace="assets"] > .empire-rolodex, .empire-shell[data-workspace="assets"] .empire-main-grid > :not(:first-child) { display: none; }
            .empire-slice-grid[data-action-view="priority"], .empire-slice-grid[data-action-view="journal"] > .empire-workspace, .empire-slice-grid[data-action-view="journal"] .empire-journal-column > :not([data-testid="empire-decision-journal"]) { display: none; }
            .empire-slice-grid[data-action-view="journal"] { grid-template-columns: 1fr; }
            .empire-main-grid, .empire-floor, .empire-workspace { scroll-margin-top: 150px; }
            @media(max-width:600px) { .empire-workspace-nav { padding: 8px 14px; } .empire-workspace-nav button { padding: 8px 10px; } .empire-workspace-primary { flex-wrap: nowrap; } .empire-workspace-primary svg { display: none; } .empire-workspace-secondary { flex-wrap: nowrap; overflow-x: auto; } .empire-workspace-secondary button { white-space: nowrap; flex-shrink: 0; } }
            .empire-header { position: sticky; top: 0; z-index: 60; background: var(--surf-solid, rgb(7,7,7)); border-bottom: 1px solid var(--acc-line1, rgb(53,45,21)); box-shadow: 0 12px 32px rgb(5,5,7); }
            .empire-topbar { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 24px; border-bottom: 1px solid var(--ov-4, rgb(22,22,24)); box-sizing: border-box; }
            .empire-back, .empire-ghost, .empire-filter, .empire-row-btn, .empire-action { border: 1px solid var(--ov-6, rgb(33,33,35)); background: var(--ov-3, rgb(17,17,20)); color: var(--ov-9, rgb(186,186,187)); border-radius: var(--card-radius-sm); cursor: pointer; font-family: inherit; transition: border-color 120ms, background 120ms, transform 120ms, color 120ms; }
            .empire-back { width: 44px; height: 44px; font-size: var(--text-body, 1rem); }
            .empire-back:hover, .empire-ghost:hover, .empire-filter:hover, .empire-row-btn:hover, .empire-action:hover { border-color: var(--acc-line3, rgb(110,92,33)); background: var(--acc-fill1, rgb(22,20,14)); color: var(--k-f7e9b0, #f7e9b0); }
            .empire-title { display: flex; flex-direction: column; min-width: 0; }
            .empire-title strong { color: var(--gold); font-family: var(--font-body); font-size: 22px; font-weight: 600; letter-spacing: -.025em; line-height: 1.2; }
            .empire-title span { color: var(--ov-9, rgb(127,127,128)); font-size: var(--text-label, 0.75rem); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-user { margin-left: auto; color: var(--ov-9, rgb(144,144,145)); font-size: var(--text-label, 0.75rem); white-space: nowrap; }
            .empire-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 0; padding: 0 24px; background: linear-gradient(90deg, var(--acc-fill1, rgb(19,17,13)), rgb(10,13,16), rgb(12,11,19)); }
            .empire-kpi { min-width: 0; padding: 10px 12px; border-right: 1px solid var(--ov-4, rgb(22,22,24)); }
            .empire-kpi strong { display: block; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; color: var(--white, var(--k-ffffff, #ffffff)); font-size: 1.05rem; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-kpi span { display: block; margin-top: 5px; color: var(--gold); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.11em; text-transform: uppercase; }
            .empire-kpi em { display: block; margin-top: 2px; color: var(--ov-8, rgb(112,112,113)); font-style: normal; font-size: var(--text-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-filters { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
            .empire-filter-label { color: var(--gold); font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; margin-right: 2px; }
            .empire-filter { min-height: 28px; padding: 5px 10px; font-size: var(--text-label, 0.75rem); font-weight: 800; color: var(--ov-9, rgb(136,136,138)); }
            .empire-filter.is-active { border-color: var(--tone, var(--k-d4af37, #d4af37)); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 16%, #08080b); color: var(--tone, var(--k-d4af37, #d4af37)); }
            .empire-clear { margin-left: auto; border-color: rgb(93,34,30); color: var(--k-e74c3c, #e74c3c); }
            .empire-shell { max-width: 1440px; margin: 0 auto; padding: 18px 24px 40px; }
            .empire-viewbar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; min-height: 44px; margin-bottom: 12px; padding: 8px 10px; border: 1px solid var(--ov-4, rgb(24,24,27)); border-radius: var(--card-radius); background: rgb(6,6,8); }
            .empire-viewbar-spacer { flex: 1 1 auto; }
            .empire-filter-toggle { display: inline-flex; align-items: center; gap: 7px; }
            .empire-filter-toggle b { display: inline-grid; min-width: 18px; height: 18px; place-items: center; padding: 0 4px; border-radius: 99px; background: var(--gold); color: var(--black); font: 900 var(--text-micro) / 18px var(--font-mono); }
            .empire-advanced-filters { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; margin: -4px 0 12px; padding: 12px; border: 1px solid var(--acc-fill2, rgb(32,28,16)); border-radius: var(--card-radius); background: linear-gradient(180deg, rgb(15,14,13), rgb(12,12,15)); }
            .empire-filter-group { min-width: 0; }
            .empire-filter-group .empire-filter-label { display: block; margin: 0 0 8px; }
            .empire-filter-group .empire-filters { align-items: stretch; }
            .empire-command-deck { display: grid; grid-template-columns: minmax(300px,0.78fr) minmax(460px,1.22fr); gap: 12px; margin-bottom: 12px; align-items: stretch; }
            .empire-command-deck .empire-panel { padding: 16px; }
            .empire-command-primary { position: relative; overflow: hidden; background: radial-gradient(circle at 92% 5%, rgb(25,23,47), #08080b 42%), linear-gradient(135deg, rgb(24,21,15), rgb(12,12,15)); }
            .empire-command-primary::after { content: ''; position: absolute; right: -34px; bottom: -58px; width: 180px; height: 180px; border: 1px solid rgb(26,23,15); border-radius: 50%; pointer-events: none; }
            .empire-command-kicker { color: var(--gold); font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
            .empire-command-focus { position: relative; z-index: 1; margin: 9px 0 14px; color: var(--white, #fff); font-family: var(--font-body); font-size: clamp(1.25rem, 2vw, 1.75rem); line-height: 1.4; letter-spacing: -.025em; }
            .empire-command-meta { position: relative; z-index: 1; color: var(--ov-9, rgb(151,151,153)); font-size: var(--text-label, 0.75rem); line-height: 1.45; }
            .empire-priority-list { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; }
            .empire-priority-list .empire-signal { min-height: 112px; display: flex; flex-direction: column; }
            .empire-priority-list .empire-signal-top { align-items: flex-start; }
            .empire-priority-list .empire-signal-top strong { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
            .empire-priority-list .empire-signal span { flex: 1; }
            .empire-section-footer { display: flex; justify-content: flex-end; margin-top: 9px; }
            /* ── Terminal chrome: left rail + Empire Wire ticker + LIVE ── */
            .empire-root.is-terminal { padding-left: 52px; box-sizing: border-box; }
            .empire-rail { position: fixed; left: 0; top: 0; bottom: 0; width: 52px; z-index: 80;
                background: linear-gradient(180deg, var(--off-black, #070707), rgb(7,7,7));
                border-right: 1px solid var(--acc-line1, rgb(53,45,21));
                display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0; }
            .empire-rail-btn { position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
                border: 1px solid transparent; border-radius: var(--card-radius-sm, 8px); background: transparent;
                color: var(--ov-9, rgb(144,144,145)); font-size: 1.15rem; cursor: pointer; transition: all 0.15s; }
            .empire-rail-btn:hover { color: var(--gold); border-color: var(--acc-line2, rgb(69,58,24)); background: var(--acc-fill1, rgb(20,18,14)); }
            .empire-rail-btn:first-child { color: var(--gold); border-color: var(--acc-line1, rgb(53,45,21)); background: var(--acc-fill1, rgb(18,16,13)); }
            .empire-rail-btn::after { content: attr(aria-label); position: absolute; left: 45px; top: 50%; z-index: 100; transform: translate(6px,-50%); width: max-content; max-width: 190px; padding: 6px 9px; border: 1px solid var(--acc-line2, rgb(69,58,24)); border-radius: var(--card-radius-sm); background: rgb(7,7,7); box-shadow: 0 8px 22px rgb(4,4,6); color: var(--k-f7e9b0, #f7e9b0); font-size: var(--text-label, 0.75rem); font-weight: 800; pointer-events: none; opacity: 0; transition: opacity 120ms, transform 120ms; }
            .empire-rail-btn:hover::after, .empire-rail-btn:focus-visible::after { opacity: 1; transform: translate(0,-50%); }
            .empire-rail-spacer { flex: 1; }
            .empire-live { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.12em; color: var(--good); text-transform: uppercase; }
            .empire-live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--good); animation: empire-pulse 1.8s infinite; }
            .empire-live.is-stale { color: var(--ov-9, rgb(144,144,145)); }
            .empire-live.is-stale::before { background: var(--ov-7, rgb(90,90,92)); animation: none; }
            @keyframes empire-pulse { 0% { box-shadow: 0 0 0 0 rgb(27,106,62); } 70% { box-shadow: 0 0 0 6px rgb(8,8,11); } 100% { box-shadow: 0 0 0 0 rgb(8,8,11); } }
            .empire-wire { overflow: hidden; white-space: nowrap; min-height: 28px; margin-top: 18px; background: rgb(8,8,12); border: 1px solid var(--ov-5, rgb(30,30,33)); border-radius: var(--card-radius-sm); padding: 5px 0; display: flex; align-items: center; position: relative; z-index: 1; }
            .empire-wire-tag { position: relative; z-index: 2; flex-shrink: 0; padding: 0 14px; font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.14em; color: var(--gold); text-transform: uppercase; background: rgb(8,8,12); border-right: 1px solid var(--ov-4, rgb(28,28,31)); }
            .empire-wire-track { position: relative; z-index: 1; display: inline-block; white-space: nowrap; animation: empire-wire-scroll 48s linear infinite; }
            .empire-wire:hover .empire-wire-track { animation-play-state: paused; }
            .empire-wire-item { display: inline-block; padding: 0 22px; font-size: var(--text-label, 0.75rem); color: var(--ov-9, rgb(161,161,162)); }
            .empire-wire-item::before { content: '\\25C6'; color: var(--acc-line3, rgb(110,92,33)); margin-right: 22px; font-size: 0.6rem; vertical-align: middle; }
            @keyframes empire-wire-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
            /* Touch replacement for the rail. Hidden on desktop (the rail is
               always visible there); below 1024px it's the only way into
               Empire Index / Threat / War Table / Outlook / Provinces / Scout. */
            .empire-sections-btn { display: none; align-items: center; gap: 6px; flex-shrink: 0;
                min-height: 34px; padding: 6px 11px; border: 1px solid var(--acc-line2, rgb(69,58,24));
                border-radius: var(--card-radius-sm, 8px); background: var(--acc-fill1, rgb(20,18,14));
                color: var(--k-f7e9b0, #f7e9b0); font-family: inherit; font-size: var(--text-label, 0.75rem);
                font-weight: 800; letter-spacing: 0.04em; cursor: pointer; }
            .empire-sections-btn.is-active { color: var(--off-black, #070707); background: var(--gold); border-color: var(--gold); }
            /* Lives inside the sticky header, so it caps its own height rather
               than pushing the KPI strip off a phone screen. */
            .empire-sections-sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;
                margin: 10px 14px 12px; padding: 10px; max-height: 46vh; overflow-y: auto;
                border: 1px solid var(--acc-line1, rgb(53,45,21));
                border-radius: var(--card-radius, 10px); background: var(--ov-1, rgb(14,14,17)); }
            .empire-section-tile { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 10px;
                border: 1px solid var(--ov-5, rgb(30,30,33)); border-radius: var(--card-radius-sm, 8px);
                background: var(--ov-2, rgb(18,18,21)); color: var(--ov-9, rgb(161,161,162));
                font-family: inherit; font-size: var(--text-label, 0.75rem); font-weight: 700; text-align: left; cursor: pointer; }
            .empire-section-tile svg { flex-shrink: 0; color: var(--gold); }
            .empire-section-tile span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-section-tile:active { border-color: var(--acc-line3, rgb(110,92,33)); color: var(--white, var(--k-ffffff, #fff)); }
            @media (max-width: 479px) { .empire-sections-btn span { display: none; } .empire-sections-btn { padding: 6px 9px; } }
            @media (min-width: 560px) { .empire-sections-sheet { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            @media (min-width: 768px) { .empire-sections-sheet { margin-left: 24px; margin-right: 24px; } }
            @media (max-width: 1023px) { .empire-root.is-terminal { padding-left: 0; } .empire-rail { display: none; } .empire-sections-btn { display: inline-flex; } }
            @media (min-width: 1024px) { .empire-sections-sheet { display: none; } }
            /* ── Asset Floor: exposure matrix + DHQ heat tiles ── */
            .empire-floor-matrix { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 6px; margin-bottom: 12px; }
            .empire-expo-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(60px, 1fr) auto; gap: 10px; align-items: center; text-align: left; border: 1px solid var(--ov-4, rgb(25,25,28)); background: var(--ov-1, rgb(14,14,17)); border-radius: var(--card-radius-sm, 8px); padding: 7px 10px; cursor: pointer; color: inherit; font-family: inherit; }
            .empire-expo-row:hover { border-color: var(--acc-line3, rgb(90,75,29)); }
            .empire-expo-name strong { display: block; color: var(--white, var(--k-ffffff, #fff)); font-size: var(--text-label, 0.75rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-expo-name span { display: block; color: var(--ov-8, rgb(132,132,133)); font-size: var(--text-micro); }
            .empire-expo-track { height: 6px; background: var(--ov-4, rgb(28,28,31)); border-radius: 3px; overflow: hidden; }
            .empire-expo-fill { height: 100%; border-radius: 3px; }
            .empire-expo-row b { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); white-space: nowrap; }
            .empire-tilegrid { display: flex; flex-wrap: wrap; gap: 4px; }
            .empire-tile { flex: 1 1 70px; min-width: 64px; max-width: 170px; min-height: 46px; display: flex; flex-direction: column; justify-content: center; border: 1px solid var(--ov-5, rgb(28,28,31)); border-radius: var(--card-radius-sm, 8px); background: var(--ov-1, rgb(14,14,17)); padding: 6px 8px; cursor: pointer; overflow: hidden; }
            .empire-tile:hover { background: var(--ov-2, rgb(18,18,21)); }
            .empire-tile-name { font-size: var(--text-micro); color: var(--white, var(--k-ffffff, #fff)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-tile-dhq { font-size: var(--text-micro); font-family: var(--font-mono); color: var(--ov-9, rgb(161,161,162)); margin-top: 2px; }
.empire-threat-row { display: grid; grid-template-columns: 28px minmax(120px, 1.2fr) minmax(120px, 1fr) minmax(120px, 0.9fr) minmax(160px, 1.4fr); gap: 12px; align-items: center; text-align: left; border: 1px solid var(--ov-4, rgb(25,25,28)); border-left: 3px solid var(--tone, var(--gold)); background: var(--ov-1, rgb(14,14,17)); border-radius: var(--card-radius-sm, 8px); padding: 9px 12px; cursor: pointer; color: inherit; font-family: inherit; width: 100%; }
            .empire-threat-row:hover { border-color: var(--acc-line3, rgb(90,75,29)); background: var(--ov-2, rgb(19,19,22)); }
            .empire-threat-rank { font-family: var(--font-mono); font-size: 1.05rem; font-weight: 900; color: var(--tone, var(--gold)); text-align: center; }
            .empire-threat-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
            .empire-threat-id strong { color: var(--white); font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .empire-threat-id span { color: var(--silver); font-size: var(--text-micro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .empire-threat-tags { display: flex; flex-wrap: wrap; gap: 4px 8px; }
            .empire-threat-tags em { font-style: normal; font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
            .empire-threat-meter { display: flex; align-items: center; gap: 8px; }
            .empire-threat-meter .empire-expo-track { flex: 1; }
            .empire-threat-meter b { font-size: 0.85rem; white-space: nowrap; }
            .empire-threat-counter { font-size: var(--text-label, 0.75rem); color: var(--silver); line-height: 1.4; }
            @media (max-width: 720px) {
                .empire-threat-row { grid-template-columns: 24px 1fr auto; grid-template-areas: 'rank id meter' 'tags tags tags' 'counter counter counter'; gap: 6px 10px; }
                .empire-threat-rank { grid-area: rank; }
                .empire-threat-id { grid-area: id; }
                .empire-threat-meter { grid-area: meter; min-width: 90px; }
                .empire-threat-tags { grid-area: tags; }
                .empire-threat-counter { grid-area: counter; }
            }
.empire-provmap { display: flex; flex-wrap: wrap; gap: 6px; }
            .empire-prov-tile { flex: 1 1 150px; min-width: 140px; max-width: 320px; min-height: 92px; display: flex; flex-direction: column; justify-content: space-between; gap: 6px; border: 1px solid var(--tone, var(--silver)); border-left-width: 3px; border-radius: var(--card-radius-sm, 8px); background: var(--ov-1, rgb(14,14,17)); padding: 8px 10px; cursor: pointer; overflow: hidden; text-align: left; transition: background 0.12s ease; }
            .empire-prov-tile:hover { background: var(--ov-2, rgb(18,18,21)); }
            .empire-prov-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
            .empire-prov-name { font-size: var(--text-label, 0.75rem); color: var(--white, #fff); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-prov-status { font-size: var(--text-micro); color: var(--tone, var(--silver)); flex: none; text-transform: uppercase; letter-spacing: 0.04em; }
            .empire-prov-mid { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--text-micro); color: var(--ov-9, rgb(161,161,162)); }
            .empire-prov-tier { font-weight: 600; }
            .empire-prov-rank { font-family: var(--font-mono); }
            .empire-prov-rec { font-family: var(--font-mono); }
            .empire-prov-foot { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
            .empire-prov-dhq { font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); color: var(--white, #fff); }
            .empire-prov-health { font-family: var(--font-mono); font-size: var(--text-micro); color: var(--ov-9, rgb(161,161,162)); }
            .empire-main-grid { display: grid; grid-template-columns: minmax(270px, 0.84fr) minmax(420px, 1.34fr) minmax(290px, 0.92fr); gap: 12px; align-items: start; }
            .empire-bridge { display: grid; grid-template-columns: minmax(320px, 1.05fr) minmax(280px, 0.95fr); gap: 12px; margin-bottom: 12px; align-items: start; }
            .empire-brief { display: flex; gap: 11px; }
            .empire-brief-av { width: 38px; height: 38px; flex: 0 0 auto; border-radius: var(--card-radius, 10px); background: linear-gradient(135deg, var(--k-7c6bf8, #7c6bf8), var(--k-4ecdc4, #4ecdc4)); display: grid; place-items: center; font-family: var(--font-title); font-weight: 700; font-size: 1.05rem; color: var(--k-0a0a0c, #0a0a0c); }
            .empire-brief-meta { color: var(--purple); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
            .empire-brief-body { color: var(--ov-9, rgb(176,176,177)); font-size: var(--text-body, 1rem); line-height: 1.5; margin-top: 5px; }
            .empire-rolodex { margin-bottom: 12px; }
            .empire-rolodex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
            .empire-panel { min-width: 0; border: 1px solid var(--ov-6, rgb(37,37,40)); background: var(--surf-solid, #111114); border-radius: var(--card-radius-lg); padding: 20px; }
            .empire-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid var(--ov-6, rgb(32,32,35)); }
            .empire-panel-head strong { color: var(--white); font-family: var(--font-body); font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
            .empire-panel-head em { color: var(--ov-9, rgb(122,122,123)); font-style: normal; font-size: var(--text-label, 0.75rem); text-align: right; }
            .empire-stack { display: flex; flex-direction: column; gap: 8px; }
            .empire-bar-row { display: grid; grid-template-columns: 52px minmax(0,1fr) 46px; gap: 8px; align-items: center; color: var(--ov-9, rgb(161,161,162)); font-size: var(--text-label, 0.75rem); min-width: 0; }
            .empire-bar-row strong { color: var(--bar, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-track { height: 8px; border-radius: 99px; background: var(--ov-4, rgb(22,22,24)); overflow: hidden; }
            .empire-fill { height: 100%; border-radius: 99px; background: var(--bar, var(--k-d4af37, #d4af37)); min-width: 2px; }
            .empire-signal { text-align: left; border: 1px solid var(--ov-4, rgb(25,25,28)); border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); background: var(--ov-2, rgb(14,14,17)); color: inherit; border-radius: var(--card-radius-sm); padding: 10px; cursor: pointer; font-family: inherit; }
            .empire-signal:hover { border-color: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 56%, var(--ov-5, rgb(28,28,31))); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 7%, #08080b); }
            .empire-signal-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
            .empire-signal strong { color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-body, 1rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-signal b { color: var(--tone, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-body, 1rem); white-space: nowrap; }
            .empire-signal span { display: block; color: var(--ov-9, rgb(151,151,153)); font-size: var(--text-label, 0.75rem); line-height: 1.35; margin-top: 4px; }
            .empire-signal em { display: block; color: var(--tone, var(--k-d4af37, #d4af37)); font-style: normal; font-size: var(--text-micro); margin-top: 6px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
            .empire-move-card { border: 1px solid var(--ov-4, rgb(25,25,28)); border-left: 3px solid var(--tone, var(--gold)); background: var(--ov-2, rgb(14,14,17)); border-radius: var(--card-radius-sm); padding: 11px; }
            .empire-move-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
            .empire-move-head strong { color: var(--white); font-size: var(--text-body, 1rem); line-height: 1.35; }
            .empire-move-head b { flex: none; color: var(--tone, var(--gold)); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); }
            .empire-move-card > p { margin: 5px 0 0; color: var(--ov-9, rgb(151,151,153)); font-size: var(--text-label, 0.75rem); line-height: 1.45; }
            .empire-move-meta { margin-top: 7px; color: var(--tone, var(--gold)); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; }
            .empire-decision-controls { display: grid; grid-template-columns: minmax(120px,0.8fr) minmax(130px,0.8fr) minmax(110px,0.65fr) auto; gap: 7px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--ov-4, rgb(24,24,27)); }
            .empire-decision-controls select, .empire-decision-controls input, .empire-decision-note { min-width: 0; box-sizing: border-box; border: 1px solid var(--ov-6, rgb(33,33,35)); border-radius: var(--card-radius-sm); background: rgb(5,5,7); color: var(--white); font: 700 var(--text-label, 0.75rem) var(--font-body); padding: 7px 9px; }
            .empire-decision-note { width: 100%; min-height: 58px; margin-top: 7px; resize: vertical; font-weight: 500; line-height: 1.4; }
            .empire-decision-row { border-left: 3px solid var(--tone, var(--gold)); padding: 8px 10px; background: var(--ov-1, rgb(14,14,17)); border-radius: var(--card-radius-sm); }
            .empire-decision-row strong { display: block; color: var(--white); font-size: var(--text-label, 0.75rem); line-height: 1.35; }
            .empire-decision-row span { display: block; margin-top: 4px; color: var(--ov-9, rgb(136,136,138)); font-size: var(--text-micro); }
            .empire-league-card { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; text-align: left; border: 1px solid var(--ov-4, rgb(25,25,28)); border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); background: var(--ov-1, rgb(14,14,17)); border-radius: var(--card-radius-sm); padding: 9px; color: inherit; cursor: pointer; font-family: inherit; }
            .empire-league-card:hover { border-color: var(--acc-line3, rgb(106,88,32)); background: var(--acc-fill1, rgb(17,16,13)); }
            .empire-league-card strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-body, 1rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card span, .empire-league-card em { display: block; color: var(--ov-9, rgb(136,136,138)); font-size: var(--text-label, 0.75rem); font-style: normal; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card b { color: var(--tone, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); white-space: nowrap; }
            .empire-health-mini { display: flex; align-items: center; justify-content: flex-end; gap: 5px; margin-top: 5px; }
            .empire-health-track { width: 42px; height: 4px; border-radius: 2px; background: var(--ov-4, rgb(33,33,35)); overflow: hidden; flex: none; }
            .empire-health-fill { height: 100%; border-radius: 2px; }
            .empire-health-num { font-family: var(--font-mono); font-size: var(--text-micro); white-space: nowrap; }
            .empire-quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 12px; }
            .empire-quality { border: 1px solid var(--ov-4, rgb(24,24,27)); background: rgb(7,7,9); border-radius: var(--card-radius-sm); padding: 9px; border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); min-width: 0; }
            .empire-quality span { display: block; color: var(--ov-9, rgb(132,132,133)); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
            .empire-quality strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-label, 0.75rem); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-quality em { display: block; color: var(--ov-9, rgb(136,136,138)); font-style: normal; font-size: var(--text-label, 0.75rem); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-workspace { margin-top: 12px; border: 1px solid var(--acc-fill3, rgb(37,31,17)); border-radius: var(--card-radius); background: var(--ov-1, rgb(12,12,15)); overflow: hidden; }
            .empire-workspace-head, .empire-table-head, .empire-asset-row { display: grid; grid-template-columns: minmax(180px,1.3fr) 46px 54px 76px 78px 72px minmax(140px,1fr); gap: 8px; align-items: center; }
            .empire-workspace-head { display: flex; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid var(--ov-6, rgb(32,32,35)); }
            .empire-workspace-head strong { color: var(--white); font-family: var(--font-body); font-size: 18px; font-weight: 600; letter-spacing: -.02em; }
            .empire-sort-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
            .empire-ghost { padding: 5px 9px; font-size: var(--text-label, 0.75rem); font-weight: 800; }
            .empire-ghost.is-active { color: var(--gold); border-color: var(--acc-line3, rgb(100,83,31)); background: var(--acc-fill2, rgb(24,21,15)); }
            .empire-table-head { padding: 7px 12px; color: var(--gold); background: var(--acc-fill1, rgb(17,16,13)); font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-asset-row { width: 100%; min-height: 34px; border: 0; border-bottom: 1px solid var(--ov-3, rgb(17,17,20)); background: transparent; color: var(--ov-9, rgb(171,171,172)); padding: 6px 12px; text-align: left; font-family: inherit; font-size: var(--text-label, 0.75rem); cursor: pointer; }
            .empire-asset-row:nth-child(even) { background: var(--ov-1, rgb(11,11,14)); }
            .empire-asset-row:hover { background: var(--acc-fill1, rgb(19,17,13)); }
            .empire-player-cell { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .empire-player-cell img { width: 22px; height: 22px; object-fit: cover; border-radius: 50%; flex: 0 0 auto; }
            .empire-player-cell strong, .empire-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .empire-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; border-radius: var(--card-radius-sm); padding: 2px 5px; color: var(--tone, var(--k-d4af37, #d4af37)); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 16%, #08080b); font-size: var(--text-micro); font-weight: 900; }
            .empire-empty { border: 1px dashed var(--acc-line1, rgb(53,45,21)); border-radius: var(--card-radius); padding: 20px; text-align: center; color: var(--ov-9, rgb(146,146,148)); font-size: var(--text-body, 1rem); }
            .empire-empty strong { display: block; color: var(--gold); font-family: var(--font-title); font-size: 1rem; margin-bottom: 5px; }
            .empire-detail { max-width: 1380px; margin: 0 auto; padding: 18px 24px 42px; }
            .empire-detail-hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 18px; align-items: center; border: 1px solid var(--acc-fill3, rgb(45,38,19)); background: linear-gradient(135deg, var(--acc-fill1, rgb(22,20,14)), rgb(10,14,16), rgb(12,11,19)); border-radius: var(--card-radius); padding: 14px; margin-bottom: 12px; }
            .empire-detail-hero h1 { margin: 0; color: var(--white, var(--k-ffffff, #ffffff)); font-family: var(--font-title); font-size: 1.45rem; letter-spacing: 0.04em; }
            .empire-detail-hero p { margin: 4px 0 0; color: var(--ov-9, rgb(151,151,153)); font-size: var(--text-body, 1rem); }
            .empire-detail-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 8px; margin-bottom: 12px; }
            .empire-metric { border: 1px solid var(--ov-4, rgb(24,24,27)); background: var(--ov-1, rgb(14,14,17)); border-radius: var(--card-radius-sm); padding: 9px; min-width: 0; }
            .empire-metric span { display: block; color: var(--ov-9, rgb(132,132,133)); font-size: var(--text-micro); text-transform: uppercase; letter-spacing: 0.09em; font-weight: 800; }
            .empire-metric strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-family: var(--font-mono); font-size: var(--text-body, 1rem); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-action { padding: 7px 11px; font-size: var(--text-label, 0.75rem); font-weight: 900; color: var(--gold); border-color: var(--acc-line2, rgb(73,61,25)); background: var(--acc-fill1, rgb(21,19,14)); }
            .empire-slice-grid { display: grid; grid-template-columns: minmax(260px,0.7fr) minmax(0,1.3fr); gap: 12px; }
            @media(max-width:1439px) {
                .empire-main-grid { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
                .empire-center { grid-column: 1 / -1; grid-row: 1; }
                .empire-command-deck { grid-template-columns: minmax(280px,0.7fr) minmax(0,1.3fr); }
                .empire-workspace-head, .empire-table-head, .empire-asset-row { grid-template-columns: minmax(150px,1fr) 42px 46px 66px 66px 56px minmax(110px,0.8fr); }
            }
            @media(max-width:1023px) {
                .empire-main-grid, .empire-slice-grid, .empire-bridge, .empire-command-deck { grid-template-columns: 1fr; }
                .empire-advanced-filters { grid-template-columns: 1fr; }
                .empire-priority-list { grid-template-columns: 1fr; }
                .empire-priority-list .empire-signal { min-height: 0; }
                .empire-decision-controls { grid-template-columns: 1fr 1fr; }
                .empire-workspace-head { align-items: flex-start; flex-direction: column; }
                .empire-table-head, .empire-asset-row { grid-template-columns: minmax(140px,1fr) 40px 46px 58px 58px; }
                .empire-table-head div:nth-child(n+6), .empire-asset-row div:nth-child(n+6) { display: none; }
                .empire-detail-hero { grid-template-columns: 1fr; }
            }
            @media(max-width:767px) {
                .empire-topbar { padding: 9px 14px; }
                .empire-kpis { display: flex; overflow-x: auto; padding-left: 14px; padding-right: 14px; scroll-snap-type: x proximity; }
                .empire-kpi { flex: 0 0 138px; scroll-snap-align: start; }
                .empire-shell, .empire-detail { padding-left: 14px; padding-right: 14px; }
                .empire-user { display: none; }
                .empire-live { display: none; }
                .empire-title span { display: none; }
                .empire-viewbar { flex-wrap: nowrap; overflow-x: auto; }
                .empire-viewbar-spacer { display: none; }
                .empire-wire { display: none; }
                .empire-decision-controls { grid-template-columns: 1fr; }
            }
            @media(pointer: coarse) {
                .empire-back { width: 44px; min-height: 44px; }
                .empire-filter { min-height: 44px; padding: 12px 10px; }
                .empire-ghost { min-height: 44px; padding: 12px 9px; }
                .empire-action { min-height: 44px; padding: 12px 11px; }
                .empire-asset-row { min-height: 44px; }
            }
        `}</style>
    );
}

function EmpireSecondaryDetails({ active, children }) {
    return active ? <details className="empire-secondary-details"><summary>Portfolio insights & supporting detail</summary>{children}</details> : <React.Fragment>{children}</React.Fragment>;
}

function useEmpireDecisionJournal(api) {
    const [tick, setTick] = React.useState(0);
    const [drafts, setDrafts] = React.useState({});
    const [failure, setFailure] = React.useState(null);
    const pending = React.useRef({});
    const failed = React.useRef({});
    const edit = (id, patch) => {
        pending.current = { ...pending.current, [id]: { ...pending.current[id], ...patch } };
        setDrafts(pending.current);
    };
    const intentKey = intent => intent.type + ':' + (intent.id || JSON.stringify(intent.move));
    const publishFailure = () => setFailure(Object.values(failed.current)[0] || null);
    const commit = (intent, retry = false) => {
        if (intent.type === 'update' && !retry) edit(intent.id, intent.patch);
        try {
            let result;
            if (intent.type === 'track') result = api?.track?.(intent.move, { nowMs: Date.now() });
            else if (intent.type === 'update') result = api?.update?.(intent.id, pending.current[intent.id], { nowMs: Date.now() });
            else if (intent.type === 'remove') result = api?.remove?.(intent.id);
            if (!result) throw new Error('The decision could not be saved. Reload your account and retry.');
            if (intent.id) { const next = { ...pending.current }; delete next[intent.id]; pending.current = next; setDrafts(next); }
            const nextFailures = { ...failed.current };
            delete nextFailures[intentKey(intent)];
            if (intent.type === 'remove') {
                for (const key of Object.keys(nextFailures)) if (nextFailures[key].intent.id === intent.id) delete nextFailures[key];
            }
            failed.current = nextFailures; publishFailure(); setTick(value => value + 1); return true;
        } catch (error) {
            failed.current = { ...failed.current, [intentKey(intent)]: { intent, message: error?.message || 'Your decision was not saved. Try again.' } };
            publishFailure();
            return false;
        }
    };
    React.useEffect(() => {
        if (!failure && !Object.keys(drafts).length) return undefined;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [failure, drafts]);
    const hasPending = () => Boolean(Object.keys(failed.current).length || Object.keys(pending.current).length);
    const discard = () => { pending.current = {}; failed.current = {}; setDrafts({}); setFailure(null); };
    const retry = () => { const next = Object.values(failed.current)[0]; return next ? commit(next.intent, true) : false; };
    return { tick, drafts, failure, edit, commit, retry, hasPending, discard };
}

function EmpireDashboard({ allLeagues, playersData, sleeperUserId, onEnterLeague: enterLeague, onBack: leaveEmpire, onRefresh, refreshing, hasNonSleeperLeagues, portfolioCoverage, lensView, onLensView, lensCache, openLenses, onWorkspaceChange, startInEmpire, onStartInEmpire }) {
    const { useState, useMemo, useCallback, useEffect, useRef } = React;
    const emptyFilters = { league: '', status: '', position: '', agePhase: '', tier: '', exposure: '', assetType: '' };
    const [filters, setFilters] = useState(emptyFilters);
    const [sort, setSort] = useState('dhq');
    const [detail, setDetail] = useState(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [workspace, setWorkspace] = useState(openLenses ? 'lenses' : 'overview');
    const [actionView, setActionView] = useState('priority');
    const decisionApi = window.App?.EmpireDecisions || null;
    const decisionJournal = useEmpireDecisionJournal(decisionApi);
    const decisionTick = decisionJournal.tick;
    useEffect(() => window.App.NavigationGuard?.register(() => {
        if (!decisionJournal.hasPending()) return true;
        setDetail({ type: 'moves' }); setActionView('journal');
        return false;
    }), []);
    const onBack = () => {
        if (decisionJournal.hasPending()) { setDetail({ type: 'moves' }); setActionView('journal'); return; }
        leaveEmpire();
    };
    const onEnterLeague = (...args) => {
        if (decisionJournal.hasPending()) { setDetail({ type: 'moves' }); setActionView('journal'); return; }
        enterLeague(...args);
    };
    // Arbitrage board default: owned rows only. The board is sorted
    // mine-first regardless, but a portfolio with a deep player pool can
    // bury your own leverage under market-only rows without this.
    const [arbMineOnly, setArbMineOnly] = useState(true);
    const [arbExpanded, setArbExpanded] = useState(false);
    // Which leagues count toward Empire's totals — a persisted opt-out
    // (setEmpireLeagueOn), distinct from filters.league below (a single-
    // league "show only this one" drill-down lens, not a standing exclude).
    // Never silently collapses to zero leagues, same safety rule Commissioner
    // Office's managedFilter already established for its own toggle.
    const [prefsTick, setPrefsTick] = useState(0);
    const enabledLeagues = useMemo(() => {
        const prefs = readEmpirePrefs();
        const on = (allLeagues || []).filter(l => isEmpireLeagueOn(l.league_id || l.id, prefs));
        return on.length ? on : (allLeagues || []);
    }, [allLeagues, prefsTick]);
    const normPos = window.App?.normPos || (p => p);
    // Dynasty keeps the existing shared DHQ baseline. Seasonal holdings are
    // priced separately for each league by scoring, slots and team count.
    const scores = window.App?.LI?.playerScores || {};
    // Explicit current-season inputs prevent a previously opened historical
    // league from lending its stats/projections to the portfolio.
    const [markData, setMarkData] = useState(null);
    const [markRetry, setMarkRetry] = useState(0);
    useEffect(() => {
        let alive = true;
        setMarkData(null);
        // The single-league bridge may still contain a historical season.
        // Request explicit seasons; never relabel that bridge as today's data.
        fetchEmpireSeasonValuations({
            season: window.S?.nflState?.season || new Date().getFullYear(),
            week: window.S?.nflState?.week,
            fetchProjections: season => window.fetchSeasonProjections?.(season),
            fetchStats: season => window.fetchSeasonStats?.(season),
            isCurrent: () => alive && window.App?.AccountSession?.isCurrent?.() !== false,
        }).then(result => { if (result) setMarkData(result); });
        return () => { alive = false; };
    }, [markRetry]);

    // Live NFL scores for the wire ticker — the same ESPN scoreboard proxy
    // NflContext already uses for matchup context, just read for score/state
    // instead of odds/weather. Refetches every 60s so the "LIVE" badge next
    // to the wire is honest on a Sunday; harmless/no-op the rest of the week
    // since ESPN just keeps returning the same completed/scheduled games.
    const [nflScores, setNflScores] = useState([]);
    useEffect(() => {
        let alive = true;
        const NC = window.App?.NflContext;
        if (!NC?.loadScores) return undefined;
        const tick = async () => {
            const week = window.App?.WeeklyProj?.currentWeek?.() || 1;
            const season = window.S?.nflState?.season;
            try {
                const games = await NC.loadScores(week, season);
                if (alive) setNflScores(games);
            } catch (e) { /* ticker just skips scores this cycle */ }
        };
        tick();
        const id = setInterval(tick, 60000);
        return () => { alive = false; clearInterval(id); };
    }, []);

    const marks = useMemo(() => {
        if (markData?.status !== 'ready') return null;
        try {
            return window.App?.EmpireValues?.build?.({
                leagues: enabledLeagues,
                playersData,
                statsData: markData.stats,
                priorData: markData.prior,
                projectionsData: markData.proj,
                playerScores: window.App?.LI?.playerScores || null,
                myUserId: sleeperUserId,
                season: markData.season,
                week: markData.week,
                requireCurrentEvidence: true,
            }) || null;
        } catch (e) { window.wrLog?.('empire.marks', e); return null; }
    }, [enabledLeagues, playersData, markData, sleeperUserId, window.App?.LI_LOADED]);
    // Does this empire contain any long-horizon league? Dynasty vocabulary
    // (contend/rebuild postures, age lenses) only means something if so.
    const posColors = window.App?.POS_COLORS || {};
    const scoreKey = Object.keys(scores).length + ':' + (window.App?.LI_LOADED ? 'ready' : 'loading');
    const userName = window.S?.user?.display_name || window.S?.user?.username || 'Commander';

    const model = useMemo(() => buildEmpirePortfolioModel({
        allLeagues: enabledLeagues,
        playersData,
        sleeperUserId,
        scores,
        seasonalBooks: marks?.byLeague,
        normPos,
        posLabel: window.App?.posLabel,
        posColors,
        getAgeCurve: window.App?.getAgeCurve,
        peakWindows: window.App?.peakWindows,
        tradeValueTier: window.App?.tradeValueTier,
        assessTeam: typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null,
        nowYear: new Date().getFullYear(),
        liLoaded: !!window.App?.LI_LOADED,
        portfolioCoverage,
    }), [enabledLeagues, playersData, sleeperUserId, scoreKey, portfolioCoverage, marks]);
    const hasLongTerm = model.provinces.some(p => p.format === 'dynasty');

    const rolodex = useMemo(() => buildEmpireRolodex(enabledLeagues, sleeperUserId), [enabledLeagues, scoreKey]);
    const actionQueue = useMemo(() => buildEmpireActionQueue(model, rolodex), [model, rolodex]);
    const briefText = useMemo(() => buildEmpireBrief(model, userName), [model, userName]);
    const empireGrudges = useMemo(() => buildEmpireGrudges(enabledLeagues), [enabledLeagues]);
    const moves = useMemo(() => buildEmpireMoves({ leagues: enabledLeagues, model, scores, playersData, myUserId: sleeperUserId, normPos, tradeEngine: window.App?.TradeEngine, grudges: empireGrudges }), [enabledLeagues, model, scoreKey, empireGrudges]);
    const consolidation = useMemo(() => buildEmpireConsolidation(moves, model), [moves, model]);
    const decisions = useMemo(() => decisionApi?.list?.() || [], [decisionTick]);
    const decisionSummary = useMemo(() => decisionApi?.summary?.(decisions) || { total: 0, active: 0, closed: 0, won: 0, lost: 0, realizedDelta: 0 }, [decisions]);
    const decisionForMove = useCallback((move) => decisionApi?.byMove?.(move) || null, [decisionTick]);
    const trackDecision = move => decisionJournal.commit({ type: 'track', move });
    const updateDecision = (id, patch) => decisionJournal.commit({ type: 'update', id, patch });
    const removeDecision = id => decisionJournal.commit({ type: 'remove', id });
    const empireLeagueIds = useMemo(() => (enabledLeagues || []).map(l => l.id || l.league_id).filter(Boolean), [enabledLeagues]);
    const empireDelta = useMemo(() => (window.WrSnapshots && typeof window.WrSnapshots.empireDelta === 'function') ? window.WrSnapshots.empireDelta(empireLeagueIds) : null, [empireLeagueIds, scoreKey]);
    const bridge = useMemo(() => buildCommandBridge({ model, actionQueue, brief: briefText, empireDelta }), [model, actionQueue, briefText, empireDelta]);

    // ── Season Outlook: playoff/title odds per league ───────────────────
    // Reuses the exact engine + gating Game Day's single-league panel
    // (season-odds-panel.js) already established — App.Luck.build for the
    // weekly-score ledger, App.PlayoffOdds.fetchFuturePairs + .simulate for
    // the Monte Carlo itself — rather than a second implementation. A
    // league only gets real odds once it has at least 2 played weeks (a
    // 0-1-game fitted score distribution is meaningless, same guard the
    // single-league panel uses); CHOPPED leagues (no bracket) and leagues
    // with no playoff bracket configured are skipped entirely rather than
    // shown a fabricated field. Runs once per league id, not on every
    // model recompute.
    const outlookRunRef = useRef({});
    const [seasonOutlook, setSeasonOutlook] = useState({});
    useEffect(() => {
        const Luck = window.App?.Luck, PO = window.App?.PlayoffOdds, WP = window.App?.WeeklyProj;
        if (!Luck || !PO || !WP) return;
        (model?.provinces || []).forEach(p => {
            const lid = p.id;
            if (!lid || outlookRunRef.current[lid]) return;
            if (p.preDraftEmpty || p.isChopped) return;
            const league = p.league;
            const playoffTeams = Number(league?.settings?.playoff_teams) || 0;
            if (playoffTeams <= 0) return;
            outlookRunRef.current[lid] = true;
            setSeasonOutlook(prev => ({ ...prev, [lid]: { status: 'loading' } }));
            (async () => {
                try {
                    const ledger = await Luck.build({ league });
                    const playedWeeks = ledger.weeks.length;
                    const curWk = WP.currentWeek();
                    const pws = Number(league.settings?.playoff_week_start) || 15;
                    const lastReg = Math.max(1, Math.min(18, pws - 1));
                    // Same load-bearing guard as the single-league panel: fewer
                    // than 2 games fitted, or the regular season already over
                    // (curWk past lastReg) — no honest sim to run either way.
                    if (playedWeeks < 2 || curWk > lastReg) {
                        setSeasonOutlook(prev => ({ ...prev, [lid]: { status: 'unavailable', playedWeeks } }));
                        return;
                    }
                    const futurePairs = await PO.fetchFuturePairs({ league, fromWeek: curWk, toWeek: lastReg });
                    const sim = PO.simulate({ league, ledger, futurePairs, myRosterId: p.roster?.roster_id, sims: 10000 });
                    setSeasonOutlook(prev => ({ ...prev, [lid]: { status: sim ? 'ready' : 'unavailable', sim, playedWeeks } }));
                } catch (e) {
                    window.wrLog?.('empire.seasonOutlook', e);
                    setSeasonOutlook(prev => ({ ...prev, [lid]: { status: 'error' } }));
                }
            })();
        });
    }, [model]);

    // ── Trade Desk: reuses the exact single-league TradeCalcTab component
    // (js/trade-calc.js), not a second trade builder — that module is
    // deferred behind the 'trade' module-loader group the same way League
    // Detail's own Trade Center loads it. Kick the load the moment Trade
    // Desk opens (before a league is even picked) so it's usually already
    // warm by the time one is chosen.
    const [tradeModuleReady, setTradeModuleReady] = useState(!!window.wrModuleGroupLoaded?.('trade'));
    useEffect(() => {
        if (detail?.type !== 'tradeDesk' || tradeModuleReady) return;
        window.wrLoadModuleGroup?.('trade')
            .then(() => setTradeModuleReady(true))
            .catch(e => window.wrLog?.('empire.tradeDesk.load', e));
    }, [detail?.type, tradeModuleReady]);

    // Brief "Synced" confirmation on the Refresh button once a refresh
    // (parent-owned: refreshEmpirePortfolio in app.js) completes, so the
    // action has visible closure beyond the button label flipping back.
    const [justSynced, setJustSynced] = useState(false);
    const wasRefreshingRef = useRef(false);
    useEffect(() => {
        if (wasRefreshingRef.current && !refreshing) {
            setJustSynced((!portfolioCoverage || portfolioCoverage.status === 'ready') && model.pickCapital.complete);
            const t = setTimeout(() => setJustSynced(false), 2500);
            wasRefreshingRef.current = false;
            return () => clearTimeout(t);
        }
        wasRefreshingRef.current = !!refreshing;
    }, [refreshing, portfolioCoverage, model.pickCapital.complete]);

    const setFilter = useCallback((key, value) => {
        setFilters(prev => ({ ...prev, [key]: prev[key] === value ? '' : value }));
        setAssetView('players');
        setDetail(null);
    }, []);
    const applyLens = useCallback((nextFilters) => {
        setFilters({ ...emptyFilters, ...nextFilters });
        setAssetView('players');
        setDetail(null);
    }, []);
    const clearFilters = useCallback(() => {
        setFilters(emptyFilters);
        setDetail(null);
    }, []);

    const filtered = useMemo(() => {
        let provinces = model.provinces.slice();
        let assets = model.assets.slice();
        let picks = model.picks.slice();
        if (filters.league) {
            provinces = provinces.filter(p => p.id === filters.league);
            assets = assets.filter(a => a.leagueId === filters.league);
            picks = picks.filter(p => p.leagueId === filters.league);
        }
        if (filters.status) {
            provinces = provinces.filter(p => p.status === filters.status);
            const leagueIds = new Set(provinces.map(p => p.id));
            assets = assets.filter(a => leagueIds.has(a.leagueId));
            picks = picks.filter(p => leagueIds.has(p.leagueId));
        }
        if (filters.position) assets = assets.filter(a => a.pos === filters.position);
        if (filters.agePhase) assets = assets.filter(a => a.agePhase === filters.agePhase);
        if (filters.tier) assets = assets.filter(a => a.tier === filters.tier);
        if (filters.exposure) assets = assets.filter(a => a.exposureCount > 1);
        if (filters.assetType === 'picks') assets = [];
        if (filters.assetType === 'players') picks = [];
        const sorters = {
            dhq: (a, b) => a.valueBasis.localeCompare(b.valueBasis) || (b.value || 0) - (a.value || 0) || b.exposureCount - a.exposureCount || a.name.localeCompare(b.name),
            exposure: (a, b) => b.exposureCount - a.exposureCount || b.dhq - a.dhq || a.name.localeCompare(b.name),
            age: (a, b) => (b.age || 0) - (a.age || 0) || b.dhq - a.dhq,
            league: (a, b) => a.leagueName.localeCompare(b.leagueName) || b.dhq - a.dhq,
            position: (a, b) => a.pos.localeCompare(b.pos) || b.dhq - a.dhq,
        };
        assets.sort(sorters[sort] || sorters.dhq);
        const totalDHQ = assets.reduce((sum, a) => sum + a.dhq, 0);
        // CHOPPED provinces never accrue a W-L record — their wins/losses are
        // permanently 0-0 by format, not "hasn't played yet". Summing them in
        // would silently drag the aggregate win% toward 0 as the season goes
        // on in every OTHER league while this one sits at a structural 0-0.
        const totalRecord = provinces.filter(p => !p.isChopped).reduce((sum, p) => ({ wins: sum.wins + p.wins, losses: sum.losses + p.losses }), { wins: 0, losses: 0 });
        const healths = provinces.map(p => p.healthScore).filter(v => v != null);
        const avgHealth = healths.length ? Math.round(healths.reduce((sum, v) => sum + v, 0) / healths.length) : null;
        return { provinces, assets, picks, totalDHQ, totalRecord, avgHealth };
    }, [model, filters, sort]);

    const activeFilters = Object.values(filters).filter(Boolean).length;
    const hasNoResults = !filtered.provinces.length && !filtered.assets.length && !filtered.picks.length;
    const [phone, setPhone] = useState(Boolean(window.matchMedia?.('(max-width: 767px)').matches));
    const [assetView, setAssetView] = useState('allocation');
    const [assetQuery, setAssetQuery] = useState('');
    const [assetLimit, setAssetLimit] = useState(24);
    useEffect(() => {
        const media = window.matchMedia?.('(max-width: 767px)');
        if (!media) return undefined;
        const update = () => setPhone(media.matches);
        update(); media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    useEffect(() => { setAssetLimit(24); }, [assetQuery, filters]);
    const searchedAssets = filtered.assets.filter(a => !assetQuery.trim() || [a.name, a.leagueName, a.pos].join(' ').toLowerCase().includes(assetQuery.trim().toLowerCase()));
    const assetPageSize = phone ? assetLimit : Math.max(150, assetLimit);
    // Empire Wire ticker — scrolling headline feed from live NFL scores /
    // the portfolio signals / priority queue / moves, in that order (scores
    // lead the same way a real sports ticker does). A live/final game shows
    // its score; a game that hasn't kicked yet shows the kickoff time
    // instead, same as ESPN's own ticker — never a fabricated "0-0".
    const scoreItems = (nflScores || []).slice(0, 8).map(g => {
        if (g.state === 'in') return g.away + ' ' + g.awayScore + ' - ' + g.home + ' ' + g.homeScore + ' · ' + (g.shortDetail || 'Live');
        if (g.state === 'post') return g.away + ' ' + g.awayScore + ', ' + g.home + ' ' + g.homeScore + ' (Final)';
        return g.away + ' @ ' + g.home + ' · ' + (g.shortDetail || 'Scheduled');
    });
    const wireItems = [
        ...scoreItems,
        ...(model.signals || []).filter(s => s.type !== 'data' && s.type !== 'balance').slice(0, 5).map(s => s.title + (s.metric ? ' · ' + s.metric : '')),
        ...(actionQueue || []).slice(0, 3).map(a => a.title),
        ...(moves || []).slice(0, 2).map(m => m.title),
    ].filter(Boolean);
    const shareBasis = model.totals.useValueShare ? 'Dynasty DHQ share' : 'asset count';
    const signalTone = sev => sev === 'high' ? 'var(--k-e74c3c, #e74c3c)' : sev === 'medium' ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)';
    const filterActive = (key, value) => filters[key] === value;
    const rootClassName = 'empire-root wr-mission-v8' + ((new URLSearchParams(window.location.search || '').has('dev') || ['localhost', '127.0.0.1'].includes(window.location.hostname || '')) ? ' is-local-preview' : '');

    const actionForSignal = useCallback((signal) => {
        if (signal.pid) {
            setDetail({ type: 'player', pid: signal.pid });
            return;
        }
        if (signal.detail?.type) {
            setDetail(signal.detail);
            return;
        }
        if (signal.filter) { setWorkspace('assets'); setAssetView('players'); setFilters(prev => ({ ...prev, ...signal.filter })); }
    }, []);

    const actionForQueue = useCallback((action) => {
        if (action.pid) { setDetail({ type: 'player', pid: action.pid }); return; }
        if (action.leagueId) { setDetail({ type: 'league', leagueId: action.leagueId }); return; }
        if (action.sliceDetail?.type) { setDetail(action.sliceDetail); return; }
        if (action.filter) { setWorkspace('assets'); setAssetView('players'); setDetail(null); setFilters(prev => ({ ...prev, ...action.filter })); }
    }, []);

    const workspaceForDetail = ['moves', 'tradeDesk', 'owner'].includes(detail?.type) ? 'actions'
        : ['war', 'outlook', 'provinces', 'threat', 'league'].includes(detail?.type) ? 'leagues'
        : ['lab', 'scout', 'index', 'player', 'slice', 'quality'].includes(detail?.type) ? 'assets' : workspace;
    const openWorkspace = (key) => {
        setWorkspace(key);
        onWorkspaceChange?.(key);
        clearFilters();
        setActionView('priority');
        setAssetView('allocation');
        setAssetQuery('');
        setDetail(key === 'actions' ? { type: 'moves' } : null);
        window.scrollTo({ top: 0, behavior: 'instant' });
    };
    const openWorkspaceView = (group, view) => {
        setWorkspace(group);
        onWorkspaceChange?.(group);
        if (view.type === 'moves') setActionView(view.view || 'priority');
        setDetail(view.type ? { type: view.type, groupBy: 'none', sortBy: 'dhq' } : null);
        if (view.assetView) setAssetView(view.assetView);
        window.scrollTo({ top: 0, behavior: 'instant' });
    };
    const renderWorkspaceNav = () => {
        const groups = [
            { key: 'overview', label: 'Overview', views: [] },
            { key: 'lenses', label: 'Lenses', views: [] },
            { key: 'actions', label: 'Actions', views: [
                { label: 'Priority queue', type: 'moves', view: 'priority' },
                { label: 'Trade opportunities', type: 'moves', view: 'opportunities' },
                { label: 'Decision journal', type: 'moves', view: 'journal' },
                { label: 'Trade Desk', type: 'tradeDesk' },
            ] },
            { key: 'leagues', label: 'Leagues', views: [
                { label: 'League overview' }, { label: 'Competitive windows', type: 'war' },
                { label: 'Season outlook', type: 'outlook' }, { label: 'Rivals', type: 'threat' },
                { label: 'Map', type: 'provinces' },
            ] },
            { key: 'assets', label: 'Assets', views: [
                { label: 'Allocation', assetView: 'allocation' },
                { label: 'Players & picks', assetView: 'players' },
                { label: 'Exposure', assetView: 'exposure' },
                { label: 'Portfolio Lab', type: 'lab' },
                { label: 'Market index', type: 'index' }, { label: 'Rankings', type: 'scout' },
            ] },
        ];
        const group = groups.find(g => g.key === workspaceForDetail);
        return <div className="empire-workspace-nav">
            {model.provinces.some(p => p.format !== 'dynasty') && <details key={markData?.status || 'loading'} data-testid="empire-value-basis" style={{ padding: 12, fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5 }}><summary>{markData?.status === 'unavailable' ? 'Seasonal values unavailable' : model.totals.valueBasis === 'mixed' ? 'Values use different format bases' : 'Values follow league format'}</summary><p>Dynasty holdings use DHQ. Redraft and other seasonal holdings use league-scored current-season values. Keeper season value does not establish keeper surplus; costs, eligibility, and alternatives are required. Age-window and rebuild advice applies only to dynasty. Mixed value bases are never added together.</p>{markData?.status === 'unavailable' ? <div role="status">Seasonal values unavailable. Holdings remain visible and unpriced.<button className="empire-action" type="button" onClick={() => setMarkRetry(value => value + 1)}>Retry seasonal values</button></div> : !markData ? <p>Loading current-season evidence…</p> : <p>Current-season evidence: {markData.season}. Unmatched players and seasons remain unpriced.</p>}</details>}
            {model.coverage.complete === false && <div role="status" data-testid="empire-coverage" style={{ padding: '12px', fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5, color: 'var(--gold)' }}><strong>{portfolioCoverage.knownCount == null ? 'League coverage unverified' : portfolioCoverage.loadedCount + ' of ' + portfolioCoverage.knownCount + ' Sleeper leagues loaded'}</strong><div>Totals and exposure percentages cover the {model.provinces.length} loaded, included league(s). Holdings in unavailable leagues are unknown.{portfolioCoverage.staleCount > 0 ? ' ' + portfolioCoverage.staleCount + ' league(s) use last loaded data.' : ''}</div><button className="empire-action" type="button" disabled={!!refreshing} onClick={onRefresh}>{refreshing ? 'Loading…' : 'Retry league sync'}</button></div>}
            {decisionJournal.failure && <div role="alert" data-testid="empire-decision-save-error" style={{ padding: 12, fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5 }}><strong>Decision not saved</strong><div>{decisionJournal.failure.message} Your edits remain open in this page.</div><button className="empire-action" type="button" onClick={decisionJournal.retry}>Retry saving decision</button><button className="empire-ghost" type="button" onClick={decisionJournal.discard}>Discard unsaved edits</button></div>}
            {!model.pickCapital.complete && model.provinces.length > 0 && <div role="status" data-testid="empire-pick-coverage" style={{ padding: '12px', fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5, color: 'var(--gold)' }}><strong>Pick ownership incomplete</strong><div>{model.pickCapital.verifiedLeagues} of {model.provinces.length} loaded leagues verified.{model.pickCapital.staleLeagues > 0 ? ' ' + model.pickCapital.staleLeagues + ' use saved ownership.' : ''} Unavailable picks are excluded from totals.{model.pickCapital.unknownDraftLeagues > 0 ? ' Current-year draft progress is unverified for ' + model.pickCapital.unknownDraftLeagues + ' league(s); those picks are excluded.' : ''}</div><button className="empire-action" type="button" disabled={!!refreshing} onClick={onRefresh}>{refreshing ? 'Loading…' : 'Retry pick sync'}</button></div>}
            <nav aria-label="Empire workspaces" className="empire-workspace-primary">
                {groups.map(g => <button key={g.key} type="button" data-empire-workspace={g.key} aria-current={group.key === g.key ? 'page' : undefined} onClick={() => openWorkspace(g.key)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: 7, verticalAlign: 'middle' }}>{EMPIRE_ICON_PATHS[({ overview: 'home', lenses: 'target', actions: 'zap', leagues: 'layers', assets: 'briefcase' })[g.key]].map((d, i) => <path key={i} d={d} />)}</svg><span>{g.label}</span></button>)}
            </nav>
            {!!group.views.length && <nav aria-label={group.label + ' views'} className="empire-workspace-secondary">
                {group.views.map(v => <button key={v.label} type="button" aria-current={(v.type ? detail?.type === v.type && (!v.view || actionView === v.view) : !detail && (v.assetView ? assetView === v.assetView : group.key === 'leagues')) ? 'page' : undefined} onClick={() => openWorkspaceView(group.key, v)}>{v.label}</button>)}
            </nav>}
        </div>;
    };

    // Command Bridge KPI tile — renders a buildCommandBridge KPI (value + label + sub + WoW delta).
    const kpiToneColor = (t) => t === 'good' ? 'var(--good)' : t === 'warn' ? 'var(--warn)' : t === 'bad' ? 'var(--bad)' : t === 'gold' ? 'var(--gold)' : undefined;
    const kpiTile = (k) => {
        const d = k.delta;
        const deltaStr = (d && d.pct != null) ? ' ' + (d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '→') + Math.abs(d.pct) + '%' : '';
        const sub = (k.sub || '') + deltaStr;
        return (
            <div className="empire-kpi" key={k.key}>
                <strong style={{ color: kpiToneColor(k.tone) || undefined }}>{k.value}</strong>
                <span>{k.label}</span>
                {sub && <em>{sub}</em>}
            </div>
        );
    };
    const filterButton = (key, value, label, color) => (
        <button
            key={key + ':' + value}
            className={'empire-filter' + (filterActive(key, value) ? ' is-active' : '')}
            style={{ '--tone': color || 'var(--k-d4af37, #d4af37)' }}
            onClick={() => setFilter(key, value)}
            type="button"
        >
            {label}
        </button>
    );
    const lensButton = (label, nextFilters, color) => {
        const active = Object.keys(emptyFilters).every(key => (filters[key] || '') === (nextFilters[key] || ''));
        return (
            <button
                key={label}
                className={'empire-filter' + (active ? ' is-active' : '')}
                style={{ '--tone': color || 'var(--k-d4af37, #d4af37)' }}
                onClick={() => applyLens(nextFilters)}
                type="button"
            >
                {label}
            </button>
        );
    };
    const barRows = (items, filterKey, emptyText) => (
        <div className="empire-stack">
            {items.length ? items.map(item => (
                <button key={item.key} className="empire-row-btn empire-bar-row" type="button" onClick={() => setDetail({ type: 'slice', title: item.label + ' Allocation', filter: { [filterKey]: item.key } })} style={{ '--bar': item.color || 'var(--k-d4af37, #d4af37)', padding: '6px 7px' }}>
                    <strong>{item.label}</strong>
                    <div className="empire-track"><div className="empire-fill" style={{ width: Math.max(2, item.share) + '%' }} /></div>
                    <span>{item.share}%</span>
                </button>
            )) : <div className="empire-empty"><strong>No allocation</strong>{emptyText || 'Nothing matches the current filters.'}</div>}
        </div>
    );
    const qualityItem = (item) => {
        const tone = item.status === 'ready' ? 'var(--k-2ecc71, #2ecc71)' : item.status === 'partial' || item.status === 'loading' ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
        return (
            <div key={item.key} className="empire-quality" style={{ '--tone': tone }}>
                <span>{item.label}</span>
                <strong>{item.status}</strong>
                <em>{item.detail}</em>
            </div>
        );
    };
    const assetRows = (assets, limit) => {
        const rows = assets.slice(0, limit || 120);
        return rows.map(asset => (
            <button
                key={asset.pid + ':' + asset.leagueId}
                type="button"
                className="empire-asset-row"
                data-testid="empire-asset-row"
                onClick={() => setDetail({ type: 'player', pid: asset.pid })}
            >
                <div className="empire-player-cell">
                    <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + asset.pid + '.jpg'} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    <span><strong>{asset.name}</strong><small className="empire-phone-asset-meta">{asset.pos} · {asset.age || "Age unknown"}{asset.age ? " years" : ""} · {asset.agePhaseLabel}<br />{asset.leagueName}{asset.exposureCount > 1 ? ` · In ${asset.exposureCount} leagues` : ""}</small></span>
                </div>
                <div><span className="empire-pill" style={{ '--tone': posColors[asset.pos] || 'var(--k-d4af37, #d4af37)' }}>{asset.pos}</span></div>
                <div>{asset.age || '-'}</div>
                <div>{asset.value != null ? empireCompact(asset.value) + ' ' + asset.valueLabel : 'Value unavailable'}</div>
                <div><span className="empire-pill" style={{ '--tone': asset.agePhaseColor }}>{asset.agePhaseLabel}</span></div>
                <div>{asset.exposureCount > 1 ? asset.exposureCount + 'x' : '-'}</div>
                <div className="empire-truncate">{asset.leagueName}</div>
            </button>
        ));
    };

    const renderPlayerDetail = (pid) => {
        const exposure = model.exposure.find(item => item.pid === pid);
        const firstAsset = model.assets.find(asset => asset.pid === pid);
        if (!exposure && !firstAsset) return null;
        const item = exposure || firstAsset;
        const owned = model.assets.filter(asset => asset.pid === pid);
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Player Portfolio</strong><span>Ownership, exposure, and league context</span></div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{item.name}</h1>
                            <p>{item.pos} - {item.team || 'FA'} - Age {item.age || '?'} - {item.agePhaseLabel || firstAsset?.agePhaseLabel || 'Unknown window'}</p>
                        </div>
                        <button className="empire-action" type="button" onClick={() => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid); }}>Full Player Card</button>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>Valuation basis</span><strong>By league</strong></div>
                        <div className="empire-metric"><span>Exposure</span><strong>{owned.length}/{Math.max(1, model.provinces.length)} leagues</strong></div>
                        <div className="empire-metric"><span>Portfolio Share</span><strong>{model.totals.useValueShare ? empirePercent(owned.reduce((s, a) => s + a.dhq, 0), model.totals.totalDHQ) + '%' : empirePercent(owned.length, Math.max(1, model.assets.length)) + '%'}</strong></div>
                        <div className="empire-metric"><span>Value Tier</span><strong>{item.tier || firstAsset?.tier || 'Unscored'}</strong></div>
                    </div>
                    <section className="empire-panel">
                        <div className="empire-panel-head"><strong>League Ownership</strong><em>{owned.length} roster slots</em></div>
                        <div className="empire-stack">
                            {owned.map(asset => {
                                const province = model.provinces.find(p => p.id === asset.leagueId);
                                return (
                                    <button key={asset.leagueId} className="empire-league-card" style={{ '--tone': province?.tierColor || 'var(--k-d4af37, #d4af37)' }} type="button" onClick={() => setDetail({ type: 'league', leagueId: asset.leagueId })}>
                                        <div>
                                            <strong>{asset.leagueName}</strong>
                                            <span>{province?.tier || 'UNKNOWN'} - {province?.recordLabel || ((province?.wins || 0) + '-' + (province?.losses || 0))} - HP {province?.healthScore ?? 'No read'}</span>
                                            <em>{!province?.assessmentReady ? 'Needs assessment unavailable' : province.needs?.length ? 'Needs: ' + province.needs.join(', ') : 'No critical need flagged'}</em>
                                        </div>
                                        <b>{asset.value != null ? empireCompact(asset.value) + ' ' + asset.valueLabel : 'Value unavailable'}</b>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </main>
            </div>
        );
    };

    const renderLeagueDetail = (leagueId) => {
        const province = model.provinces.find(p => p.id === leagueId);
        if (!province) return null;
        const leagueAssets = model.assets.filter(asset => asset.leagueId === leagueId).sort((a, b) => b.dhq - a.dhq);
        const leaguePicks = model.picks.filter(pick => pick.leagueId === leagueId);
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>League Portfolio</strong><span>{province.name}</span></div>
                        <button className="empire-action" type="button" onClick={() => onEnterLeague(province.league)}>Open League</button>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{province.name}</h1>
                            <p>{province.preDraftEmpty ? 'Pre-Draft' : province.tier} - {province.recordLabel} - rank {province.powerRank || '-'} of {province.teams || '-'}</p>
                        </div>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>{province.valueLabel}</span><strong>{province.totalValue != null ? empireCompact(province.totalValue) : (province.preDraftEmpty ? 'Pre-Draft' : 'Unavailable')}</strong></div>
                        <div className="empire-metric"><span>Health</span><strong>{province.healthScore ?? 'No read'}</strong></div>
                        <div className="empire-metric"><span>Pick Capital</span><strong>{province.pickFeedPresent ? province.pickCount + (province.currentDraftUnknown ? ' known picks' : province.pickFeedReady ? ' picks' : ' saved picks') : 'Unavailable'}</strong></div>
                        <div className="empire-metric"><span>Round 1–2 Picks</span><strong>{province.pickFeedPresent ? province.premiumPickCount : '—'}</strong></div>
                    </div>
                    <div className="empire-slice-grid">
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Roster Direction</strong><em>{province.status}</em></div>
                            <div className="empire-stack">
                                <div className="empire-quality" style={{ '--tone': province.tierColor }}><span>Strengths</span><strong>{!province.assessmentReady ? 'Assessment unavailable' : province.strengths.length ? province.strengths.join(', ') : 'None flagged'}</strong><em>Current roster edge</em></div>
                                <div className="empire-quality" style={{ '--tone': 'var(--k-e74c3c, #e74c3c)' }}><span>Needs</span><strong>{!province.assessmentReady ? 'Assessment unavailable' : province.needs.length ? province.needs.join(', ') : 'None flagged'}</strong><em>Upgrade lanes</em></div>
                                <div className="empire-quality" style={{ '--tone': 'var(--purple)' }}><span>Draft Capital</span><strong>{province.pickFeedPresent ? leaguePicks.length + (province.currentDraftUnknown ? ' known picks' : province.pickFeedReady ? ' picks' : ' saved picks') : 'Unavailable'}</strong><em>{province.pickFeedPresent ? leaguePicks.filter(p => p.acquired).length + ' acquired' : 'Ownership has not been verified'}</em></div>
                            </div>
                        </section>
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Top Assets</strong><span>{leagueAssets.length} players</span></div>
                            <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>Value</div><div>Basis / window</div><div>Exp</div><div>League</div></div>
                            {assetRows(leagueAssets, 80)}
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    const renderSliceDetail = (slice) => {
        const sliceFilters = { ...emptyFilters, ...(slice.filter || {}) };
        let sliceAssets = model.assets.slice();
        let slicePicks = model.picks.slice();
        if (sliceFilters.position) sliceAssets = sliceAssets.filter(a => a.pos === sliceFilters.position);
        if (sliceFilters.agePhase) sliceAssets = sliceAssets.filter(a => a.agePhase === sliceFilters.agePhase);
        if (sliceFilters.tier) sliceAssets = sliceAssets.filter(a => a.tier === sliceFilters.tier);
        if (sliceFilters.status) {
            sliceAssets = sliceAssets.filter(a => a.leagueStatus === sliceFilters.status);
            const ids = new Set(model.provinces.filter(p => p.status === sliceFilters.status).map(p => p.id));
            slicePicks = slicePicks.filter(p => ids.has(p.leagueId));
        }
        if (sliceFilters.assetType === 'picks') sliceAssets = [];
        if (sliceFilters.assetType === 'players') slicePicks = [];
        const sliceDHQ = sliceAssets.reduce((sum, a) => sum + a.dhq, 0);
        const sliceExposure = sliceAssets.filter(a => a.exposureCount > 1).length;
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Portfolio Slice</strong><span>{slice.title || 'Filtered workspace'}</span></div>
                        <button className="empire-action" type="button" onClick={() => { setFilters(sliceFilters); setWorkspace('assets'); setAssetView('players'); setDetail(null); }}>Apply As Filter</button>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{slice.title || 'Portfolio Slice'}</h1>
                            <p>{sliceAssets.length} players - {slicePicks.length} picks - {sliceExposure} multi-league exposures</p>
                        </div>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>Dynasty DHQ in slice</span><strong>{sliceDHQ > 0 ? empireCompact(sliceDHQ) : 'No DHQ'}</strong></div>
                        <div className="empire-metric"><span>Portfolio Share</span><strong>{model.totals.useValueShare ? empirePercent(sliceDHQ, model.totals.totalDHQ) + '%' : empirePercent(sliceAssets.length, Math.max(1, model.assets.length)) + '%'}</strong></div>
                        <div className="empire-metric"><span>Players</span><strong>{sliceAssets.length}</strong></div>
                        <div className="empire-metric"><span>Picks</span><strong>{slicePicks.length}</strong></div>
                    </div>
                    <div className="empire-slice-grid">
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Slice Mix</strong><em>{shareBasis}</em></div>
                            {barRows(model.positionAllocation.filter(p => sliceAssets.some(a => a.pos === p.key)), 'position', 'No positions in this slice.')}
                        </section>
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Assets</strong><span>{sliceAssets.length} rows</span></div>
                            <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>Value</div><div>Basis / window</div><div>Exp</div><div>League</div></div>
                            {sliceAssets.length ? assetRows(sliceAssets.sort((a, b) => b.dhq - a.dhq || b.exposureCount - a.exposureCount), 160) : (
                                <div className="empire-empty"><strong>No players in this slice</strong>{slicePicks.length ? 'This view is focused on draft capital.' : 'Try a different filter.'}</div>
                            )}
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    const renderMovesDetail = () => {
        const sells = moves.filter(m => m.type === 'sell');
        const buys = moves.filter(m => m.type === 'buy');
        const decisionTone = status => status === 'WON' ? 'var(--good)' : status === 'LOST' ? 'var(--bad)' : status === 'PROPOSED' ? 'var(--purple)' : status === 'PASSED' ? 'var(--silver)' : 'var(--gold)';
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Actions</strong><span>Priorities, trade opportunities, and tracked decisions across your leagues</span></div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{actionView === 'priority' ? 'Priority queue' : actionView === 'journal' ? 'Decision journal' : 'Trade opportunities'}</h1>
                            <p>{actionView === 'priority' ? actionQueue.length + ' priorities from your overview' : actionView === 'journal' ? decisionSummary.active + ' active decisions' : moves.length + ' dynasty trade ideas and seasonal exposure reviews'}</p>
                        </div>
                    </section>
                    {actionView === 'priority' && <section className="empire-panel" data-testid="empire-full-priority-queue">
                        <div className="empire-stack">
                            {actionQueue.length ? actionQueue.map((action, i) => {
                                const tracked = decisionForMove(action);
                                return <div key={i} className="empire-move-card" style={{ '--tone': signalTone(action.severity) }}>
                                    <strong>{action.title}</strong><p>{action.detail}</p>
                                    <div className="empire-section-footer">
                                        <button type="button" className="empire-action" onClick={() => actionForQueue(action)}>{action.cta}</button>
                                        <button type="button" className="empire-ghost" onClick={() => tracked ? setActionView('journal') : trackDecision(action)}>{tracked ? 'View tracked decision' : 'Track decision'}</button>
                                    </div>
                                </div>;
                            }) : <div className="empire-empty"><strong>No priorities right now</strong>Your overview and this queue are up to date.</div>}
                        </div>
                    </section>}
                    <div className="empire-detail-metrics" data-testid="empire-decision-summary">
                        <div className="empire-metric"><span>Tracked</span><strong>{decisionSummary.total}</strong></div>
                        <div className="empire-metric"><span>Active</span><strong style={{ color: decisionSummary.active ? 'var(--gold)' : 'var(--good)' }}>{decisionSummary.active}</strong></div>
                        <div className="empire-metric"><span>Closed Record</span><strong>{decisionSummary.won}-{decisionSummary.lost}</strong></div>
                        <div className="empire-metric"><span>Realized Δ</span><strong style={{ color: decisionSummary.realizedDelta >= 0 ? 'var(--good)' : 'var(--bad)' }}>{decisionSummary.realizedDelta > 0 ? '+' : ''}{empireCompact(decisionSummary.realizedDelta)} DHQ</strong></div>
                    </div>
                    {actionView === 'opportunities' && consolidation ? (
                        <section className="empire-panel" style={{ marginBottom: 12 }}>
                            <div className="empire-panel-head"><strong>Consolidation Plan</strong><em>{consolidation.sells} sell → {consolidation.buys} buy · one campaign</em></div>
                            <div className="empire-stack">
                                {consolidation.steps.map((s, i) => (
                                    <div key={i} style={{ border: '1px solid var(--ov-4, rgb(25,25,28))', borderLeft: '3px solid ' + s.tone, borderRadius: 7, padding: 10, background: 'var(--ov-1, rgb(14,14,17))' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                                            <strong style={{ color: 'var(--white, var(--k-ffffff, #ffffff))', fontSize: 'var(--text-body, 1rem)' }}>{s.title}</strong>
                                            <b style={{ color: s.tone, fontFamily: "var(--font-mono)", fontSize: 'var(--text-micro)', fontWeight: 800, letterSpacing: '0.1em' }}>{s.phase}</b>
                                        </div>
                                        <span style={{ display: 'block', color: 'var(--ov-9, rgb(151,151,153))', fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.45, marginTop: 5 }}>{s.detail}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <div className="empire-slice-grid" data-action-view={actionView}>
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Ranked Moves</strong><span>{sells.length} sell · {buys.length} buy</span></div>
                            <div className="empire-stack" style={{ padding: 12 }}>
                                {moves.length ? moves.map((m, i) => {
                                    const d = decisionForMove(m);
                                    const tone = m.type === 'sell' ? 'var(--k-5dade2, #5dade2)' : 'var(--k-2ecc71, #2ecc71)';
                                    return (
                                        <div key={i} className="empire-move-card" data-testid="empire-move-card" style={{ '--tone': tone }}>
                                            <div className="empire-move-head"><strong>{m.title}</strong><b>{m.accept == null ? 'Review' : m.accept + '% modeled accept'}</b></div>
                                            <p>{m.why}</p>
                                            <div className="empire-move-meta">{m.leagueName} · {m.posture}{m.value != null ? ' · +' + empireCompact(m.value) + ' estimated dynasty DHQ' : ' · no trade price assumed'}</div>
                                            {d ? (
                                                <React.Fragment>
                                                    <div className="empire-decision-controls">
                                                        <select aria-label={'Status for ' + m.title} value={decisionJournal.drafts[d.id]?.status ?? d.status} onChange={e => updateDecision(d.id, { status: e.target.value })}>
                                                            {(decisionApi?.STATUSES || []).map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                        <input aria-label={'Review date for ' + m.title} type="date" value={decisionJournal.drafts[d.id]?.reviewAt ?? d.reviewAt ?? ''} onChange={e => updateDecision(d.id, { reviewAt: e.target.value })} />
                                                        <input aria-label={'Realized DHQ for ' + m.title} type="number" value={(decisionJournal.drafts[d.id]?.actualDelta !== undefined ? decisionJournal.drafts[d.id].actualDelta : d.actualDelta) ?? ''} placeholder="Realized Δ" onChange={e => updateDecision(d.id, { actualDelta: e.target.value === '' ? null : e.target.value })} />
                                                        <button className="empire-action" type="button" onClick={() => m.pid && setDetail({ type: 'player', pid: m.pid })}>Player</button>
                                                    </div>
                                                    <textarea className="empire-decision-note" aria-label={'Decision note for ' + m.title} value={decisionJournal.drafts[d.id]?.note ?? d.note ?? ''} onChange={e => decisionJournal.edit(d.id, { note: e.target.value })} placeholder="What are you waiting for? What happened?" onBlur={e => updateDecision(d.id, { note: e.target.value })} />
                                                    <div className="empire-section-footer"><button className="empire-ghost" type="button" onClick={() => removeDecision(d.id)}>Remove from journal</button></div>
                                                </React.Fragment>
                                            ) : (
                                                <div className="empire-section-footer">
                                                    <button className="empire-ghost" type="button" onClick={() => m.pid && setDetail({ type: 'player', pid: m.pid })}>View player</button>
                                                    <button className="empire-action" type="button" onClick={() => trackDecision(m)}>Track decision</button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                }) : (
                                    <div className="empire-empty"><strong>No clear moves yet</strong>Dynasty moves require dynasty assessments. Seasonal exposure reviews require current-season values and concentration; you can also open a league in Trade Desk.</div>
                                )}
                            </div>
                        </section>
                        <div className="empire-stack empire-journal-column">
                            <section className="empire-panel" data-testid="empire-decision-journal">
                                <div className="empire-panel-head"><strong>Decision Journal</strong><em>{decisionSummary.active} active · {decisionSummary.closed} closed</em></div>
                                <div className="empire-stack">
                                    {decisions.length ? (actionView === 'journal' ? decisions : decisions.slice(0, 8)).map(d => (
                                        <div key={d.id} className="empire-decision-row" style={{ '--tone': decisionTone(d.status) }}>
                                            <strong>{d.title}</strong>
                                            <span style={{ color: decisionTone(d.status), fontWeight: 800 }}>{d.status}{d.actualDelta != null ? ' · ' + (d.actualDelta > 0 ? '+' : '') + empireCompact(d.actualDelta) + ' DHQ' : ''}</span>
                                            <span>{d.leagueName}{d.reviewAt ? ' · review ' + d.reviewAt : ''}</span>
                                            <div className="empire-decision-controls">
                                                <select aria-label={'Status for ' + d.title} value={decisionJournal.drafts[d.id]?.status ?? d.status} onChange={e => updateDecision(d.id, { status: e.target.value })}>{(decisionApi?.STATUSES || []).map(status => <option key={status} value={status}>{status}</option>)}</select>
                                                <input type="date" aria-label={'Review date for ' + d.title} value={decisionJournal.drafts[d.id]?.reviewAt ?? d.reviewAt ?? ''} onChange={e => updateDecision(d.id, { reviewAt: e.target.value })} />
                                            </div>
                                            <textarea className="empire-decision-note" aria-label={'Decision note for ' + d.title} value={decisionJournal.drafts[d.id]?.note ?? d.note ?? ''} onChange={e => decisionJournal.edit(d.id, { note: e.target.value })} onBlur={e => updateDecision(d.id, { note: e.target.value })} />
                                            <button type="button" className="empire-ghost" onClick={() => removeDecision(d.id)}>Remove from journal</button>
                                        </div>
                                    )) : <div className="empire-empty"><strong>No tracked decisions</strong>Track a ranked move to preserve the recommendation, set a review date and record the outcome.</div>}
                                </div>
                            </section>
                            <section className="empire-panel">
                                <div className="empire-panel-head"><strong>Owner Rolodex</strong><em>by edge</em></div>
                                <div className="empire-stack">
                                    {rolodex.filter(o => o.exploit >= 6).slice(0, 8).map((o, i) => (
                                        <button key={o.leagueId + ':' + o.ownerId + ':' + i} className="empire-league-card" style={{ '--tone': o.postureColor }} type="button" onClick={() => setDetail({ type: 'owner', ownerId: o.ownerId, leagueId: o.leagueId })}>
                                            <div>
                                                <strong>{o.ownerName}</strong>
                                                <span>{o.leagueName} · {o.posture}</span>
                                                <em>{o.edge}</em>
                                            </div>
                                            <b>{o.exploit}</b>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </div>
                    </div>
                </main>
            </div>
        );
    };

    const renderOwnerHud = (ownerId, leagueId) => {
        const sid = (a, b) => a != null && b != null && String(a) === String(b);
        const league = allLeagues.find(l => sid(l.id || l.league_id, leagueId));
        const assessments = league?.empireAssessments || [];
        const dnaMap = league?.empireDna || {};
        const dynasty = empireLeagueFormat(league) === 'dynasty';
        const ownerRecord = assessments.find(a => sid(a.ownerId, ownerId));
        const theirA = dynasty ? ownerRecord : { ownerId, ownerName: ownerRecord?.ownerName, teamName: ownerRecord?.teamName };
        const myA = dynasty ? assessments.find(a => sid(a.ownerId, sleeperUserId)) : null;
        const dnaKey = dynasty ? dnaMap[ownerId] || 'NONE' : 'NONE';
        const TE = window.App?.TradeEngine || {};
        const posture = (dynasty && TE.calcOwnerPosture ? TE.calcOwnerPosture(theirA, dnaKey) : null) || { key: 'NEUTRAL', label: 'Neutral', color: 'var(--silver)' };
        const taxes = (dynasty && TE.calcPsychTaxes ? TE.calcPsychTaxes(myA, theirA, dnaKey, posture) : []) || [];
        const grudge = (dynasty && TE.calcGrudgeTax ? TE.calcGrudgeTax(myA?.ownerId, ownerId, empireGrudges, dnaKey) : null) || { total: 0, entries: [] };
        const dna = EMPIRE_DNA_META[dnaKey] || EMPIRE_DNA_META.NONE;
        const netMod = taxes.reduce((s, t) => s + (t.impact || 0), 0) + (grudge.total || 0);
        const needList = (theirA?.needs || []).map(n => (typeof n === 'string' ? n : n.pos)).filter(Boolean);
        const tells = [];
        if (theirA?.panic >= 3) tells.push('Panic ' + theirA.panic + '/5 — urgency overrides caution. Strike fast.');
        if (dnaKey === 'DOMINATOR') tells.push('Status-driven — frame your offer as him winning the deal.');
        if (dnaKey === 'ACCEPTOR') tells.push('Discounts current stars — lead with picks and young upside.');
        if (dnaKey === 'FLEECER') tells.push('Hunts surplus — lead with clean value; the math still moves linearly.');
        if (dnaKey === 'STALWART') tells.push('Attached to his roster — never lowball; highlight both-sides upside.');
        if (grudge.total) tells.push('Your trade history shifts his acceptance by ' + (grudge.total > 0 ? '+' : '') + grudge.total + '%.');
        needList.slice(0, 2).forEach(p => tells.push('Needs ' + p + ' — your surplus there is the leverage.'));
        if (!tells.length) tells.push(dynasty ? 'No strong tells — negotiate at fair value.' : 'Review current-season roster fit. Dynasty psychology estimates and keeper surplus are unavailable for this format.');
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Negotiation HUD</strong><span>{theirA?.ownerName || theirA?.teamName || 'Owner'} · {league?.name || 'League'}</span></div>
                        {canOpenEmpireTradeDesk(model.provinces.find(p => String(p.id) === String(leagueId))) && <button className="empire-action" type="button" style={{ marginLeft: 'auto', borderColor: 'rgba(155,138,251,0.4)', color: 'var(--purple)', background: 'rgb(15,13,20)' }} onClick={() => setDetail({ type: 'tradeDesk', leagueId, seedOwnerId: ownerId })}>Propose Trade</button>}
                        {league?.league ? <button className="empire-action" type="button" onClick={() => onEnterLeague(league.league || league)}>Open League</button> : null}
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{theirA?.ownerName || theirA?.teamName || 'Owner'}</h1>
                            <p>{dna.label} · {posture.label || posture.key} · {theirA?.tier || 'tier unknown'}</p>
                        </div>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>Posture</span><strong style={{ color: posture.color || 'var(--gold)' }}>{posture.label || posture.key}</strong></div>
                        <div className="empire-metric"><span>DNA</span><strong>{dna.label}</strong></div>
                        <div className="empire-metric"><span>Net psych + grudge</span><strong style={{ color: netMod > 0 ? 'var(--good)' : netMod < 0 ? 'var(--bad)' : 'var(--silver)' }}>{dynasty ? (netMod > 0 ? '+' : '') + netMod + '%' : 'Unavailable'}</strong></div>
                        <div className="empire-metric"><span>History grudge tax</span><strong>{dynasty ? (grudge.total > 0 ? '+' : '') + (grudge.total || 0) + '%' : 'Unavailable'}</strong></div>
                    </div>
                    <div className="empire-bridge">
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>How To Play It</strong><em>{dna.label}</em></div>
                            <div className="empire-brief"><div className="empire-brief-av">A</div><div><div className="empire-brief-meta">DNA strategy</div><div className="empire-brief-body">{dna.strategy}</div></div></div>
                            <div className="empire-stack" style={{ marginTop: 10 }}>
                                {tells.map((t, i) => <div key={i} className="empire-signal" style={{ '--tone': 'var(--purple)' }}><span>{t}</span></div>)}
                            </div>
                        </section>
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Psych Taxes</strong><em>{taxes.length} active</em></div>
                            <div className="empire-stack">
                                {taxes.length ? taxes.map((t, i) => (
                                    <div key={i} className="empire-signal" style={{ '--tone': t.type === 'BONUS' ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)' }}>
                                        <div className="empire-signal-top"><strong>{t.name}</strong><b style={{ color: t.type === 'BONUS' ? 'var(--good)' : 'var(--bad)' }}>{t.impact > 0 ? '+' : ''}{t.impact}%</b></div>
                                        <span>{t.desc}</span>
                                    </div>
                                )) : <div className="empire-empty"><strong>No psych taxes</strong>Standard negotiation — no exploitable biases flagged.</div>}
                            </div>
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    const renderIndexDetail = () => {
        const idx = buildEmpireIndex({ scores, playersData, positionAllocation: model.positionAllocation, normPos });
        const level = model.totals.totalDHQ || 0;
        const delta = model.totals.valueBasis === 'dynasty' && empireDelta ? empireDelta.totalDHQDelta : null;
        const betaTone = c => c > 1.15 ? 'var(--bad)' : c < 0.85 ? 'var(--good)' : 'var(--gold)';
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Empire Index</strong><span>the dynasty market · dynasty holdings only</span></div>
                        <div className="empire-user">{userName}</div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{empireCompact(level)} <span style={{ fontSize: '1rem', color: 'var(--silver)' }}>index</span></h1>
                            <p>Dynasty DHQ across {model.totals.dynastyLeagues} dynasty leagues {delta != null ? (delta >= 0 ? '· ▲ ' : '· ▼ ') + empireCompact(Math.abs(delta)) + ' wk/wk' : '· trend builds weekly'}</p>
                        </div>
                    </section>
                    <section className="empire-panel">
                        <div className="empire-panel-head"><strong>Position Market</strong><em>avg DHQ · your exposure · β (leverage)</em></div>
                        <div className="empire-floor-matrix" style={{ gridTemplateColumns: '1fr' }}>
                            <div className="empire-table-head" style={{ gridTemplateColumns: '80px 1fr 1.6fr 80px' }}><div>Class</div><div>Mkt Avg</div><div>Your exposure</div><div>β</div></div>
                            {idx.classes.map(c => (
                                <div key={c.pos} className="empire-expo-row empire-ranking-row" style={{ gridTemplateColumns: '80px 1fr 1.6fr 80px', cursor: 'default' }}>
                                    <strong style={{ color: posColors[c.pos] || 'var(--gold)' }}>{c.pos}</strong>
                                    <b style={{ fontFamily: 'var(--font-mono)' }}>{c.mktAvg ? empireCompact(c.mktAvg) : '—'}</b>
                                    <div className="empire-expo-track"><div className="empire-expo-fill" style={{ width: Math.min(100, c.myExposurePct) + '%', background: posColors[c.pos] || 'var(--gold)' }} /></div>
                                    <b style={{ color: betaTone(c.beta), fontFamily: 'var(--font-mono)' }}>{c.beta.toFixed(1)}{c.overweight ? ' ⚠' : ''}</b>
                                </div>
                            ))}
                        </div>
                        <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 10, lineHeight: 1.5 }}>β &gt; 1 = overweight that class vs the market — more upside if it rises, more single-class risk if it falls. The 7-day market trend builds as weekly snapshots accumulate.</p>
                    </section>
                </main>
            </div>
        );
    };

const renderThreatDetail = () => {
  const board = buildThreatBoard({
    leagues: enabledLeagues,
    myUserId: sleeperUserId,
    tradeEngine: (window.App && window.App.TradeEngine) || {},
    dnaMeta: EMPIRE_DNA_META,
  });
  const apex = board.apex;
  const headline = apex ? apex.ownerName : board.count ? 'Seasonal rivals' : 'No rivals yet';
  const sub = apex
    ? `Top threat · ${apex.leagueName} · threat ${apex.threat}/${board.maxThreat || apex.threat}`
    : 'Dynasty threat reads and seasonal roster reviews use different evidence';
  return (
    <div className={rootClassName} data-testid="empire-root">
      <EmpireStyles />
      <div className="empire-header">
                    {renderWorkspaceNav()}
        <div className="empire-topbar">
          <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
          <div className="empire-title"><strong>Threat Board</strong><span>who's coming for your titles · a read on rivals, not a prediction</span></div>
          <div className="empire-user">{userName}</div>
        </div>
      </div>
      <main className="empire-detail">
        <section className="empire-detail-hero">
          <div>
            <h1>{headline}</h1>
            <p>{sub}</p>
          </div>
        </section>
        <div className="empire-detail-metrics">
          <div className="empire-metric"><span>Rivals tracked</span><strong>{board.count}</strong></div>
          <div className="empire-metric"><span>Top-tier threats</span><strong style={{ color: board.topTierCount ? 'var(--bad)' : 'var(--silver)' }}>{board.topTierCount}</strong></div>
          <div className="empire-metric"><span>Aggressive DNA</span><strong style={{ color: board.aggressiveCount ? 'var(--purple)' : 'var(--silver)' }}>{board.aggressiveCount}</strong></div>
          <div className="empire-metric"><span>Peak threat</span><strong style={{ color: 'var(--gold)' }}>{board.maxThreat || '—'}</strong></div>
        </div>
        <section className="empire-panel">
          <div className="empire-panel-head"><strong>Threat Watch</strong><em>top {board.rows.length} · tier · stability · DNA read</em></div>
          {board.rows.length ? (
            <div className="empire-stack">
              {board.rows.map((r, i) => (
                <button
                  key={r.leagueId + ':' + (r.ownerId != null ? r.ownerId : 'orphan') + ':' + i}
                  type="button"
                  className="empire-threat-row"
                  style={{ '--tone': r.tierTone }}
                  onClick={() => setDetail({ type: 'owner', ownerId: r.ownerId, leagueId: r.leagueId })}
                >
                  <div className="empire-threat-rank">{i + 1}</div>
                  <div className="empire-threat-id">
                    <strong>{r.ownerName}</strong>
                    <span>{r.leagueName}</span>
                  </div>
                  <div className="empire-threat-tags">
                    <em style={{ color: r.tierTone }}>{r.tier}</em>
                    <em style={{ color: r.dnaKey ? 'var(--purple)' : 'var(--silver)' }}>{r.dnaLabel || r.postureLabel}</em>
                    <em style={{ color: 'var(--silver)' }}>{r.healthScore == null ? 'Seasonal review' : 'HP ' + r.healthScore}</em>
                  </div>
                  <div className="empire-threat-meter">
                    <div className="empire-expo-track"><div className="empire-expo-fill" style={{ width: Math.min(100, board.maxThreat ? Math.round((r.threat / board.maxThreat) * 100) : 0) + '%', background: r.tierTone }} /></div>
                    <b style={{ color: r.tierTone, fontFamily: 'var(--font-mono)' }}>{r.threat == null ? '—' : r.threat}</b>
                  </div>
                  <div className="empire-threat-counter">{r.counter}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empire-empty"><strong>No rival reads yet</strong>Threat scores build once your leagues finish assessing. Open a league to populate owner tiers and DNA.</div>
          )}
        </section>
        <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 12, lineHeight: 1.5 }}>
          Dynasty threat blends roster tier, health, and stability (a calm contender outranks a panicking one). DNA tags are a behavioral <em>read</em>, not a forecast — treat them as a watch signal and confirm in the Negotiation HUD. Tap any rival to open it.
        </p>
      </main>
    </div>
  );
};

const renderWarDetail = () => {
    const war = buildWarTable({ provinces: model.provinces, empireCompact });
    const s = war.summary;
    return (
        <div className={rootClassName} data-testid="empire-root">
            <EmpireStyles />
            <div className="empire-header">
                    {renderWorkspaceNav()}
                <div className="empire-topbar">
                    <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                    <div className="empire-title"><strong>War Table</strong><span>every league's competitive window · where to push, where to sell</span></div>
                    <div className="empire-user">{userName}</div>
                </div>
            </div>
            <main className="empire-detail">
                <section className="empire-detail-hero">
                    <div>
                        <h1>{s.pushing} pushing <span style={{ fontSize: '1rem', color: 'var(--silver)' }}>·</span> {s.selling} reloading</h1>
                        <p>{s.posture} · {s.total} {s.total === 1 ? 'league' : 'leagues'} read · {s.crossroads} at a crossroads</p>
                    </div>
                </section>

                <div className="empire-detail-metrics">
                    <div className="empire-metric"><span>Push now</span><strong style={{ color: 'var(--good)' }}>{s.push}</strong></div>
                    <div className="empire-metric"><span>Contend</span><strong style={{ color: 'var(--gold)' }}>{s.contend}</strong></div>
                    <div className="empire-metric"><span>Crossroads</span><strong style={{ color: 'var(--warn)' }}>{s.crossroads}</strong></div>
                    <div className="empire-metric"><span>Sell / pivot</span><strong style={{ color: 'var(--purple)' }}>{s.sell}</strong></div>
                    <div className="empire-metric"><span>Rebuild</span><strong style={{ color: 'var(--bad)' }}>{s.rebuild}</strong></div>
                </div>

                {war.buckets.length ? war.buckets.map(bucket => (
                    <section key={bucket.key} className="empire-panel" style={{ borderLeft: '3px solid ' + bucket.tone }}>
                        <div className="empire-panel-head">
                            <strong style={{ color: bucket.tone }}>{bucket.label}</strong>
                            <em>{bucket.count} {bucket.count === 1 ? 'league' : 'leagues'} · {bucket.blurb}</em>
                        </div>
                        <div className="empire-stack">
                            {bucket.items.map(row => (
                                <button key={row.id} className="empire-league-card" style={{ '--tone': bucket.tone }} type="button" onClick={() => setDetail({ type: 'league', leagueId: row.id })}>
                                    <div>
                                        <strong>{row.name}</strong>
                                        <span>{row.format} · {row.rankLabel} · {row.record} · {row.dhqLabel}{row.healthScore != null ? ' · HP ' + row.healthScore : ''}</span>
                                        <em>Top need: {row.topNeed}{row.lowConfidence ? ' · thin data — watch, not gospel' : ''}</em>
                                    </div>
                                    <b style={{ color: bucket.tone }}>{row.windowLabel}</b>
                                </button>
                            ))}
                        </div>
                    </section>
                )) : (
                    <section className="empire-panel">
                        <div className="empire-empty"><strong>No leagues to read</strong>Sync rosters or check league connections, then the War Table fills in.</div>
                    </section>
                )}

                <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 4, lineHeight: 1.5 }}>
                    Windows are a <b style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>current</b> read from tier, status, record, health and power rank — not a multi-year forecast. {s.lowConfidenceCount > 0 ? s.lowConfidenceCount + ' league' + (s.lowConfidenceCount === 1 ? ' has' : 's have') + ' thin signal (early season / no rank); treat those as a watch.' : ''}
                </p>
            </main>
        </div>
    );
};

// ── Season Outlook — Monte Carlo playoff/title odds, per league ────────
// Reads the seasonOutlook state the useEffect above fills in (one sim per
// eligible league, run once). Unlike every other Empire detail view this
// isn't a synchronous pure builder off model.provinces alone — the sim
// itself is async — so this stays a closure over component state rather
// than a module-scope build* function like buildWarTable/buildProvincesMap.
const renderOutlookDetail = () => {
    const provinces = model?.provinces || [];
    const rows = provinces.map(p => {
        if (p.preDraftEmpty) return { id: p.id, name: p.name, skip: 'Pre-draft — no season to project yet.' };
        if (p.isChopped) return { id: p.id, name: p.name, skip: 'Chopped format runs a survival model, not a playoff bracket.' };
        const playoffTeams = Number(p.league?.settings?.playoff_teams) || 0;
        if (playoffTeams <= 0) return { id: p.id, name: p.name, skip: 'No playoff bracket configured for this league.' };
        const o = seasonOutlook[p.id];
        if (!o || o.status === 'loading') return { id: p.id, name: p.name, record: p.recordLabel, loading: true };
        if (o.status === 'error') return { id: p.id, name: p.name, record: p.recordLabel, skip: 'Simulation failed to load — try refreshing.' };
        if (o.status === 'unavailable') {
            const pw = o.playedWeeks || 0;
            return { id: p.id, name: p.name, record: p.recordLabel, skip: pw < 2 ? 'Opens once 2 weeks are played (' + pw + ' so far).' : 'Regular season is over.' };
        }
        const sim = o.sim;
        const mine = sim && sim.rows.find(r => String(r.rosterId) === String(p.roster?.roster_id));
        if (!mine) return { id: p.id, name: p.name, record: p.recordLabel, skip: 'Could not place your roster in the sim.' };
        return {
            id: p.id, name: p.name, record: p.recordLabel,
            projRecord: mine.projWins + '-' + mine.projLosses,
            playoffPct: mine.playoffPct, titlePct: mine.titlePct, byePct: mine.byePct, avgSeed: mine.avgSeed,
            fieldSize: sim.playoffTeams,
        };
    });
    const ready = rows.filter(r => r.playoffPct != null);
    const bestOdds = ready.length ? ready.reduce((a, b) => (b.playoffPct > a.playoffPct ? b : a)) : null;
    const bestTitle = ready.length ? ready.reduce((a, b) => (b.titlePct > a.titlePct ? b : a)) : null;
    const pctColor = pct => pct >= 50 ? 'var(--good)' : pct >= 25 ? 'var(--warn)' : 'var(--bad)';
    return (
        <div className={rootClassName} data-testid="empire-root">
            <EmpireStyles />
            <div className="empire-header">
                    {renderWorkspaceNav()}
                <div className="empire-topbar">
                    <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                    <div className="empire-title"><strong>Season Outlook</strong><span>Monte Carlo playoff &amp; title odds · once a league has games on the board</span></div>
                    <div className="empire-user">{userName}</div>
                </div>
            </div>
            <main className="empire-detail">
                <section className="empire-detail-hero">
                    <div>
                        <h1>{ready.length} of {rows.length} <span style={{ fontSize: '1rem', color: 'var(--silver)' }}>leagues simulated</span></h1>
                        <p>
                            {bestOdds ? bestOdds.name + ' leads the empire at ' + bestOdds.playoffPct + '% playoff odds' : 'No leagues have enough games played yet.'}
                            {bestTitle && bestTitle.titlePct > 0 ? ' · best title shot: ' + bestTitle.name + ' (' + bestTitle.titlePct + '%)' : ''}
                        </p>
                    </div>
                </section>

                <section className="empire-panel">
                    <div className="empire-panel-head"><strong>Every League</strong><em>{ready.length} live · {rows.length - ready.length} not yet</em></div>
                    {rows.length ? (
                        <div className="empire-stack">
                            {rows.map(row => (
                                <button key={row.id} className="empire-league-card" type="button" onClick={() => setDetail({ type: 'league', leagueId: row.id })}>
                                    <div>
                                        <strong>{row.name}</strong>
                                        {row.record ? (
                                            <span>{row.record}{row.projRecord ? ' → proj ' + row.projRecord : ''}{row.fieldSize ? ' · ' + row.fieldSize + '-team field' : ''}</span>
                                        ) : null}
                                        {row.skip ? <em>{row.skip}</em> : row.loading ? <em>Simulating 10,000 seasons…</em> : null}
                                    </div>
                                    {row.playoffPct != null ? (
                                        <div style={{ textAlign: 'right' }}>
                                            <b style={{ color: pctColor(row.playoffPct) }}>{row.playoffPct}% playoffs</b>
                                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>
                                                {row.titlePct}% title{row.byePct != null ? ' · ' + row.byePct + '% bye' : ''}{row.avgSeed != null ? ' · avg seed ' + row.avgSeed : ''}
                                            </div>
                                        </div>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="empire-empty"><strong>No leagues to read</strong>Sync rosters or check league connections, then the outlook fills in.</div>
                    )}
                </section>

                <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 4, lineHeight: 1.5 }}>
                    Monte Carlo simulation (10,000 seasons per league) using each roster's actual weekly scoring this season, plus Sleeper's already-posted future matchups — the same engine and methodology as the single-league Season Odds panel in Game Day. Needs at least 2 played weeks before a league shows odds; Chopped leagues run a survival model instead and aren't included here.
                </p>
            </main>
        </div>
    );
};

// renderTradeDeskDetail — the whole Trade Center module (js/trade-calc.js),
// mounted from Empire instead of a second trade builder. Trades are
// inherently single-league (rosters are disjoint across leagues), so this
// is a two-step view: pick a league, then the real TradeCalcTab renders
// with that league's data — same component, same props League Detail
// already feeds it, just resolved from Empire's already-loaded provinces
// instead of a page navigation. seedOwnerId/seedPid (from an Owner Rolodex
// "Propose Trade" or an Arbitrage row's "Trade Desk" button) land the
// builder pre-armed instead of empty.
const renderTradeDeskDetail = (d) => {
    const leagueId = d?.leagueId;
    const provinces = model?.provinces || [];

    if (!leagueId) {
        const tradeable = provinces.filter(canOpenEmpireTradeDesk);
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    {renderWorkspaceNav()}
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Trade Desk</strong><span>Pick a league to build a proposal in</span></div>
                        <div className="empire-user">{userName}</div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-panel">
                        <div className="empire-panel-head"><strong>Your Leagues</strong><em>{tradeable.length} tradeable</em></div>
                        <div className="empire-stack">
                            {tradeable.length ? tradeable.map(p => (
                                <button key={p.id} className="empire-league-card" style={{ '--tone': p.tierColor }} type="button" onClick={() => setDetail({ type: 'tradeDesk', leagueId: p.id })}>
                                    <div><strong>{p.name}</strong><span>{p.tier} - {p.recordLabel}</span></div>
                                </button>
                            )) : <div className="empire-empty"><strong>No tradeable leagues</strong>Every league is either pre-draft or has trades disabled.</div>}
                        </div>
                    </section>
                </main>
            </div>
        );
    }

    const province = provinces.find(p => String(p.id) === String(leagueId));
    const currentLeague = province?.league;
    const myRoster = province?.roster;
    const standings = currentLeague ? empireStandingsFor(currentLeague) : [];
    const leagueSkin = currentLeague ? (window.App?.LeagueSkin?.build?.({
        league: currentLeague, profile: null, rosters: currentLeague.rosters || [], myRoster, draft: null, nflState: window.S?.nflState,
    }) || null) : null;

    return (
        <div className={rootClassName} data-testid="empire-root">
            <EmpireStyles />
            <div className="empire-header">
                    {renderWorkspaceNav()}
                <div className="empire-topbar">
                    <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail({ type: 'tradeDesk' })}>{"<"}</button>
                    <div className="empire-title"><strong>Trade Desk</strong><span>{province?.name || 'League'}</span></div>
                    <div className="empire-user">{userName}</div>
                </div>
            </div>
            <main className="empire-detail">
                {!currentLeague ? (
                    <div className="empire-empty"><strong>League not found</strong>Pick a different league.</div>
                ) : !canOpenEmpireTradeDesk(province) || leagueSkin?.features?.showTrades === false ? (
                    <div className="empire-empty" role="status"><strong>Trading is unavailable in this league</strong>Use its league workspace for the actions this format supports.<div className="empire-section-footer"><button type="button" className="empire-action" onClick={() => onEnterLeague?.(currentLeague)}>Open league</button></div></div>
                ) : !tradeModuleReady ? (
                    <div className="empire-empty"><strong>Loading Trade Desk…</strong></div>
                ) : (
                    <TradeCalcTab
                        playersData={playersData}
                        statsData={markData?.stats || {}}
                        myRoster={myRoster}
                        standings={standings}
                        currentLeague={currentLeague}
                        leagueSkin={leagueSkin}
                        sleeperUserId={sleeperUserId}
                        viewMode="analyst"
                        seedOwnerId={d.seedOwnerId}
                        seedPid={d.seedPid}
                    />
                )}
            </main>
        </div>
    );
};

const renderProvincesDetail = () => {
  const map = buildProvincesMap({ provinces: model.provinces, empireCompact });
  const s = map.summary;
  const recordStr = s.totalRecord.wins + '-' + s.totalRecord.losses;
  return (
    <div className={rootClassName} data-testid="empire-root">
      <EmpireStyles />
      <div className="empire-header">
                    {renderWorkspaceNav()}
        <div className="empire-topbar">
          <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
          <div className="empire-title"><strong>Provinces Map</strong><span>your empire as territory · format values · dynasty status</span></div>
          <div className="empire-user">{userName}</div>
        </div>
      </div>
      <main className="empire-detail">
        <section className="empire-detail-hero">
          <div>
            <h1>{s.leagues} <span style={{ fontSize: '1rem', color: 'var(--silver)' }}>provinces</span></h1>
            <p>{empireCompact(s.totalDHQ)} dynasty DHQ · {recordStr} combined · {s.contenders} contending, {s.crossroads} at a crossroads, {s.rebuilds} rebuilding{s.unread ? ', ' + s.unread + ' unread' : ''}</p>
          </div>
        </section>
        <div className="empire-detail-metrics">
          <div className="empire-metric"><span>Contenders</span><strong style={{ color: 'var(--good)' }}>{s.contenders}</strong></div>
          <div className="empire-metric"><span>Crossroads</span><strong style={{ color: 'var(--warn)' }}>{s.crossroads}</strong></div>
          <div className="empire-metric"><span>Rebuilds</span><strong style={{ color: 'var(--bad)' }}>{s.rebuilds}</strong></div>
          <div className="empire-metric"><span>Dynasty DHQ</span><strong style={{ fontFamily: 'var(--font-mono)' }}>{empireCompact(s.totalDHQ)}</strong></div>
        </div>
        <section className="empire-panel">
          <div className="empire-panel-head"><strong>Territory Grid</strong><em>tap a province to enter its league</em></div>
          {map.tiles.length ? (
            <div className="empire-provmap">
              {map.tiles.map(t => (
                <button
                  key={t.id}
                  type="button"
                  className="empire-prov-tile"
                  title={t.name + ' · ' + t.statusLabel + (t.rankStr ? ' · ' + t.rankStr : '') + ' · ' + t.dhqLabel}
                  style={{ flexGrow: t.grow, '--tone': t.color }}
                  onClick={() => setDetail({ type: 'league', leagueId: t.id })}
                >
                  <div className="empire-prov-top">
                    <span className="empire-prov-name">{t.name}</span>
                    <span className="empire-prov-status">{t.statusLabel}</span>
                  </div>
                  <div className="empire-prov-mid">
                    {t.tier ? <span className="empire-prov-tier" style={{ color: t.tierColor }}>{t.tier}</span> : null}
                    {t.rankStr ? <span className="empire-prov-rank">{t.rankStr}</span> : null}
                    {t.record ? <span className="empire-prov-rec">{t.record}</span> : null}
                  </div>
                  <div className="empire-prov-foot">
                    <span className="empire-prov-dhq">{t.dhqLabel}</span>
                    {t.healthScore != null ? <span className="empire-prov-health">hp {t.healthScore}</span> : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empire-empty"><strong>No provinces mapped</strong>No owned rosters found yet — sync your leagues and the map fills in.</div>
          )}
          <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 10, lineHeight: 1.5 }}>Values follow each league's format. Mixed bases use equal tile sizes. Dynasty status does not classify seasonal or keeper decisions. Power rank compares complete roster value within one league; record comes from standings.</p>
        </section>
      </main>
    </div>
  );
};

const renderScoutDetail = () => {
  const groupBy = detail?.groupBy || 'none';
  const sortBy = detail?.sortBy || 'dhq';
  const board = buildScoutBoard({
    assets: model.assets,
    exposure: model.exposure,
    totalLeagues: model.totals.leagues,
    groupBy,
    sortBy
  });
  const s = board.summary;
  const groupBtns = [['none', 'flat'], ['position', 'position'], ['age', 'age window']];
  const sortBtns = ['dhq', 'exposure', 'age', 'position'];

  return (
    <div className={rootClassName} data-testid="empire-root">
      <EmpireStyles />
      <div className="empire-header">
                    {renderWorkspaceNav()}
        <div className="empire-topbar">
          <button className="empire-back" type="button" aria-label="Back to Empire" onClick={() => setDetail(null)}>{"<"}</button>
          <div className="empire-title"><strong>Scout Board</strong><span>your top assets · ranked across the whole empire</span></div>
          <div className="empire-user">{userName}</div>
        </div>
      </div>
      <main className="empire-detail empire-rankings-detail">
        <section className="empire-detail-hero">
          <div>
            <h1>{s.boardSize} <span style={{ fontSize: '1rem', color: 'var(--silver)' }}>assets on the board</span></h1>
            <p>{empireCompact(s.totalDHQ)} dynasty DHQ in view across {board.leagueCount} leagues{s.multiCount ? ' · ' + s.multiCount + ' held in multiple leagues' : ''}{s.topMultiName ? ' · ' + s.topMultiName + ' in ' + s.topMultiCount + ' of ' + board.leagueCount : ''}</p>
          </div>
        </section>

        <details className="empire-ranking-options" open={phone ? undefined : true}><summary>Sort &amp; board details</summary>
        <div className="empire-detail-metrics">
          <div className="empire-metric"><span>Board Size</span><strong>{s.boardSize}</strong></div>
          <div className="empire-metric"><span>Dynasty DHQ in view</span><strong>{s.totalDHQ > 0 ? empireCompact(s.totalDHQ) : 'No DHQ'}</strong></div>
          <div className="empire-metric"><span>Multi-League</span><strong>{s.multiCount} of {s.boardSize}</strong></div>
          <div className="empire-metric"><span>Leagues</span><strong>{board.leagueCount}</strong></div>
        </div>

        <section className="empire-panel">
          <div className="empire-panel-head"><strong>Controls</strong><em>group + sort the board</em></div>
          <div className="empire-sort-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {groupBtns.map(([key, label]) => (
              <button key={key} className={'empire-ghost' + (groupBy === key ? ' is-active' : '')} type="button" onClick={() => setDetail({ type: 'scout', groupBy: key, sortBy })}>{label}</button>
            ))}
          </div>
          <div className="empire-sort-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sortBtns.map(key => (
              <button key={key} className={'empire-ghost' + (sortBy === key ? ' is-active' : '')} type="button" onClick={() => setDetail({ type: 'scout', groupBy, sortBy: key })}>sort: {key}</button>
            ))}
          </div>
        </section>

        </details>

        {board.rows.length ? board.groups.map(g => (
          <section className="empire-panel" key={g.key}>
            <div className="empire-panel-head"><strong style={{ color: g.tone }}>{g.label}</strong><em>{g.rows.length} {g.rows.length === 1 ? 'asset' : 'assets'}{phone ? ' · tap for details' : ' · name · pos · age · format value · empire exposure'}</em></div>
            <div className="empire-floor-matrix" style={{ gridTemplateColumns: '1fr' }}>
              <div className="empire-table-head empire-ranking-head" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) 48px 46px 70px minmax(120px,1fr) 64px' }}>
                <div>Player</div><div>Pos</div><div>Age</div><div>Value</div><div>Empire exposure</div><div>Of {board.leagueCount}</div>
              </div>
              {g.rows.map(r => (
                <button key={r.pid} type="button" className="empire-expo-row empire-ranking-row" style={{ gridTemplateColumns: 'minmax(150px,1.4fr) 48px 46px 70px minmax(120px,1fr) 64px' }} onClick={() => setDetail({ type: 'player', pid: r.pid })}>
                  <div className="empire-expo-name">
                    <strong>{r.name}</strong>
                    <small className="empire-phone-asset-meta">{r.pos} · {r.age || "Age unknown"}{r.age ? " years" : ""} · {r.exposureCount} of {board.leagueCount} leagues</small>
                    <span style={{ color: r.agePhaseColor }}>{r.agePhaseLabel}{r.tier ? ' · ' + r.tier : ''}</span>
                  </div>
                  <b style={{ color: posColors[r.pos] || 'var(--gold)' }}>{r.pos}</b>
                  <b>{r.age || '—'}</b>
                  <b style={{ fontFamily: 'var(--font-mono)' }}>{r.value != null ? empireCompact(r.value) + ' ' + r.valueLabel : r.valueLabel === 'By league' ? 'By league' : 'Unavailable'}</b>
                  <div className="empire-expo-track" title={r.exposureCount + ' of ' + board.leagueCount + ' leagues'}>
                    <div className="empire-expo-fill" style={{ width: Math.min(100, r.exposurePct) + '%', background: r.multiLeague ? r.agePhaseColor : 'var(--ov-6, rgb(70,70,72))' }} />
                  </div>
                  <b style={{ color: r.exposurePct >= 50 ? 'var(--bad)' : r.multiLeague ? 'var(--gold)' : 'var(--silver)' }}>{r.exposureCount}×</b>
                </button>
              ))}
            </div>
          </section>
        )) : (
          <div className="empire-empty"><strong>No holdings loaded</strong>Sync your leagues to view owned players. Missing values stay unpriced.</div>
        )}

        <p style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 4, lineHeight: 1.5 }}>The scout edge here is breadth, not depth: this board groups your holdings by value basis and shows how many of your {board.leagueCount} leagues each one appears in. Per-player value curves, production splits and historical trends aren't in scope for v1 — tap any row to open the player view.</p>
      </main>
    </div>
  );
};

    if (detail?.type === 'lab') return <div className={rootClassName}>
        <EmpireStyles /><header className="empire-header">{renderWorkspaceNav()}<div className="empire-topbar"><button className="empire-back" aria-label="Back to Empire overview" type="button" onClick={() => openWorkspace('overview')}>{"<"}</button><div className="empire-title"><strong>Portfolio Lab</strong><span>Stress tests & exposure guardrails</span></div></div></header>
        <EmpirePortfolioLab model={model} onOpen={setDetail} />
    </div>;
    if (detail?.type === 'threat') return renderThreatDetail();
    if (detail?.type === 'war') return renderWarDetail();
    if (detail?.type === 'outlook') return renderOutlookDetail();
    if (detail?.type === 'tradeDesk') return renderTradeDeskDetail(detail);
    if (detail?.type === 'provinces') return renderProvincesDetail();
    if (detail?.type === 'scout') return renderScoutDetail();
    if (detail?.type === 'index') return renderIndexDetail();
    if (detail?.type === 'owner') return renderOwnerHud(detail.ownerId, detail.leagueId);
    if (detail?.type === 'player') return renderPlayerDetail(detail.pid);
    if (detail?.type === 'league') return renderLeagueDetail(detail.leagueId);
    if (detail?.type === 'slice' || detail?.type === 'quality') return renderSliceDetail(detail);
    if (detail?.type === 'moves') return renderMovesDetail();

    // The header used to show an unconditional pulsing "Live" badge, but
    // Empire only re-reads league data when you hit Refresh Leagues. Report
    // the real age of the intel build instead, and reserve "Live" for data
    // that genuinely is fresh.
    const freshness = (() => {
        const builtAt = Date.parse(window.App?.LI?.builtAt || '');
        if (!Number.isFinite(builtAt)) return null;
        const mins = Math.max(0, Math.round((Date.now() - builtAt) / 60000));
        if (mins <= 15) return { live: true, label: 'Live' };
        if (mins < 60) return { live: false, label: mins + 'm old' };
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return { live: false, label: hrs + 'h old' };
        return { live: false, label: Math.round(hrs / 24) + 'd old' };
    })();


    return (
        <div className={rootClassName} data-testid="empire-root">
            <EmpireStyles />
            <header className="empire-header">
                {renderWorkspaceNav()}
                <div className="empire-topbar">
                    <button className="empire-back" type="button" aria-label="Back to hub" onClick={onBack}>{"<"}</button>
                    <div className="empire-title">
                        <strong>Empire</strong>
                        <span>{model.totals.leagues} {model.coverage.complete ? 'leagues' : 'loaded leagues'}</span>
                    </div>
                    {freshness && model.coverage.complete && model.pickCapital.complete ? (
                        <span className={'empire-live' + (freshness.live ? '' : ' is-stale')} style={{ marginLeft: 12 }}
                            title={freshness.live ? 'League data rebuilt in the last 15 minutes' : 'Empire reads cached league data — hit Refresh Leagues to re-sync'}>
                            {freshness.label}
                        </span>
                    ) : null}
                    <button className="empire-action" type="button" style={{ marginLeft: 'auto' }} disabled={!!refreshing} onClick={onRefresh}
                        title={hasNonSleeperLeagues ? "Re-syncs Sleeper leagues' rosters, standings and scoring — ESPN/MFL leagues update on their own connection cycle" : "Re-sync every league's rosters, standings and scoring"}>
                        {refreshing ? 'Refreshing…' : justSynced ? 'Synced ✓' : 'Refresh Leagues'}
                    </button>
                    <div className="empire-user">{userName}</div>
                </div>
                {onStartInEmpire && <label className="empire-start"><input type="checkbox" checked={startInEmpire} onChange={event => onStartInEmpire(event.target.checked)} /> Start in Empire</label>}
                <details className="empire-summary" open={!phone} hidden={!allLeagues?.length || workspace === 'lenses'}><summary>Portfolio snapshot <span>{model.totals.leagues} {model.coverage.complete ? 'leagues' : 'loaded leagues'}</span></summary>
                <div className="empire-kpis" data-testid="empire-command-strip" hidden={!allLeagues?.length}>
                    {/* Command Bridge KPI strip — empire-wide overview (mockup contract), with
                        week-over-week deltas from the snapshot store. Lens filters drive the asset
                        table below, not these portfolio-level KPIs. */}
                    {bridge.kpis.map(kpiTile)}
                </div></details>
            </header>

            <main className="empire-shell" data-workspace={workspace} data-asset-view={assetView}>
                {workspace === 'lenses' && lensView && <EmpireLensBoard leagues={enabledLeagues} players={playersData} sleeperUserId={sleeperUserId}
                    view={lensView} onView={onLensView} cache={lensCache} onOpenLeague={(league, tab) => {
                        if (!decisionJournal.hasPending()) onLensView({ scroll: window.scrollY });
                        onEnterLeague(league, tab, true);
                    }} />}
                {workspace === 'overview' && <button className="empire-action empire-phone-actions" type="button" onClick={() => openWorkspace('actions')}>Actions</button>}
                <div className="empire-viewbar" aria-label="Empire portfolio views">
                    <span className="empire-filter-label">View</span>
                    {lensButton('All', {}, 'var(--gold)')}
                    {lensButton('High Exposure', { exposure: 'multi', assetType: 'players' }, 'var(--purple)')}
                    {lensButton('Post-window', { agePhase: 'post' }, 'var(--bad)')}
                    {lensButton('Picks', { assetType: 'picks' }, 'var(--purple)')}
                    <span className="empire-viewbar-spacer" />
                    {activeFilters > 0 && <button className="empire-filter empire-clear" type="button" onClick={clearFilters}>Clear {activeFilters}</button>}
                    <button className={'empire-filter empire-filter-toggle' + (filtersOpen ? ' is-active' : '')} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}>
                        Filters {activeFilters > 0 ? <b>{activeFilters}</b> : null} <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
                    </button>
                </div>
                {filtersOpen ? (
                    <div className="empire-advanced-filters" data-testid="empire-advanced-filters">
                        <div className="empire-filter-group">
                            <span className="empire-filter-label">Strategy</span>
                            <div className="empire-filters">
                                {lensButton('Peak Assets', { agePhase: 'peak' }, 'var(--good)')}
                                {hasLongTerm ? lensButton('Contenders', { status: 'contender' }, 'var(--good)') : null}
                                {hasLongTerm ? lensButton('Rebuilds', { status: 'rebuild' }, 'var(--bad)') : null}
                            </div>
                        </div>
                        <div className="empire-filter-group">
                            <span className="empire-filter-label">Position</span>
                            <div className="empire-filters">
                                {['QB','RB','WR','TE','K','DEF','DL','LB','DB'].map(pos => filterButton('position', pos, window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos), posColors[pos]))}
                            </div>
                        </div>
                        <div className="empire-filter-group">
                            <span className="empire-filter-label">Age Window</span>
                            <div className="empire-filters">
                                {filterButton('agePhase', 'build', 'Build', 'var(--k-4ecdc4, #4ecdc4)')}
                                {filterButton('agePhase', 'peak', 'Peak', 'var(--k-2ecc71, #2ecc71)')}
                                {filterButton('agePhase', 'value', 'Value', 'var(--k-f0a500, #f0a500)')}
                                {filterButton('agePhase', 'post', 'Post-window', 'var(--k-e74c3c, #e74c3c)')}
                            </div>
                        </div>
                        {/* Which leagues count toward Empire's totals at all — a
                            persisted on/off per league, separate from the lenses
                            above (those re-slice the SAME data, this decides what
                            data is in the pool to begin with). */}
                        <div className="empire-filter-group">
                            <span className="empire-filter-label">Leagues</span>
                            <div className="empire-filters">
                                {(() => {
                                    const empirePrefs = readEmpirePrefs();
                                    return (allLeagues || []).map(l => {
                                        const lid = l.league_id || l.id;
                                        const on = isEmpireLeagueOn(lid, empirePrefs);
                                        return (
                                            <button key={lid} type="button"
                                                className={'empire-filter' + (on ? ' is-active' : '')}
                                                style={{ '--tone': 'var(--gold)' }}
                                                title={on ? 'Included in Empire totals — click to exclude' : 'Excluded from Empire totals — click to include'}
                                                onClick={() => { setEmpireLeagueOn(lid, !on); setPrefsTick(t => t + 1); }}>
                                                {l.name}
                                            </button>
                                        );
                                    });
                                })()}
                            </div>
                        </div>
                    </div>
                ) : null}
                {hasNoResults ? (
                    <div className="empire-empty" data-testid="empire-empty-state">
                        <strong>{!allLeagues?.length ? 'Your portfolio starts with a league' : activeFilters ? 'No portfolio results match this view' : 'Your portfolio data is not ready'}</strong>
                        {!allLeagues?.length ? 'Connect your leagues from the hub to see their players, picks and opportunities here.' : activeFilters ? 'No leagues, players or picks match these filters.' : 'Refresh your leagues to load the available roster and pick data.'}
                        <div style={{ marginTop: 12 }}><button className="empire-action" type="button" onClick={!allLeagues?.length ? onBack : activeFilters ? clearFilters : onRefresh}>{!allLeagues?.length ? 'Connect a league in the hub' : activeFilters ? 'Reset Filters' : refreshing ? 'Refreshing…' : 'Refresh leagues'}</button></div>
                    </div>
                ) : (
                    <>
                        <section className="empire-command-deck" data-testid="empire-bridge">
                            <div className="empire-panel empire-command-primary">
                                <div className="empire-panel-head"><strong>Empire Brief</strong><em>Portfolio overview</em></div>

                                <div className="empire-command-focus">{briefText}</div>
                                <div className="empire-command-meta">Across {model.totals.leagues} {model.coverage.complete ? 'leagues' : 'loaded leagues'} · {actionQueue.length} ranked moves · {model.pickCapital.complete ? model.pickCapital.total + ' picks' : model.pickCapital.loadedLeagues ? model.pickCapital.total + ' known picks · coverage incomplete' : 'pick ownership unavailable'}</div>
                            </div>
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Priority Queue</strong><em>the next {Math.min(3, actionQueue.length)} moves</em></div>
                                <div className="empire-priority-list">
                                    {actionQueue.length ? actionQueue.slice(0, 3).map((action, i) => (
                                        <button key={i} type="button" className="empire-signal" style={{ '--tone': signalTone(action.severity) }} onClick={() => actionForQueue(action)}>
                                            <div className="empire-signal-top"><strong>{action.title}</strong>{action.metric ? <b>{action.metric}</b> : null}</div>
                                            <span>{action.detail}</span>
                                            <em>{action.cta}</em>
                                        </button>
                                    )) : <div className="empire-empty"><strong>No priorities flagged</strong>No moves stand out in the available data.</div>}
                                </div>
                                {actionQueue.length > 3 ? <div className="empire-section-footer"><button className="empire-action" type="button" onClick={() => { setActionView('priority'); setDetail({ type: 'moves' }); }}>View all {actionQueue.length} priorities →</button></div> : null}
                            </div>
                        </section>
                        <EmpireSecondaryDetails active={phone && workspace === 'overview'}>
                        {workspace !== 'assets' && <section className="empire-panel empire-lab-entry">
                            <div><div className="empire-command-kicker">Portfolio Lab</div><strong>Test a change in player value.</strong><p>Model a player, team, or position value drop across {model.coverage.complete ? 'every' : 'loaded'} league{model.coverage.complete ? '' : 's'}.</p></div>
                            <button className="empire-action" type="button" onClick={() => setDetail({ type: 'lab' })}>Stress-test portfolio →</button>
                        </section>}
                        {/* ── THE ARBITRAGE BOARD ─────────────────────────
                            Every league marked to its own book, so the same
                            player carries a different price in each — and the
                            spread is a trade only a portfolio can see. */}
                        {workspace !== 'assets' && marks && marks.arbitrage.length ? (() => {
                            const mineTotal = marks.arbitrage.reduce((n, a) => n + (a.spreadMine ? 1 : 0), 0);
                            const availableRows = arbMineOnly ? marks.arbitrage.filter(a => a.spreadMine) : marks.arbitrage;
                            const rows = availableRows.slice(0, arbExpanded ? 12 : 3);
                            return (
                            <section className="empire-bridge" data-testid="empire-arbitrage">
                                <div className="empire-panel" style={{ gridColumn: '1 / -1' }}>
                                    <div className="empire-panel-head">
                                        <strong>Value differences across leagues</strong>
                                        <em>{marks.arbitrage.length} spreads · {mineTotal} touch your roster · {Object.keys(marks.byLeague).length} leagues marked</em>
                                    </div>
                                    {mineTotal > 0 ? (
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                            <button type="button" onClick={() => setArbMineOnly(true)}
                                                className={'empire-filter' + (arbMineOnly ? ' is-active' : '')}>Mine ({mineTotal})</button>
                                            <button type="button" onClick={() => setArbMineOnly(false)}
                                                className={'empire-filter' + (!arbMineOnly ? ' is-active' : '')}>All ({marks.arbitrage.length})</button>
                                        </div>
                                    ) : null}
                                    <div className="empire-stack">
                                        {rows.length ? rows.map(a => {
                                            const ownedLegs = (a.legs || []).filter(leg => leg.mine && canOpenEmpireTradeDesk(model.provinces.find(p => String(p.id) === String(leg.leagueId))));
                                            return (
                                            <div key={a.pid} role="button" tabIndex={0} className="empire-signal" style={{ '--tone': 'var(--purple)', cursor: 'pointer' }}
                                                onClick={() => setDetail && setDetail({ type: 'player', pid: a.pid })}
                                                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetail && setDetail({ type: 'player', pid: a.pid }); } }}>
                                                <div className="empire-signal-top">
                                                    <strong>{a.name}{a.pos ? ' · ' + a.pos : ''}</strong>
                                                    {a.spreadMine ? <b style={{ color: 'var(--gold)' }}>YOURS</b> : null}
                                                    <b>+{a.spreadPct}%</b>
                                                </div>
                                                <span>
                                                    Worth <b>{a.high.value.toLocaleString()}</b> in {a.high.name} vs <b>{a.low.value.toLocaleString()}</b> in {a.low.name} — {a.gap.toLocaleString()} of value between your own books.
                                                </span>
                                                {/* Ownership FACTS, not a buy-here-sell-there instruction — these
                                                    are independent player pools and nobody can move him between
                                                    them. Leverage where you hold him, intel where you don't. */}
                                                <em>{a.note}</em>
                                                {ownedLegs.length ? (
                                                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                                        {ownedLegs.map(leg => (
                                                            <button key={leg.leagueId} type="button" className="empire-ghost" style={{ fontSize: 'var(--text-micro)', padding: '3px 8px' }}
                                                                onClick={e => { e.stopPropagation(); setDetail({ type: 'tradeDesk', leagueId: leg.leagueId, seedPid: a.pid }); }}>
                                                                Trade Desk · {leg.name}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                            );
                                        }) : <div className="empire-empty"><strong>No owned spreads right now</strong>Nothing you roster carries a big enough gap between leagues. Switch to "All" for market intel.</div>}
                                    </div>
                                    <div className="empire-brief-meta" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0, fontWeight: 500, color: 'var(--ov-7, rgb(132,132,133))' }}>
                                        League-scored seasonal prices — each league priced on its own scoring, roster slots and team count. Not a dynasty valuation. Leagues are independent player pools: a spread is a trade-leverage read on your OWN rostered asset, never an instruction to move him between leagues.
                                    </div>
                                    {availableRows.length > 3 ? (
                                        <div className="empire-section-footer">
                                            <button className="empire-action" type="button" onClick={() => setArbExpanded(v => !v)}>{arbExpanded ? 'Show less' : 'Show ' + Math.min(12, availableRows.length) + ' opportunities'} {arbExpanded ? '↑' : '↓'}</button>
                                        </div>
                                    ) : null}
                                </div>
                            </section>
                            );
                        })() : null}
                        {workspace !== 'assets' && rolodex.length ? (
                            <section className="empire-panel empire-rolodex" data-testid="empire-rolodex">
                                <div className="empire-panel-head"><strong>Owner Rolodex</strong><em>{rolodex.length} owners across {model.totals.leagues} leagues</em></div>
                                <div className="empire-rolodex-grid">
                                    {rolodex.filter(o => o.exploit >= 6).slice(0, 8).map((o, i) => (
                                        <button key={o.leagueId + ':' + o.ownerId + ':' + i} className="empire-league-card" style={{ '--tone': o.postureColor }} type="button" onClick={() => setDetail({ type: 'owner', ownerId: o.ownerId, leagueId: o.leagueId })}>
                                            <div>
                                                <strong>{o.ownerName}</strong>
                                                <span>{o.leagueName} · {o.posture}</span>
                                                <em>{o.edge}{o.needs.length ? ' · needs ' + o.needs.join(', ') : ''}</em>
                                            </div>
                                            <b>{o.exploit}</b>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {(workspace !== 'assets' || assetView === 'allocation') && <section className="empire-main-grid">
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Asset Allocation</strong><em>{shareBasis}</em></div>
                                <div className="empire-panel-head" style={{ marginTop: 0 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Position</strong><em>{model.positionAllocation.length} groups</em></div>
                                {barRows(model.positionAllocation, 'position', 'No player assets loaded.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Age Window</strong><em>build / peak / value / post</em></div>
                                {barRows(model.ageAllocation, 'agePhase', 'Dynasty age windows do not apply to seasonal or keeper decisions.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Value Tier</strong><em>{model.tierAllocation.length} tiers</em></div>
                                {barRows(model.tierAllocation, 'tier', 'Dynasty tiers do not establish seasonal value or keeper surplus.')}
                            </div>

                            <div className="empire-panel empire-center">
                                <div className="empire-panel-head"><strong>Risks And Opportunities</strong></div>
                                <div className="empire-stack">
                                    {model.signals.slice(0, 7).map((signal, i) => (
                                        <button key={i} type="button" className="empire-signal" style={{ '--tone': signalTone(signal.severity) }} onClick={() => actionForSignal(signal)}>
                                            <div className="empire-signal-top"><strong>{signal.title}</strong><b>{signal.metric}</b></div>
                                            <span>{signal.body}</span>
                                            <em>{signal.cta}</em>
                                        </button>
                                    ))}
                                </div>
                                <div className="empire-quality-grid">
                                    {model.dataQuality.items.map(qualityItem)}
                                </div>
                            </div>

                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>League Stack</strong><em>{filtered.provinces.length} active</em></div>
                                <div className="empire-stack">
                                    {filtered.provinces.length ? filtered.provinces
                                        .slice()
                                        .sort((a, b) => b.totalDHQ - a.totalDHQ || (b.healthScore || 0) - (a.healthScore || 0))
                                        .map(province => (
                                            <button key={province.id} className="empire-league-card" style={{ '--tone': province.tierColor }} type="button" onClick={() => setDetail({ type: 'league', leagueId: province.id })}>
                                                <div>
                                                    <strong>{province.name}</strong>
                                                    <span>
                                                        {province.preDraftEmpty ? 'Pre-Draft' : province.tier} - {province.recordLabel} - HP{' '}
                                                        <b style={{ color: empireHealthColor(province.healthScore) }}>{province.healthScore ?? 'No read'}</b>
                                                    </span>
                                                    <em>{province.pickFeedPresent ? province.pickCount + (province.currentDraftUnknown ? ' known picks' : province.pickFeedReady ? ' picks' : ' saved picks') + ' - ' + province.premiumPickCount + ' R1–2' : 'Pick ownership unavailable'} - #{province.powerRank || '-'}/{province.teams || '-'}</em>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <b>{province.totalValue != null ? empireCompact(province.totalValue) + ' ' + province.valueLabel : (province.preDraftEmpty ? 'Pre-Draft' : 'Value unavailable')}</b>
                                                    {!province.preDraftEmpty && province.healthScore != null ? (
                                                        <div className="empire-health-mini">
                                                            <div className="empire-health-track"><div className="empire-health-fill" style={{ width: province.healthScore + '%', background: empireHealthColor(province.healthScore) }} /></div>
                                                            <span className="empire-health-num" style={{ color: empireHealthColor(province.healthScore) }}>{province.healthScore}</span>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </button>
                                        )) : <div className="empire-empty"><strong>No leagues</strong>Reset filters or check roster sync.</div>}
                                </div>
                            </div>
                        </section>}
                        </EmpireSecondaryDetails>

                        {(workspace !== 'assets' || assetView === 'exposure') && <section className="empire-panel empire-floor" data-testid="empire-floor">
                            <div className="empire-panel-head"><strong>Asset Floor</strong><em>cross-league exposure · value basis shown per holding</em></div>
                            <div className="empire-floor-matrix">
                                {model.exposure.filter(e => e.count > 1).slice(0, 12).map(e => (
                                    <button key={e.pid} type="button" className="empire-expo-row" onClick={() => setDetail({ type: 'player', pid: e.pid })}>
                                        <div className="empire-expo-name"><strong>{e.name}</strong><span>{e.pos} · {e.count} of {model.totals.leagues} {model.coverage.complete ? 'leagues' : 'loaded leagues'}</span></div>
                                        <div className="empire-expo-track"><div className="empire-expo-fill" style={{ width: Math.min(100, e.exposurePct) + '%', background: e.agePhaseColor }} /></div>
                                        <b style={{ color: e.exposurePct >= 50 ? 'var(--bad)' : 'var(--gold)' }}>{e.exposurePct}%</b>
                                    </button>
                                ))}
                                {!model.exposure.some(e => e.count > 1) && <div className="empire-empty"><strong>{model.coverage.complete ? 'No duplicate exposure' : 'No duplicates in loaded holdings'}</strong>{model.coverage.complete ? 'Your assets are spread cleanly across leagues.' : 'Unavailable or stale leagues may change your exposure.'}</div>}
                            </div>
                            <details className="empire-asset-map" open={phone ? undefined : true}><summary>Top valued assets</summary><div className="empire-tilegrid">
                                {[...model.assets].filter(a => a.value != null).sort((a, b) => a.valueBasis.localeCompare(b.valueBasis) || b.value - a.value).slice(0, 48).map((a, i) => (
                                    <button key={a.pid + ':' + a.leagueId + ':' + i} type="button" className="empire-tile" title={a.name + ' · ' + empireCompact(a.value) + ' ' + a.valueLabel + ' · ' + (a.agePhaseLabel || '')} style={{ flexGrow: model.totals.valueBasis === 'mixed' ? 1 : Math.max(1, Math.round(a.value / 800)), borderColor: a.agePhaseColor }} onClick={() => setDetail({ type: 'player', pid: a.pid })}>
                                        <span className="empire-tile-name">{a.name}</span>
                                        <span className="empire-tile-dhq">{empireCompact(a.value)} {a.valueLabel}</span>
                                    </button>
                                ))}
                            </div></details>
                        </section>}

                        {(workspace !== 'assets' || assetView === 'players') && <section className="empire-workspace">
                            <div className="empire-workspace-head">
                                <div>
                                    <strong>Asset Workspace</strong>
                                    <div style={{ color: 'var(--ov-9, rgb(132,132,133))', fontSize: 'var(--text-label, 0.75rem)', marginTop: 2 }}>{filtered.assets.length} players - {filtered.picks.length} {model.pickCapital.complete ? 'picks' : 'known picks'} - {activeFilters ? activeFilters + ' filters' : 'full portfolio'}</div>
                                </div>
                                <div className="empire-sort-row">
                                    {['dhq', 'exposure', 'age', 'position', 'league'].map(key => (
                                        <button key={key} className={'empire-ghost' + (sort === key ? ' is-active' : '')} type="button" onClick={() => setSort(key)}>{key === 'dhq' ? 'value basis' : key}</button>
                                    ))}
                                </div>
                            </div>
                            {filters.assetType !== 'picks' && <label className="empire-asset-search">Find a player or league<input type="search" value={assetQuery} onChange={e => setAssetQuery(e.target.value)} /></label>}
                            {filters.assetType === 'picks' ? (
                                <div className="empire-quality-grid" style={{ padding: 12, marginTop: 0 }}>
                                    {model.provinces.some(province => province.format !== 'dynasty') && <p data-testid="empire-pick-format-note" style={{ gridColumn: '1 / -1', fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5 }}>Seasonal leagues show this draft year only. Keeper rights include future years, with costs and eligibility still to verify. Non-dynasty pick values are unpriced.</p>}
                                    {model.pickCapital.byYear.map(year => (
                                        <button key={year.year} className="empire-league-card" style={{ '--tone': 'var(--purple)' }} type="button" onClick={() => setDetail({ type: 'slice', title: year.year + ' Draft Capital', filter: { assetType: 'picks' } })}>
                                            <div><strong>{year.year}</strong><span>{year.count} picks - {year.premium} R1–2</span><em>{year.acquired} acquired - {year.own} own{year.unpriced ? ' - ' + year.unpriced + ' unpriced' : ''}</em></div>
                                            <b>{year.score == null ? 'Unpriced' : year.score > 0 ? empireCompact(year.score) : '—'}</b>
                                        </button>
                                    ))}
                                    {!model.pickCapital.byYear.length && <div className="empire-empty"><strong>{model.pickCapital.complete ? 'No picks in this portfolio' : 'Pick ownership unavailable'}</strong>{model.pickCapital.complete ? 'No draft capital matched the included leagues.' : 'Retry pick sync above to verify your draft capital.'}</div>}
                                </div>
                            ) : searchedAssets.length ? (
                                <>
                                    <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>Value</div><div>Basis / window</div><div>Exp</div><div>League</div></div>
                                    {assetRows(searchedAssets, assetPageSize)}
                                    {searchedAssets.length > assetPageSize && <button type="button" className="empire-action empire-more-assets" onClick={() => setAssetLimit(assetPageSize + 24)}>Show more players · {searchedAssets.length - assetPageSize} remaining</button>}
                                </>
                            ) : (
                                <div className="empire-empty">
                                    <strong>No players match the current filters</strong>
                                    {assetQuery ? 'Try another name or clear your search.' : 'Adjust the filters to return to more assets.'}
                                    <button type="button" className="empire-action" onClick={() => assetQuery ? setAssetQuery('') : clearFilters()}>{assetQuery ? 'Clear search' : 'Reset filters'}</button>
                                </div>
                            )}
                        </section>}
                    </>
                )}
                {wireItems.length ? (
                    <div className="empire-wire" aria-label="Empire Wire">
                        <span className="empire-wire-tag">Empire Wire</span>
                        <div className="empire-wire-track">
                            {wireItems.map((w, i) => <span key={'a' + i} className="empire-wire-item">{w}</span>)}
                            {wireItems.map((w, i) => <span key={'b' + i} className="empire-wire-item">{w}</span>)}
                        </div>
                    </div>
                ) : null}
            </main>
        </div>
    );
}

// buildCommandBridge — the terminal HOME data contract. Pure composition of the portfolio
// model (KPI strip, radar = model.signals, league stack = model.provinces), the cross-league
// action queue, the brief, and week-over-week deltas from the snapshot store. The Command
// Bridge screen renders this object; no data work happens in the view.
//   input: { model, actionQueue, brief, empireDelta }  (empireDelta = WrSnapshots.empireDelta(leagueIds))
function buildCommandBridge(input) {
    input = input || {};
    const model = input.model || {};
    const totals = model.totals || {};
    const queue = input.actionQueue || [];
    const delta = input.empireDelta || null;
    const pickCapital = model.pickCapital || {};
    const provinces = model.provinces || [];
    const topExp = (model.exposure || [])[0] || null;
    const leagueLabel = model.coverage?.complete === false ? ' loaded leagues' : ' leagues';

    const fmtK = v => {
        const n = Math.round(Number(v) || 0);
        if (n < 1000) return String(n);
        const k = n / 1000;
        return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
    };
    const dir = d => (d == null ? null : d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
    const healthTone = h => (h == null ? null : h >= 80 ? 'good' : h >= 65 ? 'warn' : 'bad');

    // Honest "in a playoff spot" — actual standings rank (wins, points-for tiebreak) vs the
    // league's playoff_teams. Uses each province's own league rosters, not a DHQ proxy.
    const inPlayoffSpot = p => {
        const lg = p.league || {};
        const rosters = lg.rosters || [];
        if (!rosters.length || !p.roster) return false;
        const cutoff = (lg.settings && lg.settings.playoff_teams) || 6;
        const pf = r => ((r.settings && r.settings.fpts) || 0) + (((r.settings && r.settings.fpts_decimal) || 0) / 100);
        const ranked = rosters.slice().sort((a, b) => {
            const aw = (a.settings && a.settings.wins) || 0, bw = (b.settings && b.settings.wins) || 0;
            return bw !== aw ? bw - aw : pf(b) - pf(a);
        });
        const rank = ranked.findIndex(r => String(r.roster_id) === String(p.roster.roster_id)) + 1;
        return rank > 0 && rank <= cutoff;
    };

    const rec = totals.totalRecord || { wins: 0, losses: 0 };
    const games = (rec.wins || 0) + (rec.losses || 0);
    const winPctStr = games ? ('.' + String(Math.round((rec.wins / games) * 1000)).padStart(3, '0')).replace('.1000', '1.000') : '—';
    const playoffSpots = provinces.filter(inPlayoffSpot).length;
    // Chopped leagues never accrue a W-L record (totalRecord already excludes
    // them above) — surface that on the tile itself rather than let the KPI
    // silently look like a 3-league record when it is really across 4.
    const choppedProvinces = provinces.filter(p => p.isChopped);
    const choppedNote = choppedProvinces.length
        ? choppedProvinces.length + ' on survival rules (' + choppedProvinces.map(p => p.isEliminated ? 'chopped wk ' + p.eliminatedWeek : (p.aliveCount || '?') + ' of ' + p.teams + ' alive').join(', ') + ')'
        : null;

    const dhqDelta = delta ? delta.totalDHQDelta : null;
    // prevDHQ must come from the delta's own universe (leagues that have a prior snapshot),
    // not model totalDHQ (all leagues), or the % mixes two different bases.
    const prevDHQ = (dhqDelta != null && delta && delta.curDHQ != null) ? delta.curDHQ - dhqDelta : null;
    const dhqPct = (dhqDelta != null && prevDHQ) ? Math.round((dhqDelta / prevDHQ) * 1000) / 10 : null;
    const healthDelta = (totals.valueBasis === undefined || totals.valueBasis === 'dynasty') && delta ? delta.avgHealthDelta : null;
    const highActions = queue.filter(a => a && a.severity === 'high').length;

    const kpis = [
        { key: 'value', label: 'Empire Value', value: totals.valueBasis === 'mixed' ? 'By league' : totals.totalValue === null ? 'Unavailable' : fmtK(totals.totalValue === undefined ? totals.totalDHQ : totals.totalValue),
          sub: (totals.valueBasis === 'mixed' ? 'Different value bases; open a league' : totals.valueBasis === 'seasonal' ? 'League-scored season value' : totals.valueBasis === 'unknown' ? 'Format or holdings unavailable' : 'Dynasty DHQ') + (model.coverage?.complete === false ? ' · loaded leagues only' : ''),
          delta: (totals.valueBasis === undefined || totals.valueBasis === 'dynasty') && dhqDelta != null ? { dir: dir(dhqDelta), pct: dhqPct } : null },
        { key: 'record', label: 'Record', value: (rec.wins || 0) + '–' + (rec.losses || 0),
          sub: winPctStr + (games ? ' · ' + playoffSpots + ' in playoff spots' : '') + (choppedNote ? ' · ' + choppedNote : '') },
        { key: 'health', label: 'Avg Health', value: totals.avgHealth != null ? String(totals.avgHealth) : '—',
          tone: healthTone(totals.avgHealth),
          sub: totals.valueBasis && totals.valueBasis !== 'dynasty' ? 'Dynasty assessments only' : healthDelta == null ? 'no prior week yet'
               : healthDelta === 0 ? 'flat week over week'
               : (healthDelta > 0 ? 'up ' : 'down ') + Math.abs(healthDelta) + ' from last week',
          delta: healthDelta != null ? { dir: dir(healthDelta), n: healthDelta } : null },
        { key: 'picks', label: 'Pick Capital', value: pickCapital.complete === false && !pickCapital.loadedLeagues ? '—' : String(pickCapital.total || 0),
          sub: pickCapital.complete === false ? (pickCapital.loadedLeagues ? 'known picks · coverage incomplete' : 'ownership unavailable') : (pickCapital.premium || 0) + ' R1–2' + (pickCapital.unpriced ? ' · ' + pickCapital.unpriced + ' unpriced' : '') },
        { key: 'exposure', label: 'Top Exposure', value: topExp ? topExp.exposurePct + '%' : '—',
          tone: topExp && topExp.exposurePct >= 50 ? 'warn' : null,
          sub: topExp ? topExp.name + ' · ' + topExp.count + ' of ' + (totals.leagues || 0) + leagueLabel : model.coverage?.complete === false ? 'exposure check incomplete' : 'no duplicate exposure' },
        { key: 'actions', label: 'Open Actions', value: String(queue.length),
          tone: highActions ? 'gold' : null, sub: highActions + ' high priority' },
    ];

    return { kpis, queue, radar: model.signals || [], leagueStack: provinces, brief: input.brief || '' };
}

if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.App.buildEmpireActionQueue = buildEmpireActionQueue;
    window.App.buildEmpireBrief = buildEmpireBrief;
    window.App.buildEmpireRolodex = buildEmpireRolodex;
    window.App.buildEmpireGrudges = buildEmpireGrudges;
    window.App.buildEmpireIndex = buildEmpireIndex;
    window.App.buildThreatBoard = buildThreatBoard;
    window.App.buildWarTable = buildWarTable;
    window.App.buildProvincesMap = buildProvincesMap;
    window.App.buildScoutBoard = buildScoutBoard;
    window.App.inferDnaFromTransactions = inferDnaFromTransactions;
    window.App.buildEmpireDna = buildEmpireDna;
    window.App.buildEmpireMoves = buildEmpireMoves;
    window.App.buildEmpireConsolidation = buildEmpireConsolidation;
    window.App.buildCommandBridge = buildCommandBridge;
    window.EmpireDashboard = EmpireDashboard;
}
