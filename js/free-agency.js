// ══════════════════════════════════════════════════════════════════
// free-agency.js — FreeAgencyTab component
// ══════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // END TRADE CALCULATOR TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════════════════
    // FREE AGENCY TAB — migrated from free-agency.html
    // ══════════════════════════════════════════════════════════════════════════
    // Phase 6 deferred: FA column registry — mirrors the My Roster column contract so
    // SavedViewBar's `columns` slot round-trips correctly between surfaces.
    const FA_COLUMNS = {
        pos:        { label: 'Position',                shortLabel: 'Pos',    width: '40px', sortKey: 'pos',   group: 'core'    },
        team:       { label: 'NFL Team',                shortLabel: 'Team',   width: '60px', sortKey: 'team',  group: 'core'    },
        age:        { label: 'Age',                     shortLabel: 'Age',    width: '34px', sortKey: 'age',   group: 'dynasty' },
        dhq:        { label: 'DHQ Dynasty Value',       shortLabel: 'DHQ',    width: '70px', sortKey: 'dhq',   group: 'dynasty' },
        ppg:        { label: 'Points Per Game',         shortLabel: 'PPG',    width: '65px', sortKey: 'ppg',   group: 'stats'   },
        proj:       { label: 'This Week Projection',    shortLabel: 'Proj',   width: '78px', sortKey: 'proj',  group: 'stats'   },
        peakYr:     { label: 'Peak Years Left',         shortLabel: 'Peak',   width: '44px', sortKey: 'peak',  group: 'dynasty' },
        yrsExp:     { label: 'NFL Years Experience',    shortLabel: 'Exp',    width: '38px', sortKey: 'exp',   group: 'dynasty' },
        college:    { label: 'College',                 shortLabel: 'College',width: '90px', sortKey: 'college', group: 'scout' },
        height:     { label: 'Height',                  shortLabel: 'Ht',     width: '44px', sortKey: 'height',  group: 'scout' },
        weight:     { label: 'Weight (lbs)',            shortLabel: 'Wt',     width: '42px', sortKey: 'weight',  group: 'scout' },
        depthChart: { label: 'NFL Depth Chart Position',shortLabel: 'Depth',  width: '50px', group: 'scout'   },
        injury:     { label: 'Injury Status',           shortLabel: 'Inj',    width: '46px', sortKey: 'injury',  group: 'stats' },
        faab:       { label: 'Suggested FAAB Bid',      shortLabel: 'FAAB bid', width: '94px', group: 'stats'   },
        // Usage stats — beyond PPG, and POSITION-SPECIFIC: each row pulls its
        // own position's top 2 signature stats (window.App.StatCatalog.
        // getSignatureStats — targets/snap%/RZ for a WR, CMP%/YPA for a QB,
        // tackles/sacks for IDP, etc.) rather than one fixed column that reads
        // '—' for every position it doesn't apply to. Label is generic here
        // since it varies per row; the cell itself carries the stat's short
        // label inline (e.g. "62% SNP") so it reads correctly on a mixed list.
        sig1:       { label: 'Position Stat 1 (varies by position — see cell)', shortLabel: 'Usage 1', width: '90px', sortKey: 'sig1', group: 'stats' },
        sig2:       { label: 'Position Stat 2 (varies by position — see cell)', shortLabel: 'Usage 2', width: '90px', sortKey: 'sig2', group: 'stats' },
        // Draft-capital + profile columns. Rookies use the rookie-data prospect
        // record (window.App.RookieFields); vets fall back to the static NFL
        // draft dataset (faDraftCap below). Consensus rank/tier stay rookie-only.
        rkSlot:     { label: 'NFL Draft Capital — round + overall pick (UDFA = undrafted)', shortLabel: 'Draft',  width: '56px', sortKey: 'rkSlot', group: 'scout' },
        rkTeam:     { label: 'NFL Team That Drafted Him',shortLabel: 'Drafted',width: '52px', sortKey: 'rkTeam', group: 'scout' },
        rkRank:     { label: 'Rookie Consensus Rank',   shortLabel: 'Cons #', width: '50px', sortKey: 'rkRank', group: 'scout' },
        rkTier:     { label: 'Rookie Tier',             shortLabel: 'Tier',   width: '70px', sortKey: 'rkTier', group: 'scout' },
        rkProfile:  { label: 'Profile — Ht · Wt (· 40 time for rookies)', shortLabel: 'Profile', width: '120px', group: 'scout' },
    };
    // NFL draft capital for vets — static vendored dataset (window.WR_DRAFT_PROFILE,
    // js/shared/draft-profile-data.js): [year, round, OVERALL pick, team];
    // round 0 = confirmed UDFA. Mirrors my-team.js draftCapFor.
    function faDraftCap(pid) {
        const d = window.WR_DRAFT_PROFILE?.[pid];
        if (!d) return null;
        return { year: d[0] || 0, round: d[1] || 0, overall: d[2] || 0, team: d[3] || '' };
    }
    function faDraftSlotTxt(pid) {
        const dp = faDraftCap(pid);
        return dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null;
    }
    const FA_COLUMN_PRESETS = {
        default: ['pos','team','age','dhq','ppg','proj','faab','sig1','sig2'],
        scout:   ['pos','age','college','height','weight','depthChart'],
        bidding: ['pos','team','dhq','ppg','faab','injury'],
        rookie:  ['pos','college','rkSlot','rkTeam','rkRank','rkTier','rkProfile','dhq'],
        usage:   ['pos','team','age','sig1','sig2','ppg'],
        full:    Object.keys(FA_COLUMNS),
    };
    const ROOKIE_DRAFT_LOCK_STATUSES = new Set(['pre_draft', 'drafting']);
    const ROOKIE_DHQ_SOURCES = new Set(['FC_ROOKIE', 'PROSPECT_ROOKIE']);
    // Scout-free vs Pro: the FAAB bid read is Pro. Presets AND persisted/saved
    // column prefs pass through faTierCols at every set-site plus once at
    // render, so a stored 'faab' pref can't resurrect the column for a free
    // user (mirrors the My Roster 'action' column). The 'fit' column is gone
    // entirely (owner ask 2026-07-12) — the roster-fit read (fitRead + the
    // team-assess needs) still powers the drawer's Roster Fit panel,
    // decorateFaCandidate, and the action board.
    const FA_PRO_COLS = new Set(['faab']);
    function faTierCols(cols) {
        const pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
        return pro ? (cols || []) : (cols || []).filter(k => !FA_PRO_COLS.has(k));
    }

    function faNormName(s) {
        return (s || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
    }

    // The player position groups this league actually rosters, derived from
    // roster_positions (FLEX→RB/WR/TE, SUPER_FLEX→+QB, REC_FLEX→WR/TE, IDP_FLEX→DL/LB/DB).
    // Lets the FA position chips show only relevant groups (no IDP in a non-IDP league, etc.).
    function leaguePlayablePositions(rosterPositions) {
        const rp = rosterPositions || [];
        const set = new Set();
        rp.forEach(slot => {
            const s = String(slot).toUpperCase();
            if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(s)) set.add(s);
            else if (s === 'FLEX' || s === 'WRRB_FLEX' || s === 'WRRBTE_FLEX') { set.add('RB'); set.add('WR'); set.add('TE'); }
            else if (s === 'REC_FLEX') { set.add('WR'); set.add('TE'); }
            else if (s === 'SUPER_FLEX' || s === 'QB_FLEX') { set.add('QB'); set.add('RB'); set.add('WR'); set.add('TE'); }
            else if (s === 'IDP_FLEX') { set.add('DL'); set.add('LB'); set.add('DB'); }
            else if (['DE', 'DT', 'EDGE', 'NT'].includes(s)) set.add('DL');
            else if (['CB', 'S', 'SS', 'FS'].includes(s)) set.add('DB');
            else if (['OLB', 'ILB', 'MLB'].includes(s)) set.add('LB');
        });
        return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => set.has(p));
    }
    window.App = window.App || {};
    window.App.leaguePlayablePositions = leaguePlayablePositions;

    // Shared eagerly so My Roster can evaluate waivers without mounting this tab.
    const buildFaRosterRead = window.App.buildFaRosterRead;

    function collectFaDrafts(currentLeague, briefDraftInfo) {
        const byId = new Map();
        const add = (draft) => {
            if (!draft || typeof draft !== 'object') return;
            const key = draft.draft_id || draft.id || `${draft.season || ''}-${draft.status || ''}-${draft.start_time || ''}`;
            byId.set(key, draft);
        };
        add(briefDraftInfo);
        (window.S?.drafts || []).forEach(add);
        (currentLeague?.drafts || []).forEach(add);
        return [...byId.values()];
    }

    function isDynastyLeague(currentLeague) {
        const settingsType = Number(currentLeague?.settings?.type);
        if (settingsType === 2) return true;
        const text = [
            currentLeague?.type,
            currentLeague?.metadata?.type,
            currentLeague?.metadata?.league_type,
            currentLeague?.metadata?.draft_type,
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes('dynasty');
    }

    function isRookieDraftLike(draft, currentLeague) {
        if (!draft) return false;
        const playerType = String(draft.settings?.player_type ?? draft.metadata?.player_type ?? '').toLowerCase();
        if (playerType === '1' || playerType === 'rookie' || playerType === 'rookies') return true;
        const descr = [
            draft.metadata?.description,
            draft.metadata?.name,
            draft.metadata?.draft_name,
            draft.type,
        ].filter(Boolean).join(' ').toLowerCase();
        if (/\brookie\b|\brookies\b|\bsupplemental\b|\bcollege\b/.test(descr)) return true;
        const rounds = Number(draft.settings?.rounds || 0);
        return isDynastyLeague(currentLeague) && rounds > 0 && rounds <= 8;
    }

    function sameDraftSeason(draft, currentLeague) {
        const leagueSeason = currentLeague?.season;
        if (!leagueSeason || !draft?.season) return true;
        return String(draft.season) === String(leagueSeason);
    }

    function rookiesLockedForWaivers(currentLeague, briefDraftInfo) {
        const drafts = collectFaDrafts(currentLeague, briefDraftInfo).filter(d => sameDraftSeason(d, currentLeague));
        const rookieDrafts = drafts.filter(d => isRookieDraftLike(d, currentLeague));
        if (rookieDrafts.some(d => ROOKIE_DRAFT_LOCK_STATUSES.has(String(d.status || '').toLowerCase()))) return true;
        // Unlock (craze opens) only when EVERY same-season rookie-like draft is
        // complete — handles a rookie + supplemental draft pair so the lock doesn't
        // lift while a second rookie draft is still pending.
        if (rookieDrafts.length && rookieDrafts.every(d => String(d.status || '').toLowerCase() === 'complete')) return false;
        return isDynastyLeague(currentLeague)
            && ROOKIE_DRAFT_LOCK_STATUSES.has(String(currentLeague?.status || '').toLowerCase())
            && !rookieDrafts.some(d => String(d.status || '').toLowerCase() === 'complete');
    }

    function isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData }) {
        if (!rookiesLocked || !p) return false;
        // Exact vet excluder first (owner ask 2026-07-12: vets were leaking into
        // the UDFA craze). WR_DRAFT_PROFILE (static NFL draft-capital dataset via
        // faDraftCap; round 0 = confirmed UDFA) carries the entry year — any year
        // before the current rookie class is definitively a veteran, no matter
        // what the name/exp/gp heuristics below say (years_exp is null for some
        // vets, e.g. a 2023 R4 pick with no recent gp).
        const rookieClassSeason = Number(window.S?.league?.season || window.S?.nflState?.season) || new Date().getFullYear();
        const dc = faDraftCap(pid);
        if (dc && dc.year && dc.year < rookieClassSeason) return false;
        const source = String(window.App?.LI?.playerMeta?.[pid]?.source || '').toUpperCase();
        if (ROOKIE_DHQ_SOURCES.has(source) || source.includes('ROOKIE')) return true;
        const name = faNormName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
        if (prospectNames?.has?.(name)) return true;
        const exp = Number(p.years_exp ?? p.yoe ?? p.maybeYoe ?? 0);
        const hasNflStats = (statsData?.[pid]?.gp || 0) > 0 || ((prevStatsData || {})[pid]?.gp || 0) > 0;
        return exp === 0 && !hasNflStats;
    }

    // ── GM-Office tunable FA filters ────────────────────────────────────────────
    // User-set knobs (min DHQ, max age, prime-years-only, excluded positions) from
    // GM strategy. Applied to the recommendation surfaces (priority adds + action
    // board), never the market explorer (which always shows everyone). The UDFA
    // craze is exempt (buildUdfaCrazeBoard passes skipGmFilters).
    function getGmFaFilters(currentLeague) {
        const leagueId = currentLeague?.league_id || currentLeague?.id;
        let strat = null;
        try {
            strat = (typeof localStorage !== 'undefined' && localStorage.getItem('dhq_gm_strategy_v1') ? window.GMStrategy?.getStrategy?.(leagueId) : null)
                || window.App?.WrStorage?.get?.(window.App?.WR_KEYS?.GM_STRATEGY?.(leagueId))
                || window._wrGmStrategy
                || null;
        } catch (_) {}
        const f = (strat && strat.faFilters) || {};
        const excludePositions = (Array.isArray(f.excludePositions) ? f.excludePositions : [])
            .map(p => String((window.App?.normPos?.(p)) || p || '').toUpperCase()).filter(Boolean);
        return {
            minDhq: Number(f.minDhq) || 0,
            maxAge: Number(f.maxAge) || 0,
            requirePrimeYears: !!f.requirePrimeYears,
            excludePositions,
        };
    }
    function gmFaFiltersActive(f) {
        return !!(f && (f.minDhq > 0 || f.maxAge > 0 || f.requirePrimeYears || (f.excludePositions && f.excludePositions.length)));
    }
    function gmFaPeakYears(pos, age) {
        const curve = (typeof window.App?.getAgeCurve === 'function' ? window.App.getAgeCurve(pos) : null)
            || { peak: (window.App?.peakWindows || {})[pos] || [24, 29] };
        const peakEnd = (curve.peak && curve.peak[1]) || 29;
        return Math.max(0, peakEnd - (Number(age) || 25));
    }
    function applyGmFaFilters(list, f) {
        if (!gmFaFiltersActive(f)) return list || [];
        return (list || []).filter(x => {
            const pos = String(x.pos || (window.App?.normPos?.(x.p?.position)) || x.p?.position || '').toUpperCase();
            const age = Number(x.p?.age) || 0;
            if (f.minDhq && (Number(x.dhq) || 0) < f.minDhq) return false;
            if (f.excludePositions.includes(pos)) return false;
            if (f.maxAge && age && age > f.maxAge) return false;
            if (f.requirePrimeYears && !(gmFaPeakYears(pos, age) > 0)) return false;
            return true;
        });
    }

    // A season projection or dynasty score does not establish a starting job.
    // Keep backups searchable; they are watchlist/speculative decisions, not
    // automatic current-season lineup upgrades or coverage recommendations.
    function waiverRoleRead(player, league, skin) {
        const type = window.App?.LeagueSkin?.build?.({ league })?.type
            || skin?.type || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' })[league?.settings?.type] || 'unknown';
        const seasonal = ['redraft', 'keeper', 'chopped', 'best_ball'].includes(type);
        if (!seasonal || player?.position !== 'QB') return { eligible: true, reason: null };
        const order = Number(player.depth_chart_order);
        const qbDepth = String(player.depth_chart_position || player.position).toUpperCase() === 'QB';
        if (qbDepth && order === 1) return { eligible: true, reason: 'Listed starting QB; verify current availability before adding.' };
        return { eligible: false, reason: qbDepth && order > 1
            ? 'Backup QB: watchlist only until there is evidence of a starting opportunity.'
            : 'QB role unknown: verify a starting opportunity before recommending a pickup.' };
    }

    function matchWaiverRecommendations(recommendations, candidates) {
        const names = new Set((candidates || []).map(x => String(x.name || '').trim().toLowerCase()));
        const seen = new Set();
        return (recommendations || []).filter(rec => {
            const name = String(rec?.name || '').trim().toLowerCase();
            if (!name || !names.has(name) || seen.has(name)) return false;
            seen.add(name);
            return typeof rec.reason === 'string';
        });
    }

    function waiverRosterOptions(args) {
        const league=args.currentLeague || {}, WP=window.App?.WeeklyProj;
        const week=args.week ?? WP?.currentWeek?.() ?? window.S?.nflState?.week ?? null;
        const memo=new Map();
        const gm=window.WR?.GmMode?.effects?.(league.league_id || league.id);
        return { week, protectedPids: [...(gm?.untouchable || []), ...(args.protectedPids || [])],
            project(pid) {
                if (memo.has(pid)) return memo.get(pid);
                let value=null;
                try {
                    if (typeof args.project === 'function') value=args.project(pid);
                    else if (WP?.projectPlayer && week != null) {
                        const current=args.statsData?.[pid], prior=args.prevStatsData?.[pid];
                        const hasBaseline=WP.providerLine?.(pid,week) || current?.gp>0 || prior?.gp>0;
                        if (hasBaseline) {
                            const r=WP.projectPlayer(pid,{playersData:args.playersData,statsData:args.statsData,priorData:args.prevStatsData,scoring:league.scoring_settings || {},week});
                            if (r?.available && Number.isFinite(r.points?.median)) value=r.points.median;
                        }
                    }
                } catch (_) { /* Missing evidence stays unknown. */ }
                memo.set(pid,value); return value;
            } };
    }
    function waiverValue(pid, league, skin) {
        const PV=window.App?.PlayerValue;
        const type=window.App?.LeagueSkin?.build?.({league})?.type || skin?.type || ({0:'redraft',1:'keeper',2:'dynasty',3:'chopped'})[league?.settings?.type];
        if (['redraft','keeper','chopped','best_ball'].includes(type)) return PV?.getSeasonValue ? PV.getSeasonValue(pid) : PV?.getValue?.(pid,{skin:skin || {type}}) ?? null;
        return PV?.getValue ? PV.getValue(pid,{skin}) : window.App?.LI?.playerScores?.[pid] ?? null;
    }
    function buildFreeAgencyActionBoard(args = {}) {
        const playersData = args.playersData || {};
        const statsData = args.statsData || {};
        const prevStatsData = args.prevStatsData || {};
        const myRoster = args.myRoster || null;
        const currentLeague = args.currentLeague || {};
        const briefDraftInfo = args.briefDraftInfo || null;
        const leagueSkin = args.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;

        const _valueShortLabel = leagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const rosterState = args.rosterState || window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters, leagueSkin }) || { isUsable: true };
        if (!rosterState.isUsable) return { priorityAdds: [], actionBoardPlayers: [], availablePlayers: [], rosterRead: null };
        const eligibility = window.App?.RecommendationEligibility?.check(currentLeague, myRoster);
        if (!eligibility?.ok) return { priorityAdds: [], actionBoardPlayers: [], availablePlayers: [], rosterRead: null, reason: eligibility?.reason || 'Eligibility service is loading.' };
        // Free/Pro: FAAB bids stay null and nothing is published to the shared
        // Intelligence rec stream for free users; consumers (brief, HQ, craze)
        // gate their own display, this nulls the rec payloads at the source.
        const faIsPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

        const normPos = window.App?.normPos || (p => p);

        const rawAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
        const faValue = pid => waiverValue(pid, currentLeague, leagueSkin);
        const rosterRead = buildFaRosterRead(myRoster, currentLeague, playersData, faValue, waiverRosterOptions(args));
        const assess = { ...(rawAssess || {}), needs: rosterRead.known ? rosterRead.rows.filter(r => r.fillsStarter).map(r => ({ pos: r.pos, urgency: 'deficit' })) : [] };

        const scoring = currentLeague?.scoring_settings || {};
        const leagueProfile = typeof window.App?.Intelligence?.buildLeagueProfile === 'function'
            ? window.App.Intelligence.buildLeagueProfile({ league: currentLeague, rosters: currentLeague?.rosters || [], platform: currentLeague?._platform })
            : null;

        const peaks = window.App?.peakWindows || {};
        const rookiesLocked = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        const prospectNames = rookiesLocked && typeof window.getProspects === 'function'
            ? new Set((window.getProspects() || []).map(p => faNormName(p.name)).filter(Boolean))
            : new Set();

        function calcRawPtsFor(s) {
            return typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(s, scoring) : 0;
        }
        const isDraftProspect = (pid, p) => isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData });
        function playerName(p, pid) {
            if (!p) return pid ? 'Player ' + pid : 'Unknown';
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            if (full) return full;
            const pos = (normPos?.(p.position) || p.position || '').toUpperCase();
            if ((pos === 'DEF' || pos === 'DST') && (p.team || pid)) return (p.team || pid) + ' D/ST';
            return pid ? 'Player ' + pid : 'Unknown';
        }
        function seasonPpgFor(pid) {
            const st = statsData[pid] || {};
            const prevSt = (prevStatsData || {})[pid] || {};
            if (st.gp > 0) return +(calcRawPtsFor(st) / st.gp).toFixed(1);
            if (prevSt.gp > 0) return +(calcRawPtsFor(prevSt) / prevSt.gp).toFixed(1);
            return 0;
        }
        function ageCurveFor(pos) {
            return typeof window.App?.getAgeCurve === 'function'
                ? window.App.getAgeCurve(pos)
                : { build: [22, 24], peak: peaks[pos] || [24, 29], decline: [30, 32] };
        }
        function peakYearsFor(pos, age) {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.peak[1] - (age || 25));
        }
        function valueYearsFor(pos, age) {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.decline[1] - (age || 25));
        }
        function windowRead(pos, age) {
            const peakYrs = peakYearsFor(pos, age);
            const valueYrs = valueYearsFor(pos, age);
            if (peakYrs >= 4) return { label: peakYrs + 'yr peak', short: 'Rising', color: 'var(--k-2ecc71, #2ecc71)', peakYrs, valueYrs };
            if (peakYrs >= 1) return { label: peakYrs + 'yr peak', short: 'Prime', color: 'var(--gold)', peakYrs, valueYrs };
            if (valueYrs >= 1) return { label: valueYrs + 'yr value', short: 'Vet', color: 'var(--k-f0a500, #f0a500)', peakYrs, valueYrs };
            return { label: 'short term', short: 'Post', color: 'var(--k-e74c3c, #e74c3c)', peakYrs, valueYrs };
        }
        function fitRead(pos, dhq, candidate) { return rosterRead.fit(pos, dhq, candidate); }
        function faabSuggest() {
            // Player scores do not translate into dollars. The bid panel uses
            // observed league transactions and keeps unknown prices unknown.
            return null;
        }
        function decorateFaCandidate(x) {
            const pos = x.pos || normPos(x.p?.position) || x.p?.position || '';

            const ppg = x.ppg != null ? x.ppg : seasonPpgFor(x.pid);
            const win = leagueSkin?.type === 'dynasty' ? windowRead(pos,x.p?.age) : {label:'This season',short:'Season',color:'var(--silver)',peakYrs:null,valueYrs:null};
            const fit = fitRead(pos, x.dhq, x);
            const faab = x.faab || faabSuggest(x.dhq, pos, x.p?.age);
            const formatReasons = leagueProfile && typeof window.App?.Intelligence?.buildPlayerFormatReasons === 'function'
                ? window.App.Intelligence.buildPlayerFormatReasons({ player: x.p, pos, profile: leagueProfile }).slice(0, 2)
                : [];
            const playerContext = typeof window.App?.Intelligence?.buildPlayerContext === 'function'
                ? window.App.Intelligence.buildPlayerContext({
                    id: 'waiver_context_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    peakYrs: win.peakYrs,
                    valueYrs: win.valueYrs,
                    fit,
                    formatReasons,
                })
                : null;
            const whyBase = fit.score > 0 ? 'Compare the proposed drop and confirm player locks on your league platform before submitting.' : 'No measured lineup benefit.';
            const why = fit.label + '. ' + whyBase;
            const intelligence = typeof window.App?.Intelligence?.buildWaiverRecommendation === 'function'
                ? window.App.Intelligence.buildWaiverRecommendation({
                    id: 'waiver_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    fit,
                    faab,
                    formatReasons,
                    playerContext,
                    detail: why,
                    windowDetail: whyBase,
                    badge: fit.short,
                })
                : null;
            return { ...x, name: playerName(x.p, x.pid), pos, ppg, faab, fit, fitScore: fit.score, peakYrs: win.peakYrs, valueYrs: win.valueYrs, windowLabel: win.label, windowShort: win.short, windowColor: win.color, formatReasons, playerContext, intelligence, why };
        }

        // Multi-copy leagues (MFL rostersPerPlayer): a player is only off the wire
        // once ALL copies are rostered. Count occurrences across rosters and gate on
        // the copy cap (copies===1 ⇒ identical to the old gone-on-first-roster Set).
        const faCopies = Math.max(1, Number(currentLeague?.settings?.player_copies) || 1);
        const faRosteredCount = {};
        // Dedupe per roster — taxi/reserve ids are also in players[], so a raw count
        // would double-count a taxi/IR stash toward the copy cap.
        (currentLeague?.rosters || []).forEach(r => new Set((r.players || []).concat(r.taxi || [], r.reserve || []).map(String)).forEach(k => { faRosteredCount[k] = (faRosteredCount[k] || 0) + 1; }));
        const rostered = { has: (pid) => (faRosteredCount[String(pid)] || 0) >= faCopies };
        const availablePlayers = Object.entries(playersData || {})
            .filter(([pid, p]) => !rostered.has(pid) && p.team && p.status !== 'Inactive' && p.status !== 'Retired' && p.active !== false && !isDraftProspect(pid, p))
            .map(([pid, p]) => ({ pid, p, dhq: faValue(pid), pos: normPos(p.position) || p.position }))
            .filter(x => x.dhq > 0)
            .sort((a, b) => b.dhq - a.dhq)
            .slice(0, 300);

        // GM-Office filters scope the recommendation surfaces (not the market pool).
        const gmFa = getGmFaFilters(currentLeague);
        const recPool = (args.skipGmFilters ? availablePlayers : applyGmFaFilters(availablePlayers, gmFa))
            .filter(x => waiverRoleRead(x.p, currentLeague, leagueSkin).eligible);
        // GM Strategy target positions float relevant FA adds to the top
        // (gmEff resolved above, next to the rebuild/contend posture reads).

        // Market posture biases candidate ordering: buy_low floats dipped-value
        // adds (negative trend, real DHQ); sell_high/hold tighten the board by
        // fading speculative low-value candidates.

        const actionBoardPlayers = recPool
            .map(decorateFaCandidate)
            .filter(x => x.fitScore > 0 && !rosterRead.owned.some(p => p.pid === String(x.pid)))
            .sort((a,b) => (b.fit.weeklyGain ?? 0)-(a.fit.weeklyGain ?? 0) || (b.fit.seasonGain ?? 0)-(a.fit.seasonGain ?? 0));
        const priorityAdds = actionBoardPlayers.slice(0,5);
        if (!args.readOnly && faIsPro && typeof window.App?.Intelligence?.publishRecommendations === 'function') {
            window.App.Intelligence.publishRecommendations('waiver', priorityAdds.map(x => x.intelligence).filter(Boolean), { surface: 'free-agency-action-board' });
        }
        return { priorityAdds, actionBoardPlayers, availablePlayers, rosterRead, gmFaFilters: gmFa, gmHiddenCount: Math.max(0, availablePlayers.length - recPool.length) };
    }

    // ── UDFA craze ────────────────────────────────────────────────────────────
    // The dynasty-only post-rookie-draft scramble. When the rookie lock lifts, the
    // newly-eligible UDFAs (undrafted rookies signed to an NFL team) become claimable
    // and the craze board ranks them by roster fit with league-history-anchored FAAB.

    // Blend the model FAAB bid with this league's own positional FAAB history so the
    // suggestion reflects how this league actually bids, not just a generic dhq/250.
    function blendFaabWithHistory(faab, range) {
        if (!faab && !range) return null;
        if (!faab) return { sug: range.avg, lo: range.low, hi: range.high, leagueAvg: range.avg, leagueCount: range.count };
        if (!range) return { ...faab, leagueAvg: null, leagueCount: 0 };
        return {
            sug: Math.round((faab.sug + range.avg) / 2),
            lo: Math.min(faab.lo, range.low),
            hi: Math.max(faab.hi, range.high),
            leagueAvg: range.avg,
            leagueCount: range.count,
            scarcity: faab.scarcity,
            modeMultiplier: faab.modeMultiplier,
        };
    }

    // Tier the post-unlock free-agent pool into the craze board. Composes the existing
    // action board (so fit/faab/intelligence are reused) and filters to UDFA candidates
    // signed to an NFL team. Watch tier = undrafted prospects with no team (not claimable).
    // High-level UDFA-craze overview: total available signed UDFAs, broken out by
    // the league's playable position groups with a count + highest-rated in each.
    // It's a launchpad — drilling into a group filters the FA pool to rookies+that pos.
    function buildUdfaCrazeBoard(args = {}) {
        const currentLeague = args.currentLeague || {};
        const empty = { total: 0, groups: [], candidates: [] };
        if (!isDynastyLeague(currentLeague)) return empty;
        const statsData = args.statsData || {};
        const prevStatsData = args.prevStatsData || {};
        const prospects = (typeof window.getProspects === 'function' ? window.getProspects() : []) || [];
        const prospectNames = new Set(prospects.map(p => faNormName(p.name)).filter(Boolean));
        const prospectByName = new Map(prospects.map(p => [faNormName(p.name), p]));
        // The craze runs its own eligibility — exempt it from the GM-Office FA filters
        // (a minDHQ would wrongly nuke low-value-but-high-upside UDFAs).
        const board = (window.App?.buildFreeAgencyActionBoard || buildFreeAgencyActionBoard)({ ...args, skipGmFilters: true });
        const pool = board.actionBoardPlayers || [];
        const livRange = window.App?.livFAABRange || (typeof window.livFAABRange === 'function' ? window.livFAABRange : null);

        const candidates = pool
            .filter(x => x.p?.team && isRookieWaiverLockedCandidate(x.pid, x.p, { rookiesLocked: true, prospectNames, statsData, prevStatsData }))
            .map(x => {
                const prospect = prospectByName.get(faNormName(x.name)) || null;
                const range = livRange ? livRange(x.pos) : null;
                return { ...x, prospect, nflTeam: x.p.team, faab: blendFaabWithHistory(x.faab, range), tierLabel: prospect?.tierLabel || null };
            });

        const posList = (args.leaguePositions && args.leaguePositions.length) ? args.leaguePositions : leaguePlayablePositions(currentLeague.roster_positions);
        const order = posList.length ? posList : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
        const groups = order.map(pos => {
            const inPos = candidates.filter(c => String(c.pos || '').toUpperCase() === pos).sort((a, b) => (b.dhq || 0) - (a.dhq || 0));
            return { pos, count: inPos.length, top: inPos[0] || null };
        }).filter(g => g.count > 0);

        if (!args.readOnly && (typeof window.wrIsPro !== 'function' || window.wrIsPro()) && typeof window.App?.Intelligence?.publishRecommendations === 'function') {
            window.App.Intelligence.publishRecommendations('waiver', candidates.slice(0, 8).map(x => x.intelligence).filter(Boolean), { surface: 'udfa-craze' });
        }
        return { total: candidates.length, groups, candidates };
    }

    function udfaLockKey(leagueId) { return 'dhq_udfa_lock_' + (leagueId || 'default'); }
    // Detect the rookie lock→unlock flip and open the craze. Called on each FA
    // evaluation; persists the prior lock state so the flip is caught even when the
    // draft completed on the real platform (not via our draft sim → no draft:closed).
    function observeUdfaCrazeFlip(currentLeague, briefDraftInfo) {
        if (!isDynastyLeague(currentLeague)) return null;
        const leagueId = currentLeague?.league_id || currentLeague?.leagueId || window.S?.currentLeagueId || 'default';
        const store = window.DhqStorage;
        const key = udfaLockKey(leagueId);
        const prev = store ? store.get(key, null) : null;
        const now = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        if (store) store.set(key, now);
        if (prev === true && now === false) {
            // 21-day shelf life anchored to draft COMPLETION (owner ask 2026-07-12):
            // this flip can be observed months after the real-platform draft ended
            // (FA tab simply not opened), and openCraze would otherwise start a
            // fresh window from Date.now(). Completion ts = last_picked ||
            // start_time || created — same triple league-detail.js uses.
            const CRAZE_MAX_MS = 21 * 24 * 3600 * 1000;
            const completionTs = collectFaDrafts(currentLeague, briefDraftInfo)
                .filter(d => sameDraftSeason(d, currentLeague) && isRookieDraftLike(d, currentLeague) && String(d.status || '').toLowerCase() === 'complete')
                .reduce((ts, d) => Math.max(ts, Number(d.last_picked || d.start_time || d.created) || 0), 0);
            if (completionTs && Date.now() > completionTs + CRAZE_MAX_MS) return null; // stale flip — lock flag stored above, craze stays shut
            if (window.App?.PostDraft?.openCraze) {
                // Cap the window at completion+21d; the (shorter) waiver-cadence default wins otherwise.
                const defaultEnd = window.App.PostDraft.computeWindowEnd ? window.App.PostDraft.computeWindowEnd(currentLeague, Date.now()) : 0;
                const crazeOpts = { league: currentLeague };
                if (completionTs) crazeOpts.windowEnd = Math.min(defaultEnd || Infinity, completionTs + CRAZE_MAX_MS);
                try { window.App.PostDraft.openCraze(leagueId, crazeOpts); } catch (_) {}
            }
            try { window.dispatchEvent(new CustomEvent('wr:udfa-craze-open', { detail: { leagueId, season: currentLeague?.season } })); } catch (_) {}
            return leagueId;
        }
        return null;
    }

    window.App = window.App || {};
    window.App.rookiesLockedForWaivers = rookiesLockedForWaivers;
    window.App.isRookieWaiverLockedCandidate = isRookieWaiverLockedCandidate;
    window.App.buildFreeAgencyActionBoard = buildFreeAgencyActionBoard;
    window.App.buildUdfaCrazeBoard = buildUdfaCrazeBoard;
    window.App.observeUdfaCrazeFlip = observeUdfaCrazeFlip;
    window.App.blendFaabWithHistory = blendFaabWithHistory;
    window.App.getFreeAgencyBriefTarget = function getFreeAgencyBriefTarget(args) {
        return buildFreeAgencyActionBoard(args).priorityAdds[0] || null;
    };

    // ── Waiver Take cache: 15 minutes, matched to the complete decision context ──
    const WAIVER_TAKE_CACHE_TTL_MS = 15 * 60 * 1000;
    function waiverTakeCacheKey(currentLeague) {
        const user = window.OD?.getCurrentUsername?.() || window.S?.user?.username || window.S?.user?.display_name || 'anon';
        const leagueId = currentLeague?.league_id || currentLeague?.id || 'default';
        return 'wr_waiver_take:decision-v4:' + user + ':' + leagueId;
    }
    function loadCachedWaiverTake(currentLeague) {
        try {
            const raw = JSON.parse(localStorage.getItem(waiverTakeCacheKey(currentLeague)) || 'null');
            if (!raw || !raw.ts || raw.ts > Date.now() || Date.now() - raw.ts >= WAIVER_TAKE_CACHE_TTL_MS) return { recommendations: [], ts: 0 };
            return raw;
        } catch (_) { return { recommendations: [], ts: 0 }; }
    }
    function saveCachedWaiverTake(currentLeague, recommendations, signature) {
        try { localStorage.setItem(waiverTakeCacheKey(currentLeague), JSON.stringify({ recommendations, signature, ts: Date.now() })); } catch (_) {}
    }
    function clearCachedWaiverTake(currentLeague) {
        try { localStorage.removeItem(waiverTakeCacheKey(currentLeague)); } catch (_) {}
    }
    // Defensive brace-matched JSON object extraction — the model is instructed
    // to return raw JSON, but strips fences here in case it doesn't comply.
    function extractWaiverTakeJson(reply) {
        if (!reply || typeof reply !== 'string') return null;
        let clean = reply.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
        const first = clean.indexOf('{');
        const last = clean.lastIndexOf('}');
        if (first < 0 || last <= first) return null;
        try {
            const parsed = JSON.parse(clean.slice(first, last + 1));
            return Array.isArray(parsed?.recommendations) ? parsed.recommendations : null;
        } catch (_) { return null; }
    }
    function buildWaiverTakeContext(priorityAdds, currentLeague, rosterRead, myRoster) {
        const budget=currentLeague?.settings?.waiver_budget ?? null;
        const spent=myRoster?.settings?.waiver_budget_used ?? null;
        return {
            version:4, leagueId:currentLeague?.league_id || currentLeague?.id || null,
            decisionContext:window.WR?.AIContext?.decisionContext?.(currentLeague),
            season:currentLeague?.season ?? null, week:rosterRead?.week ?? null,
            scoring:currentLeague?.scoring_settings || {}, rosterPositions:currentLeague?.roster_positions || [],
            gmStrategy:window.WR?.GmMode?.promptBlock?.(currentLeague?.league_id || currentLeague?.id) || null,
            budget:{total:budget,spent,remaining:budget!=null && spent!=null ? Math.max(0,Number(budget)-Number(spent)) : null,minimum:currentLeague?.settings?.waiver_budget_min ?? null},
            roster:rosterRead?.owned || [], rosterPlayerIds:myRoster?.players || [], starters:myRoster?.starters || [], reserve:myRoster?.reserve || [], taxi:myRoster?.taxi || [],
            evidencePolicy:'Explain only supplied calculations. Preserve nulls, negative weekly effects, required drops and availability assumptions. Do not assert current news without a dated supplied source. Never turn bid history or negotiation scores into probabilities.',
            lineupBefore:{weekly:rosterRead?.beforeWeekly || null,season:rosterRead?.beforeSeason || null},
            evidence:{source:'Imported league/player data and league-scored projection model',sourceUpdatedAt:null,liveNewsVerified:false,bidHistoryIncluded:false,playerLocksVerified:false},
            instruction:'Explain only the supplied add/drop plans. Separate this-week projected points from ROS starter value. Do not invent news, player availability, retention costs, bids, or winning probabilities. A missing price is unknown, not a recommendation to bid zero. Confirm lineup/transaction locks before submitting. Return an empty recommendations array when no plan improves the roster.',
            candidates:(priorityAdds || []).slice(0,6).map(x=>({pid:x.pid,name:x.name,position:x.pos,leagueAdjustedValue:x.dhq,
                role:waiverRoleRead(x.p,currentLeague).reason,injury:x.p?.injury_status || null,depth:x.p?.depth_chart_order ?? null,
                weeklyProjection:x.fit?.candidateProjection ?? null,weeklyGain:x.fit?.weeklyGain ?? null,seasonGain:x.fit?.seasonGain ?? null,
                possibleDrop:x.fit?.dropPid ? {pid:x.fit.dropPid,name:x.fit.dropName,weeklyProjection:x.fit.dropProjection,value:x.fit.dropValue} : null,
                fit:x.fit?.label,requiresLockCheck:true})),
        };
    }

    async function generateWaiverTake(priorityAdds, currentLeague, snapshot) {
        if (typeof window.dhqAI !== 'function') return { error: 'AI not loaded' };
        const eligible = priorityAdds.filter(x => waiverRoleRead(x.p,currentLeague).eligible).slice(0,6);
        if (!eligible.length) return { recommendations: [] };
        const context=JSON.stringify(snapshot || buildWaiverTakeContext(eligible,currentLeague,null,null));
        try {
            const reply=await window.dhqAI('waiver-agent',null,context);
            const recommendations=extractWaiverTakeJson(reply);
            if (!recommendations) return {error:'Alex’s answer didn’t parse — try again'};
            return {recommendations:matchWaiverRecommendations(recommendations,eligible)};
        } catch(e) { return {error:e?.message || 'AI call failed'}; }
    }

    // Shared player headshot — sleepercdn photo with an initials fallback,
    // sized per call site. Same URL pattern as the market table's row photo
    // (fa-mkt-row, further down) so a broken image reads identically.
    function PlayerAvatar({ pid, p, size }) {
        const s = size || 30;
        const initials = ((p?.first_name || '?')[0] + (p?.last_name || '?')[0]).toUpperCase();
        return (
            <span className="fa-hq-avatar" style={{ width: s, height: s }}>
                <img src={'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg'} alt=""
                    onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'; }} />
                <em>{initials}</em>
            </span>
        );
    }

    // Mini trend sparkline for a waiver-board row — real recent weekly points
    // (window.S.weeklyPlayerPoints), not a decorative shape. Renders nothing
    // without at least 2 logged games, so it never implies data that isn't there.
    function FaTrendSpark({ pid, color }) {
        const wpp = window.S?.weeklyPlayerPoints || {};
        const weeks = Object.keys(wpp).map(Number).sort((a, b) => a - b);
        const series = [];
        for (const w of weeks) { const v = wpp[w]?.[pid]; if (v != null) series.push(v); }
        const pts = series.slice(-4);
        if (pts.length < 2) return null;
        const min = Math.min(...pts), max = Math.max(...pts), range = (max - min) || 1;
        const w = 38, h = 16, step = w / (pts.length - 1);
        const path = pts.map((v, i) => (i * step) + ',' + (h - ((v - min) / range) * h)).join(' ');
        return (
            <svg width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} className="fa-hq-spark" aria-hidden="true">
                <polyline points={path} fill="none" stroke={color || 'var(--silver)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }

    // ── FAAB Command (redraft add-ons batch) ─────────────────────────
    // Describe observed winning bids without claiming a price or win probability.
    function waiverBidEvidence(txns, league, roster, players, pos) {
        const budget = Number(league?.settings?.waiver_budget);
        const spentRaw = roster?.settings?.waiver_budget_used;
        const spent = spentRaw == null ? null : Number(spentRaw);
        const remaining = Number.isFinite(budget) && Number.isFinite(spent) && spent != null ? Math.max(0,budget-spent) : null;
        const minRaw = league?.settings?.waiver_budget_min;
        const minBid = minRaw == null ? null : Number(minRaw);
        const seen = new Set(), bids = [];
        for (const t of txns || []) {
            if (t?.type !== 'waiver' || t.status !== 'complete') continue;
            const ids = Object.keys(t.adds || {});
            if (ids.length !== 1 || players?.[ids[0]]?.position !== pos) continue;
            if (t.league_id && String(t.league_id) !== String(league?.league_id || league?.id)) continue;
            const raw = t.settings?.waiver_bid;
            if (raw == null || raw === '') continue;
            const bid = Number(raw);
            if (!Number.isFinite(bid) || bid < 0 || bid > budget) continue;
            const key = t.transaction_id || JSON.stringify([ids,t.roster_ids,t.created,t.leg,bid]);
            if (seen.has(key)) continue;
            seen.add(key); bids.push(bid);
        }
        bids.sort((a,b) => a-b);
        const quantile = q => { const x=(bids.length-1)*q, i=Math.floor(x); return bids[i]+(bids[Math.ceil(x)]-bids[i])*(x-i); };
        return { sampleSize:bids.length, remaining, minBid: Number.isFinite(minBid) && minBid >= 0 ? minBid : null,
            low:bids.length>=5 ? Math.floor(quantile(.25)) : null, median:bids.length>=5 ? Math.round(quantile(.5)) : null, high:bids.length>=5 ? Math.ceil(quantile(.75)) : null,
            basis:'Middle 50% of completed winning bids at this position in this league; descriptive history, not a predicted winning bid.' };
    }

    function FaabCommandCard({ league, myRoster, playersData, targets }) {
        const [pick,setPick] = useState(0);
        const [history,setHistory] = useState(null);
        const lid = String(league?.league_id || league?.id || '');
        const target = targets?.[pick] || targets?.[0];
        useEffect(() => {
            let active=true;
            setHistory(null);
            if (!window.WrTxns?.fetchLeagueTxns || !lid) { setHistory({lid,error:true,txns:[]}); return; }
            Promise.resolve(window.WrTxns.fetchLeagueTxns(lid)).then(txns => {
                if (active) setHistory({lid,txns:txns || []});
            }).catch(() => { if (active) setHistory({lid,error:true,txns:[]}); });
            return () => { active=false; };
        },[lid]);
        if (!target || !(Number(league?.settings?.waiver_budget)>0)) return null;
        const evidence=waiverBidEvidence(history?.lid===lid ? history.txns : [],league,myRoster,playersData,target.pos);
        return <div className="fa-hq-command">
            <div className="fa-hq-command-head"><b>League bid history</b><span>{evidence.remaining == null ? 'Remaining budget unavailable' : '$'+evidence.remaining+' remaining'}</span></div>
            {targets.length>1 && <div className="fa-hq-command-picks">{targets.map((t,i)=><button key={t.pid} className={i===pick?'is-active':''} onClick={()=>setPick(i)}>{t.name}</button>)}</div>}
            {!history ? <p>Loading completed waiver bids…</p> : history.error ? <p>Bid history could not load. Set your own maximum; no price estimate is available.</p>
                : evidence.low == null ? <p>{evidence.sampleSize} completed {target.pos} bids found. At least five are needed to show a historical range. No reliable price estimate yet.</p>
                : <p>The middle half of {evidence.sampleSize} completed {target.pos} winning bids was <b>${evidence.low}–${evidence.high}</b> (median ${evidence.median}). These players may differ in quality and opportunity; this is not a bid recommendation or a win probability.</p>}
            {evidence.low != null && evidence.remaining != null && evidence.low>evidence.remaining && <p style={{color:'var(--warn)'}}>That historical range exceeds your remaining budget. Passing is a valid choice.</p>}
            <p>Choose a maximum based on the starting-lineup improvement and the player you would drop.{evidence.minBid != null ? ' League minimum: $'+evidence.minBid+'.' : ' Confirm the league minimum before submitting.'}</p>
            <button type="button" onClick={()=>window.wrNavigateTab?.('market-review')}>Review league transactions</button>
        </div>;
    }

    // Preference evidence is private to one account, league, season and horizon.
    // Votes change the Alex context, never the underlying projection or value.
    function waiverPreferenceKey(league) {
        const account = (window.App?.OD || window.OD)?.getCurrentUserId?.()
            || (window.S?.platform !== 'mfl' && window.S?.platform !== 'espn' ? window.S?.user?.user_id : null);
        return account ? 'wr_waiver_preferences_v1:' + [account, league?.league_id || league?.id || '', league?.season || ''].map(encodeURIComponent).join(':') : null;
    }
    function readWaiverPreferences(key) {
        try { const value = key && JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; }
    }
    function writeWaiverPreference(key, pid, horizon, action) {
        if (!key || !pid || !['week','season'].includes(horizon) || !['up','down'].includes(action)) return null;
        const next = { ...readWaiverPreferences(key), [horizon + ':' + pid]: action };
        try { localStorage.setItem(key, JSON.stringify(next)); return JSON.stringify(readWaiverPreferences(key)) === JSON.stringify(next) ? next : null; } catch (_) { return null; }
    }

    function FreeAgencyTab({ playersData, statsData, prevStatsData, statsSeason, priorStatsSeason, myRoster, currentLeague, leagueSkin, sleeperUserId, timeRecomputeTs, viewMode, briefDraftInfo, initialView = 'overview' }) {
        const [faSection, setFaSection] = React.useState(initialView === 'targets' ? 'claims' : 'market');
        const acquisitionLeagueId = String(currentLeague?.league_id || currentLeague?.id || '');
        const [streamHorizon, setStreamHorizon] = useState('week');
        const metricPreference = window.WR?.PlayerMetrics?.useMetrics?.((window.App?.OD || window.OD)?.getCurrentUserId?.() || sleeperUserId, acquisitionLeagueId);
        const preferenceKey = waiverPreferenceKey(currentLeague);
        const [missionVotes, setMissionVotes] = useState(() => ({ key: preferenceKey, values: readWaiverPreferences(preferenceKey) }));
        const [missionNotice, setMissionNotice] = useState('');
        const [plannedBid, setPlannedBid] = useState('');
        const claimStore = window.WR?.WaiverPlans;
        const claimScope = claimStore?.scope(currentLeague);
        const claimAccount = claimStore?.account();
        const claimAccountRef = React.useRef(claimAccount);
        const [claimPlanRevision, setClaimPlanRevision] = useState(0);
        const claimPlans = claimStore?.list(currentLeague) || [];
        useEffect(() => {
            if (claimAccountRef.current !== claimAccount) {
                window.WR.acquisitionContext = null;
                setAcquisitionContext(null); setPlannedBid(''); setMissionNotice('');
                claimAccountRef.current = claimAccount;
            }
            const refresh = event => {
                if (!event?.detail?.key || event.detail.key === claimScope) setClaimPlanRevision(n => n + 1);
            };
            window.addEventListener('wr:waiver-plans-changed', refresh);
            window.addEventListener('storage', refresh);
            return () => { window.removeEventListener('wr:waiver-plans-changed', refresh); window.removeEventListener('storage', refresh); };
        }, [claimScope, claimAccount]);
        const [bidHistory, setBidHistory] = useState(null);
        useEffect(() => {
            let alive = true;
            setBidHistory(null);
            if (window.WrTxns?.fetchLeagueTxns && acquisitionLeagueId) Promise.resolve(window.WrTxns.fetchLeagueTxns(acquisitionLeagueId)).then(txns => { if (alive) setBidHistory({ leagueId: acquisitionLeagueId, txns: txns || [] }); }).catch(() => { if (alive) setBidHistory({ leagueId: acquisitionLeagueId, txns: [], error: true }); });
            return () => { alive = false; };
        }, [acquisitionLeagueId]);
        const activeVotes = missionVotes.key === preferenceKey ? missionVotes.values : readWaiverPreferences(preferenceKey);
        const [acquisitionContext, setAcquisitionContext] = useState(null);
        const [notebookRevision, setNotebookRevision] = useState(0);
        useEffect(() => {
            const plan = window.WR?.PlayerNotebook?.contextFor(window.WR?.acquisitionContext, acquisitionLeagueId);
            setFaSection(initialView === 'targets' ? 'claims' : plan ? 'claims' : 'market');
            setMissionNotice('');
        }, [initialView, acquisitionLeagueId]);
        useEffect(() => {
            const changed = () => setNotebookRevision(n => n + 1);
            window.addEventListener('wr:player-notebook-changed', changed);
            window.addEventListener('storage', changed);
            window.WR?.PlayerNotebook?.migrateLeague(acquisitionLeagueId);
            changed();
            return () => { window.removeEventListener('wr:player-notebook-changed', changed); window.removeEventListener('storage', changed); };
        }, [acquisitionLeagueId]);
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const skinFeatures = resolvedLeagueSkin?.features || {};
        const weeklyWaivers = ['redraft', 'chopped'].includes(resolvedLeagueSkin?.type);
        const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
        // Scout-free vs Pro (gate map row 7): recommendation surfaces (Action
        // HQ, priority adds, FAAB bids, fit/window reads, UDFA craze) are Pro;
        // the raw Market Explorer + filters stay free. Fail-open.
        const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
        const InsightCard = window.WR.InsightCard;
        // ══ PHONE (<768) — iPhone program Phase 1 (FA) ═══════════════════
        // Hooks are called HERE, unconditionally at the top of the component
        // (this file has conditional returns further down — roster blocker +
        // command view — so phone hooks can't live next to the phone branch
        // itself). viewport.js + the Phase-0 kit are plain scripts earlier in
        // the babel chain: presence is fixed for the page's lifetime, so the
        // guarded call keeps hook order stable across renders.
        const _faUseVp = window.WR && window.WR.useViewport;
        const _faVp = _faUseVp ? _faUseVp() : { isPhone: false };
        const [faPhoneLimit, setFaPhoneLimit] = useState(25);
        const [faPanel, setFaPanel] = useState(null);   // inline chooser: null|'filters'|'sort'|'view'
        const _faPhone = !!_faVp.isPhone && !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.FilterPill && window.WR.FilterSheet && window.WR.Sheet);
        // Redraft → build rest-of-season values so waiver/FA targets rank by ROS
        // production instead of dynasty DHQ. No-op (DHQ) for dynasty/keeper.
        React.useMemo(() => {
            try {
                window.App?.PlayerValue?.ensureRos?.({
                    leagueId: currentLeague?.league_id || currentLeague?.id,
                    league: currentLeague, playersData, statsData, priorData: prevStatsData,
                    skin: resolvedLeagueSkin,
                });
            } catch (e) { if (window.wrLog) window.wrLog('fa.ensureRos', e); }
            return null;
        }, [currentLeague, playersData, statsData, prevStatsData, timeRecomputeTs]);
        const valueLabel = skinVocabulary.valueLabel || FA_COLUMNS.dhq.label;
        const valueShortLabel = skinVocabulary.valueShortLabel || FA_COLUMNS.dhq.shortLabel;
        const valueKpiLabel = (valueShortLabel === 'DHQ' ? 'DHQ VALUE' : valueShortLabel.toUpperCase());
        const [faTargets, setFaTargets] = useState([]);
        const [faFilter, setFaFilter] = useState('');
        const [faBudget, setFaBudget] = useState({ total: 0, spent: 0 });
        const [faSort, setFaSort] = useState({ key: 'dhq', dir: -1 });
        useEffect(() => {
            const supported = ['proj', 'ppg', 'dhq', 'age', 'season', 'bye', 'matchup'];
            if (_faPhone && metricPreference && faSort.key !== 'name' && (!supported.includes(faSort.key) || !metricPreference.selected.includes(faSort.key))) {
                const key = metricPreference.selected.includes('dhq') ? 'dhq' : metricPreference.selected.find(key => supported.includes(key)) || 'name';
                setFaSort({ key, dir: defaultFaSortDirection(key) });
            }
        }, [_faPhone, metricPreference?.selected.join('|'), faSort.key]);
        const [faSelectedPid, setFaSelectedPid] = useState(null);
        const [faSearch, setFaSearch] = useState('');
        useEffect(() => {
            const receive = event => {
                const next = window.WR?.PlayerNotebook?.contextFor(event?.detail || window.WR?.acquisitionContext, acquisitionLeagueId);
                if (!next) { if (!event) setAcquisitionContext(null); return; }
                const saved = next.pid ? window.WR?.WaiverPlans?.get(currentLeague, next.pid) : null;
                setAcquisitionContext(saved ? { ...next, ...saved, leagueId: acquisitionLeagueId } : next);
                setPlannedBid(saved?.bid == null ? '' : String(saved.bid));
                setMissionNotice(saved ? 'Editing your saved local plan. Review the bid and drop before submitting on your league platform.' : '');
                if (!event && initialView === 'targets') return;
                setFaSection('claims');
                setFaFilter(next.position || '');
                setFaSearch('');
                setRookieOnly(false);
                setRookieTeamFilter('');
                setRookieCollegeFilter('');
                setRookieSlotFilter('');
            };
            receive();
            window.addEventListener('wr:acquisition-context', receive);
            return () => window.removeEventListener('wr:acquisition-context', receive);
        }, [acquisitionLeagueId, claimScope]);
        // ── Waiver Take (one-shot AI card, no chat) ──────────────────────
        // Ask once → structured take on the already-ranked Priority Moves list.
        // Reuses the orphaned 'waiver-agent' DHQ_PROMPTS type — the deterministic
        // board (priorityAdds, below) already IS the "available list" it's
        // instructed never to stray from, so this can't invent players.
        const [waiverTake, setWaiverTake] = useState(() => loadCachedWaiverTake(currentLeague));
        const [waiverTakeLoading, setWaiverTakeLoading] = useState(false);
        const [waiverTakeError, setWaiverTakeError] = useState(null);
        const [waiverTakeFeedback, setWaiverTakeFeedback] = useState({});
        useEffect(() => {
            setWaiverTake(loadCachedWaiverTake(currentLeague));
            setWaiverTakeError(null);
        }, [currentLeague?.league_id, currentLeague?.id]);
        const [visibleFaCols, setVisibleFaCols] = useState(() => {
            const stored = window.App?.WrStorage?.get?.('wr_fa_cols');
            const valid = Array.isArray(stored) ? stored.filter(k => FA_COLUMNS[k]) : [];
            // Upgrade the previous default only; custom column sets remain deliberate.
            const oldDefault = ['pos','team','age','dhq','ppg','proj','faab'];
            const legacyDefaults = [oldDefault, oldDefault.filter(k => k !== 'proj'), oldDefault.filter(k => k !== 'faab'), oldDefault.filter(k => k !== 'proj' && k !== 'faab')];
            if (!valid.length || legacyDefaults.some(cols => cols.join('|') === valid.join('|'))) return faTierCols(FA_COLUMN_PRESETS.default);
            return faTierCols(valid);
        });
        const [faColPreset, setFaColPreset] = useState('default');
        // Derive the ACTIVE view from the PERSISTED columns (my-team idiom) —
        // faColPreset is session-only and snapped to 'default' on reload, which
        // froze the phone stat slots + VIEW pill no matter which view was saved
        // (owner ask 2026-07-12). Tier-filter the preset side so a free user's
        // default (faab stripped) still matches. Derived key wins over faColPreset.
        const sameFaColSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
        const faActivePresetKey = Object.entries(FA_COLUMN_PRESETS).find(([, cols]) => sameFaColSet(faTierCols(cols), visibleFaCols))?.[0] || 'custom';
        const [showFaColPicker, setShowFaColPicker] = useState(false);
        // Rolling PPG window — shared localStorage key with My Roster so the setting persists across tabs.
        const [ppgWindow, setPpgWindow] = useState(() => { try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; } });
        useEffect(() => { try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {} }, [ppgWindow]);
        const [marketDataVersion, forcePpgRerender] = useState(0);
        useEffect(() => {
            const h = () => forcePpgRerender(n => n + 1);
            window.addEventListener('wr:weekly-points-loaded', h);
            window.addEventListener('wr:projections-loaded', h);
            return () => { window.removeEventListener('wr:weekly-points-loaded', h); window.removeEventListener('wr:projections-loaded', h); };
        }, []);
        // sig1/sig2 headers: when the position filter is a single concrete
        // position, name the columns after that position's actual signature
        // stats (e.g. "TGT/G" / "SNP%" for WR) instead of the generic
        // placeholder — mixed/flex views keep the generic label since no
        // single stat pair applies to every row shown.
        const marketSeason = String(statsSeason || currentLeague?.season || new Date().getFullYear());
        const marketWeek = window.App?.WeeklyProj?.currentWeek?.() || 1;
        const marketIsCurrent = marketSeason === String(window.S?.nflState?.season || new Date().getFullYear());
        const faSigStats = [0, 1].map(index => window.App?.FAMarketData?.signature(faFilter, index, {}));
        const faColumns = useMemo(() => ({
            ...FA_COLUMNS,
            dhq: { ...FA_COLUMNS.dhq, label: valueLabel, shortLabel: valueShortLabel },
            proj: { ...FA_COLUMNS.proj, shortLabel: marketIsCurrent ? `W${marketWeek} proj` : 'Proj' },
            ppg: { ...FA_COLUMNS.ppg, shortLabel: ppgWindow === 'season' ? 'PPG' : `${ppgWindow.toUpperCase()} PPG` },
            peakYr: { ...FA_COLUMNS.peakYr, label: skinFeatures.showAgeCurve === false ? 'Value Window' : FA_COLUMNS.peakYr.label, shortLabel: skinFeatures.showAgeCurve === false ? 'Window' : FA_COLUMNS.peakYr.shortLabel },
            sig1: { ...FA_COLUMNS.sig1, ...(faSigStats[0] ? { label: faSigStats[0].label, shortLabel: faSigStats[0].short } : { sortKey: null }) },
            sig2: { ...FA_COLUMNS.sig2, ...(faSigStats[1] ? { label: faSigStats[1].label, shortLabel: faSigStats[1].short } : { sortKey: null }) },
        }), [valueLabel, valueShortLabel, skinFeatures.showAgeCurve, faFilter, marketIsCurrent, marketWeek, ppgWindow]);
        useEffect(() => {
            if ((faSort.key === 'sig1' || faSort.key === 'sig2') && !faSigStats[0]) setFaSort({ key: 'dhq', dir: -1 });
        }, [faFilter, faSort.key]);

        function marketStatSource(pid) {
            const current = statsData?.[pid] || {};
            const prior = prevStatsData?.[pid] || {};
            const priorYear = String(priorStatsSeason || Number(marketSeason) - 1);
            const usePrior = !(current.gp > 0) && prior.gp > 0 && Number(priorYear) < Number(marketSeason);
            return { raw: usePrior ? prior : current, year: usePrior ? priorYear : marketSeason, prior: usePrior };
        }
        function marketPpgRead(pid, position) {
            const source = marketStatSource(pid);
            const historyLeagueId = window.S?.weeklyPlayerPointsLeagueId;
            if (ppgWindow !== 'season' && marketIsCurrent && historyLeagueId && String(historyLeagueId) === String(currentLeague?.id || currentLeague?.league_id)) {
                const recent = window.App?.FAMarketData?.recentPpg(window.App?.WeeklyProj?.weeklyHistory?.(pid), marketWeek, ppgWindow === 'l3' ? 3 : 5);
                if (recent) return { value: recent.value, note: `${recent.count} reported wk${recent.count === 1 ? '' : 's'}` };
            }
            return { value: window.App?.FAMarketData?.ppg(source.raw, currentLeague?.scoring_settings || {}, position) ?? null, note: source.prior ? `${source.year} avg` : ppgWindow !== 'season' ? `${source.year} avg` : '' };
        }
        function mobileMarketValues(row) {
            const historyId = window.S?.weeklyPlayerPointsLeagueId;
            const recent = historyId && String(historyId) === acquisitionLeagueId && marketIsCurrent
                ? window.App?.FAMarketData?.recentPpg(window.App?.WeeklyProj?.weeklyHistory?.(row.pid), marketWeek, 5) : null;
            const source = marketStatSource(row.pid);
            const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
            return { proj: number(row.proj), ppg: number(recent?.value), dhq: number(row.dhq), age: number(row.p.age),
                season: source.prior ? null : number(window.App?.FAMarketData?.ppg(source.raw, currentLeague?.scoring_settings || {}, row.pos)),
                bye: number(window.App?.NFLByes?.weekForPlayer?.(row.p, Number(marketSeason))),
                matchup: isPro && marketIsCurrent ? row.matchup || null : null };
        }
        const compareMarketNumber = (a, b, dir) => window.WR?.PlayerMetrics?.compareValues
            ? window.WR.PlayerMetrics.compareValues(a, b, dir)
            : a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : dir * (a - b);
        const compareMarketText = (a, b, dir) => window.WR?.PlayerMetrics?.compareValues
            ? window.WR.PlayerMetrics.compareValues(a, b, dir, { type: 'text' })
            : !a && !b ? 0 : !a ? 1 : !b ? -1 : dir * String(a).localeCompare(String(b));

        useEffect(() => { try { window.App?.WrStorage?.set?.('wr_fa_cols', visibleFaCols); } catch {} }, [visibleFaCols]);
        // Resurrect-proofing: saved views / older persisted prefs can still
        // carry Pro-only columns — normalize state whenever one sneaks in.
        useEffect(() => {
            if (isPro) return;
            setVisibleFaCols(prev => prev.some(k => FA_PRO_COLS.has(k)) ? prev.filter(k => !FA_PRO_COLS.has(k)) : prev);
        }, [isPro, visibleFaCols]);

        const normPos = window.App.normPos;
        const calcRawPts = (s) => window.App.calcRawPts(s, currentLeague?.scoring_settings);
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters, leagueSkin: resolvedLeagueSkin }) || { isUsable: true };

        const rookiesLocked = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        const prospectNames = useMemo(() => {
            if (!rookiesLocked || typeof window.getProspects !== 'function') return new Set();
            return new Set((window.getProspects() || []).map(p => faNormName(p.name)).filter(Boolean));
        }, [rookiesLocked, timeRecomputeTs]);
        const isDraftProspect = useCallback((pid, p) => {
            return isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData });
        }, [rookiesLocked, prospectNames, statsData, prevStatsData]);

        // ── UDFA craze (dynasty post-rookie-draft scramble) ──────────────────────
        const crazeLeagueId = currentLeague?.league_id || currentLeague?.id || window.S?.currentLeagueId || 'default';
        const [crazeTick, setCrazeTick] = useState(0);
        // Catch the rookie lock→unlock flip and reconcile remote craze state.
        useEffect(() => {
            try { window.App?.observeUdfaCrazeFlip?.(currentLeague, briefDraftInfo); } catch (e) {}
            try {
                const pulled = window.App?.PostDraft?.pullCraze?.(crazeLeagueId);
                if (pulled && typeof pulled.then === 'function') pulled.then(() => setCrazeTick(t => t + 1)).catch(() => {});
            } catch (e) {}
        }, [crazeLeagueId, rookiesLocked]);
        // One-time open notification + live countdown refresh.
        useEffect(() => {
            const onOpen = () => setCrazeTick(t => t + 1);
            window.addEventListener('wr:udfa-craze-open', onOpen);
            const iv = setInterval(() => setCrazeTick(t => t + 1), 60000);
            return () => { window.removeEventListener('wr:udfa-craze-open', onOpen); clearInterval(iv); };
        }, []);
        const crazeState = (window.App?.PostDraft?.getCraze?.(crazeLeagueId)) || null;
        const crazeOpen = !!(crazeState && crazeState.open && !crazeState.dismissed);
        const crazeBoard = useMemo(() => {
            if (!isPro) return null; // craze board is Pro — free gets the lock row in renderCrazePanel
            if (!crazeOpen || typeof window.App?.buildUdfaCrazeBoard !== 'function') return null;
            try {
                return window.App.buildUdfaCrazeBoard({
                    playersData, statsData, prevStatsData, myRoster, currentLeague,
                    leagueSkin: resolvedLeagueSkin, briefDraftInfo, crazeSeed: (crazeState && crazeState.seed) || [],
                });
            } catch (e) { return null; }
        }, [isPro, crazeOpen, crazeTick, playersData, statsData, myRoster, currentLeague, timeRecomputeTs]);

        // Load FA targets from Supabase/localStorage
        useEffect(() => {
            if (window.OD?.loadTargets) {
                window.OD.loadTargets(currentLeague.league_id || currentLeague.id).then(data => {
                    if (data) { setFaTargets(data.targets || []); setFaBudget({ total: data.startingBudget || 200, spent: 0 }); }
                }).catch(err => window.wrLog('fa.loadTargets', err));
            }
        }, []);

        // Find available (unrostered) players
        const rostered = useMemo(() => {
            // Copy-aware availability — see buildFreeAgencyActionBoard above. A player
            // counts as rostered only when every copy the league allows is taken.
            const copies = Math.max(1, Number(currentLeague?.settings?.player_copies) || 1);
            const count = {};
            // Dedupe per roster — taxi/reserve ids are also in players[].
            (currentLeague.rosters || []).forEach(r => new Set((r.players || []).concat(r.taxi || [], r.reserve || []).map(String)).forEach(k => { count[k] = (count[k] || 0) + 1; }));
            return { has: (pid) => (count[String(pid)] || 0) >= copies };
        }, [currentLeague]);

        // Positions this league actually rosters (gates D/ST, K, IDP out of the wire
        // for formats that don't use them — e.g. no D/ST recs in an IDP-only league).
        // Falls back to "no gate" if the helper is unavailable, to avoid over-filtering.
        const leaguePosSet = useMemo(() => {
            try {
                return typeof window.getLeaguePositions === 'function'
                    ? window.getLeaguePositions({ league: currentLeague, asSet: true })
                    : null;
            } catch (e) { return null; }
        }, [currentLeague]);

        const availablePlayers = useMemo(() => {
            if (!rosterState.isUsable || !window.App?.RecommendationEligibility?.check(currentLeague,myRoster,'ownership')?.ok) return [];
            return Object.entries(playersData)
                .filter(([pid, p]) => !rostered.has(pid) && p.team && p.status !== 'Inactive' && p.status !== 'Retired' && p.active !== false && !isDraftProspect(pid, p)
                    && (p.full_name || p.first_name || p.last_name)
                    && (!leaguePosSet || leaguePosSet.has(normPos(p.position) || p.position)))
                .map(([pid, p]) => {
                    const dhq = waiverValue(pid,currentLeague,resolvedLeagueSkin);
                    let proj = null, matchup = null;
                    const WP = window.App && window.App.WeeklyProj;
                    if (marketIsCurrent && WP?.projectPlayer) {
                        try {
                            const pr = WP.projectPlayer(pid, { playersData, statsData, priorData: prevStatsData, scoring: currentLeague?.scoring_settings || {}, week: marketWeek });
                            if (pr?.available && typeof pr.points?.median === 'number' && Number.isFinite(pr.points.median)) proj = pr.points.median;
                            if (pr?.available) matchup = pr.matchupGrade || null;
                        } catch (e) { /* Missing forecast stays unavailable. */ }
                    }
                    return { pid, p, dhq, proj, matchup, pos: normPos(p.position) || p.position };
                })
                .sort((a, b) => b.dhq - a.dhq);
        }, [rosterState.isUsable, playersData, statsData, prevStatsData, currentLeague, rostered, timeRecomputeTs, isDraftProspect, leaguePosSet, marketIsCurrent, marketWeek, marketDataVersion]);

        // Compare the same legal add/drop across both scoring horizons.
        const streamCandidates = useMemo(() => {
            if (!isPro) return [];
            const state = window.App?.PlayerValue?.rosState?.();
            const validRos = state && String(state.leagueId) === acquisitionLeagueId && Number(state.week) === Number(marketWeek) && marketIsCurrent;
            const options = { ...waiverRosterOptions({currentLeague,playersData,statsData,prevStatsData}), horizon: streamHorizon,
                rosProject: pid => validRos ? state.points?.[pid] ?? null : null };
            const read=buildFaRosterRead(myRoster,currentLeague,playersData,pid=>waiverValue(pid,currentLeague,resolvedLeagueSkin),options);
            return applyGmFaFilters(availablePlayers, getGmFaFilters(currentLeague)).slice(0, 300).filter(x=>waiverRoleRead(x.p,currentLeague,resolvedLeagueSkin).eligible).map(fa=>({fa,fit:read.fit(fa.pos,fa.dhq,fa)}))
                .filter(({fit}) => streamHorizon === 'season' ? fit.rosGain > 0 : streamHorizon === 'both' ? fit.weeklyGain != null && fit.rosGain != null && fit.weeklyGain >= 0 && fit.rosGain >= 0 && (fit.weeklyGain > 0 || fit.rosGain > 0) : fit.weeklyGain > 0)
                .map(({fa,fit})=>({pos:fa.pos,fa,worstName:'best available lineup',worstProj:read.beforeWeekly.total,delta:fit.weeklyGain,rosGain:fit.rosGain,rosPoints:fit.candidateRosPoints,dropPid:fit.dropPid,dropName:fit.dropName}))
                .sort((a,b)=>streamHorizon === 'season' ? b.rosGain-a.rosGain : (b.delta ?? -Infinity)-(a.delta ?? -Infinity));
        },[isPro,skinFeatures.showStreaming,availablePlayers,myRoster,playersData,statsData,prevStatsData,currentLeague,resolvedLeagueSkin,timeRecomputeTs,marketDataVersion,streamHorizon,acquisitionLeagueId,marketWeek,marketIsCurrent]);
        const streaming = streamCandidates.filter(o => o.delta > 0 && Number.isFinite(o.fa.proj));
        const streamPosSet = new Set(streaming.map(o => o.pos));

        // GM-Office FA filters scope the recommendation surfaces (priority adds +
        // action board). The market explorer (sortedPlayers) keeps the full pool.
        const [gmFilterTick, setGmFilterTick] = useState(0);
        useEffect(() => {
            const h = () => setGmFilterTick(t => t + 1);
            window.addEventListener('wr:gm-mode-changed', h);
            return () => window.removeEventListener('wr:gm-mode-changed', h);
        }, []);
        const gmFa = useMemo(() => getGmFaFilters(currentLeague), [currentLeague, gmFilterTick]);
        const recPool = useMemo(() => applyGmFaFilters(availablePlayers, gmFa), [availablePlayers, gmFa]);
        const gmHiddenCount = Math.max(0, availablePlayers.length - recPool.length);
        const gmFiltersOn = gmFaFiltersActive(gmFa);

        const posColors = window.App.POS_COLORS;
        const faPosOrder = { QB:0, RB:1, WR:2, TE:3, K:4, DEF:5, DL:6, LB:7, DB:8 };

        // League-specific position chips (only groups this league rosters),
        // plus league-derived flex groups (FLEX / SFLEX / IDP FLEX…, owner ask
        // 2026-07-12) — the filter predicate below expands them via
        // posMatchesFilter.
        const leaguePositions = useMemo(() => {
            const lp = leaguePlayablePositions(currentLeague?.roster_positions);
            const base = lp.length ? lp : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
            return [...base, ...(window.App?.getLeagueFlexGroups?.({ league: currentLeague }) || [])];
        }, [currentLeague]);
        // Rookies filter — UDFAs fold into the FA pool post-draft; this isolates them.
        const [rookieOnly, setRookieOnly] = useState(false);
        // name → prospect record, so rookie rows can filter on the same pieces as the
        // Draft Room big board (NFL team, college, draft slot). getProspects() is
        // rank-sorted, so first-in wins on alias collisions (best-ranked prospect).
        const rookieProspectMap = useMemo(() => {
            if (typeof window.getProspects !== 'function') return new Map();
            const m = new Map();
            (window.getProspects() || []).forEach(p => {
                const k = faNormName(p.name);
                if (k && !m.has(k)) m.set(k, p);
            });
            return m;
        }, [timeRecomputeTs]);
        const prospectFor = useCallback((p) => {
            if (!p) return null;
            const nm = faNormName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
            const pr = rookieProspectMap.get(nm) || null;
            // Position-guard the name join (mirrors RookieFields.lookup posGuard in
            // My Roster / Trade Center) so a same-name veteran at a different position
            // isn't mis-tagged as the rookie.
            if (pr && p.position && (pr.mappedPos || pr.pos)) {
                const a = normPos(p.position);
                const b = normPos(pr.mappedPos || pr.pos);
                if (a && b && a !== b) return null;
            }
            return pr;
        }, [rookieProspectMap]);
        const isRookiePlayer = useCallback((pid, p) => {
            if (!p) return false;
            if (prospectFor(p)) return true;
            const exp = Number(p.years_exp ?? p.yoe ?? 0);
            const hasStats = (statsData?.[pid]?.gp || 0) > 0 || ((prevStatsData || {})[pid]?.gp || 0) > 0;
            return exp === 0 && !hasStats;
        }, [prospectFor, statsData, prevStatsData]);
        // Big-board filter pieces, scoped to the rookie/UDFA view.
        const [rookieTeamFilter, setRookieTeamFilter] = useState('');       // NFL team abbr
        const [rookieCollegeFilter, setRookieCollegeFilter] = useState(''); // college team
        const [rookieSlotFilter, setRookieSlotFilter] = useState('');       // '' | '1'..'7' | 'UDFA'
        const rookieTeamOf = useCallback((x) => (prospectFor(x.p)?.nflTeam || x.p.team || ''), [prospectFor]);
        const rookieCollegeOf = useCallback((x) => (prospectFor(x.p)?.college || x.p.college || ''), [prospectFor]);
        // Slot semantics mirror the big board's isTrueUdfa: these players are already
        // in the FA pool post-draft, so "no capital" means undrafted, not capital-TBD.
        const rookieSlotMatch = useCallback((x, slot) => {
            const cs = prospectFor(x.p) || {};
            const hasCapital = Number(cs.draftRound) > 0 || Number(cs.draftPick) > 0;
            if (slot === 'UDFA') return !hasCapital;
            return String(cs.draftRound || '') === slot;
        }, [prospectFor]);
        const rookieFilterOptions = useMemo(() => {
            if (!rookieOnly) return { teams: [], colleges: [] };
            const teams = new Set(); const colleges = new Set();
            availablePlayers.forEach(x => {
                if (!isRookiePlayer(x.pid, x.p)) return;
                const t = rookieTeamOf(x); if (t && t !== 'FA') teams.add(t);
                const c = rookieCollegeOf(x); if (c) colleges.add(c);
            });
            return { teams: [...teams].sort(), colleges: [...colleges].sort() };
        }, [rookieOnly, availablePlayers, isRookiePlayer, rookieTeamOf, rookieCollegeOf]);

        React.useEffect(() => { setFaPhoneLimit(25); }, [faFilter, faSearch, faSort, rookieOnly, rookieTeamFilter, rookieCollegeFilter, rookieSlotFilter, currentLeague?.league_id, currentLeague?.id]);

        function faSortIndicator(key) { return faSort.key === key ? (faSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''; }
        function defaultFaSortDirection(key) { return window.WR?.PlayerMetrics?.defaultDirection?.(key) ?? (['name', 'age', 'bye'].includes(key) ? 1 : -1); }
        function handleFaSort(key) { setFaSort(prev => prev.key === key ? { ...prev, dir: prev.dir * -1 } : { key, dir: defaultFaSortDirection(key) }); }

        // Sort filtered results
        const sortedPlayers = useMemo(() => {
            const q = faSearch.trim().toLowerCase();
            const filtered = availablePlayers.filter(x => {
                const pos = normPos(x.p.position) || x.p.position || '';
                // Group-aware: faFilter may be a flex-group key (FLEX/SFLEX/…)
                if (faFilter && !(window.App?.posMatchesFilter ? window.App.posMatchesFilter(pos, faFilter) : pos === faFilter)) return false;
                if (rookieOnly) {
                    if (!isRookiePlayer(x.pid, x.p)) return false;
                    if (rookieTeamFilter && rookieTeamOf(x) !== rookieTeamFilter) return false;
                    if (rookieCollegeFilter && rookieCollegeOf(x) !== rookieCollegeFilter) return false;
                    if (rookieSlotFilter && !rookieSlotMatch(x, rookieSlotFilter)) return false;
                }
                if (!q) return true;
                const name = (x.p.full_name || ((x.p.first_name || '') + ' ' + (x.p.last_name || '')).trim()).toLowerCase();
                const team = (x.p.team || 'FA').toLowerCase();
                const college = (x.p.college || '').toLowerCase();
                return name.includes(q) || team.includes(q) || pos.toLowerCase().includes(q) || college.includes(q);
            });
            return filtered.sort((a, b) => {
                const dir = faSort.dir;
                const k = faSort.key;
                if (_faPhone && metricPreference && ['proj', 'ppg', 'dhq', 'age', 'season', 'bye'].includes(k)) {
                    return compareMarketNumber(mobileMarketValues(a)[k], mobileMarketValues(b)[k], dir);
                }
                if (_faPhone && metricPreference && k === 'matchup') {
                    return window.WR?.PlayerMetrics?.compareValues?.(mobileMarketValues(a).matchup, mobileMarketValues(b).matchup, dir, { type: 'grade' }) || 0;
                }
                if (k === 'name') {
                    const na = (a.p.full_name || ((a.p.first_name || '') + ' ' + (a.p.last_name || '')).trim()).toLowerCase();
                    const nb = (b.p.full_name || ((b.p.first_name || '') + ' ' + (b.p.last_name || '')).trim()).toLowerCase();
                    return compareMarketText(na, nb, dir);
                }
                if (k === 'pos') return compareMarketText(normPos(a.p.position), normPos(b.p.position), dir);
                if (k === 'age') return compareMarketNumber(a.p.age, b.p.age, dir);
                if (k === 'dhq') return compareMarketNumber(a.dhq, b.dhq, dir);
                if (k === 'proj') return compareMarketNumber(a.proj, b.proj, dir);
                if (k === 'ppg') return compareMarketNumber(marketPpgRead(a.pid, a.pos).value, marketPpgRead(b.pid, b.pos).value, dir);
                if (k === 'team') return compareMarketText(a.p.team, b.p.team, dir);
                if (k === 'trend') {
                    return compareMarketNumber(window.App?.LI?.playerTrends?.[a.pid], window.App?.LI?.playerTrends?.[b.pid], dir);
                }
                if (k === 'peak') {
                    return compareMarketNumber(window.App?.LI?.playerPeaks?.[a.pid], window.App?.LI?.playerPeaks?.[b.pid], dir);
                }
                if (k === 'exp') return compareMarketNumber(a.p.years_exp, b.p.years_exp, dir);
                if (k === 'college') return compareMarketText(a.p.college, b.p.college, dir);
                if (k === 'height' || k === 'weight') {
                    const raw = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
                    return compareMarketNumber(raw(a.p[k]), raw(b.p[k]), dir);
                }
                if (k === 'injury') return compareMarketText(a.p.injury_status, b.p.injury_status, dir);
                if (k === 'sig1' || k === 'sig2') {
                    if (!faSigStats[0]) return b.dhq - a.dhq;
                    const idx = k === 'sig1' ? 0 : 1;
                    const na = window.App?.FAMarketData?.signature(a.pos, idx, marketStatSource(a.pid).raw)?.value;
                    const nb = window.App?.FAMarketData?.signature(b.pos, idx, marketStatSource(b.pid).raw)?.value;
                    return compareMarketNumber(na, nb, dir);
                }
                if (k === 'rkSlot' || k === 'rkRank' || k === 'rkTier' || k === 'rkTeam') {
                    const ra = prospectFor(a.p); const rb = prospectFor(b.p);
                    if (k === 'rkTeam') return compareMarketText(ra?.nflTeam || faDraftCap(a.pid)?.team, rb?.nflTeam || faDraftCap(b.pid)?.team, dir);
                    if (k === 'rkSlot') {
                        // Earlier capital sorts first (unified ordinal ≈ overall pick);
                        // UDFA last; players with no data after that.
                        const slot = (r, pid) => {
                            if (r && Number(r.draftRound) > 0) return (Number(r.draftRound) - 1) * 32 + (Number(r.draftPick) || 32);
                            const d = faDraftCap(pid);
                            if (d) return d.round > 0 ? (d.overall || (d.round - 1) * 32 + 32) : 9000;
                            return r ? 9000 : null;
                        };
                        return compareMarketNumber(slot(ra, a.pid), slot(rb, b.pid), dir);
                    }
                    // rkRank / rkTier — lower consensus rank is better; non-rookies last.
                    const rank = r => (r && (r.consensusRank ?? r.rank) != null) ? Number(r.consensusRank ?? r.rank) : null;
                    return compareMarketNumber(rank(ra), rank(rb), dir);
                }
                return 0;
            }).slice(0, _faPhone ? undefined : 50);
        }, [_faPhone, availablePlayers, faFilter, faSearch, faSort, statsData, rookieOnly, isRookiePlayer, rookieTeamFilter, rookieCollegeFilter, rookieSlotFilter, rookieTeamOf, rookieCollegeOf, rookieSlotMatch, prospectFor, prevStatsData, ppgWindow, marketDataVersion, isPro]);

        const faHeaderStyle = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };

        // Compute roster needs for recommendations
        const rawAssess = useMemo(() => typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null, [myRoster, currentLeague, timeRecomputeTs]);
        const rosterRead = buildFaRosterRead(myRoster, currentLeague, playersData, pid => waiverValue(pid,currentLeague,resolvedLeagueSkin), waiverRosterOptions({currentLeague,playersData,statsData,prevStatsData}));
        const assess = { ...(rawAssess || {}), needs: rosterRead.known ? rosterRead.rows.filter(r => r.fillsStarter).map(r => ({ pos: r.pos, urgency: 'deficit' })) : [] };
        const peaks = window.App.peakWindows || {};
        const ageCurveFor = pos => typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { build: [22, 24], peak: peaks[pos] || [24, 29], decline: [30, 32] };
        const peakYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.peak[1] - (age || 25));
        };
        const valueYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.decline[1] - (age || 25));
        };
        const budget = currentLeague?.settings?.waiver_budget || myRoster?.settings?.waiver_budget || 0;
        const spent = myRoster?.settings?.waiver_budget_used || 0;
        const remaining = Math.max(0, budget - spent);
        const hasFAAB = budget > 0;
        function faabSuggest() {
            // Player scores do not translate into dollars. The bid panel uses
            // observed league transactions and keeps unknown prices unknown.
            return null;
        }

        // Selected player detail
        const selPlayer = faSelectedPid ? playersData[faSelectedPid] : null;
        const selStats = faSelectedPid ? statsData[faSelectedPid] || {} : {};
        const selPrevStats = faSelectedPid ? (prevStatsData || {})[faSelectedPid] || {} : {};
        const selDhq = faSelectedPid ? waiverValue(faSelectedPid,currentLeague,resolvedLeagueSkin) : null;
        const selPpg = selStats.gp > 0 ? +(calcRawPts(selStats) / selStats.gp).toFixed(1) : (selPrevStats.gp > 0 ? +(calcRawPts(selPrevStats) / selPrevStats.gp).toFixed(1) : 0);
        const selPos = selPlayer ? normPos(selPlayer.position) : '';
        const selPeakYrs = selPlayer ? peakYearsFor(selPos, selPlayer.age) : 0;
        const selValueYrs = selPlayer ? valueYearsFor(selPos, selPlayer.age) : 0;
        const selFaab = faSelectedPid ? faabSuggest(selDhq, selPos, selPlayer?.age) : null;
        const selInitials = selPlayer ? ((selPlayer.first_name||'?')[0] + (selPlayer.last_name||'?')[0]).toUpperCase() : '';

        function openFaPlayer(pid) {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings, context: { ...acquisitionContext, source: 'free-agency', leagueId: acquisitionLeagueId } });
            } else if (typeof window.openFWPlayerModal === 'function') {
                window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings);
            } else {
                setFaSelectedPid(pid);
            }
        }

        function playerName(p, pid) {
            if (!p) return pid ? 'Player ' + pid : 'Unknown';
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            if (full) return full;
            // Team defenses carry a team abbr but often no full/first/last name in the feed.
            const pos = (window.App?.normPos?.(p.position) || p.position || '').toUpperCase();
            if ((pos === 'DEF' || pos === 'DST') && (p.team || pid)) return (p.team || pid) + ' D/ST';
            return pid ? 'Player ' + pid : 'Unknown';
        }

        function windowRead(pos, age) {
            const peakYrs = peakYearsFor(pos, age);
            const valueYrs = valueYearsFor(pos, age);
            if (peakYrs >= 4) return { label: peakYrs + 'yr peak', short: 'Rising', color: 'var(--k-2ecc71, #2ecc71)', peakYrs, valueYrs };
            if (peakYrs >= 1) return { label: peakYrs + 'yr peak', short: 'Prime', color: 'var(--gold)', peakYrs, valueYrs };
            if (valueYrs >= 1) return { label: valueYrs + 'yr value', short: 'Vet', color: 'var(--k-f0a500, #f0a500)', peakYrs, valueYrs };
            return { label: 'short term', short: 'Post', color: 'var(--k-e74c3c, #e74c3c)', peakYrs, valueYrs };
        }

        const faabMarketRows = (currentLeague.rosters || []).map(r => {
            const user = (currentLeague.users || []).find(u => u.user_id === r.owner_id);
            const rBudget = Number(currentLeague?.settings?.waiver_budget || 0);
            const rSpent = Number(r.settings?.waiver_budget_used || 0);
            const rRemaining = Math.max(0, rBudget - rSpent);
            return {
                roster: r,
                rosterId: r.roster_id,
                name: user?.display_name || user?.username || ('Team ' + r.roster_id),
                remaining: rRemaining,
                pct: rBudget > 0 ? Math.round((rRemaining / rBudget) * 100) : 0,
                isMe: r.roster_id === myRoster?.roster_id,
            };
        }).sort((a, b) => b.remaining - a.remaining);
        const myFaabRank = faabMarketRows.findIndex(r => r.isMe) + 1;
        const canOutbidRows = faabMarketRows.filter(r => !r.isMe && r.remaining > remaining).slice(0, 5);

        const rosterGapRows = rosterRead.rows.map(row => {
            const candidate = recPool.filter(x => x.pos === row.pos).sort((a, b) => b.dhq - a.dhq)[0];
            const fit = candidate ? rosterRead.fit(row.pos, candidate.dhq, candidate) : null;
            return { ...row, bestWire: fit?.gain > 0 ? candidate : null, gain: fit?.gain || 0 };
        });

        // Free skips the rec pipeline entirely: nothing to render (Action HQ is
        // gated below) and nothing published to the shared Intelligence stream.
        // Market posture biases ordering — mirrors buildFreeAgencyActionBoard.
        const waiverBoard = useMemo(() => buildFreeAgencyActionBoard({
            currentLeague, myRoster, playersData, statsData, prevStatsData, leagueSkin: resolvedLeagueSkin, rosterState, briefDraftInfo,
        }), [currentLeague,myRoster,playersData,statsData,prevStatsData,resolvedLeagueSkin,timeRecomputeTs,marketDataVersion,gmFilterTick]);
        const actionBoardPlayers = isPro ? waiverBoard.actionBoardPlayers : [];
        const priorityAdds = isPro ? waiverBoard.priorityAdds : [];
        const dropCandidates = [...new Set(actionBoardPlayers.map(x=>x.fit.dropPid).filter(Boolean))].map(pid=>{
            const p=playersData[pid]; const pos=normPos(p?.position); const win=windowRead(pos,p?.age);
            return {pid,p,pos,dhq:waiverValue(pid,currentLeague,resolvedLeagueSkin),name:playerName(p),windowLabel:win.label,windowColor:win.color};
        });
        const upgradePairs = actionBoardPlayers.filter(x=>x.fit.dropPid).slice(0,4).map(add=>({add,drop:dropCandidates.find(p=>p.pid===add.fit.dropPid),gain:add.fit.gain,metric:add.fit.metric}));
        const recentDrops = (() => {
            const out = [];
            const transactions = window.S?.transactions || {};
            const curWeek = window.S?.currentWeek || 1;
            for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
                (transactions['w' + w] || []).forEach(t => {
                    if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                    Object.keys(t.drops || {}).forEach(pid => {
                        const p = playersData[pid];
                        const dhq = waiverValue(pid,currentLeague,resolvedLeagueSkin);
                        if (!p || dhq < 1500 || rostered.has(String(pid))) return;
                        out.push({ pid, name: playerName(p), pos: normPos(p.position) || p.position, dhq, week: w });
                    });
                });
            }
            return out.sort((a, b) => b.dhq - a.dhq).slice(0, 4);
        })();

        const waiverSnapshot=buildWaiverTakeContext(priorityAdds,currentLeague,waiverBoard.rosterRead,myRoster);
        const waiverSignature=JSON.stringify(waiverSnapshot);
        const waiverIdentity=waiverTakeCacheKey(currentLeague)+'|'+waiverSignature;
        const waiverRequest=React.useRef({identity:waiverIdentity,sequence:0});
        if (waiverRequest.current.identity!==waiverIdentity) waiverRequest.current={identity:waiverIdentity,sequence:waiverRequest.current.sequence+1};
        const [waiverClock,setWaiverClock]=useState(Date.now());
        useEffect(()=>{ const timer=setInterval(()=>setWaiverClock(Date.now()),60000); return ()=>{clearInterval(timer);waiverRequest.current.sequence++;}; },[]);
        useEffect(()=>{setWaiverTakeLoading(false);setWaiverTakeError(null);setWaiverTakeFeedback({});},[waiverIdentity]);
        const freshWaiverTake=waiverTake.signature===waiverSignature && waiverClock-waiverTake.ts<WAIVER_TAKE_CACHE_TTL_MS;
        const visibleWaiverRecommendations=freshWaiverTake ? matchWaiverRecommendations(waiverTake.recommendations,priorityAdds) : [];
        const doGenerateWaiverTake=async()=>{
            if (!isPro) return;
            const sequence=++waiverRequest.current.sequence;
            const identity=waiverIdentity;
            setWaiverTakeLoading(true);setWaiverTakeError(null);
            const r=await generateWaiverTake(priorityAdds,currentLeague,waiverSnapshot);
            if (waiverRequest.current.sequence!==sequence || waiverRequest.current.identity!==identity) return;
            setWaiverTakeLoading(false);
            if (r.error) {setWaiverTakeError(r.error);return;}
            setWaiverTake({recommendations:r.recommendations,signature:waiverSignature,ts:Date.now()});
            setWaiverClock(Date.now());
            saveCachedWaiverTake(currentLeague,r.recommendations,waiverSignature);
        };
        const doClearWaiverTake=()=>{waiverRequest.current.sequence++;setWaiverTakeLoading(false);clearCachedWaiverTake(currentLeague);setWaiverTake({recommendations:[],ts:0});};
        const sendWaiverTakeFeedback = (rec, action) => {
            setWaiverTakeFeedback(prev => ({ ...prev, [rec.name]: action }));
            // 'fa_targets' is the pre-existing feedback surface allowlisted
            // server-side for waiver/FA recs — no edge-function change needed.
            window.WR?.AIFeedback?.send?.({
                leagueId: currentLeague?.league_id || currentLeague?.id,
                surface: 'fa_targets',
                recId: 'waiver-take:' + rec.name,
                action,
                subject: { name: rec.name, position: rec.position },
            });
        };
        const waiverTakeCacheAgeMin = waiverTake?.ts ? Math.round((Date.now() - waiverTake.ts) / 60000) : null;

        function byeRead(player) {
            const byes = window.App?.NFLByes;
            if (!byes) return 'Bye —';
            const season = byes.seasonFor(currentLeague);
            const week = byes.weekForPlayer(player, season);
            const label = byes.label(player, season);
            if (!week || week < (window.App?.WeeklyProj?.currentWeek?.() || 1)) return label;
            const samePosition = (myRoster?.players || []).map(pid => playersData?.[pid]).filter(p =>
                p && p.position === player.position && byes.weekForPlayer(p, season) === week);
            return label + (samePosition.length ? ' · Same bye as ' + samePosition.map(p => playerName(p)).join(', ') : '');
        }

        function recommendationBasis(fit) {
            const fresh = window.App?.WeeklyProj?.freshness?.(marketWeek, currentLeague.season);
            const before = fit?.beforeWeekly, after = fit?.afterWeekly;
            return 'Lineup ' + (before == null ? 'unknown' : before.toFixed(1)) + ' → ' + (after == null ? 'unknown' : after.toFixed(1))
                + '. ' + (fresh?.fetchedAt ? 'Weekly input fetched ' + new Date(fresh.fetchedAt).toLocaleTimeString() : 'Season/history fallback; weekly fetch unavailable')
                + '; provider as-of unavailable. Verify platform locks.';
        }

        function renderCandidateRow(x, i, isPrimary) {
            const dhqCol = x.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : x.dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.45))';
            if (_faPhone) return <button key={x.pid} type="button" className={'fa-mobile-candidate' + (isPrimary ? ' is-primary' : '')} aria-label={'Plan a waiver claim for ' + playerName(x.p)} onClick={() => window.WR?.openAcquisition ? window.WR.openAcquisition({ pid: x.pid, position: x.pos, leagueId: acquisitionLeagueId, source: 'ranked-waiver-plan', dropPid: x.fit.dropPid, reason: x.fit.label + ' · ' + x.windowLabel }) : openFaPlayer(x.pid)}>
                <span className="fa-mobile-candidate-head"><PlayerAvatar pid={x.pid} p={x.p} size={34} /><span><strong>{playerName(x.p)}</strong><small>{x.pos} · {x.p.team || 'FA'} · {x.windowLabel}</small></span><span className="fa-mobile-candidate-value"><strong>{x.dhq != null ? x.dhq.toLocaleString() : '—'}</strong><small>{valueShortLabel}</small></span></span>
                <span className="fa-mobile-candidate-reason">{x.fit.label}</span>
                <small className="fa-mobile-candidate-bye">{byeRead(x.p)} · {recommendationBasis(x.fit)}</small>
                <span className="fa-mobile-candidate-action">{x.faab ? '$' + x.faab.lo + '–' + x.faab.hi + ' · ' : ''}Plan claim <span aria-hidden="true">›</span></span>
            </button>;
            return (
                <button key={x.pid} className={'fa-hq-candidate' + (isPrimary ? ' is-primary' : '')} title="Plan this waiver" onClick={() => window.WR?.openAcquisition ? window.WR.openAcquisition({ pid: x.pid, position: x.pos, leagueId: acquisitionLeagueId, source: 'ranked-waiver-plan', dropPid: x.fit.dropPid, reason: x.fit.label + ' · ' + x.windowLabel }) : openFaPlayer(x.pid)}>
                    <span className="fa-hq-rank">{i + 1}</span>
                    <PlayerAvatar pid={x.pid} p={x.p} size={30} />
                    <span className="fa-hq-player-main">
                        <strong>{playerName(x.p)} <em className="fa-hq-cand-pos" style={{ color: posColors[x.pos] || 'var(--silver)' }}>{x.pos}</em></strong>
                        <span className="fa-hq-cand-badge" style={{ color: x.fit.color, borderColor: x.fit.color }}>{x.fit.label}</span>
                        <small style={{ display: 'block', color: 'var(--gold)', whiteSpace: 'normal', lineHeight: 1.4 }}>{byeRead(x.p)} · {recommendationBasis(x.fit)}</small>
                    </span>
                    <span className="fa-hq-cand-window">
                        <FaTrendSpark pid={x.pid} color={x.windowColor} />
                        <i>{x.p.team || 'FA'} · {x.windowLabel}</i>
                    </span>
                    <span className="fa-hq-player-value">
                        <strong style={{ color: dhqCol }}>{x.dhq != null ? x.dhq.toLocaleString() : '—'}</strong>
                    </span>
                    <span className="fa-hq-cand-bid">
                        <b>{x.faab ? '$' + x.faab.lo + '-' + x.faab.hi : 'Review bids'}</b>
                        <em style={{ color: x.fit.color }}>{x.fit.short}</em>
                    </span>
                </button>
            );
        }

        function renderActionHQ(compact = false) {
            const boardRows = actionBoardPlayers.slice(0, compact ? 6 : 8);
            const topAdds = priorityAdds.slice(0, 3);
            const planPlayer = (pid, dropPid, reason) => {
                const player = playersData[pid] || {};
                if (!dropPid) dropPid = actionBoardPlayers.find(x => x.pid === pid)?.fit?.dropPid || null;
                if (window.WR?.openAcquisition) window.WR.openAcquisition({ pid, dropPid, position: normPos(player.position), reason, leagueId: acquisitionLeagueId, source: 'waiver-action-plan' });
                else openFaPlayer(pid);
            };
            return <section className={'fa-hq-shell' + (compact ? ' is-compact' : '')}>
                <div className="fa-hq-grid">
                    <main className="fa-hq-panel fa-hq-board" style={{ order: -1 }}>
                        <div className="fa-hq-panel-head"><span>Ranked action plan</span><em>Select a player to plan the claim</em></div>
                        <div className="fa-hq-board-head"><span>Rank</span><span /><span>Player</span><span>Window</span><span>Score</span><span>Bid planning</span></div>
                        <div className="fa-hq-board-list">{boardRows.length ? <>{(_faPhone ? boardRows.slice(0, 3) : boardRows).map((x, i) => renderCandidateRow(x, i, i === 0))}{_faPhone && boardRows.length > 3 && <window.WR.MobileSection phone={true} title="More recommendations" summary={(boardRows.length - 3) + ' other options'}>{boardRows.slice(3).map((x, i) => renderCandidateRow(x, i + 3, false))}</window.WR.MobileSection>}</> : <p className="fa-hq-empty">{rosterRead.known ? 'No clear roster upgrade meets your filters. Holding your roster is a valid move.' : rosterRead.reason || 'Roster details are incomplete. Recommendations resume when player details are available.'}</p>}</div>
                        <div className="fa-hq-board-foot"><span>Ranked for your scoring, roster, and strategy.</span><button type="button" onClick={() => setFaSection('market')}>Explore all available players →</button></div>
                        {gmFiltersOn && <p style={{ color: 'var(--silver)', fontSize: '.76rem' }}>Your strategy filters apply{gmHiddenCount ? ' · ' + gmHiddenCount + ' players hidden' : ''}. <button type="button" onClick={() => window.wrNavigateTab?.('alex')}>Edit strategy</button></p>}
                    </main>
                    <aside className="fa-hq-panel">
                        <div className="fa-hq-panel-head"><span>Bid planning</span><em>{hasFAAB ? myRoster?.settings?.waiver_budget_used == null ? 'Remaining budget unavailable' : '$' + remaining + ' remaining' : 'League waiver rules apply'}</em></div>
                        {topAdds.length > 0 && <FaabCommandCard league={currentLeague} myRoster={myRoster} playersData={playersData} targets={topAdds.map(x => ({ pid: x.pid, name: x.name, pos: x.pos, dhq: x.dhq, valueRange: x.faab }))} />}
                        <button type="button" onClick={doGenerateWaiverTake} disabled={waiverTakeLoading}>{waiverTakeLoading ? 'Alex is thinking…' : visibleWaiverRecommendations.length ? 'Refresh Alex’s take' : 'Ask Alex about this plan'}</button>
                        {waiverTakeError && <p role="alert" style={{ color: 'var(--bad)', fontSize: '.8rem' }}>{waiverTakeError}</p>}
                        {visibleWaiverRecommendations.length > 0 && <details style={{ marginTop: 10 }}><summary>Alex’s reasoning{waiverTakeCacheAgeMin != null ? ' · ' + Math.round(waiverTakeCacheAgeMin) + 'm ago' : ''}</summary><button type="button" onClick={doClearWaiverTake}>Clear take</button>{visibleWaiverRecommendations.slice(0, 3).map(rec => <InsightCard key={rec.name} compact severity="opportunity" title={rec.name} body={rec.reason} feedback={{ given: waiverTakeFeedback[rec.name] || null, onUp: () => sendWaiverTakeFeedback(rec, 'up'), onDown: () => sendWaiverTakeFeedback(rec, 'down') }} />)}</details>}
                        <button type="button" onClick={() => window.wrNavigateTab?.('market-review')} style={{ display: 'block', marginTop: 10 }}>League bid history &amp; market research →</button>
                    </aside>
                    <aside className="fa-hq-panel">
                        <div className="fa-hq-panel-head"><span>Supporting context</span><em>Expand what you need</em></div>
                        <details style={{ marginBottom: 12 }}><summary>Add/drop upgrades · {upgradePairs.length}</summary><div className="fa-hq-stack" style={{ marginTop: 8 }}>{upgradePairs.length ? upgradePairs.map(pair => <button key={pair.drop.pid + '-' + pair.add.pid} type="button" className="fa-hq-swap" onClick={() => planPlayer(pair.add.pid, pair.drop.pid, 'Review this add/drop upgrade before submitting a claim.')}><span className="fa-hq-swap-side is-drop"><b>Possible drop</b>{pair.drop.name}<em>{pair.drop.dhq.toLocaleString()}</em></span><span className="fa-hq-swap-side is-add"><b>Add</b>{playerName(pair.add.p)}<em>+{pair.gain.toLocaleString()} {pair.metric}</em></span></button>) : <p className="fa-hq-empty">No obvious add/drop upgrade found.</p>}</div></details>
                        <details style={{ marginBottom: 12 }}><summary>Fresh drop alerts · {recentDrops.length}</summary><div className="fa-hq-stack" style={{ marginTop: 8 }}>{recentDrops.length ? recentDrops.map(d => <button key={d.pid} type="button" className="fa-hq-mini-card" onClick={() => planPlayer(d.pid, null, 'Dropped in Week ' + d.week + '; review availability and fit.')}><PlayerAvatar pid={d.pid} p={playersData[d.pid]} size={28} /><span className="fa-hq-mini-body"><strong>{d.name}</strong><em>Dropped W{d.week} · {d.dhq.toLocaleString()} {valueShortLabel}</em></span></button>) : <p className="fa-hq-empty">No startable recent drops on the wire.</p>}</div></details>
                        <details style={{ marginBottom: 12 }}><summary>Your roster coverage · {rosterRead.coverage}/{rosterRead.total} starting slots</summary><div className="fa-roster-groups" style={{ marginTop: 8 }}>{rosterGapRows.map(row => <div key={row.pos} className="fa-roster-group"><div><strong style={{ color: posColors[row.pos] }}>{row.pos}</strong><span>{row.actual} owned · {row.required} dedicated slots</span><b>{!rosterRead.known ? 'Unknown' : row.fillsStarter ? 'Open slot' : 'Covered'}</b></div><p>{row.owned.map(p => p.name).join(' · ') || 'No players owned'}</p>{row.bestWire && <button type="button" onClick={() => planPlayer(row.bestWire.pid, null, 'Improve your ' + row.pos + ' room.')}>{playerName(row.bestWire.p)} · +{row.gain.toLocaleString()} {valueShortLabel} over your lowest-valued {row.pos} →</button>}</div>)}</div></details>
                        {hasFAAB && <details><summary>Budget rivals · #{myFaabRank || '—'} in FAAB</summary><p style={{ color: 'var(--silver)', fontSize: '.8rem' }}>${remaining} of ${budget} left{canOutbidRows.length ? ' · ' + canOutbidRows.length + ' displayed teams can outbid you' : ''}</p><div className="fa-hq-chipline">{faabMarketRows.filter(r => !r.isMe).map(r => <span key={r.rosterId}>{r.name} ${r.remaining}</span>)}</div></details>}
                    </aside>
                </div>
            </section>;
        }

        function renderAcquisitionPlan() {
            if (!acquisitionContext) return null;
            const knownAmount = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
            const balance = knownAmount(currentLeague?.settings?.waiver_budget) && knownAmount(myRoster?.settings?.waiver_budget_used)
                ? waiverBidEvidence([], currentLeague, myRoster, playersData, '').remaining : null;
            const target = acquisitionContext.pid ? availablePlayers.find(row => String(row.pid) === acquisitionContext.pid) : null;
            const targetPlayer = playersData[acquisitionContext.pid];
            const ownedIds = [...new Set([...(myRoster?.players || []), ...(myRoster?.taxi || []), ...(myRoster?.reserve || [])].map(String))];
            const dropId = ownedIds.includes(acquisitionContext.dropPid) ? acquisitionContext.dropPid : '';
            const protectedDrop = dropId && window._playerTags?.[dropId] === 'untouchable';
            const setDrop = value => {
                const next = { ...acquisitionContext, dropPid: value || null };
                window.WR.acquisitionContext = next;
                setAcquisitionContext(next);
            };
            const name = targetPlayer ? playerName(targetPlayer, acquisitionContext.pid) : acquisitionContext.pid;
            const suggestion = target ? faabSuggest(target.dhq, target.pos || normPos(target.p.position), target.p.age) : null;
            return <section className="fa-acquisition-plan mc-claim-editor" style={{ marginBottom: 12, padding: 14, border: '1px solid var(--acc-line2, rgba(212,175,55,.35))', borderRadius: 10, background: 'var(--acc-fill1, rgba(212,175,55,.04))' }}>
                <div className="mc-claim-editor-head" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><strong style={{ color: 'var(--gold)' }}>{target ? 'Waiver plan · ' + name : 'Improve ' + (acquisitionContext.position || 'your team')}{acquisitionContext.week ? ' · Week ' + acquisitionContext.week : ''}</strong><button type="button" onClick={() => { window.WR.acquisitionContext = null; setAcquisitionContext(null); setPlannedBid(''); setMissionNotice(''); setFaFilter(''); }}>{_faPhone ? 'Back to plans' : 'Close editor'}</button></div>
                {acquisitionContext.reason && <p style={{ margin: '8px 0', color: 'var(--silver)', fontSize: '.82rem' }}>{acquisitionContext.reason}</p>}
                {acquisitionContext.pid && !target && <p role="status" style={{ color: 'var(--warn)', fontSize: '.8rem' }}>{name || 'This target'} is not in the current available-player pool. Choose an available player from Market.</p>}
                {_faPhone && !target && <button type="button" onClick={() => setFaSection('market')}>Choose player from Market</button>}
                {(!_faPhone || target) && <div className="mc-claim-editor-fields" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                    <label className="mc-claim-drop-field" style={{ color: 'var(--silver)', fontSize: '.8rem' }}>Possible drop <select value={dropId} onChange={e => setDrop(e.target.value)} style={{ marginLeft: 7, maxWidth: '100%', minHeight: 36 }}><option value="">Keep open / no drop selected</option>{ownedIds.map(id => <option key={id} value={id}>{playerName(playersData[id] || {}, id)}{window._playerTags?.[id] === 'untouchable' ? ' · Untouchable' : ''}</option>)}</select></label>
                    {target && hasFAAB && <label>Maximum bid <input type="number" min="0" max={balance == null ? undefined : balance} step="1" value={plannedBid} onChange={e => setPlannedBid(e.target.value)} placeholder="Your maximum" aria-label="Planned maximum waiver bid" />{_faPhone && <small>{balance == null ? 'Remaining budget unavailable' : '$' + balance + ' remaining'}</small>}</label>}
                    {target && suggestion && <span style={{ color: 'var(--gold)', fontSize: '.8rem' }}>Historical bid range ${suggestion.lo}–${suggestion.hi}</span>}
                    {target && <button type="button" onClick={() => openFaPlayer(target.pid)}>{_faPhone ? 'Player details' : 'Player details & notebook'}</button>}
                </div>}
                {protectedDrop && <p role="alert" style={{ color: 'var(--warn)', fontSize: '.8rem' }}>You marked this player Untouchable. Choose another drop or revisit that decision in My Team.</p>}
                {acquisitionContext.dropPid && !dropId && <p role="status" style={{ color: 'var(--warn)', fontSize: '.8rem' }}>The earlier drop candidate is no longer on your roster. No drop is selected.</p>}
                {target && isPro && !_faPhone && <FaabCommandCard league={currentLeague} myRoster={myRoster} playersData={playersData} targets={[{ pid: target.pid, name, pos: target.pos || normPos(target.p.position), dhq: target.dhq, valueRange: suggestion }]} />}
                {target && <button type="button" className="mc-claim-save" onClick={() => {
                    const bid = !hasFAAB || String(plannedBid).trim() === '' ? null : Number(plannedBid);
                    if (bid != null && (!Number.isInteger(bid) || bid < 0 || (balance != null && bid > balance))) { setMissionNotice(balance == null ? 'Enter a whole-dollar bid of $0 or more.' : 'Enter a whole-dollar bid within your remaining budget.'); return; }
                    if (protectedDrop) { setMissionNotice('Choose another drop before saving; this player is marked Untouchable.'); return; }
                    const saved = window.WR?.WaiverPlans?.save(currentLeague, { pid: target.pid, dropPid: dropId || null, bid, position: target.pos || normPos(target.p.position), reason: acquisitionContext.reason, source: acquisitionContext.source });
                    if (saved) {
                        if (_faPhone) { window.WR.acquisitionContext = null; setAcquisitionContext(null); setPlannedBid(''); }
                        else setAcquisitionContext({ ...acquisitionContext, ...saved });
                        setClaimPlanRevision(n => n + 1);
                    }
                    setMissionNotice(saved ? 'Plan saved on this device. Submit it on your league platform.' : 'Could not save the plan on this device. Your edits remain open.');
                }}>{window.WR?.WaiverPlans?.get(currentLeague, target.pid) ? 'Update claim plan' : 'Save claim plan'}</button>}
                {missionNotice && <p role="status">{missionNotice}</p>}
                {target && hasFAAB && isPro && _faPhone && <details className="mc-claim-bid-evidence"><summary>League bid history</summary><FaabCommandCard league={currentLeague} myRoster={myRoster} playersData={playersData} targets={[{ pid: target.pid, name, pos: target.pos || normPos(target.p.position), dhq: target.dhq, valueRange: suggestion }]} /></details>}
                {target && window.WR?.PlayerNotebook?.NotebookEditor && (_faPhone ? <details className="mc-claim-player-notes"><summary>Player notes</summary>{React.createElement(window.WR.PlayerNotebook.NotebookEditor, { pid: target.pid, leagueId: acquisitionLeagueId, leagueName: currentLeague.name || 'This league', compact: true })}</details> : React.createElement(window.WR.PlayerNotebook.NotebookEditor, { pid: target.pid, leagueId: acquisitionLeagueId, leagueName: currentLeague.name || 'This league', compact: true }))}
                {!_faPhone && <small style={{ display: 'block', marginTop: 8, color: 'var(--text-muted)' }}>Planning only. Submit any claim and roster change on your league platform.</small>}
            </section>;
        }

        function renderSavedTargets() {
            const rows = window.WR?.PlayerNotebook?.list(acquisitionLeagueId) || [];
            return <section className="fa-saved-targets" data-notebook-revision={notebookRevision} style={{ display: 'grid', gap: 12 }}>
                <div><h2 style={{ color: 'var(--gold)', margin: '0 0 5px' }}>Saved targets</h2><p style={{ color: 'var(--silver)', fontSize: '.85rem' }}>Your watchlist and notes. Personal research follows you across leagues; league plans stay private to this league.</p></div>
                {!rows.length && <div><p style={{ color: 'var(--silver)' }}>Open a player’s notebook to watch them or save a note. Draft notes and target tags appear here too.</p>{_faPhone && <button type="button" className="fa-mobile-more" onClick={() => window.wrNavigateTab?.('stats')}>Browse Stats hub</button>}</div>}
                {rows.map(row => {
                    const player = playersData[row.pid] || (String(row.pid).startsWith('csv_') ? { full_name: row.pid.slice(4).replace(/_/g, ' ') } : {});
                    const action = window.WR.PlayerNotebook.resolveAction({ pid: row.pid, league: currentLeague, rosters: currentLeague.rosters, myRosterId: myRoster?.roster_id, features: skinFeatures, context: isDraftProspect(row.pid, player) ? 'draft-prospect' : 'saved-targets' });
                    return <article key={row.pid} style={{ border: '1px solid var(--ov-5, rgba(255,255,255,.1))', borderRadius: 9, padding: 12, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}><button type="button" className="fa-saved-target-name" onClick={() => openFaPlayer(row.pid)} style={{ color: 'var(--gold)', background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>{playerName(player, row.pid)} {player.position || ''}</button><button type="button" onClick={() => {
                            if (action.kind === 'waiver') window.WR.openAcquisition({ pid: action.dropPid ? null : row.pid, dropPid: action.dropPid, position: player.position, leagueId: acquisitionLeagueId, source: 'saved-targets' });
                            else if (action.kind === 'draft') window.WR.openDraftPlayer({ pid: row.pid, leagueId: acquisitionLeagueId, source: 'saved-targets' });
                            else if (action.kind === 'trade') {
                                window._wrTradeFinderTarget = { pid: row.pid, mode: action.mine ? 'my' : 'acquire', ts: Date.now() };
                                window.wrNavigateTab?.('trades');
                                window.dispatchEvent(new CustomEvent('wr:open-trade-finder', { detail: { pid: row.pid } }));
                            } else openFaPlayer(row.pid);
                        }}>{action.kind === 'watch' ? 'View player' : action.label}</button></div>
                        {_faPhone ? <details className="mc-claim-player-notes"><summary>Notes</summary>{React.createElement(window.WR.PlayerNotebook.NotebookEditor, { pid: row.pid, leagueId: acquisitionLeagueId, leagueName: currentLeague.name || 'This league', compact: true })}</details> : React.createElement(window.WR.PlayerNotebook.NotebookEditor, { pid: row.pid, leagueId: acquisitionLeagueId, leagueName: currentLeague.name || 'This league', compact: true })}
                    </article>;
                })}
            </section>;
        }

        function renderWeeklyStreams() {
            if (!weeklyWaivers || skinFeatures.showStreaming === false) return null;
            if (!isPro) {
                const GatedRow = window.WrGatedMoreRow;
                return GatedRow ? <GatedRow title="This week’s streaming plays" sub="Compare available players with your best lineup. Streaming recommendations are Pro." feature="faab_intelligence" /> : null;
            }
            const choices = streamCandidates;
            const signed = n => Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(1) : '—';
            const points = n => Number.isFinite(n) ? n.toFixed(1) : '—';
            const row = o => <button type="button" className="fa-weekly-stream" key={o.fa.pid}
                onClick={() => window.WR?.openAcquisition ? window.WR.openAcquisition({ pid: o.fa.pid, dropPid: o.dropPid, position: o.pos, leagueId: acquisitionLeagueId, source: 'weekly-streams', reason: signed(o.delta) + ' lineup pts this week; ' + signed(o.rosGain) + ' projected ROS lineup pts' }) : openFaPlayer(o.fa.pid)}>
                <span className="fa-weekly-stream-player"><strong>{playerName(o.fa.p, o.fa.pid)}</strong><span>{o.pos} · {o.fa.p.team}</span><span>{o.dropName ? 'Suggested drop: ' + o.dropName : 'Use an open roster spot'}</span></span>
                <span className="fa-weekly-stream-stats"><span><strong>{points(o.fa.proj)}</strong>Week proj</span><span><strong>{points(o.rosPoints)}</strong>ROS pts</span><span><strong style={{color:o.delta < 0 ? 'var(--bad, #ef7777)' : undefined}}>{signed(o.delta)}</strong>Week lineup gain</span><span><strong style={{color:o.rosGain < 0 ? 'var(--bad, #ef7777)' : undefined}}>{signed(o.rosGain)}</strong>ROS lineup gain</span></span>
                <span className="fa-weekly-stream-action">Plan claim →</span>
            </button>;
            return <section className="fa-weekly-streams" aria-label="This week’s streaming plays">
                <h2>Streaming &amp; season upgrades</h2>
                <label>Improve my lineup for <select aria-label="Streaming improvement priority" value={streamHorizon} onChange={e=>setStreamHorizon(e.target.value)}><option value="week">This week</option><option value="season">Rest of season</option><option value="both">Both</option></select></label>
                <p>Week {marketWeek} · Available upgrades to your best projected lineup.</p>
                {choices.length ? <>{choices.slice(0, 3).map(row)}{choices.length > 3 && <details><summary>See {choices.length - 3} more streaming options</summary>{choices.slice(3).map(row)}</details>}<details><summary>How gains are calculated</summary><p>Gains compare your best projected lineup before and after this add/drop. ROS is a fixed-roster estimate, not a week-by-week schedule simulation. Each option is a separate move; confirm locks on your league platform.</p></details></>
                    : <p>{!marketIsCurrent || !availablePlayers.some(p => Number.isFinite(p.proj)) ? 'Weekly projections are unavailable. Browse available players below.' : 'No confirmed upgrades for this priority with the available projections. Missing forecasts can limit comparisons.'}</p>}
                <button type="button" className="fa-mobile-more" onClick={() => { setFaSection('market'); setFaSort({ key: 'proj', dir: -1 }); }}>Browse all available players</button>
            </section>;
        }

        function renderMissionWaiverBoard() {
            if (!isPro) return renderActionHqTeaser();
            const seasonRows = streamCandidates.filter(row => row.rosGain > 0).map(row => ({ ...row.fa, fit: { beforeWeekly: row.worstProj, afterWeekly: row.delta == null ? null : row.worstProj + row.delta, weeklyGain: row.delta, rosGain: row.rosGain, dropPid: row.dropPid, dropName: row.dropName }, basis: 'ROS lineup points', gain: row.rosGain }));
            const rows = streamHorizon === 'week'
                ? actionBoardPlayers.filter(row => row.fit.weeklyGain > 0).map(row => ({ ...row, basis: 'lineup points this week', gain: row.fit.weeklyGain }))
                : seasonRows.length ? seasonRows : resolvedLeagueSkin?.type === 'dynasty' ? actionBoardPlayers.filter(row => row.fit.seasonGain > 0 || row.fit.benchGain > 0).map(row => ({ ...row, basis: row.fit.seasonGain > 0 ? 'starter dynasty value' : 'bench dynasty value', gain: row.fit.seasonGain > 0 ? row.fit.seasonGain : row.fit.benchGain })) : [];
            const boardRows = rows.slice(0, 3);
            const feedback = (row, action) => {
                const next = writeWaiverPreference(preferenceKey, row.pid, streamHorizon, action);
                setMissionVotes({ key: preferenceKey, values: next || { ...activeVotes, [streamHorizon + ':' + row.pid]: action } });
                setMissionNotice(next ? 'Preference saved for this league and outlook.' : 'Preference kept for this visit; device storage is unavailable.');
                window.WR?.AIFeedback?.send?.({ leagueId: acquisitionLeagueId, surface: 'fa_targets', recId: 'waiver-board:' + currentLeague?.season + ':' + streamHorizon + ':' + row.pid, action, subject: { pid: row.pid, name: playerName(row.p), horizon: streamHorizon } });
            };
            const chat = row => {
                const context = { ...waiverSnapshot, horizon: streamHorizon, preferences: activeVotes,
                    selectedPlan: row ? { pid: row.pid, name: playerName(row.p), gain: row.gain, gainUnit: row.basis, dropPid: row.fit.dropPid, dropName: row.fit.dropName } : null };
                window.dispatchEvent(new CustomEvent('wr:ask-open', { detail: { title: row ? 'Waiver plan · ' + playerName(row.p) : 'Your waiver outlook', kind: 'waiver-plan', prompt: 'Help me decide whether to make this waiver move. Use only this supplied league evidence. Discuss risk and the proposed drop. Incorporate my saved up/down preferences without changing the measured gains. Do not invent playoff or title odds, a winning bid, or player news. ' + JSON.stringify(context) } }));
            };
            const renderPick = (row, index) => {
                    const evidence = waiverBidEvidence(bidHistory?.leagueId === acquisitionLeagueId ? bidHistory.txns : [], currentLeague, myRoster, playersData, row.pos);
                    const vote = activeVotes[streamHorizon + ':' + row.pid];
                    const risk = row.p.injury_status ? 'Injury: ' + row.p.injury_status : Number(row.p.depth_chart_order) > 1 ? 'Depth-chart role may limit opportunity.' : null;
                    const compactBasis = row.basis === 'lineup points this week' ? 'lineup pts · week' : row.basis === 'ROS lineup points' ? 'ROS lineup pts' : row.basis === 'starter dynasty value' ? 'starter value' : 'bench value';
                    return <article key={row.pid} className="mc-waiver-pick"><div className="mc-waiver-pick-head"><span className="mc-pick-rank">{index + 1}</span><button type="button" onClick={() => openFaPlayer(row.pid)}><strong>{playerName(row.p)}</strong><small>{row.pos} · {row.p.team || 'FA'} · {byeRead(row.p)}</small></button><div className="mc-waiver-gain"><b>+{row.gain.toLocaleString(undefined, { maximumFractionDigits: 1 })}</b><small><span className="mc-waiver-basis-full">{row.basis}</span><span className="mc-waiver-basis-short" aria-hidden="true">{compactBasis}</span></small></div></div>
                        <div className="mc-waiver-pick-details"><p>{row.fit.dropName ? 'Possible drop: ' + row.fit.dropName : 'Uses an open roster spot'}{streamHorizon === 'season' ? row.fit.weeklyGain == null ? ' · This-week effect unknown; conditional scenario' : ' · This week ' + (row.fit.weeklyGain > 0 ? '+' : '') + row.fit.weeklyGain.toFixed(1) : ''}</p>
                        {hasFAAB && <small className="mc-bid-read">{evidence.low == null ? 'Bid range unavailable' : 'Past ' + row.pos + ' bids: $' + evidence.low + '–$' + evidence.high + ' · historical'}</small>}</div>
                        <p className="mc-risk">{risk ? risk + '. ' : ''}{recommendationBasis(row.fit)}</p>
                        <div className="mc-waiver-pick-actions"><button type="button" className="mc-primary-action" onClick={() => { window.WR?.openAcquisition?.({ pid: row.pid, dropPid: row.fit.dropPid, position: row.pos, leagueId: acquisitionLeagueId, source: 'mission-waiver-board', reason: '+' + row.gain + ' ' + row.basis }); setFaSection('claims'); }}>Plan add</button><button type="button" onClick={() => chat(row)}>Why this move?</button><span className="mc-feedback"><button type="button" aria-label={'Useful suggestion for ' + playerName(row.p)} aria-pressed={vote === 'up'} onClick={() => feedback(row, 'up')}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 10v11H3V10zm0 0 5-8a3 3 0 0 1 2 3l-1 5h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7"/></svg></button><button type="button" aria-label={'Unhelpful suggestion for ' + playerName(row.p)} aria-pressed={vote === 'down'} onClick={() => feedback(row, 'down')}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 14V3H3v11zm0 0 5 8a3 3 0 0 0 2-3l-1-5h6a2 2 0 0 0 2-2l-2-7a2 2 0 0 0-2-2H7"/></svg></button></span></div>
                    </article>;
            };
            return <section className="mc-waiver-board" aria-label="Alex’s waiver board">
                <header><div><span className="mc-eyebrow">ALEX · YOUR NEXT MOVE</span><h2>Waiver board</h2></div><button type="button" onClick={() => chat(null)}>Chat with Alex ↗</button></header>
                <div className="mc-horizon" role="group" aria-label="Waiver outlook">{[['week','Win this week'],['season','Season outlook']].map(([key,label]) => <button type="button" key={key} aria-pressed={streamHorizon === key} onClick={() => setStreamHorizon(key)}>{label}</button>)}</div>
                {boardRows.length ? <>{(_faPhone ? boardRows.slice(0, 1) : boardRows).map(renderPick)}{_faPhone && boardRows.length > 1 && <details className="mc-waiver-more-ideas"><summary>{boardRows.length - 1} more waiver {boardRows.length === 2 ? 'idea' : 'ideas'}</summary>{boardRows.slice(1).map((row, index) => renderPick(row, index + 1))}</details>}</> : <div className="mc-waiver-hold"><strong>{rosterRead.known ? 'No confirmed upgrade in this outlook.' : rosterRead.reason || waiverBoard.reason || 'Roster evidence is incomplete.'}</strong><p>{streamHorizon === 'week' ? 'The board compares additions against your best projected lineup. Missing projections stay unknown; you can still review every available player below.' : 'A season scoring gain needs a current rest-of-season forecast. Dynasty value is shown separately when available.'}</p><button type="button" onClick={() => window.wrNavigateTab?.('lineup')}>Review your best lineup →</button></div>}
                {missionNotice && <p className="mc-board-notice" role="status">{missionNotice}</p>}
                <details className="mc-board-method"><summary>How this board works</summary><p>Each move compares a legal add/drop against your best lineup, protecting marked players and roster coverage. Projections vary with role and game script. Gains are separate alternatives and cannot be added together. Season scoring is a fixed-roster estimate; dynasty value is not a scoring forecast. League bid ranges describe completed transactions. Player locks and claims are confirmed on your league platform.</p></details>
            </section>;
        }
        function renderMissionCoverageDetails() {
            const rawBudget = currentLeague?.settings?.waiver_budget;
            const rawSpent = myRoster?.settings?.waiver_budget_used;
            const knownBudget = rawBudget != null && String(rawBudget).trim() !== '' && Number.isFinite(Number(rawBudget)) && Number(rawBudget) >= 0;
            const knownSpent = rawSpent != null && String(rawSpent).trim() !== '' && Number.isFinite(Number(rawSpent)) && Number(rawSpent) >= 0;
            const usesBids = hasFAAB || (knownBudget && Number(rawBudget) > 0);
            const history = bidHistory?.leagueId === acquisitionLeagueId ? bidHistory : null;
            const historyStatus = history ? history.error ? 'error' : 'ready' : window.WrTxns?.fetchLeagueTxns ? 'loading' : 'unavailable';
            const budgetRead = waiverBidEvidence([], currentLeague, myRoster, playersData, '');
            const balance = knownBudget && knownSpent ? budgetRead.remaining : null;
            const rawMin = currentLeague?.settings?.waiver_budget_min;
            const minimum = rawMin != null && rawMin !== '' ? budgetRead.minBid : null;
            const positions = [...new Set(rosterGapRows.map(row => row.pos))];
            const positionBids = positions.map(pos => ({ pos, ...waiverBidEvidence(history?.txns || [], currentLeague, myRoster, playersData, pos) }));
            const recorded = positionBids.filter(row => row.sampleSize > 0);
            const unrecorded = positionBids.filter(row => row.sampleSize === 0).map(row => row.pos);
            return <div className="mc-coverage-evidence">
                <section className="mc-coverage-budget" aria-label="Waiver budget">
                    {usesBids ? <><div><small>Your budget</small><strong>{balance == null ? 'Unavailable' : '$' + balance + ' left'}</strong></div><div><span>{knownBudget ? '$' + Number(rawBudget) + ' total' : 'Total unknown'}</span><small>{minimum == null ? 'Minimum unknown' : '$' + minimum + ' minimum'}</small></div></> : <div><small>Waiver system</small><strong>{knownBudget ? 'Priority waivers' : 'Settings unavailable'}</strong><span>{knownBudget ? 'No FAAB bids in this league.' : 'Check your league platform for waiver rules.'}</span></div>}
                </section>
                {usesBids && <section className="mc-coverage-bids" aria-label="Completed winning bids" data-status={isPro ? historyStatus : 'locked'}><h3>Completed winning bids</h3>
                    {!isPro ? <p>Position bid history is included with Pro.</p> : historyStatus === 'loading' ? <p role="status">Loading league bid history…</p> : historyStatus === 'error' ? <p role="status">Bid history could not load. Review league transactions for the latest bids.</p> : historyStatus === 'unavailable' || !knownBudget ? <p>Bid history is unavailable. Review transactions on your league platform.</p> : !recorded.length ? <p>No completed winning bids recorded yet.</p> : <><p className="mc-coverage-bid-caption">Middle 50% by position · this league</p><div className="mc-coverage-bid-rows">{recorded.map(evidence => <div key={evidence.pos} className="mc-coverage-bid-row" data-status={evidence.low == null ? 'insufficient' : 'ready'}><strong className="mc-coverage-position" style={{ '--coverage-pos': posColors[evidence.pos] || 'var(--silver)' }}>{evidence.pos}</strong><div><b>{evidence.low == null ? 'No range yet' : '$' + evidence.low + '–$' + evidence.high}</b><small>{evidence.sampleSize} completed {evidence.sampleSize === 1 ? 'bid' : 'bids'}{evidence.low == null ? ' · 5 needed' : ''}</small></div>{evidence.median != null && <div className="mc-coverage-bid-median"><b>${evidence.median}</b><small>median</small></div>}</div>)}</div>{unrecorded.length > 0 && <p className="mc-coverage-no-bids">None recorded: {unrecorded.join(', ')}.</p>}<p className="mc-coverage-bid-note">Past winning bids, not a recommended price.</p></>}
                </section>}
                <div className="mc-coverage-counting"><h3>What counts as ready?</h3><p>Unavailable players, reserve and taxi are excluded. Eligible FLEX players count toward starting-slot coverage.</p></div>
                <div className="mc-coverage-evidence-actions"><button type="button" onClick={() => setFaSection('market')}>Browse players</button><button type="button" onClick={() => window.wrNavigateTab?.('market-review')}>League transactions →</button></div>
            </div>;
        }
        function renderMissionCoverage() {
            const rows = [...rosterGapRows].sort((a, b) => Number(b.fillsStarter) - Number(a.fillsStarter));
            return <section className="mc-waiver-coverage"><header><h2>Roster coverage</h2><b>{rosterRead.known ? rosterRead.coverage + ' / ' + rosterRead.total : '—'} filled</b></header>
                <div className="mc-coverage-rows">{rows.map(row => <details key={row.pos} className="mc-coverage-row" data-status={!rosterRead.known ? 'unknown' : row.fillsStarter ? 'open' : 'covered'} open={!_faPhone}>
                    <summary><strong className="mc-coverage-position" style={{ '--coverage-pos': posColors[row.pos] || 'var(--silver)' }}>{row.pos}</strong><span className="mc-coverage-count">{rosterRead.known ? row.actual + ' ready' : 'Ready count unknown'}<small>{rosterRead.known ? row.owned.length + ' owned' : 'Roster unavailable'}</small></span><b className="mc-coverage-status">{!rosterRead.known ? 'Unknown' : row.fillsStarter ? 'Open slot' : 'Covered'}</b><span className="mc-coverage-toggle" aria-hidden="true">+</span></summary>
                    <div className="mc-coverage-detail"><p>{rosterRead.known ? row.owned.map(player => player.name).join(' · ') || 'No players owned' : 'Roster information unavailable'}</p><small>{row.required} dedicated {row.required === 1 ? 'slot' : 'slots'} · FLEX eligibility included in coverage</small><button type="button" onClick={() => { setFaFilter(row.pos); setFaSection('market'); }}>Find {row.pos} help →</button></div>
                </details>)}</div>
                <details className="mc-coverage-method"><summary>Coverage &amp; bid details</summary>{_faPhone ? renderMissionCoverageDetails() : <><p>Ready counts exclude unavailable players, reserve and taxi. Starting-slot coverage includes eligible FLEX options.</p>{renderActionHQ(true)}</>}</details>
            </section>;
        }
        function renderMissionTabs() {
            return <nav className="fa-section-tabs mc-market-tabs" aria-label="Free agency sections">{[['market','Market'],['claims',_faPhone ? 'Claim plans' : 'Claims'],['coverage','Coverage']].map(([key,label]) => <button type="button" key={key} aria-pressed={faSection === key} onClick={() => setFaSection(key)}>{label}</button>)}</nav>;
        }
        function renderMissionClaims() {
            const knownAmount = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
            const rawBudget = currentLeague?.settings?.waiver_budget;
            const balance = knownAmount(rawBudget) && knownAmount(myRoster?.settings?.waiver_budget_used)
                ? waiverBidEvidence([], currentLeague, myRoster, playersData, '').remaining : null;
            const budgetLabel = hasFAAB ? balance == null ? 'Budget unknown' : '$' + balance + ' left'
                : knownAmount(rawBudget) && Number(rawBudget) === 0 ? 'Priority order' : 'Budget unknown';
            const ownedIds = new Set([...(myRoster?.players || []), ...(myRoster?.taxi || []), ...(myRoster?.reserve || [])].map(String));
            const edit = plan => {
                const next = { ...plan, leagueId: acquisitionLeagueId };
                window.WR.acquisitionContext = next;
                setAcquisitionContext(next); setPlannedBid(plan.bid == null ? '' : String(plan.bid)); setMissionNotice('');
            };
            const changeOrder = (plan, direction) => {
                const ok = window.WR?.WaiverPlans?.move(currentLeague, plan.id, direction);
                setMissionNotice(ok ? 'Local plan order updated.' : 'Could not update the plan order.');
                if (ok) setClaimPlanRevision(n => n + 1);
            };
            const remove = plan => {
                const ok = window.WR?.WaiverPlans?.remove(currentLeague, plan.id);
                if (ok) {
                    setClaimPlanRevision(n => n + 1);
                    if (String(acquisitionContext?.pid) === plan.pid) { setAcquisitionContext(null); window.WR.acquisitionContext = null; setPlannedBid(''); }
                }
                setMissionNotice(ok ? 'Local plan removed.' : 'Could not remove the plan on this device.');
            };
            return <section className="mc-waiver-claims"><header className="mc-claims-heading"><div><h2>Claim plans</h2><small>{claimPlans.length} saved · {budgetLabel}</small></div>{!acquisitionContext && claimPlans.length > 0 && <button type="button" onClick={() => setFaSection('market')}>Add player</button>}</header><p className="mc-claims-scope">Saved on this device. Submit claims on your league platform.</p>
                {renderAcquisitionPlan()}
                {!acquisitionContext && missionNotice && <p className="mc-claim-notice" role="status">{missionNotice}</p>}
                {(!_faPhone || !acquisitionContext) && <div className="mc-claim-list" aria-label="Saved local claim plans">{claimPlans.length ? claimPlans.map((plan, index) => {
                    const name = playerName(playersData[plan.pid] || {}, plan.pid);
                    const available = availablePlayers.some(row => String(row.pid) === plan.pid);
                    const review = [];
                    if (plan.dropPid && !ownedIds.has(String(plan.dropPid))) review.push('Drop no longer owned');
                    else if (plan.dropPid && window._playerTags?.[plan.dropPid] === 'untouchable') review.push('Drop marked Untouchable');
                    if (hasFAAB && balance != null && plan.bid != null && plan.bid > balance) review.push('Bid exceeds $' + balance + ' remaining');
                    return <article key={plan.id} className="mc-claim-row"><header><span className="mc-claim-priority">{index + 1}</span><div><strong>Add {name}</strong><small>{plan.dropPid ? 'Drop ' + playerName(playersData[plan.dropPid] || {}, plan.dropPid) : 'No drop selected'}</small></div><b>{hasFAAB ? plan.bid == null ? 'Bid unset' : '$' + plan.bid : 'Priority ' + (index + 1)}</b></header>{!available && <p className="mc-risk">Target no longer available. Review or remove this plan.</p>}{review.length > 0 && <p className="mc-risk" role="alert">Review: {review.join(' · ')}.</p>}<div className="mc-claim-actions"><button type="button" onClick={() => edit(plan)}>Edit plan</button><details className="mc-claim-manage"><summary>Order &amp; remove</summary><div><button type="button" aria-label={'Move ' + name + ' up'} disabled={index === 0} onClick={() => changeOrder(plan, -1)}>↑</button><button type="button" aria-label={'Move ' + name + ' down'} disabled={index === claimPlans.length - 1} onClick={() => changeOrder(plan, 1)}>↓</button><button type="button" onClick={() => remove(plan)}>Remove</button></div></details></div></article>;
                }) : <div className="mc-claim-empty"><strong>No claim plans yet.</strong><p>Select “Plan add” on a player{hasFAAB ? ", choose a drop and bid" : " and choose a drop"}, then save your plan here.</p><button type="button" onClick={() => setFaSection('market')}>Browse available players →</button></div>}</div>}
                {(!_faPhone || !acquisitionContext) && <details className="mc-claim-watchlist"><summary>Watchlist &amp; player notes</summary>{renderSavedTargets()}</details>}
            </section>;
        }

        function renderRosterSyncBlocker() {
            const isPreDraft = !!rosterState.isPreDraftRosterEmpty;
            return (
                <div className="fa-page wr-fade-in">
                    {window.App?.renderRosterDataBlocker?.(rosterState, {
                        title: isPreDraft ? null : 'Free Agency paused',
                        message: isPreDraft ? rosterState.message : 'Waiver rankings are hidden until roster IDs finish loading.',
                        detail: rosterState.detail,
                        actionLabel: isPreDraft ? null : 'Refresh Data',
                        style: { minHeight: '220px' },
                    })}
                </div>
            );
        }

        if (!rosterState.isUsable) return renderRosterSyncBlocker();

        // ── UDFA CRAZE PANEL ──────────────────────────────────────────────────
        function fmtCountdown(end) {
            const ms = Number(end) - Date.now();
            if (!Number.isFinite(ms) || ms <= 0) return 'closing';
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
            return h + 'h ' + m + 'm';
        }
        function renderCrazePanel() {
            if (!crazeOpen) return null;
            if (!isPro) {
                const GatedRow = window.WrGatedMoreRow;
                return GatedRow ? (
                    <div style={{ margin: '0 0 14px' }}>
                        <GatedRow title="UDFA Craze is live" sub="The ranked post-draft UDFA board — roster fit, tiers, and league-calibrated FAAB — is Pro. The rookies themselves are in the Market Explorer below (Rookies filter)." feature="faab_intelligence" />
                    </div>
                ) : null;
            }
            if (!crazeBoard) return null;
            const groups = crazeBoard.groups || [];
            const total = crazeBoard.total || 0;
            if (!total) return null;
            const headline = (window.AlexVoice ? window.AlexVoice.pick('udfa:craze:' + crazeLeagueId, [
                "Rookie draft's done — the UDFA wire just opened. Dive into a group to work it.",
                "The craze is live. Here's the undrafted-rookie market by position — drill in to bid.",
                "This is the scramble. Scan the groups, then dive into the pool to claim.",
            ]) : 'The UDFA craze is live.');
            const drill = (pos) => {
                setRookieOnly(true);
                setFaFilter(pos || '');
                setFaSection('market');
            };
            const posName = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
            return (
                <section style={{ margin: '0 0 14px', borderRadius: 'var(--card-radius-lg, 14px)', overflow: 'hidden', border: '1px solid var(--acc-line4, rgba(212,175,55,0.55))', background: 'linear-gradient(135deg, rgba(212,175,55,0.10), transparent 70%)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                        <span style={{ fontFamily: "var(--font-display, Rajdhani, sans-serif)", fontWeight: 800, letterSpacing: '0.08em', color: 'var(--gold)', fontSize: '0.95rem' }}>⚡ UDFA CRAZE — LIVE</span>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' }}>Waivers process in <strong style={{ color: 'var(--white)' }}>{fmtCountdown(crazeState.windowEnd)}</strong> · <strong style={{ color: 'var(--white)' }}>{total}</strong> available across {groups.length} group{groups.length === 1 ? '' : 's'}</span>
                        <span style={{ flex: 1 }} />
                        <button type="button" title="Dismiss the craze panel" onClick={() => { try { window.App?.PostDraft?.closeCraze?.(crazeLeagueId); setCrazeTick(t => t + 1); } catch (e) {} }}
                            style={{ background: 'transparent', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '0.84rem', color: 'var(--white)', marginBottom: '12px', lineHeight: 1.5 }}>{headline}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>
                            {groups.map(g => (
                                <button key={g.pos} type="button" onClick={() => drill(g.pos)} title={'View all ' + g.count + ' ' + posName(g.pos) + ' UDFAs'}
                                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', cursor: 'pointer' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                                        <span style={{ fontFamily: "var(--font-display, Rajdhani, sans-serif)", fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.04em', fontSize: '0.9rem' }}>{posName(g.pos)}</span>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' }}>{g.count} avail</span>
                                    </div>
                                    {g.top && (
                                        <div style={{ marginTop: '5px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', lineHeight: 1.4 }}>
                                            Top: <span style={{ color: 'var(--white)', fontWeight: 700 }}>{g.top.name}</span>{g.top.nflTeam ? ' · ' + g.top.nflTeam : ''} · {Number(g.top.dhq || 0).toLocaleString()}
                                        </div>
                                    )}
                                    <div style={{ marginTop: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700 }}>View all {g.count} →</div>
                                </button>
                            ))}
                        </div>
                        <button type="button" onClick={() => drill('')} style={{ marginTop: '12px', padding: '7px 12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', fontFamily: "var(--font-ui, 'DM Sans', sans-serif)", fontWeight: 800, fontSize: 'var(--text-micro, 0.6875rem)', cursor: 'pointer' }}>
                            See all {total} UDFAs in the pool →
                        </button>
                    </div>
                </section>
            );
        }

        // Free teaser standing in for the Action HQ rec suite (analyst view).
        function renderActionHqTeaser() {
            const GatedRow = window.WrGatedMoreRow;
            if (!GatedRow) return null;
            return (
                <div style={{ margin: '0 0 14px' }}>
                    <GatedRow title="Waiver Action HQ" sub="Priority adds, FAAB bid ranges, add/drop upgrades, and the ranked waiver board are Pro. The Market Explorer tab stays free." feature="faab_intelligence" />
                </div>
            );
        }

        // ══ PHONE (<768) EARLY RETURN — iPhone program Phase 1 (FA) ═══════
        // Everything below this block (the analyst-view return, the market
        // table with its click-path contract literals, and the fixed right
        // .fa-detail-drawer) renders ONLY off-phone — desktop/tablet output
        // stays byte-identical. Slot values call the SAME sources as the
        // desktop renderCell (faabSuggest / fitRead / computeRollingPPG /
        // RookieFields.fields) — lookups reused, no formulas duplicated.
        // Row tap routes to the standard player card via openFaPlayer (the
        // same path the HQ cards use); the drawer never opens on phone.
        if (_faPhone) {
            // Render-time tier filter — the SAME boundary as the desktop
            // market table below: a Pro column can never ride a free slot.
            const shownFaCols = faTierCols(visibleFaCols);
            // Preset → "which 3 stat slots ride the card row" (P1 AssetRow);
            // keyed off faActivePresetKey (derived from the PERSISTED columns,
            // not session faColPreset) so the slots track the saved view across
            // reloads (owner ask 2026-07-12). Named views map to a DISTINCT trio;
            // 'full' is deliberately ABSENT — full/custom ride the first 3
            // slot-capable picks of the actual columns ("full = your columns").
            // PEAK left the default path; the this-week projection replaced it.
            const FA_PHONE_SLOT_PRESETS = {
                default: ['dhq', 'ppg', 'proj'],   // value · production · this-week projection
                scout:   ['age', 'height', 'weight'],
                bidding: ['dhq', 'faab', 'proj'],  // value · bid · this-week projection
                rookie:  ['rkSlot', 'rkRank', 'rkTier'],
                usage: ['sig1', 'sig2', 'ppg'],
            };
            const FA_PHONE_SLOT_KEYS = new Set(['age', 'dhq', 'ppg', 'proj', 'peakYr', 'yrsExp', 'height', 'weight', 'depthChart', 'injury', 'faab', 'rkSlot', 'rkTeam', 'rkRank', 'rkTier', 'sig1', 'sig2']);
            let _faSlotKeys = FA_PHONE_SLOT_PRESETS[faActivePresetKey]
                || shownFaCols.filter(k => FA_PHONE_SLOT_KEYS.has(k)).slice(0, 3);
            _faSlotKeys = faTierCols(_faSlotKeys);
            if (!_faSlotKeys.length) _faSlotKeys = faTierCols(FA_PHONE_SLOT_PRESETS.default);

            // Slot renderer — same data reads as the desktop renderCell.
            const _faSlotFor = (k, x) => {
                const p = x.p;
                const short = ((faColumns[k] && faColumns[k].shortLabel) || k).toUpperCase();
                switch (k) {
                    case 'dhq': return { label: valueShortLabel, value: x.dhq > 0 ? x.dhq.toLocaleString() : '—', strong: true };
                    case 'faab': {
                        const f = faabSuggest(x.dhq, x.pos, p.age);
                        return { label: 'BID', value: f ? '$' + f.lo + '-' + f.hi : '—', tone: f ? 'gold' : 'mute' };
                    }
                    case 'ppg': {
                        const read = marketPpgRead(x.pid, x.pos);
                        const year = read.note.match(/^\d{4}/)?.[0];
                        return { label: year ? `${year} PPG` : ppgWindow === 'season' ? 'PPG' : `${ppgWindow.toUpperCase()} PPG`, value: read.value == null ? '—' : read.value.toFixed(1) };
                    }
                    case 'proj': return { label: marketIsCurrent ? `W${marketWeek} PROJ` : 'PROJ', value: x.proj == null ? '—' : x.proj.toFixed(1) };
                    case 'sig1': case 'sig2': {
                        const source = marketStatSource(x.pid);
                        const read = window.App?.FAMarketData?.signature(x.pos, k === 'sig1' ? 0 : 1, source.raw);
                        return { label: (read?.short || short) + (source.prior && read?.value != null ? ` · ${source.year}` : ''), value: read?.text || '—' };
                    }
                    case 'age': return { label: short, value: p.age || '—', tone: 'mute' };
                    case 'peakYr': {
                        const py = peakYearsFor(x.pos, p.age);
                        const vy = valueYearsFor(x.pos, p.age);
                        const lb = py >= 4 ? 'Rising' : py >= 1 ? 'Prime' : vy >= 1 ? 'Vet' : 'Post';
                        return { label: short, value: lb, tone: py >= 1 ? 'gold' : 'mute' };
                    }
                    case 'yrsExp': return { label: short, value: p.years_exp != null ? p.years_exp : '—', tone: 'mute' };
                    case 'height': return { label: short, value: p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : '—', tone: 'mute' };
                    case 'weight': return { label: short, value: p.weight || '—', tone: 'mute' };
                    case 'depthChart': return { label: short, value: p.depth_chart_order != null ? x.pos + (p.depth_chart_order + 1) : '—', tone: 'mute' };
                    case 'injury': return { label: short, value: p.injury_status || '—', tone: p.injury_status ? 'bad' : 'mute' };
                    case 'rkSlot': case 'rkTeam': case 'rkRank': case 'rkTier': {
                        const rf = window.App?.RookieFields?.fields?.(prospectFor(p)) || null;
                        if (k === 'rkSlot') {
                            const slotTxt = rf?.draftSlot || faDraftSlotTxt(x.pid);
                            return { label: short, value: slotTxt || '—', tone: slotTxt ? undefined : 'mute' };
                        }
                        if (k === 'rkTeam') {
                            const tm = rf?.nflTeam || faDraftCap(x.pid)?.team;
                            return { label: short, value: tm || '—', tone: 'mute' };
                        }
                        if (!rf) return { label: short, value: '—', tone: 'mute' };
                        if (k === 'rkRank') return { label: short, value: rf.consensusRank != null ? rf.consensusRank : '—' };
                        return { label: short, value: rf.tierLabel || '—' };
                    }
                    default: return { label: short, value: '—', tone: 'mute' };
                }
            };
            // ── P5 hero — the #1 priority add + bid + FAAB standing in one
            // read. Bid/why reads are Pro (priorityAdds is [] for free — the
            // exact existing boundary); free sees the top market name + raw
            // market context, both already free in the explorer below.
            const _heroPro = isPro && priorityAdds.length ? priorityAdds[0] : null;
            const _heroFree = availablePlayers.length ? availablePlayers[0] : null;
            let _faHeroEl = null;
            if (_heroPro) {
                const heroFaab = _heroPro.faab || null;
                const faabBits = hasFAAB ? ' · $' + remaining + ' of $' + budget + ' left · #' + (myFaabRank || '—') + ' FAAB' : '';
                _faHeroEl = React.createElement(window.WR.HeroCard, {
                    kicker: 'Top add',
                    headline: playerName(_heroPro.p, _heroPro.pid).toUpperCase() + (heroFaab ? ' — BID $' + heroFaab.lo + '–' + heroFaab.hi : ''),
                    cta: heroFaab ? 'SET BID' : 'OPEN PLAYER CARD',
                    onCta: () => openFaPlayer(_heroPro.pid),
                });
            } else if (_heroFree) {
                _faHeroEl = React.createElement(window.WR.HeroCard, {
                    kicker: 'Top add',
                    headline: playerName(_heroFree.p, _heroFree.pid).toUpperCase(),
                    ctaGhost: 'Open player card',
                    onCtaGhost: () => openFaPlayer(_heroFree.pid),
                });
            }

            // ── P3 pills + FilterSheet — re-homes the EXISTING toolbar
            // controls (search, pos chips, rookie drill-down, sort, view
            // presets, column picker trigger, PPG window, saved views);
            // every control drives the exact same state setters as the
            // desktop toolbar, which stays untouched for tablet/desktop.
            const _faTogglePanel = key => setFaPanel(current => current === key ? null : key);
            const _faSortOptions = [{ key: 'name', label: 'Player name', short: 'Player' }, ...(metricPreference
                ? window.WR.PlayerMetrics.definitions.filter(metric => metricPreference.selected.includes(metric.key) && ['proj', 'ppg', 'dhq', 'age', 'season', 'bye', 'matchup'].includes(metric.key)).map(metric => ({ key: metric.key, label: metric.name, short: metric.label }))
                : Object.values(faColumns).filter(column => column.sortKey).map(column => ({ key: column.sortKey, label: column.label, short: column.shortLabel })))];
            const _sortCol = _faSortOptions.find(option => option.key === faSort.key);
            const _faSheetSelect = active => ({ width: '100%', minWidth: 0, minHeight: '44px', padding: '8px 10px', fontSize: '16px', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid var(--gx-edge,rgba(183,206,255,.2))', borderRadius: 'var(--card-radius-sm, 8px)' });
            const _faChipBtn = active => ({ padding: '7px 10px', minHeight: '44px', fontSize: '12px', fontFamily: 'var(--font-body)', background: active ? 'rgba(183,206,255,.12)' : 'transparent', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid var(--gx-edge,rgba(183,206,255,.2))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: active ? 700 : 400 });
            const _faPanelWrap = body => <section id="fa-market-options" className="mc-market-panel" aria-label={faPanel === 'filters' ? 'Market filters' : faPanel === 'sort' ? 'Market sorting' : 'Saved market views'}><header><strong>{faPanel === 'filters' ? 'Filters' : faPanel === 'sort' ? 'Sort players' : metricPreference ? 'Saved filters & sort' : 'Market views'}</strong><button type="button" onClick={() => setFaPanel(null)}>Done</button></header>{body}</section>;
            const _faPanelLbl = text => <div className="mc-market-panel-label">{text}</div>;
            let _faPanelEl = null;
            if (faPanel === 'filters') {
                _faPanelEl = _faPanelWrap(<>
                    {_faPanelLbl('Position')}
                    <div className="mc-market-position-filters" role="group" aria-label="Filter by position">{['', ...leaguePositions].map(pos => <button type="button" key={pos || 'all'} aria-pressed={faFilter === pos} onClick={() => setFaFilter(pos)} style={_faChipBtn(faFilter === pos)} title={pos && streamPosSet.has(pos) ? 'Streaming upgrade available at ' + pos + ' this week' : undefined}>{pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'All'}{pos && streamPosSet.has(pos) ? <span aria-hidden="true"> •</span> : null}</button>)}</div>
                    <button type="button" aria-pressed={rookieOnly} onClick={() => { const next = !rookieOnly; setRookieOnly(next); if (!next) { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} style={_faChipBtn(rookieOnly)}>Rookies / UDFAs{rookieOnly ? ' · On' : ''}</button>
                    {rookieOnly && <details className="mc-market-rookie-filters" open={!!(rookieTeamFilter || rookieCollegeFilter || rookieSlotFilter)}><summary>Rookie details</summary><div>
                        <label>NFL team<select aria-label="Rookie NFL team" value={rookieTeamFilter} onChange={e => setRookieTeamFilter(e.target.value)} style={_faSheetSelect(!!rookieTeamFilter)}><option value="">All teams</option>{rookieFilterOptions.teams.map(team => <option key={team} value={team}>{team}</option>)}</select></label>
                        <label>College<select aria-label="Rookie college" value={rookieCollegeFilter} onChange={e => setRookieCollegeFilter(e.target.value)} style={_faSheetSelect(!!rookieCollegeFilter)}><option value="">All colleges</option>{rookieFilterOptions.colleges.map(college => <option key={college} value={college}>{college}</option>)}</select></label>
                        <label>Draft round<select aria-label="Rookie draft round" value={rookieSlotFilter} onChange={e => setRookieSlotFilter(e.target.value)} style={_faSheetSelect(!!rookieSlotFilter)}><option value="">Any round</option>{['1','2','3','4','5','6','7','UDFA'].map(round => <option key={round} value={round}>{round === 'UDFA' ? 'Undrafted' : 'Round ' + round}</option>)}</select></label>
                    </div></details>}
                    <button type="button" onClick={() => { setFaSearch(''); setFaFilter(''); setRookieOnly(false); setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); }} style={_faChipBtn(false)}>Clear filters</button>
                </>);
            } else if (faPanel === 'sort') {
                _faPanelEl = _faPanelWrap(<>
                    <label className="mc-market-sort-field">Sort by<select aria-label="Sort available players by" value={_sortCol ? faSort.key : 'dhq'} onChange={e => { const key = e.target.value; setFaSort(previous => ({ key, dir: previous.key === key ? previous.dir : defaultFaSortDirection(key) })); }} style={_faSheetSelect(true)}>{_faSortOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
                    <button type="button" aria-label="Reverse player sort order" onClick={() => setFaSort(previous => ({ ...previous, dir: previous.dir * -1 }))} style={_faChipBtn(true)}>{faSort.key === 'name' ? faSort.dir === -1 ? 'Z to A ↓' : 'A to Z ↑' : faSort.dir === -1 ? 'High to low ↓' : 'Low to high ↑'}</button>
                    {!metricPreference && <><span className="mc-market-panel-label">PPG window</span><div className="mc-market-position-filters">{[{ k: 'season', l: 'Season' }, { k: 'l5', l: 'Last 5' }, { k: 'l3', l: 'Last 3' }].map(option => <button type="button" key={option.k} aria-pressed={ppgWindow === option.k} onClick={() => setPpgWindow(option.k)} style={_faChipBtn(ppgWindow === option.k)}>{option.l}</button>)}</div></>}
                    {window.WR?.SavedViews?.SavedViewBar && <button type="button" onClick={() => setFaPanel('view')} style={_faChipBtn(false)}>Saved filters &amp; sort →</button>}
                </>);
            } else if (faPanel === 'view') {
                _faPanelEl = _faPanelWrap(<>
                    {!metricPreference ? <><label className="mc-market-sort-field">Preset<select aria-label="Market column preset" value={faActivePresetKey} onChange={e => { const key = e.target.value, columns = FA_COLUMN_PRESETS[key]; if (!columns) return; setVisibleFaCols(faTierCols(columns)); setFaColPreset(key); setRookieOnly(key === 'rookie'); if (key !== 'rookie') { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} style={_faSheetSelect(true)}>{Object.keys(FA_COLUMN_PRESETS).map(key => <option key={key} value={key}>{key}</option>)}{faActivePresetKey === 'custom' && <option value="custom">custom</option>}</select></label><button type="button" onClick={() => { setShowFaColPicker(true); setFaPanel(null); }} style={_faChipBtn(false)}>Customize · {shownFaCols.length} fields</button></> : <p>Save your filters and sort. Use Columns to change the stats shared across player lists.</p>}
                    {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
                        surface: 'free_agency', leagueId: currentLeague?.id || currentLeague?.league_id,
                        currentState: { columns: metricPreference ? [] : visibleFaCols, sort: faSort, filters: { faFilter, faSearch, rookieOnly, rookieTeamFilter, rookieCollegeFilter, rookieSlotFilter } },
                        onApply: view => {
                            if (!metricPreference && Array.isArray(view.columns) && view.columns.length) { setVisibleFaCols(faTierCols(view.columns.filter(key => FA_COLUMNS[key]))); setFaColPreset('custom'); }
                            if (view.sort?.key) setFaSort({ key: _faSortOptions.some(option => option.key === view.sort.key) ? view.sort.key : _faSortOptions.find(option => option.key === 'dhq')?.key || _faSortOptions[0].key, dir: view.sort.dir === -1 ? -1 : 1 });
                            if (typeof view.filters?.faFilter === 'string') setFaFilter(view.filters.faFilter);
                            if (typeof view.filters?.faSearch === 'string') setFaSearch(view.filters.faSearch);
                            setRookieOnly(view.filters?.rookieOnly === true);
                            setRookieTeamFilter(view.filters?.rookieOnly ? view.filters.rookieTeamFilter || '' : '');
                            setRookieCollegeFilter(view.filters?.rookieOnly ? view.filters.rookieCollegeFilter || '' : '');
                            setRookieSlotFilter(view.filters?.rookieOnly ? view.filters.rookieSlotFilter || '' : '');
                        },
                    })}
                </>);
            }
            const _faBudgetKnown = [currentLeague?.settings?.waiver_budget, myRoster?.settings?.waiver_budget_used].every(value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0);
            const _faBalance = _faBudgetKnown ? waiverBidEvidence([], currentLeague, myRoster, playersData, '').remaining : null;
            const _faToolsEl = <div className="mc-market-tools"><input type="search" aria-label="Search available players" placeholder="Find a player, team or college…" value={faSearch} onChange={e => setFaSearch(e.target.value)} /><button type="button" aria-controls="fa-market-options" aria-expanded={faPanel === 'filters'} onClick={() => _faTogglePanel('filters')}><span>Filters</span><b>{(faFilter ? window.App?.posLabel?.(faFilter) || faFilter : 'All') + (rookieOnly ? ' · Rookies' : '')}</b></button><button type="button" aria-controls="fa-market-options" aria-expanded={faPanel === 'sort' || faPanel === 'view'} onClick={() => _faTogglePanel('sort')}><span>Sort</span><b>{(_sortCol?.short || 'VALUE') + (faSort.dir === -1 ? ' ↓' : ' ↑')}</b></button>{metricPreference && window.WR.PlayerMetrics.Picker ? <window.WR.PlayerMetrics.Picker preference={metricPreference} /> : <button type="button" aria-controls="fa-market-options" aria-expanded={faPanel === 'view'} onClick={() => _faTogglePanel('view')}>Columns</button>}</div>;
            // Column picker sheet — the phone home for the EXISTING
            // showFaColPicker state (the desktop inline panel lives in the
            // analyst return below and never renders on phone). The shared
            // P3 FilterSheet customizer treatment (same anatomy as My
            // Roster's): "Active (n)" 44px rows with ▲▼ move + × remove
            // (the same setVisibleFaCols/setFaColPreset('custom') swaps the
            // desktop ◀▶/× chips run — key-indexed so a free user's stored
            // Pro column can't skew the reorder), then "Available" add chips
            // grouped by the EXISTING col.group metadata, behind the same
            // isPro/FA_PRO_COLS option gate. Active rows map over
            // shownFaCols — the same render-time tier filter as the market
            // table, so a Pro column never renders for free.
            const _faColMove = (key, delta) => {
                setFaColPreset('custom');
                setVisibleFaCols(prev => {
                    const at = prev.indexOf(key);
                    const to = at + delta;
                    if (at < 0 || to < 0 || to >= prev.length) return prev;
                    const next = [...prev];
                    [next[to], next[at]] = [next[at], next[to]];
                    return next;
                });
            };
            const _faColRemove = (key) => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.filter(c => c !== key)); };
            const _faColAdd = (key) => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.includes(key) ? prev : [...prev, key]); };
            const _faColGroups = [];
            Object.entries(faColumns).filter(([key]) => isPro || !FA_PRO_COLS.has(key)).forEach(([key, col]) => {
                if (visibleFaCols.includes(key)) return;
                let g = _faColGroups.find(x => x.group === col.group);
                if (!g) { g = { group: col.group, cols: [] }; _faColGroups.push(g); }
                g.cols.push([key, col]);
            });
            const _faColSheetEl = React.createElement(window.WR.FilterSheet, {
                open: !!showFaColPicker,
                onClose: () => setShowFaColPicker(false),
                title: 'Market columns',
                sections: [
                    { label: 'Active (' + shownFaCols.length + ')', node: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, lineHeight: 1.5 }}>
                                The first three stat-capable picks ride each market card; the full set applies to the desktop table.
                            </div>
                            {shownFaCols.map((key, i) => {
                                const col = faColumns[key]; if (!col) return null;
                                return (
                                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 44px 44px 44px', gap: '3px', alignItems: 'center', minHeight: '44px', padding: '0 2px 0 8px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                                        <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{i + 1}</span>
                                        <span title={col.label} style={{ color: 'var(--white, #f5f5f5)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                                        <button disabled={i === 0} onClick={() => _faColMove(key, -1)} title="Move up" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: i === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: i === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: i === 0 ? 'default' : 'pointer' }}>{'▲'}</button>
                                        <button disabled={i === shownFaCols.length - 1} onClick={() => _faColMove(key, 1)} title="Move down" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: i === shownFaCols.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: i === shownFaCols.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: i === shownFaCols.length - 1 ? 'default' : 'pointer' }}>{'▼'}</button>
                                        <button onClick={() => _faColRemove(key)} title="Remove" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'×'}</button>
                                    </div>
                                );
                            })}
                            {!shownFaCols.length && (
                                <div style={{ padding: '12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                            )}
                        </div>
                    ) },
                    { label: 'Available', node: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {!_faColGroups.length && (
                                <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>All columns are active.</div>
                            )}
                            {_faColGroups.map(({ group, cols }) => (
                                <div key={group}>
                                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '6px' }}>{group}</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                        {cols.map(([key, col]) => (
                                            <button key={key} onClick={() => _faColAdd(key)} title={'Add ' + col.label} style={{ minHeight: '44px', padding: '7px 12px', fontSize: '0.74rem', fontFamily: 'var(--font-body)', background: 'var(--ov-1, rgba(255,255,255,0.018))', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ {col.shortLabel || col.label}</button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) },
                ],
                footer: (
                    <React.Fragment>
                        <button onClick={() => { setFaColPreset('custom'); setVisibleFaCols(faTierCols(Object.keys(faColumns))); }} style={{ ..._faChipBtn(!_faColGroups.length), flex: 1 }}>All fields</button>
                        <button onClick={() => { setVisibleFaCols(faTierCols(FA_COLUMN_PRESETS.default)); setFaColPreset('default'); }} style={{ ..._faChipBtn(false), flex: 1 }}>Reset</button>
                        <button onClick={() => setShowFaColPicker(false)} style={{ ..._faChipBtn(true), flex: 1 }}>Done</button>
                    </React.Fragment>
                ),
            });

            // ── P1 card list — market rows + Pro streaming/drop groups.
            // Phone shows a tighter top slice (owner ask: fewer by default) —
            // desktop's sortedPlayers cap is untouched; sort/search/filters
            // surface anyone below the cut.
            const _faPhoneMkt = sortedPlayers.slice(0, faPhoneLimit);
            const _faMetricSlots = x => {
                if (!metricPreference || !window.WR?.PlayerMetrics?.slots) return _faSlotKeys.map(k => ({ key: k, ..._faSlotFor(k, x) }));
                return window.WR.PlayerMetrics.slots(metricPreference.selected, mobileMarketValues(x));
            };
            const _faHeaderColumns = (metricPreference ? window.WR.PlayerMetrics.slots(metricPreference.selected, {}) : _faSlotKeys.map(key => ({ key, label: faColumns[key]?.shortLabel || key }))).map(slot => ({
                key: metricPreference ? slot.key : faColumns[slot.key]?.sortKey || slot.key,
                label: slot.label,
                title: metricPreference ? window.WR.PlayerMetrics.definitions.find(metric => metric.key === slot.key)?.name || slot.label : faColumns[slot.key]?.label || slot.label,
                sortable: metricPreference ? true : !!faColumns[slot.key]?.sortKey,
            }));
            const _faMarketHeader = window.WR?.PlayerMetrics?.SortHeader
                ? <window.WR.PlayerMetrics.SortHeader className="mc-market-heading" columns={_faHeaderColumns} sort={faSort} onSort={handleFaSort} nameLabel="Player" style={{ gridTemplateColumns: 'minmax(105px,1fr) repeat(' + _faHeaderColumns.length + ',minmax(33px,.44fr))' }} />
                : <div className="mc-market-heading" style={{ gridTemplateColumns: 'minmax(105px,1fr) repeat(' + _faHeaderColumns.length + ',minmax(33px,.44fr))' }}><span>PLAYER</span>{_faHeaderColumns.map(column => <span key={column.key}>{column.label}</span>)}</div>;
            const _faMktRows = _faPhoneMkt.map(x => <button key={x.pid} type="button" className="mc-market-row" onClick={() => openFaPlayer(x.pid)} aria-label={playerName(x.p, x.pid) + ': player details'} style={{ gridTemplateColumns: 'minmax(105px,1fr) repeat(' + _faMetricSlots(x).length + ',minmax(33px,.44fr))' }}><span className="mc-market-name"><strong>{playerName(x.p, x.pid)}</strong><small>{x.pos} · {x.p.team || 'FA'}{x.p.injury_status ? ' · ' + x.p.injury_status : ''}</small></span>{_faMetricSlots(x).map(slot => <span key={slot.key} className="mc-market-stat"><b>{slot.value}</b></span>)}</button>);
            const _faMktRowNodes = _faMktRows.length ? _faMktRows : [
                <div key="fa-mkt-empty" style={{ padding: '14px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 'var(--card-radius, 10px)', color: 'var(--silver)', opacity: 0.7, fontSize: '0.78rem' }}>No available players match this view.</div>
            ];
            const _faStreamRows = streaming.slice(0, 5).map(o => React.createElement(window.WR.AssetRow, {
                key: 'stream-' + o.fa.pid,
                pos: o.pos,
                pid: o.fa.pid,
                name: (playersData[o.fa.pid] || {}).full_name || o.fa.pid,
                tag: 'over ' + o.worstName + ' (' + o.worstProj.toFixed(1) + ')',
                slots: [{ label: 'WK', value: o.fa.proj.toFixed(1) }, { label: 'EDGE', value: '+' + o.delta.toFixed(1), tone: 'good' }],
                onClick: () => openFaPlayer(o.fa.pid),
                title: 'Open player card',
            }));
            const _faDropRows = isPro ? recentDrops.map(d => React.createElement(window.WR.AssetRow, {
                key: 'drop-' + d.pid,
                pos: d.pos,
                pid: d.pid,
                name: d.name,
                tag: 'Dropped W' + d.week + ' · back on the wire',
                slots: [{ label: 'VAL', value: d.dhq.toLocaleString() }],
                onClick: () => openFaPlayer(d.pid),
                title: 'Open player card',
            })) : [];
            const _faGroups = [];
            if (_faStreamRows.length) _faGroups.push({ label: 'Streaming', sub: 'improves your best projected lineup', rows: _faStreamRows });
            _faGroups.push({ label: 'Market', sub: _faPhoneMkt.length + ' of ' + sortedPlayers.length + ' matching players', rows: _faMktRowNodes });
            if (_faDropRows.length) _faGroups.push({ label: 'Drop alerts', sub: 'fresh drops worth a claim', rows: _faDropRows });

            return (
                <React.Fragment>
                    <div className="fa-page wr-fade-in">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {renderMissionTabs()}
                            {faSection === 'claims' ? renderMissionClaims() : faSection === 'coverage' ? renderMissionCoverage() : <>
                                {renderMissionWaiverBoard()}{renderCrazePanel()}
                                <div className="mc-market-summary"><strong>Available players <span>{sortedPlayers.length}</span></strong>{hasFAAB && <span>{_faBalance == null ? 'Budget unknown' : '$' + _faBalance + ' left'}</span>}</div>
                                {_faToolsEl}{_faPanelEl}
                                <div className="mc-market-table" aria-label="Available player comparison">{_faMarketHeader}{_faMktRowNodes}</div>
                                {faPhoneLimit < sortedPlayers.length && <button type="button" className="fa-mobile-more" onClick={() => setFaPhoneLimit(n => n + 25)}>Show {Math.min(25, sortedPlayers.length - faPhoneLimit)} more players</button>}
                            </>}
                        </div>
                    </div>
                    {/* The column customizer stays a drill-down sheet, rendered
                        OUTSIDE .fa-page: its wr-fade-in leaves a lingering
                        transform:translateY(0), which would make this position:fixed
                        sheet resolve against .fa-page (down the page) instead of the
                        viewport. As a sibling it escapes the transformed ancestor and
                        overlays correctly. (Mirrors the .tc-trade-root transform:none
                        fix in index.html.) */}
                    {_faColSheetEl}
                </React.Fragment>
            );
        }

        // ── ANALYST VIEW: full market terminal ──
        return (
            <div className="fa-page wr-fade-in">

                {/* ── PHONE TIER (≤767) — iPhone plan Phase 2 item 14 (FA leftovers).
                    The market explorer already scrolls horizontally (overflowX +
                    minWidth); this pins the Player column while the 15+ data columns
                    scroll under it (D6 pattern 1, proven on My Roster). Class hooks
                    only — ≥768 is pixel-identical. Sticky cells need SOLID
                    backgrounds: hexes are the composites of the semi-transparent
                    gold tints over the --black (#121217) table card. */}
                <style>{`
                    @media (max-width: 767px) {
                        .fa-mkt-head > :nth-child(2), .fa-mkt-row > :nth-child(2) {
                            position: sticky; left: 0; z-index: 1;
                            background: var(--black, #121217);
                            box-shadow: 6px 0 8px -6px rgba(0,0,0,0.6);
                        }
                        .fa-mkt-head > :nth-child(2) { background: #1e1b19; }
                        .fa-mkt-row.is-sel > :nth-child(2) { background: #221f1a; }
                    }
                `}</style>

                {renderMissionTabs()}
                {faSection === 'market' && <>{renderMissionWaiverBoard()}{renderCrazePanel()}</>}
                {faSection === 'claims' && renderMissionClaims()}
                {faSection === 'coverage' && renderMissionCoverage()}

                <section className="fa-market-shell" hidden={faSection !== 'market'}>
                <div className="fa-market-head">
                    <div>
                        <span>Market Explorer</span>
                        <p>{sortedPlayers.length} shown from {availablePlayers.length} available players · {marketSeason} season</p>
                    </div>
                    <div className="fa-market-search">
                        <input aria-label="Search available players" value={faSearch} onChange={e => setFaSearch(e.target.value)} placeholder="Search player, team, college..." />
                    </div>
                    {hasFAAB && <div className="fa-market-budget" aria-label="Remaining FAAB budget"><span>FAAB remaining</span><strong>${remaining.toLocaleString()} <small>/ ${budget.toLocaleString()}</small></strong><p>Suggested bids use this balance</p></div>}
                </div>

                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">POS</span>
                    <div className="wr-module-nav">
                    {['', ...leaguePositions].map(pos =>
                        <button key={pos} className={faFilter === pos ? 'is-active' : ''} onClick={() => setFaFilter(pos)} title={pos && streamPosSet.has(pos) ? 'Streaming upgrade available at ' + pos + ' this week' : undefined}>{pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'All'}{pos && streamPosSet.has(pos) ? <span style={{ color: 'var(--gold)', marginLeft: '3px', fontWeight: 800 }}>•</span> : null}</button>
                    )}
                    </div>
                    <span className="wr-module-toolbar-label">Type</span>
                    <div className="wr-module-nav">
                    <button className={rookieOnly ? 'is-active' : ''} onClick={() => { const next = !rookieOnly; setRookieOnly(next); if (!next) { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} title="Show only rookies / UDFAs">Rookies</button>
                    </div>
                </div>

                {/* Rookie/UDFA drill-down — same filter pieces as the Draft Room big board */}
                {rookieOnly && (() => {
                    // WR.Select (shared filter control) replaces the local
                    // rkSelectStyle native dropdowns — the pill carries its own
                    // label, so the separate toolbar-label spans go too.
                    const WrSelect = window.WR && window.WR.Select;
                    return (
                        <div className="fa-market-toolbar wr-module-toolbar">
                            {WrSelect && React.createElement(WrSelect, {
                                label: 'Team',
                                value: rookieTeamFilter,
                                placeholder: 'All',
                                active: !!rookieTeamFilter,
                                title: 'Filter by NFL team',
                                onChange: v => setRookieTeamFilter(v),
                                options: [{ value: '', label: 'All teams' }].concat(rookieFilterOptions.teams.map(t => ({ value: t, label: t }))),
                            })}
                            {WrSelect && React.createElement(WrSelect, {
                                label: 'College',
                                value: rookieCollegeFilter,
                                placeholder: 'All',
                                active: !!rookieCollegeFilter,
                                title: 'Filter by college',
                                onChange: v => setRookieCollegeFilter(v),
                                options: [{ value: '', label: 'All colleges' }].concat(rookieFilterOptions.colleges.map(c => ({ value: c, label: c }))),
                            })}
                            <span className="wr-module-toolbar-label">Slot</span>
                            <div className="wr-module-nav">
                                {[{ k: '', label: 'All' }, { k: '1', label: 'R1' }, { k: '2', label: 'R2' }, { k: '3', label: 'R3' }, { k: '4', label: 'R4' }, { k: '5', label: 'R5' }, { k: '6', label: 'R6' }, { k: '7', label: 'R7' }, { k: 'UDFA', label: 'UDFA' }].map(opt => (
                                    <button key={opt.k || 'all'} className={rookieSlotFilter === opt.k ? 'is-active' : ''} onClick={() => setRookieSlotFilter(rookieSlotFilter === opt.k ? '' : opt.k)} title={opt.k === 'UDFA' ? 'Undrafted free agents' : opt.k ? 'NFL draft round ' + opt.k : 'Any draft slot'}>{opt.label}</button>
                                ))}
                            </div>
                            {(rookieTeamFilter || rookieCollegeFilter || rookieSlotFilter) && (
                                <button type="button" onClick={() => { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); }} style={{ marginLeft: 'auto', padding: '3px 10px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius, 10px)', cursor: 'pointer' }}>Clear</button>
                            )}
                        </div>
                    );
                })()}

                {/* Phase 6 deferred: presets + column picker + SavedViewBar */}
                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">View</span>
                    <div className="wr-module-nav">
                    {Object.entries(FA_COLUMN_PRESETS).map(([key, cols]) => (
                        <button key={key} className={faActivePresetKey === key ? 'is-active' : ''} onClick={() => { setVisibleFaCols(faTierCols(cols)); setFaColPreset(key); setRookieOnly(key === 'rookie'); if (key !== 'rookie') { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }}>{key}</button>
                    ))}
                    <button className={showFaColPicker ? 'is-active' : ''} onClick={() => setShowFaColPicker(!showFaColPicker)}>Columns</button>
                    </div>
                    {/* Rolling PPG window selector — shared with My Roster */}
                    <span className="wr-module-toolbar-label">PPG</span>
                    <div className="wr-module-nav">
                    {[{k:'season',l:'Season'},{k:'l5',l:'L5'},{k:'l3',l:'L3'}].map(opt => (
                        <button key={opt.k} className={ppgWindow === opt.k ? 'is-active' : ''} onClick={() => setPpgWindow(opt.k)} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games'}>{opt.l}</button>
                    ))}
                    </div>

                    {window.WR?.SavedViews?.SavedViewBar && (
                        <div style={{ marginLeft: 'auto' }}>
                            {React.createElement(window.WR.SavedViews.SavedViewBar, {
                                surface: 'free_agency',
                                leagueId: currentLeague?.id || currentLeague?.league_id,
                                currentState: { columns: visibleFaCols, sort: faSort, filters: { faFilter, faSearch } },
                                onApply: (v) => {
                                    if (Array.isArray(v.columns) && v.columns.length) { setVisibleFaCols(faTierCols(v.columns.filter(k => FA_COLUMNS[k]))); setFaColPreset('custom'); }
                                    if (v.sort && v.sort.key) setFaSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                                    if (v.filters && typeof v.filters.faFilter === 'string') setFaFilter(v.filters.faFilter);
                                    if (v.filters && typeof v.filters.faSearch === 'string') setFaSearch(v.filters.faSearch);
                                },
                            })}
                        </div>
                    )}
                </div>

                {showFaColPicker && (
                    <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px', marginBottom: '8px' }}>
                        {/* Active columns — reorderable */}
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Active order (click ◀ ▶ to reorder)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                            {visibleFaCols.map((key, i) => {
                                const col = faColumns[key]; if (!col) return null;
                                const moveLeft = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === 0) return prev; const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); };
                                const moveRight = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === prev.length - 1) return prev; const next = [...prev]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; return next; }); };
                                const remove = () => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.filter(c => c !== key)); };
                                return (
                                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px 4px 2px 8px', borderRadius: 'var(--card-radius-xs, 5px)', fontSize: 'var(--text-label, 0.75rem)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', color: 'var(--gold)' }}>
                                        <span style={{ marginRight: '4px' }}>{col.shortLabel}</span>
                                        {/* .fa-colpick-btn: 44px touch bump at ≤767 (index.html phone CSS); 32px glyph-pad elsewhere */}
                                        <button className="fa-colpick-btn" onClick={moveLeft} disabled={i === 0} title="Move left" style={{ padding: '0 3px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: i === 0 ? 'var(--acc-line1, rgba(212,175,55,0.25))' : 'var(--gold)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>◀</button>
                                        <button className="fa-colpick-btn" onClick={moveRight} disabled={i === visibleFaCols.length - 1} title="Move right" style={{ padding: '0 3px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: i === visibleFaCols.length - 1 ? 'var(--acc-line1, rgba(212,175,55,0.25))' : 'var(--gold)', cursor: i === visibleFaCols.length - 1 ? 'default' : 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>▶</button>
                                        <button className="fa-colpick-btn" onClick={remove} title="Remove" style={{ padding: '0 4px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--bad)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>×</button>
                                    </span>
                                );
                            })}
                        </div>

                        {/* All available columns — tick to add */}
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Available columns</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '4px' }}>
                            {Object.entries(faColumns).filter(([key]) => isPro || !FA_PRO_COLS.has(key)).map(([key, col]) => {
                                const active = visibleFaCols.includes(key);
                                return (
                                    <label key={key} style={{
                                        display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
                                        borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)',
                                        background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'transparent',
                                        color: active ? 'var(--gold)' : 'var(--silver)'
                                    }}>
                                        <input type="checkbox" checked={active} onChange={() => {
                                            setVisibleFaCols(prev => active ? prev.filter(c => c !== key) : [...prev, key]);
                                            setFaColPreset('custom');
                                        }} style={{ accentColor: 'var(--gold)' }} />
                                        {col.label}
                                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6, marginLeft: 'auto' }}>{col.group}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Streaming upgrades — a free agent out-projects your weakest starter at a position this week */}
                {streaming.length ? (
                    <div style={{ margin: '0 0 10px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 12px' }}>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em', marginBottom: '6px' }}>⚡ STREAMING UPGRADES THIS WEEK</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {streaming.slice(0, 5).map((o, i) => (
                                <div key={i} role="button" tabIndex={0} onClick={() => openFaPlayer(o.fa.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaPlayer(o.fa.pid); } }} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: 'var(--text-label, 0.8rem)', cursor: 'pointer', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, color: 'var(--gold)', minWidth: '34px' }}>{window.App?.posLabel?.(o.pos) || o.pos}</span>
                                    <span style={{ color: 'var(--text, #e8e8ea)', fontWeight: 600 }}>{(playersData[o.fa.pid] || {}).full_name || o.fa.pid}</span>
                                    <span style={{ color: 'var(--good)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.fa.proj.toFixed(1)}</span>
                                    <span style={{ color: 'var(--silver)' }}>projects <span style={{ color: 'var(--good)', fontWeight: 700 }}>+{o.delta.toFixed(1)}</span> over your {o.worstName} ({o.worstProj.toFixed(1)})</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                <p className="fa-market-data-note">PPG and usage use {marketSeason} stats; prior-season baselines are labeled. {marketIsCurrent ? `Projections are for Week ${marketWeek}.` : 'Weekly projections are only available for the current season.'} Usage varies by position.</p>
                {/* Dynamic grid — photo + Player + configured columns */}
                {(() => {
                    // Render-time tier filter — the normalize effect fixes state a
                    // beat later, but the first paint must never show a Pro column.
                    const shownFaCols = faTierCols(visibleFaCols);
                    const gridTemplate = '32px 190px ' + shownFaCols.map(k => `minmax(${faColumns[k]?.width || '44px'}, 1fr)`).join(' ');
                    const tableMinWidth = 32 + 190 + 24 + (shownFaCols.length + 1) * 8 + shownFaCols.reduce((sum, k) => sum + (parseInt(faColumns[k]?.width || '44', 10) || 44), 0);
                    return <div className="fa-market-table" role="region" aria-label="Available player data; scroll for more columns" tabIndex={0} style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', overflowX: 'auto' }}>
                        {/* Header */}
                        <div className="fa-mkt-head" style={{ display: 'grid', gridTemplateColumns: gridTemplate, gap: '8px', padding: '8px 12px', minWidth: tableMinWidth + 'px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>
                            <span className="fa-market-avatar"></span>
                            {window.WR?.PlayerMetrics?.SortButton ? <window.WR.PlayerMetrics.SortButton columnKey="name" label="Player" title="Player name" sort={faSort} onSort={handleFaSort} className="fa-market-name fa-market-sort" style={faHeaderStyle} /> : <button type="button" className="fa-market-name fa-market-sort" style={faHeaderStyle} aria-pressed={faSort.key === 'name'} onClick={() => handleFaSort('name')}>Player{faSortIndicator('name')}</button>}
                            {shownFaCols.map(k => {
                                const col = faColumns[k]; if (!col) return null;
                                const clickable = !!col.sortKey;
                                if (window.WR?.PlayerMetrics?.SortButton) return <window.WR.PlayerMetrics.SortButton key={k} columnKey={col.sortKey || k} label={col.shortLabel} title={col.label} sort={faSort} onSort={handleFaSort} className={`fa-market-sort fa-market-col-${k}`} style={{ ...faHeaderStyle, cursor: clickable ? 'pointer' : 'default' }} disabled={!clickable} />;
                                return <button type="button" className={`fa-market-sort fa-market-col-${k}`} key={k} style={{ ...faHeaderStyle, cursor: clickable ? 'pointer' : 'default' }} title={col.label} disabled={!clickable}
                                    onClick={() => clickable && handleFaSort(col.sortKey)}>
                                    {col.shortLabel}{clickable ? faSortIndicator(col.sortKey) : ''}
                                </button>;
                            })}
                        </div>
                        {/* Body */}
                        <div style={{ maxHeight: 'none', overflow: 'visible', minWidth: tableMinWidth + 'px' }}>
                            {sortedPlayers.map(({ pid, p, dhq, proj }) => {
                                const pos = normPos(p.position) || p.position;
                                const statSource = marketStatSource(pid);
                                const ppgRead = marketPpgRead(pid, pos);
                                const ppg = ppgRead.value;
                                const faab = faabSuggest(dhq, pos, p.age);
		                                const peakYrs = peakYearsFor(pos, p.age);
		                                const valueYrs = valueYearsFor(pos, p.age);
		                                const peakLabel = peakYrs >= 4 ? 'Rising' : peakYrs >= 1 ? 'Prime' : valueYrs >= 1 ? 'Vet' : 'Post';
		                                const peakCol = peakYrs >= 4 ? 'var(--good)' : peakYrs >= 1 ? 'var(--gold)' : valueYrs >= 1 ? 'var(--warn)' : 'var(--bad)';
                                // Rookie/prospect fields for this row (null for vets) — resolved once.
                                const rf = window.App?.RookieFields?.fields?.(prospectFor(p)) || null;
                                const rkDash = <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>{'—'}</span>;
                                const renderCell = (k) => {
                                    switch (k) {
                                        case 'pos':        return <span style={{ fontSize: '0.78rem', fontWeight: 700, color: posColors[pos] || 'var(--silver)' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>;
                                        case 'team':       return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontWeight: 600 }}>{p.team || 'FA'}<small style={{ display: 'block', color: 'var(--gold)' }}>{window.App?.NFLByes?.label(p, window.App.NFLByes.seasonFor(currentLeague)) || 'Bye —'}</small></span>;
                                        case 'age':        return <span style={{ fontSize: '0.78rem', color: 'var(--silver)' }}>{p.age || '\u2014'}</span>;
                                        // DHQ reads white here \u2014 no tier colors in the market table (owner ask 2026-07-12)
                                        case 'dhq':        return <span style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: 'var(--white)' }}>{dhq > 0 ? dhq.toLocaleString() : '\u2014'}</span>;
                                        case 'ppg': return <span className="fa-market-number"><strong>{ppg == null ? '—' : ppg.toFixed(1)}</strong>{ppgRead.note && <small>{ppgRead.note}</small>}</span>;
                                        case 'proj': return <span className="fa-market-number" title={marketIsCurrent ? `Week ${marketWeek} projected points under your league scoring` : 'Weekly forecasts are only available for the current season'}><strong>{proj == null ? '—' : proj.toFixed(1)}</strong></span>;
                                        case 'peakYr':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: peakCol, fontWeight: 600 }}>{peakLabel}</span>;
                                        case 'yrsExp':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.years_exp != null ? p.years_exp : '\u2014'}</span>;
                                        case 'college':    return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.college || '\u2014'}</span>;
                                        case 'height':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.height ? Math.floor(p.height/12) + "'" + (p.height%12) + '"' : '\u2014'}</span>;
                                        case 'weight':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.weight || '\u2014'}</span>;
                                        case 'depthChart': return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: p.depth_chart_order != null ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{p.depth_chart_order != null ? pos + (p.depth_chart_order + 1) : '\u2014'}</span>;
                                        case 'injury':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: p.injury_status ? 'var(--bad)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{p.injury_status || '—'}</span>;
                                        case 'faab': return <span className="fa-market-number fa-market-bid"><strong>{faab ? `$${faab.lo}–${faab.hi}` : '—'}</strong>{faab && remaining > 0 && <small>{(faab.lo / remaining * 100).toFixed(1)}–{(faab.hi / remaining * 100).toFixed(1)}% of balance</small>}</span>;
                                        case 'sig1':
                                        case 'sig2': {
                                            const read = window.App?.FAMarketData?.signature(pos, k === 'sig1' ? 0 : 1, statSource.raw);
                                            if (!read) return rkDash;
                                            return <span className="fa-market-number" title={`${read.label} · ${statSource.year}`}><strong>{read.text}</strong><small>{read.short}{statSource.prior && read.value != null ? ` · ${statSource.year}` : ''}</small></span>;
                                        }
                                        case 'rkSlot': {
                                            // Prospect slot wins; vets show R<rd> #<overall> / UDFA from the static dataset.
                                            const dp = faDraftCap(pid);
                                            const slotTxt = rf?.draftSlot || faDraftSlotTxt(pid);
                                            const rd1 = rf ? rf.draftRound : dp?.round;
                                            return slotTxt ? <span title={dp && dp.round > 0 ? dp.year + ' draft — round ' + dp.round + ', pick ' + dp.overall + ' overall' : undefined} style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: rd1 === 1 ? 'var(--good)' : rd1 && rd1 <= 3 ? 'var(--gold)' : 'var(--silver)' }}>{slotTxt}</span> : rkDash;
                                        }
                                        case 'rkTeam': {
                                            const tm = rf?.nflTeam || faDraftCap(pid)?.team;
                                            return tm ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontWeight: 600 }}>{tm}</span> : rkDash;
                                        }
                                        case 'rkRank':     return rf && rf.consensusRank != null ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{rf.consensusRank}</span> : rkDash;
                                        case 'rkTier':     return rf && rf.tierLabel ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)' }}>{rf.tierLabel}</span> : rkDash;
                                        case 'rkProfile': {
                                            const prof = rf?.profile || [p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : null, p.weight ? p.weight + ' lb' : null].filter(Boolean).join(' · ');
                                            return prof ? <span title={prof} style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prof}</span> : rkDash;
                                        }
                                        default:           return <span>—</span>;
                                    }
                                };
                                return <div key={pid} role="button" tabIndex={0} title="Open player card" onClick={() => {
                                    openFaPlayer(pid);
                                }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaPlayer(pid); } }} className={'fa-mkt-row' + (faSelectedPid === pid ? ' is-sel' : '')} style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: faSelectedPid === pid ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent', gap: '8px', padding: '7px 12px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', cursor: 'pointer', alignItems: 'center', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    <div className={'fa-market-avatar wr-ring wr-ring-' + pos} style={{ width: '26px', height: '26px', borderRadius: '50%', overflow: 'hidden', background: 'var(--acc-fill3, rgba(212,175,55,0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <img src={'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg'} alt="" style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:var(--text-label, 0.75rem);font-weight:700;color:var(--gold)'; s.textContent=((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase(); e.target.after(s); }} />
                                    </div>
                                    <div className="fa-market-name" style={{ overflow: 'hidden' }}>
                                        <div title={playerName(p, pid)} style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playerName(p, pid)}</div>
                                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55 }}>{p.team || 'FA'}{p.injury_status ? ' · ' : ''}{p.injury_status ? <span style={{ color: 'var(--bad)' }}>{p.injury_status}</span> : ''}</div>
                                    </div>
                                    {shownFaCols.map(k => <span key={k} className={`fa-market-cell fa-market-col-${k}`}>{renderCell(k)}</span>)}
                                </div>;
                            })}
                        </div>
                    </div>;
                })()}
                </section>

                {/* ── RIGHT: PLAYER DETAIL PANEL ── */}
                {/* .fa-detail-drawer/.fa-detail-close: phone tier (index.html ≤767 CSS)
                    pads the drawer for the notch/home indicator (top:0/bottom:0 fixed
                    panel draws under both in installed-PWA) — unstyled ≥768. */}
                {faSelectedPid && selPlayer && <div className="fa-detail-drawer" style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(380px, 92vw)', background: 'linear-gradient(135deg, var(--off-black), var(--charcoal))', borderLeft: '2px solid var(--gold)', zIndex: 200, overflowY: 'auto', padding: '20px', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)' }}>
                    {/* Close */}
                    <button className="fa-detail-close" onClick={() => setFaSelectedPid(null)} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', color: 'var(--silver)', width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>

                    {/* Photo + Name */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: 'var(--card-radius-lg, 14px)', overflow: 'hidden', background: 'var(--acc-fill2, rgba(212,175,55,0.1))', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src={'https://sleepercdn.com/content/nfl/players/' + faSelectedPid + '.jpg'} style={{ width: '64px', height: '64px', objectFit: 'cover' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:20px;font-weight:700;color:var(--gold)'; s.textContent=selInitials; e.target.after(s); }} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--white)', letterSpacing: '0.02em' }}>{playerName(selPlayer, faSelectedPid)}</div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>{selPos} · {selPlayer.team || 'FA'} · {window.App?.NFLByes?.label(selPlayer, window.App.NFLByes.seasonFor(currentLeague)) || 'Bye —'} · Age {selPlayer.age || '?'} · {selPlayer.years_exp ?? 0}yr exp{selPlayer.college ? ' · ' + selPlayer.college : ''}</div>
                        </div>
                    </div>

                    {/* Key Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                        {[
                            { val: selDhq > 0 ? selDhq.toLocaleString() : '\u2014', label: valueKpiLabel, col: selDhq >= 7000 ? 'var(--good)' : selDhq >= 4000 ? 'var(--k-3498db, #3498db)' : selDhq >= 2000 ? 'var(--silver)' : 'var(--silver)' },
                            { val: selPpg || '\u2014', label: 'PPG', col: selPpg >= 10 ? 'var(--good)' : selPpg >= 5 ? 'var(--silver)' : 'var(--silver)' },
	                            { val: selPeakYrs > 0 ? selPeakYrs + 'yr' : selValueYrs + 'yr', label: selPeakYrs > 0 ? 'PEAK LEFT' : 'VALUE LEFT', col: selPeakYrs >= 4 ? 'var(--good)' : selPeakYrs >= 1 ? 'var(--gold)' : selValueYrs >= 1 ? 'var(--warn)' : 'var(--bad)' },
                        ].map((s, i) => <div key={i} style={{ textAlign: 'center', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 6px', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.3rem', fontWeight: 600, color: s.col }}>{s.val}</div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                        </div>)}
                    </div>

                    {/* FAAB Recommendation */}
                    {selFaab && <div style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: 'var(--card-radius, 10px)', padding: '14px', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>FAAB Recommendation</div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)' }}>{'$' + selFaab.lo + ' \u2013 $' + selFaab.hi}</div>
                        <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginTop: '4px' }}>Suggested: <strong style={{ color: 'var(--white)' }}>{'$' + selFaab.sug}</strong> of ${remaining} remaining</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: selFaab.confCol }} />
                            <span style={{ fontSize: 'var(--text-body, 1rem)', color: selFaab.confCol, fontWeight: 600 }}>{selFaab.conf}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6 }}>{selFaab.competitors} other team{selFaab.competitors !== 1 ? 's' : ''} need {selPos}</span>
                        </div>
                    </div>}

                    {/* Roster Fit — a fills-your-need read, Pro (raw stats below stay free) */}
                    {isPro && assess && (() => {
                        const need = assess.needs?.find(n => n.pos === selPos);
                        const strength = assess.strengths?.includes(selPos);
                        return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 'var(--card-radius, 10px)', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>ROSTER FIT</div>
                            {need && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--k-2ecc71, #2ecc71)', fontWeight: 600, marginBottom: '4px' }}>Fills {selPos} {need.urgency}</div>}
                            {strength && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.7, marginBottom: '4px' }}>You already have {selPos} surplus — stash only</div>}
                            {!need && !strength && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '4px' }}>Depth add at {selPos}</div>}
                        </div>;
                    })()}

                    {/* Season Stats */}
                    {selStats.gp > 0 && <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>SEASON STATS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {[
                                ['Games', selStats.gp],
                                ['Total Pts', selStats.pts_half_ppr ? Math.round(selStats.pts_half_ppr) : Math.round(calcRawPts(selStats))],
                                ['PPG', selPpg],
                                selStats.pass_yd ? ['Pass Yds', Math.round(selStats.pass_yd).toLocaleString()] : selStats.rush_yd ? ['Rush Yds', Math.round(selStats.rush_yd).toLocaleString()] : selStats.rec ? ['Receptions', selStats.rec] : null,
                                selStats.pass_td ? ['Pass TD', selStats.pass_td] : selStats.rush_td ? ['Rush TD', selStats.rush_td] : selStats.rec_td ? ['Rec TD', selStats.rec_td] : null,
                                selStats.rec_yd ? ['Rec Yds', Math.round(selStats.rec_yd).toLocaleString()] : null,
                            ].filter(Boolean).map(([label, val], i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: 'var(--card-radius-xs, 5px)' }}>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>{label}</span>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', fontWeight: 600 }}>{val}</span>
                            </div>)}
                        </div>
                    </div>}

                    {/* Usage — beyond fantasy points. Position-scoped rows from
                        window.App.StatCatalog, shown per-game where a per-game
                        read (targets, RZ touches) is more comparable than a
                        season total. */}
                    {selStats.gp > 0 && window.App?.StatCatalog && (() => {
                        const SC = window.App.StatCatalog;
                        const rows = SC.getStatsForPosition(selPos)
                            .filter(s => ['volume', 'efficiency', 'redzone', 'snaps'].includes(s.group) && !['passAtt','passCmp','rushAtt','targets','recYd','passYd','rushYd','recTd','passTd','rushTd','ints','fumLost'].includes(s.key))
                            .map(s => ({ s, v: SC.computeStat(s.key, selStats) }))
                            .filter(r => r.v != null);
                        if (!rows.length) return null;
                        return <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>USAGE</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                {rows.map(({ s, v }) => <div key={s.key} title={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: 'var(--card-radius-xs, 5px)' }}>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>{s.short}</span>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', fontWeight: 600 }}>{SC.formatStat(v, s.format)}</span>
                                </div>)}
                            </div>
                        </div>;
                    })()}

                    {/* Physical */}
                    {(selPlayer.height || selPlayer.weight) && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '16px' }}>
                        {selPlayer.height ? Math.floor(selPlayer.height/12) + "'" + (selPlayer.height%12) + '"' : ''}{selPlayer.weight ? ' · ' + selPlayer.weight + 'lbs' : ''}
                    </div>}

                    {/* Action */}
                    <button onClick={() => openFaPlayer(faSelectedPid)} style={{ width: '100%', padding: '10px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', letterSpacing: '0.06em', cursor: 'pointer' }}>FULL PLAYER CARD</button>
                </div>}
            </div>
        );
    }
