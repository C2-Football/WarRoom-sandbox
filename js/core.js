// ══════════════════════════════════════════════════════════════════
// core.js — Tier system, access control, fetch helpers
// Must load FIRST — all other modules depend on these.
// ══════════════════════════════════════════════════════════════════
//
// ── WINDOW GLOBAL CONTRACT ────────────────────────────────────────
// Cross-module communication goes through window.*. All contracts
// are listed here so load-order bugs and implicit deps are visible.
// DO NOT add new globals without updating this block.
//
// window.App  (object)
//   Set by:  ReconAI CDN (dhq-engine.js) before any War Room script loads.
//   Extended by: core.js (this file) with War Room constants.
//   Required: yes — app fails silently if missing.
//   Key fields:
//     .LI              — League Intel: { playerScores, playerMeta, playerTrends,
//                        playerPeaks, championships, dhqPickValueFn }
//     .LI_LOADED       — boolean; true once loadLeagueIntel() resolves
//     .loadLeagueIntel()— async fn; fetches and populates .LI
//     .calcOptimalPPG(roster, scoring) — from ReconAI
//     .peakWindows     — { QB:[lo,hi], RB:[lo,hi], … } — set by ReconAI CDN;
//                        core.js provides fallback default via PEAK_WINDOWS_DEFAULT
//     .POS_COLORS      — { QB:'var(--k-e74c3c, #e74c3c)', … }  (set by core.js)
//     .positionColor(pos) — shared position color without changing its display label
//     .idpPositionFamily(pos) — DL/LB/DB/IDP color family, or null
//     .POS_GROUPS      — { DB:[…], DL:[…], LB:[…] }  (set by core.js)
//     .PEAK_WINDOWS_DEFAULT — frozen copy of fallback values  (set by core.js)
//     .normPos(pos)    — canonical position normalizer  (set by core.js)
//     .calcRawPts(stats, scoring) — fantasy pts calculation  (set by core.js)
//     .calcPPG(stats, scoring)    — pts/game  (set by core.js)
//     .WR_KEYS         — localStorage key registry  (set by core.js)
//     .WrStorage       — localStorage/sessionStorage abstraction  (set by core.js)
//     .LeagueSkin      — league format/phase contract  (set by league-skin.js)
//
// window.S  (object)
//   Set by:  ReconAI CDN; mutated by league-detail.js inside useEffect.
//   Required: no — War Room degrades gracefully if absent.
//   Key fields (written by league-detail.js):
//     .season          — active year string e.g. '2025'
//     .playerStats     — { [pid]: { prevTotal, prevAvg, prevRawStats } }
//     ._timeContextTs  — Date.now() of last stats sync
//   Key fields (read from ReconAI):
//     .rosters         — all league rosters array
//     .myRosterId      — current user's roster_id
//     .leagues         — array of league objects (used for scoring_settings)
//     .tradedPicks     — traded picks array
//     .apiKey          — AI provider API key
//     .aiProvider      — 'gemini' | 'anthropic'
//
// window.OD  (object)
//   Set by:  ReconAI CDN (supabase-client.js).
//   Required: no — features degrade; cloud sync is disabled when absent.
//   Key methods (all async, all optional-chained before calling):
//     .loadDisplayName() → string | null
//     .saveDisplayName(name)
//     .loadTargets(leagueId) → { targets, startingBudget }
//     .loadPlayerTags(leagueId) → { [pid]: tag }
//     .checkUsersAccess(usernames[]) → Set<string>
//     .createGiftUser({ … })
//     .verifySupabasePassword(username, pw)
//     .updatePassword(username, pw)
//
// window.wrLog(context, err)
//   Set by:  core.js (this file).
//   Required: no — all callers guard with window.wrLog?.()
//   Purpose:  unified error logger; swap body here to route to a reporting svc.
//
// window._wrSelectPlayer(pid)
//   Set by:  league-detail.js (resets on every render of LeagueDetail).
//   Read by: components, ReconAI card, any cross-tab "open player" action.
//   Risk:    stale closure if held across renders — always call at event time.
//
// window._wrGmStrategy  (object)
//   Set by:  league-detail.js when GM strategy changes.
//   Read by: ReconAI AI context builder for personalised responses.
//
// window._playerTags  (object)
//   Set by:  league-detail.js after OD.loadPlayerTags resolves.
//   Read by: player card rendering throughout the app.
//
// window._liLoading  (boolean)
//   Set by:  league-detail.js to prevent duplicate loadLeagueIntel() calls.
//
// ── ReconAI bridge functions (set by CDN scripts, optional) ──────
// window.assessTeamFromGlobal(rosterId) → assessment | null
// window.assessAllTeamsFromGlobal()     → assessment[]
// window.dynastyValue(pid, age, pos, stats, scoring, peakWindows) → number
// window.getPlayerAction(pid)           → { label, color }
// window.Sleeper.fetchTrending(type, hours, limit) → async array
// window.DraftHistory.syncDraftDNA(leagueId)       → async Map
// window.DraftHistory.loadDraftDNA(leagueId)        → Map (sync, cached)
// ─────────────────────────────────────────────────────────────────
const { useState, useEffect, useMemo, useRef, useCallback } = React;

    // ─── Error Logger ──────────────────────────────────────────────────────────
    // Thin wrapper so failures show up in the console with a consistent prefix.
    // Replace the body here to route to an error reporting service in the future.
    function wrLog(context, err) {
        if (typeof console !== 'undefined') console.warn('[WarRoom]', context, err);
        window.DHQBugCapture?.captureError?.(
            err instanceof Error ? err : new Error(String(err || context || 'War Room log')),
            { source: 'wrLog', context: String(context || 'unknown') }
        );
    }
    window.wrLog = wrLog; // expose for cross-module access

    // ── Field Log Writer ───────────────────────────────────────────────────
    // Mirrors Scout's addFieldLogEntry format so both apps write to the same
    // localStorage key and Supabase table. Only logs deliberate user decisions.
    var _wrFlKey = 'scout_field_log_v1';
    function wrLogAction(icon, text, category, meta) {
        try {
            var entry = {
                id: 'wrfl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                icon: icon || '📋',
                text: text || '',
                category: category || 'note',
                ts: Date.now(),
                syncStatus: 'pending',
                source: 'warroom',
                players: meta?.players || [],
                context: meta?.context || null,
                leagueId: meta?.leagueId || window.S?.currentLeagueId || null,
                actionType: meta?.actionType || null,
            };
            // Append to localStorage
            var raw = localStorage.getItem(_wrFlKey);
            var log = raw ? JSON.parse(raw) : [];
            log.unshift(entry);
            // Keep max 200 entries locally
            if (log.length > 200) log.length = 200;
            localStorage.setItem(_wrFlKey, JSON.stringify(log));
            // Async sync to Supabase (fire-and-forget)
            if (window.OD?.saveFieldLogEntry) {
                window.OD.saveFieldLogEntry(entry).catch(function(e) { wrLog('wrLogAction.sync', e); });
            }
        } catch (e) { wrLog('wrLogAction', e); }
    }
    window.wrLogAction = wrLogAction;
    // ──────────────────────────────────────────────────────────────────────────

    // Compatibility helpers expose all product features. Server roles still govern
    // commissioner/admin actions; a feature capability is never an authorization.
    function getUserTier() { return 'pro'; }
    function canAccess() { return true; }
    function isPro() { return true; }
    function isCommissioner() { return false; }
    window.isPro = isPro;
    window.isCommissioner = isCommissioner;
    function useTaste() { return true; }
    function hasTasteLeft() { return true; }
    function canUseAI() { return true; } // authenticated server enforces shared usage limits
    function trackAIUse() {}

    async function handleLogout() {
        if (confirm('Are you sure you want to logout?')) {
            if (window.App?.AccountSession) return window.App.AccountSession.signOut();
            window.DHQAI?.clear();
            localStorage.removeItem((window.STORAGE_KEYS?.OD_AUTH    || 'od_auth_v1'));
            localStorage.removeItem((window.STORAGE_KEYS?.FW_SESSION || 'fw_session_v1'));
            localStorage.removeItem('od_session_v1');
            window.location.href = 'landing.html';
        }
    }


    // ===== SLEEPER API =====
    // ── Shared platform connectors (HIGH #10) ─────────────────────────────────
    // The following shared connectors are available via CDN (loaded in index.html):
    //   window.Sleeper — shared/sleeper-api.js  (preferred for new Sleeper features)
    //   window.ESPN    — shared/espn-api.js     (ESPN league support)
    //   window.MFL     — shared/mfl-api.js      (MFL league support)
    //   window.Yahoo   — shared/yahoo-api.js    (Yahoo league support)
    // War Room's local Sleeper fetchers below are kept as a stable fallback.
    // Multi-platform support for new features should use the shared connectors.
    // ─────────────────────────────────────────────────────────────────────────
    const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

    async function fetchJSON(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    async function fetchSleeperUser(username) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/user/${encodeURIComponent(username)}`);
    }

    async function fetchUserLeagues(userId, season) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${season}`);
    }

    async function fetchLeagueRosters(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`);
    }

    async function fetchLeagueUsers(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}/users`);
    }

    async function fetchLeagueInfo(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}`);
    }

    // IndexedDB key/value cache for payloads too big for Web Storage's ~5MB quota
    // (the Sleeper players map is ~15MB). Degrades to a no-op cache miss if IDB is
    // unavailable, so callers always fall back to a network refetch.
    const WrIDB = (() => {
        const DB_NAME = 'warroom', STORE = 'kv';
        let _dbPromise = null;
        function open() {
            if (_dbPromise) return _dbPromise;
            _dbPromise = new Promise((resolve, reject) => {
                if (typeof window.indexedDB === 'undefined') return reject(new Error('indexedDB unavailable'));
                const req = window.indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
            });
            _dbPromise.catch(() => { _dbPromise = null; }); // allow retry after a failed open
            return _dbPromise;
        }
        return {
            get(key) {
                return open().then(db => new Promise((resolve, reject) => {
                    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
                    req.onsuccess = () => resolve(req.result ?? null);
                    req.onerror = () => reject(req.error);
                }));
            },
            set(key, value) {
                return open().then(db => new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).put(value, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error || new Error('indexedDB write aborted'));
                }));
            },
            del(key) {
                return open().then(db => new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                }));
            },
        };
    })();

    let _wrPlayersCache = null;
    let _wrPlayersFetchedAt = 0, _wrDataGeneration = 0;
    let _wrPlayersInflight = null;
    const PLAYERS_TTL_MS = 15 * 60 * 1000; // Injury and team status are recommendation inputs.
    async function fetchAllPlayers() {
        if (_wrPlayersCache && Date.now() - _wrPlayersFetchedAt < PLAYERS_TTL_MS) return _wrPlayersCache;
        // Dedup concurrent callers (app hub + league detail both request on boot) so
        // the ~15MB /players/nfl payload is fetched at most once.
        if (_wrPlayersInflight) return _wrPlayersInflight;
        const generation = _wrDataGeneration;
        const request = _wrPlayersInflight = (async () => {
            // Persist the players map in IndexedDB, NOT sessionStorage: at ~15MB it far
            // exceeds the ~5MB Web Storage quota, so the old sessionStorage write always
            // threw QuotaExceededError and the cache never survived a reload — forcing a
            // full re-download on every load. IndexedDB has ample quota.
            try {
                const cached = generation === 0 ? await WrIDB.get(WR_KEYS.PLAYERS_CACHE) : null;
                if (cached && cached.data && Date.now() - cached.ts < PLAYERS_TTL_MS) {
                    if (generation !== _wrDataGeneration) return null;
                    _wrPlayersFetchedAt = cached.ts;
                    window.App.playerFreshness = { fetchedAt: cached.ts, providerAsOf: null };
                    _wrPlayersCache = cached.data;
                    return cached.data;
                }
            } catch (e) { wrLog('players.cacheRead', e); }
            const data = await fetchJSON(`${SLEEPER_BASE_URL}/players/nfl`);
            if (generation !== _wrDataGeneration) return null;
            _wrPlayersFetchedAt = Date.now();
            _wrPlayersCache = data;
            window.App.playerFreshness = { fetchedAt: _wrPlayersFetchedAt, providerAsOf: null };
            // Fire-and-forget persist — never block returning data on the IDB write.
            WrIDB.set(WR_KEYS.PLAYERS_CACHE, { data, ts: Date.now() }).catch(e => wrLog('players.cacheWrite', e));
            return data;
        })();
        try {
            return await request;
        } finally {
            if (_wrPlayersInflight === request) _wrPlayersInflight = null;
        }
    }

    // ─── Shared Constants ──────────────────────────────────────────────────────
    // window.App is populated by ReconAI CDN scripts before this file loads.
    // We extend it here with War Room constants all tabs need in one place.
    window.App = window.App || {};

    // Position colors — single source of truth (was copy-pasted across 6 locations)
    window.App.POS_COLORS = Object.assign({
        QB:'var(--k-e74c3c, #e74c3c)', RB:'var(--k-2ecc71, #2ecc71)', WR:'var(--k-3498db, #3498db)', TE:'var(--k-f0a500, #f0a500)',
        K:'var(--k-9b59b6, #9b59b6)',  DEF:'var(--k-85929e, #85929e)', DL:'var(--k-e67e22, #e67e22)', LB:'var(--k-1abc9c, #1abc9c)', DB:'var(--k-e91e63, #e91e63)', IDP:'var(--k-8e8cdb, #8e8cdb)'
    }, window.App.POS_COLORS || {});
    // Color families never replace the player's position label or roster-slot
    // identity. EDGE remains EDGE, for example, while sharing DL's color.
    const idpColorFamilies = {
        DL:'DL', DE:'DL', DT:'DL', NT:'DL', IDL:'DL', EDGE:'DL',
        LB:'LB', OLB:'LB', ILB:'LB', MLB:'LB',
        DB:'DB', CB:'DB', S:'DB', SS:'DB', FS:'DB',
        IDP:'IDP', IDP_FLEX:'IDP',
    };
    window.App.idpPositionFamily = pos => idpColorFamilies[String(pos || '').trim().toUpperCase()] || null;
    Object.entries(idpColorFamilies).forEach(([alias, family]) => { window.App.POS_COLORS[alias] = window.App.POS_COLORS[family]; });
    window.App.positionColor = pos => {
        const label = String(pos || '').trim().toUpperCase();
        return window.App.POS_COLORS[window.App.idpPositionFamily(label) || label] || null;
    };

    // Position groups — canonical arrays for normPos (was inline in 20+ locations)
    window.App.POS_GROUPS = window.App.POS_GROUPS || {
        DB: ['DB','CB','S','SS','FS'],
        DL: ['DL','DE','DT','NT','IDL','EDGE'],
        LB: ['LB','OLB','ILB','MLB'],
        DEF: ['DEF','DST','D/ST'],
        K: ['K','PK'],   // MFL codes kickers as PK
    };

    // Age curves default - fallback only; shared/constants.js is the primary source.
    window.App.AGE_CURVE_WINDOWS_DEFAULT = window.App.AGE_CURVE_WINDOWS_DEFAULT || {
        QB:{build:[23,27],peak:[28,34],decline:[35,38]},
        RB:{build:[21,22],peak:[23,25],decline:[26,28]},
        WR:{build:[22,24],peak:[25,28],decline:[29,31]},
        TE:{build:[23,25],peak:[26,29],decline:[30,32]},
        DL:{build:[22,24],peak:[25,29],decline:[30,32]},
        EDGE:{build:[22,24],peak:[25,29],decline:[30,32]},
        LB:{build:[22,23],peak:[24,28],decline:[29,31]},
        DB:{build:[21,23],peak:[24,27],decline:[28,30]},
        K:{build:[23,27],peak:[28,35],decline:[36,40]},
    };
    window.App.ageCurveWindows = window.App.ageCurveWindows || window.App.AGE_CURVE_WINDOWS_DEFAULT;

    // Peak windows default - elite portion of the curve.
    window.App.PEAK_WINDOWS_DEFAULT = window.App.PEAK_WINDOWS_DEFAULT || {
        QB:[28,34], RB:[23,25], WR:[25,28], TE:[26,29],
        DL:[25,29], EDGE:[25,29], LB:[24,28], DB:[24,27], K:[28,35]
    };
    // Set only if ReconAI CDN hasn't provided them
    window.App.peakWindows = window.App.peakWindows || window.App.PEAK_WINDOWS_DEFAULT;
    window.App.getAgeCurve = window.App.getAgeCurve || function getAgeCurve(pos) {
        const p = pos === 'DE' || pos === 'DT' || pos === 'NT' || pos === 'EDGE' ? 'DL'
            : pos === 'CB' || pos === 'S' || pos === 'SS' || pos === 'FS' ? 'DB'
            : pos === 'OLB' || pos === 'ILB' || pos === 'MLB' ? 'LB'
            : pos;
        return window.App.ageCurveWindows?.[p] || { build: [22, 24], peak: window.App.peakWindows?.[p] || [24, 29], decline: [30, 32] };
    };
    window.App.getValueWindowEnd = window.App.getValueWindowEnd || function getValueWindowEnd(pos) {
        return window.App.getAgeCurve(pos).decline[1];
    };

    // tradeValueTier — player value bracket label/color (owned by reconai/shared/constants.js)
    // Fallback with CDN-matching thresholds in case constants.js hasn't loaded yet.
    window.App.tradeValueTier = window.App.tradeValueTier || function(val) {
        if (val >= 7000) return { tier: 'Elite',   col: 'var(--green)' };
        if (val >= 4000) return { tier: 'Starter',  col: 'var(--accent)' };
        if (val >= 2000) return { tier: 'Depth',    col: 'var(--text2)' };
        if (val > 0)     return { tier: 'Stash',    col: 'var(--text3)' };
        return { tier: '—', col: 'var(--text3)' };
    };
    window.tradeValueTier = window.App.tradeValueTier;

    // formatNFLDraftSlot — NFL draft-capital label "R{round}.{pickInRound}".
    // Shared owner is reconai/shared/utils.js; this is the CDN-down fallback.
    // Divides by 32 (NFL teams), NOT the fantasy league size.
    window.App.formatNFLDraftSlot = window.App.formatNFLDraftSlot || function formatNFLDraftSlot(round, overallPick) {
        const rd = Number(round) || 0;
        const overall = Number(overallPick) || 0;
        if (rd <= 0) return overall > 0 ? '#' + overall : '';
        if (overall <= 0) return 'R' + rd;
        const pickInRound = Math.max(1, overall - (rd - 1) * 32);
        return 'R' + rd + '.' + String(pickInRound).padStart(2, '0');
    };
    window.formatNFLDraftSlot = window.App.formatNFLDraftSlot;

    // ── Shared rookie/prospect field resolver ────────────────────────────────
    // Joins an arbitrary Sleeper player to its rookie-data prospect record so the
    // rich scouting fields (college, NFL draft slot, NFL team, consensus rank,
    // tier, size/speed profile) can be surfaced consistently in Free Agency, the
    // Trade Center, and My Roster — all of which key players by Sleeper pid, while
    // the prospect record keys by normalized NAME (its `pid` is a synthetic
    // `csv_<name>`, never a Sleeper id). The base findProspect/getProspects come
    // from rookie-data.js (eager at boot); the alias-richer scouting.js versions
    // override them once the Draft module group loads. We read whichever exists at
    // CALL time and degrade to null/empty before the rookie CSV has loaded — so
    // callers should memoize any built index on a load signal (e.g. timeRecomputeTs).
    (function() {
        const ROOKIE_SUFFIX = /\s+(jr\.?|sr\.?|ii|iii|iv)$/;
        function rkNorm(s) {
            return String(s || '').toLowerCase().replace(/['‘’`.]/g, '')
                .replace(ROOKIE_SUFFIX, '').replace(/\s+/g, ' ').trim();
        }
        function rkNameOf(p) {
            if (!p) return '';
            return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || p.name || '';
        }
        function rkFinder() { return (window.RookieData && window.RookieData.findProspect) || window.findProspect || null; }
        function rkList() {
            const g = (window.RookieData && window.RookieData.getProspects) || window.getProspects || null;
            if (!g) return [];
            try { return g() || []; } catch (e) { return []; }
        }
        // Reject same-name veteran/rookie collisions when both positions are known.
        function rkPosOk(player, prospect) {
            if (!player || !player.position) return true;
            const ppos = prospect && (prospect.mappedPos || prospect.pos || prospect.position);
            if (!ppos) return true;
            const np = window.App.normPos;
            const a = np ? np(player.position) : player.position;
            const b = np ? (np(ppos) || ppos) : ppos;
            return !a || !b || a === b;
        }
        // One-shot resolver (alias matching via findProspect). Use for a handful of
        // lookups; for table rendering over many rows, prefer buildIndex + lookup.
        function rkResolve(player, opts) {
            const f = rkFinder(); if (!f || !player) return null;
            const nm = rkNameOf(player); if (!nm) return null;
            let pr = null;
            try { pr = f(nm); } catch (e) { return null; }
            if (!pr) return null;
            if ((!opts || opts.posGuard !== false) && !rkPosOk(player, pr)) return null;
            return pr;
        }
        // Normalized-name → prospect Map for hot render loops. getProspects() is
        // rank-sorted, so first-in-wins yields the best-ranked prospect on collisions.
        function rkBuildIndex() {
            const m = new Map();
            rkList().forEach(pr => { const k = rkNorm(pr.name); if (k && !m.has(k)) m.set(k, pr); });
            return m;
        }
        function rkLookup(index, player, opts) {
            if (!index || !player) return null;
            const pr = index.get(rkNorm(rkNameOf(player)));
            if (!pr) return null;
            if (opts && opts.posGuard && !rkPosOk(player, pr)) return null;
            return pr;
        }
        // NFL draft-capital label: "R2.45" / "UDFA" / '' (pre-draft / unknown).
        function rkDraftSlot(pr) {
            if (!pr) return '';
            if (pr.isUDFA) return 'UDFA';
            if (pr.draftRound || pr.draftPick) {
                const fmt = window.App.formatNFLDraftSlot;
                return (typeof fmt === 'function' ? fmt(pr.draftRound, pr.draftPick) : '')
                    || ('R' + (pr.draftRound || '?') + (pr.draftPick ? '.' + pr.draftPick : ''));
            }
            return '';
        }
        // Normalized display fields off a prospect record. Returns null if no prospect.
        function rkFields(pr) {
            if (!pr) return null;
            const profile = [pr.size, pr.weight ? pr.weight + 'lb' : '', pr.speed].filter(Boolean).join(' · ');
            return {
                prospect: pr,
                college: pr.college || pr.school || '',
                nflTeam: pr.nflTeam || '',
                isUDFA: !!pr.isUDFA,
                draftRound: pr.draftRound || null,
                draftPick: pr.draftPick || null,
                draftSlot: rkDraftSlot(pr),
                consensusRank: pr.consensusRank != null ? pr.consensusRank : (pr.avgRank != null ? pr.avgRank : null),
                rank: pr.rank != null ? pr.rank : null,
                tier: pr.tierNum != null ? pr.tierNum : (pr.tier != null ? pr.tier : null),
                tierLabel: pr.tierLabel || '',
                grade: pr.grade != null ? pr.grade : null,
                size: pr.size || '',
                weight: pr.weight || '',
                speed: pr.speed || '',
                profile,
                dynastyValue: pr.dynastyValue != null ? pr.dynastyValue : null,
                summary: pr.summary || '',
            };
        }
        // Is this Sleeper player a current rookie? Prospect-resolution is the strong
        // signal; fall back to 0 NFL years + no accumulated stats. Pass statsMaps
        // {cur, prev} (keyed by pid) so a same-named veteran isn't mistaken for one.
        function rkIsRookie(player, prospect, statsMaps) {
            if (prospect) return true;
            if (!player) return false;
            if (Number(player.years_exp != null ? player.years_exp : (player.yoe != null ? player.yoe : 0)) !== 0) return false;
            const pid = player.player_id || player.pid;
            const cur = statsMaps && statsMaps.cur && pid ? statsMaps.cur[pid] : null;
            const prev = statsMaps && statsMaps.prev && pid ? statsMaps.prev[pid] : null;
            if ((cur && cur.gp > 0) || (prev && prev.gp > 0)) return false;
            return true;
        }
        window.App.RookieFields = {
            norm: rkNorm,
            nameOf: rkNameOf,
            resolve: rkResolve,
            buildIndex: rkBuildIndex,
            lookup: rkLookup,
            draftSlot: rkDraftSlot,
            fields: rkFields,
            isRookie: rkIsRookie,
        };
    })();

    // computeNFLFit — fallback no-op if nfl-fit.js (shared) failed to load,
    // so callers can safely optional-chain. Real impl lives in shared/nfl-fit.js.
    window.App.computeNFLFit = window.App.computeNFLFit || function computeNFLFit() {
        return { fitTier: 'Unknown', fitScore: 50, signals: {}, narrative: '', contextString: '', confidence: 0, sources: [] };
    };

    // normPos — canonical position normalizer (was identical in draft-room, free-agency, trade-calc)
    window.App.normPos = window.App.normPos || function normPos(pos) {
        if (!pos) return null;
        for (const [canonical, variants] of Object.entries(window.App.POS_GROUPS)) {
            if (variants.includes(pos)) return canonical;
        }
        return pos;
    };

    // posLabel — display formatter for position/slot codes. Referenced across the
    // app (`window.App?.posLabel?.(pos) || ...` in ~30 files) but was never actually
    // defined, so every call silently fell through to its per-site fallback — which
    // only special-cases DEF, so underscored slot codes (SUPER_FLEX, IDP_FLEX,
    // REC_FLEX, QB_FLEX...) rendered raw in the UI instead of a clean label.
    window.App.posLabel = window.App.posLabel || function posLabel(pos) {
        if (!pos) return pos;
        const p = String(pos).toUpperCase();
        if (p === 'DEF') return 'D/ST';
        return p.replace(/_/g, ' ');
    };

    // calcPosGrades — league-relative position group grades
    // Sums DHQ per position for every team, ranks, and assigns A-F.
    // Returns [{ pos, rank, totalTeams, mySum, grade, col, pct }]
    window.App.calcPosGrades = window.App.calcPosGrades || function calcPosGrades(myRosterId, rosters, playersData) {
        // Format-aware: valueMap proxies to ROS values in redraft leagues and
        // to the same dynasty playerScores everywhere else.
        const scores = (window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : null) || window.App?.LI?.playerScores || {};
        const normPos = window.App.normPos || (p => p);
        const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
        const totalTeams = (rosters || []).length || 1;
        return posOrder.map(pos => {
            const byTeam = (rosters || []).map(r => {
                const sum = (r.players || []).reduce((s, pid) => {
                    const p = playersData?.[pid];
                    if (p && normPos(p.position) === pos) return s + (scores[pid] || 0);
                    return s;
                }, 0);
                return { rosterId: r.roster_id, sum };
            }).sort((a, b) => b.sum - a.sum);
            const mySum = byTeam.find(t => t.rosterId === myRosterId)?.sum || 0;
            const rank = byTeam.findIndex(t => t.rosterId === myRosterId) + 1;
            let grade, col;
            const pct = totalTeams > 1 ? Math.round((1 - (rank - 1) / totalTeams) * 100) : 50;
            if (rank <= Math.ceil(totalTeams * 0.2)) { grade = 'A'; col = 'var(--k-2ecc71, #2ecc71)'; }
            else if (rank <= Math.ceil(totalTeams * 0.4)) { grade = 'B'; col = 'var(--k-d4af37, #d4af37)'; }
            else if (rank <= Math.ceil(totalTeams * 0.6)) { grade = 'C'; col = 'var(--k-f0a500, #f0a500)'; }
            else if (rank <= Math.ceil(totalTeams * 0.8)) { grade = 'D'; col = 'var(--k-f0a500, #f0a500)'; }
            else { grade = 'F'; col = 'var(--k-e74c3c, #e74c3c)'; }
            return { pos, rank, totalTeams, mySum, grade, col, pct };
        });
    };

    // calcRawPts — fantasy points from stats + scoring settings
    // (replaces diverging implementations in trade-calc, free-agency, league-detail, components)
    window.App.calcRawPts = window.App.calcRawPts || function calcRawPts(stats, scoring) {
        if (!stats) return null;
        if (scoring) {
            let total = 0;
            for (const [field, weight] of Object.entries(scoring)) {
                if (typeof weight !== 'number') continue;
                if (stats[field] != null) total += Number(stats[field]) * weight;
            }
            return total;
        }
        const pre = stats.pts_half_ppr ?? stats.pts_ppr ?? stats.pts_std ?? null;
        return pre !== null ? Number(pre) : null;
    };

    // calcPPG — points per game, derived from calcRawPts
    window.App.calcPPG = window.App.calcPPG || function calcPPG(stats, scoring) {
        const raw = window.App.calcRawPts(stats, scoring);
        if (raw === null) return 0;
        const gp = stats?.gp || 0;
        return gp > 0 ? Math.max(0, raw / gp) : 0;
    };

    // ─── Storage Keys & Abstraction ───────────────────────────────────────────
    // Centralised registry of all War Room-owned localStorage/sessionStorage keys.
    // od_ / dhq_ / dynastyhq_ prefixed keys are ReconAI-owned — access them directly.
    const WR_KEYS = {
        // User preferences
        TASTE_USED:       'wr_taste_used',
        AI_DAILY:         (date) => `wr_ai_daily_${date}`,
        ALEX_AVATAR:      'wr_alex_avatar',
        // League navigation
        LAST_LEAGUE_ID:   'wr_last_league_id',
        LAST_LEAGUE_NAME: 'wr_last_league_name',
        DEMO_MODE:        'wr_demo_mode',
        // League-level state
        TIME_YEAR:        'wr_time_year',
        ROSTER_COLS:      'wr_roster_cols',
        KPI_SELECTION:    (leagueId) => `wr_kpi_selection_${leagueId}`,
        GM_STRATEGY:      (leagueId) => `wr_gm_strategy_${leagueId}`,
        COMMISH_SCHEDULE: (leagueId) => `wr_commish_schedule_${leagueId}`,
        CHAT:             (leagueId) => `wr_chat_${leagueId}`,
        SAVED_TRADES:     (leagueId) => `wr_saved_trades_${leagueId}`,
        WELCOMED:         (leagueId) => `wr_welcomed_v2_${leagueId}`,
        // Draft
        BIGBOARD:         (leagueId) => `wr_bigboard_${leagueId}`,
        BIGBOARD_DRAFT:   (leagueId, draftType) => `wr_bigboard_${leagueId}_${draftType || 'draft'}`,
        // Session cache (sessionStorage, not localStorage)
        PLAYERS_CACHE:    'fw_players_cache',
        // SOS engine caches (sessionStorage, 24hr TTL — managed by sos-engine.js)
        SOS_DEF_CACHE:   (season) => `wr_sos_def_${season}`,
        SOS_SCHED_CACHE: (season) => `wr_sos_sch_${season}`,
        SOS_WEEK_CACHE:  (season, week) => `wr_sos_wk_${season}_${week}`,
    };

    // WrStorage — thin wrappers that handle JSON serialisation and call wrLog on errors.
    // All War Room localStorage reads/writes should go through here.
    const WrStorage = {
        get(key, fallback = null) {
            try {
                const v = localStorage.getItem(key);
                if (v === null) return fallback;
                try { return JSON.parse(v); } catch { return v; } // raw string if not JSON
            } catch(e) { wrLog('storage.get:' + key, e); return fallback; }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            } catch(e) { wrLog('storage.set:' + key, e); }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch(e) { wrLog('storage.remove:' + key, e); }
        },
        getSession(key, fallback = null) {
            try {
                const v = sessionStorage.getItem(key);
                if (v === null) return fallback;
                try { return JSON.parse(v); } catch { return v; }
            } catch(e) { wrLog('storage.getSession:' + key, e); return fallback; }
        },
        setSession(key, value) {
            try {
                sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            } catch(e) {
                // Never sessionStorage.clear() on quota errors — that wiped unrelated
                // state as collateral. Oversized payloads (e.g. the players map) belong
                // in WrIDB (IndexedDB) instead, which has far more room.
                wrLog('storage.setSession:' + key, e);
            }
        },
        removeSession(key) {
            try { sessionStorage.removeItem(key); } catch(e) { wrLog('storage.removeSession:' + key, e); }
        },
    };

    window.App.WR_KEYS  = WR_KEYS;
    window.App.WrStorage = WrStorage;
    window.App.WrIDB = WrIDB;
    window.App.fetchAllPlayers = fetchAllPlayers;

    // Clears core.js's in-memory data caches + the players IDB entry so the
    // next fetch hits the network. MUST live in this file: _wrPlayersCache is a
    // closure variable of this text/babel script, so the old external
    // `window._wrPlayersCache = null` never touched the real cache. Callers
    // (sidebar "Refresh Data") should also call window.Sleeper.clearSeasonCaches()
    // to flush the shared season/players caches.
    window.App.clearDataCaches = function clearDataCaches() {
        _wrDataGeneration++; _wrPlayersInflight = null; _wrPlayersFetchedAt = 0;
        window.App.WeeklyProj?.invalidate?.();
        window.App.PlayerValue?.invalidate?.();
        window.App.NflContext?.invalidate?.();
        window.App.SOS?.invalidate?.();
        window.Sleeper?.clearSeasonCaches?.();
        window.App.playerFreshness = null;
        _wrPlayersCache = null;
        _wrStatsCache = {};
        _projectionsCache = {};
        WrIDB.del(WR_KEYS.PLAYERS_CACHE).catch(e => wrLog('clearDataCaches.players', e));
    };

    window.App.getRosterDataState = function getRosterDataState(opts = {}) {
        const roster = opts.roster || opts.myRoster || (typeof window.myR === 'function' ? window.myR() : null);
        const rosters = opts.rosters || opts.currentLeague?.rosters || window.S?.rosters || [];
        const league = opts.currentLeague || window.S?.leagues?.[0] || {};
        const collectIds = (r) => r ? [...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].filter(id => id && String(id) !== '0').map(String) : [];
        const rosterIds = collectIds(roster);
        const leaguePlayerCount = (rosters || []).reduce((sum, r) => sum + collectIds(r).length, 0);
        const rosterSlots = (league.roster_positions || []).filter(pos => pos && pos !== 'BN' && pos !== 'TAXI' && pos !== 'IR').length;
        const minUsableRoster = Math.max(1, Math.min(6, rosterSlots || 6));
        const leagueId = String(league?.league_id || league?.id || '');
        const activeSkin = typeof window.App?.LeagueSkin?.getCurrent === 'function' ? window.App.LeagueSkin.getCurrent() : null;
        const activeSkinLeagueId = String(activeSkin?.profile?.leagueId || '');
        const matchingActiveSkin = activeSkin && (!leagueId || !activeSkinLeagueId || activeSkinLeagueId === leagueId) ? activeSkin : null;
        const leagueSkin = opts.leagueSkin || matchingActiveSkin || (typeof window.App?.LeagueSkin?.build === 'function'
            ? window.App.LeagueSkin.build({
                league,
                rosters,
                myRoster: roster,
                draft: opts.draft || opts.draftInfo || opts.briefDraftInfo || window.S?.drafts?.find?.(d => d?.status === 'drafting' || d?.status === 'pre_draft'),
                nflState: opts.nflState || window.S?.nflState,
                profile: opts.profile,
            })
            : null);
        const skinRosterCopy = leagueSkin?.copy?.rosterData || {};
        const isPreDraftRosterEmpty = !!(leagueSkin?.state?.isPreDraftRosterEmpty && leaguePlayerCount === 0);
        let reason = '';

        // CHOPPED: an eliminated roster is empty because the format released
        // it to waivers — correct data, not a sync failure. Telling the owner
        // to "re-sync the platform" the week they get chopped is the app
        // misreading its own league.
        const choppedOut = !!(window.App?.Chopped?.isChopped?.(league) && window.App.Chopped.isEliminated(roster));

        if (!roster) reason = 'missing-roster';
        else if (!Array.isArray(rosters) || !rosters.length) reason = 'missing-league-rosters';
        else if (choppedOut) reason = 'chopped-out';
        else if (leaguePlayerCount === 0) reason = isPreDraftRosterEmpty ? 'pre-draft-rosters-empty' : 'league-rosters-empty';
        else if (rosterIds.length === 0) reason = 'my-roster-empty';
        else if (rosterIds.length < minUsableRoster) reason = 'my-roster-partial';

        const messages = {
            'missing-roster': 'Your team roster could not be matched in this league.',
            'missing-league-rosters': 'League roster data has not loaded yet.',
            'pre-draft-rosters-empty': skinRosterCopy.emptyRosterMessage || 'This league has not drafted rosters yet.',
            'league-rosters-empty': 'League rosters loaded with zero player IDs.',
            'my-roster-empty': 'Your roster loaded with zero player IDs.',
            'chopped-out': 'You were chopped — your roster went back to the waiver pool.',
            'my-roster-partial': 'Your roster looks partially loaded.',
        };
        const defaultDetail = 'Refresh league data or re-sync the platform before acting on roster, trade, waiver, draft, or analytics recommendations.';
        const details = {
            'pre-draft-rosters-empty': skinRosterCopy.emptyRosterDetail || 'Roster-dependent recommendations stay paused until the draft, but draft prep can continue.',
            'chopped-out': 'Nothing to re-sync — this is the format working as designed. League-wide views stay available.',
        };

        return {
            isUsable: !reason,
            reason,
            rosterCount: rosterIds.length,
            leaguePlayerCount,
            minUsableRoster,
            leagueSkin,
            isPreDraftRosterEmpty: reason === 'pre-draft-rosters-empty',
            message: reason ? messages[reason] : 'Roster data ready.',
            detail: reason ? (details[reason] || defaultDetail) : '',
            brief: reason === 'pre-draft-rosters-empty' ? (skinRosterCopy.emptyRosterBrief || messages[reason]) : '',
        };
    };
    window.App.renderRosterDataBlocker = function renderRosterDataBlocker(state, opts = {}) {
        const ReactRef = window.React || (typeof React !== 'undefined' ? React : null);
        if (!ReactRef) return null;
        const compact = !!opts.compact;
        const skinRosterCopy = state?.leagueSkin?.copy?.rosterData || state?.skin?.copy?.rosterData || {};
        const title = opts.title || (state?.isPreDraftRosterEmpty ? skinRosterCopy.emptyRosterTitle : '') || 'Roster sync incomplete';
        const message = opts.message || state?.message || 'Roster data is not ready.';
        const detail = opts.detail || state?.detail || 'Refresh league data before acting on recommendations.';
        const style = {
            background: opts.background || 'var(--surf-solid, rgba(10,10,10,0.92))',
            border: opts.border || '1px solid rgba(240,165,0,0.35)',
            borderRadius: opts.radius || '8px',
            padding: compact ? '12px' : '18px',
            color: 'var(--silver)',
            height: opts.fill ? '100%' : undefined,
            minHeight: opts.minHeight || (compact ? '100%' : undefined),
            display: 'flex',
            flexDirection: 'column',
            justifyContent: compact ? 'center' : 'flex-start',
            gap: compact ? '6px' : '10px',
            textAlign: compact ? 'center' : 'left',
            overflow: 'hidden',
            ...(opts.style || {}),
        };
        return ReactRef.createElement('div', { className: opts.className || 'wr-roster-data-blocker', style },
            ReactRef.createElement('div', {
                style: {
                    color: 'var(--k-f0a500, #f0a500)',
                    fontFamily: 'Rajdhani, sans-serif',
                    fontSize: compact ? '0.85rem' : '1.1rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                },
            }, title),
            ReactRef.createElement('div', { style: { color: 'var(--white)', fontWeight: 700, fontSize: compact ? '0.78rem' : '0.92rem', lineHeight: 1.35 } }, message),
            !compact && ReactRef.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', lineHeight: 1.55, opacity: 0.78 } }, detail),
            opts.actionLabel && ReactRef.createElement('button', {
                type: 'button',
                onClick: opts.onAction || (() => window.location.reload()),
                style: {
                    alignSelf: compact ? 'center' : 'flex-start',
                    marginTop: compact ? '2px' : '4px',
                    padding: compact ? '5px 8px' : '7px 12px',
                    border: '1px solid rgba(240,165,0,0.45)',
                    background: 'rgba(240,165,0,0.12)',
                    color: 'var(--k-f0a500, #f0a500)',
                    borderRadius: 'var(--card-radius-xs, 5px)',
                    fontFamily: 'var(--font-body)',
                    fontSize: compact ? '0.62rem' : '0.72rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                },
            }, opts.actionLabel)
        );
    };

    // ── Normalize traded picks: owner_id can be roster_id OR user_id ─
    // Sleeper's /traded_picks API is ambiguous — detect which type and
    // convert to roster_id so all downstream code can compare safely.
    window.App.normalizeTradedPicks = function normalizeTradedPicks(rosters, tps) {
      if (!tps?.length || !rosters?.length) return tps || [];
      const rosterIds = new Set(rosters.map(r => String(r.roster_id)));
      const userIds   = new Set(rosters.map(r => String(r.owner_id)));
      let rH = 0, uH = 0;
      for (const tp of tps) { const o = String(tp.owner_id ?? ''); if (rosterIds.has(o)) rH++; if (userIds.has(o)) uH++; }
      if (rH >= uH) return tps;
      const u2r = {}; for (const r of rosters) u2r[String(r.owner_id)] = String(r.roster_id);
      return tps.map(tp => { const rid = u2r[String(tp.owner_id ?? '')]; return rid ? { ...tp, owner_id: rid } : tp; });
    };
    // ──────────────────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────────────────

    const STATS_YEAR = '2025'; // Most recent completed season — used until Sleeper publishes projections

    // Delegate to the shared IndexedDB-backed, TTL'd, in-flight-deduped season
    // cache (window.Sleeper.fetchSeasonStats) — it owns freshness, so no memo
    // layer in front of it: a local no-TTL memo pinned the first response for
    // the whole session and defeated in-season revalidation. The local memo is
    // used ONLY on the raw-fetch fallback path (shared API not loaded).
    let _wrStatsCache = {};
    async function fetchSeasonStats(season) {
        try {
            if (window.Sleeper?.fetchSeasonStats) return await window.Sleeper.fetchSeasonStats(season);
            if (!_wrStatsCache[season]) _wrStatsCache[season] = await fetchJSON(`${SLEEPER_BASE_URL}/stats/nfl/regular/${season}`);
            return _wrStatsCache[season];
        } catch (e) {
            console.warn('Stats fetch failed:', e);
            return _wrStatsCache[season] || {};
        }
    }

    let _projectionsCache = {};
    async function fetchSeasonProjections(season) {
        try {
            if (window.Sleeper?.fetchSeasonProjections) return await window.Sleeper.fetchSeasonProjections(season);
            if (!_projectionsCache[season]) _projectionsCache[season] = await fetchJSON(`${SLEEPER_BASE_URL}/projections/nfl/regular/${season}`);
            return _projectionsCache[season];
        } catch (e) {
            console.warn('Projections fetch failed:', e);
            return _projectionsCache[season] || {};
        }
    }

    // ── SeasonContext ────────────────────────────────────────────────────────
    // Reactive bridge between league-detail.js and tab components.
    // Provides: season, playerStats, tradedPicks, rosters, myRosterId, lastUpdated, selectPlayer
    // write-through: window.S remains intact for ReconAI CDN bridge compatibility.
    window.App.SeasonContext = React.createContext(null);
